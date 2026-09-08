import { db } from '../../db.js';
import { cleanBookTitle } from '../../../src/types.js';
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl } from './sanitize.js';

// 调用主路 LLM 基于 Skill 原著文档生成有据推荐追问（OpenAI 兼容接口，DeepSeek / 阿里 DashScope 二选一）；
// LLM 未配置或调用失败时返回空数组——离线模板兜底已移除，不再产出伪造内容
export async function generateRecommendedQuestionsFromLLM({
  systemPrompt,
  title,
  author,
}: {
  systemPrompt: string;
  title?: string;
  author?: string;
}): Promise<string[]> {
  const llmConfig = db.getLLMConfig();
  const apiKey = cleanApiKey((llmConfig.apiKey || llmConfig.deepseekApiKey || process.env.DEEPSEEK_API_KEY || '').trim());
  const apiBaseUrl = (llmConfig.apiBaseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').trim();
  const modelUsed = (llmConfig.primaryModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  if (isInvalidOrPlaceholderKey(apiKey)) {
    return [];
  }

  const docSnippet = (systemPrompt || '').slice(0, 4000);
  const cleanTitle = cleanBookTitle(title || '本书');
  const authorStr = author ? `【作者】：${author}\n` : '';

  const prompt = `你是一位深度理解原著精髓的导师与读者对话引导专家。
请仔细分析以下刚刚上传的书籍/导师 Skill 原著文档内容（包含原著的核心理论、关键概念、案例与导师角色定位）：

【书名】：${cleanTitle}
${authorStr}【Skill 原著文档内容】：
${docSnippet}

【任务要求】：
请根据该文档中实际包含的核心概念、独特论点、关键案例或思维模型，提炼生成 3 到 4 个最切中原著精髓、最引人入胜、最具启发性且紧密贴合本书独特内容的读者“推荐追问”（引导性问题）。

【严苛标准】：
1. 必须紧密贴合文档中提及的具体概念、术语、理论或案例，严禁出现任何通用、空泛的模板套话（例如切勿输出“本书最核心的观点是什么”、“如何将书中理论应用到工作中”等放之四海而皆准的空泛问题）；
2. 问句自然、口语化，适合读者在刚开启与导师对话时一键点击提问，字数控制在 15 ~ 28 字之间；
3. 必须且仅能以严格合法的 JSON 字符串数组格式输出，例如：
["问题一", "问题二", "问题三"]
绝对不要带有任何 markdown 语法块（如 \`\`\`json）、序号、前缀或多余的解释文字。`;

  let rawOutput = '';

  try {
    const targetUrl = resolveOpenAIUrl(apiBaseUrl);
    const isReasoner =
      modelUsed.includes('reasoner') ||
      modelUsed.includes('r1') ||
      modelUsed.includes('o1') ||
      modelUsed.includes('o3');

    const payload: any = {
      model: modelUsed,
      messages: [
        { role: 'system', content: '你是一位精通图书知识体系的专家，只输出合法的 JSON 字符串数组。' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 600,
    };
    if (!isReasoner) {
      payload.temperature = 0.7;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const json: any = await res.json();
      rawOutput = json.choices?.[0]?.message?.content || '';
    }
  } catch (e) {
    console.warn('主路 LLM 问题生成失败:', e);
  }

  // 解析 JSON 输出（解析失败时尽力按行提取；仍无结果则返回空数组，不做模板兜底）
  let parsed: string[] = [];
  if (rawOutput) {
    try {
      const cleaned = rawOutput.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
      const jsonArr = JSON.parse(cleaned);
      if (Array.isArray(jsonArr)) {
        parsed = jsonArr.map((item) => String(item).trim()).filter((item) => item.length > 4);
      }
    } catch {
      const lines = rawOutput
        .split('\n')
        .map((l) => l.replace(/^[\d\.\-\*\s"“'‘\[\]]+/, '').replace(/["”'’\,\]]+$/, '').trim())
        .filter((l) => l.endsWith('？') || l.endsWith('?') || (l.length >= 10 && !l.startsWith('{')));
      if (lines.length >= 2) {
        parsed = lines.slice(0, 4);
      }
    }
  }

  return parsed.slice(0, 4);
}
