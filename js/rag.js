// Tiny in-browser RAG: BM25 over the knowledge base, section summaries and page notes.
// Hebrew-aware tokenizer (strips common one-letter prefixes) so "בכבל" matches "כבל".
import { KNOWLEDGE, SECTIONS, PAGE_NOTES } from './data.js';
import { log } from './log.js';

const PREFIXES = ['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ'];
const STOP = new Set(['את', 'של', 'על', 'זה', 'זאת', 'אני', 'לא', 'מה', 'איך', 'אם', 'גם', 'עם', 'יש', 'הוא', 'היא', 'כי', 'או', 'אז', 'פה', 'כאן', 'the', 'a', 'is']);

export function tokenize(text) {
  const raw = String(text).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const out = [];
  for (const t of raw) {
    if (STOP.has(t)) continue;
    out.push(t);
    // strip up to two prefix letters (e.g. "וה", "שב")
    let s = t;
    for (let i = 0; i < 2 && s.length > 3 && PREFIXES.includes(s[0]); i++) {
      s = s.slice(1);
      out.push(s);
    }
    // normalize final letters + plural endings
    if (s.length > 4 && (s.endsWith('ים') || s.endsWith('ות'))) out.push(s.slice(0, -2));
  }
  return out;
}

const docs = [
  ...KNOWLEDGE.map((k) => ({ id: k.id, kind: 'kb', title: k.title, text: k.text, boost: k.tags })),
  ...SECTIONS.map((s) => ({ id: `sec-${s.id}`, kind: 'section', title: s.title, text: `${s.desc} עמודים ${s.from}-${s.to}.`, page: s.from, boost: s.title })),
  ...Object.entries(PAGE_NOTES).map(([p, t]) => ({ id: `page-${p}`, kind: 'page', title: `עמוד ${p}`, text: t, page: +p, boost: '' })),
];

// Precompute the index once.
const index = docs.map((d) => {
  const toks = [...tokenize(`${d.title} ${d.text}`), ...tokenize(`${d.boost} ${d.boost}`)];
  const tf = new Map();
  toks.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
  return { doc: d, tf, len: toks.length };
});
const avgLen = index.reduce((a, b) => a + b.len, 0) / index.length;
const df = new Map();
index.forEach(({ tf }) => tf.forEach((_, t) => df.set(t, (df.get(t) || 0) + 1)));
const N = index.length;
const idf = (t) => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));

const cache = new Map();

export function search(query, { k = 4, page } = {}) {
  const key = `${query}|${page}|${k}`;
  if (cache.has(key)) {
    log('rag', `cache hit "${query}"`);
    return cache.get(key);
  }
  const t0 = performance.now();
  const q = [...new Set(tokenize(query))];
  const k1 = 1.4, b = 0.75;
  const scored = index.map(({ doc, tf, len }) => {
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (f) s += idf(t) * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * len) / avgLen)));
    }
    // notes about the page the kid is looking at matter; notes about other pages much less
    if (doc.kind === 'page') s = page && Math.abs(doc.page - page) <= 1 ? s + 1.5 : s * 0.5;
    return { doc, score: s };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  log('rag', `bm25 "${query}" → ${scored.map((r) => `${r.doc.id}:${r.score.toFixed(2)}`).join(', ') || 'no hits'}`, performance.now() - t0);
  cache.set(key, scored);
  return scored;
}

export const DOC_COUNT = docs.length;
