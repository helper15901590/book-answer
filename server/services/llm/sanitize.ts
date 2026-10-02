import { ChatMessage } from '../../../src/types.js';

// Helper to sanitize chat messages for DeepSeek / OpenAI compatible APIs
export function sanitizeMessagesForLLM(
  systemPrompt: string,
  history: ChatMessage[] = [],
  currentMessage: string
): { role: string; content: string }[] {
  const result: { role: string; content: string }[] = [];

  const cleanSystem = (systemPrompt || '').trim();
  if (cleanSystem) {
    result.push({ role: 'system', content: cleanSystem });
  }

  // Filter valid history messages
  const validHistory = (history || [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
    .slice(-12);

  for (const m of validHistory) {
    const trimmed = m.content.trim();
    // Prevent duplicate of current message at the very end of history
    if (m === validHistory[validHistory.length - 1] && m.role === 'user' && trimmed === currentMessage.trim()) {
      continue;
    }
    result.push({ role: m.role, content: trimmed });
  }

  const cleanUserMsg = (currentMessage || '').trim();
  if (cleanUserMsg) {
    result.push({ role: 'user', content: cleanUserMsg });
  }

  return result;
}

export function isInvalidOrPlaceholderKey(key?: string): boolean {
  if (!key) return true;
  const k = key.trim();
  if (k.length < 12) return true;
  if (k.includes('****')) return true;
  if (k.toLowerCase().includes('placeholder') || k.toLowerCase().includes('your_api_key')) return true;
  return false;
}

// Helper to sanitize API Keys
export function cleanApiKey(rawKey: string): string {
  let key = (rawKey || '').trim();
  if (key.startsWith('Bearer ')) {
    key = key.substring(7).trim();
  }
  key = key.replace(/^["']|["']$/g, '');
  return key;
}

// Helper to resolve standard OpenAI compatible endpoint
export function resolveOpenAIUrl(baseUrl: string): string {
  let url = (baseUrl || 'https://api.deepseek.com/v1').trim().replace(/\/+$/, '');
  if (url.endsWith('/chat/completions')) return url;
  if (url.endsWith('/v1') || url.includes('/compatible-mode') || url.endsWith('/openai')) {
    return `${url}/chat/completions`;
  }
  if (
    url.includes('openai.com') ||
    url.includes('siliconflow.cn') ||
    url.includes('groq.com') ||
    url.includes('moonshot.cn') ||
    url.includes('deepseek.com')
  ) {
    if (!url.includes('/v1')) {
      return `${url}/v1/chat/completions`;
    }
  }
  return `${url}/chat/completions`;
}
