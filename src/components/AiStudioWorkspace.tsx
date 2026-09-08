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
  getMembershipTierLabel,
} from '../types';
import { loadGuestUser, rememberGuestCount } from '../lib/guestQuota';
import { SkillCard } from './SkillCard';
import { BookDetailModal } from './BookDetailModal';
import { MembershipModal } from './MembershipModal';
import { MarkdownMessage } from './MarkdownMessage';
import {
  Search,
  Send,
  LayoutGrid,
  Copy,
  Check,
  X,
  ChevronRight,
  ChevronDown,
  Sparkles,
  LogOut,
  Trash2,
  Plus,
  Loader2,
  Brain,
  Clock,
  User,
  Crown,
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
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Main view state: 'chat' (active dialogue) or 'market' (3-column book card grid)
  const [mainView, setMainView] = useState<'chat' | 'market'>('market');

  // Chat Input Drafts per skill/book to prevent text leakage across different book pages
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingSessionId, setGeneratingSessionId] = useState<string | null>(null);
  const [currentStreamingText, setCurrentStreamingText] = useState('');
  const [thinkingSeconds, setThinkingSeconds] = useState<number>(0);
  const thinkingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const streamingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isMembershipModalOpen, setIsMembershipModalOpen] = useState(false);
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
    if (streamingIntervalRef.current) {
      clearInterval(streamingIntervalRef.current);
      streamingIntervalRef.current = null;
    }
    setIsGenerating(false);
    setGeneratingSessionId(null);
    setCurrentStreamingText('');
    setThinkingSeconds(0);
  }, []);

  useEffect(() => {
    cancelOngoingGeneration();

    if (user.id && user.role !== 'guest') {
      const token = localStorage.getItem('auth_token');
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      fetch(`/api/chat/sessions?userId=${user.id}`, { headers })
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data.sessions)) {
            setSessions(data.sessions);
            if (data.sessions.length > 0) {
              setActiveSessionId(data.sessions[0].id);
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
  }, [user.id, user.role, cancelOngoingGeneration]);

  // Category filter & search state for Market view
  const [selectedCategory, setSelectedCategory] = useState<string>('全部');
  const [marketSearch, setMarketSearch] = useState('');
  const [catChangeVersion, setCatChangeVersion] = useState(0);

  // Pagination for Market cards (20 cards per screen/batch)
  const PAGE_SIZE = 20;
  const [visibleCardCount, setVisibleCardCount] = useState<number>(PAGE_SIZE);

  useEffect(() => {
    setVisibleCardCount(PAGE_SIZE);
  }, [selectedCategory, marketSearch]);

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
      categories: ['全部', ...activeCategories],
      renamedCategoriesMap: renamedMap,
      deletedCategoriesSet: new Set(deletedCats),
    };
  }, [skills, catChangeVersion, dbTags]);

  const tagsContainerRef = useRef<HTMLDivElement>(null);
  const [isAllCategoriesModalOpen, setIsAllCategoriesModalOpen] = useState(false);
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  const otherCategories = React.useMemo(() => {
    return categories.filter((cat) => cat !== '全部');
  }, [categories]);

  const [maxVisibleCategories, setMaxVisibleCategories] = useState<number>(otherCategories.length);

  useEffect(() => {
    if (mainView === 'market') {
      setMaxVisibleCategories(otherCategories.length);
    }
  }, [mainView, categories, catChangeVersion, otherCategories.length]);

  useEffect(() => {
    const handleResize = () => {
      if (mainView === 'market') {
        setMaxVisibleCategories(otherCategories.length);
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
  const memberBadgeText = getMembershipTierLabel(effectiveTier);
  const memberBadgeClass =
    user.role === 'guest'
      ? 'bg-gray-100 text-gray-500'
      : 'bg-[#f4efe6] text-[#8c6227] font-medium';

  const limits = llmConfig?.dailyLimits || {
    guestUser: 3,
    freeMember: 10,
    monthlyMember: 100,
    quarterlyMember: 200,
    yearlyMember: 500,
  };

  const currentQuotaLimit = React.useMemo(() => {
    if (user.role === 'admin' || user.isAdmin) return 9999;
    switch (effectiveTier) {
      case 'yearly_member':
        return limits.yearlyMember ?? 500;
      case 'quarterly_member':
        return limits.quarterlyMember ?? 200;
      case 'monthly_member':
        return limits.monthlyMember ?? 100;
      case 'free_member':
        return limits.freeMember ?? 10;
      case 'guest':
      default:
        return limits.guestUser ?? 3;
    }
  }, [effectiveTier, user.role, user.isAdmin, limits]);

  const currentQuotaUsed =
    user.role === 'guest'
      ? user.guestUsedCount || 0
      : user.dailyUsedCount || 0;

  // 额度周期：月/季/年度会员按月计算，游客/普通会员按日计算
  const isMonthlyQuota =
    effectiveTier === 'monthly_member' ||
    effectiveTier === 'quarterly_member' ||
    effectiveTier === 'yearly_member';

  // Handle deleting a session
  const handleDeleteSession = (sessionId: string) => {
    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const url = `/api/chat/sessions/${sessionId}${user?.id ? `?userId=${encodeURIComponent(user.id)}` : ''}`;
    fetch(url, { method: 'DELETE', headers }).catch((e) =>
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
    const currentSkillToUse = activeSkill || skills[0];
    const initialQuestions = currentSkillToUse.sampleQuestions && currentSkillToUse.sampleQuestions.length > 0
      ? currentSkillToUse.sampleQuestions
      : generateFollowUpQuestions('', '', currentSkillToUse);

    const newSession: ChatSession = {
      id: `session-${currentSkillToUse.id}-${Date.now()}`,
      userId: user.id,
      skillId: currentSkillToUse.id,
      skillTitle: currentSkillToUse.title,
      skillAuthor: currentSkillToUse.author,
      skillCoverUrl: currentSkillToUse.coverUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      messages: [
        {
          id: `init-msg-${Date.now()}`,
          role: 'assistant',
          content: `你好！我是${formatBookTitle(currentSkillToUse.title)}的 AI 原著导师。\n\n已为你开启全新的对话页面。你可以随时提出你关注的问题。`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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

    fetch(`/api/skills/${skill.id}/click`, { method: 'POST' }).catch((err) =>
      console.warn('Failed to sync skill heat click:', err)
    );

    setSelectedSkill({ ...skill, searchCount: (skill.searchCount || 0) + 1 });

    const existing = sessions.find((s) => s.skillId === skill.id);
    if (existing) {
      setActiveSessionId(existing.id);
    } else {
      const initialQuestions = skill.sampleQuestions && skill.sampleQuestions.length > 0
        ? skill.sampleQuestions
        : generateFollowUpQuestions('', '', skill);

      const newSession: ChatSession = {
        id: `session-${skill.id}-${Date.now()}`,
        userId: user.id,
        skillId: skill.id,
        skillTitle: skill.title,
        skillAuthor: skill.author,
        skillCoverUrl: skill.coverUrl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        messages: [
          {
            id: `init-msg-${Date.now()}`,
            role: 'assistant',
            content: `你好！我是${formatBookTitle(skill.title)}的 AI 原著导师。\n\n你可以随时向我提出关于本书核心观点、逻辑框架的问题，或探讨如何在实际场景中应用。`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            recommendedQuestions: initialQuestions,
          },
        ],
      };
      setSessions((prev) => [newSession, ...prev]);
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
            `如何理解原著中提出的“${combined[0]}”？它在实际场景中如何应用？`,
            `原著中关于“${combined[1]}”的核心逻辑是什么？如何避免常见误区？`,
            `如何将“${combined[2]}”与日常决策或行动相结合？`,
          ];
        }
      }
      if (skill?.id === 'skill-santi') {
        return [
          '如何在高度内卷的存量商业竞争中，构建自己的“面壁计划”？',
          '从“降维打击”视角看，传统行业如何应对AI新物种的颠覆？',
          '在职场中遇到非对称博弈与猜疑链时，该如何破局？',
        ];
      }
      if (skill?.id === 'skill-charlie') {
        return [
          '面对重大的投资与择业选择，如何用逆向思维进行压力测试？',
          '如何快速建立一套属于我自己的“多元思维模型格栅”？',
          '请帮我剖析常见的认知偏差，如何在决策时避免“铁锤人综合征”？',
        ];
      }
      if (skill?.id === 'skill-naval') {
        return [
          '普通人如何找到自己独一无二的“专长”并将其商业化？',
          '在AI时代，如何利用代码和媒体建立无许可的杠杆？',
          '如何平衡高强度的事业追求与内心的长久宁静？',
        ];
      }
      return [
        `结合${formatBookTitle(skill?.title || '本书')}的导师定位，核心底层逻辑是什么？`,
        `原著中解决核心矛盾最具启发性的思维模型是什么？`,
        `结合实际工作与生活场景，第一步落地实践方案是什么？`,
      ];
    }

    const q = userQuery.trim();
    const bookTitle = skill ? formatBookTitle(skill.title) : '本书';
    const cleanTerm = q
      .replace(/如何|怎么|在|中|运用|表达|实现|处理|关于|解决|请问|探讨|分析|理解|吗|呢|？|\?|思考|看待/g, '')
      .trim();
    const shortTerm = cleanTerm.slice(0, 12) || '这个核心议题';

    return [
      `关于“${shortTerm}”，在具体落地时最容易被忽略的细节是什么？`,
      `结合${bookTitle}的核心逻辑，能否给我提供一个可操作的练习方案？`,
      `如果在此基础上更深入，下一个最值得探索的关联议题是什么？`,
    ];
  };

  useEffect(() => {
    if (mainView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeSession?.messages, currentStreamingText, mainView]);

  // Auto-generate recommended questions via LLM if active skill has systemPrompt but no sampleQuestions
  useEffect(() => {
    if (!activeSkill || !activeSkill.systemPrompt) return;
    if (Array.isArray(activeSkill.sampleQuestions) && activeSkill.sampleQuestions.length > 0) return;

    let isMounted = true;
    const fetchQuestions = async () => {
      try {
        const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const res = await fetch('/api/skills/generate-questions', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            systemPrompt: activeSkill.systemPrompt,
            title: activeSkill.title,
            author: activeSkill.author,
            skillId: activeSkill.id,
          }),
        });
        const data = await res.json();
        if (isMounted && data.success && Array.isArray(data.questions) && data.questions.length > 0) {
          const qs: string[] = data.questions;
          if (setSkills) {
            setSkills((prev) =>
              prev.map((s) => (s.id === activeSkill.id ? { ...s, sampleQuestions: qs } : s))
            );
          }
          setSelectedSkill({ ...activeSkill, sampleQuestions: qs });
          // Also update session initial message if it was using placeholder
          setSessions((prev) =>
            prev.map((sess) => {
              if (sess.skillId === activeSkill.id && sess.messages.length > 0) {
                const firstMsg = sess.messages[0];
                if (!firstMsg.recommendedQuestions || firstMsg.recommendedQuestions.length === 0) {
                  const updatedFirst = { ...firstMsg, recommendedQuestions: qs };
                  return { ...sess, messages: [updatedFirst, ...sess.messages.slice(1)] };
                }
              }
              return sess;
            })
          );
        }
      } catch (err) {
        console.warn('Background question generation error:', err);
      }
    };

    fetchQuestions();
    return () => {
      isMounted = false;
    };
  }, [activeSkill?.id, activeSkill?.systemPrompt]);

  const handleLogout = async () => {
    try {
      localStorage.removeItem('auth_token');
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.warn('Logout API error:', e);
    }
    setUser(loadGuestUser());
    setSessions([]);
    setActiveSessionId(null);
    setMainView('market');
    setIsUserMenuOpen(false);
  };

  const checkQuotaAndCanProceed = (): boolean => {
    if (user.role === 'admin' || user.isAdmin) return true;

    // 1. Guest user (未登录游客)
    if (effectiveTier === 'guest') {
      const guestLimit = limits.guestUser ?? 3;
      if ((user.guestUsedCount || 0) >= guestLimit) {
        showToast(`您当前还未注册登录，今日体验额度${guestLimit}次已用完（每日零点刷新），请登录后继续体验。`, 'warning');
        return false;
      }
      return true;
    }

    // 2. Member (普通会员 / VIP会员)
    const used = user.dailyUsedCount || 0;
    if (used >= currentQuotaLimit) {
      if (effectiveTier === 'free_member') {
        showToast(`今日普通会员免费额度已达上限 (${currentQuotaLimit}/${currentQuotaLimit}次)，每日零点自动刷新，开通VIP会员可享更高调用额度。`, 'info');
      } else {
        showToast(`您本月${memberBadgeText}对话额度已达上限 (${currentQuotaLimit}/${currentQuotaLimit}次)，每月1号零点自动刷新。`, 'info');
      }
      return false;
    }
    return true;
  };

  const consumeQuota = () => {
    if (user.role === 'guest') {
      // 游客额度按日计算：当日已用次数持久化，刷新页面不清零，跨天自动归零
      rememberGuestCount((user.guestUsedCount || 0) + 1);
      setUser((prev) => ({
        ...prev,
        guestUsedCount: (prev.guestUsedCount || 0) + 1,
      }));
    } else {
      setUser((prev) => ({
        ...prev,
        dailyUsedCount: (prev.dailyUsedCount || 0) + 1,
      }));
    }
  };

  const handleSendMessage = async (overrideText?: string) => {
    const textToSend = overrideText || inputText;
    if (!textToSend.trim() || isGenerating || !activeSession || !activeSkill) return;

    if (!checkQuotaAndCanProceed()) return;
    consumeQuota();

    const nowFormatted = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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

    const token = localStorage.getItem('auth_token');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers,
        signal: abortController.signal,
        body: JSON.stringify({
          sessionId: targetSessionId,
          skillId: activeSkill.id,
          messageText: textToSend,
          userId: user.id,
        }),
      });

      if (!response.ok) {
        if (onRefreshUser) onRefreshUser();
        const errJson = await response.json().catch(() => ({}));
        if (response.status === 401) {
          showToast(errJson.message || '游客今日体验额度已用完，请登录会员账号继续。', 'warning');
        } else if (response.status === 402 || response.status === 403 || response.status === 429) {
          showToast(errJson.message || '对话额度已用完，请稍后再试。', 'info');
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
            if (data.user) {
              // 游客态服务端无记录，跳过同步以免清零本地当日计数
              setUser((prev) => (prev.role === 'guest' ? prev : data.user));
            }
            if (data.done) {
              finalizedMsg = data.assistantMessage;
              if (data.user) setUser((prev) => (prev.role === 'guest' ? prev : data.user));
            }
          } catch {
            // ignore malformed SSE line
          }
        }
      }

      if (abortController.signal.aborted) return;

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
        content: accumulatedText || '已为您分析完毕。',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
        content: `[服务提示] ${err?.message || '网络连接中断，请重试'}`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const sortedSkills = [...skills].sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0));

  const marketFilteredSkills = skills
    .filter((skill) => {
      const mappedCategory = renamedCategoriesMap[skill.category] || skill.category;
      const matchesCategory =
        selectedCategory === '全部' ||
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
            <span className="font-serif font-bold text-lg text-gray-900 tracking-tight">问书</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              onClick={() => {
                if (user.role === 'guest') {
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
                {user.role === 'guest' ? (
                  <>
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    <span>登录 / 注册</span>
                  </>
                ) : (
                  <>
                    <User className="w-3.5 h-3.5 text-[#8c6227]" />
                    <span className="font-semibold text-gray-900">{formatUserDisplayName(user.nickname)}</span>
                  </>
                )}
              </div>
            </button>

            {isUserMenuOpen && (
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
                        <div className="text-xs font-bold text-gray-900 truncate">
                          {formatUserDisplayName(user.nickname)}
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                          ID: {user.id ? user.id.replace(/^usr_/, '') : 'guest'}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${memberBadgeClass}`}>
                          {memberBadgeText}
                        </span>
                        <span className="text-[11px] text-gray-400 font-mono font-normal">
                          {user.membershipExpiresAt
                            ? new Date(user.membershipExpiresAt).toLocaleDateString('zh-CN').replace(/\//g, '-')
                            : (effectiveTier === 'yearly_member' || effectiveTier === 'quarterly_member' || effectiveTier === 'monthly_member'
                                ? '2027-9-4'
                                : '永久有效')}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quota Stats */}
                  <div className="space-y-1.5 px-0.5 py-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 font-medium">{isMonthlyQuota ? '本月调用额度' : '今日调用额度'}</span>
                      <span className="font-mono font-semibold text-slate-800">
                        {currentQuotaUsed} / {currentQuotaLimit}{' '}
                        <span className="text-[11px] text-gray-400 font-mono font-normal">{isMonthlyQuota ? '次/月' : '次/日'}</span>
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
                    {user.role === 'guest' ? (
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false);
                          onOpenLogin();
                        }}
                        className="w-full py-2 bg-[#f4efe6] hover:bg-[#eae1d0] text-[#2c221e] border border-[#ded3be] rounded-xl text-xs font-bold text-center transition-all cursor-pointer shadow-2xs"
                      >
                        <span>登录 / 注册</span>
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
                          会员订阅
                        </button>
                        <button
                          onClick={handleLogout}
                          className="w-full py-1.5 bg-gray-50 hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-xl text-xs font-bold text-center transition-all cursor-pointer border border-gray-200 flex items-center justify-center gap-1.5"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          退出登录
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
                <LayoutGrid className="w-4 h-4 text-gray-700" />
                <span>书籍广场</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ChevronRight className="w-3.5 h-3.5 opacity-70 text-gray-400" />
              </div>
            </button>
          </div>

          {/* Middle Scrollable Section: Sessions List */}
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            <div className="px-2 py-1 text-[11px] font-mono font-semibold text-gray-400 uppercase tracking-wider flex items-center justify-between">
              <span>对话列表</span>
              <span className="text-[11px]">{sessions.length}</span>
            </div>

            {sessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-gray-400">
                <p>暂无对话记录</p>
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
                          <span className="truncate">{formatBookTitle(session.skillTitle)}</span>
                          <span className="text-gray-400 font-normal ml-1 shrink-0">
                            · {session.skillAuthor}
                          </span>
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
                      title="删除对话记录"
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
            /* ==================== MARKET VIEW GRID (3 COLUMNS) ==================== */
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-gray-50/50">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 md:gap-4">
                {/* Search Bar */}
                <div className="relative w-full sm:w-72 md:w-80 shrink-0">
                  <Search className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={marketSearch}
                    onChange={(e) => setMarketSearch(e.target.value)}
                    placeholder="搜索书名或作者..."
                    className="w-full pl-11 pr-10 py-2 bg-white text-sm text-gray-900 placeholder:text-gray-400 rounded-full outline-none focus:ring-2 focus:ring-gray-300 transition-all font-sans shadow-xs border border-gray-200"
                  />
                  {marketSearch && (
                    <button
                      onClick={() => setMarketSearch('')}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Category Tags */}
                <div className="relative flex-1 min-w-0 flex items-center">
                  <div
                    ref={tagsContainerRef}
                    className="max-h-[68px] overflow-hidden flex flex-wrap items-center gap-1.5 sm:gap-2 transition-all w-full"
                  >
                    {/* 全部 */}
                    <button
                      onClick={() => setSelectedCategory('全部')}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                        selectedCategory === '全部'
                          ? 'bg-[#f4efe6] text-[#2c221e] font-bold shadow-2xs'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                      }`}
                    >
                      #全部 ({skills.length})
                    </button>

                    {/* Category Tags */}
                    {(() => {
                      const visibleList = otherCategories.slice(0, maxVisibleCategories);
                      const hasMore = maxVisibleCategories < otherCategories.length;

                      return (
                        <>
                          {visibleList.map((cat) => (
                            <button
                              key={cat}
                              onClick={() => setSelectedCategory(cat)}
                              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                                selectedCategory === cat
                                  ? 'bg-[#f4efe6] text-[#2c221e] font-bold shadow-2xs'
                                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                              }`}
                            >
                              #{cat}
                            </button>
                          ))}

                          {hasMore && (
                            <button
                              onClick={() => setIsAllCategoriesModalOpen(true)}
                              className="px-2 py-1 rounded-lg text-xs font-bold text-gray-500 hover:text-gray-900 hover:bg-gray-100/80 cursor-pointer transition-colors whitespace-nowrap"
                              title="点击查看全部标签"
                            >
                              ...
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Grid Layout: Displays 3 items per row on lg screens */}
              {marketFilteredSkills.length === 0 ? (
                <div className="p-12 text-center text-sm text-gray-400">暂无卡片</div>
              ) : (
                <div className="space-y-6 pb-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {displayedSkills.map((skill) => {
                      const globalRank = sortedSkills.findIndex((s) => s.id === skill.id) + 1;
                      return (
                        <SkillCard
                          key={skill.id}
                          skill={skill}
                          rank={globalRank}
                          user={user}
                          selectedCategory={selectedCategory}
                          renamedCategoriesMap={renamedCategoriesMap}
                          deletedCategoriesSet={deletedCategoriesSet}
                          validCategories={categories}
                          onSelectSkill={handleSelectBookFromMarket}
                          onViewDetail={(skill) => setDetailSkill(skill)}
                        />
                      );
                    })}
                  </div>

                  {/* Load more / expand button when >= 20 cards */}
                  {hasMoreCards && (
                    <div className="flex flex-col items-center justify-center pt-3 pb-4">
                      <button
                        type="button"
                        onClick={() => setVisibleCardCount((prev) => prev + PAGE_SIZE)}
                        className="group px-6 py-2.5 rounded-full bg-white hover:bg-[#f4efe6] text-[#2c221e] border border-gray-300 hover:border-[#ded3be] text-xs font-semibold shadow-2xs hover:shadow-xs transition-all duration-200 flex items-center gap-2 cursor-pointer active:scale-98"
                      >
                        <span>展开继续加载</span>
                        <span className="text-gray-400 group-hover:text-gray-600 font-normal">
                          (已展示 {displayedSkills.length}/{marketFilteredSkills.length} · 剩余 {remainingCount} 本)
                        </span>
                        <ChevronDown className="w-4 h-4 text-gray-500 group-hover:text-[#2c221e] group-hover:translate-y-0.5 transition-transform" />
                      </button>
                    </div>
                  )}

                  {!hasMoreCards && marketFilteredSkills.length > PAGE_SIZE && (
                    <div className="text-center py-4 text-xs text-gray-400 flex items-center justify-center gap-2">
                      <span className="w-8 h-px bg-gray-200"></span>
                      <span>已展示全部 {marketFilteredSkills.length} 本原著书籍</span>
                      <span className="w-8 h-px bg-gray-200"></span>
                    </div>
                  )}
                </div>
              )}
            </div>
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
                  <span>新建对话</span>
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
                            {isUser ? formatUserDisplayName(user.nickname) : activeSkill?.title}
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
                                title="复制回答"
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
                                  <span>推荐追问：</span>
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
                        <span className="font-semibold text-gray-800">深度思考中</span>
                        <span className="text-gray-300">|</span>
                        <span className="flex items-center gap-1 font-mono font-medium text-gray-900">
                          <Clock className="w-3 h-3 text-gray-500 shrink-0" />
                          已思考 {thinkingSeconds.toFixed(1)} 秒
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
                            ? `模型深度思考回答中... 可先在此输入下一条消息（回答完成后点击发送）`
                            : `上个对话（${formatBookTitle(
                                sessions.find((s) => s.id === generatingSessionId)?.skillTitle ||
                                  '原著'
                              )}）正在回答中... 可先在此输入内容`
                          : activeSkill
                          ? `向${formatBookTitle(activeSkill.title)}提出你的思考问题...`
                          : '请输入您的问题...'
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
                                ? '回答中...'
                                : '等待回答完成...'}
                            </span>
                          </>
                        ) : (
                          <>
                            <span>发起对话</span>
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

      {/* Delete Confirmation Modal */}
      {deletingSession && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl border border-gray-200 p-5 space-y-4 text-left">
            <h3 className="text-sm font-serif font-bold text-gray-900">确认删除对话记录？</h3>
            <p className="text-xs text-gray-600 leading-relaxed">
              将清除{formatBookTitle(deletingSession.skillTitle)}的本条对话历史，此操作不可撤销。
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setDeletingSession(null)}
                className="px-3.5 py-1.5 rounded-xl text-xs text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() => {
                  handleDeleteSession(deletingSession.id);
                  setDeletingSession(null);
                }}
                className="px-3.5 py-1.5 rounded-xl text-xs text-[#2c221e] bg-[#f4efe6] hover:bg-[#eae3d5] border border-[#e2d8c3] transition-colors cursor-pointer font-bold shadow-2xs"
              >
                确认删除
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
                <span>全部图书标签</span>
                <span className="text-xs font-sans font-normal text-gray-500">
                  (共 {categories.length} 个标签)
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
                    #{cat === '全部' ? `全部 (${skills.length})` : cat}
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
              title="关闭"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="space-y-2 px-2 pt-1">
              <h3 className="font-bold text-sm text-gray-900">
                {toastInfo.type === 'warning' ? '温馨提示' : toastInfo.type === 'success' ? '操作成功' : '提示'}
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
