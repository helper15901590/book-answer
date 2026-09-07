import { cleanBookTitle, ChatMessage } from '../../../src/types.js';

// Helper for deep offline book distillation synthesis when LLMs are offline
export function generateDeepBookDistillation(skill: any, userQuery: string, history: ChatMessage[] = []): string {
  const bookTitle = cleanBookTitle(skill?.title || '经典著作');
  const author = skill?.author || '原著作者';
  const tags = (skill?.tags || ['认知进阶', '底层逻辑', '实战决策']).filter(Boolean);
  const mainTag = tags[0] || '系统性思考';
  const secondTag = tags[1] || '本质洞察';

  const rawQuotes = (skill?.bookContent || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter((s: string) => s && !s.startsWith('#') && !s.startsWith('【') && s.length > 4);

  const matchedQuote = rawQuotes.find((q: string) => 
    userQuery.split('').some((char) => q.includes(char) && !'的是在中有和了吗呢？?，。请问如何'.includes(char))
  ) || rawQuotes[0] || '弱小和无知不是生存的障碍，傲慢才是。';

  const rawChapters = (skill?.catalogContent || '')
    .split('\n')
    .map((s: string) => s.trim())
    .filter((s: string) => s && (s.startsWith('-') || s.startsWith('第') || /^\d/.test(s) || s.startsWith('#')));

  const matchedChapter = rawChapters.find((c: string) =>
    userQuery.split('').some((char) => c.includes(char) && !'的是在中有和了吗呢？?，。请问如何'.includes(char))
  ) || rawChapters[0] || '第一章：核心逻辑与基石定律';

  const cleanChapter = matchedChapter.replace(/^[-*#\d.]+\s*/, '').replace(/^[第一二三四五六七八九十]+[章节讲集部篇：:\s]*/, '');

  return `针对你所探讨的议题：“**${userQuery}**”，为你提供深度剖析：

### 一、 核心逻辑与底层规律溯源
在《${bookTitle}》中，探讨此类问题的底层基石是 **【${mainTag}】** 与 **【${secondTag}】**：
1. **穿透表象看本质**：很多时候我们在具体场景中感受到的阻力，并不是执行层面的缺陷，而是底层假设与认知模型存在偏差。
2. **核心锚点**：面对复杂系统的博弈或破局，首要任务是确立自己的**不可变核心边界**与**非对称优势**。

### 二、 思维模型推演与破局路径
建议从以下三个关键杠杆点切入破局：
* **维度 1（认知升维与逆向防守）**：先明确“什么事情绝对不能做”，通过排除致命错误（安全边际）来锁定高概率胜率。
* **维度 2（构建复利型飞轮）**：将单次的尝试转化为标准化、可沉淀的原则，让经验在时间周期中形成正向增强回路。
* **维度 3（非对称反馈与动态校准）**：以极低试错成本开展小步快跑，获取真实世界的反馈数据，持续优化决策算法。

### 三、 落地推演行动清单（Action Checklist）
1. **第一步（盘点核心筹码）**：写下你目前掌握的独特专长或核心资源，剥离低价值无效消耗；
2. **第二步（制定边界原则）**：依据“${mainTag}”制定 2~3 条不可逾越的行为铁律；
3. **第三步（敏捷闭环验证）**：在 48 小时内完成一次最小闭环落地测试，并记录核心推演得失。`;
}
