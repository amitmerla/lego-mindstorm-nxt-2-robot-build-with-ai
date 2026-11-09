# Alpha Rex 2.0 – AI build buddy (Hebrew, RTL)

A kid-friendly, voice-driven guide for building LEGO MINDSTORMS NXT 2.0 Alpha Rex (set 8547).
Pure HTML + CSS + JS (ES modules), no build step, no server-side code.

## Run

```bash
python3 -m http.server 8547
```

Open http://localhost:8547 in Chrome (localhost counts as a secure context, so the camera and mic work).

## Features

| | |
|---|---|
| Dashboard | Progress ring, page/section stats, ETA based on the kid's own pace, a segmented bar per build section (click to jump) |
| Pages | All 191 manual pages (`assets/pages/`), RTL page-flip animation, click to zoom, ←/→ keys |
| Voice (he-IL) | Mic button or Space key. Say "הבא", "חזור", "עמוד עשרים", "תעבור לראש", "כמה נשאר", "צלם", or ask a question. Rex answers out loud |
| Chat | Questions about the instructions. Order: answer cache → BM25 RAG → on-device LLM, only when needed |
| Photo check | Camera or file upload → Prompt API multimodal compares the photo with the current page image and returns a score, issues and a tip |
| Dev log | Cursor-style "agent.log" drawer at the bottom (click the bar or Ctrl+`), filter by tag |

## AI architecture

- `js/router.js` – the "simple map": regex intent router for Hebrew commands. Navigation never touches the LLM.
- `js/rag.js` – BM25 index (Hebrew prefix-aware tokenizer) over the knowledge base, section summaries and page notes in `js/data.js`. A decisive knowledge-base hit is answered directly, without the LLM.
- `js/ai.js` – Chrome built-in **Prompt API** (`LanguageModel`), created lazily. It uses native `tools`, and falls back to a JSON tool-call loop with `responseConstraint` when native tools aren't supported. The session is recycled at 75% of the context window, and answers are cached.
- `js/tools.js` – one tool registry (`next_page`, `go_to_page`, `go_to_section`, `search_instructions`, `get_build_status`, `open_camera` …). It is shared by the Prompt API and **WebMCP** (`navigator.modelContext`), so external browser agents can drive the guide too.

### Enabling the browser AI features (Chrome)

- Prompt API: Chrome 138+ desktop, `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` (for image input). The model downloads on the first click of **✨ הפעל AI** (Chrome requires a click to start the download).
- WebMCP: `chrome://flags/#enable-webmcp-testing`.
- Without them the app still works: navigation, voice, RAG answers and side-by-side photo comparison.
