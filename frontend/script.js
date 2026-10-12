const feedbackText = document.getElementById('feedbackText');
const charCounter = document.getElementById('charCounter');
const wordCounter = document.getElementById('wordCounter');
const analyzeBtn = document.getElementById('analyzeBtn');
const healthStatus = document.getElementById('healthStatus');
const emptyState = document.getElementById('emptyState');
const resultsContent = document.getElementById('resultsContent');
const bandLabel = document.getElementById('bandLabel');
const starRating = document.getElementById('starRating');
const scoreRing = document.getElementById('scoreRing');
const scoreValue = document.getElementById('scoreValue');
const languageSelect = document.getElementById('languageSelect');
const engineInfo = document.getElementById('engineInfo');
const technicalSummary = document.getElementById('technicalSummary');
const segmentList = document.getElementById('segmentList');
const keywordGrid = document.getElementById('keywordGrid');
const deductionList = document.getElementById('deductionList');
const evidenceList = document.getElementById('evidenceList');
const recommendationList = document.getElementById('recommendationList');
const screenshotInput = document.getElementById('screenshotInput');
const dropZone = document.getElementById('dropZone');
const screenshotName = document.getElementById('screenshotName');
const cropper = document.getElementById('cropper');
const imageCanvas = document.getElementById('imageCanvas');
const selectionBox = document.getElementById('selectionBox');
const extractFullBtn = document.getElementById('extractFullBtn');
const extractCropBtn = document.getElementById('extractCropBtn');
const ocrStatus = document.getElementById('ocrStatus');
const formInput = document.getElementById('formInput');
const formPaste = document.getElementById('formPaste');
const preprocessPasteBtn = document.getElementById('preprocessPasteBtn');
const preprocessSummary = document.getElementById('preprocessSummary');
const preprocessWrap = document.getElementById('preprocessWrap');
const preprocessRows = document.getElementById('preprocessRows');

let activeSource = 'manual';
let loadedImage = null;
let imageScale = 1;
let cropSelection = null;
let dragStart = null;
let currentLanguage = 'en';

const uiText = {
  en: {
    characters: 'characters',
    words: 'words',
    groq: 'Analysis Engine: Groq AI',
    fallback: 'Analysis Engine: Local fallback analyzer',
    waiting: 'Analysis Engine: Waiting',
    noKeywords: 'No strong keyword evidence found.'
  },
  hi: {
    characters: 'characters',
    words: 'words',
    groq: 'Analysis Engine: Groq AI',
    fallback: 'Analysis Engine: Local fallback analyzer',
    waiting: 'Analysis Engine: Waiting',
    noKeywords: 'Strong keyword evidence नहीं मिला.'
  },
  mr: {
    characters: 'characters',
    words: 'words',
    groq: 'Analysis Engine: Groq AI',
    fallback: 'Analysis Engine: Local fallback analyzer',
    waiting: 'Analysis Engine: Waiting',
    noKeywords: 'Strong keyword evidence सापडले नाही.'
  }
};

function t(key) {
  return uiText[currentLanguage]?.[key] || uiText.en[key] || key;
}

function updateCounters() {
  const text = feedbackText.value;
  const words = text.trim().match(/\S+/g) || [];
  charCounter.textContent = `${text.length} ${t('characters')}`;
  wordCounter.textContent = `${words.length} ${t('words')}`;
}

function setStatus(message, type = 'info') {
  if (!message) {
    ocrStatus.hidden = true;
    ocrStatus.textContent = '';
    return;
  }
  ocrStatus.hidden = false;
  ocrStatus.textContent = message;
  ocrStatus.className = `status ${type}`;
}

function setLoading(isLoading) {
  analyzeBtn.disabled = isLoading;
  analyzeBtn.classList.toggle('loading', isLoading);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`${tab.dataset.tab}Panel`).classList.add('active');
    activeSource = tab.dataset.tab === 'forms' ? 'google-form' : tab.dataset.tab;
  });
});

feedbackText.addEventListener('input', updateCounters);
languageSelect.addEventListener('change', (event) => {
  currentLanguage = event.target.value;
  document.documentElement.lang = currentLanguage;
  updateCounters();
});

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    healthStatus.textContent = data.aiEnabled ? `Groq key configured (${data.model})` : 'Local fallback ready: add GROQ_API_KEY';
  } catch {
    healthStatus.textContent = 'Backend not reachable';
  }
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function rowsToObjects(rows) {
  const headers = rows[0].map((header, index) => header.trim() || `Column ${index + 1}`);
  return rows.slice(1).map((row) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = row[index] || '';
    });
    return object;
  });
}

formInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  const delimiter = file.name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
  await preprocessDelimitedText(text, delimiter);
});

preprocessPasteBtn.addEventListener('click', async () => {
  const text = formPaste.value.trim();
  if (!text) {
    preprocessSummary.textContent = 'Paste copied Google Form or Google Sheets response data first.';
    return;
  }

  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes('\t') ? '\t' : ',';
  await preprocessDelimitedText(text, delimiter);
});

async function preprocessDelimitedText(text, delimiter) {
  const rows = parseDelimited(text, delimiter);
  if (rows.length < 2) {
    preprocessSummary.textContent = 'Could not find enough form rows. Include the header row and at least one response row.';
    return;
  }

  try {
    const response = await fetch('/api/preprocess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: rowsToObjects(rows) })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Preprocessing failed.');

    feedbackText.value = data.combinedFeedback;
    updateCounters();
    activeSource = 'google-form';
    preprocessSummary.textContent = `Preprocessed ${data.reviewRows}/${data.totalRows} row(s). Used: ${data.usedFields.join(', ') || 'auto-detected text'}. Ignored personal fields: ${data.ignoredFields.join(', ') || 'none detected'}.`;
    preprocessRows.innerHTML = data.reviews.slice(0, 50).map((item) => `
      <tr>
        <td>${item.rowNumber}</td>
        <td>${escapeHtml(item.review)}</td>
      </tr>
    `).join('');
    preprocessWrap.hidden = !data.reviews.length;
  } catch (error) {
    preprocessSummary.textContent = error.message;
  }
}

dropZone.addEventListener('click', () => screenshotInput.click());
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    screenshotInput.click();
  }
});
dropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  dropZone.classList.add('dragging');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  loadScreenshot(event.dataTransfer.files[0]);
});
screenshotInput.addEventListener('change', (event) => loadScreenshot(event.target.files[0]));

document.addEventListener('paste', (event) => {
  const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
  if (file) loadScreenshot(file);
});

function loadScreenshot(file) {
  if (!file || !file.type.startsWith('image/')) return;
  screenshotName.textContent = file.name || 'Pasted screenshot';
  const image = new Image();
  image.onload = () => {
    loadedImage = image;
    cropper.hidden = false;
    cropSelection = null;
    selectionBox.hidden = true;
    drawImageToCanvas();
    extractFullBtn.disabled = false;
    extractCropBtn.disabled = true;
    setStatus('Screenshot loaded. Drag over the exact review area for snipping-style OCR.', 'success');
  };
  image.src = URL.createObjectURL(file);
}

function drawImageToCanvas() {
  const maxWidth = cropper.clientWidth || 380;
  imageScale = Math.min(1, maxWidth / loadedImage.naturalWidth);
  imageCanvas.width = Math.round(loadedImage.naturalWidth * imageScale);
  imageCanvas.height = Math.round(loadedImage.naturalHeight * imageScale);
  const context = imageCanvas.getContext('2d');
  context.drawImage(loadedImage, 0, 0, imageCanvas.width, imageCanvas.height);
}

function canvasPoint(event) {
  const rect = imageCanvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
  };
}

imageCanvas.addEventListener('pointerdown', (event) => {
  if (!loadedImage) return;
  dragStart = canvasPoint(event);
  cropSelection = null;
  selectionBox.hidden = false;
  updateSelectionBox(dragStart, dragStart);
});

imageCanvas.addEventListener('pointermove', (event) => {
  if (!dragStart) return;
  updateSelectionBox(dragStart, canvasPoint(event));
});

imageCanvas.addEventListener('pointerup', (event) => {
  if (!dragStart) return;
  const end = canvasPoint(event);
  cropSelection = normalizeSelection(dragStart, end);
  dragStart = null;
  extractCropBtn.disabled = cropSelection.width < 20 || cropSelection.height < 20;
});

function normalizeSelection(start, end) {
  return {
    left: Math.min(start.x, end.x),
    top: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function updateSelectionBox(start, end) {
  const selection = normalizeSelection(start, end);
  selectionBox.style.left = `${selection.left}px`;
  selectionBox.style.top = `${selection.top}px`;
  selectionBox.style.width = `${selection.width}px`;
  selectionBox.style.height = `${selection.height}px`;
}

function selectedCanvas() {
  const source = document.createElement('canvas');
  const context = source.getContext('2d');
  if (!cropSelection) {
    source.width = imageCanvas.width;
    source.height = imageCanvas.height;
    context.drawImage(imageCanvas, 0, 0);
    return source;
  }

  source.width = Math.round(cropSelection.width);
  source.height = Math.round(cropSelection.height);
  context.drawImage(
    imageCanvas,
    cropSelection.left,
    cropSelection.top,
    cropSelection.width,
    cropSelection.height,
    0,
    0,
    source.width,
    source.height
  );
  return source;
}

async function runOcr(useCrop) {
  if (!window.Tesseract) {
    setStatus('OCR library is still loading. Try again in a moment.', 'error');
    return;
  }
  if (!loadedImage) return;

  setStatus('Extracting text from screenshot...', 'info');
  const canvas = useCrop ? selectedCanvas() : (() => {
    const full = document.createElement('canvas');
    full.width = imageCanvas.width;
    full.height = imageCanvas.height;
    full.getContext('2d').drawImage(imageCanvas, 0, 0);
    return full;
  })();
  const ocrLanguage = currentLanguage === 'hi' ? 'hin' : currentLanguage === 'mr' ? 'mar' : 'eng';
  const { data } = await window.Tesseract.recognize(canvas, ocrLanguage);
  const cleaned = cleanOcrText(data.text);
  if (!cleaned) {
    setStatus('No readable review text found. Try selecting a tighter area.', 'error');
    return;
  }
  feedbackText.value = cleaned;
  updateCounters();
  activeSource = 'screenshot';
  setStatus('Text extracted and placed into the feedback box.', 'success');
}

function cleanOcrText(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 2)
    .filter((line) => !/^(name|email|roll|phone|timestamp|submit|next|back)$/i.test(line))
    .join('\n')
    .trim();
}

extractFullBtn.addEventListener('click', () => runOcr(false));
extractCropBtn.addEventListener('click', () => runOcr(true));

analyzeBtn.addEventListener('click', async () => {
  const feedback = feedbackText.value.trim();
  if (!feedback) {
    feedbackText.focus();
    return;
  }

  setLoading(true);
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedback, source: activeSource, language: currentLanguage })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Analysis failed.');
    renderResults(data);
  } catch (error) {
    alert(error.message);
  } finally {
    setLoading(false);
  }
});

function renderResults(data) {
  emptyState.hidden = true;
  resultsContent.hidden = false;
  const score = Number(data.score || 0);
  const stars = Number(data.starRating || 1);
  bandLabel.textContent = data.bandLabel || 'Feedback Review';
  starRating.textContent = `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)}`;
  engineInfo.textContent = data.source === 'groq'
    ? t('groq')
    : data.source === 'local-fallback'
      ? `${t('fallback')}${data.fallbackReason ? ` (${data.fallbackReason})` : ''}`
      : t('waiting');
  scoreValue.textContent = `${score}%`;
  scoreRing.style.setProperty('--score', score);
  scoreRing.className = `score-ring ${score <= 40 ? 'danger' : score <= 80 ? 'warning' : ''}`;
  technicalSummary.textContent = data.technicalSummary || '';
  segmentList.innerHTML = (data.segments || []).map((segment) => {
    const width = Math.round((Number(segment.score || 0) / Number(segment.max || 1)) * 100);
    return `
      <li>
        <div class="segment-top">
          <span>${escapeHtml(segment.label)}</span>
          <strong>${segment.score}/${segment.max}</strong>
        </div>
        <div class="track"><div class="fill" style="width:${width}%"></div></div>
        <p>${escapeHtml(segment.explanation)}</p>
      </li>
    `;
  }).join('');
  keywordGrid.innerHTML = (data.keywordCounts || []).map((item) => `
    <div class="keyword">
      <strong>${escapeHtml(item.term)}</strong>
      <span>${item.count} time(s) · ${escapeHtml(item.sentiment || 'signal')}</span>
    </div>
  `).join('') || `<p>${t('noKeywords')}</p>`;
  deductionList.innerHTML = (data.deductionEvidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  evidenceList.innerHTML = (data.repeatedEvidence || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  recommendationList.innerHTML = (data.recommendations || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

updateCounters();
checkHealth();
