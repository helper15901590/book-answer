import { db } from '../../db.js';
import { cleanBookTitle } from '../../../src/types.js';
import { cleanApiKey, isInvalidOrPlaceholderKey, resolveOpenAIUrl } from './sanitize.js';
import { callGeminiResponse, resolveGeminiModelName } from './gemini.js';

// Generate grounded recommended follow-up questions from uploaded Skill/mentor document using LLM
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
  const rawApiKey = (llmConfig.apiKey || llmConfig.deepseekApiKey || process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '').trim();
  const apiKey = cleanApiKey(rawApiKey);
  const apiBaseUrl = (llmConfig.apiBaseUrl || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').trim();
  const modelUsed = (llmConfig.primaryModel || process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim();
  const geminiKey = process.env.GEMINI_API_KEY || (apiKey.startsWith('AIza') ? apiKey : '');
  const hasValidCustomKey = !isInvalidOrPlaceholderKey(apiKey);
  const isExplicitGemini = modelUsed.toLowerCase().includes('gemini');

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

  // 1. Try Custom OpenAI / DeepSeek if configured
  if (hasValidCustomKey && !isExplicitGemini) {
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
      console.warn('Custom LLM question generation failed, trying fallback:', e);
    }
  }

  // 2. Try Gemini if custom failed or gemini configured
  if (!rawOutput && geminiKey) {
    try {
      rawOutput = await callGeminiResponse({
        geminiKey,
        targetModel: resolveGeminiModelName(modelUsed),
        systemPrompt: '你是一位精通图书知识体系的专家，只输出合法的 JSON 字符串数组。',
        messageText: prompt,
        timeoutMs: 30000,
      });
    } catch (e) {
      console.warn('Gemini question generation failed:', e);
    }
  }

  // 3. Parse JSON output
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

  // 4. Grounded heuristic fallback if LLM output was empty or invalid
  if (parsed.length < 2) {
    const conceptMatches = Array.from(systemPrompt.matchAll(/[“"「]([^”"」]{2,15})[”"」]/g)).map((m) => m[1]);
    const boldMatches = Array.from(systemPrompt.matchAll(/\*\*([^*]{2,15})\*\*/g)).map((m) => m[1]);
    const combined = Array.from(new Set([...conceptMatches, ...boldMatches])).filter(
      (c) => !c.includes('http') && !c.includes('www') && c.length >= 2 && c.length <= 15
    );

    if (combined.length >= 3) {
      parsed = [
        `如何理解原著中提出的“${combined[0]}”？它在实际场景中如何应用？`,
        `原著中关于“${combined[1]}”的核心逻辑是什么？如何避免常见误区？`,
        `如何将“${combined[2]}”与实际决策或行动相结合？`,
      ];
    } else if (combined.length >= 1) {
      parsed = [
        `如何理解原著中提出的“${combined[0]}”？它在实际场景中如何应用？`,
        `结合《${cleanTitle}》的核心论述，遇到重大抉择时该如何破局？`,
        `原著中最具实操价值的思考工具或原则是什么？`,
      ];
    } else {
      parsed = [
        `结合《${cleanTitle}》的导师设定，当前领域最核心的底层逻辑是什么？`,
        `原著中最值得反复咀嚼的思考模型或方法论是什么？`,
        `如果我想在实际工作与生活中实践本书精髓，第一步该怎么做？`,
      ];
    }
  }

  return parsed.slice(0, 4);
}
