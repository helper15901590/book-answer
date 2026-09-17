import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  AdminSecurityRecord,
  AuthSessionRecord,
  ChatSession,
  LLMConfig,
  MembershipTier,
  OrderLog,
  Skill,
  UserProfile,
  getEffectiveMembershipTier,
  membershipExpiryAfterRenewal,
  tierDailyLimit,
} from '../src/types.js';
import { INITIAL_SKILLS, INITIAL_MENTORS, DEFAULT_LLM_CONFIG } from '../src/data/initialData.js';
import { DATA_DIR, ADMIN_PHONE } from './config.js';
import { decryptSecret, encryptSecret, isEncryptedSecret } from './services/security.js';

const SQLITE_DB_PATH = path.join(DATA_DIR, 'commercial.sqlite');

export function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toLocalDateString(ts?: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts.includes('T') ? ts : ts.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function localDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function lastNDays(n: number): string[] {
  return Array.from({ length: n }, (_, i) => localDateNDaysAgo(n - 1 - i));
}

function getCurrentMonthString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function sanitizeLLMConfigForStorage(config: LLMConfig): LLMConfig {
  const clean = { ...config };
  delete clean.apiKeyConfigured;
  if (clean.dailyLimits) {
    const { freeMember, monthlyMember, quarterlyMember, yearlyMember } = clean.dailyLimits;
    clean.dailyLimits = { freeMember, monthlyMember, quarterlyMember, yearlyMember };
  }
  return clean;
}

export class CommercialSQLDatabase {
  private db: Database.Database | null = null;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
    this.db = new Database(SQLITE_DB_PATH);
    this.db.pragma('journal_mode = WAL');
    // WAL 下 NORMAL 仍是崩溃安全的（最坏只丢最近几个已提交事务，不会损坏库），但省掉每次提交的 fsync。
    // 云 VPS 的网络盘上单次 fsync 成本高，这一项直接决定写入吞吐。
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');
    this.initializeSchema();
    this.migratePlaintextSecrets();
    this.seedInitialData();
    console.log('✅ Commercial SQLite Engine (better-sqlite3, WAL) at:', SQLITE_DB_PATH);
  }

  public close(): void {
    this.db?.close();
    this.db = null;
  }

  public ping(): boolean {
    if (!this.db) return false;
    try {
      this.db.prepare('SELECT 1 AS ok').get();
      return true;
    } catch {
      return false;
    }
  }

  private tableExists(name: string): boolean {
    if (!this.db) return false;
    return !!this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);
  }

  private columnExists(table: string, column: string): boolean {
    if (!this.db) return false;
    const cols = this.db.pragma(`table_info(${table})`) as { name: string }[];
    return cols.some((c) => c.name === column);
  }

  private renameLegacyTableIfNeeded(table: string): void {
    if (!this.db || !this.tableExists(table)) return;
    const legacy = `${table}_legacy_v1`;
    if (this.tableExists(legacy)) return;
    this.db.exec(`ALTER TABLE ${table} RENAME TO ${legacy}`);
    const indices = this.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ? AND name NOT LIKE 'sqlite_%'").all(legacy) as { name: string }[];
    for (const index of indices) {
      try { this.db.exec(`DROP INDEX IF EXISTS ${index.name}`); } catch {}
    }
  }

  private initializeSchema(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    const applied = this.db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get();
    if (!applied) {
      const hadLegacySchema = this.tableExists('users') && !this.columnExists('users', 'status');
      if (hadLegacySchema) {
        this.renameLegacyTableIfNeeded('users');
        this.renameLegacyTableIfNeeded('chat_sessions');
        this.renameLegacyTableIfNeeded('orders');
      }
      this.createTables();
      this.db.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)').run();
    }
    this.createIndices();
  }

  private createTables(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        phone TEXT UNIQUE,
        password_hash TEXT,
        nickname TEXT NOT NULL,
        avatar TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        membership_tier TEXT NOT NULL DEFAULT 'free_member',
        membership_expires_at TEXT,
        must_change_password INTEGER NOT NULL DEFAULT 1,
        daily_max_chats INTEGER NOT NULL DEFAULT 10,
        daily_used_count INTEGER NOT NULL DEFAULT 0,
        last_active_date TEXT,
        last_active_month TEXT,
        failed_login_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        author TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        cover_url TEXT,
        tags TEXT DEFAULT '[]',
        system_prompt TEXT,
        sample_questions TEXT DEFAULT '[]',
        chat_count INTEGER DEFAULT 0,
        search_count INTEGER DEFAULT 0,
        skill_type TEXT DEFAULT 'book',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        skill_id TEXT,
        skill_title TEXT,
        skill_author TEXT,
        skill_cover_url TEXT,
        messages TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        trade_no TEXT UNIQUE NOT NULL,
        transaction_id TEXT,
        user_id TEXT,
        skill_id TEXT,
        skill_title TEXT,
        plan_type TEXT DEFAULT 'monthly',
        plan_name TEXT DEFAULT '月度会员',
        amount REAL NOT NULL,
        type TEXT DEFAULT 'membership',
        payment_method TEXT DEFAULT 'wechat',
        status TEXT DEFAULT 'pending',
        paid_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        role TEXT NOT NULL,
        csrf_hash TEXT NOT NULL,
        auth_version TEXT,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        ip TEXT,
        user_agent TEXT
      );
      CREATE TABLE IF NOT EXISTS auth_challenges (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        payload TEXT DEFAULT '{}',
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS admin_security (
        id TEXT PRIMARY KEY,
        totp_secret_enc TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        recovery_code_hashes TEXT NOT NULL DEFAULT '[]',
        pending_secret_enc TEXT,
        pending_recovery_hashes TEXT NOT NULL DEFAULT '[]',
        auth_version TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quota_ledger (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        period_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        settled_at TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT,
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        metadata TEXT DEFAULT '{}',
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL
      );
    `);
  }

  private createIndices(): void {
    if (!this.db) return;
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
      CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
      CREATE INDEX IF NOT EXISTS idx_users_tier ON users(membership_tier);
      CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_date);
      CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
      CREATE INDEX IF NOT EXISTS idx_skills_search ON skills(search_count DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_subject ON auth_sessions(subject_type, subject_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges(expires_at);
      CREATE INDEX IF NOT EXISTS idx_quota_user ON quota_ledger(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_trade_no ON orders(trade_no);
      CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    `);
  }

  private seedInitialData(): void {
    if (!this.db) return;
    const allSkills = [...INITIAL_SKILLS, ...INITIAL_MENTORS];
    for (const skill of allSkills) {
      const existing = this.db.prepare('SELECT id FROM skills WHERE id = ?').get(skill.id);
      if (!existing) {
        this.db.prepare(
          `INSERT INTO skills (id, title, author, description, category, cover_url, tags, system_prompt, sample_questions, chat_count, search_count, skill_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`
        ).run(
          skill.id,
          skill.title,
          skill.author,
          skill.description || '',
          skill.category,
          skill.coverUrl,
          JSON.stringify(skill.tags || []),
          skill.systemPrompt || '',
          JSON.stringify(skill.sampleQuestions || []),
          skill.skillType || 'book'
        );
      }
    }
    const tagsRow = this.db.prepare("SELECT value FROM system_config WHERE key = 'tags'").get() as any;
    if (!tagsRow) {
      this.db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('tags', ?)").run(JSON.stringify(['商业投资', '个人成长', '哲学心理', '经典策略']));
    }
    const configRow = this.db.prepare("SELECT value FROM system_config WHERE key = 'llm_config'").get() as any;
    if (!configRow) {
      this.db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('llm_config', ?)").run(JSON.stringify(DEFAULT_LLM_CONFIG));
    }
  }

  private migratePlaintextSecrets(): void {
    if (!this.db) return;
    const row = this.db.prepare("SELECT value FROM system_config WHERE key = 'llm_config'").get() as any;
    if (!row?.value) return;
    try {
      const config = JSON.parse(row.value) as LLMConfig;
      let changed = false;
      const plainKey = config.apiKey || config.deepseekApiKey || '';
      if (plainKey && !isEncryptedSecret(plainKey)) {
        config.apiKey = encryptSecret(plainKey);
        config.deepseekApiKey = '';
        changed = true;
      }
      if (config.dailyLimits && 'guestUser' in config.dailyLimits) {
        delete (config.dailyLimits as any).guestUser;
        changed = true;
      }
      if (changed) {
        this.db.prepare("UPDATE system_config SET value = ? WHERE key = 'llm_config'").run(JSON.stringify(config));
      }
    } catch (err) {
      console.warn('LLM 配置迁移失败:', err);
    }
  }

  private mapUserRowToProfile(row: any): UserProfile {
    return {
      id: row.id,
      phone: row.phone || undefined,
      password: row.password_hash || undefined,
      nickname: row.nickname,
      avatar: row.avatar || '',
      role: row.role === 'admin' ? 'admin' : 'member',
      status: row.status || 'active',
      membershipTier: row.membership_tier || 'free_member',
      membershipExpiresAt: row.membership_expires_at || undefined,
      mustChangePassword: Boolean(row.must_change_password),
      dailyMaxChats: row.daily_max_chats ?? 10,
      dailyUsedCount: row.daily_used_count ?? 0,
      isAdmin: row.role === 'admin',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastActiveDate: row.last_active_date || undefined,
      lastActiveMonth: row.last_active_month || undefined,
      lastLoginAt: row.last_login_at || undefined,
      deletedAt: row.deleted_at || undefined,
    };
  }

  public getUsers(): UserProfile[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as any[];
    return rows.map((row) => this.mapUserRowToProfile(row));
  }

  public getUserById(id: string): UserProfile | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as any;
    return row ? this.refreshUserDailyQuota(this.mapUserRowToProfile(row)) : undefined;
  }

  public getUserByPhone(phone: string): UserProfile | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT * FROM users WHERE phone = ?').get(phone) as any;
    return row ? this.refreshUserDailyQuota(this.mapUserRowToProfile(row)) : undefined;
  }

  public saveUser(user: UserProfile): UserProfile {
    if (!this.db) return user;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO users (id, phone, password_hash, nickname, avatar, role, status, membership_tier,
        membership_expires_at, must_change_password, daily_max_chats, daily_used_count, last_active_date,
        last_active_month, failed_login_attempts, locked_until, last_login_at, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        phone=excluded.phone, password_hash=excluded.password_hash,
        nickname=excluded.nickname, avatar=excluded.avatar, role=excluded.role, status=excluded.status,
        membership_tier=excluded.membership_tier, membership_expires_at=excluded.membership_expires_at,
        must_change_password=excluded.must_change_password, daily_max_chats=excluded.daily_max_chats,
        daily_used_count=excluded.daily_used_count, last_active_date=excluded.last_active_date,
        last_active_month=excluded.last_active_month, last_login_at=excluded.last_login_at,
        updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`
    ).run(
      user.id,
      user.phone || null,
      user.password || null,
      user.nickname,
      user.avatar || null,
      user.role,
      user.status || 'active',
      user.membershipTier || 'free_member',
      user.membershipExpiresAt || null,
      user.mustChangePassword ? 1 : 0,
      user.dailyMaxChats ?? 10,
      user.dailyUsedCount ?? 0,
      user.lastActiveDate || null,
      user.lastActiveMonth || null,
      user.lastLoginAt || null,
      user.createdAt || now,
      now,
      user.deletedAt || null
    );
    return { ...user, updatedAt: now };
  }

  public updateUserPassword(userId: string, passwordHash: string): void {
    if (!this.db) return;
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, failed_login_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(passwordHash, now, userId);
  }

  public recordLoginFailure(userId: string): void {
    if (!this.db) return;
    const user = this.getUserById(userId);
    if (!user) return;
    const attempts = this.getUserLoginState(userId).failedLoginAttempts || 0;
    const next = attempts + 1;
    const lockedUntil = next >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    this.db.prepare('UPDATE users SET failed_login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?').run(next, lockedUntil, new Date().toISOString(), userId);
  }

  public recordLoginSuccess(userId: string): void {
    if (!this.db) return;
    const now = new Date().toISOString();
    this.db.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = ?, last_active_date = ?, last_active_month = ?, updated_at = ? WHERE id = ?').run(now, getTodayString(), getCurrentMonthString(), now, userId);
  }

  public isUserLocked(user: UserProfile): boolean {
    if (!this.db || !user.id) return false;
    const row = this.db.prepare('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?').get(user.id) as any;
    if (!row?.locked_until) return false;
    return new Date(row.locked_until).getTime() > Date.now();
  }

  public getUserLoginState(userId: string): { failedLoginAttempts: number; lockedUntil?: string } {
    if (!this.db) return { failedLoginAttempts: 0 };
    const row = this.db.prepare('SELECT failed_login_attempts, locked_until FROM users WHERE id = ?').get(userId) as any;
    return { failedLoginAttempts: row?.failed_login_attempts || 0, lockedUntil: row?.locked_until || undefined };
  }

  public clearAllUsers(): void {
    if (!this.db) return;
    const tx = this.db.transaction(() => {
      this.db!.prepare('DELETE FROM chat_sessions').run();
      this.db!.prepare('DELETE FROM auth_sessions').run();
      this.db!.prepare('DELETE FROM auth_challenges').run();
      this.db!.prepare('DELETE FROM quota_ledger').run();
      this.db!.prepare('DELETE FROM audit_logs').run();
      this.db!.prepare('DELETE FROM orders').run();
      this.db!.prepare('DELETE FROM users').run();
    });
    tx();
  }

  public dropLegacyAccountTables(): void {
    if (!this.db) return;
    for (const table of ['users_legacy_v1', 'chat_sessions_legacy_v1', 'orders_legacy_v1']) {
      if (this.tableExists(table)) this.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
    }
  }

  public deleteUser(userId: string): boolean {
    if (!this.db) return false;
    const tx = this.db.transaction(() => {
      this.db!.prepare('DELETE FROM chat_sessions WHERE user_id = ?').run(userId);
      this.db!.prepare('DELETE FROM auth_sessions WHERE subject_type = ? AND subject_id = ?').run('user', userId);
      // 配额账本与改密凭证没有外键约束，不显式清理会残留孤儿行
      this.db!.prepare('DELETE FROM quota_ledger WHERE user_id = ?').run(userId);
      this.db!.prepare('DELETE FROM auth_challenges WHERE subject_id = ?').run(userId);
      return this.db!.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0;
    });
    return tx();
  }

  public upgradeUserMembership(userId: string, tier: MembershipTier): UserProfile | undefined {
    const user = this.getUserById(userId);
    if (!user) return undefined;
    user.membershipTier = tier;
    user.membershipExpiresAt = membershipExpiryAfterRenewal(user.membershipExpiresAt, tier);
    user.role = 'member';
    user.dailyMaxChats = tierDailyLimit(this.getLLMConfig(), tier);
    return this.saveUser(user);
  }

  private refreshUserDailyQuota(user: UserProfile): UserProfile {
    if (!this.db) return user;
    const today = getTodayString();
    const currentMonth = getCurrentMonthString();
    let modified = false;
    if (user.membershipExpiresAt && user.membershipTier && user.membershipTier !== 'free_member') {
      const expDate = new Date(user.membershipExpiresAt);
      if (!isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) {
        user.membershipTier = 'free_member';
        user.dailyMaxChats = this.getLLMConfig().dailyLimits?.freeMember ?? 10;
        user.dailyUsedCount = 0;
        user.lastActiveDate = today;
        user.lastActiveMonth = currentMonth;
        modified = true;
      }
    }
    const isPaid = user.membershipTier === 'monthly_member' || user.membershipTier === 'quarterly_member' || user.membershipTier === 'yearly_member';
    const periodChanged = isPaid
      ? user.lastActiveMonth !== currentMonth
      : user.lastActiveDate !== today;
    if (periodChanged) {
      user.lastActiveDate = today;
      user.lastActiveMonth = currentMonth;
      user.dailyUsedCount = 0;
      modified = true;
    }
    if (modified) {
      this.db.prepare('UPDATE users SET membership_tier = ?, daily_max_chats = ?, daily_used_count = ?, last_active_date = ?, last_active_month = ?, updated_at = ? WHERE id = ?')
        .run(user.membershipTier, user.dailyMaxChats || 10, user.dailyUsedCount || 0, user.lastActiveDate, user.lastActiveMonth, new Date().toISOString(), user.id);
    }
    return user;
  }
  private mapSkillRow(obj: any): Skill {
    return {
      id: obj.id,
      title: obj.title,
      author: obj.author,
      description: obj.description || '',
      category: obj.category,
      coverUrl: obj.cover_url,
      tags: typeof obj.tags === 'string' ? JSON.parse(obj.tags || '[]') : obj.tags,
      systemPrompt: obj.system_prompt || '',
      sampleQuestions: typeof obj.sample_questions === 'string' ? JSON.parse(obj.sample_questions || '[]') : obj.sample_questions,
      chatCount: obj.chat_count,
      searchCount: obj.search_count,
      skillType: obj.skill_type === 'mentor' ? 'mentor' : 'book',
    };
  }

  public getSkills(): Skill[] {
    if (!this.db) return [...INITIAL_SKILLS, ...INITIAL_MENTORS];
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY search_count DESC, id ASC').all() as any[];
    return rows.length ? rows.map((row) => this.mapSkillRow(row)) : [...INITIAL_SKILLS, ...INITIAL_MENTORS];
  }

  public getSkillById(id: string): Skill | undefined {
    if (!this.db) return [...INITIAL_SKILLS, ...INITIAL_MENTORS].find((skill) => skill.id === id);
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as any;
    return row ? this.mapSkillRow(row) : undefined;
  }

  public incrementSkillSearchCount(id: string): void {
    this.db?.prepare('UPDATE skills SET search_count = search_count + 1 WHERE id = ?').run(id);
  }

  public saveSkill(skill: Skill): Skill {
    if (!this.db) return skill;
    this.db.prepare(
      `INSERT INTO skills (id, title, author, description, category, cover_url, tags, system_prompt, sample_questions, chat_count, search_count, skill_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, author=excluded.author, description=excluded.description,
       category=excluded.category, cover_url=excluded.cover_url, tags=excluded.tags, system_prompt=excluded.system_prompt,
       sample_questions=excluded.sample_questions, chat_count=excluded.chat_count,
       search_count=excluded.search_count, skill_type=excluded.skill_type`
    ).run(
      skill.id, skill.title, skill.author, skill.description || '', skill.category, skill.coverUrl,
      JSON.stringify(skill.tags || []), skill.systemPrompt || '', JSON.stringify(skill.sampleQuestions || []),
      skill.chatCount || 0, skill.searchCount || 0, skill.skillType || 'book'
    );
    return skill;
  }

  public deleteSkill(id: string): boolean {
    if (!this.db) return false;
    return this.db.prepare('DELETE FROM skills WHERE id = ?').run(id).changes > 0;
  }

  public getTags(): string[] {
    if (!this.db) return ['商业投资', '个人成长', '哲学心理', '经典策略'];
    const row = this.db.prepare("SELECT value FROM system_config WHERE key = 'tags'").get() as any;
    if (row?.value) {
      try { return JSON.parse(row.value); } catch {}
    }
    return ['商业投资', '个人成长', '哲学心理', '经典策略'];
  }

  public saveTags(tags: string[]): string[] {
    const clean = Array.from(new Set(tags.filter((tag) => typeof tag === 'string' && tag.trim()))).slice(0, 50);
    this.db?.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('tags', ?)").run(JSON.stringify(clean));
    return clean;
  }

  public getLLMConfig(): LLMConfig {
    const fallback = sanitizeLLMConfigForStorage(DEFAULT_LLM_CONFIG);
    if (!this.db) return fallback;
    const row = this.db.prepare("SELECT value FROM system_config WHERE key = 'llm_config'").get() as any;
    if (!row?.value) return fallback;
    try {
      const stored = JSON.parse(row.value) as LLMConfig;
      const encrypted = stored.apiKey || stored.deepseekApiKey || '';
      return {
        ...stored,
        apiKey: encrypted ? decryptSecret(encrypted) : '',
        deepseekApiKey: '',
        apiKeyConfigured: Boolean(encrypted),
        dailyLimits: stored.dailyLimits ? {
          freeMember: stored.dailyLimits.freeMember,
          monthlyMember: stored.dailyLimits.monthlyMember,
          quarterlyMember: stored.dailyLimits.quarterlyMember,
          yearlyMember: stored.dailyLimits.yearlyMember,
        } : fallback.dailyLimits,
      };
    } catch (err) {
      console.warn('LLM 配置读取失败:', err);
      return fallback;
    }
  }

  public getAdminLLMConfigView(): LLMConfig {
    const config = this.getLLMConfig();
    return { ...config, apiKey: undefined, apiKeyConfigured: Boolean(config.apiKey) };
  }

  public saveLLMConfig(config: LLMConfig, apiKey?: string | null): LLMConfig {
    if (!this.db) return config;
    const current = this.getLLMConfig();
    const next = sanitizeLLMConfigForStorage({ ...current, ...config });
    const key = apiKey === undefined ? current.apiKey : apiKey;
    next.apiKey = key ? encryptSecret(key) : '';
    next.deepseekApiKey = '';
    delete next.apiKeyConfigured;
    this.db.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('llm_config', ?)").run(JSON.stringify(next));
    return this.getLLMConfig();
  }

  public getChatSessions(userId?: string): ChatSession[] {
    if (!this.db) return [];
    const rows = (userId
      ? this.db.prepare('SELECT * FROM chat_sessions WHERE user_id = ? ORDER BY updated_at DESC').all(userId)
      : this.db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC').all()) as any[];
    return rows.map((obj) => ({
      id: obj.id,
      userId: obj.user_id,
      skillId: obj.skill_id,
      skillTitle: obj.skill_title || '',
      skillAuthor: obj.skill_author || '',
      skillCoverUrl: obj.skill_cover_url || '',
      messages: typeof obj.messages === 'string' ? JSON.parse(obj.messages || '[]') : obj.messages,
      createdAt: obj.created_at,
      updatedAt: obj.updated_at,
    }));
  }

  public getChatSessionById(id: string, userId?: string): ChatSession | undefined {
    if (!this.db) return undefined;
    const query = userId ? 'SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?' : 'SELECT * FROM chat_sessions WHERE id = ?';
    const obj = (userId ? this.db.prepare(query).get(id, userId) : this.db.prepare(query).get(id)) as any;
    if (!obj) return undefined;
    return {
      id: obj.id,
      userId: obj.user_id,
      skillId: obj.skill_id,
      skillTitle: obj.skill_title || '',
      skillAuthor: obj.skill_author || '',
      skillCoverUrl: obj.skill_cover_url || '',
      messages: typeof obj.messages === 'string' ? JSON.parse(obj.messages || '[]') : obj.messages,
      createdAt: obj.created_at,
      updatedAt: obj.updated_at,
    };
  }

  public saveChatSession(session: ChatSession): ChatSession {
    if (!this.db) return session;
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO chat_sessions (id, user_id, skill_id, skill_title, skill_author, skill_cover_url, messages, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET skill_id=excluded.skill_id, skill_title=excluded.skill_title,
       skill_author=excluded.skill_author, skill_cover_url=excluded.skill_cover_url,
       messages=excluded.messages, updated_at=excluded.updated_at`
    ).run(session.id, session.userId || '', session.skillId, session.skillTitle || '', session.skillAuthor || '', session.skillCoverUrl || '', JSON.stringify(session.messages || []), session.createdAt || now, session.updatedAt || now);
    return session;
  }

  public deleteChatSession(sessionId: string, userId: string): boolean {
    if (!this.db) return false;
    return this.db.prepare('DELETE FROM chat_sessions WHERE id = ? AND user_id = ?').run(sessionId, userId).changes > 0;
  }

  public createAuthSession(record: Omit<AuthSessionRecord, 'id' | 'createdAt' | 'lastSeenAt'>): AuthSessionRecord {
    if (!this.db) throw new Error('数据库未初始化');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const created: AuthSessionRecord = { id, ...record, createdAt: now, lastSeenAt: now };
    this.db.prepare(
      `INSERT INTO auth_sessions (id, token_hash, subject_type, subject_id, role, csrf_hash, auth_version, expires_at, last_seen_at, created_at, revoked_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(id, record.tokenHash, record.subjectType, record.subjectId, record.role, record.csrfHash, record.authVersion || null, record.expiresAt, now, now, record.ip || null, record.userAgent || null);
    return created;
  }

  public getAuthSessionByTokenHash(tokenHash: string): AuthSessionRecord | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL').get(tokenHash) as any;
    return row ? this.mapAuthSessionRow(row) : undefined;
  }

  public touchAuthSession(id: string, expiresAt: string): void {
    this.db?.prepare('UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(new Date().toISOString(), expiresAt, id);
  }

  public revokeAuthSession(id: string): void {
    this.db?.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  public revokeUserSessions(userId: string): void {
    this.db?.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE subject_type = ? AND subject_id = ?').run(new Date().toISOString(), 'user', userId);
  }

  public revokeAdminSessions(): void {
    this.db?.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE subject_type = ?').run(new Date().toISOString(), 'admin');
  }

  public deleteExpiredAuthSessions(): void {
    if (!this.db) return;
    const now = new Date().toISOString();
    this.db.prepare('DELETE FROM auth_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').run(now, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    this.db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(now);
  }

  private mapAuthSessionRow(row: any): AuthSessionRecord {
    return {
      id: row.id,
      tokenHash: row.token_hash,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      role: row.role,
      csrfHash: row.csrf_hash,
      authVersion: row.auth_version || undefined,
      expiresAt: row.expires_at,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      revokedAt: row.revoked_at || undefined,
      ip: row.ip || undefined,
      userAgent: row.user_agent || undefined,
    };
  }

  public createAuthChallenge(record: { tokenHash: string; type: string; subjectId: string; payload?: string; expiresAt: string }): string {
    if (!this.db) throw new Error('数据库未初始化');
    const id = crypto.randomUUID();
    this.db.prepare('INSERT INTO auth_challenges (id, token_hash, type, subject_id, payload, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, record.tokenHash, record.type, record.subjectId, record.payload || '{}', record.expiresAt, new Date().toISOString());
    return id;
  }

  public getAuthChallengeByTokenHash(tokenHash: string, type: string): { id: string; tokenHash: string; type: string; subjectId: string; payload: string; expiresAt: string; usedAt?: string } | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare('SELECT * FROM auth_challenges WHERE token_hash = ? AND type = ?').get(tokenHash, type) as any;
    if (!row) return undefined;
    return { id: row.id, tokenHash: row.token_hash, type: row.type, subjectId: row.subject_id, payload: row.payload || '{}', expiresAt: row.expires_at, usedAt: row.used_at || undefined };
  }

  public markAuthChallengeUsed(id: string): void {
    this.db?.prepare('UPDATE auth_challenges SET used_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  public getAdminSecurity(): AdminSecurityRecord | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare("SELECT * FROM admin_security WHERE id = 'primary'").get() as any;
    if (!row) return undefined;
    return {
      id: row.id,
      totpSecretEnc: row.totp_secret_enc || undefined,
      totpEnabled: Boolean(row.totp_enabled),
      recoveryCodeHashes: JSON.parse(row.recovery_code_hashes || '[]'),
      pendingSecretEnc: row.pending_secret_enc || undefined,
      pendingRecoveryHashes: JSON.parse(row.pending_recovery_hashes || '[]'),
      authVersion: row.auth_version || undefined,
      updatedAt: row.updated_at,
    };
  }

  public saveAdminSecurity(record: AdminSecurityRecord): void {
    this.db?.prepare(
      `INSERT INTO admin_security (id, totp_secret_enc, totp_enabled, recovery_code_hashes, pending_secret_enc, pending_recovery_hashes, auth_version, updated_at)
       VALUES ('primary', ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET totp_secret_enc=excluded.totp_secret_enc, totp_enabled=excluded.totp_enabled,
       recovery_code_hashes=excluded.recovery_code_hashes, pending_secret_enc=excluded.pending_secret_enc,
       pending_recovery_hashes=excluded.pending_recovery_hashes, auth_version=excluded.auth_version, updated_at=excluded.updated_at`
    ).run(record.totpSecretEnc || null, record.totpEnabled ? 1 : 0, JSON.stringify(record.recoveryCodeHashes || []), record.pendingSecretEnc || null, JSON.stringify(record.pendingRecoveryHashes || []), record.authVersion || null, record.updatedAt);
  }

  public audit(entry: { actorType: string; actorId?: string; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown>; ip?: string; userAgent?: string }): void {
    this.db?.prepare('INSERT INTO audit_logs (id, actor_type, actor_id, action, target_type, target_id, metadata, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(crypto.randomUUID(), entry.actorType, entry.actorId || null, entry.action, entry.targetType || null, entry.targetId || null, JSON.stringify(entry.metadata || {}), entry.ip || null, entry.userAgent || null, new Date().toISOString());
  }

  public reserveQuota(userId: string, limit: number, requestId: string): { allowed: boolean; ledgerId?: string } {
    if (!this.db) return { allowed: false };
    const tx = this.db.transaction(() => {
      const user = this.getUserById(userId);
      if (!user) return { allowed: false };
      const used = user.dailyUsedCount || 0;
      if (used >= limit) return { allowed: false };
      const id = crypto.randomUUID();
      this.db!.prepare('UPDATE users SET daily_used_count = daily_used_count + 1, last_active_date = ?, last_active_month = ?, updated_at = ? WHERE id = ?').run(getTodayString(), getCurrentMonthString(), new Date().toISOString(), userId);
      this.db!.prepare('INSERT INTO quota_ledger (id, user_id, request_id, period_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, userId, requestId, user.membershipTier === 'free_member' ? getTodayString() : getCurrentMonthString(), 'reserved', new Date().toISOString());
      return { allowed: true, ledgerId: id };
    });
    return tx();
  }

  public settleQuota(ledgerId: string, status: 'consumed' | 'refunded'): void {
    if (!this.db) return;
    const tx = this.db.transaction(() => {
      const row = this.db!.prepare('SELECT user_id, status, period_key FROM quota_ledger WHERE id = ?').get(ledgerId) as any;
      if (!row || row.status !== 'reserved') return;
      if (status === 'refunded') {
        // 只在账本仍属于当前计费周期时才回退计数：跨日/跨月时计数已被新周期重置，
        // 此时再减会把新周期刚用掉的一次抹掉（等于用户少扣一次额度）。
        const user = this.getUserById(row.user_id);
        const currentPeriod = user && getEffectiveMembershipTier(user) === 'free_member' ? getTodayString() : getCurrentMonthString();
        if (row.period_key === currentPeriod) {
          this.db!.prepare('UPDATE users SET daily_used_count = MAX(0, daily_used_count - 1), updated_at = ? WHERE id = ?').run(new Date().toISOString(), row.user_id);
        }
      }
      this.db!.prepare('UPDATE quota_ledger SET status = ?, settled_at = ? WHERE id = ?').run(status, new Date().toISOString(), ledgerId);
    });
    tx();
  }

  public getOrders(userId?: string): OrderLog[] {
    if (!this.db) return [];
    let query = 'SELECT * FROM orders';
    const params: any[] = [];
    if (userId) { query += ' WHERE user_id = ?'; params.push(userId); }
    query += ' ORDER BY created_at DESC';
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((row) => ({
      id: row.id, tradeNo: row.trade_no, userId: row.user_id,
      skillId: row.skill_id || undefined, skillTitle: row.skill_title || undefined, planType: row.plan_type || 'monthly',
      planName: row.plan_name || '月度会员', amount: Number(row.amount), type: row.type || 'membership',
      paymentMethod: row.payment_method || 'wechat', status: row.status || 'pending', paidAt: row.paid_at || undefined,
      createdAt: row.created_at,
    }));
  }

  public clearAllOrders(): void {
    this.db?.prepare('DELETE FROM orders').run();
  }

  // 后台统计只需要「条数」与「按天分布」，不需要消息正文。
  // 原实现把全部会话连同每条消息 JSON.parse 进 JS 再遍历，成本随历史线性增长
  // （500 用户 / 6 万条消息实测约 366ms，而后台面板每 30 秒轮询一次）。
  // 这里改用 SQLite 的 JSON 函数在原地聚合，消息正文不再进入 JS 堆。
  public getChatStatsSummary(): {
    totalSessions: number;
    todaySessions: number;
    totalMessages: number;
    todayMessages: number;
    dailyMessages: { date: string; count: number }[];
  } {
    const today = getTodayString();
    const days = lastNDays(14);
    const dayCounts = new Map<string, number>();
    if (!this.db) return { totalSessions: 0, todaySessions: 0, totalMessages: 0, todayMessages: 0, dailyMessages: days.map((date) => ({ date, count: 0 })) };

    const count = (sql: string, ...params: unknown[]): number => Number((this.db!.prepare(sql).get(...(params as any[])) as any)?.c || 0);

    const totalSessions = count('SELECT COUNT(*) AS c FROM chat_sessions');
    const todaySessions = count("SELECT COUNT(*) AS c FROM chat_sessions WHERE date(created_at, 'localtime') = ?", today);
    const totalMessages = count('SELECT COALESCE(SUM(json_array_length(messages)), 0) AS c FROM chat_sessions WHERE json_valid(messages)');

    // json_valid 兜底：messages 若不是合法 JSON 数组，json_each 会直接抛错；损坏的行按空数组处理。
    const rows = this.db.prepare(
      `SELECT date(json_extract(m.value, '$.timestamp'), 'localtime') AS day, COUNT(*) AS c
       FROM chat_sessions s, json_each(CASE WHEN json_valid(s.messages) THEN s.messages ELSE '[]' END) m
       GROUP BY day`
    ).all() as any[];
    let todayMessages = 0;
    for (const row of rows) {
      if (!row.day) continue;
      if (row.day === today) todayMessages = Number(row.c);
      dayCounts.set(row.day, Number(row.c));
    }

    return {
      totalSessions,
      todaySessions,
      totalMessages,
      todayMessages,
      dailyMessages: days.map((date) => ({ date, count: dayCounts.get(date) || 0 })),
    };
  }

  public getAdminStats() {
    const users = this.getUsers();
    const skills = this.getSkills();
    const orders = this.getOrders();
    const chatStats = this.getChatStatsSummary();
    const totalRevenue = orders.filter((order) => order.status === 'success').reduce((sum, order) => sum + (Number(order.amount) || 0), 0);
    const tierCounts = { free_member: 0, monthly_member: 0, quarterly_member: 0, yearly_member: 0 } as Record<string, number>;
    let activeVipUsers = 0;
    const today = getTodayString();
    let todayActiveUsers = 0;
    const days = lastNDays(14);
    const dayIndex = new Map(days.map((day, index) => [day, index]));
    const dailyNewUsers = days.map((date) => ({ date, count: 0 }));
    const dailyMessages = days.map((date) => ({ date, count: 0 }));
    let newUsersToday = 0;
    let newUsers7d = 0;
    let activeUsers7d = 0;
    let activeUsers30d = 0;
    const cutoff7d = localDateNDaysAgo(6);
    const cutoff30d = localDateNDaysAgo(29);
    let totalMessages = 0;
    let todaySessions = 0;
    let todayMessages = 0;

    users.forEach((user) => {
      const tier = getEffectiveMembershipTier(user);
      tierCounts[tier] = (tierCounts[tier] || 0) + 1;
      if (tier !== 'free_member') activeVipUsers++;
      if (user.lastActiveDate === today) todayActiveUsers++;
      if (user.lastActiveDate && user.lastActiveDate >= cutoff7d) activeUsers7d++;
      if (user.lastActiveDate && user.lastActiveDate >= cutoff30d) activeUsers30d++;
      const createdDate = toLocalDateString(user.createdAt);
      if (createdDate) {
        if (createdDate === today) newUsersToday++;
        if (createdDate >= cutoff7d) newUsers7d++;
        const index = dayIndex.get(createdDate);
        if (index !== undefined) dailyNewUsers[index].count++;
      }
    });

    totalMessages = chatStats.totalMessages;
    todaySessions = chatStats.todaySessions;
    todayMessages = chatStats.todayMessages;
    chatStats.dailyMessages.forEach((entry, index) => {
      dailyMessages[index].count = entry.count;
    });

    return {
      totalUsers: users.length,
      activeVipUsers,
      todayActiveUsers,
      newUsersToday,
      newUsers7d,
      activeUsers7d,
      activeUsers30d,
      dailyNewUsers,
      dailyMessages,
      tierCounts,
      totalSkills: skills.length,
      topSkills: [...skills].sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0)).slice(0, 5).map((skill) => ({ id: skill.id, title: skill.title, searchCount: skill.searchCount || 0 })),
      totalOrders: orders.length,
      totalPaidOrders: orders.filter((order) => order.status === 'success').length,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalChatSessions: chatStats.totalSessions,
      todaySessions,
      totalMessages,
      todayMessages,
      databaseType: 'SQLite (better-sqlite3, WAL)',
      storagePath: SQLITE_DB_PATH,
    };
  }
}

export const db = new CommercialSQLDatabase();