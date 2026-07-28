import express from 'express';
import { GoogleGenAI } from '@google/genai';
import path from 'path';
import { cert, getApps, initializeApp as initializeAdminApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createServer as createViteServer } from 'vite';

const RATE_LIMIT_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;
const AI_REQUEST_TIMEOUT_MS = 15_000;
const requestBuckets = new Map<string, { firstRequestAt: number; count: number }>();
const MAX_RATE_LIMIT_BUCKETS = 10_000;

function getAdminAuth() {
  try {
    const app = getApps()[0] || initializeAdminApp({
      credential: process.env.FIREBASE_SERVICE_ACCOUNT_KEY
        ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY))
        : applicationDefault(),
    });
    return getAuth(app);
  } catch {
    return null;
  }
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = requestBuckets.get(key);

  if (!bucket || now - bucket.firstRequestAt > RATE_LIMIT_WINDOW_MS) {
    requestBuckets.set(key, { firstRequestAt: now, count: 1 });
    return false;
  }

  if (bucket.count >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  bucket.count += 1;
  if (requestBuckets.size > MAX_RATE_LIMIT_BUCKETS) {
    for (const [bucketKey, value] of requestBuckets) {
      if (now - value.firstRequestAt > RATE_LIMIT_WINDOW_MS) requestBuckets.delete(bucketKey);
    }
  }
  return false;
}

async function verifyFirebaseIdToken(authorization?: string) {
  if (!authorization) return null;
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : authorization.trim();
  if (!token) return null;

  try {
    const adminAuth = getAdminAuth();
    return adminAuth ? await adminAuth.verifyIdToken(token) : null;
  } catch {
    return null;
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.post('/api/categorize-expense', async (req, res) => {
    try {
      const authToken = req.headers.authorization as string | undefined;
      const decodedToken = await verifyFirebaseIdToken(authToken);
      if (!decodedToken?.uid) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const rateKey = `${decodedToken.uid}:${req.ip}`;
      if (isRateLimited(rateKey)) {
        return res.status(429).json({ error: 'Rate limit exceeded' });
      }

      const payload = req.body;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return res.status(400).json({ error: 'Invalid payload' });
      }

      const allowedKeys = ['ocrText', 'availableCategories', 'expenseAmount'];
      if (!Object.keys(payload).every((key) => allowedKeys.includes(key))) {
        return res.status(400).json({ error: 'Unexpected payload fields' });
      }

      const { ocrText, availableCategories, expenseAmount } = payload as {
        ocrText?: unknown;
        availableCategories?: unknown;
        expenseAmount?: unknown;
      };

      if (typeof ocrText !== 'string' || !ocrText.trim()) {
        return res.status(400).json({ error: 'Invalid OCR text' });
      }

      if (!Array.isArray(availableCategories) || availableCategories.length === 0 || availableCategories.length > 50) {
        return res.status(400).json({ error: 'Invalid categories' });
      }

      const safeCategories = availableCategories
        .filter((c): c is string => typeof c === 'string' && c.trim().length > 0 && c.length <= 80)
        .slice(0, 50);
      if (safeCategories.length === 0) {
        return res.status(400).json({ error: 'No valid categories provided' });
      }

      if (expenseAmount !== undefined && typeof expenseAmount !== 'number') {
        return res.status(400).json({ error: 'Invalid expense amount' });
      }
      if (typeof expenseAmount === 'number' && (!Number.isFinite(expenseAmount) || expenseAmount < 0 || expenseAmount > 1_000_000)) {
        return res.status(400).json({ error: 'Expense amount out of bounds' });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: 'AI service unavailable (missing key)' });
      }

      const trimmedText = ocrText.trim().slice(0, 4000);
      const ai = new GoogleGenAI({ apiKey });
      const prompt = [
        'You are an expense categorizer.',
        `Pick exactly one category from: ${safeCategories.join(', ')}`,
        typeof expenseAmount === 'number' ? `Amount: ${expenseAmount}` : '',
        'Return ONLY JSON: {"category":"...","confidence":0-1,"reasoning":"..."}',
        'Receipt text:',
        trimmedText,
      ].filter(Boolean).join('\n');

      const contentPromise = ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      const response = await Promise.race([
        contentPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI request timed out')), AI_REQUEST_TIMEOUT_MS)),
      ]);

      const responseText = (response as any)?.text || '';
      const jsonMatch = typeof responseText === 'string' ? responseText.match(/\{[\s\S]*\}/) : null;
      if (!jsonMatch) {
        return res.status(502).json({ error: 'Invalid AI response format' });
      }

      const parsed = JSON.parse(jsonMatch[0]) as { category?: unknown; confidence?: unknown; reasoning?: unknown };
      const rawCategory = typeof parsed.category === 'string' ? parsed.category : '';
      const category = safeCategories.includes(rawCategory) ? rawCategory : safeCategories[0];
      const confidence = typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1 ? parsed.confidence : 0.8;
      const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.trim().slice(0, 500) : '';

      return res.json({ category, confidence, reasoning });
    } catch (err) {
      console.error('Server AI categorization error:', err instanceof Error ? err.message : 'Unknown');
      if (err instanceof Error && err.message === 'AI request timed out') {
        return res.status(504).json({ error: 'AI request timed out' });
      }
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
