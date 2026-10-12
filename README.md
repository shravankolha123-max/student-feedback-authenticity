# Feedback Review Analyzer

A small feedback review analyzer for teacher/student feedback data.

## Features

- Paste feedback text directly.
- Upload or paste a screenshot and crop a selected area before OCR.
- Upload Google Form CSV/TSV exports and preprocess them to keep only feedback/review text.
- Analyze feedback with detailed score bands, star rating, segmented explanation, repeated keyword counts, and evidence terms.
- Uses Groq when `GROQ_API_KEY` is configured, with a local fallback analyzer.

## Run locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

Keep your real API key inside `.env`, not in Git.
