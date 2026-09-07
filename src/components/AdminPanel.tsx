import React, { useState, useEffect } from 'react';
import { LLMConfig, Skill, UserProfile, formatBookTitle, getEffectiveMembershipTier } from '../types';
import ReactMarkdown from 'react-markdown';
import { DEFAULT_USER_AGREEMENT, DEFAULT_PRIVACY_POLICY } from '../data/initialData';
import {
  Settings,
  Cpu,
  Coins,
  UploadCloud,
  Database,
  RefreshCw,
  CheckCircle2,
  X,
  Plus,
  BookOpen,
  Users,
  LayoutDashboard,
  Trash2,
  Edit2,
  TrendingUp,
  Save,
  Tags,
  FolderTree,
  Flame,
  Hash,
  ShieldCheck,
  Zap,
  KeyRound,
  ChevronDown,
  ChevronLeft,
  MoreHorizontal,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Search,
  Check,
  FileText,
  Eye,
  RotateCcw,
  Bot,
  UserPlus,
  Calendar,
  Clock,
  Phone,
  ChevronRight,
  Sparkles,
  Loader2,
} from 'lucide-react';

interface AdminPanelProps {
  llmConfig: LLMConfig;
  setLlmConfig: React.Dispatch<React.SetStateAction<LLMConfig>>;
  skills: Skill[];
  setSkills: React.Dispatch<React.SetStateAction<Skill[]>>;
  user: UserProfile;
  setUser: React.Dispatch<React.SetStateAction<UserProfile>>;
  onClose: () => void;
}

interface AdminStats {
  totalUsers: number;
  totalSkills: number;
  totalSessions: number;
  totalReferrals: number;
}

const formatHeatCount = (count?: number) => {
  if (!count) return '0';
  if (count >= 10000) {
    return `${(count / 10000).toFixed(1)}w`;
  }
  return `${count}`;
};

const PAGE_SIZE = 50;

interface PaginationProps {
  currentPage: number;
  totalItems: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalItems,
  pageSize = PAGE_SIZE,
  onPageChange,
}) => {
  const totalPages = Math.ceil(totalItems / pageSize) || 1;

  if (totalItems === 0) {
    return (
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 rounded-b-xl">
        <span>暂无数据</span>
      </div>
    );
  }

  const getPageNumbers = () => {
    const pages: (number | string)[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push('...');
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push('...');
      pages.push(totalPages);
    }
    return pages;
  };

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 rounded-b-xl">
      <div className="font-mono text-slate-500">
        显示第 <span className="font-semibold text-slate-800">{startItem}</span> - <span className="font-semibold text-slate-800">{endItem}</span> 条，共 <span className="font-semibold text-slate-800">{totalItems}</span> 条记录
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
          className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors font-medium"
        >
          上一页
        </button>

        {getPageNumbers().map((p, idx) =>
          typeof p === 'number' ? (
            <button
              key={idx}
              type="button"
              onClick={() => onPageChange(p)}
              className={`min-w-[28px] h-7 px-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                currentPage === p
                  ? 'bg-slate-900 text-white shadow-2xs'
                  : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          ) : (
            <span key={idx} className="px-1 text-slate-400 font-bold">
              ...
            </span>
          )
        )}

        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
          className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors font-medium"
        >
          下一页
        </button>
      </div>
    </div>
  );
};

export const AdminPanel: React.FC<AdminPanelProps> = ({
  llmConfig,
  setLlmConfig,
  skills,
  setSkills,
  user,
  setUser,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'skills' | 'categories' | 'resources' | 'users' | 'llm' | 'agreements'>('skills');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [adminUsers, setAdminUsers] = useState<UserProfile[]>([]);
  const [previewAgreementType, setPreviewAgreementType] = useState<'terms' | 'privacy' | null>(null);

  // Pagination States
  const [skillsPage, setSkillsPage] = useState(1);
  const [categoriesPage, setCategoriesPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);

  // Search Query States
  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [userSearchQuery, setUserSearchQuery] = useState('');

  // Action Dropdown State
  const [openSkillMenuId, setOpenSkillMenuId] = useState<string | null>(null);
  const [openCatMenuName, setOpenCatMenuName] = useState<string | null>(null);

  // Skill Modal State
  const [editingSkill, setEditingSkill] = useState<Partial<Skill> | null>(null);
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  // Category / Tag Management State - strictly database-driven
  const [dbCategories, setDbCategories] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const [testingLLM, setTestingLLM] = useState(false);
  const [llmTestResult, setLlmTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [isAddCategoryOpen, setIsAddCategoryOpen] = useState(false);
  const [newCatInput, setNewCatInput] = useState('');
  const [editingCategory, setEditingCategory] = useState<{ oldName: string; newName: string } | null>(null);

  // User Management State
  const [agreementActiveTab, setAgreementActiveTab] = useState<'userAgreement' | 'privacyPolicy'>('userAgreement');
  const [isAddUserModalOpen, setIsAddUserModalOpen] = useState(false);
  const [addUserForm, setAddUserForm] = useState<{
    phone: string;
    code: string;
    membershipTier: 'free_member' | 'monthly_member' | 'quarterly_member' | 'yearly_member';
  }>({
    phone: '',
    code: '',
    membershipTier: 'monthly_member',
  });

  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editUserForm, setEditUserForm] = useState<{
    phone: string;
    code: string;
    membershipTier: 'free_member' | 'monthly_member' | 'quarterly_member' | 'yearly_member';
  }>({
    phone: '',
    code: '',
    membershipTier: 'monthly_member',
  });

  // Deletion Confirmation Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: '',
    description: '',
    onConfirm: () => {},
  });

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [resStats, resSkills, resUsers, resLlm, resTags] = await Promise.all([
        fetch('/api/admin/stats').then((r) => r.json()),
        fetch('/api/skills').then((r) => r.json()),
        fetch('/api/admin/users').then((r) => r.json()),
        fetch('/api/admin/llm-config').then((r) => r.json()),
        fetch('/api/tags').then((r) => r.json()),
      ]);

      if (resStats.stats) setStats(resStats.stats);
      if (resSkills.skills) setSkills(resSkills.skills);
      if (resUsers.users) setAdminUsers(resUsers.users);
      if (resLlm.llmConfig) setLlmConfig(resLlm.llmConfig);
      if (resTags && Array.isArray(resTags.tags)) {
        setDbCategories(resTags.tags);
      }
    } catch (e) {
      console.error('Failed to fetch admin data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLLMConfig = async () => {
    try {
      const res = await fetch('/api/admin/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmConfig }),
      });
      const data = await res.json();
      if (data.success && data.llmConfig) {
        setLlmConfig(data.llmConfig);
        setUser((prev) => {
          const effectiveTier = getEffectiveMembershipTier(prev);
          let limit = data.llmConfig.dailyLimits?.freeMember ?? 10;
          if (prev.role === 'guest') {
            limit = data.llmConfig.dailyLimits?.guestUser ?? 3;
          } else if (effectiveTier === 'monthly_member') {
            limit = data.llmConfig.dailyLimits?.monthlyMember ?? 100;
          } else if (effectiveTier === 'quarterly_member') {
            limit = data.llmConfig.dailyLimits?.quarterlyMember ?? 200;
          } else if (effectiveTier === 'yearly_member') {
            limit = data.llmConfig.dailyLimits?.yearlyMember ?? 500;
          }
          return { ...prev, dailyMaxChats: limit };
        });
        fetchAdminData();
        showToast('配置已成功保存并实时生效！');
      } else {
        showToast('保存配置失败，请重试');
      }
    } catch (err) {
      console.error('Error saving LLM config:', err);
      showToast('保存配置出现异常');
    }
  };

  const handleCreateUser = async () => {
    const cleanPhone = addUserForm.phone.trim();
    if (!cleanPhone) {
      showToast('请输入手机号码');
      return;
    }
    if (!/^\d{11}$/.test(cleanPhone)) {
      showToast('手机号码必须为11位阿拉伯数字');
      return;
    }
    const cleanCode = addUserForm.code.trim();
    if (!cleanCode) {
      showToast('请输入登录验证码');
      return;
    }
    if (!/^\d{6}$/.test(cleanCode)) {
      showToast('验证码必须为6位阿拉伯数字');
      return;
    }
    try {
      const payload = {
        phone: cleanPhone,
        code: cleanCode,
        membershipTier: addUserForm.membershipTier,
      };
      const res = await fetch('/api/admin/users/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        showToast('内部用户创建成功！');
        setIsAddUserModalOpen(false);
        setAddUserForm({
          phone: '',
          code: '',
          membershipTier: 'monthly_member',
        });
        fetchAdminData();
      } else {
        showToast(data.error || '创建用户失败');
      }
    } catch (err) {
      console.error('Error creating user:', err);
      showToast('创建用户请求异常');
    }
  };

  const handleOpenEditUser = (u: UserProfile) => {
    setEditingUser(u);
    const effectiveTier = getEffectiveMembershipTier(u);
    const validTier: 'free_member' | 'monthly_member' | 'quarterly_member' | 'yearly_member' =
      effectiveTier === 'guest' ? 'free_member' : (effectiveTier as any);
    const phoneDisplay = u.phone || (u.role === 'guest' ? '游客账号' : (u.id ? `138****${u.id.slice(-4)}` : '13800000000'));
    setEditUserForm({
      phone: phoneDisplay,
      code: u.password || '',
      membershipTier: validTier,
    });
  };

  const handleSaveEditUser = async () => {
    if (!editingUser) return;
    const cleanCode = editUserForm.code.trim();
    if (cleanCode && !/^\d{6}$/.test(cleanCode)) {
      showToast('验证码必须为6位阿拉伯数字');
      return;
    }
    try {
      const res = await fetch('/api/admin/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: editingUser.id,
          phone: editUserForm.phone.trim(),
          code: cleanCode,
          password: cleanCode,
          membershipTier: editUserForm.membershipTier,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('用户信息与权益已成功更新');
        if (user.id === editingUser.id && data.user) {
          setUser(data.user);
        }
        setEditingUser(null);
        fetchAdminData();
      } else {
        showToast(data.error || '更新失败');
      }
    } catch {
      showToast('更新异常');
    }
  };

  const handleResetUserQuota = async (u: UserProfile) => {
    try {
      const res = await fetch('/api/admin/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: u.id,
          resetQuota: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`已重置用户 "${u.nickname || u.id}" 的今日额度`);
        if (user.id === u.id) {
          setUser((prev) => ({ ...prev, dailyUsedCount: 0, guestUsedCount: 0 }));
        }
        fetchAdminData();
      } else {
        showToast('重置失败');
      }
    } catch {
      showToast('请求异常');
    }
  };

  const handleDeleteUser = (u: UserProfile) => {
    setConfirmModal({
      isOpen: true,
      title: '确认删除用户',
      description: `确定要删除用户 "${u.nickname || u.id}" 吗？删除后该用户数据与对话记录将被移除。`,
      confirmText: '确认删除',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            showToast('用户已删除');
            fetchAdminData();
          } else {
            showToast('删除失败');
          }
        } catch {
          showToast('请求异常');
        }
      },
    });
  };

  const handleTestLLM = async () => {
    setTestingLLM(true);
    setLlmTestResult(null);
    try {
      const res = await fetch('/api/admin/llm-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiBaseUrl: llmConfig.apiBaseUrl,
          apiKey: llmConfig.apiKey,
          primaryModel: llmConfig.primaryModel,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLlmTestResult({
          success: true,
          message: `连接成功 (耗时: ${data.latencyMs}ms) - 模型 [${data.model}] 响应正常`,
        });
      } else {
        setLlmTestResult({
          success: false,
          message: `连接失败: ${data.error || '无法与模型端点建立连接'}`,
        });
      }
    } catch (err: any) {
      setLlmTestResult({
        success: false,
        message: `网络请求异常: ${err?.message || '无法发送测试请求'}`,
      });
    } finally {
      setTestingLLM(false);
    }
  };

  useEffect(() => {
    fetchAdminData();
    try {
      localStorage.removeItem('admin_custom_categories');
      localStorage.removeItem('admin_deleted_categories');
      localStorage.removeItem('admin_renamed_categories');
      localStorage.removeItem('admin_category_order');
    } catch {}
  }, []);

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 2500);
  };

  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);

  const handleGenerateQuestionsForSkill = async (
    content: string,
    title?: string,
    author?: string
  ) => {
    if (!content || !content.trim()) return;
    setIsGeneratingQuestions(true);
    try {
      const token = localStorage.getItem('auth_token') || localStorage.getItem('token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/skills/generate-questions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          systemPrompt: content,
          title: title || editingSkill?.title,
          author: author || editingSkill?.author,
          skillId: editingSkill?.id,
        }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.questions) && data.questions.length > 0) {
        setEditingSkill((prev) => (prev ? { ...prev, sampleQuestions: data.questions } : null));
        showToast('大模型已根据上传文档提炼生成专属推荐追问！');
      }
    } catch (e) {
      console.error('Failed to generate skill questions:', e);
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  const handleSaveSkill = async () => {
    if (!editingSkill?.title?.trim() || !editingSkill?.author?.trim()) {
      alert('请填写真实的书籍名称与作者');
      return;
    }

    const rawSelected = Array.isArray(editingSkill.tags) ? editingSkill.tags : [];
    const validTags = Array.from(
      new Set(rawSelected.filter((t) => t && allCategoryNames.includes(t)))
    );

    if (validTags.length === 0) {
      alert('所属标签为必须添加项，请在标签列表中至少点击选择一个标签！');
      return;
    }

    const primaryCat = validTags[0];
    const skillToSave = {
      ...editingSkill,
      title: editingSkill.title.trim(),
      author: editingSkill.author.trim(),
      category: primaryCat,
      tags: validTags,
    };

    try {
      const res = await fetch('/api/admin/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: skillToSave }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('导师数据更新成功！');
        setIsSkillModalOpen(false);
        setEditingSkill(null);
        if (data.skill && setSkills) {
          setSkills((prev) =>
            prev.map((item) => (item.id === data.skill.id ? data.skill : item))
          );
        }
        fetchAdminData();
      }
    } catch (e) {
      alert('保存失败，请检查网络');
    }
  };

  const handleDeleteSkill = (id: string, title: string) => {
    setConfirmModal({
      isOpen: true,
      title: '确认下架并删除导师',
      description: `确定要下架并删除《${formatBookTitle(title)}》原著导师吗？该操作不可撤销。`,
      confirmText: '确认删除',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/admin/skills/${id}`, { method: 'DELETE' });
          const data = await res.json();
          if (data.success) {
            showToast(`已成功下架《${formatBookTitle(title)}》`);
            fetchAdminData();
          }
        } catch (e) {
          alert('删除失败');
        }
      },
    });
  };

  // Category Operations - 100% Database Driven
  const handleRenameCategory = async (oldCategory: string, newCategory: string) => {
    if (!newCategory || !newCategory.trim() || oldCategory === newCategory) {
      setEditingCategory(null);
      return;
    }
    const trimmed = newCategory.trim();
    if (dbCategories.includes(trimmed)) {
      alert(`标签【${trimmed}】已存在`);
      return;
    }

    const nextTags = dbCategories.map((c) => (c === oldCategory ? trimmed : c));
    setDbCategories(nextTags);
    try {
      await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tags: nextTags,
          renamedMap: { [oldCategory]: trimmed },
        }),
      });
      window.dispatchEvent(new Event('category_order_updated'));
    } catch (e) {
      alert('更新标签失败');
    }

    showToast(`已成功将标签【${oldCategory}】更新为【${trimmed}】`);
    setEditingCategory(null);
    fetchAdminData();
  };

  const handleDeleteCategory = (catToDelete: string) => {
    const affectedSkills = skills.filter(
      (s) => s.category === catToDelete || s.tags?.includes(catToDelete)
    );
    const desc =
      affectedSkills.length > 0
        ? `标签【${catToDelete}】下共有 ${affectedSkills.length} 本书籍。是否确定删除该标签？删除后关联书籍将自动解绑该标签。`
        : `确定要删除标签【${catToDelete}】吗？删除后此标签将不再显示。`;

    setConfirmModal({
      isOpen: true,
      title: '确认删除图书标签',
      description: desc,
      confirmText: '确认删除',
      onConfirm: async () => {
        const nextTags = dbCategories.filter((c) => c !== catToDelete);
        setDbCategories(nextTags);
        try {
          await fetch('/api/admin/tags', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tags: nextTags,
              deletedTags: [catToDelete],
            }),
          });
          window.dispatchEvent(new Event('category_order_updated'));
        } catch (e) {
          alert('删除标签失败');
        }

        showToast(`已删除标签【${catToDelete}】`);
        fetchAdminData();
      },
    });
  };

  const handleAddNewCategory = async () => {
    if (!newCatInput || !newCatInput.trim()) return;
    const catName = newCatInput.trim();

    if (dbCategories.includes(catName)) {
      alert(`标签【${catName}】已存在`);
      return;
    }

    const next = [...dbCategories, catName];
    setDbCategories(next);
    try {
      await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: next }),
      });
      window.dispatchEvent(new Event('category_order_updated'));
    } catch (e) {
      alert('添加标签失败');
    }

    setNewCatInput('');
    setIsAddCategoryOpen(false);
    showToast(`已成功创建标签【${catName}】`);
    fetchAdminData();
  };

  const handleMoveCategory = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= dbCategories.length) return;

    const newCategoryNames = [...dbCategories];
    const [movedItem] = newCategoryNames.splice(index, 1);
    newCategoryNames.splice(targetIndex, 0, movedItem);

    setDbCategories(newCategoryNames);
    try {
      await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newCategoryNames }),
      });
      window.dispatchEvent(new Event('category_order_updated'));
    } catch (e) {
      console.error(e);
    }

    showToast(`已将【${movedItem}】调整至第 ${targetIndex + 1} 位`);
  };

  const handleDragStart = (e: React.DragEvent<HTMLTableRowElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent<HTMLTableRowElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = async (e: React.DragEvent<HTMLTableRowElement>, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const newCategoryNames = [...dbCategories];
    const [movedItem] = newCategoryNames.splice(draggedIndex, 1);
    newCategoryNames.splice(dropIndex, 0, movedItem);

    setDbCategories(newCategoryNames);
    try {
      await fetch('/api/admin/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: newCategoryNames }),
      });
      window.dispatchEvent(new Event('category_order_updated'));
    } catch (e) {
      console.error(e);
    }

    showToast(`已拖拽【${movedItem}】排序至第 ${dropIndex + 1} 位`);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  // Tag Operations
  const handleRenameTag = async (oldTag: string, newTag: string) => {
    await handleRenameCategory(oldTag, newTag);
  };

  const handleDeleteTag = (tagToDelete: string) => {
    handleDeleteCategory(tagToDelete);
  };

  const handleUpdateUserRole = async (targetUser: UserProfile, newRole: UserProfile['role']) => {
    try {
      const limits = llmConfig.dailyLimits || { guestUser: 3, freeMember: 10 };
      const newMaxChats = newRole === 'guest' ? (limits.guestUser ?? 3) : (limits.freeMember ?? 10);

      const res = await fetch('/api/admin/users/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: targetUser.id,
          role: newRole,
          dailyMaxChats: newMaxChats,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`用户 ${targetUser.nickname} 身份已更新为 ${newRole === 'guest' ? '游客' : '会员'}`);
        if (targetUser.id === user.id) {
          setUser({ ...user, role: newRole, dailyMaxChats: newMaxChats });
        }
        fetchAdminData();
      }
    } catch (e) {
      alert('修改用户失败');
    }
  };

  // Helper metrics for categories & tags - strictly 100% database driven
  const allCategoryNames: string[] = dbCategories;

  const categoryStats = allCategoryNames.map((cat, idx) => {
    const catSkills = skills.filter(
      (s) => s.category === cat || s.tags?.includes(cat)
    );
    return {
      rank: idx + 1,
      name: cat,
      count: catSkills.length,
      books: catSkills.map((s) => s.title),
    };
  });

  // Extract tags map
  const defaultTagsPool = ['精选', '经典原著', '决策思维', '认知提升', '领导力', '商业战术', '心理学', '哲学思考', '理财投资', '科技前沿'];
  const tagCountMap: Record<string, number> = {};
  defaultTagsPool.forEach((t) => {
    tagCountMap[t] = 0;
  });
  skills.forEach((s) => {
    s.tags?.forEach((t) => {
      if (t) tagCountMap[t] = (tagCountMap[t] || 0) + 1;
    });
  });
  const allTagsList = Object.entries(tagCountMap)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  const topHeatSkill =
    skills.length > 0 ? [...skills].sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0))[0] : null;

  return (
    <div className="fixed inset-0 z-50 bg-[#fafafa] flex flex-col h-screen w-screen font-sans overflow-hidden text-slate-800">
      {/* Top Navigation Header - Refined Minimalist Light Theme */}
      <header className="h-14 px-6 bg-white border-b border-slate-200/80 flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center text-white font-semibold text-xs shadow-2xs">
            <Settings className="w-3.5 h-3.5 text-slate-100" />
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-semibold text-sm tracking-tight text-slate-900">控制台管理中心</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60 font-mono">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              服务就绪
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {successMsg && (
            <span className="text-xs text-emerald-800 bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200/80 font-medium flex items-center gap-1.5 animate-fade-in">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              {successMsg}
            </span>
          )}
          <button
            onClick={onClose}
            className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-medium rounded-lg border border-slate-200 shadow-2xs transition-colors cursor-pointer flex items-center gap-1.5"
            title="退出后台，返回客户端界面"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
            <span>返回前台</span>
          </button>
        </div>
      </header>

      {/* Main Flex Wrapper with Left Sidebar */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Sidebar Navigation - Minimalist Clean Theme */}
        <aside className="w-56 shrink-0 border-r border-slate-200/80 bg-white flex flex-col p-3 gap-1 overflow-y-auto">
          <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
            业务管理
          </div>

          <button
            onClick={() => setActiveTab('skills')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === 'skills'
                ? 'bg-slate-900 text-white font-medium shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center gap-2.5 truncate">
              <BookOpen className={`w-4 h-4 shrink-0 ${activeTab === 'skills' ? 'text-white' : 'text-slate-500'}`} />
              <span className="truncate">导师书籍</span>
            </div>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'skills' ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {skills.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('categories')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === 'categories'
                ? 'bg-slate-900 text-white font-medium shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center gap-2.5 truncate">
              <FolderTree className={`w-4 h-4 shrink-0 ${activeTab === 'categories' ? 'text-white' : 'text-slate-500'}`} />
              <span className="truncate">标签管理</span>
            </div>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'categories' ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {allCategoryNames.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('users')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === 'users'
                ? 'bg-slate-900 text-white font-medium shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center gap-2.5 truncate">
              <Users className={`w-4 h-4 shrink-0 ${activeTab === 'users' ? 'text-white' : 'text-slate-500'}`} />
              <span className="truncate">用户权限</span>
            </div>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                activeTab === 'users' ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-500'
              }`}
            >
              {adminUsers.length}
            </span>
          </button>

          <div className="my-2 border-t border-slate-100"></div>
          <div className="px-3 pt-1 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider font-mono">
            全局配置
          </div>

          <button
            onClick={() => setActiveTab('llm')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === 'llm'
                ? 'bg-slate-900 text-white font-medium shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center gap-2.5 truncate">
              <Cpu className={`w-4 h-4 shrink-0 ${activeTab === 'llm' ? 'text-white' : 'text-slate-500'}`} />
              <span className="truncate">模型配置</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('resources')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === 'resources'
                ? 'bg-slate-900 text-white font-medium shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center gap-2.5 truncate">
              <Coins className={`w-4 h-4 shrink-0 ${activeTab === 'resources' ? 'text-white' : 'text-slate-500'}`} />
              <span className="truncate">资源配置</span>
            </div>
          </button>

          <button
            onClick={() => setActiveTab('agreements')}
            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
              activeTab === 'agreements'
                ? 'bg-slate-900 text-white font-medium shadow-2xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
            }`}
          >
            <div className="flex items-center gap-2.5 truncate">
              <FileText className={`w-4 h-4 shrink-0 ${activeTab === 'agreements' ? 'text-white' : 'text-slate-500'}`} />
              <span className="truncate">协议配置</span>
            </div>
          </button>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-7 bg-[#fafafa] space-y-6">
          {/* TAB 1: SKILLS MANAGEMENT */}
          {activeTab === 'skills' && (() => {
              const filteredSkills = skills.filter((s) => {
                if (!skillSearchQuery.trim()) return true;
                const q = skillSearchQuery.trim().toLowerCase();
                return (
                  s.title.toLowerCase().includes(q) ||
                  (s.author && s.author.toLowerCase().includes(q)) ||
                  (s.category && s.category.toLowerCase().includes(q)) ||
                  (s.description && s.description.toLowerCase().includes(q)) ||
                  (s.tags && s.tags.some((t) => t.toLowerCase().includes(q)))
                );
              });

              const safeSkillsPage = Math.min(skillsPage, Math.ceil(filteredSkills.length / PAGE_SIZE) || 1);
              const displayedSkills = filteredSkills.slice((safeSkillsPage - 1) * PAGE_SIZE, safeSkillsPage * PAGE_SIZE);

              return (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="搜索导师书名、作者、标签..."
                        value={skillSearchQuery}
                        onChange={(e) => {
                          setSkillSearchQuery(e.target.value);
                          setSkillsPage(1);
                        }}
                        className="w-full pl-8.5 pr-8 py-1.5 bg-white border border-slate-200/90 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                      />
                      {skillSearchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setSkillSearchQuery('');
                            setSkillsPage(1);
                          }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setEditingSkill({
                          title: '',
                          author: '',
                          description: '',
                          category: '',
                          coverUrl:
                            'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80',
                          tags: [],
                          searchCount: 500,
                          systemPrompt: '你是一位深度理解原著的导师。',
                          bookContent: '',
                        });
                        setIsSkillModalOpen(true);
                      }}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-colors shadow-2xs shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新增导师书籍</span>
                    </button>
                  </div>

                  <div className="border border-slate-200/80 rounded-xl bg-white shadow-2xs overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse table-fixed">
                      <thead className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-medium">
                        <tr>
                          <th className="py-2.5 px-4 font-medium w-auto">书名 / 作者</th>
                          <th className="py-2.5 px-4 font-medium w-40">分类标签</th>
                          <th className="py-2.5 px-4 font-medium w-28">热度指数</th>
                          <th className="py-2.5 px-4 font-medium text-right w-24">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-800 bg-white">
                        {displayedSkills.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-12 text-center text-slate-400 text-xs font-normal">
                              未找到匹配的图书导师
                            </td>
                          </tr>
                        ) : (
                          displayedSkills.map((s) => (
                            <tr key={s.id} className="hover:bg-slate-50/60 transition-colors">
                              <td className="py-3 px-4">
                                <div className="min-w-0 flex items-center gap-2 truncate">
                                  <span className="font-medium text-slate-900 truncate">{s.title}</span>
                                  {s.author && <span className="text-[11px] text-slate-400 shrink-0 font-normal">/ {s.author}</span>}
                                </div>
                              </td>
                              <td className="py-3 px-4 truncate">
                                {(() => {
                                  const valid = Array.from(
                                    new Set(
                                      [...(s.tags || []), ...(s.category ? [s.category] : [])]
                                        .filter((t) => t && allCategoryNames.includes(t))
                                    )
                                  );
                                  if (valid.length === 0) {
                                    return <span className="text-slate-300 text-[11px]">无标签</span>;
                                  }
                                  return (
                                    <div className="flex flex-wrap gap-1">
                                      {valid.map((t) => (
                                        <span key={t} className="px-2 py-0.5 rounded-md bg-slate-100/80 text-slate-700 text-[11px] font-normal border border-slate-200/60 inline-block truncate max-w-full">
                                          {t}
                                        </span>
                                      ))}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                                {formatHeatCount(s.searchCount || 0)}
                              </td>
                              <td className="py-3 px-4 text-right relative">
                                <div className="relative inline-block text-left">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenSkillMenuId(openSkillMenuId === s.id ? null : s.id);
                                    }}
                                    className="px-2.5 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-medium border border-slate-200/80 cursor-pointer transition-colors inline-flex items-center gap-1"
                                  >
                                    <span>操作</span>
                                    <ChevronLeft className="w-3 h-3 text-slate-400" />
                                  </button>

                                  {openSkillMenuId === s.id && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-30"
                                        onClick={() => setOpenSkillMenuId(null)}
                                      />
                                      <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 w-28 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-40 text-xs">
                                        <button
                                          onClick={() => {
                                            setEditingSkill(s);
                                            setIsSkillModalOpen(true);
                                            setOpenSkillMenuId(null);
                                          }}
                                          className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors cursor-pointer"
                                        >
                                          <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                                          <span>编辑</span>
                                        </button>
                                        <div className="my-1 border-t border-slate-100" />
                                        <button
                                          onClick={() => {
                                            handleDeleteSkill(s.id, s.title);
                                            setOpenSkillMenuId(null);
                                          }}
                                          className="w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition-colors cursor-pointer font-medium"
                                        >
                                          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                          <span>删除</span>
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                    <Pagination
                      currentPage={safeSkillsPage}
                      totalItems={filteredSkills.length}
                      pageSize={PAGE_SIZE}
                      onPageChange={(p) => setSkillsPage(p)}
                    />
                  </div>
                </div>
              );
            })()}

            {/* TAB 2: CATEGORIES & TAGS */}
            {activeTab === 'categories' && (() => {
              const safeCategoriesPage = Math.min(categoriesPage, Math.ceil(categoryStats.length / PAGE_SIZE) || 1);
              const displayedCategoryStats = categoryStats.slice((safeCategoriesPage - 1) * PAGE_SIZE, safeCategoriesPage * PAGE_SIZE);

              return (
                <div className="space-y-4">
                  <div className="flex justify-end items-center">
                    <button
                      onClick={() => {
                        setNewCatInput('');
                        setIsAddCategoryOpen(true);
                      }}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新增标签</span>
                    </button>
                  </div>

                  <div className="border border-slate-200/80 rounded-xl bg-white shadow-2xs overflow-hidden">
                    <table className="w-full text-left text-xs border-collapse table-fixed">
                      <thead className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-medium">
                        <tr>
                          <th className="py-2.5 px-4 font-medium w-36">排序与调整</th>
                          <th className="py-2.5 px-4 font-medium w-auto">标签名称</th>
                          <th className="py-2.5 px-4 font-medium w-32">关联书目</th>
                          <th className="py-2.5 px-4 font-medium text-right w-24">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-800 bg-white">
                        {displayedCategoryStats.map((cat, idx) => {
                          const globalIdx = (safeCategoriesPage - 1) * PAGE_SIZE + idx;
                          return (
                            <tr
                              key={cat.name}
                              draggable
                              onDragStart={(e) => handleDragStart(e, globalIdx)}
                              onDragOver={(e) => handleDragOver(e, globalIdx)}
                              onDrop={(e) => handleDrop(e, globalIdx)}
                              className={`transition-colors border-b border-slate-100/80 ${
                                draggedIndex === globalIdx
                                  ? 'opacity-40 bg-slate-100/50'
                                  : dragOverIndex === globalIdx
                                  ? 'bg-slate-100/80 border-t-2 border-t-slate-900'
                                  : 'hover:bg-slate-50/60 bg-white'
                              }`}
                            >
                              <td className="py-2.5 px-4">
                                <div className="flex items-center gap-2">
                                  <div
                                    className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 transition-colors shrink-0"
                                    title="按住拖拽调整顺序"
                                  >
                                    <GripVertical className="w-3.5 h-3.5" />
                                  </div>
                                  <span className="font-mono text-[11px] font-semibold text-slate-400 w-7 text-center shrink-0">
                                    #{cat.rank}
                                  </span>
                                  <div className="flex items-center gap-0.5 shrink-0 ml-auto">
                                    <button
                                      type="button"
                                      disabled={globalIdx === 0}
                                      onClick={() => handleMoveCategory(globalIdx, 'up')}
                                      className={`p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer transition-colors ${
                                        globalIdx === 0 ? 'opacity-20 cursor-not-allowed' : ''
                                      }`}
                                      title="向上移动"
                                    >
                                      <ArrowUp className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={globalIdx === categoryStats.length - 1}
                                      onClick={() => handleMoveCategory(globalIdx, 'down')}
                                      className={`p-1 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 cursor-pointer transition-colors ${
                                        globalIdx === categoryStats.length - 1 ? 'opacity-20 cursor-not-allowed' : ''
                                      }`}
                                      title="向下移动"
                                    >
                                      <ArrowDown className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </td>
                              <td className="py-2.5 px-4">
                                {editingCategory && editingCategory.oldName === cat.name ? (
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <input
                                      type="text"
                                      value={editingCategory.newName}
                                      onChange={(e) =>
                                        setEditingCategory({ oldName: cat.name, newName: e.target.value })
                                      }
                                      className="w-28 px-2 py-1 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shrink-0"
                                    />
                                    <button
                                      onClick={() => handleRenameCategory(cat.name, editingCategory.newName)}
                                      className="px-2 py-1 bg-slate-900 text-white rounded-lg text-[11px] font-medium cursor-pointer hover:bg-slate-800 shrink-0 transition-colors"
                                    >
                                      保存
                                    </button>
                                    <button
                                      onClick={() => setEditingCategory(null)}
                                      className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[11px] font-medium cursor-pointer hover:bg-slate-200 shrink-0 transition-colors"
                                    >
                                      取消
                                    </button>
                                  </div>
                                ) : (
                                  <span className="font-medium text-slate-900 truncate block">{cat.name}</span>
                                )}
                              </td>
                              <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">{cat.count} 本</td>
                              <td className="py-2.5 px-4 text-right relative">
                                <div className="relative inline-block text-left">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenCatMenuName(openCatMenuName === cat.name ? null : cat.name);
                                    }}
                                    className="px-2.5 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-medium border border-slate-200/80 cursor-pointer transition-colors inline-flex items-center gap-1"
                                  >
                                    <span>操作</span>
                                    <ChevronLeft className="w-3 h-3 text-slate-400" />
                                  </button>

                                  {openCatMenuName === cat.name && (
                                    <>
                                      <div
                                        className="fixed inset-0 z-30"
                                        onClick={() => setOpenCatMenuName(null)}
                                      />
                                      <div className="absolute right-full top-1/2 -translate-y-1/2 mr-2 w-28 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-40 text-xs">
                                        <button
                                          onClick={() => {
                                            setEditingCategory({ oldName: cat.name, newName: cat.name });
                                            setOpenCatMenuName(null);
                                          }}
                                          className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors cursor-pointer"
                                        >
                                          <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                                          <span>改名</span>
                                        </button>
                                        <div className="my-1 border-t border-slate-100" />
                                        <button
                                          onClick={() => {
                                            handleDeleteCategory(cat.name);
                                            setOpenCatMenuName(null);
                                          }}
                                          className="w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition-colors cursor-pointer font-medium"
                                        >
                                          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                                          <span>删除</span>
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <Pagination
                      currentPage={safeCategoriesPage}
                      totalItems={categoryStats.length}
                      pageSize={PAGE_SIZE}
                      onPageChange={(p) => setCategoriesPage(p)}
                    />
                  </div>
                </div>
              );
            })()}

            {/* TAB 3: USERS MANAGEMENT */}
            {activeTab === 'users' && (() => {
              const usersList = adminUsers;
              const filteredUsers = usersList.filter((u) => {
                if (!userSearchQuery.trim()) return true;
                const q = userSearchQuery.trim().toLowerCase();
                return (
                  (u.id && u.id.toLowerCase().includes(q)) ||
                  (u.nickname && u.nickname.toLowerCase().includes(q)) ||
                  (u.phone && u.phone.includes(q)) ||
                  (u.role && u.role.toLowerCase().includes(q)) ||
                  (u.membershipTier && u.membershipTier.toLowerCase().includes(q))
                );
              });

              const safeUsersPage = Math.min(usersPage, Math.ceil(filteredUsers.length / PAGE_SIZE) || 1);
              const displayedUsers = filteredUsers.slice((safeUsersPage - 1) * PAGE_SIZE, safeUsersPage * PAGE_SIZE);

              return (
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div className="relative flex-1 w-full sm:max-w-xs">
                      <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        placeholder="搜索用户 ID、手机号..."
                        value={userSearchQuery}
                        onChange={(e) => {
                          setUserSearchQuery(e.target.value);
                          setUsersPage(1);
                        }}
                        className="w-full pl-8.5 pr-8 py-1.5 bg-white border border-slate-200/90 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                      />
                      {userSearchQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setUserSearchQuery('');
                            setUsersPage(1);
                          }}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setIsAddUserModalOpen(true)}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors flex items-center gap-1.5 shrink-0"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>添加内部用户</span>
                    </button>
                  </div>

                  <div className="border border-slate-200/80 rounded-xl bg-white shadow-2xs overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse min-w-[700px]">
                      <thead className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-medium">
                        <tr>
                          <th className="py-2.5 px-4 font-medium">用户 / 账号 ID</th>
                          <th className="py-2.5 px-4 font-medium w-32">会员等级</th>
                          <th className="py-2.5 px-4 font-medium w-36">会员有效期</th>
                          <th className="py-2.5 px-4 font-medium w-32 text-right">本月调用额度</th>
                          <th className="py-2.5 px-4 font-medium text-center w-36">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-slate-800 bg-white">
                        {displayedUsers.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="py-12 text-center text-slate-400 text-xs font-normal">
                              未找到匹配的用户记录
                            </td>
                          </tr>
                        ) : (
                          displayedUsers.map((u) => {
                            const isGuest = u.role === 'guest';
                            const effectiveTier = getEffectiveMembershipTier(u);
                            const limits = llmConfig.dailyLimits || {
                              guestUser: 3,
                              freeMember: 10,
                              monthlyMember: 100,
                              quarterlyMember: 200,
                              yearlyMember: 500,
                            };

                            let tierLabel = '普通会员';
                            let tierBadgeColor = 'bg-slate-100/80 text-slate-600 border border-slate-200/60 font-normal';
                            let maxLimit = u.dailyMaxChats || limits.freeMember || 10;

                            if (effectiveTier === 'yearly_member') {
                              tierLabel = '年度会员';
                              tierBadgeColor = 'bg-slate-900 text-white font-medium';
                              if (!u.dailyMaxChats) maxLimit = limits.yearlyMember || 500;
                            } else if (effectiveTier === 'quarterly_member') {
                              tierLabel = '季度会员';
                              tierBadgeColor = 'bg-slate-100 text-slate-800 border border-slate-200/80 font-medium';
                              if (!u.dailyMaxChats) maxLimit = limits.quarterlyMember || 200;
                            } else if (effectiveTier === 'monthly_member') {
                              tierLabel = '月度会员';
                              tierBadgeColor = 'bg-slate-100/80 text-slate-700 border border-slate-200/60 font-medium';
                              if (!u.dailyMaxChats) maxLimit = limits.monthlyMember || 100;
                            } else if (isGuest) {
                              tierLabel = '游客';
                              tierBadgeColor = 'text-slate-400 border border-dashed border-slate-200 font-normal';
                              if (!u.dailyMaxChats) maxLimit = limits.guestUser || 3;
                            }

                            // Expiration status
                            let expiresText = '永久有效';
                            let isExpired = false;
                            if (u.membershipExpiresAt) {
                              const expDate = new Date(u.membershipExpiresAt);
                              if (expDate.getTime() < Date.now()) {
                                isExpired = true;
                                expiresText = `已过期 (${expDate.toISOString().slice(0, 10)})`;
                              } else {
                                expiresText = expDate.toISOString().slice(0, 10);
                              }
                            }

                            const used = isGuest ? (u.guestUsedCount || 0) : (u.dailyUsedCount || 0);

                            return (
                              <tr key={u.id} className="hover:bg-slate-50/60 transition-colors">
                                <td className="py-3 px-4">
                                  <div className="flex flex-col font-mono text-xs">
                                    <span className="font-medium text-slate-900">
                                      {u.phone || (isGuest ? '游客账号' : (u.id ? `138****${u.id.slice(-4)}` : '13800000000'))}
                                    </span>
                                    <span className="text-[11px] text-slate-400">ID: {u.id}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-4 font-medium whitespace-nowrap">
                                  <span className={`px-2.5 py-0.5 rounded-md text-[11px] inline-block ${tierBadgeColor}`}>
                                    {tierLabel}
                                  </span>
                                </td>
                                <td className="py-3 px-4 font-mono text-[11px] whitespace-nowrap">
                                  <span className={isExpired ? 'text-rose-600 font-medium' : 'text-slate-600'}>
                                    {expiresText}
                                  </span>
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-slate-600 whitespace-nowrap">
                                  {used} / {maxLimit} 次/月
                                </td>
                                <td className="py-3 px-4 text-center whitespace-nowrap">
                                  <div className="flex items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      title="编辑用户权益与等级"
                                      onClick={() => handleOpenEditUser(u)}
                                      className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-lg transition-colors cursor-pointer"
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="重置本月调用额度"
                                      onClick={() => handleResetUserQuota(u)}
                                      className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-900 rounded-lg transition-colors cursor-pointer"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      title="删除用户"
                                      onClick={() => handleDeleteUser(u)}
                                      className="p-1.5 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                    <Pagination
                      currentPage={safeUsersPage}
                      totalItems={filteredUsers.length}
                      pageSize={PAGE_SIZE}
                      onPageChange={(p) => setUsersPage(p)}
                    />
                  </div>
                </div>
              );
            })()}

            {/* TAB 4: RESOURCE CONFIGURATION */}
            {activeTab === 'resources' && (
              <div className="space-y-5 max-w-4xl text-left">
                {/* 1. 会员等级与调用额度配置表 */}
                <div className="overflow-x-auto border border-slate-200/80 rounded-xl bg-white shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50/70 border-b border-slate-200/80 text-slate-500 font-medium">
                        <th className="py-2.5 px-4 font-medium">会员等级 / 用户类型</th>
                        <th className="py-2.5 px-4 font-medium w-48">每月模型调用上限</th>
                        <th className="py-2.5 px-4 text-slate-400 font-normal">权益说明</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-slate-800 bg-white">
                      {/* 游客 */}
                      <tr className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">未登录（游客）</span>
                            <span className="text-[10px] px-2 py-0.5 rounded text-slate-400 border border-dashed border-slate-200 font-normal">Guest</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 max-w-[130px]">
                            <input
                              type="number"
                              value={llmConfig.dailyLimits?.guestUser ?? 3}
                              onChange={(e) => setLlmConfig({
                                ...llmConfig,
                                dailyLimits: {
                                  ...(llmConfig.dailyLimits || { guestUser: 3, freeMember: 10, monthlyMember: 100, quarterlyMember: 200, yearlyMember: 500 }),
                                  guestUser: parseInt(e.target.value) || 0,
                                }
                              })}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-200/90 rounded-lg text-slate-900 font-mono text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                            />
                            <span className="text-slate-400 text-[11px] shrink-0">次/月</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 text-xs">
                          免登录访问用户的每月基础调用频次
                        </td>
                      </tr>

                      {/* 普通会员 */}
                      <tr className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">普通会员（已登录）</span>
                            <span className="text-[10px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-normal border border-slate-200/60">Free Member</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 max-w-[130px]">
                            <input
                              type="number"
                              value={llmConfig.dailyLimits?.freeMember ?? 10}
                              onChange={(e) => setLlmConfig({
                                ...llmConfig,
                                dailyLimits: {
                                  ...(llmConfig.dailyLimits || { guestUser: 3, freeMember: 10, monthlyMember: 100, quarterlyMember: 200, yearlyMember: 500 }),
                                  freeMember: parseInt(e.target.value) || 0,
                                }
                              })}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-200/90 rounded-lg text-slate-900 font-mono text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                            />
                            <span className="text-slate-400 text-[11px] shrink-0">次/月</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 text-xs">
                          注册并完成手机或微信登录后的每月赠送额度
                        </td>
                      </tr>

                      {/* 月度会员 */}
                      <tr className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">月度会员</span>
                            <span className="text-[10px] bg-slate-100/80 text-slate-700 border border-slate-200/80 px-2 py-0.5 rounded-md font-medium">Monthly VIP</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 max-w-[130px]">
                            <input
                              type="number"
                              value={llmConfig.dailyLimits?.monthlyMember ?? 100}
                              onChange={(e) => setLlmConfig({
                                ...llmConfig,
                                dailyLimits: {
                                  ...(llmConfig.dailyLimits || { guestUser: 3, freeMember: 10, monthlyMember: 100, quarterlyMember: 200, yearlyMember: 500 }),
                                  monthlyMember: parseInt(e.target.value) || 0,
                                }
                              })}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-200/90 rounded-lg text-slate-900 font-mono text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                            />
                            <span className="text-slate-400 text-[11px] shrink-0">次/月</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 text-xs">
                          月度会员享有的大容量每月调用额度
                        </td>
                      </tr>

                      {/* 季度会员 */}
                      <tr className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">季度会员</span>
                            <span className="text-[10px] bg-slate-100 text-slate-800 border border-slate-200/80 px-2 py-0.5 rounded-md font-medium">Quarterly VIP</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 max-w-[130px]">
                            <input
                              type="number"
                              value={llmConfig.dailyLimits?.quarterlyMember ?? 200}
                              onChange={(e) => setLlmConfig({
                                ...llmConfig,
                                dailyLimits: {
                                  ...(llmConfig.dailyLimits || { guestUser: 3, freeMember: 10, monthlyMember: 100, quarterlyMember: 200, yearlyMember: 500 }),
                                  quarterlyMember: parseInt(e.target.value) || 0,
                                }
                              })}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-200/90 rounded-lg text-slate-900 font-mono text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                            />
                            <span className="text-slate-400 text-[11px] shrink-0">次/月</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 text-xs">
                          季度会员享有的更高每月模型调用额度
                        </td>
                      </tr>

                      {/* 年度会员 */}
                      <tr className="hover:bg-slate-50/60 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">年度会员</span>
                            <span className="text-[10px] bg-slate-900 text-white px-2 py-0.5 rounded-md font-medium">Yearly VIP</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 max-w-[130px]">
                            <input
                              type="number"
                              value={llmConfig.dailyLimits?.yearlyMember ?? 500}
                              onChange={(e) => setLlmConfig({
                                ...llmConfig,
                                dailyLimits: {
                                  ...(llmConfig.dailyLimits || { guestUser: 3, freeMember: 10, monthlyMember: 100, quarterlyMember: 200, yearlyMember: 500 }),
                                  yearlyMember: parseInt(e.target.value) || 0,
                                }
                              })}
                              className="w-full px-2.5 py-1.5 bg-white border border-slate-200/90 rounded-lg text-slate-900 font-mono text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                            />
                            <span className="text-slate-400 text-[11px] shrink-0">次/月</span>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-500 text-xs">
                          尊享年度会员享有的超高每月调用上限
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-slate-400 px-1">
                  提示：修改月度/季度/年度会员及普通用户的每月调用上限后，点击下方“保存资源配置”按钮即可实时生效。
                </p>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={handleSaveLLMConfig}
                    className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5 text-white" />
                    <span>保存资源配置</span>
                  </button>
                </div>
              </div>
            )}

            {/* TAB 7: AGREEMENTS CONFIG */}
            {activeTab === 'agreements' && (
              <div className="space-y-5 max-w-4xl text-left pb-8">
                {/* 协议配置卡片 */}
                <div className="p-6 bg-white border border-slate-200/80 rounded-xl space-y-4 shadow-2xs">
                  {/* 页眉 Tab 切换区域 */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                    <div className="inline-flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                      <button
                        type="button"
                        onClick={() => setAgreementActiveTab('userAgreement')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                          agreementActiveTab === 'userAgreement'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5 text-slate-600" />
                        <span>用户服务协议</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setAgreementActiveTab('privacyPolicy')}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                          agreementActiveTab === 'privacyPolicy'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-500 hover:text-slate-900'
                        }`}
                      >
                        <ShieldCheck className="w-3.5 h-3.5 text-slate-600" />
                        <span>隐私政策</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setPreviewAgreementType(agreementActiveTab === 'userAgreement' ? 'terms' : 'privacy')}
                        className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5 shadow-2xs"
                      >
                        <Eye className="w-3.5 h-3.5 text-slate-500" />
                        <span>预览当前协议</span>
                      </button>
                      <span className="text-[11px] text-slate-400 font-mono">
                        生效时间: {llmConfig.agreements?.updatedAt || '2026-03-01'}
                      </span>
                    </div>
                  </div>

                  {/* 对应协议输入与编辑 */}
                  {agreementActiveTab === 'userAgreement' ? (
                    <div className="space-y-4 animate-in fade-in duration-150">
                      <div>
                        <label className="block text-slate-700 text-xs font-medium mb-1.5">
                          协议显示标题
                        </label>
                        <input
                          type="text"
                          value={llmConfig.agreements?.userAgreementTitle ?? '用户服务协议'}
                          onChange={(e) =>
                            setLlmConfig({
                              ...llmConfig,
                              agreements: {
                                userAgreementTitle: e.target.value,
                                userAgreementContent: llmConfig.agreements?.userAgreementContent || DEFAULT_USER_AGREEMENT,
                                privacyPolicyTitle: llmConfig.agreements?.privacyPolicyTitle || '隐私政策',
                                privacyPolicyContent: llmConfig.agreements?.privacyPolicyContent || DEFAULT_PRIVACY_POLICY,
                                updatedAt: llmConfig.agreements?.updatedAt || '2026-03-01',
                              },
                            })
                          }
                          placeholder="用户服务协议"
                          className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-slate-700 text-xs font-medium">
                            用户服务协议正文 (支持 Markdown 语法)
                          </label>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {(llmConfig.agreements?.userAgreementContent || DEFAULT_USER_AGREEMENT).length} 字符
                          </span>
                        </div>
                        <textarea
                          rows={14}
                          value={llmConfig.agreements?.userAgreementContent ?? DEFAULT_USER_AGREEMENT}
                          onChange={(e) =>
                            setLlmConfig({
                              ...llmConfig,
                              agreements: {
                                userAgreementTitle: llmConfig.agreements?.userAgreementTitle || '用户服务协议',
                                userAgreementContent: e.target.value,
                                privacyPolicyTitle: llmConfig.agreements?.privacyPolicyTitle || '隐私政策',
                                privacyPolicyContent: llmConfig.agreements?.privacyPolicyContent || DEFAULT_PRIVACY_POLICY,
                                updatedAt: llmConfig.agreements?.updatedAt || '2026-03-01',
                              },
                            })
                          }
                          className="w-full px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/90 rounded-xl text-slate-800 text-xs font-mono focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:bg-white transition-all shadow-2xs leading-relaxed"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 animate-in fade-in duration-150">
                      <div>
                        <label className="block text-slate-700 text-xs font-medium mb-1.5">
                          政策显示标题
                        </label>
                        <input
                          type="text"
                          value={llmConfig.agreements?.privacyPolicyTitle ?? '隐私政策'}
                          onChange={(e) =>
                            setLlmConfig({
                              ...llmConfig,
                              agreements: {
                                userAgreementTitle: llmConfig.agreements?.userAgreementTitle || '用户服务协议',
                                userAgreementContent: llmConfig.agreements?.userAgreementContent || DEFAULT_USER_AGREEMENT,
                                privacyPolicyTitle: e.target.value,
                                privacyPolicyContent: llmConfig.agreements?.privacyPolicyContent || DEFAULT_PRIVACY_POLICY,
                                updatedAt: llmConfig.agreements?.updatedAt || '2026-03-01',
                              },
                            })
                          }
                          placeholder="隐私政策"
                          className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-slate-700 text-xs font-medium">
                            隐私政策正文 (支持 Markdown 语法)
                          </label>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {(llmConfig.agreements?.privacyPolicyContent || DEFAULT_PRIVACY_POLICY).length} 字符
                          </span>
                        </div>
                        <textarea
                          rows={14}
                          value={llmConfig.agreements?.privacyPolicyContent ?? DEFAULT_PRIVACY_POLICY}
                          onChange={(e) =>
                            setLlmConfig({
                              ...llmConfig,
                              agreements: {
                                userAgreementTitle: llmConfig.agreements?.userAgreementTitle || '用户服务协议',
                                userAgreementContent: llmConfig.agreements?.userAgreementContent || DEFAULT_USER_AGREEMENT,
                                privacyPolicyTitle: llmConfig.agreements?.privacyPolicyTitle || '隐私政策',
                                privacyPolicyContent: e.target.value,
                                updatedAt: llmConfig.agreements?.updatedAt || '2026-03-01',
                              },
                            })
                          }
                          className="w-full px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/90 rounded-xl text-slate-800 text-xs font-mono focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 focus:bg-white transition-all shadow-2xs leading-relaxed"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Action Controls */}
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleSaveLLMConfig}
                    className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5 text-white" />
                    <span>保存协议配置</span>
                  </button>
                </div>
              </div>
            )}

            {/* AGREEMENTS LIVE PREVIEW MODAL */}
            {previewAgreementType && (
              <div className="fixed inset-0 z-70 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
                <div className="bg-white w-full max-w-lg rounded-xl shadow-xl border border-slate-200/90 overflow-hidden flex flex-col max-h-[85vh] animate-in fade-in zoom-in-95 duration-150">
                  <div className="px-5 py-3.5 bg-white border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-700" />
                      <span className="font-medium text-xs text-slate-900">
                        {previewAgreementType === 'terms'
                          ? llmConfig.agreements?.userAgreementTitle || '用户服务协议'
                          : llmConfig.agreements?.privacyPolicyTitle || '隐私政策'}{' '}
                        (预览)
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewAgreementType(null)}
                      className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5 text-xs text-slate-700 leading-relaxed select-text">
                    <div className="text-[11px] text-slate-400 border-b border-slate-100 pb-2 mb-3 flex items-center justify-between font-mono">
                      <span>状态：预览模式</span>
                      <span>生效日期：{llmConfig.agreements?.updatedAt || '2026-03-01'}</span>
                    </div>
                    <div className="markdown-body prose prose-xs max-w-none text-slate-800 space-y-2 [&_h1]:text-base [&_h1]:font-bold [&_h1]:text-slate-900 [&_h1]:border-b [&_h1]:border-slate-100 [&_h1]:pb-2 [&_h1]:mb-3 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-slate-900 [&_h3]:mt-3 [&_h3]:mb-1 [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-1">
                      <ReactMarkdown>
                        {previewAgreementType === 'terms'
                          ? llmConfig.agreements?.userAgreementContent || DEFAULT_USER_AGREEMENT
                          : llmConfig.agreements?.privacyPolicyContent || DEFAULT_PRIVACY_POLICY}
                      </ReactMarkdown>
                    </div>
                  </div>

                  <div className="px-5 py-3 bg-slate-50/70 border-t border-slate-100 flex justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => setPreviewAgreementType(null)}
                      className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors"
                    >
                      关闭预览
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 5: LLM CONFIG */}
            {activeTab === 'llm' && (
              <div className="space-y-5 max-w-2xl text-left">
                {/* 1. 模型 API 服务与密钥配置 */}
                <div className="p-6 border border-slate-200/80 rounded-xl space-y-4 text-xs bg-white shadow-2xs">
                  {/* API 地址与密钥 */}
                  <div className="space-y-3.5">
                    <div>
                      <label className="block text-slate-700 font-medium text-xs mb-1.5">API 服务请求地址 (API Base URL)</label>
                      <input
                        type="text"
                        value={llmConfig.apiBaseUrl ?? 'https://api.deepseek.com/v1'}
                        onChange={(e) => setLlmConfig({ ...llmConfig, apiBaseUrl: e.target.value })}
                        placeholder="https://api.deepseek.com/v1 或 https://dashscope.aliyuncs.com/compatible-mode/v1"
                        className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 font-mono shadow-2xs transition-colors"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">标准 OpenAI 兼容模式的 API 基础 Endpoint 地址</p>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-medium text-xs mb-1.5">API 接口密钥 (API Key)</label>
                      <input
                        type="password"
                        value={llmConfig.apiKey ?? ''}
                        onChange={(e) => setLlmConfig({ ...llmConfig, apiKey: e.target.value })}
                        placeholder="sk-********************************"
                        className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 font-mono shadow-2xs transition-colors"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">服务器安全存储与使用，不向前端泄露</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-3 border-t border-slate-100">
                    <div>
                      <label className="block text-slate-700 font-medium text-xs mb-1.5">主推理模型 (Primary Model)</label>
                      <input
                        type="text"
                        value={llmConfig.primaryModel || 'deepseek-chat'}
                        onChange={(e) => setLlmConfig({ ...llmConfig, primaryModel: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 font-mono shadow-2xs transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium text-xs mb-1.5">备用推理模型 (Fallback Model)</label>
                      <input
                        type="text"
                        value={llmConfig.fallbackModel || 'qwen-max'}
                        onChange={(e) => setLlmConfig({ ...llmConfig, fallbackModel: e.target.value })}
                        className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 font-mono shadow-2xs transition-colors"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-slate-700 font-medium text-xs mb-1.5">单次 API 超时判定 (秒)</label>
                      <input
                        type="number"
                        min={10}
                        max={300}
                        value={llmConfig.timeoutSec ?? 60}
                        onChange={(e) => setLlmConfig({ ...llmConfig, timeoutSec: parseInt(e.target.value) || 60 })}
                        className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 font-mono shadow-2xs transition-colors"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">控制模型单次响应的最长等待时间（推荐 60 秒）</p>
                    </div>
                    <div>
                      <label className="block text-slate-700 font-medium text-xs mb-1.5">单次回复最大 Token (Max Tokens)</label>
                      <input
                        type="number"
                        min={128}
                        max={32768}
                        step={256}
                        value={llmConfig.maxTokens ?? 4096}
                        onChange={(e) => setLlmConfig({ ...llmConfig, maxTokens: parseInt(e.target.value) || 4096 })}
                        placeholder="4096"
                        className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 font-mono shadow-2xs transition-colors"
                      />
                      <p className="text-[11px] text-slate-400 mt-1">控制模型单次输出的最大生成长度（推荐 2048 ~ 8192）</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    disabled={testingLLM}
                    onClick={handleTestLLM}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-xs font-medium cursor-pointer transition-colors flex items-center gap-1.5 border border-slate-200/90 shadow-2xs"
                  >
                    {testingLLM ? (
                      <>
                        <RotateCcw className="w-3.5 h-3.5 animate-spin text-slate-600" />
                        <span>正在测试连接...</span>
                      </>
                    ) : (
                      <>
                        <Bot className="w-3.5 h-3.5 text-slate-500" />
                        <span>测试模型连通性</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveLLMConfig}
                    className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5 text-white" />
                    <span>保存模型配置</span>
                  </button>
                </div>

                {llmTestResult && (
                  <div
                    className={`p-3 rounded-xl text-xs border transition-all ${
                      llmTestResult.success
                        ? 'bg-emerald-50/70 text-emerald-800 border-emerald-200/80'
                        : 'bg-rose-50/70 text-rose-800 border-rose-200/80'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <span className={`w-1.5 h-1.5 rounded-full ${llmTestResult.success ? 'bg-emerald-600' : 'bg-rose-600'}`} />
                      <span>{llmTestResult.message}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      {isSkillModalOpen && editingSkill && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-lg shadow-xl border border-slate-200/90 space-y-4 max-h-[85vh] overflow-y-auto text-left">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <h3 className="text-xs font-semibold text-slate-900">
                {editingSkill.id ? '编辑图书导师' : '新增图书导师'}
              </h3>
              <button
                onClick={() => setIsSkillModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-slate-700 mb-1">书名</label>
                <input
                  type="text"
                  value={editingSkill.title || ''}
                  onChange={(e) => setEditingSkill({ ...editingSkill, title: e.target.value })}
                  placeholder="如：《黑天鹅》"
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">作者</label>
                <input
                  type="text"
                  value={editingSkill.author || ''}
                  onChange={(e) => setEditingSkill({ ...editingSkill, author: e.target.value })}
                  placeholder="如：塔勒布"
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block font-medium text-slate-700">
                    所属标签 <span className="text-rose-500 font-bold">*</span> <span className="text-[11px] text-slate-400 font-normal">(必选项，所有标签均来源于标签管理)</span>
                  </label>
                </div>
                {(() => {
                  const currentSelectedTags = (Array.isArray(editingSkill.tags) ? editingSkill.tags : [])
                    .filter((t) => t && allCategoryNames.includes(t));

                  return (
                    <div className="space-y-1.5">
                      <div className="p-2.5 bg-slate-50/50 border border-slate-200/80 rounded-lg max-h-36 overflow-y-auto">
                        {allCategoryNames.length === 0 ? (
                          <div className="text-[11px] text-slate-400 py-1">
                            暂无可用标签，请先前往“标签管理”中添加标签
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {allCategoryNames.map((cat: string) => {
                              const isSelected = currentSelectedTags.includes(cat);
                              return (
                                <button
                                  key={cat}
                                  type="button"
                                  onClick={() => {
                                    let nextTags: string[];
                                    if (isSelected) {
                                      nextTags = currentSelectedTags.filter((t) => t !== cat);
                                    } else {
                                      nextTags = [...currentSelectedTags, cat];
                                    }
                                    setEditingSkill({
                                      ...editingSkill,
                                      category: nextTags[0] || '',
                                      tags: nextTags,
                                    });
                                  }}
                                  className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors flex items-center gap-1 ${
                                    isSelected
                                      ? 'bg-slate-900 text-white shadow-2xs'
                                      : 'bg-white text-slate-600 hover:bg-slate-100/70 border border-slate-200/80'
                                  }`}
                                >
                                  {isSelected && <Check className="w-3 h-3 text-white" />}
                                  <span>{cat}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {currentSelectedTags.length === 0 ? (
                        <div className="text-[11px] text-rose-500 font-medium flex items-center gap-1">
                          <span>* 标签为必须添加项，请点击上方按钮选择至少一个标签</span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400">
                          已选择 {currentSelectedTags.length} 个标签：{currentSelectedTags.join('、')}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">热度/搜索数</label>
                <input
                  type="number"
                  value={editingSkill.searchCount ?? 500}
                  onChange={(e) =>
                    setEditingSkill({ ...editingSkill, searchCount: parseInt(e.target.value) || 0 })
                  }
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 font-mono shadow-2xs transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block font-medium text-slate-700">封面图片</label>
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 rounded-md text-[11px] font-medium cursor-pointer transition-colors border border-slate-200/90 shadow-2xs">
                    <UploadCloud className="w-3.5 h-3.5 text-slate-500" />
                    <span>{isUploadingCover ? '上传中...' : '上传封面'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isUploadingCover}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setIsUploadingCover(true);
                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            const base64 = event.target?.result as string;
                            if (base64) {
                              try {
                                const res = await fetch('/api/admin/upload-asset', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ fileName: file.name, fileData: base64 }),
                                });
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data.url) {
                                    setEditingSkill((prev) => (prev ? { ...prev, coverUrl: data.url } : null));
                                  }
                                } else {
                                  setEditingSkill((prev) => (prev ? { ...prev, coverUrl: base64 } : null));
                                }
                              } catch {
                                setEditingSkill((prev) => (prev ? { ...prev, coverUrl: base64 } : null));
                              } finally {
                                setIsUploadingCover(false);
                              }
                            } else {
                              setIsUploadingCover(false);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                  </label>
                </div>

                {editingSkill.coverUrl ? (
                  <div className="flex items-center gap-3 p-2.5 bg-slate-50/60 border border-slate-200/80 rounded-lg">
                    <img
                      src={editingSkill.coverUrl}
                      alt="封面预览"
                      className="w-12 h-16 object-cover rounded border border-slate-200 bg-slate-100 shrink-0"
                    />
                    <div className="flex-1 min-w-0 text-xs">
                      <div className="font-medium text-slate-800 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span className="truncate">已选择封面图片</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono truncate mt-0.5" title={editingSkill.coverUrl}>
                        {editingSkill.coverUrl}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditingSkill((prev) => (prev ? { ...prev, coverUrl: '' } : null))}
                      className="text-rose-600 hover:text-rose-700 font-medium text-xs cursor-pointer hover:underline px-1 py-0.5"
                    >
                      移除
                    </button>
                  </div>
                ) : (
                  <label className="block p-3 bg-slate-50/50 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-400 cursor-pointer hover:bg-slate-50 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={isUploadingCover}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setIsUploadingCover(true);
                          const reader = new FileReader();
                          reader.onload = async (event) => {
                            const base64 = event.target?.result as string;
                            if (base64) {
                              try {
                                const res = await fetch('/api/admin/upload-asset', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ fileName: file.name, fileData: base64 }),
                                });
                                if (res.ok) {
                                  const data = await res.json();
                                  if (data.url) {
                                    setEditingSkill((prev) => (prev ? { ...prev, coverUrl: data.url } : null));
                                  }
                                } else {
                                  setEditingSkill((prev) => (prev ? { ...prev, coverUrl: base64 } : null));
                                }
                              } catch {
                                setEditingSkill((prev) => (prev ? { ...prev, coverUrl: base64 } : null));
                              } finally {
                                setIsUploadingCover(false);
                              }
                            } else {
                              setIsUploadingCover(false);
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    {isUploadingCover ? '正在保存封面至 assets 目录...' : '尚未上传封面图片，点击此处上传'}
                  </label>
                )}
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">描述</label>
                <textarea
                  rows={2}
                  value={editingSkill.description || ''}
                  onChange={(e) => setEditingSkill({ ...editingSkill, description: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block font-medium text-slate-700">skill.md</label>
                  <label className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 rounded-md text-[11px] font-medium cursor-pointer transition-colors border border-slate-200/90 shadow-2xs">
                    <UploadCloud className="w-3.5 h-3.5 text-slate-500" />
                    <span>上传</span>
                    <input
                      type="file"
                      accept=".md,.txt,.markdown"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (event) => {
                            const content = event.target?.result as string;
                            if (content) {
                              setEditingSkill((prev) => ({
                                ...prev,
                                systemPrompt: content,
                              }));
                              // Call LLM to automatically generate recommended follow-up questions from the skill document
                              handleGenerateQuestionsForSkill(
                                content,
                                editingSkill?.title,
                                editingSkill?.author
                              );
                            }
                          };
                          reader.readAsText(file);
                        }
                      }}
                    />
                  </label>
                </div>
                {editingSkill.systemPrompt ? (
                  <div className="space-y-2 p-2.5 bg-slate-50/60 border border-slate-200/80 rounded-lg text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        预览 (共 {editingSkill.systemPrompt.length} 字符)
                      </span>
                      <button
                        type="button"
                        onClick={() => setEditingSkill((prev) => ({ ...prev, systemPrompt: '' }))}
                        className="text-rose-600 hover:text-rose-700 font-medium text-xs cursor-pointer hover:underline"
                      >
                        移除
                      </button>
                    </div>
                    <div className="max-h-28 overflow-y-auto bg-white p-2.5 rounded border border-slate-200/80 text-slate-600 font-mono text-[11px] whitespace-pre-wrap leading-relaxed select-text">
                      {editingSkill.systemPrompt}
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50/50 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-400">
                    尚未上传 skill.md，请点击“上传”按钮
                  </div>
                )}
              </div>

              {/* 推荐追问（由大模型根据 skill.md 自动提炼） */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-slate-700" />
                    <label className="font-medium text-slate-700 text-xs">
                      推荐追问（由大模型根据 skill.md 提炼）
                    </label>
                  </div>
                  <button
                    type="button"
                    disabled={isGeneratingQuestions || !editingSkill.systemPrompt}
                    onClick={() =>
                      handleGenerateQuestionsForSkill(
                        editingSkill.systemPrompt || '',
                        editingSkill.title,
                        editingSkill.author
                      )
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 rounded-md text-[11px] font-medium cursor-pointer transition-colors border border-slate-200/90 shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
                    title="根据当前 skill 文档由大模型重新提炼推荐追问"
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 text-slate-500 ${
                        isGeneratingQuestions ? 'animate-spin' : ''
                      }`}
                    />
                    <span>{isGeneratingQuestions ? '大模型提炼中...' : '大模型重新提炼'}</span>
                  </button>
                </div>

                {isGeneratingQuestions && (
                  <div className="p-3 bg-slate-50/70 border border-slate-200/80 rounded-lg text-xs text-slate-600 flex items-center gap-2.5 mb-2.5">
                    <Loader2 className="w-4 h-4 text-slate-700 animate-spin shrink-0" />
                    <span>大模型正在深度解析上传的 Skill 原著文档，提炼 3~4 个专属推荐追问...</span>
                  </div>
                )}

                {Array.isArray(editingSkill.sampleQuestions) && editingSkill.sampleQuestions.length > 0 ? (
                  <div className="space-y-2">
                    {editingSkill.sampleQuestions.map((q, qIndex) => (
                      <div key={qIndex} className="flex items-center gap-2">
                        <span className="text-[11px] font-mono text-slate-400 w-4 text-center shrink-0">
                          {qIndex + 1}.
                        </span>
                        <input
                          type="text"
                          value={q}
                          onChange={(e) => {
                            const next = [...(editingSkill.sampleQuestions || [])];
                            next[qIndex] = e.target.value;
                            setEditingSkill({ ...editingSkill, sampleQuestions: next });
                          }}
                          placeholder="输入推荐追问..."
                          className="flex-1 px-2.5 py-1.5 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const next = (editingSkill.sampleQuestions || []).filter((_, i) => i !== qIndex);
                            setEditingSkill({ ...editingSkill, sampleQuestions: next });
                          }}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded cursor-pointer transition-colors"
                          title="删除此追问"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    <div className="flex justify-between items-center pt-1 text-[11px]">
                      <span className="text-slate-400">
                        将在读者进入导师对话时作为首推引导追问展示
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const next = [...(editingSkill.sampleQuestions || []), ''];
                          setEditingSkill({ ...editingSkill, sampleQuestions: next });
                        }}
                        className="text-slate-700 hover:text-slate-900 font-medium cursor-pointer hover:underline inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" />
                        添加追问
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-50/50 border border-dashed border-slate-200 rounded-lg text-center text-xs text-slate-400">
                    {editingSkill.systemPrompt
                      ? '尚未提炼推荐追问，可点击上方“大模型重新提炼”按钮'
                      : '上传 skill.md 文档后，大模型将根据原著内容自动生成专属推荐追问'}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 border-t pt-3 border-slate-100">
              <button
                onClick={() => setIsSkillModalOpen(false)}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 rounded-lg text-xs font-medium cursor-pointer transition-colors shadow-2xs"
              >
                取消
              </button>
              <button
                onClick={handleSaveSkill}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-2xs transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                保存发布
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD NEW CATEGORY MODAL */}
      {isAddCategoryOpen && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-xs shadow-xl border border-slate-200/90 space-y-3.5 text-left">
            <div className="flex items-center justify-between border-b pb-2.5 border-slate-100">
              <h3 className="text-xs font-semibold text-slate-900">新增图书标签</h3>
              <button
                onClick={() => setIsAddCategoryOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-900 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">标签名称</label>
              <input
                type="text"
                value={newCatInput}
                onChange={(e) => setNewCatInput(e.target.value)}
                placeholder="如：人文史地"
                className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setIsAddCategoryOpen(false)}
                className="px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleAddNewCategory}
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD INTERNAL USER MODAL */}
      {isAddUserModalOpen && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl p-5 w-full max-w-md shadow-xl border border-slate-200/90 text-left space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                  <UserPlus className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">添加内部用户</h3>
                  <p className="text-[11px] text-slate-400">创建账号并配置会员等级与调用额度</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAddUserModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* 手机号码 */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  手机号码 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="请输入11位手机号"
                  value={addUserForm.phone}
                  onChange={(e) => setAddUserForm({ ...addUserForm, phone: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-900 text-xs font-mono focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  自动生成昵称：
                  <span className="font-medium font-mono text-slate-700 ml-1">
                    {addUserForm.phone.trim().length >= 4 ? addUserForm.phone.trim().slice(-4) : (addUserForm.phone.trim() || 'xxxx')}
                  </span>
                </p>
              </div>

              {/* 用户登录验证码 */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  登录验证码 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6位阿拉伯数字验证码"
                  value={addUserForm.code}
                  onChange={(e) => setAddUserForm({ ...addUserForm, code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-900 text-xs font-mono focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                />
              </div>

              {/* 会员等级 */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  会员等级 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={addUserForm.membershipTier}
                  onChange={(e) => setAddUserForm({ ...addUserForm, membershipTier: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs font-medium cursor-pointer transition-colors"
                >
                  <option value="monthly_member">月度会员 (Monthly VIP)</option>
                  <option value="quarterly_member">季度会员 (Quarterly VIP)</option>
                  <option value="yearly_member">年度会员 (Yearly VIP)</option>
                  <option value="free_member">普通会员 (Free Member)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsAddUserModalOpen(false)}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 rounded-lg text-xs font-medium cursor-pointer transition-colors shadow-2xs"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateUser}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                <span>确认添加</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {editingUser && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl p-5 w-full max-w-md shadow-xl border border-slate-200/90 text-left space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b pb-3 border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                  <Edit2 className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-slate-900">编辑用户与权益</h3>
                  <p className="text-[11px] text-slate-400 font-mono truncate max-w-[260px]">
                    账号 ID: {editingUser.id}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              {/* 手机号码 */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  手机号码 <span className="text-slate-400 font-normal">(不可修改)</span>
                </label>
                <input
                  type="text"
                  value={editUserForm.phone}
                  disabled
                  readOnly
                  className="w-full px-3 py-2 bg-slate-50/70 border border-slate-200/70 rounded-lg text-slate-400 font-mono text-xs cursor-not-allowed select-none"
                />
              </div>

              {/* 登录验证码 */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  密码 / 登录验证码 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6位阿拉伯数字验证码"
                  value={editUserForm.code}
                  onChange={(e) => setEditUserForm({ ...editUserForm, code: e.target.value.replace(/\D/g, '').slice(0, 6) })}
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-900 text-xs font-mono focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs transition-colors"
                />
              </div>

              {/* 会员等级 */}
              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  会员等级 <span className="text-rose-500">*</span>
                </label>
                <select
                  value={editUserForm.membershipTier}
                  onChange={(e) => setEditUserForm({ ...editUserForm, membershipTier: e.target.value as any })}
                  className="w-full px-3 py-2 bg-white border border-slate-200/90 rounded-lg text-slate-800 text-xs focus:outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900 shadow-2xs font-medium cursor-pointer transition-colors"
                >
                  <option value="monthly_member">月度会员 (Monthly VIP)</option>
                  <option value="quarterly_member">季度会员 (Quarterly VIP)</option>
                  <option value="yearly_member">年度会员 (Yearly VIP)</option>
                  <option value="free_member">普通会员 (Free Member)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 rounded-lg text-xs font-medium cursor-pointer transition-colors shadow-2xs"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSaveEditUser}
                className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>保存更改</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION DELETE MODAL */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-80 flex items-center justify-center bg-slate-900/30 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl border border-slate-200/90 text-left space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-xs font-semibold text-slate-900">{confirmModal.title}</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  {confirmModal.description}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
                className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 rounded-lg text-xs font-medium cursor-pointer transition-colors shadow-2xs"
              >
                {confirmModal.cancelText || '取消'}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const action = confirmModal.onConfirm;
                  setConfirmModal((prev) => ({ ...prev, isOpen: false }));
                  await action();
                }}
                className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium cursor-pointer shadow-2xs transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{confirmModal.confirmText || '确认删除'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
