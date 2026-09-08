import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  UserProfile,
  Skill,
  ChatSession,
  OrderLog,
  LLMConfig,
  MembershipTier,
  getEffectiveMembershipTier,
} from '../src/types.js';
import { INITIAL_SKILLS, DEFAULT_LLM_CONFIG } from '../src/data/initialData.js';
import { DATA_DIR } from './config.js';

const SQLITE_DB_PATH = path.join(DATA_DIR, 'commercial.sqlite');

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentMonthString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export class CommercialSQLDatabase {
  private db: Database.Database | null = null;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, 'assets'), { recursive: true });
    fs.mkdirSync(path.join(DATA_DIR, 'backups'), { recursive: true });
    this.db = new Database(SQLITE_DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.createTables();
    this.createIndices();
    this.seedInitialData();
    console.log('✅ Commercial SQLite Engine (better-sqlite3, write-through WAL) at:', SQLITE_DB_PATH);
  }

  public close(): void {
    this.db?.close();
    this.db = null;
  }

  private createTables(): void {
    if (!this.db) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        union_id TEXT UNIQUE,
        phone TEXT UNIQUE,
        password TEXT,
        nickname TEXT NOT NULL,
        avatar TEXT,
        role TEXT NOT NULL DEFAULT 'member',
        membership_tier TEXT NOT NULL DEFAULT 'free_member',
        membership_expires_at TEXT,
        daily_max_chats INTEGER DEFAULT 10,
        daily_used_count INTEGER DEFAULT 0,
        guest_used_count INTEGER DEFAULT 0,
        is_admin INTEGER DEFAULT 0,
        last_active_date TEXT,
        created_at TEXT DEFAULT (datetime('now'))
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
        catalog_content TEXT,
        book_content TEXT,
        token_count INTEGER DEFAULT 12000,
        preferred_model TEXT DEFAULT 'deepseek-chat',
        sample_questions TEXT DEFAULT '[]',
        chat_count INTEGER DEFAULT 0,
        search_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        skill_id TEXT,
        skill_title TEXT,
        skill_author TEXT,
        skill_cover_url TEXT,
        messages TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        trade_no TEXT UNIQUE NOT NULL,
        transaction_id TEXT,
        user_id TEXT,
        union_id TEXT,
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
    `);
  }

  private createIndices(): void {
    if (!this.db) return;
    try {
      this.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
        CREATE INDEX IF NOT EXISTS idx_users_tier ON users(membership_tier);
        CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_date);
        CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
        CREATE INDEX IF NOT EXISTS idx_skills_search ON skills(search_count DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON chat_sessions(user_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_trade_no ON orders(trade_no);
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      `);
    } catch (err) {
      console.warn('Index creation notice:', err);
    }
  }

  private seedInitialData(): void {
    if (!this.db) return;

    const initialTags: string[] = ['商业投资', '个人成长', '哲学心理', '经典策略'];
    const initialConfig: LLMConfig = DEFAULT_LLM_CONFIG;

    // Seed/sync Skills with clean production defaults (0 initial counts)
    for (const s of INITIAL_SKILLS) {
      const existing = this.db.prepare(`SELECT id FROM skills WHERE id = ?`).get(s.id);
      if (!existing) {
        this.db.prepare(
          `INSERT INTO skills (id, title, author, description, category, cover_url, tags, system_prompt, catalog_content, book_content, token_count, preferred_model, sample_questions, chat_count, search_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          s.id,
          s.title,
          s.author,
          s.description || '',
          s.category,
          s.coverUrl,
          JSON.stringify(s.tags || []),
          s.systemPrompt || '',
          s.catalogContent || '',
          s.bookContent || '',
          s.tokenCount || 12000,
          s.preferredModel || 'deepseek-chat',
          JSON.stringify(s.sampleQuestions || []),
          0,
          0
        );
      }
    }

    const tagsRow = this.db.prepare(`SELECT value FROM system_config WHERE key = 'tags'`).get() as any;
    if (!tagsRow) {
      this.db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('tags', ?)`).run(JSON.stringify(initialTags));
    }

    const configRow = this.db.prepare(`SELECT value FROM system_config WHERE key = 'llm_config'`).get() as any;
    if (!configRow) {
      this.db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('llm_config', ?)`).run(JSON.stringify(initialConfig));
    }
  }

  // --- User Operations (Optimized for 1000 users) ---
  public getUsers(): UserProfile[] {
    if (!this.db) return [];
    const rows = this.db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all() as any[];
    return rows.map((row) => this.refreshUserDailyQuota(this.mapUserRowToProfile(row)));
  }

  public getUserById(id: string): UserProfile | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ? OR union_id = ?`).get(id, id) as any;
    return row ? this.refreshUserDailyQuota(this.mapUserRowToProfile(row)) : undefined;
  }

  public getUserByPhone(phone: string): UserProfile | undefined {
    if (!this.db) return undefined;
    const row = this.db.prepare(`SELECT * FROM users WHERE phone = ?`).get(phone) as any;
    return row ? this.refreshUserDailyQuota(this.mapUserRowToProfile(row)) : undefined;
  }

  // 现存 usr_ 顺序 ID 的数字后缀最大值（无顺序 ID 时为 0）：供新用户 ID 按自然顺序分配
  public getMaxUserSerial(): number {
    if (!this.db) return 0;
    const row = this.db
      .prepare(`SELECT COALESCE(MAX(CAST(SUBSTR(id, 5) AS INTEGER)), 0) AS maxSerial FROM users WHERE id GLOB 'usr_[0-9]*'`)
      .get() as any;
    return Number(row?.maxSerial) || 0;
  }

  public saveUser(user: UserProfile): UserProfile {
    if (!this.db) return user;
    this.db.prepare(
      `INSERT OR REPLACE INTO users (id, union_id, phone, password, nickname, avatar, role, membership_tier,
        membership_expires_at, daily_max_chats, daily_used_count, guest_used_count, is_admin, last_active_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      user.id, user.unionId ?? null, user.phone ?? null, user.password ?? null, user.nickname, user.avatar ?? null,
      user.role, user.membershipTier ?? 'free_member', user.membershipExpiresAt ?? null,
      user.dailyMaxChats ?? 10, user.dailyUsedCount ?? 0, user.guestUsedCount ?? 0,
      user.isAdmin || user.role === 'admin' ? 1 : 0, user.lastActiveDate ?? null, user.createdAt ?? null
    );
    return user;
  }

  /**
   * Upgrades a user's membership tier and calculates/extends expiration date
   */
  public upgradeUserMembership(
    userId: string,
    tier: MembershipTier,
    monthsCount: number = 1
  ): UserProfile | undefined {
    const user = this.getUserById(userId);
    if (!user) return undefined;

    let baseDate = new Date();

    // If currently active paid membership, extend from current expiry date
    if (user.membershipExpiresAt) {
      const currentExpiry = new Date(user.membershipExpiresAt);
      if (!isNaN(currentExpiry.getTime()) && currentExpiry.getTime() > baseDate.getTime()) {
        baseDate = currentExpiry;
      }
    }

    let monthsToAdd = monthsCount;
    if (tier === 'quarterly_member') {
      monthsToAdd = 3;
    } else if (tier === 'yearly_member') {
      monthsToAdd = 12;
    } else if (tier === 'monthly_member') {
      monthsToAdd = 1;
    }

    const newExpiry = new Date(baseDate);
    newExpiry.setMonth(newExpiry.getMonth() + monthsToAdd);

    user.membershipTier = tier;
    user.membershipExpiresAt = newExpiry.toISOString();
    user.role = 'member';

    // Update max chats based on tier
    const config = this.getLLMConfig();
    if (tier === 'monthly_member') {
      user.dailyMaxChats = config.dailyLimits?.monthlyMember ?? 100;
    } else if (tier === 'quarterly_member') {
      user.dailyMaxChats = config.dailyLimits?.quarterlyMember ?? 200;
    } else if (tier === 'yearly_member') {
      user.dailyMaxChats = config.dailyLimits?.yearlyMember ?? 500;
    }

    return this.saveUser(user);
  }

  public deleteUser(userId: string): boolean {
    if (!this.db) return false;
    this.db.prepare(`DELETE FROM users WHERE id = ? OR union_id = ?`).run(userId, userId);
    return true;
  }

  public clearAllUsers(): void {
    if (!this.db) return;
    this.db.prepare(`DELETE FROM users`).run();
  }

  // 删除历史管理员行（管理员身份已不入库，凭证走环境变量），返回删除数量
  public removeAdminUsers(): number {
    if (!this.db) return 0;
    return this.db.prepare(`DELETE FROM users WHERE role = 'admin' OR is_admin = 1`).run().changes;
  }

  private mapUserRowToProfile(row: any): UserProfile {
    let tier: MembershipTier = (row.membership_tier as MembershipTier) || 'free_member';
    if (row.role === 'guest') tier = 'guest';

    return {
      id: row.id,
      unionId: row.union_id || undefined,
      phone: row.phone || undefined,
      password: row.password || undefined,
      nickname: row.nickname,
      avatar: row.avatar || undefined,
      role: row.role as any,
      membershipTier: tier,
      membershipExpiresAt: row.membership_expires_at || undefined,
      dailyMaxChats: row.daily_max_chats,
      dailyUsedCount: row.daily_used_count,
      guestUsedCount: row.guest_used_count,
      isAdmin: Boolean(row.is_admin),
      lastActiveDate: row.last_active_date,
      createdAt: row.created_at,
    };
  }

  private refreshUserDailyQuota(user: UserProfile): UserProfile {
    const today = getTodayString();
    const currentMonth = getCurrentMonthString();
    let modified = false;

    // 1. Check if VIP subscription expired
    if (user.membershipExpiresAt && user.membershipTier && user.membershipTier !== 'free_member' && user.membershipTier !== 'guest') {
      const expDate = new Date(user.membershipExpiresAt);
      if (!isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) {
        user.membershipTier = 'free_member';
        const config = this.getLLMConfig();
        user.dailyMaxChats = config.dailyLimits?.freeMember ?? 10;
        modified = true;
      }
    }

    // 2. 配额周期重置：游客/普通会员按日重置（零点刷新），月/季/年度会员按月重置（进入新月份时刷新）
    const isPaidTier =
      user.membershipTier === 'monthly_member' ||
      user.membershipTier === 'quarterly_member' ||
      user.membershipTier === 'yearly_member';
    const periodChanged = isPaidTier
      ? !user.lastActiveDate || !user.lastActiveDate.startsWith(currentMonth)
      : user.lastActiveDate !== today;
    if (periodChanged) {
      user.lastActiveDate = today;
      user.dailyUsedCount = 0;
      user.guestUsedCount = 0;
      modified = true;
    }

    if (modified && this.db) {
      this.db.prepare(
        `UPDATE users SET membership_tier = ?, daily_max_chats = ?, daily_used_count = ?, guest_used_count = ?, last_active_date = ? WHERE id = ?`
      ).run(
        user.membershipTier,
        user.dailyMaxChats || 10,
        user.dailyUsedCount || 0,
        user.guestUsedCount || 0,
        user.lastActiveDate,
        user.id
      );
    }
    return user;
  }

  // --- Skills Operations (SQL-Driven) ---
  public getSkills(): Skill[] {
    if (!this.db) return INITIAL_SKILLS;
    const rows = this.db.prepare(`SELECT * FROM skills ORDER BY search_count DESC, id ASC`).all() as any[];
    if (rows.length === 0) return INITIAL_SKILLS;

    return rows.map((obj) => ({
      id: obj.id,
      title: obj.title,
      author: obj.author,
      description: obj.description || '',
      category: obj.category,
      coverUrl: obj.cover_url,
      tags: typeof obj.tags === 'string' ? JSON.parse(obj.tags || '[]') : obj.tags,
      systemPrompt: obj.system_prompt || '',
      catalogContent: obj.catalog_content || '',
      bookContent: obj.book_content || '',
      tokenCount: obj.token_count,
      preferredModel: obj.preferred_model,
      sampleQuestions: typeof obj.sample_questions === 'string' ? JSON.parse(obj.sample_questions || '[]') : obj.sample_questions,
      chatCount: obj.chat_count,
      searchCount: obj.search_count,
    }));
  }

  public getSkillById(id: string): Skill | undefined {
    return this.getSkills().find((s) => s.id === id);
  }

  public saveSkill(skill: Skill): Skill {
    if (!this.db) return skill;
    this.db.prepare(
      `INSERT OR REPLACE INTO skills (id, title, author, description, category, cover_url, tags, system_prompt, catalog_content, book_content, token_count, preferred_model, sample_questions, chat_count, search_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      skill.id,
      skill.title,
      skill.author,
      skill.description || '',
      skill.category,
      skill.coverUrl,
      JSON.stringify(skill.tags || []),
      skill.systemPrompt || '',
      skill.catalogContent || '',
      skill.bookContent || '',
      skill.tokenCount || 12000,
      skill.preferredModel || 'deepseek-chat',
      JSON.stringify(skill.sampleQuestions || []),
      skill.chatCount || 0,
      skill.searchCount || 0
    );
    return skill;
  }

  public deleteSkill(id: string): boolean {
    if (!this.db) return false;
    this.db.prepare(`DELETE FROM skills WHERE id = ?`).run(id);
    return true;
  }

  // --- Tags & Config Operations (SQL-Driven) ---
  public getTags(): string[] {
    if (!this.db) return ['商业投资', '个人成长', '哲学心理', '经典策略'];
    const row = this.db.prepare(`SELECT value FROM system_config WHERE key = 'tags'`).get() as any;
    if (row) {
      try {
        return JSON.parse(row.value);
      } catch {}
    }
    return ['商业投资', '个人成长', '哲学心理', '经典策略'];
  }

  public saveTags(tags: string[]): string[] {
    if (!this.db) return tags;
    const clean = Array.from(new Set(tags.filter((t) => typeof t === 'string' && t.trim().length > 0)));
    this.db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('tags', ?)`).run(JSON.stringify(clean));
    return clean;
  }

  public getLLMConfig(): LLMConfig {
    if (!this.db) return DEFAULT_LLM_CONFIG;
    const row = this.db.prepare(`SELECT value FROM system_config WHERE key = 'llm_config'`).get() as any;
    if (row) {
      try {
        const parsed = JSON.parse(row.value);
        return { ...DEFAULT_LLM_CONFIG, ...parsed };
      } catch {}
    }
    return DEFAULT_LLM_CONFIG;
  }

  public saveLLMConfig(config: LLMConfig): LLMConfig {
    if (!this.db) return config;
    const current = this.getLLMConfig();
    const merged = { ...current, ...config };
    this.db.prepare(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('llm_config', ?)`).run(JSON.stringify(merged));
    return merged;
  }

  // --- Sessions & Chat Operations (SQL-Driven) ---
  public getChatSessions(userId?: string): ChatSession[] {
    if (!this.db) return [];
    let query = `SELECT * FROM chat_sessions`;
    const params: any[] = [];
    if (userId) {
      query += ` WHERE user_id = ?`;
      params.push(userId);
    }
    query += ` ORDER BY updated_at DESC`;

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((obj) => ({
      id: obj.id as string,
      userId: (obj.user_id as string) || undefined,
      skillId: obj.skill_id as string,
      skillTitle: obj.skill_title as string,
      skillAuthor: obj.skill_author as string,
      skillCoverUrl: (obj.skill_cover_url as string) || undefined,
      messages: typeof obj.messages === 'string' ? JSON.parse(obj.messages || '[]') : obj.messages,
      createdAt: obj.created_at as string,
      updatedAt: obj.updated_at as string,
    }));
  }

  public getChatSessionById(id: string): ChatSession | undefined {
    if (!this.db) return undefined;
    const obj = this.db.prepare(`SELECT * FROM chat_sessions WHERE id = ?`).get(id) as any;
    if (!obj) return undefined;
    return {
      id: obj.id as string,
      userId: (obj.user_id as string) || undefined,
      skillId: obj.skill_id as string,
      skillTitle: obj.skill_title as string,
      skillAuthor: obj.skill_author as string,
      skillCoverUrl: (obj.skill_cover_url as string) || undefined,
      messages: typeof obj.messages === 'string' ? JSON.parse(obj.messages || '[]') : obj.messages,
      createdAt: obj.created_at as string,
      updatedAt: obj.updated_at as string,
    };
  }

  public saveChatSession(session: ChatSession): ChatSession {
    if (!this.db) return session;
    this.db.prepare(
      `INSERT OR REPLACE INTO chat_sessions (id, user_id, skill_id, skill_title, skill_author, skill_cover_url, messages, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      session.id,
      session.userId || '',
      session.skillId,
      session.skillTitle || '',
      session.skillAuthor || '',
      session.skillCoverUrl || '',
      JSON.stringify(session.messages || []),
      session.createdAt || new Date().toISOString(),
      session.updatedAt || new Date().toISOString()
    );
    return session;
  }

  public deleteChatSession(sessionId: string, userId?: string): boolean {
    if (!this.db || !userId) return false;
    this.db.prepare(`DELETE FROM chat_sessions WHERE id = ? AND user_id = ?`).run(sessionId, userId);
    return true;
  }

  // --- Commercial Orders Operations (Membership-driven) ---
  public getOrders(userId?: string): OrderLog[] {
    if (!this.db) return [];
    let query = `SELECT * FROM orders`;
    const params: any[] = [];
    if (userId) {
      query += ` WHERE user_id = ?`;
      params.push(userId);
    }
    query += ` ORDER BY created_at DESC`;

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((obj) => ({
      id: obj.id as string,
      tradeNo: obj.trade_no as string,
      userId: obj.user_id as string,
      unionId: (obj.union_id as string) || undefined,
      skillId: (obj.skill_id as string) || undefined,
      skillTitle: (obj.skill_title as string) || undefined,
      planType: (obj.plan_type as any) || 'monthly',
      planName: (obj.plan_name as string) || '月度会员',
      amount: Number(obj.amount),
      type: (obj.type as any) || 'membership',
      paymentMethod: obj.payment_method as any,
      status: obj.status as any,
      paidAt: (obj.paid_at as string) || undefined,
      createdAt: obj.created_at as string,
    }));
  }

  public clearAllOrders(): void {
    if (!this.db) return;
    this.db.prepare(`DELETE FROM orders`).run();
  }

  // --- Admin Stats (Multi-tier breakdown) ---
  public getAdminStats() {
    const users = this.getUsers();
    const skills = this.getSkills();
    const orders = this.getOrders();
    const sessions = this.getChatSessions();

    const totalRevenue = orders
      .filter((o) => o.status === 'success')
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    const totalPaidOrders = orders.filter((o) => o.status === 'success').length;

    let totalMessages = 0;
    sessions.forEach((s) => {
      totalMessages += (s.messages || []).length;
    });

    const tierCounts = {
      guest: 0,
      free_member: 0,
      monthly_member: 0,
      quarterly_member: 0,
      yearly_member: 0,
    };

    let activeVipUsers = 0;
    const today = getTodayString();
    let todayActiveUsers = 0;

    users.forEach((u) => {
      const tier = getEffectiveMembershipTier(u);
      if (tierCounts[tier] !== undefined) {
        tierCounts[tier]++;
      }
      if (tier === 'monthly_member' || tier === 'quarterly_member' || tier === 'yearly_member') {
        activeVipUsers++;
      }
      if (u.lastActiveDate === today) {
        todayActiveUsers++;
      }
    });

    return {
      totalUsers: users.length,
      activeVipUsers,
      todayActiveUsers,
      tierCounts,
      totalSkills: skills.length,
      totalOrders: orders.length,
      totalPaidOrders,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalChatSessions: sessions.length,
      totalMessages,
      databaseType: 'SQLite (better-sqlite3, WAL)',
      storagePath: SQLITE_DB_PATH,
    };
  }
}

export const db = new CommercialSQLDatabase();
