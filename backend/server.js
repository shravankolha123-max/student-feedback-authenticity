import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeFeedbackWithGroq, localFeedbackAnalysis, preprocessFeedbackRows } from './services/analyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const port = process.env.PORT || 3000;
const hasGroqKey = () => Boolean(String(process.env.GROQ_API_KEY || '').trim());

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    aiEnabled: hasGroqKey(),
    aiProvider: hasGroqKey() ? 'groq' : 'local-fallback',
    model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant'
  });
});

app.post('/api/preprocess', (req, res) => {
  const { rows = [] } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(400).json({ error: 'Google Form rows are required.' });
  }

  res.json(preprocessFeedbackRows(rows));
});

app.post('/api/analyze', async (req, res) => {
  const { feedback, source = 'manual', language = 'en' } = req.body || {};
  const cleaned = String(feedback || '').trim();

  if (!cleaned) {
    return res.status(400).json({ error: 'Feedback text is required.' });
  }

  try {
    const analysis = await analyzeFeedbackWithGroq({ feedback: cleaned, source, language });
    res.json({ ...analysis, source: 'groq' });
  } catch (error) {
    console.error('Groq analysis failed:', error.message);
    res.json({
      ...localFeedbackAnalysis(cleaned, source, language),
      source: 'local-fallback',
      fallbackReason: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Feedback Review Analyzer running at http://localhost:${port}`);
});
