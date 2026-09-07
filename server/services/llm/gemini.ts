import { GoogleGenAI } from '@google/genai';

export function resolveGeminiModelName(modelName?: string): string {
  const m = (modelName || '').trim().toLowerCase();
  if (!m || !m.includes('gemini')) {
    return 'gemini-3.1-flash-lite';
  }
  if (m === 'gemini-pro' || m.includes('3.1-pro')) {
    return 'gemini-3.1-pro-preview';
  }
  if (m.includes('flash-lite') || m.includes('lite')) {
    return 'gemini-3.1-flash-lite';
  }
  if (m === 'gemini-3.8-flash') {
    return 'gemini-3.8-flash';
  }
  if (m === 'gemini-flash-latest') {
    return 'gemini-flash-latest';
  }
  if (
    m.includes('2.5') ||
    m.includes('2.0') ||
    m.includes('1.5') ||
    m.includes('1.0') ||
    m === 'gemini-flash' ||
    m === 'gemini'
  ) {
    return 'gemini-3.1-flash-lite';
  }
  return modelName!.trim();
}

export async function callGeminiResponse({
  geminiKey,
  targetModel,
  systemPrompt,
  messageText,
  timeoutMs,
}: {
  geminiKey: string;
  targetModel?: string;
  systemPrompt: string;
  messageText: string;
  timeoutMs?: number;
}): Promise<string> {
  const ai = new GoogleGenAI({
    apiKey: geminiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const preferred = resolveGeminiModelName(targetModel);
  // Place high-availability and fast 'gemini-3.1-flash-lite' immediately as first fallback
  // to seamlessly handle temporary 503 high-demand / capacity spikes on 3.8-flash
  const candidateModels = Array.from(
    new Set([preferred, 'gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'])
  );
  const totalTimeout = timeoutMs || 60000;
  const deadline = Date.now() + totalTimeout;

  let lastErr: any = null;
  for (const model of candidateModels) {
    const remainingTotalMs = deadline - Date.now();
    if (remainingTotalMs < 2000) {
      break;
    }
    const perAttemptTimeout = Math.min(25000, Math.max(4000, remainingTotalMs));

    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() >= deadline - 1000) break;

      let timer: NodeJS.Timeout | null = null;
      try {
        const generatePromise = ai.models.generateContent({
          model,
          contents: messageText,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.7,
          },
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Gemini 请求超时 (${Math.round(perAttemptTimeout / 1000)}秒)`)),
            perAttemptTimeout
          );
        });
        const response: any = await Promise.race([generatePromise, timeoutPromise]);
        if (timer) clearTimeout(timer);
        const text = (response?.text || '').trim();
        if (text) {
          return text;
        }
      } catch (err: any) {
        if (timer) clearTimeout(timer);
        lastErr = err;
        const errMsg = err?.message || String(err);
        console.warn(`Gemini generation with model [${model}] attempt ${attempt + 1} notice:`, errMsg);

        const isHighDemand =
          errMsg.includes('503') ||
          errMsg.includes('high demand') ||
          errMsg.includes('UNAVAILABLE') ||
          errMsg.includes('429');

        // On 503 / UNAVAILABLE / high demand, immediately failover to next candidate model
        // without burning time retrying the exact same overloaded model cluster
        if (isHighDemand) {
          break;
        }

        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    }
  }
  throw lastErr || new Error('Gemini generation failed');
}
