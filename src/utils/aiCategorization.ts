import { auth } from '../lib/firebase';

type AIResult = { category: string; confidence: number; reasoning: string };

export const categorizeExpenseWithAI = async (
  ocrText: string,
  availableCategories: string[],
  expenseAmount?: number
): Promise<AIResult | null> => {
  if (!ocrText || !ocrText.trim() || availableCategories.length === 0) {
    return null;
  }

  const currentUser = auth?.currentUser;
  if (!currentUser) {
    return null;
  }

  try {
    const idToken = await currentUser.getIdToken();
    const response = await fetch('/api/categorize-expense', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        ocrText: ocrText.slice(0, 4000),
        availableCategories,
        expenseAmount,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    if (!data || typeof data.category !== 'string') {
      return null;
    }

    return {
      category: data.category,
      confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0.8)),
      reasoning: typeof data.reasoning === 'string' ? data.reasoning : '',
    };
  } catch {
    return null;
  }
};

export const isAIConfigured = (): boolean => auth?.currentUser != null;
