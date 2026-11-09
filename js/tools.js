// One tool registry, exposed twice: to the on-device model (Prompt API `tools`)
// and to external agents via WebMCP (navigator.modelContext).
import { SECTIONS, TOTAL_PAGES } from './data.js';
import { search } from './rag.js';
import { log } from './log.js';

export function createTools(app) {
  const wrap = (name, fn) => async (args = {}) => {
    log('tool', `${name}(${JSON.stringify(args)})`);
    const res = await fn(args);
    const out = typeof res === 'string' ? res : JSON.stringify(res);
    log('tool', `${name} → ${out.slice(0, 140)}`);
    return out;
  };

  return [
    {
      name: 'next_page',
      description: 'Go to the next instruction page and mark the current one as done. Use when the child says he finished or wants to continue.',
      inputSchema: { type: 'object', properties: {} },
      execute: wrap('next_page', () => { app.next(); return app.status(); }),
    },
    {
      name: 'previous_page',
      description: 'Go back one instruction page.',
      inputSchema: { type: 'object', properties: {} },
      execute: wrap('previous_page', () => { app.prev(); return app.status(); }),
    },
    {
      name: 'go_to_page',
      description: `Jump to a specific instruction page number (1-${TOTAL_PAGES}).`,
      inputSchema: { type: 'object', properties: { page: { type: 'integer', minimum: 1, maximum: TOTAL_PAGES } }, required: ['page'] },
      execute: wrap('go_to_page', ({ page }) => { app.goTo(+page); return app.status(); }),
    },
    {
      name: 'go_to_section',
      description: 'Jump to the first page of a build section.',
      inputSchema: { type: 'object', properties: { section: { type: 'string', enum: SECTIONS.map((s) => s.id) } }, required: ['section'] },
      execute: wrap('go_to_section', ({ section }) => {
        const s = SECTIONS.find((x) => x.id === section);
        if (s) app.goTo(s.from);
        return app.status();
      }),
    },
    {
      name: 'get_build_status',
      description: 'Get the current page, section, page notes and overall build progress percentage.',
      inputSchema: { type: 'object', properties: {} },
      execute: wrap('get_build_status', () => app.status()),
    },
    {
      name: 'search_instructions',
      description: 'Search the building knowledge base (instruction symbols, LEGO parts, cables, common mistakes, sections). Returns relevant snippets.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      execute: wrap('search_instructions', ({ query }) =>
        search(query, { page: app.page }).map((r) => `${r.doc.title}: ${r.doc.text}`).join('\n') || 'אין תוצאות'),
    },
    {
      name: 'open_camera',
      description: 'Open the camera so the child can take a photo of the build for checking.',
      inputSchema: { type: 'object', properties: {} },
      execute: wrap('open_camera', () => { app.openCamera(); return 'camera opened'; }),
    },
  ];
}

// WebMCP: let browser agents drive the build guide with the same tools.
export function registerWebMCP(tools) {
  const mc = navigator.modelContext;
  if (!mc) {
    log('webmcp', 'navigator.modelContext not available – skipping (enable chrome://flags/#enable-webmcp-testing)');
    return false;
  }
  const defs = tools.map(({ name, description, inputSchema, execute }) => ({
    name, description, inputSchema,
    async execute(args) {
      log('webmcp', `external agent called ${name}`);
      return { content: [{ type: 'text', text: await execute(args) }] };
    },
  }));
  try {
    if (mc.provideContext) mc.provideContext({ tools: defs });
    else defs.forEach((d) => mc.registerTool(d));
    log('webmcp', `registered ${defs.length} tools: ${defs.map((d) => d.name).join(', ')}`);
    return true;
  } catch (err) {
    log('error', `webmcp register failed: ${err.message}`);
    return false;
  }
}
