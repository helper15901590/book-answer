import initSqlJs, { Database } from 'sql.js';
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
} from './types.js';
import { INITIAL_SKILLS, DEFAULT_LLM_CONFIG } from './data/initialData.js';

const SQLITE_DB_PATH = path.join(process.cwd(), 'commercial.sqlite');

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
  private db: Database | null = null;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isInitialized = false;

  constructor() {
    this.initDatabase();
  }

  private async initDatabase(): Promise<void> {
    try {
      const SQL = await initSqlJs();
      if (fs.existsSync(SQLITE_DB_PATH)) {
        try {
          const fileBuffer = fs.readFileSync(SQLITE_DB_PATH);
          this.db = new SQL.Database(fileBuffer);
        } catch (e) {
          console.warn('⚠️ Existing database file load failed, creating fresh database:', e);
          this.db = new SQL.Database();
        }
      } else {
        this.db = new SQL.Database();
      }

      this.createTables();
      this.migrateSchemaIfNeeded();
      this.createIndices();
      this.cleanResidualMockData();
      this.seedInitialData();
      this.isInitialized = true;
      this.persistToDisk();
      console.log('✅ Commercial SQLite Engine (1000-User Tier Architecture) initialized at:', SQLITE_DB_PATH);
    } catch (err) {
      console.error('❌ Failed to initialize SQLite engine:', err);
    }
  }

  private createTables(): void {
    if (!this.db) return;

    this.db.run(`
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
        buyout_used_count INTEGER DEFAULT 0,
        buyout_usage_map TEXT DEFAULT '{}',
        unlocked_skill_ids TEXT DEFAULT '[]',
        is_admin INTEGER DEFAULT 0,
        last_active_date TEXT,
        invited_count INTEGER DEFAULT 0,
        referral_code TEXT,
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
        price_type TEXT DEFAULT 'free_trial',
        buyout_price REAL DEFAULT 19.9,
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

  private migrateSchemaIfNeeded(): void {
    if (!this.db) return;
    try {
      // Check user table columns
      const tableInfo = this.db.exec(`PRAGMA table_info(users)`);
      if (tableInfo.length && tableInfo[0].values) {
        const columnNames = tableInfo[0].values.map((row) => row[1] as string);
        if (!columnNames.includes('membership_tier')) {
          this.db.run(`ALTER TABLE users ADD COLUMN membership_tier TEXT NOT NULL DEFAULT 'free_member'`);
        }
        if (!columnNames.includes('membership_expires_at')) {
          this.db.run(`ALTER TABLE users ADD COLUMN membership_expires_at TEXT`);
        }
        if (!columnNames.includes('union_id')) {
          this.db.run(`ALTER TABLE users ADD COLUMN union_id TEXT`);
        }
        if (!columnNames.includes('phone')) {
          this.db.run(`ALTER TABLE users ADD COLUMN phone TEXT`);
        }
        if (!columnNames.includes('password')) {
          this.db.run(`ALTER TABLE users ADD COLUMN password TEXT`);
        }
        if (!columnNames.includes('buyout_used_count')) {
          this.db.run(`ALTER TABLE users ADD COLUMN buyout_used_count INTEGER DEFAULT 0`);
        }
        if (!columnNames.includes('buyout_usage_map')) {
          this.db.run(`ALTER TABLE users ADD COLUMN buyout_usage_map TEXT DEFAULT '{}'`);
        }
      }

      // Check orders table columns
      const orderTableInfo = this.db.exec(`PRAGMA table_info(orders)`);
      if (orderTableInfo.length && orderTableInfo[0].values) {
        const orderColumns = orderTableInfo[0].values.map((row) => row[1] as string);
        if (!orderColumns.includes('plan_type')) {
          this.db.run(`ALTER TABLE orders ADD COLUMN plan_type TEXT DEFAULT 'monthly'`);
        }
        if (!orderColumns.includes('plan_name')) {
          this.db.run(`ALTER TABLE orders ADD COLUMN plan_name TEXT DEFAULT '月度会员'`);
        }
      }
    } catch (e) {
      console.warn('Schema migration check notice:', e);
    }
  }

  private createIndices(): void {
    if (!this.db) return;
    try {
      this.db.run(`
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

  private cleanResidualMockData(): void {
    if (!this.db) return;
    try {
      // Clean legacy mock users
      this.db.run(`
        DELETE FROM users 
        WHERE phone IN ('13800138921', '55555555555', '66666666666', '77777777777', '99999999999', '11111111111', '33333333333')
           OR id IN ('usr_883921', 'usr_guest_anon')
           OR nickname IN ('商业读者_8921', '55555555555', '66666666666', '77777777777', '99999999999', '11111111111', '33333333333', '1111', '1112', '4444')
      `);
      // Clean invalid test skills and reset fake inflated metrics on initial skills
      this.db.run(`DELETE FROM skills WHERE id = '1' OR title = '1'`);
      this.db.run(`UPDATE skills SET chat_count = 0, search_count = 0 WHERE chat_count > 10000 OR search_count > 10000`);
    } catch (e) {
      console.warn('Mock data cleanup check notice:', e);
    }
  }

  private seedInitialData(): void {
    if (!this.db) return;

    const initialTags: string[] = ['商业投资', '个人成长', '哲学心理', '经典策略'];
    const initialConfig: LLMConfig = DEFAULT_LLM_CONFIG;

    // Seed/sync Skills with clean production defaults (0 initial counts)
    for (const s of INITIAL_SKILLS) {
      const existing = this.db.exec(`SELECT id FROM skills WHERE id = ?`, [s.id]);
      if (!existing || !existing[0]?.values?.length) {
        this.db.run(
          `INSERT INTO skills (id, title, author, description, category, cover_url, tags, price_type, buyout_price, system_prompt, catalog_content, book_content, token_count, preferred_model, sample_questions, chat_count, search_count)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            s.id,
            s.title,
            s.author,
            s.description || '',
            s.category,
            s.coverUrl,
            JSON.stringify(s.tags || []),
            s.priceType || 'free_trial',
            s.buyoutPrice || 19.9,
            s.systemPrompt || '',
            s.catalogContent || '',
            s.bookContent || '',
            s.tokenCount || 12000,
            s.preferredModel || 'deepseek-chat',
            JSON.stringify(s.sampleQuestions || []),
            0,
            0,
          ]
        );
      }
    }

    const tagsRes = this.db.exec(`SELECT value FROM system_config WHERE key = 'tags'`);
    if (!tagsRes || !tagsRes[0]?.values?.length) {
      this.db.run(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('tags', ?)`, [JSON.stringify(initialTags)]);
    }

    const configRes = this.db.exec(`SELECT value FROM system_config WHERE key = 'llm_config'`);
    if (!configRes || !configRes[0]?.values?.length) {
      this.db.run(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('llm_config', ?)`, [JSON.stringify(initialConfig)]);
    }
  }

  private persistToDisk(): void {
    if (!this.db) return;
    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(SQLITE_DB_PATH, buffer);
    } catch (err) {
      console.error('Failed to export SQLite database to disk:', err);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    this.saveTimeout = setTimeout(() => {
      this.persistToDisk();
    }, 100);
  }

  // --- User Operations (Optimized for 1000 users) ---
  public getUsers(): UserProfile[] {
    if (!this.db) return [];
    const res = this.db.exec(`SELECT * FROM users ORDER BY created_at DESC`);
    if (!res.length || !res[0].values.length) return [];

    const columns = res[0].columns;
    const users: UserProfile[] = res[0].values.map((row) => {
      const obj: any = {};
      columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return this.mapUserRowToProfile(obj);
    });

    return users.map((u) => this.refreshUserDailyQuota(u));
  }

  public getUserById(id: string): UserProfile | undefined {
    if (!this.db) return undefined;
    const stmt = this.db.prepare(`SELECT * FROM users WHERE id = ? OR union_id = ? LIMIT 1`);
    stmt.bind([id, id]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.refreshUserDailyQuota(this.mapUserRowToProfile(row));
    }
    stmt.free();
    return undefined;
  }

  public getUserByPhone(phone: string): UserProfile | undefined {
    if (!this.db) return undefined;
    const stmt = this.db.prepare(`SELECT * FROM users WHERE phone = ? LIMIT 1`);
    stmt.bind([phone]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return this.refreshUserDailyQuota(this.mapUserRowToProfile(row));
    }
    stmt.free();
    return undefined;
  }

  public saveUser(user: UserProfile): UserProfile {
    if (!this.db) return user;
    this.refreshUserDailyQuota(user);

    const membershipTier = user.membershipTier || (user.role === 'guest' ? 'guest' : 'free_member');

    this.db.run(
      `INSERT OR REPLACE INTO users (id, union_id, phone, password, nickname, avatar, role, membership_tier, membership_expires_at, daily_max_chats, daily_used_count, guest_used_count, buyout_used_count, buyout_usage_map, unlocked_skill_ids, is_admin, last_active_date, invited_count, referral_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user.id,
        user.unionId || '',
        user.phone || '',
        user.password || '',
        user.nickname,
        user.avatar || '',
        user.role || 'member',
        membershipTier,
        user.membershipExpiresAt || '',
        user.dailyMaxChats || 10,
        user.dailyUsedCount || 0,
        user.guestUsedCount || 0,
        user.buyoutUsedCount || 0,
        JSON.stringify(user.buyoutUsageMap || {}),
        JSON.stringify(user.unlockedSkillIds || []),
        user.isAdmin ? 1 : 0,
        user.lastActiveDate || getTodayString(),
        user.invitedCount || 0,
        user.referralCode || '',
      ]
    );

    this.scheduleSave();
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
    this.db.run(`DELETE FROM users WHERE id = ? OR union_id = ?`, [userId, userId]);
    this.persistToDisk();
    return true;
  }

  public clearAllUsers(): void {
    if (!this.db) return;
    this.db.run(`DELETE FROM users`);
    this.persistToDisk();
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
      buyoutUsedCount: row.buyout_used_count,
      buyoutUsageMap: typeof row.buyout_usage_map === 'string' ? JSON.parse(row.buyout_usage_map || '{}') : row.buyout_usage_map,
      unlockedSkillIds: typeof row.unlocked_skill_ids === 'string' ? JSON.parse(row.unlocked_skill_ids || '[]') : row.unlocked_skill_ids,
      isAdmin: Boolean(row.is_admin),
      lastActiveDate: row.last_active_date,
      invitedCount: row.invited_count,
      referralCode: row.referral_code || undefined,
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

    // 2. Monthly reset (Reset quota when entering a new month)
    if (!user.lastActiveDate || !user.lastActiveDate.startsWith(currentMonth)) {
      user.lastActiveDate = today;
      user.dailyUsedCount = 0;
      user.guestUsedCount = 0;
      user.buyoutUsedCount = 0;
      user.buyoutUsageMap = {};
      modified = true;
    }

    if (modified && this.db) {
      this.db.run(
        `UPDATE users SET membership_tier = ?, daily_max_chats = ?, daily_used_count = ?, guest_used_count = ?, buyout_used_count = ?, buyout_usage_map = ?, last_active_date = ? WHERE id = ?`,
        [
          user.membershipTier,
          user.dailyMaxChats || 10,
          user.dailyUsedCount || 0,
          user.guestUsedCount || 0,
          user.buyoutUsedCount || 0,
          JSON.stringify(user.buyoutUsageMap || {}),
          user.lastActiveDate,
          user.id,
        ]
      );
      this.scheduleSave();
    }
    return user;
  }

  // --- Skills Operations (SQL-Driven) ---
  public getSkills(): Skill[] {
    if (!this.db) return INITIAL_SKILLS;
    const res = this.db.exec(`SELECT * FROM skills ORDER BY search_count DESC, id ASC`);
    if (!res.length || !res[0].values.length) return INITIAL_SKILLS;

    const cols = res[0].columns;
    return res[0].values.map((row) => {
      const obj: any = {};
      cols.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      return {
        id: obj.id,
        title: obj.title,
        author: obj.author,
        description: obj.description || '',
        category: obj.category,
        coverUrl: obj.cover_url,
        tags: typeof obj.tags === 'string' ? JSON.parse(obj.tags || '[]') : obj.tags,
        priceType: obj.price_type || 'free_trial',
        buyoutPrice: obj.buyout_price || 19.9,
        systemPrompt: obj.system_prompt || '',
        catalogContent: obj.catalog_content || '',
        bookContent: obj.book_content || '',
        tokenCount: obj.token_count,
        preferredModel: obj.preferred_model,
        sampleQuestions: typeof obj.sample_questions === 'string' ? JSON.parse(obj.sample_questions || '[]') : obj.sample_questions,
        chatCount: obj.chat_count,
        searchCount: obj.search_count,
      };
    });
  }

  public getSkillById(id: string): Skill | undefined {
    return this.getSkills().find((s) => s.id === id);
  }

  public saveSkill(skill: Skill): Skill {
    if (!this.db) return skill;
    this.db.run(
      `INSERT OR REPLACE INTO skills (id, title, author, description, category, cover_url, tags, price_type, buyout_price, system_prompt, catalog_content, book_content, token_count, preferred_model, sample_questions, chat_count, search_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        skill.id,
        skill.title,
        skill.author,
        skill.description || '',
        skill.category,
        skill.coverUrl,
        JSON.stringify(skill.tags || []),
        skill.priceType || 'free_trial',
        skill.buyoutPrice || 19.9,
        skill.systemPrompt || '',
        skill.catalogContent || '',
        skill.bookContent || '',
        skill.tokenCount || 12000,
        skill.preferredModel || 'deepseek-chat',
        JSON.stringify(skill.sampleQuestions || []),
        skill.chatCount || 0,
        skill.searchCount || 0,
      ]
    );
    this.scheduleSave();
    return skill;
  }

  public deleteSkill(id: string): boolean {
    if (!this.db) return false;
    this.db.run(`DELETE FROM skills WHERE id = ?`, [id]);
    this.scheduleSave();
    return true;
  }

  // --- Tags & Config Operations (SQL-Driven) ---
  public getTags(): string[] {
    if (!this.db) return ['商业投资', '个人成长', '哲学心理', '经典策略'];
    const stmt = this.db.prepare(`SELECT value FROM system_config WHERE key = 'tags' LIMIT 1`);
    if (stmt.step()) {
      const val = stmt.getAsObject().value as string;
      stmt.free();
      try {
        return JSON.parse(val);
      } catch {}
    }
    stmt.free();
    return ['商业投资', '个人成长', '哲学心理', '经典策略'];
  }

  public saveTags(tags: string[]): string[] {
    if (!this.db) return tags;
    const clean = Array.from(new Set(tags.filter((t) => typeof t === 'string' && t.trim().length > 0)));
    this.db.run(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('tags', ?)`, [JSON.stringify(clean)]);
    this.scheduleSave();
    return clean;
  }

  public getLLMConfig(): LLMConfig {
    if (!this.db) return DEFAULT_LLM_CONFIG;
    const stmt = this.db.prepare(`SELECT value FROM system_config WHERE key = 'llm_config' LIMIT 1`);
    if (stmt.step()) {
      const val = stmt.getAsObject().value as string;
      stmt.free();
      try {
        const parsed = JSON.parse(val);
        return { ...DEFAULT_LLM_CONFIG, ...parsed };
      } catch {}
    }
    stmt.free();
    return DEFAULT_LLM_CONFIG;
  }

  public saveLLMConfig(config: LLMConfig): LLMConfig {
    if (!this.db) return config;
    const current = this.getLLMConfig();
    const merged = { ...current, ...config };
    this.db.run(`INSERT OR REPLACE INTO system_config (key, value) VALUES ('llm_config', ?)`, [JSON.stringify(merged)]);
    this.scheduleSave();
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

    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const sessions: ChatSession[] = [];
    while (stmt.step()) {
      const obj = stmt.getAsObject();
      sessions.push({
        id: obj.id as string,
        userId: (obj.user_id as string) || undefined,
        skillId: obj.skill_id as string,
        skillTitle: obj.skill_title as string,
        skillAuthor: obj.skill_author as string,
        skillCoverUrl: (obj.skill_cover_url as string) || undefined,
        messages: typeof obj.messages === 'string' ? JSON.parse(obj.messages || '[]') : obj.messages,
        createdAt: obj.created_at as string,
        updatedAt: obj.updated_at as string,
      });
    }
    stmt.free();
    return sessions;
  }

  public getChatSessionById(id: string): ChatSession | undefined {
    if (!this.db) return undefined;
    const stmt = this.db.prepare(`SELECT * FROM chat_sessions WHERE id = ? LIMIT 1`);
    stmt.bind([id]);
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      stmt.free();
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
    stmt.free();
    return undefined;
  }

  public saveChatSession(session: ChatSession): ChatSession {
    if (!this.db) return session;
    this.db.run(
      `INSERT OR REPLACE INTO chat_sessions (id, user_id, skill_id, skill_title, skill_author, skill_cover_url, messages, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id,
        session.userId || '',
        session.skillId,
        session.skillTitle || '',
        session.skillAuthor || '',
        session.skillCoverUrl || '',
        JSON.stringify(session.messages || []),
        session.createdAt || new Date().toISOString(),
        session.updatedAt || new Date().toISOString(),
      ]
    );
    this.scheduleSave();
    return session;
  }

  public deleteChatSession(sessionId: string, userId?: string): boolean {
    if (!this.db || !userId) return false;
    this.db.run(`DELETE FROM chat_sessions WHERE id = ? AND user_id = ?`, [sessionId, userId]);
    this.scheduleSave();
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

    const stmt = this.db.prepare(query);
    stmt.bind(params);
    const orders: OrderLog[] = [];
    while (stmt.step()) {
      const obj = stmt.getAsObject();
      orders.push({
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
      });
    }
    stmt.free();
    return orders;
  }

  public getOrderByTradeNo(tradeNo: string): OrderLog | undefined {
    if (!this.db) return undefined;
    const stmt = this.db.prepare(`SELECT * FROM orders WHERE trade_no = ? OR id = ? LIMIT 1`);
    stmt.bind([tradeNo, tradeNo]);
    if (stmt.step()) {
      const obj = stmt.getAsObject();
      stmt.free();
      return {
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
      };
    }
    stmt.free();
    return undefined;
  }

  public createOrder(order: OrderLog): OrderLog {
    if (!this.db) return order;
    this.db.run(
      `INSERT OR REPLACE INTO orders (id, trade_no, transaction_id, user_id, union_id, skill_id, skill_title, plan_type, plan_name, amount, type, payment_method, status, paid_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id,
        order.tradeNo,
        '',
        order.userId,
        order.unionId || '',
        order.skillId || '',
        order.skillTitle || '',
        order.planType || 'monthly',
        order.planName || '月度会员',
        order.amount,
        order.type || 'membership',
        order.paymentMethod || 'wechat',
        order.status || 'pending',
        order.paidAt || '',
        order.createdAt || new Date().toISOString(),
      ]
    );
    this.scheduleSave();
    return order;
  }

  public updateOrderStatus(tradeNo: string, status: 'success' | 'failed'): OrderLog | undefined {
    const order = this.getOrderByTradeNo(tradeNo);
    if (!order || !this.db) return undefined;

    order.status = status;
    if (status === 'success') {
      order.paidAt = new Date().toISOString();
      if (order.userId) {
        let tier: MembershipTier = 'monthly_member';
        let months = 1;

        if (order.planType === 'quarterly') {
          tier = 'quarterly_member';
          months = 3;
        } else if (order.planType === 'yearly') {
          tier = 'yearly_member';
          months = 12;
        } else {
          tier = 'monthly_member';
          months = 1;
        }

        this.upgradeUserMembership(order.userId, tier, months);
      }
    }

    this.db.run(
      `UPDATE orders SET status = ?, paid_at = ? WHERE trade_no = ? OR id = ?`,
      [status, order.paidAt || '', tradeNo, tradeNo]
    );
    this.scheduleSave();
    return order;
  }

  public clearAllOrders(): void {
    if (!this.db) return;
    this.db.run(`DELETE FROM orders`);
    this.persistToDisk();
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
      databaseType: 'SQLite (1000-User Enterprise Tier Engine)',
      storagePath: SQLITE_DB_PATH,
    };
  }
}

export const db = new CommercialSQLDatabase();
