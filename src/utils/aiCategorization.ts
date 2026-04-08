import { GoogleGenAI } from '@google/genai';

type AIResult = { category: string; confidence: number; reasoning: string };

let cachedClient: GoogleGenAI | null = null;
let cachedApiKey = '';

const getApiKey = () => {
  const env = import.meta.env as { VITE_GEMINI_API_KEY?: string };
  return env.VITE_GEMINI_API_KEY || '';
};

const getClient = () => {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  if (cachedClient && cachedApiKey === apiKey) {
    return cachedClient;
  }

  cachedApiKey = apiKey;
  cachedClient = new GoogleGenAI({ apiKey });
  return cachedClient;
};

const parseJsonFromText = <T>(text: string): T | null => {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
};

export const categorizeExpenseWithAI = async (
  ocrText: string,
  availableCategories: string[],
  expenseAmount?: number
): Promise<AIResult | null> => {
  const client = getClient();
  if (!client) return null;

  const categoriesSet = new Set(availableCategories);
  if (!categoriesSet.size) return null;

  const prompt = [
    'You are an expense categorizer.',
    `Pick exactly one category from: ${availableCategories.join(', ')}`,
    expenseAmount ? `Amount: ${expenseAmount}` : '',
    'Return ONLY JSON: {"category":"...","confidence":0-1,"reasoning":"..."}',
    'Receipt text:',
    ocrText,
  ].filter(Boolean).join('\n');

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const text = response.text || '';
    const parsed = parseJsonFromText<AIResult>(text);
    if (!parsed) return null;

    if (!categoriesSet.has(parsed.category)) {
      return null;
    }

    return {
      category: parsed.category,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reasoning: parsed.reasoning || '',
    };
  } catch (error) {
    console.error('AI categorization failed', error);
    return null;
  }
};

export const isAIConfigured = (): boolean => Boolean(getApiKey());
