import { SECTIONS, PAGE_NOTES, TOTAL_PAGES, pageImage } from './data.js';
import { log, onLog } from './log.js';
import { route } from './router.js';
import { DOC_COUNT } from './rag.js';
import { createTools, registerWebMCP } from './tools.js';
import { AI } from './ai.js';
import { Voice } from './voice.js';

const $ = (s) => document.querySelector(s);
const STORE = 'alpharex.v1';
const DEFAULT_SEC_PER_PAGE = 75;

// ---------------------------------------------------------------- state
const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } })();
const state = {
  page: Math.min(Math.max(saved.page || 1, 1), TOTAL_PAGES),
  done: new Set(saved.done || []),
  durations: saved.durations || [], // seconds spent per finished page → ETA
  pageStart: performance.now(),
};
const persist = () => {
  try { localStorage.setItem(STORE, JSON.stringify({ page: state.page, done: [...state.done], durations: state.durations.slice(-40) })); } catch { /* private mode */ }
};

const sectionOf = (p) => SECTIONS.find((s) => p >= s.from && p <= s.to);
const noteOf = (p) => PAGE_NOTES[p] || sectionOf(p).desc;
const pct = () => Math.round((state.done.size / TOTAL_PAGES) * 100);

// ---------------------------------------------------------------- app API (used by tools / WebMCP)
const app = {
  get page() { return state.page; },
  next() {
    markDone(state.page);
    if (state.page < TOTAL_PAGES) goTo(state.page + 1, 'next');
  },
  prev() { if (state.page > 1) goTo(state.page - 1, 'prev'); },
  goTo: (n) => goTo(n, n >= state.page ? 'next' : 'prev'),
  openCamera: () => openCamera(),
  status() {
    const s = sectionOf(state.page);
    return { page: state.page, total: TOTAL_PAGES, section: s.title, note: noteOf(state.page), progressPercent: pct(), pagesDone: state.done.size };
  },
};

// ---------------------------------------------------------------- page rendering
const img = $('#pageImg');
const viewport = $('#pageViewport');

function goTo(n, dir = 'next') {
  n = Math.min(Math.max(Math.round(n), 1), TOTAL_PAGES);
  if (n === state.page && img.src) return;
  log('nav', `page ${state.page} → ${n}`);
  const prevSection = sectionOf(state.page);
  state.page = n;
  state.pageStart = performance.now();
  renderPage(dir);
  persist();
  const sec = sectionOf(n);
  if (sec !== prevSection && dir === 'next' && n === sec.from) {
    toastSection(sec);
  }
}

function renderPage(dir) {
  const p = state.page;
  const sec = sectionOf(p);
  viewport.classList.remove('zoomed', 'anim-next', 'anim-prev');
  void viewport.offsetWidth; // restart animation
  if (dir) viewport.classList.add(`anim-${dir}`);
  img.src = pageImage(p);
  // preload neighbours so flipping feels instant
  [p + 1, p + 2, p - 1].filter((x) => x >= 1 && x <= TOTAL_PAGES).forEach((x) => { new Image().src = pageImage(x); });

  $('#pageBadge').textContent = p;
  $('#pageFrame').classList.toggle('is-done', state.done.has(p));
  const pagesLabel = sec.from === sec.to ? `עמוד ${sec.from}` : `עמודים ${sec.from}–${sec.to}`;
  $('#secEyebrow').textContent = `שלב ${SECTIONS.indexOf(sec) + 1} מתוך ${SECTIONS.length} · ${pagesLabel}`;
  $('#secTitle').textContent = `${sec.icon} ${sec.title}`;
  $('#noteText').textContent = noteOf(p);
  $('#noteIco').textContent = PAGE_NOTES[p] ? '💡' : sec.icon;
  const note = $('#noteCard');
  note.classList.remove('flash'); void note.offsetWidth; note.classList.add('flash');
  $('#btnPrev').disabled = p === 1;
  $('#btnNext').querySelector('span').textContent = p === TOTAL_PAGES ? 'סיימתי את הרובוט! 🎉' : p === 1 ? 'בוא נתחיל!' : 'סיימתי! הבא';
  renderDash();
}

function markDone(p) {
  if (state.done.has(p)) return;
  state.done.add(p);
  const secs = (performance.now() - state.pageStart) / 1000;
  if (secs > 5 && secs < 900) state.durations.push(secs); // ignore accidental taps & breaks
  log('app', `page ${p} done (${secs.toFixed(0)}s) · progress ${pct()}%`);
  const sec = sectionOf(p);
  const secDone = range(sec.from, sec.to).every((x) => state.done.has(x));
  if (secDone) { confetti(sec.id === 'sensor' ? 400 : 160); log('app', `section "${sec.title}" complete 🎉`); }
  persist();
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------------------------------------------------------------- dashboard
const segbar = $('#segbar');
SECTIONS.forEach((s) => {
  const el = document.createElement('div');
  el.className = 'seg';
  el.style.setProperty('--w', s.to - s.from + 1);
  el.title = `${s.icon} ${s.title}`;
  el.innerHTML = '<i></i>';
  el.onclick = () => app.goTo(s.from);
  segbar.append(el);
});

function renderDash() {
  const p = pct();
  $('#pct').textContent = p;
  $('#ringFg').style.strokeDashoffset = 326.7 * (1 - p / 100);
  $('#statPage').textContent = state.page;
  $('#statSection').textContent = sectionOf(state.page).title;
  const left = TOTAL_PAGES - state.done.size;
  $('#statLeft').textContent = left;
  const avg = state.durations.length >= 3 ? state.durations.reduce((a, b) => a + b, 0) / state.durations.length : DEFAULT_SEC_PER_PAGE;
  const mins = Math.round((left * avg) / 60);
  $('#statEta').textContent = left === 0 ? 'סיימת! 🏆' : mins >= 60 ? `~${Math.floor(mins / 60)} ש׳ ${mins % 60} ד׳` : `~${mins} דקות`;
  [...segbar.children].forEach((el, i) => {
    const s = SECTIONS[i];
    const d = range(s.from, s.to).filter((x) => state.done.has(x)).length;
    el.style.setProperty('--fill', `${(d / (s.to - s.from + 1)) * 100}%`);
    el.classList.toggle('current', s === sectionOf(state.page));
  });
}

// ---------------------------------------------------------------- section map
const mapSheet = $('#mapSheet');
function openMap() {
  const grid = $('#mapGrid');
  grid.innerHTML = '';
  SECTIONS.forEach((s) => {
    const d = range(s.from, s.to).filter((x) => state.done.has(x)).length;
    const b = document.createElement('button');
    b.className = `map-card${s === sectionOf(state.page) ? ' current' : ''}`;
    b.innerHTML = `<img loading="lazy" src="${pageImage(Math.min(s.to, s.from + Math.floor((s.to - s.from) / 2)))}" alt="">
      <div class="mc-body"><div class="mc-title">${s.icon} ${s.title}</div>
      <div class="mc-sub">עמודים ${s.from}–${s.to} · ${d}/${s.to - s.from + 1}</div>
      <div class="mc-bar"><i style="width:${(d / (s.to - s.from + 1)) * 100}%"></i></div></div>`;
    b.onclick = () => { mapSheet.close(); app.goTo(s.from); };
    grid.append(b);
  });
  mapSheet.showModal();
}
$('#btnMap').onclick = openMap;
document.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => b.closest('dialog').close()));

function toastSection(sec) {
  addMsg('bot', `${sec.icon} שלב חדש: ${sec.title}!\n${sec.desc}`);
}

// ---------------------------------------------------------------- zoom
viewport.addEventListener('click', (e) => {
  const r = viewport.getBoundingClientRect();
  img.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  viewport.classList.toggle('zoomed');
});

// ---------------------------------------------------------------- chat
const msgs = $('#msgs');
function addMsg(who, text, meta) {
  const el = document.createElement('div');
  el.className = `msg ${who}`;
  el.textContent = text;
  if (meta) { const m = document.createElement('span'); m.className = 'meta'; m.textContent = meta; el.append(m); }
  msgs.append(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

const tools = createTools(app);
const ai = new AI(tools);

async function handleInput(text, { fromVoice = false } = {}) {
  text = text.trim();
  if (!text) return;
  addMsg('me', text);
  const r = route(text);
  log('router', `"${text}" → ${r.intent}${Object.keys(r.args).length ? ' ' + JSON.stringify(r.args) : ''} (no LLM)`);

  const reply = (t) => { addMsg('bot', t); if (fromVoice || !voice.muted) voice.speak(t); };
  switch (r.intent) {
    case 'next':
    case 'done':
      app.next();
      return reply(state.page === TOTAL_PAGES && state.done.has(TOTAL_PAGES) ? 'סיימת את כל הרובוט! אלוף! 🏆' : `יופי! עברנו לעמוד ${state.page}. ${noteOf(state.page)}`);
    case 'prev':
      app.prev();
      return reply(`חזרנו לעמוד ${state.page}.`);
    case 'goto':
      app.goTo(r.args.page);
      return reply(`הנה עמוד ${state.page}! ${noteOf(state.page)}`);
    case 'section': {
      const s = SECTIONS.find((x) => x.id === r.args.section);
      app.goTo(s.from);
      return reply(`קפצנו ל${s.title} – עמוד ${s.from}.`);
    }
    case 'photo':
      openCamera();
      return reply('פותח מצלמה! תראה לי את הבנייה 📸');
    case 'progress':
      return reply(`בנית כבר ${pct()}% מהרובוט! נשארו ${TOTAL_PAGES - state.done.size} עמודים. 💪`);
    case 'zoom':
      viewport.classList.add('zoomed');
      return reply('הגדלתי! לחץ על התמונה כדי להקטין.');
    case 'stop':
      speechSynthesis?.cancel();
      return;
    default:
      return answerQuestion(text);
  }
}

async function answerQuestion(q) {
  const thinking = document.createElement('div');
  thinking.className = 'msg bot thinking';
  thinking.innerHTML = '<i></i><i></i><i></i>';
  msgs.append(thinking);
  msgs.scrollTop = msgs.scrollHeight;
  let bubble;
  try {
    const ctx = { ...app.status() };
    const res = await ai.ask(q, ctx, (partial) => {
      if (!bubble) { thinking.remove(); bubble = addMsg('bot', ''); bubble.classList.add('typing'); }
      bubble.textContent = partial;
      msgs.scrollTop = msgs.scrollHeight;
    });
    thinking.remove();
    if (!bubble) bubble = addMsg('bot', res.text);
    bubble.classList.remove('typing');
    const label = { llm: '✨ AI על המכשיר', rag: '📚 מהמדריך', cache: '⚡ זיכרון' }[res.source];
    const m = document.createElement('span');
    m.className = 'meta';
    m.textContent = label + (res.refs?.length ? ` · ${res.refs.slice(0, 2).join(', ')}` : '');
    bubble.textContent = res.text;
    bubble.append(m);
    voice.speak(res.text);
  } catch (err) {
    thinking.remove();
    log('error', err.message);
    addMsg('bot', 'אופס, משהו השתבש. נסה לשאול שוב 🙏');
  }
}

$('#composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  handleInput(input.value);
  input.value = '';
});
$('#chips').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') handleInput(e.target.textContent); });

// ---------------------------------------------------------------- voice
const transcript = $('#transcript');
const voice = new Voice({
  onInterim: (t) => { transcript.innerHTML = `<b>${escapeHtml(t)}</b>…`; },
  onFinal: (t) => {
    // ignore what we hear while Rex is talking (echo of our own TTS)
    if (self.speechSynthesis?.speaking) return log('voice', 'ignored (TTS speaking)');
    transcript.textContent = `"${t}"`;
    setTimeout(() => { transcript.textContent = ''; }, 3000);
    handleInput(t, { fromVoice: true });
  },
  onState: (on) => {
    $('#btnMic').classList.toggle('on', on);
    setPill('#pillMic', on ? 'on' : voice?.supported === false ? 'off' : '');
    transcript.textContent = on ? 'אני מקשיב… תגיד "הבא", "חזור", "עמוד 20" או שאל שאלה' : '';
  },
});
$('#btnMic').onclick = () => {
  if (!voice.supported) return addMsg('bot', 'הדפדפן הזה לא תומך בזיהוי דיבור. נסה ב-Chrome 🙂');
  voice.toggle();
};
$('#btnMute').onclick = (e) => {
  voice.muted = !voice.muted;
  e.currentTarget.textContent = voice.muted ? '🔇' : '🔊';
  if (voice.muted) speechSynthesis?.cancel();
  log('voice', voice.muted ? 'TTS muted' : 'TTS on');
};
$('#btnSpeakNote').onclick = () => { const m = voice.muted; voice.muted = false; voice.speak($('#noteText').textContent); voice.muted = m; };

// ---------------------------------------------------------------- camera + vision compare
const camSheet = $('#camSheet');
const video = $('#camVideo');
const shot = $('#camShot');
let stream;

async function openCamera() {
  $('#camRef').src = pageImage(state.page);
  resetCamera();
  camSheet.showModal();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    video.parentElement.classList.add('live');
    log('vision', `camera on ${video.videoWidth}x${video.videoHeight}`);
  } catch (err) {
    log('vision', `camera unavailable (${err.name}) → use file picker`);
  }
}
function resetCamera() {
  shot.hidden = true; video.hidden = false;
  $('#camResult').hidden = true;
  $('#camRetake').hidden = true;
  $('#camShoot').hidden = false;
}
camSheet.addEventListener('close', () => {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.parentElement.classList.remove('live');
});
$('#camRetake').onclick = resetCamera;

$('#camShoot').onclick = async () => {
  if (!stream) return $('#camFile').click();
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
  analyze(blob);
};
$('#camFile').onchange = (e) => { const f = e.target.files[0]; if (f) analyze(f); e.target.value = ''; };

async function analyze(photo) {
  shot.src = URL.createObjectURL(photo);
  shot.hidden = false; video.hidden = true;
  shot.parentElement.classList.add('live');
  $('#camShoot').hidden = true;
  $('#camRetake').hidden = false;
  $('#scanline').hidden = false;
  const box = $('#camResult');
  box.hidden = true;
  log('vision', `photo ${(photo.size / 1024).toFixed(0)}KB, comparing with page ${state.page}`);
  try {
    const ref = await (await fetch(pageImage(state.page))).blob();
    const r = await ai.compare(await downscale(photo, 1024), ref, app.status());
    box.hidden = false;
    if (!r) {
      box.className = 'cam-result';
      const why = ai.supported && ai.state !== 'unavailable' ? 'לחץ על "✨ הפעל AI" בצ׳אט כדי שאוכל לבדוק בעצמי.' : 'ה-AI לא זמין בדפדפן הזה.';
      box.innerHTML = `<h3>👀 בוא נשווה ביחד</h3>${why} בינתיים אפשר להשוות לבד: בדוק שהצבעים, הכיוון ומספר החורים בקורות זהים לתמונה בצד. אם משהו שונה – תשאל אותי בצ׳אט!`;
      return;
    }
    box.className = `cam-result ${r.match ? 'good' : 'bad'}`;
    box.innerHTML = `<span class="score">${r.score}%</span><h3>${r.match ? '🎉 נראה מעולה!' : '🔧 כמעט! בוא נתקן'}</h3>
      <div>${escapeHtml(r.summary)}</div>
      ${r.issues?.length ? `<ul>${r.issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}
      <div>💡 ${escapeHtml(r.tip)}</div>`;
    voice.speak(`${r.summary} ${r.tip}`);
    addMsg('bot', `📸 בדקתי את הבנייה בעמוד ${state.page}: ${r.summary}`);
    if (r.match && r.score >= 80) confetti(120);
  } catch (err) {
    log('error', `vision: ${err.message}`);
    box.hidden = false;
    box.className = 'cam-result bad';
    box.textContent = 'לא הצלחתי לבדוק את התמונה. נסה לצלם שוב באור טוב 🙏';
  } finally {
    $('#scanline').hidden = true;
  }
}

async function downscale(blob, max) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}
$('#btnCamera').onclick = openCamera;

// ---------------------------------------------------------------- dev log UI
const logBody = $('#logBody');
const TAGS = ['router', 'rag', 'llm', 'tool', 'webmcp', 'voice', 'vision', 'cache', 'nav', 'app', 'error'];
const hidden = new Set();
const filters = $('#logFilters');
TAGS.forEach((t) => {
  const b = document.createElement('button');
  b.className = `on tag-${t}`;
  b.textContent = t;
  b.onclick = (e) => {
    e.stopPropagation();
    hidden.has(t) ? hidden.delete(t) : hidden.add(t);
    b.classList.toggle('on');
    logBody.querySelectorAll(`.line[data-tag="${t}"]`).forEach((l) => (l.hidden = hidden.has(t)));
  };
  filters.append(b);
});
let count = 0;
onLog((e) => {
  const line = document.createElement('div');
  line.className = 'line';
  line.dataset.tag = e.tag;
  line.hidden = hidden.has(e.tag);
  line.innerHTML = `<span class="t">${e.at.toFixed(2)}s</span><span class="g tag-${e.tag}">${e.tag}</span><span class="m"></span><span class="d">${e.ms != null ? `${e.ms.toFixed(0)}ms` : ''}</span>`;
  line.querySelector('.m').textContent = e.msg;
  const stick = logBody.scrollTop + logBody.clientHeight >= logBody.scrollHeight - 30;
  logBody.append(line);
  if (logBody.children.length > 400) logBody.firstChild.remove();
  if (stick) logBody.scrollTop = logBody.scrollHeight;
  const c = $('#logCount');
  c.textContent = ++count;
  c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump');
});
const toggleLog = () => {
  document.body.classList.toggle('log-open');
  $('#btnLogToggle').textContent = document.body.classList.contains('log-open') ? '▾' : '▴';
};
$('#devlogBar').onclick = toggleLog;

// ---------------------------------------------------------------- keyboard (RTL: ← is next)
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowLeft' || e.key === 'PageDown') app.next();
  else if (e.key === 'ArrowRight' || e.key === 'PageUp') app.prev();
  else if (e.key === ' ') { e.preventDefault(); $('#btnMic').click(); }
  else if (e.key === '`' && (e.ctrlKey || e.metaKey)) toggleLog();
});
$('#btnNext').onclick = () => {
  app.next();
  if (state.page === TOTAL_PAGES && state.done.has(TOTAL_PAGES)) addMsg('bot', 'סיימת את כל הרובוט! אתה אלוף! 🏆🤖');
};
$('#btnPrev').onclick = () => app.prev();

// ---------------------------------------------------------------- confetti
const cv = $('#confetti');
const cx = cv.getContext('2d');
let parts = [];
function confetti(n = 150) {
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  const colors = ['#ff8a00', '#ff3d71', '#0a84ff', '#30d158', '#ffd60a', '#ffffff'];
  for (let i = 0; i < n; i++) {
    parts.push({ x: cv.width / 2, y: cv.height * 0.35, vx: (Math.random() - 0.5) * 26, vy: -Math.random() * 26 - 6, r: Math.random() * 6 + 4, c: colors[i % colors.length], a: Math.random() * 6, life: 1 });
  }
  if (parts.length === n) requestAnimationFrame(tick);
}
function tick() {
  cx.clearRect(0, 0, cv.width, cv.height);
  parts.forEach((p) => {
    p.vy += 0.6; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.a += 0.15; p.life -= 0.008;
    cx.save(); cx.globalAlpha = Math.max(p.life, 0); cx.translate(p.x, p.y); cx.rotate(p.a);
    cx.fillStyle = p.c; cx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); cx.restore();
  });
  parts = parts.filter((p) => p.life > 0 && p.y < cv.height + 40);
  if (parts.length) requestAnimationFrame(tick); else cx.clearRect(0, 0, cv.width, cv.height);
}

// ---------------------------------------------------------------- boot
function setPill(sel, cls) {
  const el = $(sel);
  el.classList.remove('on', 'off', 'busy');
  if (cls) el.classList.add(cls);
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

const btnAi = $('#btnEnableAi');
btnAi.onclick = async () => {
  btnAi.disabled = true;
  btnAi.textContent = '⏳ טוען…';
  try {
    await ai.enable();
    addMsg('bot', 'ה-AI מוכן! ✨ עכשיו אני יכול לענות על כל שאלה ולבדוק תמונות.');
  } catch (err) {
    log('error', `enable AI: ${err.message}`);
    btnAi.disabled = false;
    btnAi.textContent = '✨ הפעל AI';
  }
};

ai.onState = (s) => {
  setPill('#pillAi', { available: 'on', downloadable: '', downloading: 'busy', unavailable: 'off' }[s] ?? '');
  btnAi.hidden = !(s === 'downloadable' || s === 'downloading');
  if (s === 'downloading') { btnAi.disabled = true; btnAi.textContent = '⏳ מוריד…'; }
  $('#chatSub').textContent = {
    available: 'AI על המכשיר מוכן ✨',
    downloadable: 'לחץ ✨ כדי להוריד AI למכשיר',
    downloading: 'מוריד את מודל ה-AI…',
    unavailable: 'מצב מדריך (בלי AI) 📚',
  }[s] || 'שאל אותי כל דבר על הבנייה';
};

log('app', `Alpha Rex guide boot · ${TOTAL_PAGES} pages · ${SECTIONS.length} sections`);
log('rag', `BM25 index ready · ${DOC_COUNT} docs`);
setPill('#pillMic', voice.supported ? '' : 'off');
setPill('#pillMcp', registerWebMCP(tools) ? 'on' : 'off');
ai.probe();
renderPage();
addMsg('bot', state.done.size
  ? `ברוך שובך! 👋 כבר בנית ${pct()}%. ממשיכים מעמוד ${state.page}.`
  : 'שלום! אני רקס 🤖 ביחד נבנה את Alpha Rex.\nלחץ על המיקרופון ותגיד "הבא" כדי להתקדם, או שאל אותי כל שאלה!');
