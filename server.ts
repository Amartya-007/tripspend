import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // AI categorization proxy endpoint (keeps GEMINI_API_KEY strictly server-side)
  app.post('/api/categorize-expense', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'AI service unavailable (missing key)' });
      }

      const { ocrText, availableCategories, expenseAmount } = req.body || {};
      if (!ocrText || typeof ocrText !== 'string' || !Array.isArray(availableCategories)) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      // Input size restriction to prevent resource exhaustion
      const trimmedText = ocrText.slice(0, 4000);
      const safeCategories = availableCategories.filter((c): c is string => typeof c === 'string').slice(0, 50);

      if (safeCategories.length === 0) {
        return res.status(400).json({ error: 'No categories provided' });
      }

      const ai = new GoogleGenAI({ apiKey });
      const prompt = [
        'You are an expense categorizer.',
        `Pick exactly one category from: ${safeCategories.join(', ')}`,
        typeof expenseAmount === 'number' ? `Amount: ${expenseAmount}` : '',
        'Return ONLY JSON: {"category":"...","confidence":0-1,"reasoning":"..."}',
        'Receipt text:',
        trimmedText,
      ].filter(Boolean).join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const responseText = response.text || '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.status(502).json({ error: 'Invalid AI response format' });
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return res.json({
        category: typeof parsed.category === 'string' ? parsed.category : safeCategories[0],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.8,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      });
    } catch (err) {
      console.error('Server AI categorization error:', err instanceof Error ? err.message : 'Unknown');
      return res.status(500).json({ error: 'Failed to process AI categorization' });
    }
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
