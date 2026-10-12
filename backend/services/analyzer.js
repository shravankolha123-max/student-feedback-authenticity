const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const PERSONAL_FIELD = /(name|email|mail|phone|mobile|roll|id|prn|division|branch|class|section|timestamp|date|time|age|gender|address|contact)/i;
const REVIEW_FIELD = /(feedback|review|comment|suggestion|experience|opinion|remark|response|improve|teaching|teacher|lecture|course|subject|session|overall)/i;

const positiveTerms = [
  'excellent', 'clear', 'helpful', 'understanding', 'interactive', 'supportive',
  'knowledgeable', 'organized', 'practical', 'engaging', 'punctual', 'effective',
  'detailed', 'patient', 'encouraging', 'satisfied', 'genuine', 'good', 'best'
];

const negativeTerms = [
  'poor', 'unclear', 'boring', 'confusing', 'late', 'rude', 'difficult',
  'bad', 'worst', 'unhelpful', 'unsatisfied', 'fake', 'irrelevant', 'slow'
];

const genericTerms = [
  'nice', 'ok', 'okay', 'fine', 'good', 'great', 'best', 'awesome', 'perfect'
];

const multilingualTerms = {
  hi: {
    positive: ['अच्छा', 'बहुत अच्छा', 'स्पष्ट', 'सहायक', 'समझ', 'उपयोगी', 'व्यवस्थित', 'उत्कृष्ट', 'संतुष्ट', 'उदाहरण'],
    negative: ['खराब', 'अस्पष्ट', 'कठिन', 'धीमा', 'उबाऊ', 'समझ नहीं', 'असंतुष्ट', 'नकली'],
    generic: ['ठीक', 'ओके', 'अच्छा', 'बढ़िया'],
    academic: ['शिक्षक', 'कक्षा', 'व्याख्यान', 'विषय', 'उदाहरण', 'सुधार', 'समझाया', 'संकल्पना']
  },
  mr: {
    positive: ['चांगले', 'स्पष्ट', 'मदत', 'उपयुक्त', 'समजले', 'उत्कृष्ट', 'समाधानी', 'व्यवस्थित', 'उदाहरण'],
    negative: ['खराब', 'अस्पष्ट', 'कठीण', 'धीमे', 'कंटाळवाणे', 'समजले नाही', 'असमाधानी', 'बनावट'],
    generic: ['ठीक', 'ओके', 'चांगले', 'छान'],
    academic: ['शिक्षक', 'वर्ग', 'व्याख्यान', 'विषय', 'उदाहरण', 'सुधारणा', 'समजावले', 'संकल्पना']
  }
};

const languageNames = {
  en: 'English',
  hi: 'Hindi',
  mr: 'Marathi'
};

export async function analyzeFeedbackWithGroq({ feedback, source, language = 'en' }) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('Missing GROQ_API_KEY');
  }

  const response = await fetch(GROQ_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
      temperature: 0.15,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'You are a technical student feedback review analyst.',
            `Write all user-facing values in ${languageNames[language] || 'English'}.`,
            'Return only valid JSON with keys: score, bandLabel, starRating, technicalSummary, segments, keywordCounts, repeatedEvidence, deductionEvidence, recommendations.',
            'score is 0-100 where higher means more genuine and useful feedback.',
            'bandLabel must follow: 0-20 Fake/Low Quality, 21-40 Weak Review, 41-60 Average Review, 61-80 Satisfactory Review, 81-100 Genuine Review.',
            'starRating must be 1 to 5 using the same bands.',
            'segments must include 4-7 items with label, score, max, explanation.',
            'keywordCounts must count meaningful exact words or phrases that influenced the score.',
            'repeatedEvidence must explain which repeated words shaped confidence.',
            'deductionEvidence must explain exact words, repetitions, missing details, or weak signals that prevented a 100% score.',
            'recommendations must be 2-5 short next-step suggestions.'
          ].join(' ')
        },
        {
          role: 'user',
          content: JSON.stringify({ feedback, source, language })
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Groq returned ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  return normalizeAnalysis(JSON.parse(content), feedback, language);
}

export function preprocessFeedbackRows(rows) {
  const extracted = [];
  const ignoredFields = new Set();
  const usedFields = new Set();

  rows.forEach((row, index) => {
    const parts = [];
    Object.entries(row || {}).forEach(([field, value]) => {
      const key = String(field || '').trim();
      const text = String(value || '').trim();
      if (!text) return;

      if (PERSONAL_FIELD.test(key)) {
        ignoredFields.add(key);
        return;
      }

      const enoughWords = text.split(/\s+/).filter(Boolean).length >= 4;
      const reviewLikeField = REVIEW_FIELD.test(key);
      const sentenceLike = /[.!?]|because|teacher|class|lecture|subject|understand|explain|improve/i.test(text);

      if ((reviewLikeField && enoughWords) || (enoughWords && sentenceLike && text.length > 20)) {
        usedFields.add(key);
        parts.push(text);
      }
    });

    if (parts.length) {
      extracted.push({
        rowNumber: index + 1,
        review: parts.join(' ').replace(/\s+/g, ' ').trim()
      });
    }
  });

  return {
    reviews: extracted,
    combinedFeedback: extracted.map((item) => item.review).join('\n\n'),
    usedFields: [...usedFields],
    ignoredFields: [...ignoredFields],
    totalRows: rows.length,
    reviewRows: extracted.length
  };
}

export function localFeedbackAnalysis(feedback, source = 'manual', language = 'en') {
  const sentences = splitSentences(feedback);
  const words = tokenize(feedback);
  const counts = countKeywords(words, feedback);
  const terms = termsForLanguage(language);
  const positiveHits = sumCounts(counts, terms.positive);
  const negativeHits = sumCounts(counts, terms.negative);
  const genericHits = sumCounts(counts, terms.generic);
  const uniqueRatio = words.length ? new Set(words).size / words.length : 0;
  const sentenceScore = Math.min(20, sentences.length * 3);
  const detailScore = Math.min(25, countDetailSignals(feedback) * 3 + Math.round(words.length / 35));
  const languageScore = Math.min(25, positiveHits * 3 + Math.round(uniqueRatio * 12));
  const repetitionPenalty = Math.min(20, Math.max(0, genericHits - 4) * 3);
  const negativePenalty = Math.min(20, negativeHits * 4);
  const sourceBonus = source === 'google-form' ? 4 : 0;
  const rawScore = 35 + sentenceScore + detailScore + languageScore + sourceBonus - repetitionPenalty - negativePenalty;
  const score = clampInteger(rawScore, 0, 100, 50);
  const band = bandForScore(score);
  const keywordCounts = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 18)
    .map(([term, count]) => ({ term, count, sentiment: termSentiment(term) }));

  return normalizeAnalysis({
    score,
    bandLabel: localizeBand(band, language),
    starRating: band.stars,
    technicalSummary: buildTechnicalSummary(score, words.length, sentences.length, uniqueRatio, source, language),
    segments: [
      {
        label: localText(language, 'segmentation'),
        score: sentenceScore,
        max: 20,
        explanation: localText(language, 'segmentationNote', { sentences: sentences.length })
      },
      {
        label: localText(language, 'specificity'),
        score: detailScore,
        max: 25,
        explanation: localText(language, 'specificityNote')
      },
      {
        label: localText(language, 'authenticity'),
        score: languageScore,
        max: 25,
        explanation: localText(language, 'authenticityNote')
      },
      {
        label: localText(language, 'repetition'),
        score: Math.max(0, 15 - repetitionPenalty),
        max: 15,
        explanation: localText(language, 'repetitionNote')
      },
      {
        label: localText(language, 'negative'),
        score: Math.max(0, 15 - negativePenalty),
        max: 15,
        explanation: localText(language, 'negativeNote')
      }
    ],
    keywordCounts,
    repeatedEvidence: keywordCounts
      .filter((item) => item.count > 1)
      .slice(0, 8)
      .map((item) => localText(language, 'repeatedSentence', item)),
    deductionEvidence: buildDeductionEvidence({
      score,
      keywordCounts,
      sentenceScore,
      detailScore,
      repetitionPenalty,
      negativePenalty,
      wordCount: words.length,
      language
    }),
    recommendations: buildRecommendations(score, words.length, source, language)
  }, feedback, language);
}

function normalizeAnalysis(analysis, feedback, language = 'en') {
  const score = clampInteger(analysis.score, 0, 100, 50);
  const band = bandForScore(score);

  return {
    score,
    bandLabel: analysis.bandLabel || localizeBand(band, language),
    starRating: clampInteger(analysis.starRating, 1, 5, band.stars),
    technicalSummary: String(analysis.technicalSummary || buildTechnicalSummary(score, tokenize(feedback).length, splitSentences(feedback).length, 0, 'manual', language)),
    segments: Array.isArray(analysis.segments) && analysis.segments.length
      ? analysis.segments.slice(0, 7).map(normalizeSegment)
      : localFeedbackAnalysis(feedback, 'manual', language).segments,
    keywordCounts: Array.isArray(analysis.keywordCounts) && analysis.keywordCounts.length
      ? analysis.keywordCounts.slice(0, 20).map(normalizeKeyword)
      : [],
    repeatedEvidence: Array.isArray(analysis.repeatedEvidence) && analysis.repeatedEvidence.length
      ? analysis.repeatedEvidence.slice(0, 10).map(String)
      : [localText(language, 'noRepeated')],
    deductionEvidence: Array.isArray(analysis.deductionEvidence) && analysis.deductionEvidence.length
      ? analysis.deductionEvidence.slice(0, 8).map(String)
      : buildDeductionEvidence({ score, keywordCounts: [], wordCount: tokenize(feedback).length, language }),
    recommendations: Array.isArray(analysis.recommendations) && analysis.recommendations.length
      ? analysis.recommendations.slice(0, 5).map(String)
      : buildRecommendations(score, tokenize(feedback).length, 'manual', language)
  };
}

function normalizeSegment(segment) {
  const max = clampInteger(segment.max, 1, 100, 10);
  return {
    label: String(segment.label || 'Segment'),
    score: clampInteger(segment.score, 0, max, Math.round(max / 2)),
    max,
    explanation: String(segment.explanation || 'Segment analyzed.')
  };
}

function normalizeKeyword(item) {
  if (typeof item === 'string') {
    return { term: item, count: 1, sentiment: termSentiment(item) };
  }
  const term = String(item.term || item.word || 'feedback').toLowerCase();
  return {
    term,
    count: clampInteger(item.count, 1, 999, 1),
    sentiment: item.sentiment || termSentiment(term)
  };
}

function splitSentences(text) {
  return String(text || '').split(/[.!?\n]+/).map((part) => part.trim()).filter(Boolean);
}

function tokenize(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{M}]{2,}/gu) || [];
}

function countKeywords(words, text) {
  const important = [...new Set([
    ...positiveTerms,
    ...negativeTerms,
    ...genericTerms,
    ...multilingualTerms.hi.positive,
    ...multilingualTerms.hi.negative,
    ...multilingualTerms.hi.generic,
    ...multilingualTerms.hi.academic,
    ...multilingualTerms.mr.positive,
    ...multilingualTerms.mr.negative,
    ...multilingualTerms.mr.generic,
    ...multilingualTerms.mr.academic,
    'teacher', 'lecture', 'class', 'subject', 'explain', 'examples', 'practical', 'improve', 'understand'
  ])];
  const counts = Object.fromEntries(important.map((term) => [term, 0]));
  words.forEach((word) => {
    if (counts[word] !== undefined) counts[word] += 1;
  });
  const lower = text.toLowerCase();
  ['well explained', 'easy to understand', 'needs improvement', 'very helpful', 'clear explanation', 'समझने में आसान', 'स्पष्ट समझाया', 'सुधार की जरूरत', 'समजायला सोपे', 'स्पष्ट समजावले', 'सुधारणा आवश्यक'].forEach((phrase) => {
    const matches = lower.match(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    if (matches?.length) counts[phrase] = matches.length;
  });
  return counts;
}

function sumCounts(counts, terms) {
  return terms.reduce((sum, term) => sum + (counts[term] || 0), 0);
}

function countDetailSignals(text) {
  const signals = text.match(/(teacher|lecture|class|subject|topic|example|practical|assignment|explain|understand|doubt|notes|concept|improve|syllabus|शिक्षक|कक्षा|व्याख्यान|विषय|उदाहरण|सुधार|समझाया|संकल्पना|वर्ग|सुधारणा|समजावले)/gi);
  return signals ? signals.length : 0;
}

function termSentiment(term) {
  const allPositive = [...positiveTerms, ...multilingualTerms.hi.positive, ...multilingualTerms.mr.positive];
  const allNegative = [...negativeTerms, ...multilingualTerms.hi.negative, ...multilingualTerms.mr.negative];
  const allGeneric = [...genericTerms, ...multilingualTerms.hi.generic, ...multilingualTerms.mr.generic];
  if (allPositive.includes(term)) return 'positive';
  if (allNegative.includes(term)) return 'negative';
  if (allGeneric.includes(term)) return 'generic';
  return 'academic';
}

function bandForScore(score) {
  if (score <= 20) return { label: 'Fake / Low Quality Review', stars: 1 };
  if (score <= 40) return { label: 'Weak Review', stars: 2 };
  if (score <= 60) return { label: 'Average Review', stars: 3 };
  if (score <= 80) return { label: 'Satisfactory Review', stars: 4 };
  return { label: 'Genuine Review', stars: 5 };
}

function buildTechnicalSummary(score, wordCount, sentenceCount, uniqueRatio, source, language = 'en') {
  const band = bandForScore(score);
  if (language === 'hi') {
    const sourceNote = source === 'google-form'
      ? 'Google Form डेटा को पहले preprocess किया गया, इसलिए personal details analysis से हटाई गईं।'
      : 'दिए गए text को सीधे analyze किया गया।';
    return `${localizeBand(band, language)} और ${band.stars} star. Analyzer ने ${sentenceCount} sentence block(s), ${wordCount} word(s), vocabulary diversity (${Math.round(uniqueRatio * 100)}%), repeated evidence terms और configured score band को check किया। ${sourceNote}`;
  }
  if (language === 'mr') {
    const sourceNote = source === 'google-form'
      ? 'Google Form data आधी preprocess केला, त्यामुळे personal details analysis मधून काढल्या.'
      : 'दिलेला text थेट analyze केला.'
    return `${localizeBand(band, language)} आणि ${band.stars} star. Analyzer ने ${sentenceCount} sentence block(s), ${wordCount} word(s), vocabulary diversity (${Math.round(uniqueRatio * 100)}%), repeated evidence terms आणि configured score band तपासला. ${sourceNote}`;
  }
  const sourceNote = source === 'google-form'
    ? 'The Google Form data was preprocessed so personal details were removed before analysis.'
    : 'The submitted text was analyzed directly.';
  return `${band.label} with ${band.stars} star(s). The analyzer segmented ${sentenceCount} sentence block(s), reviewed ${wordCount} word(s), checked vocabulary diversity (${Math.round(uniqueRatio * 100)}%), counted repeated evidence terms, and mapped the result to the configured score band. ${sourceNote}`;
}

function buildRecommendations(score, wordCount, source, language = 'en') {
  if (language === 'hi') {
    const tips = [];
    if (wordCount < 40) tips.push('Feedback थोड़ा लंबा collect करें ताकि stronger evidence मिल सके।');
    if (score < 61) tips.push('Students से specific lecture topics, examples और improvement points लिखवाएँ।');
    if (score >= 81) tips.push('यह feedback genuine review summary में include किया जा सकता है।');
    if (source === 'google-form') tips.push('Preprocessing table देखकर confirm करें कि सिर्फ feedback columns चुने गए हैं।');
    tips.push('Keyword count table से explain करें कि score किन words की वजह से बना।');
    return tips.slice(0, 5);
  }
  if (language === 'mr') {
    const tips = [];
    if (wordCount < 40) tips.push('Feedback थोडा मोठा collect करा, म्हणजे stronger evidence मिळेल.');
    if (score < 61) tips.push('Students कडून specific lecture topics, examples आणि improvement points लिहून घ्या.');
    if (score >= 81) tips.push('हा feedback genuine review summary मध्ये include करता येईल.');
    if (source === 'google-form') tips.push('Preprocessing table पाहून फक्त feedback columns निवडले आहेत का ते confirm करा.');
    tips.push('Keyword count table वापरून score कोणत्या words मुळे आला ते explain करा.');
    return tips.slice(0, 5);
  }
  const tips = [];
  if (wordCount < 40) tips.push('Collect longer feedback so the analysis can identify stronger evidence.');
  if (score < 61) tips.push('Ask students to mention specific lecture topics, examples, and improvement points.');
  if (score >= 81) tips.push('This feedback contains strong useful signals and can be included in the genuine review summary.');
  if (source === 'google-form') tips.push('Review the preprocessing table to confirm only feedback columns were selected.');
  tips.push('Use the keyword count table to explain exactly which words influenced the score.');
  return tips.slice(0, 5);
}

function termsForLanguage(language) {
  if (!multilingualTerms[language]) {
    return {
      positive: positiveTerms,
      negative: negativeTerms,
      generic: genericTerms
    };
  }
  return {
    positive: [...positiveTerms, ...multilingualTerms[language].positive],
    negative: [...negativeTerms, ...multilingualTerms[language].negative],
    generic: [...genericTerms, ...multilingualTerms[language].generic]
  };
}

function localizeBand(band, language) {
  const labels = {
    hi: {
      'Fake / Low Quality Review': 'नकली / कम गुणवत्ता वाला Review',
      'Weak Review': 'Weak Review',
      'Average Review': 'Average Review',
      'Satisfactory Review': 'Satisfactory Review',
      'Genuine Review': 'Genuine Review'
    },
    mr: {
      'Fake / Low Quality Review': 'बनावट / कमी गुणवत्तेचा Review',
      'Weak Review': 'Weak Review',
      'Average Review': 'Average Review',
      'Satisfactory Review': 'Satisfactory Review',
      'Genuine Review': 'Genuine Review'
    }
  };
  return labels[language]?.[band.label] || band.label;
}

function buildDeductionEvidence({ score, keywordCounts = [], sentenceScore = 0, detailScore = 0, repetitionPenalty = 0, negativePenalty = 0, wordCount = 0, language = 'en' }) {
  if (score >= 100) return [localText(language, 'perfectScore')];
  const items = [];
  const generic = keywordCounts.filter((item) => item.sentiment === 'generic' && item.count > 0).slice(0, 4);
  const negative = keywordCounts.filter((item) => item.sentiment === 'negative' && item.count > 0).slice(0, 4);
  if (generic.length) items.push(localText(language, 'genericDeduction', { terms: generic.map((item) => `${item.term} (${item.count})`).join(', ') }));
  if (negative.length) items.push(localText(language, 'negativeDeduction', { terms: negative.map((item) => `${item.term} (${item.count})`).join(', ') }));
  if (wordCount < 40) items.push(localText(language, 'shortDeduction'));
  if (sentenceScore < 12) items.push(localText(language, 'segmentDeduction'));
  if (detailScore < 15) items.push(localText(language, 'detailDeduction'));
  if (repetitionPenalty > 0) items.push(localText(language, 'repetitionDeduction'));
  if (negativePenalty > 0) items.push(localText(language, 'negativePenaltyDeduction'));
  if (!items.length) items.push(localText(language, 'balancedDeduction'));
  return items.slice(0, 8);
}

function localText(language, key, values = {}) {
  const text = {
    en: {
      segmentation: 'Text Segmentation',
      segmentationNote: `${values.sentences} sentence segment(s) were detected, which helps separate individual feedback points.`,
      specificity: 'Specificity Signals',
      specificityNote: 'Concrete details such as teaching, lecture, subject, explanation, examples, or improvement terms increase usefulness.',
      authenticity: 'Language Authenticity',
      authenticityNote: 'Natural positive/negative academic words and vocabulary variety are used to estimate genuine feedback quality.',
      repetition: 'Repetition Control',
      repetitionNote: 'Repeated generic terms reduce confidence because they can make feedback look shallow or copied.',
      negative: 'Negative/Fake Indicators',
      negativeNote: 'Strong fake, vague, or low-quality indicators lower the final band.',
      repeatedSentence: `${values.term} appeared ${values.count} time(s), contributing as a ${values.sentiment} signal.`,
      noRepeated: 'No strong repeated evidence terms were detected.',
      perfectScore: 'No deduction evidence found because the score reached 100%.',
      genericDeduction: `Generic wording reduced confidence: ${values.terms}.`,
      negativeDeduction: `Negative or low-quality wording reduced score: ${values.terms}.`,
      shortDeduction: 'The feedback is short, so there is not enough depth for a perfect score.',
      segmentDeduction: 'Few sentence segments were found, so the review does not cover many separate points.',
      detailDeduction: 'Specific academic details such as topic, example, concept, lecture, or improvement are limited.',
      repetitionDeduction: 'Repeated generic words created a repetition penalty.',
      negativePenaltyDeduction: 'Negative or fake-related indicators created a score penalty.',
      balancedDeduction: 'The review is useful, but it does not include enough unique, specific evidence for a perfect 100%.'
    },
    hi: {
      segmentation: 'Text Segmentation',
      segmentationNote: `${values.sentences} sentence segment(s) मिले, जिससे अलग-अलग feedback points separate हुए।`,
      specificity: 'Specificity Signals',
      specificityNote: 'Teaching, lecture, subject, examples या improvement जैसे concrete details score बढ़ाते हैं।',
      authenticity: 'Language Authenticity',
      authenticityNote: 'Natural academic words और vocabulary variety genuine quality estimate करने में मदद करते हैं।',
      repetition: 'Repetition Control',
      repetitionNote: 'Repeated generic words confidence कम करते हैं क्योंकि feedback shallow/copy जैसा लग सकता है।',
      negative: 'Negative/Fake Indicators',
      negativeNote: 'Fake, vague या low-quality indicators final band को कम करते हैं।',
      repeatedSentence: `${values.term} ${values.count} time(s) आया, यह ${values.sentiment} signal की तरह count हुआ।`,
      noRepeated: 'Strong repeated evidence terms नहीं मिले।',
      perfectScore: 'Score 100% है, इसलिए कोई deduction evidence नहीं मिला।',
      genericDeduction: `Generic wording ने confidence कम किया: ${values.terms}.`,
      negativeDeduction: `Negative/low-quality wording ने score कम किया: ${values.terms}.`,
      shortDeduction: 'Feedback छोटा है, इसलिए perfect score के लिए depth कम है।',
      segmentDeduction: 'Sentence segments कम हैं, इसलिए review कई अलग points cover नहीं करता।',
      detailDeduction: 'Topic, example, concept, lecture या improvement जैसे specific academic details limited हैं।',
      repetitionDeduction: 'Repeated generic words की वजह से repetition penalty लगी।',
      negativePenaltyDeduction: 'Negative या fake-related indicators की वजह से score penalty लगी।',
      balancedDeduction: 'Review useful है, लेकिन perfect 100% के लिए enough unique और specific evidence नहीं है।'
    },
    mr: {
      segmentation: 'Text Segmentation',
      segmentationNote: `${values.sentences} sentence segment(s) मिळाले, त्यामुळे वेगवेगळे feedback points separate झाले.`,
      specificity: 'Specificity Signals',
      specificityNote: 'Teaching, lecture, subject, examples किंवा improvement सारखे concrete details score वाढवतात.',
      authenticity: 'Language Authenticity',
      authenticityNote: 'Natural academic words आणि vocabulary variety genuine quality estimate करण्यास मदत करतात.',
      repetition: 'Repetition Control',
      repetitionNote: 'Repeated generic words confidence कमी करतात कारण feedback shallow/copy सारखा वाटू शकतो.',
      negative: 'Negative/Fake Indicators',
      negativeNote: 'Fake, vague किंवा low-quality indicators final band कमी करतात.',
      repeatedSentence: `${values.term} ${values.count} time(s) आले, ते ${values.sentiment} signal म्हणून count झाले.`,
      noRepeated: 'Strong repeated evidence terms सापडले नाहीत.',
      perfectScore: 'Score 100% आहे, म्हणून deduction evidence नाही.',
      genericDeduction: `Generic wording मुळे confidence कमी झाला: ${values.terms}.`,
      negativeDeduction: `Negative/low-quality wording मुळे score कमी झाला: ${values.terms}.`,
      shortDeduction: 'Feedback लहान आहे, त्यामुळे perfect score साठी depth कमी आहे.',
      segmentDeduction: 'Sentence segments कमी आहेत, त्यामुळे review अनेक वेगळे points cover करत नाही.',
      detailDeduction: 'Topic, example, concept, lecture किंवा improvement सारखे specific academic details limited आहेत.',
      repetitionDeduction: 'Repeated generic words मुळे repetition penalty लागली.',
      negativePenaltyDeduction: 'Negative किंवा fake-related indicators मुळे score penalty लागली.',
      balancedDeduction: 'Review useful आहे, पण perfect 100% साठी enough unique आणि specific evidence नाही.'
    }
  };
  return text[language]?.[key] || text.en[key] || key;
}

function clampInteger(value, min, max, fallback) {
  const numeric = Number.parseInt(value, 10);
  if (Number.isNaN(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}
