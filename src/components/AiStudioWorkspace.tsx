import React, { useState, useEffect, useRef } from 'react';
import {
  Skill,
  UserProfile,
  ChatMessage,
  LLMConfig,
  ChatSession,
  FollowedSkill,
  formatUserDisplayName,
  formatMessageTimestamp,
  getEffectiveMembershipTier,
  tierDailyLimit,
  ALL_CATEGORIES,
} from '../types';
import { apiFetch, tryLogout } from '../lib/apiFetch';
import { copyText } from '../lib/clipboard';
import { useI18n, membershipTierKey, formatBookTitleByLocale, serverMessage } from '../i18n';
import { MarkdownMessage } from './MarkdownMessage';
import { LanguageSwitcher } from './LanguageSwitcher';
import { PlazaView } from './PlazaView';
import { FollowListView } from './FollowListView';
import { FaceToFaceView } from './FaceToFaceView';
import { usePlazaController } from '../lib/usePlazaController';
import { useVoicePlayback } from '../lib/useVoicePlayback';
import {
  Send,
  Book,
  Copy,
  Check,
  X,
  ChevronRight,
  Sparkles,
  LogOut,
  Trash2,
  Plus,
  Loader2,
  Brain,
  Clock,
  User,
  UserX,
  ShieldCheck,
  Star,
  MessageSquare,
} from 'lucide-react';

interface AiStudioWorkspaceProps {
  skills: Skill[];
  setSkills?: React.Dispatch<React.SetStateAction<Skill[]>>;
  user: UserProfile;
  setUser: React.Dispatch<React.SetStateAction<UserProfile>>;
  llmConfig: LLMConfig;
  selectedSkill: Skill | null;
  setSelectedSkill: (skill: Skill | null) => void;
  onRefreshUser?: () => void;
  onOpenLogin: () => void;
  onTriggerLogin401: () => void;
}

// 导师广场图标：博士帽 + 人像。lucide 无此图标，按同一规格自绘
//（24×24 视窗、2px 描边、圆角端点与连接），保证与其余图标风格一致。
const MentorPlazaIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 2.5 7 3-7 3-7-3z" />
    <path d="M19 5.5v3" />
    <circle cx="12" cy="11.6" r="3.1" />
    <path d="M18.6 21v-1.4a3.8 3.8 0 0 0-3.8-3.8H9.2a3.8 3.8 0 0 0-3.8 3.8V21" />
  </svg>
);

export const AiStudioWorkspace: React.FC<AiStudioWorkspaceProps> = ({
  skills,
  setSkills,
  user,
  setUser,
  llmConfig,
  selectedSkill,
  setSelectedSkill,
  onRefreshUser,
  onOpenLogin,
  onTriggerLogin401,
}) => {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [followedSkills, setFollowedSkills] = useState<FollowedSkill[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Main view state: 'chat' (active dialogue), 'market' (book grid), 'mentor' (mentor grid),
  // 'reliable' (reliable grid) or 'follows' (followed skills grid)
  const [mainView, setMainView] = useState<'chat' | 'market' | 'mentor' | 'reliable' | 'follows'>('market');

  // 聊天呈现方式：书信 / 面对面。二者共用同一会话与消息流，只是视图不同。
  const [chatMode, setChatMode] = useState<'letter' | 'face'>('letter');
  const voiceModeAvailable = Boolean(llmConfig.voiceModeEnabled);
  // SSE 回调里需要读取最新模式：中途退出面对面后停止继续喂语音，但不打断文字生成
  const chatModeRef = useRef<'letter' | 'face'>(chatMode);
  useEffect(() => {
    chatModeRef.current = chatMode;
  }, [chatMode]);

  // Chat Input Drafts per skill/book to prevent text leakage across different book pages
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(null);
  const [currentStreamingText, setCurrentStreamingText] = useState('');
  const [thinkingSeconds, setThinkingSeconds] = useState<number>(0);
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deletingSession, setDeletingSession] = useState<ChatSession | null>(null);
  const [isClearSessionsOpen, setIsClearSessionsOpen] = useState(false);
  const [toastInfo, setToastInfo] = useState<{ message: string; type?: 'info' | 'warning' | 'success' } | null>(null);

  const showToast = React.useCallback((message: string, type: 'info' | 'warning' | 'success' = 'info') => {
    setToastInfo({ message, type });
  }, []);

  // 语音播放队列：SSE 增量在 handleSendMessage 中喂入；错误每轮只提示一次。
  const voicePlayback = useVoicePlayback({
    onError: () => showToast(t('workspace.voiceUnavailable'), 'warning'),
  });

  // 后台关闭语音开关后立即回到文字模式，并停止正在播放的语音
  useEffect(() => {
    if (!voiceModeAvailable && chatMode === 'face') {
      setChatMode('letter');
      voicePlayback.stop();
    }
  }, [voiceModeAvailable, chatMode]);

  // 离开聊天视图或登出时关闭面对面覆盖层，避免舞台悬空
  useEffect(() => {
    if (!user?.id || mainView !== 'chat') {
      setChatMode('letter');
      voicePlayback.stop();
    }
  }, [user?.id, mainView]);

  // 切换会话或离开聊天视图时停止语音，避免旧音频串播到新页面
  useEffect(() => {
    voicePlayback.stop();
  }, [activeSessionId, mainView]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Helper to cleanly cancel any ongoing AI generation immediately
  const cancelOngoingGeneration = React.useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (thinkingTimerRef.current) {
      clearInterval(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setIsGenerating(false);
    setGeneratingSessionId(null);
    setCurrentStreamingText('');
    setThinkingSeconds(0);
  }, []);

  useEffect(() => {
    cancelOngoingGeneration();

    if (user) {
      apiFetch('/api/chat/sessions')
        .then((res) => (res.ok ? res.json() : { sessions: [] }))
        .then((data) => {
          if (Array.isArray(data.sessions)) {
            setSessions(data.sessions);
            // 跳过消息数为 0 的空会话，否则刷新后会自动打开一片空白的对话页
            const firstWithMessages = data.sessions.find((s: ChatSession) => (s.messages || []).length > 0);
            if (firstWithMessages) {
              setActiveSessionId(firstWithMessages.id);
              setMainView('chat');
            } else {
              setActiveSessionId(null);
              setMainView('market');
            }
          }
        })
        .catch((e) => console.warn('Fetch chat sessions error:', e));
    } else {
      setSessions([]);
      setActiveSessionId(null);
      setMainView('market');
    }

    return () => {
      cancelOngoingGeneration();
    };
  }, [user?.id, user?.role, cancelOngoingGeneration]);

  // 关注列表与登录态绑定：登录/换号时拉取，登出时清空。
  useEffect(() => {
    if (!user) {
      setFollowedSkills([]);
      return;
    }
    apiFetch('/api/follows')
      .then((res) => (res.ok ? res.json() : { follows: [] }))
      .then((data) => {
        if (Array.isArray(data.follows)) setFollowedSkills(data.follows);
      })
      .catch((e) => console.warn('Fetch follows error:', e));
  }, [user?.id]);

  const followedSkillIds = React.useMemo(
    () => new Set(followedSkills.map((skill) => skill.id)),
    [followedSkills]
  );

  // 关注/取消关注采用乐观更新：先改本地状态让按钮即时响应，请求失败再回滚并提示。
  const handleToggleFollow = async (skill: Skill) => {
    if (!user) {
      showToast(t('workspace.loginToFollow'), 'info');
      onOpenLogin();
      return;
    }
    const isFollowed = followedSkillIds.has(skill.id);
    const previous = followedSkills;
    if (isFollowed) {
      setFollowedSkills((prev) => prev.filter((item) => item.id !== skill.id));
    } else {
      setFollowedSkills((prev) => [{ ...skill, followedAt: new Date().toISOString() }, ...prev]);
    }
    try {
      const res = isFollowed
        ? await apiFetch(`/api/follows/${encodeURIComponent(skill.id)}`, { method: 'DELETE' })
        : await apiFetch('/api/follows', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillId: skill.id }),
          });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.warn('Toggle follow error:', err);
      setFollowedSkills(previous);
      showToast(t('workspace.followFailed'), 'warning');
    }
  };

  // 会话欢迎语按技能类型出文案：导师用作者名，书籍与可靠内容用书名号标题。
  const welcomeMessageFor = (skill: Skill, isNew: boolean): string => {
    if (skill.skillType === 'mentor') {
      return t(isNew ? 'workspace.welcomeMentorNew' : 'workspace.welcomeMentor', { author: skill.author });
    }
    if (skill.skillType === 'reliable') {
      return t(isNew ? 'workspace.welcomeReliableNew' : 'workspace.welcomeReliable', {
        title: formatBookTitleByLocale(skill.title, locale),
      });
    }
    return t(isNew ? 'workspace.welcomeBookNew' : 'workspace.welcomeBook', {
      title: formatBookTitleByLocale(skill.title, locale),
    });
  };

  // 分类顺序 / 标签更新的版本号：后台改动后通过 storage 事件与自定义事件触发重新拉取。
  const [catChangeVersion, setCatChangeVersion] = useState(0);

  useEffect(() => {
    const handleCategoryUpdate = () => {
      setCatChangeVersion((v) => v + 1);
    };
    window.addEventListener('category_order_updated', handleCategoryUpdate);
    window.addEventListener('storage', handleCategoryUpdate);
    return () => {
      window.removeEventListener('category_order_updated', handleCategoryUpdate);
      window.removeEventListener('storage', handleCategoryUpdate);
    };
  }, []);

  const [dbTags, setDbTags] = useState<string[]>([]);

  useEffect(() => {
    apiFetch('/api/tags')
      .then((r) => r.json())
      .then((d) => {
        if (d && Array.isArray(d.tags) && d.tags.length > 0) {
          setDbTags(d.tags);
        }
      })
      .catch(() => {});
  }, [catChangeVersion]);

  // Dynamically derive categories and renamed mapping from database tags + admin overrides
  const { categories, renamedCategoriesMap, deletedCategoriesSet } = React.useMemo(() => {
    let customCats: string[] = [];
    let deletedCats: string[] = [];
    let renamedMap: Record<string, string> = {};
    let categoryOrder: string[] = [];

    try {
      const savedCustom = localStorage.getItem('admin_custom_categories');
      if (savedCustom) customCats = JSON.parse(savedCustom);
      const savedDeleted = localStorage.getItem('admin_deleted_categories');
      if (savedDeleted) deletedCats = JSON.parse(savedDeleted);
      const savedRenamed = localStorage.getItem('admin_renamed_categories');
      if (savedRenamed) renamedMap = JSON.parse(savedRenamed);
      const savedOrder = localStorage.getItem('admin_category_order');
      if (savedOrder) categoryOrder = JSON.parse(savedOrder);
    } catch {
      // ignore
    }

    const masterPool: string[] =
      dbTags.length > 0
        ? dbTags
        : customCats.length > 0
        ? customCats
        : ['商业投资', '个人成长', '哲学心理', '经典策略'];

    const activeCategories = Array.from(
      new Set(
        masterPool
          .map((cat) => renamedMap[cat] || cat)
          .filter((cat) => cat && !deletedCats.includes(cat))
      )
    );

    if (categoryOrder.length > 0) {
      activeCategories.sort((a, b) => {
        const idxA = categoryOrder.indexOf(a);
        const idxB = categoryOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return 0;
      });
    }

    return {
      categories: [ALL_CATEGORIES, ...activeCategories],
      renamedCategoriesMap: renamedMap,
      deletedCategoriesSet: new Set(deletedCats),
    };
  }, [skills, catChangeVersion, dbTags]);

  // 三个广场共享同一套筛选/分页逻辑，各自保留独立的搜索、分类与分页进度。
  const bookPlaza = usePlazaController({ skills, skillType: 'book', categories, renamedCategoriesMap, isActive: mainView === 'market' });
  const mentorPlaza = usePlazaController({ skills, skillType: 'mentor', categories, renamedCategoriesMap, isActive: mainView === 'mentor' });
  const reliablePlaza = usePlazaController({ skills, skillType: 'reliable', categories, renamedCategoriesMap, isActive: mainView === 'reliable' });

  // Current active session & skill with strict synchronization
  const activeSession = React.useMemo(() => {
    if (activeSessionId) {
      const found = sessions.find((s) => s.id === activeSessionId);
      if (found) return found;
    }
    if (selectedSkill) {
      const found = sessions.find((s) => s.skillId === selectedSkill.id);
      if (found) return found;
    }
    return sessions[0] || null;
  }, [sessions, activeSessionId, selectedSkill]);

  const activeSkill = React.useMemo(() => {
    if (activeSession?.skillId) {
      const found = skills.find((s) => s.id === activeSession.skillId);
      if (found) return found;
    }
    return selectedSkill || skills[0] || null;
  }, [skills, activeSession, selectedSkill]);

  // Isolated Input Draft per current dialog/session/book page
  // Ensures that whatever text is typed into the input of a book/session stays strictly on that page
  const currentDialogKey = activeSession?.id || (activeSkill ? `book-${activeSkill.id}` : 'default-dialog');
  const inputText = inputDrafts[currentDialogKey] || '';
  const setInputText = (text: string) => {
    setInputDrafts((prev) => ({
      ...prev,
      [currentDialogKey]: text,
    }));
  };

  // Quota Computations
  const effectiveTier = getEffectiveMembershipTier(user);
  const memberBadgeText = user ? t(membershipTierKey(effectiveTier)) : t('tier.notLoggedIn');
  const memberBadgeClass = user ? 'bg-[#f4efe6] text-[#8c6227] font-medium' : 'bg-gray-100 text-gray-500';
  const currentQuotaLimit = React.useMemo(() => {
    if (!user) return 0;
    if (user.role === 'admin' || user.isAdmin) return 9999;
    return tierDailyLimit(llmConfig, effectiveTier);
  }, [effectiveTier, user, llmConfig]);
  const currentQuotaUsed = user?.dailyUsedCount || 0;
  const isMonthlyQuota = effectiveTier === 'monthly_member' || effectiveTier === 'quarterly_member' || effectiveTier === 'yearly_member';

  // Handle deleting a session
  const handleDeleteSession = (sessionId: string) => {
    apiFetch(`/api/chat/sessions/${sessionId}`, { method: 'DELETE' }).catch((e) =>
      console.warn('Delete session error:', e)
    );
    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== sessionId);
      if (activeSessionId === sessionId) {
        if (updated.length > 0) {
          setActiveSessionId(updated[0].id);
        } else {
          setActiveSessionId(null);
          setMainView('market');
        }
      }
      return updated;
    });
  };

  // 清空对话列表：一次性删除当前用户的全部会话与消息记录。
  // 请求失败时保留本地列表，避免界面先清空、服务端却仍有数据。
  const handleClearSessions = async () => {
    try {
      const res = await apiFetch('/api/chat/sessions', { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cancelOngoingGeneration();
      voicePlayback.stop();
      setSessions([]);
      setActiveSessionId(null);
      setChatMode('letter');
      setMainView('market');
      setIsClearSessionsOpen(false);
    } catch (err) {
      console.warn('Clear sessions error:', err);
      showToast(t('workspace.clearSessionsFailed'), 'warning');
    }
  };

  // Handle "新建对话" button click
  const handleCreateNewChat = () => {
    if (!user) { onOpenLogin(); return; }
    voicePlayback.stop();
    const currentSkillToUse = activeSkill || skills[0];
    const initialQuestions = currentSkillToUse.sampleQuestions && currentSkillToUse.sampleQuestions.length > 0
      ? currentSkillToUse.sampleQuestions
      : generateFollowUpQuestions('', '', currentSkillToUse);

    const newSession: ChatSession = {
      id: `session-${currentSkillToUse.id}-${Date.now()}`,
      skillId: currentSkillToUse.id,
      skillTitle: currentSkillToUse.title,
      skillAuthor: currentSkillToUse.author,
      skillCoverUrl: currentSkillToUse.coverUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      messages: [
        {
          id: `init-msg-${Date.now()}`,
          role: 'assistant',
          content: welcomeMessageFor(currentSkillToUse, true),
          timestamp: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
          recommendedQuestions: initialQuestions,
        },
      ],
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setSelectedSkill(currentSkillToUse);
    setMainView('chat');
  };

  // Handle selecting a book from Market
  const handleSelectBookFromMarket = (skill: Skill) => {
    voicePlayback.stop();
    if (setSkills) {
      setSkills((prevSkills) =>
        prevSkills.map((s) =>
          s.id === skill.id ? { ...s, searchCount: (s.searchCount || 0) + 1 } : s
        )
      );
    }

    apiFetch(`/api/skills/${skill.id}/click`, { method: 'POST' }).catch((err) =>
      console.warn('Failed to sync skill heat click:', err)
    );

    setSelectedSkill({ ...skill, searchCount: (skill.searchCount || 0) + 1 });
    if (!user) { onOpenLogin(); return; }

    const existing = sessions.find((s) => s.skillId === skill.id);
    // 只有「已有消息」的历史会话才直接复用；消息数为 0 的空会话要按新会话处理，
    // 否则点开就是一片空白——既没有 AI 问好也没有推荐问题
    if (existing && existing.messages.length > 0) {
      setActiveSessionId(existing.id);
    } else {
      const initialQuestions = skill.sampleQuestions && skill.sampleQuestions.length > 0
        ? skill.sampleQuestions
        : generateFollowUpQuestions('', '', skill);

      const newSession: ChatSession = {
        // 复用空会话的 id，避免再留下一条垃圾记录
        id: existing?.id ?? `session-${skill.id}-${Date.now()}`,
        skillId: skill.id,
        skillTitle: skill.title,
        skillAuthor: skill.author,
        skillCoverUrl: skill.coverUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
        messages: [
          {
            id: `init-msg-${Date.now()}`,
            role: 'assistant',
            content: welcomeMessageFor(skill, false),
            timestamp: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
            recommendedQuestions: initialQuestions,
          },
        ],
      };
      setSessions((prev) => [newSession, ...prev.filter((s) => s.id !== newSession.id)]);
      setActiveSessionId(newSession.id);
    }
    setMainView('chat');
  };

  const generateFollowUpQuestions = (userQuery: string, aiResponse: string, skill?: Skill): string[] => {
    if (!userQuery || !userQuery.trim()) {
      // 1. If skill has sampleQuestions generated from uploaded skill document by LLM, always use them
      if (skill?.sampleQuestions && skill.sampleQuestions.length > 0) {
        return skill.sampleQuestions;
      }
      // 2. If skill has uploaded systemPrompt, extract grounded core concepts from markdown
      if (skill?.systemPrompt) {
        const conceptMatches = Array.from(skill.systemPrompt.matchAll(/[“"「]([^”"」]{2,15})[”"」]/g)).map(m => m[1]);
        const boldMatches = Array.from(skill.systemPrompt.matchAll(/\*\*([^*]{2,15})\*\*/g)).map(m => m[1]);
        const combined = Array.from(new Set([...conceptMatches, ...boldMatches])).filter(
          c => !c.includes('http') && !c.includes('www') && c.length >= 2 && c.length <= 15
        );
        if (combined.length >= 3) {
          return [
            t('workspace.qConcept1', { term: combined[0] }),
            t('workspace.qConcept2', { term: combined[1] }),
            t('workspace.qConcept3', { term: combined[2] }),
          ];
        }
      }
      if (skill?.id === 'skill-santi') {
        return [t('workspace.qSanti1'), t('workspace.qSanti2'), t('workspace.qSanti3')];
      }
      if (skill?.id === 'skill-charlie') {
        return [t('workspace.qCharlie1'), t('workspace.qCharlie2'), t('workspace.qCharlie3')];
      }
      if (skill?.id === 'skill-naval') {
        return [t('workspace.qNaval1'), t('workspace.qNaval2'), t('workspace.qNaval3')];
      }
      return [
        t('workspace.qGeneric1', { title: formatBookTitleByLocale(skill?.title || t('workspace.defaultBookTitle'), locale) }),
        t('workspace.qGeneric2'),
        t('workspace.qGeneric3'),
      ];
    }

    const q = userQuery.trim();
    const bookTitle = skill ? formatBookTitleByLocale(skill.title, locale) : t('workspace.defaultBookTitle');
    // 中文分词规则只对中文输入有意义，其他语言下直接使用原文前若干字符
    const cleanTerm = locale === 'en'
      ? q
      : q.replace(/如何|怎么|在|中|运用|表达|实现|处理|关于|解决|请问|探讨|分析|理解|吗|呢|？|\?|思考|看待/g, '').trim();
    const shortTerm = cleanTerm.slice(0, 12) || t('workspace.defaultTopic');

    return [
      t('workspace.qFollowUp1', { term: shortTerm }),
      t('workspace.qFollowUp2', { title: bookTitle }),
      t('workspace.qFollowUp3'),
    ];
  };

  useEffect(() => {
    if (mainView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSession?.messages, currentStreamingText, mainView]);

  // 隐藏功能：在个人菜单的用户 ID 上点右键即可复制完整 ID，不放置可见按钮
  const handleCopyUserId = async (event: React.MouseEvent) => {
    event.preventDefault();
    if (!user) return;
    const copied = await copyText(user.id);
    showToast(copied ? t('workspace.userIdCopied', { id: user.id }) : t('workspace.copyFailed'), copied ? 'success' : 'warning');
  };

  // 注销短语的匹配必须与服务端口径一致（忽略大小写与首尾空白）：服务端的
  // DELETE_ACCOUNT_PHRASES 就是这么比的。前端若更严，英文用户在移动端被键盘自动
  // 大写了首字母时，按钮会永远置灰、且不给出任何原因，而同样的文本服务端本来会接受。
  const deletePhraseMatches =
    deleteConfirmText.trim().toLowerCase() === t('workspace.deleteAccountPhrase').toLowerCase();

  const handleLogout = async () => {
    // 没真的登出就不能清本地状态：服务端会话仍然有效，清了会出现
    // 「界面显示已登出、切个标签页又被 /api/auth/me 自动登回来」的错乱。
    if (!(await tryLogout('/api/auth/logout'))) {
      showToast(t('workspace.logoutFailed'), 'warning');
      return;
    }
    setUser(null);
    setSessions([]);
    setFollowedSkills([]);
    setActiveSessionId(null);
    setMainView('market');
    setIsUserMenuOpen(false);
  };

  // 注销账号：不可恢复的硬删除（账号、对话记录、配额账本一并清除）。
  // 按钮在输入短语完全匹配前保持禁用，服务端还会再校验一次——客户端这道只是第一层门槛，
  // 真正的防线在服务端，因为前端校验可以被绕过。
  const handleDeleteAccount = async () => {
    if (isDeletingAccount || !deletePhraseMatches) return;
    setIsDeletingAccount(true);
    try {
      const res = await apiFetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: deleteConfirmText.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIsDeletingAccount(false);
        showToast(serverMessage(data, t, 'server.INTERNAL_ERROR'), 'warning');
        return;
      }
      // 账号已经不存在了，整页重新加载回到未登录状态，避免残留任何用户态数据
      window.location.reload();
    } catch {
      setIsDeletingAccount(false);
      showToast(t('server.INTERNAL_ERROR'), 'warning');
    }
  };

  const checkQuotaAndCanProceed = (): boolean => {
    if (!user) { onOpenLogin(); return false; }
    if (user.role === 'admin' || user.isAdmin) return true;
    const used = user.dailyUsedCount || 0;
    if (used >= currentQuotaLimit) {
      showToast(effectiveTier === 'free_member'
        ? t('workspace.quotaFreeReached', { limit: currentQuotaLimit })
        : t('workspace.quotaTierReached', { tier: memberBadgeText, limit: currentQuotaLimit }), 'info');
      return false;
    }
    return true;
  };

  const handleSendMessage = async (overrideText?: string) => {
    const textToSend = overrideText || inputText;
    if (!textToSend.trim() || isGenerating || !activeSession || !activeSkill) return;

    if (!checkQuotaAndCanProceed()) return;

    // 面对面模式：本回复在流式生成过程中按句送往 TTS 并依次播放；
    // 请求发出后再切换模式不影响本轮（模式在发送时确定）。
    const speakReply = chatMode === 'face' && voiceModeAvailable;
    if (speakReply) voicePlayback.startStream();

    const nowFormatted = new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

    const userMsg: ChatMessage = {
      id: 'usr-' + Date.now(),
      role: 'user',
      content: textToSend,
      timestamp: nowFormatted,
    };

    const targetSessionId = activeSession.id;

    // Update active session messages locally immediately
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id === targetSessionId) {
          return {
            ...s,
            updatedAt: new Date().toISOString(),
            messages: [...s.messages, userMsg],
          };
        }
        return s;
      })
    );

    // Clear input draft for the current book
    setInputText('');
    setIsGenerating(true);
    setGeneratingSessionId(targetSessionId);
    setCurrentStreamingText('');
    setThinkingSeconds(0);

    const startTime = Date.now();
    if (thinkingTimerRef.current) clearInterval(thinkingTimerRef.current);
    thinkingTimerRef.current = setInterval(() => {
      setThinkingSeconds((Date.now() - startTime) / 1000);
    }, 100);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await apiFetch('/api/chat/stream', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: abortController.signal,
        body: JSON.stringify({ sessionId: targetSessionId, skillId: activeSkill.id, messageText: textToSend }),
      });

      if (!response.ok) {
        if (onRefreshUser) onRefreshUser();
        const errJson = await response.json().catch(() => ({}));
        if (response.status === 401) {
          showToast(serverMessage(errJson, t, 'workspace.loginRequired'), 'warning');
          onTriggerLogin401();
        } else if (response.status === 402 || response.status === 403 || response.status === 429) {
          // CSRF 被拒不是额度问题，而是「这个浏览器当前发不出写请求」，用户需要照提示手动恢复。
          // 与额度提示混在同一个 info 级、一闪而过的 toast 里，真正的原因就会被当成额度用尽而错过。
          const csrfBlocked = errJson.error === 'CSRF_REJECTED' || errJson.error === 'ORIGIN_REJECTED';
          showToast(serverMessage(errJson, t, 'workspace.quotaExhausted'), csrfBlocked ? 'warning' : 'info');
        }
        throw new Error(errJson.message || errJson.error || `HTTP ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      let finalizedMsg: ChatMessage | null = null;
      // 服务端错误帧（如上游 LLM 失败）：离线模板兜底已移除，需显式呈现而非静默忽略
      let streamError = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done || abortController.signal.aborted) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          try {
            const data = JSON.parse(trimmed.slice(5).trim());
            if (data.delta) {
              accumulatedText += data.delta;
              setCurrentStreamingText(accumulatedText);
              if (speakReply && chatModeRef.current === 'face') voicePlayback.pushStream(accumulatedText);
            }
            if (data.error) {
              // SSE 错误帧回传的是错误码，需按当前语言翻译后再展示
              streamError = serverMessage({ error: String(data.error) }, t, 'server.AI_UNAVAILABLE');
            }
            if (data.user) {
              if (!data.user.isAdmin && data.user.role !== 'admin') setUser(data.user);
            }
            if (data.done) {
              finalizedMsg = data.assistantMessage;
              if (data.user) {
                if (!data.user.isAdmin && data.user.role !== 'admin') setUser(data.user);
              }
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }

      if (abortController.signal.aborted) {
        if (speakReply) voicePlayback.stop();
        return;
      }

      // 服务端明确报错（上游 LLM 不可用等）：走统一失败路径
      if (streamError) throw new Error(streamError);

      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }

      const finalThinkingTime = Number(((Date.now() - startTime) / 1000).toFixed(1));
      setCurrentStreamingText('');
      setIsGenerating(false);
      setGeneratingSessionId(null);

      const aiMsg: ChatMessage = finalizedMsg || {
        id: 'ai-' + Date.now(),
        role: 'assistant',
        content: accumulatedText || t('workspace.analysisDone'),
        timestamp: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
        thinkingTime: finalThinkingTime,
      };

      // 把最后未以句末标点结尾的尾巴也送去合成（前面的句子已在流式过程中入队）
      if (speakReply && chatModeRef.current === 'face') voicePlayback.endStream(accumulatedText || aiMsg.content);

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === targetSessionId) {
            return {
              ...s,
              messages: [...s.messages, aiMsg],
            };
          }
          return s;
        })
      );
    } catch (err: any) {
      if (onRefreshUser) onRefreshUser();
      if (err?.name === 'AbortError' || abortController.signal.aborted) {
        if (speakReply) voicePlayback.stop();
        return;
      }
      // 非用户主动停止的失败：保持服务端配额账本为准
      console.warn('SSE stream error:', err);
      if (thinkingTimerRef.current) {
        clearInterval(thinkingTimerRef.current);
        thinkingTimerRef.current = null;
      }
      setCurrentStreamingText('');
      setIsGenerating(false);
      setGeneratingSessionId(null);

      const errorMsg: ChatMessage = {
        id: 'ai-err-' + Date.now(),
        role: 'assistant',
        content: t('workspace.serviceNotice', { message: err?.message || t('workspace.networkInterrupted') }),
        timestamp: new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      };

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id === targetSessionId) {
            return {
              ...s,
              messages: [...s.messages, errorMsg],
            };
          }
          return s;
        })
      );
    }
  };

  const handleCopyText = async (id: string, text: string) => {
    // 走统一封装：HTTP 直连（非安全上下文）下 navigator.clipboard 不存在，需要回退方案；
    // 否则复制会失败却仍然显示「已复制」，比不提示更糟
    if (!(await copyText(text))) return showToast(t('workspace.copyFailed'), 'warning');
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  return (
    <div className="flex flex-col h-screen w-full bg-white text-gray-900 font-sans overflow-hidden select-none">
      {/* ========================================================================= */}
      {/* TOP NAVIGATION BAR */}
      {/* ========================================================================= */}
      <header className="h-14 bg-white px-4 sm:px-6 flex items-center justify-between shrink-0 z-30 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setMainView('market')}
          >
            <span className="font-serif font-bold text-lg text-gray-900 tracking-tight">{t('brand.name')}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <div className="relative">
            <button
              onClick={() => {
                if (!user) {
                  onOpenLogin();
                } else {
                  const nextState = !isUserMenuOpen;
                  setIsUserMenuOpen(nextState);
                  if (nextState && onRefreshUser) {
                    onRefreshUser();
                  }
                }
              }}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white hover:bg-gray-50 transition-all cursor-pointer border border-gray-300 shadow-2xs"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#2c221e]">
                {!user ? (
                  <>
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    <span>{t('workspace.login')}</span>
                  </>
                ) : (
                  <>
                    <User className="w-3.5 h-3.5 text-[#8c6227]" />
                    <span className="font-semibold text-gray-900">{formatUserDisplayName(user.nickname)}</span>
                  </>
                )}
              </div>
            </button>

            {isUserMenuOpen && user && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsUserMenuOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-2xl shadow-xl p-3.5 z-50 space-y-3 border border-gray-200 text-left">
                  {/* User Header Info */}
                  <div className="pb-2 border-b border-gray-100">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-900">
                          <span className="truncate">{formatUserDisplayName(user.nickname)}</span>
                          {/* 注销入口：不可恢复的操作，做成跟昵称同排的小符号，尽量不抢视觉；
                              真正的确认放在点击后展开的弹窗里 */}
                          <button
                            onClick={() => {
                              setIsUserMenuOpen(false);
                              setDeleteConfirmText('');
                              setIsDeleteAccountOpen(true);
                            }}
                            title={t('workspace.deleteAccount')}
                            aria-label={t('workspace.deleteAccount')}
                            className="shrink-0 text-gray-300 hover:text-rose-500 transition-colors cursor-pointer"
                          >
                            <UserX className="w-3 h-3" />
                          </button>
                        </div>
                        <div onContextMenu={handleCopyUserId} className="text-[11px] text-gray-400 font-mono mt-0.5">
                          ID: {user.id.replace(/^usr_/, '')}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${memberBadgeClass}`}>
                          {memberBadgeText}
                        </span>
                        <span className="text-[11px] text-gray-400 font-mono font-normal">
                          {user.membershipExpiresAt
                            ? new Date(user.membershipExpiresAt).toLocaleDateString(locale).replace(/\//g, '-')
                            : (effectiveTier === 'yearly_member' || effectiveTier === 'quarterly_member' || effectiveTier === 'monthly_member'
                                ? '—'
                                : t('workspace.permanent'))}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quota Stats */}
                  <div className="space-y-1.5 px-0.5 py-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">{isMonthlyQuota ? t('workspace.quotaMonthly') : t('workspace.quotaDaily')}</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {currentQuotaUsed} / {currentQuotaLimit}{' '}
                        <span className="text-[11px] text-gray-400 font-mono font-normal">{isMonthlyQuota ? t('workspace.perMonth') : t('workspace.perDay')}</span>
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 border border-gray-200/60 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-[#d4b27b] h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(0, (currentQuotaUsed / Math.max(1, currentQuotaLimit)) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-0.5">
                    {!user ? (
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenLogin();
                        }}
                        className="w-full py-2 bg-[#f4efe6] hover:bg-[#eae1d0] text-[#2c221e] border border-[#ded3be] rounded-xl text-xs font-bold text-center transition-all cursor-pointer shadow-2xs"
                      >
                        <span>{t('workspace.login')}</span>
                      </button>
                    ) : (
                      <button
                        onClick={handleLogout}
                        className="w-full py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-xl text-xs font-bold text-center transition-all cursor-pointer border border-gray-200 flex items-center justify-center gap-1.5"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        {t('workspace.logout')}
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Container below Header */}
      <div className="flex flex-1 w-full overflow-hidden relative">
        {/* ========================================================================= */}
        {/* LEFT SIDEBAR COLUMN */}
        {/* ========================================================================= */}
        <aside className="w-64 sm:w-72 bg-gray-50 flex flex-col justify-between shrink-0 h-full relative z-20 border-r border-gray-200">
          <div className="p-3 space-y-2">
            <button
              onClick={() => setMainView('reliable')}
              className={`w-full py-3 px-3.5 rounded-xl font-semibold text-xs transition-all flex items-center justify-between cursor-pointer border ${
                mainView === 'reliable'
                  ? 'bg-[#f4efe6] text-[#2c221e] border-[#e2d8c3] font-bold shadow-2xs'
                  : 'bg-white hover:bg-gray-100 text-gray-900 shadow-2xs border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-gray-700" />
                <span>{t('workspace.reliablePlaza')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 opacity-70 text-gray-400" />
              </div>
            </button>
            <button
              onClick={() => setMainView('market')}
              className={`w-full py-3 px-3.5 rounded-xl font-semibold text-xs transition-all flex items-center justify-between cursor-pointer border ${
                mainView === 'market'
                  ? 'bg-[#f4efe6] text-[#2c221e] border-[#e2d8c3] font-bold shadow-2xs'
                  : 'bg-white hover:bg-gray-100 text-gray-900 shadow-2xs border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Book className="w-4 h-4 text-gray-700" />
                <span>{t('workspace.bookPlaza')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 opacity-70 text-gray-400" />
              </div>
            </button>
            <button
              onClick={() => setMainView('mentor')}
              className={`w-full py-3 px-3.5 rounded-xl font-semibold text-xs transition-all flex items-center justify-between cursor-pointer border ${
                mainView === 'mentor'
                  ? 'bg-[#f4efe6] text-[#2c221e] border-[#e2d8c3] font-bold shadow-2xs'
                  : 'bg-white hover:bg-gray-100 text-gray-900 shadow-2xs border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <MentorPlazaIcon className="w-4 h-4 text-gray-700" />
                <span>{t('workspace.mentorPlaza')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 opacity-70 text-gray-400" />
              </div>
            </button>
            <button
              onClick={() => {
                if (!user) {
                  showToast(t('workspace.loginToFollow'), 'info');
                  onOpenLogin();
                  return;
                }
                setMainView('follows');
              }}
              className={`w-full py-3 px-3.5 rounded-xl font-semibold text-xs transition-all flex items-center justify-between cursor-pointer border ${
                mainView === 'follows'
                  ? 'bg-[#f4efe6] text-[#2c221e] border-[#e2d8c3] font-bold shadow-2xs'
                  : 'bg-white hover:bg-gray-100 text-gray-900 shadow-2xs border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2">
                <Star className={`w-4 h-4 ${mainView === 'follows' ? 'text-amber-500 fill-amber-500' : 'text-gray-700'}`} />
                <span>{t('workspace.followList')}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {user && followedSkills.length > 0 && (
                  <span className="text-[10px] font-mono text-gray-400">{followedSkills.length}</span>
                )}
                <ChevronRight className="w-3.5 h-3.5 opacity-70 text-gray-400" />
              </div>
            </button>
          </div>

          {/* Middle Scrollable Section: Sessions List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            <div className="px-2 py-1 text-[11px] font-mono font-semibold text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>{t('workspace.sessionList')}</span>
              <div className="flex items-center gap-1">
                {sessions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsClearSessionsOpen(true)}
                    title={t('workspace.clearSessions')}
                    aria-label={t('workspace.clearSessions')}
                    className="p-1 rounded-md text-gray-400 hover:text-rose-500 hover:bg-gray-200/70 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
                <span className="text-[11px]">{sessions.length}</span>
              </div>
            </div>

            {sessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400">
                <p>{t('workspace.noSessions')}</p>
              </div>
            ) : (
              sessions.map((session) => {
                const isSelected = activeSessionId === session.id && mainView === 'chat';

                const formatDate = (dateVal?: string) => {
                  if (!dateVal) return '';
                  const d = new Date(dateVal);
                  if (isNaN(d.getTime())) {
                    const now = new Date();
                    const m = (now.getMonth() + 1).toString().padStart(2, '0');
                    const day = now.getDate().toString().padStart(2, '0');
                    return `${m}/${day}`;
                  }
                  const m = (d.getMonth() + 1).toString().padStart(2, '0');
                  const day = d.getDate().toString().padStart(2, '0');
                  return `${m}/${day}`;
                };

                const sessionDate = formatDate(session.updatedAt || session.createdAt);

                return (
                  <div
                    key={session.id}
                    onClick={() => {
                      setActiveSessionId(session.id);
                      const matchedSkill = skills.find((s) => s.id === session.skillId);
                      if (matchedSkill) {
                        setSelectedSkill(matchedSkill);
                      }
                      setMainView('chat');
                    }}
                    className={`group py-2.5 px-3.5 rounded-xl transition-all cursor-pointer flex items-center justify-between gap-2 relative border ${
                      isSelected
                        ? 'bg-[#f4efe6] text-[#2c221e] border-[#e2d8c3] shadow-2xs'
                        : 'bg-white hover:bg-gray-100/80 text-gray-800 border-gray-200/80'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1.5">
                        <h3
                          className={`text-xs font-semibold truncate flex-1 flex items-center min-w-0 ${
                            isSelected ? 'text-[#2c221e] font-bold' : 'text-gray-800'
                          }`}
                        >
                          <span className="truncate">{(() => {
                            const s = skills.find((sk) => sk.id === session.skillId);
                            return s?.skillType === 'mentor' ? session.skillTitle : formatBookTitleByLocale(session.skillTitle, locale);
                          })()}</span>
                          {(() => {
                            const s = skills.find((sk) => sk.id === session.skillId);
                            return s?.skillType !== 'mentor' ? (
                          <span className="text-gray-400 font-normal ml-1 shrink-0">
                            · {session.skillAuthor}
                          </span>
                            ) : null;
                          })()}
                          {sessionDate && (
                            <span className="text-[10px] text-gray-400 font-mono font-normal ml-auto shrink-0 pl-1.5 text-right">
                              {sessionDate}
                            </span>
                          )}
                        </h3>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingSession(session);
                      }}
                      className={`p-1 rounded-lg transition-all opacity-0 group-hover:opacity-100 cursor-pointer shrink-0 ${
                        isSelected
                          ? 'hover:bg-[#e2d8c3] text-gray-600 hover:text-gray-900'
                          : 'hover:bg-gray-200 text-gray-400 hover:text-gray-900'
                      }`}
                      title={t('workspace.deleteSession')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* ========================================================================= */}
        {/* RIGHT MAIN WORKSPACE */}
        {/* ========================================================================= */}
        <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
          {mainView === 'market' ? (
            /* ==================== BOOK PLAZA VIEW ==================== */
            <PlazaView
              controller={bookPlaza}
              user={user}
              searchPlaceholder={t('market.searchPlaceholder')}
              unitLabel={t('market.unitBooks')}
              allTagsTitle={t('workspace.allBookTags')}
              renamedCategoriesMap={renamedCategoriesMap}
              deletedCategoriesSet={deletedCategoriesSet}
              followedSkillIds={followedSkillIds}
              onToggleFollow={handleToggleFollow}
              onSelectSkill={handleSelectBookFromMarket}
            />
          ) : mainView === 'mentor' ? (
            /* ==================== MENTOR PLAZA VIEW ==================== */
            <PlazaView
              controller={mentorPlaza}
              user={user}
              searchPlaceholder={t('market.searchPlaceholderMentor')}
              unitLabel={t('market.unitMentors')}
              allTagsTitle={t('workspace.allMentorTags')}
              renamedCategoriesMap={renamedCategoriesMap}
              deletedCategoriesSet={deletedCategoriesSet}
              followedSkillIds={followedSkillIds}
              onToggleFollow={handleToggleFollow}
              onSelectSkill={handleSelectBookFromMarket}
            />
          ) : mainView === 'reliable' ? (
            /* ==================== RELIABLE PLAZA VIEW ==================== */
            <PlazaView
              controller={reliablePlaza}
              user={user}
              searchPlaceholder={t('market.searchPlaceholderReliable')}
              unitLabel={t('market.unitReliable')}
              allTagsTitle={t('workspace.allReliableTags')}
              renamedCategoriesMap={renamedCategoriesMap}
              deletedCategoriesSet={deletedCategoriesSet}
              followedSkillIds={followedSkillIds}
              onToggleFollow={handleToggleFollow}
              onSelectSkill={handleSelectBookFromMarket}
            />
          ) : mainView === 'follows' ? (
            /* ==================== FOLLOW LIST VIEW ==================== */
            <FollowListView
              follows={followedSkills}
              followedSkillIds={followedSkillIds}
              user={user}
              onToggleFollow={handleToggleFollow}
              onSelectSkill={handleSelectBookFromMarket}
              onGoBrowse={() => setMainView('market')}
            />
          ) : (
            /* ==================== CHAT VIEW ==================== */
            <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-white">
              {/* Top Header Bar in Chat View */}
              <div className="h-12 px-4 sm:px-6 flex items-center justify-between bg-white border-b border-gray-100 shrink-0 z-10">
                <div className="flex items-center gap-2.5 min-w-0">
                  {/* 书信 / 面对面切换：共用同一会话，面对面入口仅在后台语音配置可用时显示 */}
                  <div className="flex items-center gap-0.5 bg-gray-100 p-0.5 rounded-full">
                    <button
                      onClick={() => {
                        setChatMode('letter');
                        voicePlayback.stop();
                      }}
                      className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                        chatMode === 'letter'
                          ? 'bg-white text-gray-900 shadow-2xs'
                          : 'text-gray-500 hover:text-gray-800'
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>{t('workspace.textChatMode')}</span>
                    </button>
                    {voiceModeAvailable && (
                      <button
                        onClick={() => setChatMode('face')}
                        className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                          chatMode === 'face'
                            ? 'bg-white text-gray-900 shadow-2xs'
                            : 'text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        <User className="w-3.5 h-3.5" />
                        <span>{t('workspace.voiceChatMode')}</span>
                      </button>
                    )}
                  </div>
                </div>

                <button
                  onClick={handleCreateNewChat}
                  className="px-3 py-1.5 rounded-full font-medium text-xs transition-all flex items-center gap-1.5 cursor-pointer text-gray-500 hover:text-gray-800 hover:bg-gray-100 active:scale-98 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('workspace.newSession')}</span>
                </button>
              </div>

              {/* Center Scrollable Dialogue History Area */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6">
                <div className="max-w-3xl mx-auto space-y-5">
                  {activeSession?.messages.map((msg, idx) => {
                    const isUser = msg.role === 'user';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col pb-4 ${
                          isUser ? 'items-end text-right' : 'items-start text-left'
                        }`}
                      >
                        <div
                          className={`flex items-center gap-2 text-[11px] text-gray-400 font-sans px-1 mb-1 ${
                            isUser ? 'justify-end' : 'justify-start'
                          }`}
                        >
                          <span className="font-semibold text-gray-700">
                            {isUser ? formatUserDisplayName(user?.nickname) : activeSkill?.title}
                          </span>
                          <span>·</span>
                          <span>{formatMessageTimestamp(msg.timestamp)}</span>
                        </div>

                        {/* Message Box */}
                        <div
                          className={`p-3 sm:p-4 rounded-2xl text-sm leading-relaxed relative group ${
                            isUser
                              ? 'max-w-[88%] sm:max-w-[80%] bg-transparent text-gray-900 text-right'
                              : 'w-full max-w-full bg-white text-gray-900 rounded-bl-xs text-left'
                          }`}
                        >
                          <MarkdownMessage content={msg.content} isUser={isUser} />

                          {!isUser && (
                            <>
                              <button
                                onClick={() => handleCopyText(msg.id, msg.content)}
                                className="absolute top-2.5 right-2.5 p-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                                title={t('workspace.copyAnswer')}
                              >
                                {copiedMsgId === msg.id ? (
                                  <Check className="w-3.5 h-3.5 text-gray-900" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>

                              <div className="mt-3 pt-2 space-y-2">
                                <div className="text-[11px] font-bold text-gray-500 flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-gray-700" />
                                  <span>{t('workspace.recommendedQuestions')}</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {(
                                    msg.recommendedQuestions ||
                                    generateFollowUpQuestions(
                                      idx > 0 && activeSession?.messages[idx - 1]?.role === 'user'
                                        ? activeSession.messages[idx - 1].content
                                        : '',
                                      msg.content,
                                      activeSkill
                                    )
                                  ).map((q, qIdx) => (
                                    <button
                                      key={qIdx}
                                      onClick={() => handleSendMessage(q)}
                                      disabled={isGenerating}
                                      className="px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-gray-200/80 text-gray-700 hover:text-gray-900 text-xs transition-all text-left cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed border-0 outline-none ring-0 shadow-none"
                                    >
                                      {q}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {isGenerating && activeSession?.id === generatingSessionId && (
                    <div className="flex flex-col items-start space-y-1.5 text-left pb-4 border-b border-transparent hover:border-gray-200 transition-colors">
                      <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 border border-gray-200/90 rounded-full text-xs text-gray-700 font-sans shadow-2xs">
                        <Brain className="w-3.5 h-3.5 text-gray-800 animate-pulse shrink-0" />
                        <span className="font-semibold text-gray-800">{t('workspace.deepThinking')}</span>
                        <span className="text-gray-300">|</span>
                        <span className="flex items-center gap-1 font-mono font-medium text-gray-900">
                          <Clock className="w-3 h-3 text-gray-500 shrink-0" />
                          {t('workspace.thinkingSeconds', { seconds: thinkingSeconds.toFixed(1) })}
                        </span>
                      </div>

                      <div className="w-full max-w-full p-4 rounded-2xl text-sm leading-relaxed bg-white text-gray-900 rounded-bl-xs text-left">
                        <MarkdownMessage content={currentStreamingText} isStreaming={true} />
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </div>
              </div>

              {/* Bottom Fixed AI Input Window */}
              <div className="p-4 bg-white shrink-0 border-t border-gray-200">
                <div className="max-w-3xl mx-auto space-y-2">
                  <div
                    className={`bg-white rounded-2xl p-3 transition-all shadow-xs flex flex-col gap-2 border ${
                      isGenerating
                        ? 'border-gray-300 bg-gray-50/50 focus-within:ring-2 focus-within:ring-[#ded3be] focus-within:border-[#ded3be]'
                        : 'focus-within:ring-2 focus-within:ring-[#ded3be] focus-within:border-[#ded3be] border-gray-300'
                    }`}
                  >
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          if (!isGenerating) {
                            handleSendMessage();
                          }
                        }
                      }}
                      rows={2}
                      placeholder={
                        isGenerating
                          ? activeSession?.id === generatingSessionId
                            ? t('workspace.inputThinking')
                            : t('workspace.inputOtherSession', {
                                title: formatBookTitleByLocale(
                                  sessions.find((s) => s.id === generatingSessionId)?.skillTitle ||
                                    t('workspace.defaultBookTitle'),
                                  locale
                                ),
                              })
                          : activeSkill
                          ? t('workspace.inputForBook', { title: formatBookTitleByLocale(activeSkill.title, locale) })
                          : t('workspace.inputDefault')
                      }
                      className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none resize-none leading-relaxed p-1 max-h-36 overflow-y-auto font-sans"
                    />

                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => {
                          if (!isGenerating) {
                            handleSendMessage();
                          }
                        }}
                        disabled={!inputText.trim() || isGenerating}
                        className={`px-5 py-2 rounded-full text-xs font-semibold flex items-center gap-2 transition-all shadow-2xs ${
                          isGenerating
                            ? 'bg-gray-200 text-gray-600 cursor-not-allowed border border-gray-300'
                            : inputText.trim()
                            ? 'bg-[#f4efe6] text-[#2c221e] border border-[#ded3be] hover:bg-[#eae1d0] cursor-pointer font-bold'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        {isGenerating ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 text-gray-700 animate-spin" />
                            <span>
                              {activeSession?.id === generatingSessionId
                                ? t('workspace.sendAnswering')
                                : t('workspace.sendWaiting')}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>{t('workspace.sendStart')}</span>
                            <Send className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* 面对面全屏界面：覆盖整个应用；「书信」退出并回到文字聊天页 */}
      {chatMode === 'face' && voiceModeAvailable && user && (
        <FaceToFaceView
          session={activeSession}
          inputText={inputText}
          onInputChange={setInputText}
          onSend={handleSendMessage}
          isGenerating={isGenerating}
          generatingHere={activeSession?.id === generatingSessionId}
          currentStreamingText={currentStreamingText}
          speaking={voicePlayback.isSpeaking || voicePlayback.isPreparing}
          currentSpeechText={voicePlayback.currentSpeechText}
          isRevealing={voicePlayback.isRevealing}
          onReplay={(text) => voicePlayback.speak(text)}
          onExit={() => {
            setChatMode('letter');
            voicePlayback.stop();
          }}
          onNotify={showToast}
        />
      )}

      {/* 注销账号确认弹窗：必须输入完整短语才能提交，避免误触造成的不可恢复删除 */}
      {isDeleteAccountOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 p-5 space-y-4 text-left">
            <h3 className="text-sm font-serif font-bold text-rose-600">{t('workspace.deleteAccountTitle')}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              {t('workspace.deleteAccountBody', { phrase: t('workspace.deleteAccountPhrase') })}
            </p>
            <input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={t('workspace.deleteAccountPhrase')}
              autoComplete="off"
              autoFocus
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-rose-400"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setIsDeleteAccountOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={isDeletingAccount || !deletePhraseMatches}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                {t('workspace.deleteAccountConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 清空对话列表确认弹窗：一次性删除全部会话与消息，不可撤销 */}
      {isClearSessionsOpen && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 p-5 space-y-4 text-left">
            <h3 className="text-sm font-serif font-bold text-gray-900">{t('workspace.clearSessionsTitle')}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              {t('workspace.clearSessionsBody', { count: sessions.length })}
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setIsClearSessionsOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleClearSessions}
                className="px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors cursor-pointer"
              >
                {t('workspace.clearSessionsConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingSession && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 p-5 space-y-4 text-left">
            <h3 className="text-sm font-serif font-bold text-gray-900">{t('workspace.confirmDeleteTitle')}</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              {t('workspace.confirmDeleteBody', { title: formatBookTitleByLocale(deletingSession.skillTitle, locale) })}
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDeletingSession(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  handleDeleteSession(deletingSession.id);
                  setDeletingSession(null);
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs text-[#2c221e] bg-[#f4efe6] hover:bg-[#eae3d5] border border-[#e2d8c3] transition-colors cursor-pointer font-bold shadow-2xs"
              >
                {t('workspace.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen-Center Quota Alert & Notification Card Modal */}
      {toastInfo && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="relative bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 p-6 pt-5 space-y-3 text-center animate-in zoom-in-95 duration-150">
            {/* Top-Right 'X' Close Button */}
            <button
              type="button"
              onClick={() => setToastInfo(null)}
              className="absolute top-3.5 right-3.5 p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              title={t('common.close')}
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-2 px-2 pt-1">
              <h3 className="font-bold text-sm text-gray-900">
                {toastInfo.type === 'warning' ? t('workspace.toast.warning') : toastInfo.type === 'success' ? t('workspace.toast.success') : t('workspace.toast.info')}
              </h3>
              <p className="text-xs leading-relaxed text-gray-600">
                {toastInfo.message}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
