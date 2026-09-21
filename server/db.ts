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

// 分类标签的数量上限。超出必须由调用方显式拒绝而不是静默截断：被丢掉的标签下所有书籍
// 会被回落到第一个分类，静默截断等于一次没有任何提示的批量改分类。
export const MAX_TAGS = 50;

// 标签接口的入参来自 JSON，形状不受类型系统约束，必须显式收窄。
// renamedMap 用 Map 承载而非普通对象：对象取值会走原型链，标签名若为 constructor、
// toString 之类，`renamedMap[标签名]` 会命中 Object.prototype 上的成员并被当成真值，
// 于是这个标签被替换成一个函数，随后又被判定为「不在标签列表里」而回落——改名结果错误且无报错。
function toRenamedMap(input: unknown): Map<string, string> {
  const renamed = new Map<string, string>();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return renamed;
  // 用 Object.entries 只取自有可枚举属性，不碰原型链。
  for (const [from, to] of Object.entries(input as Record<string, unknown>)) {
    if (typeof to === 'string') renamed.set(from, to);
  }
  return renamed;
}

function toTagList(input: unknown): string[] {
  return Array.isArray(input) ? input.filter((tag): tag is string => typeof tag === 'string') : [];
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
      // 旧版结构（users 表存在但没有 status 列）整体改名让位，随后由下方统一的建表流程重建。
      // 三步改名与写入 version 1 必须同属一个事务：迁移的判定条件正是它自己要破坏的那个状态
      // （users 一改名就不存在了），若在改名与打标记之间中断，下一次启动会因为「没有旧版 users」
      // 而跳过整段迁移，留下仍是旧结构的 chat_sessions / orders，此后每次启动都在结构校验处
      // 抛错且无法自愈。放进事务后，中断只会整体回滚，下一次启动重新完整地做一遍。
      const migrateLegacySchema = this.db.transaction(() => {
        if (this.tableExists('users') && !this.columnExists('users', 'status')) {
          this.renameLegacyTableIfNeeded('users');
          this.renameLegacyTableIfNeeded('chat_sessions');
          this.renameLegacyTableIfNeeded('orders');
        }
        this.db!.prepare('INSERT OR IGNORE INTO schema_migrations (version) VALUES (1)').run();
      });
      migrateLegacySchema();
    }
    // 建表、补列、建索引都是幂等操作，必须每次启动都跑一遍。
    // 此前这三步只在「首次创建 schema_migrations」时执行一次，已存在的库永远拿不到后来新增的
    // 表与列，而且不报任何错——要等到某条 SQL 真正引用到缺失的列，才会在运行时以
    // 「no such column」炸开，此时已很难回溯是哪次改动漏了同步。
    this.createTables();
    this.ensureColumns();
    this.createIndices();
  }

  // 建表语句声明了「结构应该长什么样」，但已存在的库不会再执行它（CREATE TABLE IF NOT EXISTS
  // 对已存在的表是空操作），而 SQLite 的 ALTER TABLE ADD COLUMN 又有硬性限制：
  // 不能加「NOT NULL 且无默认值」的列，也不能加默认值为表达式（如 datetime('now')）的列——
  // 这两条恰好是本库最常用的写法，所以补列无法全自动，必须由开发者显式给出 DDL。
  // 这里因此做两件事：先应用下方登记的新增列，再校验基线声明而真实库缺失的列有无遗漏，
  // 有遗漏就启动即失败——把过去「静默缺列、直到运行时才报 no such column」提前到启动期暴露。
  private ensureColumns(): void {
    if (!this.db) return;
    // 新增列登记在此：改结构时在基线建表语句与这里各写一次。第三项是完整的列定义；
    // 若目标列带表达式默认值或 NOT NULL，需先加可空列、再 UPDATE 回填（ALTER TABLE 无法一步到位）。
    const addedColumns: [table: string, column: string, definition: string][] = [];
    for (const [table, column, definition] of addedColumns) {
      if (this.columnExists(table, column)) continue;
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`✅ 已为 ${table} 补加缺失列：${column}`);
    }

    const missing = this.checkSchemaDrift();
    if (!missing.length) return;
    // 正常的旧版迁移是原子的，不会留下新旧混杂的结构。若库里已经有 users_legacy_v1 却仍然缺列，
    // 那多半是更早版本半迁移留下的残留——那种情况补 addedColumns 只会掩盖问题，必须人工处理。
    const legacyHint = this.tableExists('users_legacy_v1')
      ? '\n注意：本库已存在 users_legacy_v1（旧版结构改过名的痕迹），缺列可能是旧版迁移中断留下的新旧混杂结构。\n'
        + '      这种情况补 addedColumns 解决不了，需要人工确认后把仍是旧结构的表改名或重建。'
      : '';
    throw new Error(
      '数据库结构同步失败：以下列在建表语句中声明、但真实库中并不存在，且未登记到 ensureColumns 的 addedColumns：\n'
      + missing.map(({ table, column }) => `  - ${table}.${column}`).join('\n')
      + '\n请补进 addedColumns（带表达式默认值或 NOT NULL 的列需先加可空列再回填）。'
      + legacyHint
    );
  }

  // 把建表语句在一个内存库里还原成「期望结构」，与真实库逐列比对。
  // 只有「缺列」是致命的并交回调用方；「多列」与「类型不一致」仅告警——
  // 真实库可能带着已下线功能留下的历史列，把多列当成致命错误会让这些库直接起不来，
  // 而类型靠 ALTER TABLE 也改不动。索引不在此列：createIndices 用的是
  // CREATE INDEX IF NOT EXISTS，缺索引每次启动都会自动补上。
  private checkSchemaDrift(): { table: string; column: string }[] {
    const missing: { table: string; column: string }[] = [];
    if (!this.db) return missing;
    const expected = new Database(':memory:');
    try {
      expected.exec(CommercialSQLDatabase.SCHEMA_DDL);
      const tables = expected.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
      for (const { name } of tables) {
        if (!this.tableExists(name)) continue;
        const expectedColumns = expected.pragma(`table_info(${name})`) as { name: string; type: string }[];
        const actualColumns = this.db.pragma(`table_info(${name})`) as { name: string; type: string }[];
        const expectedNames = new Set(expectedColumns.map((column) => column.name));
        for (const column of expectedColumns) {
          const actual = actualColumns.find((item) => item.name === column.name);
          if (!actual) {
            missing.push({ table: name, column: column.name });
          } else if (actual.type.toUpperCase() !== column.type.toUpperCase()) {
            console.warn(`⚠️ ${name}.${column.name} 在库中类型为 ${actual.type || '(未声明)'}，建表语句声明的是 ${column.type || '(未声明)'}；ALTER TABLE 改不动类型，如需对齐请手写迁移`);
          }
        }
        const extra = actualColumns.filter((column) => !expectedNames.has(column.name));
        if (extra.length) {
          console.warn(`⚠️ ${name} 存在建表语句未声明的列：${extra.map((column) => column.name).join('、')}（历史遗留，如已确认无用请手写迁移删除）`);
        }
      }
    } finally {
      expected.close();
    }
    return missing;
  }

  private createTables(): void {
    if (this.db) this.db.exec(CommercialSQLDatabase.SCHEMA_DDL);
  }

  // 建表语句是数据库结构的唯一权威定义：既用它建表，也用它在一个内存库里还原出「期望结构」，
  // 再与真实库逐列比对补齐（见 ensureColumns）。因此新增表或列只需要改这一处，
  // 不必再维护第二份清单，也就不会出现「改了建表语句、老库却没同步」的遗漏。
  private static readonly SCHEMA_DDL = `
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
`;

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
      -- deleteUser 事务里按 subject_id 清挑战，缺这个索引会全表扫描。
      -- 注意 auth_challenges 没有 subject_type 列（那是 auth_sessions 才有的），
      -- 挑战的类型存在 type 列里，这里不能照抄 auth_sessions 的复合索引。
      CREATE INDEX IF NOT EXISTS idx_auth_challenges_subject ON auth_challenges(subject_id);
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

  // 只返回库中真实存在的技能行，不含种子兜底。写操作必须走这个入口：
  // getSkills() 的种子兜底是给「前台无数据时也能看到目录」用的只读便利，
  // 一旦拿它去做 upsert，读的语义就悄悄变成了写。
  private getPersistedSkills(): Skill[] {
    if (!this.db) return [];
    const rows = this.db.prepare('SELECT * FROM skills ORDER BY search_count DESC, id ASC').all() as any[];
    return rows.map((row) => this.mapSkillRow(row));
  }

  public getSkills(): Skill[] {
    const skills = this.getPersistedSkills();
    return skills.length ? skills : [...INITIAL_SKILLS, ...INITIAL_MENTORS];
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

  // 标签是全平台的分类主键，每个技能都必须落在恰好一个分类上。
  // 改名与删除会级联重写所有技能的 category 与 tags，因此必须整批成功或整批不生效——
  // 中途失败留下半改状态，前台就会出现「一部分书在新分类、一部分还在旧分类」的错位。
  public replaceTags(input: { tags: string[]; renamedMap?: Record<string, string>; deletedTags?: string[] }): { savedTags: string[]; affectedSkills: number } {
    if (!this.db) return { savedTags: [], affectedSkills: 0 };
    const savedTags = this.cleanTags(input.tags);
    // 空列表直接返回、不落库：下方每个技能的 category 都要回落到 savedTags[0]，
    // 没有可回落的值时会被统统写成空串，前台随即多出一个没有名字的分类。
    if (!savedTags.length) return { savedTags, affectedSkills: 0 };
    const renamedMap = toRenamedMap(input.renamedMap);
    const deletedTags = toTagList(input.deletedTags);
    const fallback = savedTags[0];
    const tx = this.db.transaction(() => {
      this.db!.prepare("INSERT OR REPLACE INTO system_config (key, value) VALUES ('tags', ?)").run(JSON.stringify(savedTags));
      let affectedSkills = 0;
      // 只遍历库里真实存在的技能行，不用 getSkills()：后者在 skills 表为空时会回落到种子
      // 数据，而这里的 saveSkill() 会把传进去的对象写回库——一次标签操作就会把种子目录
      // 重新插进数据库，等于凭空复活管理员刚删掉的书籍。
      for (const skill of this.getPersistedSkills()) {
        let changed = false;
        if (skill.category) {
          const renamed = renamedMap.get(skill.category);
          if (renamed) { skill.category = renamed; changed = true; }
          if (deletedTags.includes(skill.category) || !savedTags.includes(skill.category)) { skill.category = fallback; changed = true; }
        } else {
          skill.category = fallback;
          changed = true;
        }
        if (Array.isArray(skill.tags)) {
          let updated = skill.tags.map((tag) => renamedMap.get(tag) || tag);
          updated = updated.filter((tag) => !deletedTags.includes(tag) && savedTags.includes(tag));
          if (!updated.length) updated = [fallback];
          if (JSON.stringify(updated) !== JSON.stringify(skill.tags)) { skill.tags = updated; changed = true; }
        }
        if (changed) { this.saveSkill(skill); affectedSkills++; }
      }
      return affectedSkills;
    });
    return { savedTags, affectedSkills: tx() };
  }

  // 取值本身必须 trim：只判断非空、原样存下的话，`' 商业投资 '` 会成为一个独立于
  // `'商业投资'` 的标签，而下方 cascade 用的 savedTags.includes(category) 是精确匹配，
  // 于是该标签下所有技能会被静默回落到第一个分类。
  private cleanTags(tags: string[]): string[] {
    if (!Array.isArray(tags)) return [];
    const cleaned = tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
    return Array.from(new Set(cleaned));
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
    // 协议正文变更时自动刷新生效日期。此前 updatedAt 只会沿用旧值，
    // 即便改过协议，用户端显示的「生效日期」也永远停在首次写入的那一天。
    const prevAgreements = current.agreements;
    if (next.agreements && (!prevAgreements
      || prevAgreements.userAgreementContent !== next.agreements.userAgreementContent
      || prevAgreements.privacyPolicyContent !== next.agreements.privacyPolicyContent)) {
      next.agreements.updatedAt = getTodayString();
    }
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

  // 后台统计只需要「条数」与「按天分布」，不需要消息正文，这里用 SQLite 的 JSON 函数就地聚合。
  // 注意：交替顺序的配对实测显示这条路径并没有更快（6 万条消息下短消息约慢 10%，长消息持平），
  // 因为它同样必须扫描全部历史。换来的收益是不再把消息正文搬进 JS 堆、损坏数据也不会让接口 500。
  // 真正的提速要在写入时增量计数，而不是换查询写法。仅供 getAdminStats 使用，故为 private。
  private getChatStatsSummary(): {
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
    // 直接复用统计方法按同一天窗算出的序列，不再本地重建一份再按下标覆盖：
    // 两处各自调用 lastNDays(14) 会把「窗口长度与顺序一致」变成一条隐式契约，改一处就会静默错位。
    const dailyMessages = chatStats.dailyMessages;
    let newUsersToday = 0;
    let newUsers7d = 0;
    let activeUsers7d = 0;
    let activeUsers30d = 0;
    const cutoff7d = localDateNDaysAgo(6);
    const cutoff30d = localDateNDaysAgo(29);

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
      todaySessions: chatStats.todaySessions,
      totalMessages: chatStats.totalMessages,
      todayMessages: chatStats.todayMessages,
      databaseType: 'SQLite (better-sqlite3, WAL)',
      storagePath: SQLITE_DB_PATH,
    };
  }
}

export const db = new CommercialSQLDatabase();