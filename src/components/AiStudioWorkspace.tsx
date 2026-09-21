import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Skill,
  UserProfile,
  ChatMessage,
  LLMConfig,
  ChatSession,
  formatBookTitle,
  cleanBookTitle,
  formatUserDisplayName,
  formatMessageTimestamp,
  getEffectiveMembershipTier,
  tierDailyLimit,
  ALL_CATEGORIES,
} from '../types';
import { apiFetch } from '../lib/apiFetch';
import { copyText } from '../lib/clipboard';
import { useI18n, membershipTierKey, formatBookTitleByLocale, serverMessage } from '../i18n';
import { BookDetailModal } from './BookDetailModal';
import { MembershipModal } from './MembershipModal';
import { MarkdownMessage } from './MarkdownMessage';
import { LanguageSwitcher } from './LanguageSwitcher';
import MarketSection from './MarketSection';
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
  Crown,
  UserX,
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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Main view state: 'chat' (active dialogue), 'market' (book grid), or 'mentor' (mentor grid)
  const [mainView, setMainView] = useState<'chat' | 'market' | 'mentor'>('market');

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
  const [isMembershipModalOpen, setIsMembershipModalOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deletingSession, setDeletingSession] = useState<ChatSession | null>(null);
  const [toastInfo, setToastInfo] = useState<{ message: string; type?: 'info' | 'warning' | 'success' } | null>(null);

  const showToast = React.useCallback((message: string, type: 'info' | 'warning' | 'success' = 'info') => {
    setToastInfo({ message, type });
  }, []);

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
      fetch('/api/chat/sessions', { credentials: 'include' })
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

  // Category filter & search state for Market view
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORIES);
  const [marketSearch, setMarketSearch] = useState('');
  const [catChangeVersion, setCatChangeVersion] = useState(0);

  // Pagination for Market cards (20 cards per screen/batch)
  const PAGE_SIZE = 20;
  const [visibleCardCount, setVisibleCardCount] = useState<number>(PAGE_SIZE);

  useEffect(() => {
    setVisibleCardCount(PAGE_SIZE);
  }, [selectedCategory, marketSearch]);

  // --- 导师广场独立状态（与书籍广场对称） ---
  const [mentorSelectedCategory, setMentorSelectedCategory] = useState<string>(ALL_CATEGORIES);
  const [mentorSearch, setMentorSearch] = useState('');
  const [mentorVisibleCardCount, setMentorVisibleCardCount] = useState<number>(PAGE_SIZE);
  const mentorTagsContainerRef = useRef<HTMLDivElement>(null);
  const [mentorIsAllCategoriesModalOpen, setMentorIsAllCategoriesModalOpen] = useState(false);
  const [mentorDetailSkill, setMentorDetailSkill] = useState<Skill | null>(null);
  const [mentorMaxVisibleCategories, setMentorMaxVisibleCategories] = useState<number>(0);

  useEffect(() => {
    setMentorVisibleCardCount(PAGE_SIZE);
  }, [mentorSelectedCategory, mentorSearch]);

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
    fetch('/api/tags')
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

  const tagsContainerRef = useRef<HTMLDivElement>(null);
  const [isAllCategoriesModalOpen, setIsAllCategoriesModalOpen] = useState(false);
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  const otherCategories = React.useMemo(() => {
    return categories.filter((cat) => cat !== ALL_CATEGORIES);
  }, [categories]);

  const [maxVisibleCategories, setMaxVisibleCategories] = useState<number>(otherCategories.length);

  useEffect(() => {
    if (mainView === 'market') {
      setMaxVisibleCategories(otherCategories.length);
    }
    if (mainView === 'mentor') {
      setMentorMaxVisibleCategories(otherCategories.length);
    }
  }, [mainView, categories, catChangeVersion, otherCategories.length]);

  useEffect(() => {
    const handleResize = () => {
      if (mainView === 'market') {
        setMaxVisibleCategories(otherCategories.length);
      }
      if (mainView === 'mentor') {
        setMentorMaxVisibleCategories(otherCategories.length);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mainView, otherCategories.length]);

  useLayoutEffect(() => {
    if (mainView === 'market' && tagsContainerRef.current) {
      if (tagsContainerRef.current.scrollHeight > 68 && maxVisibleCategories > 0) {
        setMaxVisibleCategories((prev) => Math.max(0, prev - 1));
      }
    }
  }, [mainView, maxVisibleCategories, categories]);

  useLayoutEffect(() => {
    if (mainView === 'mentor' && mentorTagsContainerRef.current) {
      if (mentorTagsContainerRef.current.scrollHeight > 68 && mentorMaxVisibleCategories > 0) {
        setMentorMaxVisibleCategories((prev) => Math.max(0, prev - 1));
      }
    }
  }, [mainView, mentorMaxVisibleCategories, categories]);

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

  // Handle "新建对话" button click
  const handleCreateNewChat = () => {
    if (!user) { onOpenLogin(); return; }
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
          content: currentSkillToUse.skillType === 'mentor'
            ? t('workspace.welcomeMentorNew', { author: currentSkillToUse.author })
            : t('workspace.welcomeBookNew', { title: formatBookTitleByLocale(currentSkillToUse.title, locale) }),
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
            content: skill.skillType === 'mentor'
              ? t('workspace.welcomeMentor', { author: skill.author })
              : t('workspace.welcomeBook', { title: formatBookTitleByLocale(skill.title, locale) }),
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
    try {
      const res = await apiFetch('/api/auth/logout', { method: 'POST' });
      // apiFetch 对非 2xx 不抛异常，必须显式检查：登出失败时会话仍然有效，
      // 而 App 在 focus / visibilitychange 时会重拉 /api/auth/me，用户切一下标签页就会被自动登回来。
      if (!res.ok) showToast(t('workspace.logoutFailed'), 'warning');
    } catch (e) {
      console.warn('Logout API error:', e);
      showToast(t('workspace.logoutFailed'), 'warning');
    }
    setUser(null);
    setSessions([]);
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
          showToast(serverMessage(errJson, t, 'workspace.quotaExhausted'), 'info');
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

      if (abortController.signal.aborted) return;

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

  const sortedSkills = [...skills].filter((s) => (s.skillType || 'book') === 'book').sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0));

  const bookSkills = skills.filter((s) => (s.skillType || 'book') === 'book');

  const marketFilteredSkills = bookSkills
    .filter((skill) => {
      const mappedCategory = renamedCategoriesMap[skill.category] || skill.category;
      const matchesCategory =
        selectedCategory === ALL_CATEGORIES ||
        mappedCategory === selectedCategory ||
        skill.category === selectedCategory ||
        skill.tags?.some((t) => (renamedCategoriesMap[t] || t) === selectedCategory);
      const rawQ = marketSearch.toLowerCase().trim();
      const cleanQ = cleanBookTitle(rawQ).toLowerCase();
      const matchesSearch =
        !rawQ ||
        skill.title.toLowerCase().includes(rawQ) ||
        (cleanQ ? skill.title.toLowerCase().includes(cleanQ) : false) ||
        (cleanQ ? cleanBookTitle(skill.title).toLowerCase().includes(cleanQ) : false) ||
        (skill.author ? skill.author.toLowerCase().includes(rawQ) : false) ||
        (cleanQ && skill.author ? skill.author.toLowerCase().includes(cleanQ) : false);
      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0));

  const displayedSkills = marketFilteredSkills.slice(0, visibleCardCount);
  const hasMoreCards = visibleCardCount < marketFilteredSkills.length;
  const remainingCount = marketFilteredSkills.length - visibleCardCount;

  // --- 导师广场数据（仅 skillType=mentor） ---
  const mentorSkills = skills.filter((s) => s.skillType === 'mentor');

  const mentorSortedSkills = [...mentorSkills].sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0));

  const mentorFilteredSkills = mentorSkills
    .filter((skill) => {
      const mappedCategory = renamedCategoriesMap[skill.category] || skill.category;
      const matchesCategory =
        mentorSelectedCategory === ALL_CATEGORIES ||
        mappedCategory === mentorSelectedCategory ||
        skill.category === mentorSelectedCategory ||
        skill.tags?.some((t) => (renamedCategoriesMap[t] || t) === mentorSelectedCategory);
      const rawQ = mentorSearch.toLowerCase().trim();
      const cleanQ = cleanBookTitle(rawQ).toLowerCase();
      const matchesSearch =
        !rawQ ||
        skill.title.toLowerCase().includes(rawQ) ||
        (cleanQ ? skill.title.toLowerCase().includes(cleanQ) : false) ||
        (cleanQ ? cleanBookTitle(skill.title).toLowerCase().includes(cleanQ) : false) ||
        (skill.author ? skill.author.toLowerCase().includes(rawQ) : false) ||
        (cleanQ && skill.author ? skill.author.toLowerCase().includes(cleanQ) : false);
      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0));

  const mentorDisplayedSkills = mentorFilteredSkills.slice(0, mentorVisibleCardCount);
  const mentorHasMoreCards = mentorVisibleCardCount < mentorFilteredSkills.length;
  const mentorRemainingCount = mentorFilteredSkills.length - mentorVisibleCardCount;

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
                      <>
                        {/* 会员订阅入口（开通功能暂未开放，窗口内按钮禁用） */}
                        <button
                          onClick={() => {
                            setIsUserMenuOpen(false);
                            setIsMembershipModalOpen(true);
                          }}
                          className="w-full py-2 bg-[#f4efe6] hover:bg-[#eae1d0] text-[#2c221e] border border-[#ded3be] rounded-xl text-xs font-bold text-center transition-all cursor-pointer shadow-2xs flex items-center justify-center gap-1.5"
                        >
                          <Crown className="w-3.5 h-3.5 text-[#8c6227]" />
                          {t('workspace.membershipEntry')}
                        </button>
                        <button
                          onClick={handleLogout}
                          className="w-full py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-xl text-xs font-bold text-center transition-all cursor-pointer border border-gray-200 flex items-center justify-center gap-1.5"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          {t('workspace.logout')}
                        </button>
                      </>
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
          </div>

          {/* Middle Scrollable Section: Sessions List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            <div className="px-2 py-1 text-[11px] font-mono font-semibold text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>{t('workspace.sessionList')}</span>
              <span className="text-[11px]">{sessions.length}</span>
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
            /* ==================== BOOK MARKET VIEW ==================== */
            <MarketSection
              search={marketSearch}
              onSearchChange={setMarketSearch}
              searchPlaceholder={t('market.searchPlaceholder')}
              tagsContainerRef={tagsContainerRef}
              selectedCategory={selectedCategory}
              onCategoryChange={setSelectedCategory}
              allSkillsCount={bookSkills.length}
              otherCategories={otherCategories}
              maxVisibleCategories={maxVisibleCategories}
              onOpenAllCategories={() => setIsAllCategoriesModalOpen(true)}
              filteredSkills={marketFilteredSkills}
              displayedSkills={displayedSkills}
              sortedSkills={sortedSkills}
              user={user}
              renamedCategoriesMap={renamedCategoriesMap}
              deletedCategoriesSet={deletedCategoriesSet}
              validCategories={categories}
              hasMoreCards={hasMoreCards}
              onLoadMore={() => setVisibleCardCount((prev) => prev + PAGE_SIZE)}
              pageSize={PAGE_SIZE}
              remainingCount={remainingCount}
              onSelectSkill={handleSelectBookFromMarket}
              onViewDetail={(skill) => setDetailSkill(skill)}
              unitLabel={t('market.unitBooks')}
            />
          ) : mainView === 'mentor' ? (
            /* ==================== MENTOR MARKET VIEW ==================== */
            <MarketSection
              search={mentorSearch}
              onSearchChange={setMentorSearch}
              searchPlaceholder={t('market.searchPlaceholderMentor')}
              tagsContainerRef={mentorTagsContainerRef}
              selectedCategory={mentorSelectedCategory}
              onCategoryChange={setMentorSelectedCategory}
              allSkillsCount={mentorSkills.length}
              otherCategories={otherCategories}
              maxVisibleCategories={mentorMaxVisibleCategories}
              onOpenAllCategories={() => setMentorIsAllCategoriesModalOpen(true)}
              filteredSkills={mentorFilteredSkills}
              displayedSkills={mentorDisplayedSkills}
              sortedSkills={mentorSortedSkills}
              user={user}
              renamedCategoriesMap={renamedCategoriesMap}
              deletedCategoriesSet={deletedCategoriesSet}
              validCategories={categories}
              hasMoreCards={mentorHasMoreCards}
              onLoadMore={() => setMentorVisibleCardCount((prev) => prev + PAGE_SIZE)}
              pageSize={PAGE_SIZE}
              remainingCount={mentorRemainingCount}
              onSelectSkill={handleSelectBookFromMarket}
              onViewDetail={(skill) => setMentorDetailSkill(skill)}
              unitLabel={t('market.unitMentors')}
            />
          ) : (
            /* ==================== CHAT VIEW ==================== */
            <div className="flex-1 flex flex-col h-full overflow-hidden relative bg-white">
              {/* Top Header Bar in Chat View */}
              <div className="h-12 px-4 sm:px-6 flex items-center justify-between bg-white border-b border-gray-100 shrink-0 z-10">
                <div className="flex items-center gap-2.5 min-w-0" />

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

      {/* All Categories Modal */}
      {isAllCategoriesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 p-6 space-y-4 text-left relative animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 font-serif flex items-center gap-2">
                <span>{t('workspace.allBookTags')}</span>
                <span className="text-xs font-sans font-normal text-gray-500">
                  {t('workspace.tagsCount', { count: categories.length })}
                </span>
              </h3>
              <button
                onClick={() => setIsAllCategoriesModalOpen(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 max-h-[55vh] overflow-y-auto p-1">
              {categories.map((cat) => {
                const isSelected = cat === selectedCategory;
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setSelectedCategory(cat);
                      setIsAllCategoriesModalOpen(false);
                    }}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#f4efe6] text-[#2c221e] font-bold shadow-xs border border-[#e2d8c3]'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    #{cat === ALL_CATEGORIES ? t('workspace.allWithCount', { count: bookSkills.length }) : cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 导师广场 All Categories Modal */}
      {mentorIsAllCategoriesModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 p-6 space-y-4 text-left relative animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-gray-900 font-serif flex items-center gap-2">
                <span>{t('workspace.allMentorTags')}</span>
                <span className="text-xs font-sans font-normal text-gray-500">
                  {t('workspace.tagsCount', { count: categories.length })}
                </span>
              </h3>
              <button
                onClick={() => setMentorIsAllCategoriesModalOpen(false)}
                className="p-1 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 max-h-[55vh] overflow-y-auto p-1">
              {categories.map((cat) => {
                const isSelected = cat === mentorSelectedCategory;
                return (
                  <button
                    key={cat}
                    onClick={() => {
                      setMentorSelectedCategory(cat);
                      setMentorIsAllCategoriesModalOpen(false);
                    }}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#f4efe6] text-[#2c221e] font-bold shadow-xs border border-[#e2d8c3]'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                  >
                    #{cat === ALL_CATEGORIES ? t('workspace.allWithCount', { count: mentorSkills.length }) : cat}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Book Detail Introduction Modal */}
      <BookDetailModal
        skill={detailSkill}
        user={user}
        isOpen={Boolean(detailSkill)}
        onClose={() => setDetailSkill(null)}
        onStartChat={(skill) => {
          setDetailSkill(null);
          handleSelectBookFromMarket(skill);
        }}
      />

      {/* 导师详情 Modal（复用 BookDetailModal） */}
      <BookDetailModal
        skill={mentorDetailSkill}
        user={user}
        isOpen={Boolean(mentorDetailSkill)}
        onClose={() => setMentorDetailSkill(null)}
        onStartChat={(skill) => {
          setMentorDetailSkill(null);
          handleSelectBookFromMarket(skill);
        }}
      />

      {/* 会员订阅窗口（禁用态：仅浏览套餐，开通按钮置灰） */}
      {isMembershipModalOpen && (
        <MembershipModal
          llmConfig={llmConfig}
          currentTier={effectiveTier}
          onClose={() => setIsMembershipModalOpen(false)}
        />
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
