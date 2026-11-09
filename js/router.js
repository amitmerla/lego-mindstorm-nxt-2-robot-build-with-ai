// Fast intent router ("simple map"): handles navigation & common commands with regexes,
// so the LLM is only woken up for real questions.
import { SECTIONS } from './data.js';

const NUM_WORDS = {
  'אחד': 1, 'אחת': 1, 'שתיים': 2, 'שניים': 2, 'שתים': 2, 'שני': 2, 'שלוש': 3, 'שלושה': 3, 'ארבע': 4, 'ארבעה': 4,
  'חמש': 5, 'חמישה': 5, 'שש': 6, 'שישה': 6, 'שבע': 7, 'שבעה': 7, 'שמונה': 8, 'תשע': 9, 'תשעה': 9,
  'עשר': 10, 'עשרה': 10, 'עשרים': 20, 'שלושים': 30, 'ארבעים': 40, 'חמישים': 50, 'שישים': 60,
  'שבעים': 70, 'שמונים': 80, 'תשעים': 90, 'מאה': 100,
};

function parseNumber(text) {
  const d = text.match(/\d+/);
  if (d) return +d[0];
  // "עשרים ושלוש", "מאה ועשר", "אחת עשרה"
  let total = 0, found = false;
  for (const w of text.split(/\s+/)) {
    const clean = w.replace(/^ו/, '');
    if (clean in NUM_WORDS) { total += NUM_WORDS[clean]; found = true; }
  }
  return found ? total : null;
}

const SECTION_WORDS = [
  [/ראש|עיניים|חיישן אולטרס/, 'head'],
  [/(^|\s)(ל|ה)?יד(יים)?(?=\s|$)|כתומ/, 'hands'],
  [/זרוע|זרועות/, 'arms'],
  [/כתפ/, 'shoulders'],
  [/מוח|לבנה|nxt|כבל/i, 'brain'],
  [/מותנ|ירכ/, 'hips'],
  [/רגל|כף/, 'foot1'],
];

const RULES = [
  { intent: 'next',     re: /^(הבא|הבאה|קדימה|הלאה|תמשיך|המשך|נמשיך|עמוד הבא|לעמוד הבא|שלב הבא|next)(?=\s|$)|^(סיימתי|גמרתי|עשיתי|מוכן)\s*$|תעביר (לעמוד )?הבא|לך (קדימה|הלאה)/i },
  { intent: 'done',     re: /^(סיימתי|גמרתי|עשיתי את זה|מוכן)/ },
  { intent: 'prev',     re: /(הקודם|הקודמת|אחורה|חזור|תחזור|חזרה|back|previous)/i },
  { intent: 'goto',     re: /(עמוד|דף|שלב|תעבור ל|לך ל)\s*([\dא-ת ]+)/ },
  { intent: 'photo',    re: /(צלם|תצלם|תמונה|מצלמה|תבדוק את (ה)?בני|בדוק לי|תסתכל על)/ },
  { intent: 'progress', re: /(כמה (נשאר|עוד|אחוז)|איפה אני|כמה התקדמתי|אחוזים)/ },
  { intent: 'stop',     re: /^(עצור|תפסיק|שקט|די)$/ },
  { intent: 'zoom',     re: /(תגדיל|זום|הגדל)/ },
];

/** Returns {intent, args, confidence}. intent==='question' means: send to RAG/LLM. */
export function route(text) {
  const t = text.trim().replace(/[?!.,]+$/g, '');
  for (const { intent, re } of RULES) {
    const m = t.match(re);
    if (!m) continue;
    if (intent === 'goto') {
      const n = parseNumber(m[2]);
      if (n) return { intent: 'goto', args: { page: n }, confidence: 0.95 };
      const sec = SECTION_WORDS.find(([r]) => r.test(t));
      if (sec) return { intent: 'section', args: { section: sec[1] }, confidence: 0.85 };
      continue;
    }
    // short utterances are commands; long ones containing a command word are probably questions
    if (t.split(/\s+/).length > 6 && intent !== 'photo') break;
    return { intent, args: {}, confidence: 0.9 };
  }
  return { intent: 'question', args: {}, confidence: 0 };
}
