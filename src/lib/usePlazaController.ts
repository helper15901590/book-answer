import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ALL_CATEGORIES, Skill, SkillType, cleanBookTitle } from '../types';

const PAGE_SIZE = 20;

interface PlazaControllerOptions {
  /** 全量技能列表（通常来自 /api/skills），内部按 skillType 过滤 */
  skills: Skill[];
  skillType: SkillType;
  /** 含「全部」哨兵的分类列表 */
  categories: string[];
  renamedCategoriesMap: Record<string, string>;
  /** 当前广场是否处于激活视图：只有激活时才做分类溢出测量，避免隐藏容器 scrollHeight 为 0 */
  isActive: boolean;
}

export interface PlazaController {
  search: string;
  setSearch: (value: string) => void;
  selectedCategory: string;
  setSelectedCategory: (value: string) => void;
  categories: string[];
  otherCategories: string[];
  allSkillsCount: number;
  filteredSkills: Skill[];
  displayedSkills: Skill[];
  sortedSkills: Skill[];
  hasMoreCards: boolean;
  remainingCount: number;
  loadMore: () => void;
  pageSize: number;
  tagsContainerRef: React.RefObject<HTMLDivElement | null>;
  maxVisibleCategories: number;
  isAllCategoriesModalOpen: boolean;
  openAllCategories: () => void;
  closeAllCategories: () => void;
  selectCategory: (cat: string) => void;
  detailSkill: Skill | null;
  openDetail: (skill: Skill) => void;
  closeDetail: () => void;
}

// 三个广场（书籍 / 导师 / 可靠）共用的筛选、分页与弹窗状态。
// 状态放在父组件里而不是 PlazaView 内部：切换广场时组件会卸载，
// 状态若留在组件内，用户返回原广场时搜索词、分类与分页进度都会被清空。
export function usePlazaController({ skills, skillType, categories, renamedCategoriesMap, isActive }: PlazaControllerOptions): PlazaController {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>(ALL_CATEGORIES);
  const [visibleCardCount, setVisibleCardCount] = useState(PAGE_SIZE);
  const [isAllCategoriesModalOpen, setIsAllCategoriesModalOpen] = useState(false);
  const [detailSkill, setDetailSkill] = useState<Skill | null>(null);

  const tagsContainerRef = useRef<HTMLDivElement | null>(null);
  const otherCategories = useMemo(() => categories.filter((cat) => cat !== ALL_CATEGORIES), [categories]);
  const [maxVisibleCategories, setMaxVisibleCategories] = useState<number>(otherCategories.length);

  const typeSkills = useMemo(
    () => skills.filter((skill) => (skill.skillType || 'book') === skillType),
    [skills, skillType]
  );

  const sortedSkills = useMemo(
    () => [...typeSkills].sort((a, b) => (b.searchCount || 0) - (a.searchCount || 0)),
    [typeSkills]
  );

  const filteredSkills = useMemo(() => {
    return sortedSkills.filter((skill) => {
      const mappedCategory = renamedCategoriesMap[skill.category] || skill.category;
      const matchesCategory =
        selectedCategory === ALL_CATEGORIES ||
        mappedCategory === selectedCategory ||
        skill.category === selectedCategory ||
        skill.tags?.some((tag) => (renamedCategoriesMap[tag] || tag) === selectedCategory);
      const rawQ = search.toLowerCase().trim();
      const cleanQ = cleanBookTitle(rawQ).toLowerCase();
      const matchesSearch =
        !rawQ ||
        skill.title.toLowerCase().includes(rawQ) ||
        (cleanQ ? skill.title.toLowerCase().includes(cleanQ) : false) ||
        (cleanQ ? cleanBookTitle(skill.title).toLowerCase().includes(cleanQ) : false) ||
        (skill.author ? skill.author.toLowerCase().includes(rawQ) : false) ||
        (cleanQ && skill.author ? skill.author.toLowerCase().includes(cleanQ) : false);
      return matchesCategory && matchesSearch;
    });
  }, [sortedSkills, selectedCategory, search, renamedCategoriesMap]);

  useEffect(() => {
    setVisibleCardCount(PAGE_SIZE);
  }, [selectedCategory, search]);

  // 窗口尺寸或分类数量变化时先恢复到「全部展示」，再由下方 layout effect 按实际溢出逐步收起。
  useEffect(() => {
    if (isActive) setMaxVisibleCategories(otherCategories.length);
  }, [isActive, categories, otherCategories.length]);

  useEffect(() => {
    const handleResize = () => {
      if (isActive) setMaxVisibleCategories(otherCategories.length);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isActive, otherCategories.length]);

  useLayoutEffect(() => {
    if (!isActive) return;
    const container = tagsContainerRef.current;
    if (container && container.scrollHeight > 68 && maxVisibleCategories > 0) {
      setMaxVisibleCategories((prev) => Math.max(0, prev - 1));
    }
  }, [isActive, maxVisibleCategories, categories]);

  const displayedSkills = filteredSkills.slice(0, visibleCardCount);

  return {
    search,
    setSearch,
    selectedCategory,
    setSelectedCategory,
    categories,
    otherCategories,
    allSkillsCount: typeSkills.length,
    filteredSkills,
    displayedSkills,
    sortedSkills,
    hasMoreCards: visibleCardCount < filteredSkills.length,
    remainingCount: filteredSkills.length - visibleCardCount,
    loadMore: () => setVisibleCardCount((prev) => prev + PAGE_SIZE),
    pageSize: PAGE_SIZE,
    tagsContainerRef,
    maxVisibleCategories,
    isAllCategoriesModalOpen,
    openAllCategories: () => setIsAllCategoriesModalOpen(true),
    closeAllCategories: () => setIsAllCategoriesModalOpen(false),
    selectCategory: (cat: string) => {
      setSelectedCategory(cat);
      setIsAllCategoriesModalOpen(false);
    },
    detailSkill,
    openDetail: (skill: Skill) => setDetailSkill(skill),
    closeDetail: () => setDetailSkill(null),
  };
}
