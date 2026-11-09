// On-device AI via Chrome's built-in Prompt API (LanguageModel, Gemini Nano).
// Sessions are created lazily – only when a question actually needs the model.
import { log, timed } from './log.js';
import { search } from './rag.js';

const SYSTEM = `אתה "רקס", עוזר בנייה חם וסבלני לילד קטן שבונה את הרובוט LEGO MINDSTORMS NXT 2.0 – Alpha Rex.
כללים:
- ענה תמיד בעברית פשוטה, במשפטים קצרים (עד 3 משפטים), כמו לילד בן 7.
- התבסס על ה"הקשר" שמצורף לשאלה. אל תמציא חלקים שלא מופיעים בו.
- אם הילד רוצה לעבור עמוד, לחזור או לקפוץ – השתמש בכלים (tools).
- עודד אותו! השתמש לפעמים באימוג'י אחד.`;

const VISION_SYSTEM = `You are a LEGO build inspector helping a young child. You get two images:
IMAGE 1 = the official instruction page (what it should look like after this step).
IMAGE 2 = a photo of the child's build.
Compare shapes, colors, part positions, orientation (mirror / upside down), missing or extra parts.
Answer ONLY in simple Hebrew a 7 year old understands.`;

const VISION_SCHEMA = {
  type: 'object',
  properties: {
    match: { type: 'boolean' },
    score: { type: 'integer', minimum: 0, maximum: 100 },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    tip: { type: 'string' },
  },
  required: ['match', 'score', 'summary', 'issues', 'tip'],
};

const TOOL_CALL_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['answer', 'tool'] },
    tool: { type: 'string' },
    args: { type: 'object' },
    text: { type: 'string' },
  },
  required: ['action'],
};

export class AI {
  constructor(tools) {
    this.tools = tools;
    this.state = 'unknown'; // unavailable | downloadable | downloading | available
    this.chat = null;
    this.nativeTools = false;
    this.answerCache = new Map();
    this.onState = () => {};
  }

  get supported() { return 'LanguageModel' in self; }

  async probe() {
    if (!this.supported) {
      this.setState('unavailable');
      log('llm', 'Prompt API (LanguageModel) not in this browser → RAG-only mode');
      return this.state;
    }
    const a = await LanguageModel.availability({ expectedInputs: [{ type: 'text' }, { type: 'image' }] }).catch(() => 'unavailable');
    log('llm', `LanguageModel.availability() = ${a}`);
    this.setState(a);
    return a;
  }

  setState(s) { this.state = s; this.onState(s); }

  monitor = (m) => {
    m.addEventListener('downloadprogress', (e) => {
      this.setState('downloading');
      log('llm', `model download ${(e.loaded * 100).toFixed(0)}%`);
    });
  };

  // Try the richest config first, then degrade (Hebrew output may not be supported yet).
  async createSession(base) {
    const variants = [
      { ...base, expectedOutputs: [{ type: 'text', languages: ['he'] }] },
      { ...base, expectedOutputs: [{ type: 'text', languages: ['en'] }] },
      base,
    ];
    let lastErr;
    for (const v of variants) {
      try { return await LanguageModel.create({ ...v, monitor: this.monitor }); }
      catch (e) {
        lastErr = e;
        log('llm', `create() variant rejected: ${e.name}`);
        if (e.name === 'NotAllowedError') break; // needs a click to download – no point retrying
      }
    }
    throw lastErr;
  }

  /** Called from a click: downloads the model if needed (requires user activation). */
  async enable() {
    if (!this.supported || this.state === 'unavailable') return false;
    await this.ensureChat();
    return true;
  }

  get ready() { return this.state === 'available'; }

  ensureChat() {
    // memoize so parallel questions share one session creation
    this.chatPromise ??= this.buildChat().finally(() => { this.chatPromise = null; });
    return this.chatPromise;
  }

  async buildChat() {
    if (this.chat) {
      // keep context small – recycle when the window fills up
      const used = this.chat.inputUsage ?? this.chat.contextUsage ?? 0;
      const quota = this.chat.inputQuota ?? this.chat.contextWindow ?? Infinity;
      if (used / quota < 0.75) return this.chat;
      log('llm', `context ${used}/${quota} → recycling session`);
      this.chat.destroy();
      this.chat = null;
    }
    const nativeTools = this.tools.map(({ name, description, inputSchema, execute }) => ({ name, description, inputSchema, execute }));
    const base = { initialPrompts: [{ role: 'system', content: SYSTEM }], expectedInputs: [{ type: 'text' }] };
    this.chat = await timed('llm', 'LanguageModel.create(chat + tools)', async () => {
      try {
        const s = await this.createSession({ ...base, tools: nativeTools });
        this.nativeTools = true;
        return s;
      } catch (e) {
        if (e.name === 'NotAllowedError') throw e;
        log('llm', 'native tool-use not supported → JSON tool protocol fallback');
        this.nativeTools = false;
        const toolList = this.tools.map((t) => `- ${t.name}: ${t.description} args=${JSON.stringify(t.inputSchema.properties)}`).join('\n');
        return this.createSession({
          ...base,
          initialPrompts: [{ role: 'system', content: `${SYSTEM}\n\nכלים זמינים:\n${toolList}\nהחזר JSON: {"action":"tool","tool":..,"args":{..}} או {"action":"answer","text":".."}` }],
        });
      }
    });
    this.setState('available');
    return this.chat;
  }

  /**
   * Answer a free-text question. Path: answer-cache → RAG → (only if needed) LLM.
   * onToken streams partial text for the typing effect.
   */
  async ask(question, ctx, onToken) {
    const cacheKey = `${ctx.page}|${question}`;
    if (this.answerCache.has(cacheKey)) {
      log('cache', 'answer cache hit – skipping LLM');
      return { text: this.answerCache.get(cacheKey), source: 'cache' };
    }

    const hits = search(question, { page: ctx.page, k: 3 });
    const top = hits[0];
    const rag = hits.map((h) => `• ${h.doc.title}: ${h.doc.text}`).join('\n');

    // Confident, single-topic knowledge-base hit → answer directly, no model needed.
    const decisive = top && top.doc.kind === 'kb' && top.score > 4 && (!hits[1] || top.score > hits[1].score * 1.6);
    if (decisive || !this.ready) {
      log('router', decisive ? `RAG decisive (${top.score.toFixed(2)}) → no LLM` : `LLM ${this.state} → RAG answer`);
      const text = top ? top.doc.text : `בעמוד הזה: ${ctx.note} נסה לשאול אחרת, או לחץ על 📷 כדי שאבדוק את הבנייה.`;
      this.answerCache.set(cacheKey, text);
      return { text, source: 'rag', refs: hits.map((h) => h.doc.title) };
    }

    const session = await this.ensureChat();
    const prompt = `הקשר:\nעמוד ${ctx.page} מתוך ${ctx.total}, שלב "${ctx.section}". הסבר העמוד: ${ctx.note}\n${rag}\n\nשאלת הילד: ${question}`;
    log('llm', `prompt (${prompt.length} chars, ${hits.length} RAG chunks)`);
    const start = performance.now();

    let text = '';
    if (this.nativeTools) {
      const stream = session.promptStreaming(prompt);
      for await (const chunk of stream) {
        // Older Chrome builds stream cumulative text, newer ones stream deltas.
        text = chunk.startsWith(text) ? chunk : text + chunk;
        onToken?.(text);
      }
    } else {
      text = await this.jsonToolLoop(session, prompt, onToken);
    }
    log('llm', `answer ${text.length} chars`, performance.now() - start);
    this.answerCache.set(cacheKey, text);
    return { text, source: 'llm', refs: hits.map((h) => h.doc.title) };
  }

  async jsonToolLoop(session, prompt, onToken) {
    let input = prompt;
    for (let i = 0; i < 3; i++) {
      const raw = await session.prompt(input, { responseConstraint: TOOL_CALL_SCHEMA });
      let msg;
      try { msg = JSON.parse(raw); } catch { return raw; }
      if (msg.action !== 'tool') { onToken?.(msg.text || ''); return msg.text || ''; }
      const tool = this.tools.find((t) => t.name === msg.tool);
      const result = tool ? await tool.execute(msg.args || {}) : `unknown tool ${msg.tool}`;
      input = `תוצאת הכלי ${msg.tool}: ${result}\nעכשיו ענה לילד.`;
    }
    return 'עשיתי את זה! 👍';
  }

  /** Compare the child's photo with the reference page image. */
  async compare(photoBlob, refBlob, ctx) {
    if (!this.ready) {
      log('vision', `Prompt API ${this.state} – manual side-by-side only`);
      return null;
    }
    const session = await timed('vision', 'LanguageModel.create(image)', () =>
      this.createSession({ initialPrompts: [{ role: 'system', content: VISION_SYSTEM }], expectedInputs: [{ type: 'text' }, { type: 'image' }] }));
    try {
      const raw = await timed('vision', 'compare images', () => session.prompt([{
        role: 'user',
        content: [
          { type: 'text', value: `Step: page ${ctx.page}, section "${ctx.section}". Notes: ${ctx.note}\nIMAGE 1 (reference):` },
          { type: 'image', value: refBlob },
          { type: 'text', value: 'IMAGE 2 (child\'s build):' },
          { type: 'image', value: photoBlob },
          { type: 'text', value: 'Compare and reply in Hebrew JSON.' },
        ],
      }], { responseConstraint: VISION_SCHEMA }));
      log('vision', `result ${raw.slice(0, 160)}`);
      return JSON.parse(raw);
    } finally {
      session.destroy();
    }
  }
}
