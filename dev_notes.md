# Developer notes

Everything about how this app is built, and why. Every decision made so far, big or small, is logged here with its reason. Update this file whenever a decision changes.

- **Project:** a live event demo that sends one prompt to an uncensored local model and to a commercial model, and shows the answers side by side on a projector.
- **Owner:** Garv. Krish hosts the uncensored model.
- **Built:** 2026-09-29.

---

## 1. Context and constraints

| Constraint | Consequence |
|---|---|
| Shown live to a crowd on an **old 4:3 projector**, read from across a room | Big fluid type, high contrast, no clutter, and no pale tints (projectors wash them out). |
| Runs for **a few hours off one laptop** (Garv's MacBook: M4, 16 GB, Node 24, Python 3.14, uv) | Reliability over polish. One process, one command, no build steps at runtime. |
| Crowd watches answers "type" | Streaming end to end, with each side independent so a slow model never holds up the fast one. |
| Something inappropriate might start appearing | An instant kill switch (Esc) that also stops generation upstream. |
| The uncensored model runs on **Krish's Windows laptop**, not Garv's Mac | Ollama is reached over the network, and its address must be easy to change mid-event. |
| Gemini key must stay secret | The backend is a proxy. Keys never reach the browser. |

---

## 2. Architecture

```
Browser (React, localhost:8000)
   │  POST /api/uncensored {prompt, turn}      POST /api/guarded {prompt, turn}
   │  ◄── NDJSON stream                         ◄── NDJSON stream
   ▼
FastAPI (backend/main.py, uvicorn :8000) — also serves frontend/dist as static files
   │                                            │
   │ POST {OLLAMA_URL}/api/chat (NDJSON)        │ POST generativelanguage.googleapis.com/v1beta/
   ▼                                            ▼      models/{model}:streamGenerateContent?alt=sse
Krish's Ollama (Windows, :11434, hotspot)     Gemini (fallback chain on 503/429/timeout)

Every finished, blocked, errored or cut answer ──► transcript.py ──► log.md
```

### File map
| Path | What it is |
|---|---|
| `start.sh` | Demo-day launcher. Checks for `.env`, installs frontend packages if missing, builds the frontend, then runs uvicorn on 127.0.0.1:8000. |
| `connect-krish.sh` | Sets `OLLAMA_URL` in `.env` from an IP or URL, then tests reachability and that the model exists. |
| `backend/main.py` | All proxy logic: both streaming endpoints, the think filter, the Gemini fallback chain, health, and static serving. |
| `backend/transcript.py` | The question log (`log.md`): pairs the two answers by turn id. |
| `backend/pyproject.toml` | uv project: fastapi, uvicorn[standard], httpx, python-dotenv. `package = false` because this is an app, not a library. |
| `frontend/src/App.tsx` | State, submit, abort, kill switch, clear, health polling. |
| `frontend/src/Panel.tsx` | One chat panel: messages, markdown, typing dots, blocked card, autoscroll. |
| `frontend/src/stream.ts` | `fetch` + NDJSON reader + AbortController + hard timeout. |
| `frontend/src/styles.css` | All styling. Colour tokens are on `:root`. |
| `dev/fake_models.py` | A fake Ollama and fake Gemini for offline testing. |
| `dev/test.env` | Env file that points the backend at the fakes. |
| `.env` (gitignored) | The real settings, including the Gemini key. |
| `log.md` (gitignored) | The question log, created on the first question. |

### Wire protocol (backend → browser)
Both endpoints return `application/x-ndjson`, one JSON object per line:
```
{"t":"delta","text":"..."}                          a chunk of answer text
{"t":"model","name":"gemini-3.6-flash"}             Gemini fell back to another model (non-terminal)
{"t":"blocked","reason":"SAFETY","categories":[...]} Gemini safety block (terminal)
{"t":"error","message":"..."}                       friendly error text (terminal)
{"t":"done"}                                        finished normally (terminal)
```
**Rule:** an endpoint never raises mid-stream. Every exception becomes an `error` line, so the browser always gets a clean end. If the stream is cut with no terminal line (kill switch or disconnect), the browser marks the answer `cut` itself.

---

## 3. Decision log

Each entry gives the decision, the reason, and where it lives. "(asked)" means Garv chose it when asked a question. Everything else was an engineering call.

### 3.1 Product and UX decisions (from Garv)
| # | Decision | Why |
|---|---|---|
| P1 | Local model is **Krish's Ollama** over the network (asked). Initially a phone hotspot or the same Wi-Fi. | Ollama isn't installed on Garv's Mac, and Krish already runs it. |
| P2 | Gemini **Flash**, specifically `gemini-3.8-flash` (asked). | Fast first token for the "typing" effect. |
| P3 | **Google default safety settings**, with no `safetySettings` override (asked). | An honest out-of-the-box comparison. |
| P4 | A safety block shows as a **big "RESPONSE BLOCKED" card** with category chips (asked). | It's a punchline moment for the crowd. |
| P5 | **Fresh context per prompt.** No multi-turn memory is sent to either model (asked). | Clean per-question comparison, and one bad answer can't poison the next. Panels still show the session history visually. |
| P6 | Kill switch = **abort both streams and show a neutral STANDBY screen**. Esc again returns, with history kept (asked). | Instant cover, plus a way back. Use CLEAR if the content should never come back. |
| P7 | **Vite + React, one command, served by FastAPI** (asked). | One process and one URL is the least that can break on the day. |
| P8 | System prompts: left says "answer directly, no refusals". Right says "answer directly, like a normal guarded commercial assistant" (asked). Both can be overridden in `.env`. | Makes the contrast visible while staying fair. |
| P9 | Copy: header **"UNCENSORED AI vs COMMERCIAL AI"**, panel labels **UNCENSORED / COMMERCIAL**, plus a model tag (asked). | Garv's wording. |
| P10 | **Status dot per side, health-polled**, with an in-panel "LOCAL MODEL OFFLINE" error (asked). | Garv sees trouble before the crowd does. |
| P11 | **Render markdown** in both panels (asked). | Raw `**` and `#` look bad on a projector. |
| P12 | Designed for a **4:3 projector** (asked). | The actual venue hardware. |
| P13 | Gemini key setup steps go in the README (asked; Garv had no key at first). | — |
| P14 | **UI restyle to feel premium** (asked). The first version felt tacky. | See 3.8. |
| P15 | **Log every question and both answers to `log.md`** (asked). | A record of what was shown. |

### 3.2 Architecture
| # | Decision | Why | Where |
|---|---|---|---|
| A1 | The backend is a thin proxy. Both model calls happen server-side. | Keys never reach the browser, and one place handles errors. | `main.py` |
| A2 | **NDJSON over POST** instead of SSE/EventSource. | EventSource can't POST a body. NDJSON over `fetch` is simple to parse and cancel. | `stream.ts`, `ndjson()` |
| A3 | Two **separate endpoints**, called in parallel by the browser, instead of one fan-out endpoint. | Each side is fully independent (its own errors, abort and timing), matching the "never block one panel on the other" requirement. | `App.tsx send()` |
| A4 | FastAPI serves `frontend/dist` via `StaticFiles(html=True)`, mounted only if the folder exists. | A single port. The backend still starts (API only) if the frontend hasn't been built. | bottom of `main.py` |
| A5 | uvicorn binds **127.0.0.1**, not 0.0.0.0. | Nobody on the hotspot can reach Garv's proxy or spend his Gemini quota. | `start.sh` |
| A6 | Uses the **raw REST APIs** via `httpx`, not the google-genai or ollama SDKs. | Fewer dependencies, and direct access to `promptFeedback`, `finishReason` and `safetyRatings` for the blocked card. | `main.py` |
| A7 | One shared `httpx.AsyncClient`, created in `lifespan`. | Connection reuse, closed cleanly on shutdown. | `lifespan()` |
| A8 | Default timeouts: connect 5 s, **read 45 s between chunks**, write 10 s, pool 5 s. Read was lowered from 60 s. | A dead Wi-Fi link shows up in under a minute. 45 s still allows a slow first token. | `lifespan()` |
| A9 | `ENV_FILE`, `LOG_FILE` and `GEMINI_BASE_URL` environment overrides. | Testing only. They let a second copy run against the fakes without touching the real `.env`, log or quota. Unused in normal runs. | top of `main.py` |
| A10 | `.env` is loaded from the repo root, not `backend/`. | One settings file for the whole project, next to `start.sh`. | `ROOT`, `ENV_FILE` |

### 3.3 Uncensored side (Ollama)
| # | Decision | Why | Where |
|---|---|---|---|
| O1 | Uses `POST /api/chat` with `[system, user]` messages and `stream: true`. | Ollama's native streaming chat API, which applies the model's own chat template. | `stream_ollama()` |
| O2 | `options.num_predict: 700`. | Caps runaway answers. Around 200 words is requested anyway. | same |
| O3 | `keep_alive: "30m"` on each request. Krish also sets `OLLAMA_KEEP_ALIVE=-1`. | Keeps the model in memory so answers don't pause to reload. | same, README |
| O4 | **`think: false`**, and on a 400 error mentioning "think", **retry once without it**. | Qwen3 is a reasoning model, and hidden thinking would make the crowd wait. Older Ollama versions or non-thinking models may reject the flag, so the retry keeps it working. | same |
| O5 | **`ThinkFilter`** strips `<think>…</think>` from the stream, even when a tag is split across chunks, and trims leading whitespace. | A fallback in case the model still emits think tags (Qwen3 can emit an empty `<think></think>` pair even with thinking off). It holds back only a possible partial tag at the end of the buffer. | `ThinkFilter` |
| O6 | **`OLLAMA_URL` and `OLLAMA_MODEL` are re-read from `.env` on every request** (`ollama_cfg()`). The `.env` value wins over the process environment. | Krish's hotspot IP is only known at the event and can change. `connect-krish.sh` edits `.env`, and the running app follows within one health poll, with no restart. | `ollama_cfg()` |
| O7 | Friendly errors: ConnectError or ConnectTimeout → "LOCAL MODEL OFFLINE — can't reach Krish's laptop". 404 or "not found" → "Model '…' not found on Krish's machine". Read timeout → "LOCAL MODEL TIMED OUT". RemoteProtocolError or ReadError → "CONNECTION TO KRISH'S LAPTOP DROPPED". Anything else → "Local model failed: <ExceptionName>". | Readable from across the room. An unreachable host usually shows up as ConnectTimeout, not ConnectError, so both map to OFFLINE. | `stream_ollama()` |
| O8 | Browser abort → `request.is_disconnected()` is checked per chunk, and the `async with` block closes the upstream connection. | Ollama stops generating when the kill switch fires, which frees Krish's GPU. Verified: the fake logged "client disconnected". | `stream_ollama()` |
| O9 | Uses Ollama's own port **11434**, not 8080. | Krish's 8080 was Open WebUI, a chat page, not the Ollama API. | README |

### 3.4 Commercial side (Gemini)
| # | Decision | Why | Where |
|---|---|---|---|
| G1 | `streamGenerateContent?alt=sse` with the key in the `x-goog-api-key` header (not the URL). | Streaming. Headers also keep the key out of any logged URLs. | `stream_one_gemini()` |
| G2 | `systemInstruction` for the system prompt, `maxOutputTokens: 1024`. | 1024 leaves room for answers of about 200 words. | `stream_gemini()` |
| G3 | Parts with `thought: true` are skipped. | Never show hidden reasoning. | same |
| G4 | **Blocked detection:** `promptFeedback.blockReason`, or `finishReason` in {SAFETY, PROHIBITED_CONTENT, BLOCKLIST, SPII, IMAGE_SAFETY}. Categories come from `safetyRatings` with `blocked: true`, with the `HARM_CATEGORY_` prefix removed. Any text already streamed stays visible, and the card appears under it. | Covers both input-side and output-side blocks. | `BLOCK_REASONS`, `blocked_categories()` |
| G5 | **Fallback chain:** `GEMINI_MODEL`, then `GEMINI_FALLBACK_MODELS`. The next model is tried on HTTP 429, 500, 503 or 504, **or on a read timeout before any text has been sent**. A `{"t":"model"}` event tells the UI, which shows "via <model>". If every model fails: "GEMINI OVERLOADED — all models busy, try again". | On 2026-09-29, `gemini-3.8-flash` kept returning 503 "high demand", and some models hung for 30 s or more. Once text has started, the app never switches model, so answers are never mixed. | `stream_gemini()` |
| G6 | The current `.env` chain is `gemini-3.8-flash → gemini-3.6-flash → gemini-3.5-flash-lite`. 3.7 was dropped. | 3.7 was also returning 503. 3.6 answered in 1–3 s. The lite model runs on separate capacity, so it's the last resort. | `.env` |
| G7 | Gemini gets its own timeout: **read 10 s**. | A silent model should give way to a fallback quickly. The normal first byte is 1–3.5 s. | `GEMINI_TIMEOUT` |
| G8 | **`thinkingLevel: "minimal"`** by default (`GEMINI_THINKING`). If a model returns a 400 mentioning "thinking", retry with `low`, then with no thinkingConfig. | Measured on 3.6: default 7.8 s to first byte, minimal 3.5 s, low 3.4 s. 3.8 rejects MINIMAL ("Thinking level MINIMAL is not supported"). `thinkingBudget: 0` hung, so it isn't used. | `stream_gemini()` levels loop |
| G9 | A connect timeout re-raises instead of counting as "overloaded". | Internet down should say "GEMINI UNREACHABLE — check internet", not cycle through every model. | `stream_one_gemini()` |
| G10 | Error mapping: 400/401/403 containing "API key" → "Gemini rejected the API key". 404 → "Gemini model '…' not found". A missing key → "No GEMINI_API_KEY in .env". | Readable, and specific enough to fix quickly. | same |
| G11 | The panel's model tag shows the *configured* model. The actual model only shows in the "via" note when a fallback was used. | Keeps the header stable. The note is honest about fallbacks. | `Panel.tsx` |

### 3.5 Health checks
| # | Decision | Why |
|---|---|---|
| H1 | `GET /api/health` runs both checks in parallel with a 2 s timeout each. | The endpoint returns fast even when a side is down. |
| H2 | Ollama check: `GET /api/tags` responds **and** the model tag (or `tag:latest`) is in the list. The detail is "ready", "model not pulled" or "offline". | Reachable-but-wrong-model is the most likely setup mistake. |
| H3 | Gemini check: key present, and `GET models/{GEMINI_MODEL}` returns 200. | A free metadata call that doesn't use generation quota. Note it only checks the *main* model exists, not that it has capacity. |
| H4 | The browser polls every **10 s** with a 5 s fetch timeout. If the backend is unreachable, both dots go red with "backend down". | Shows problems quickly, at negligible load. |

### 3.6 Question log (`log.md`)
| # | Decision | Why |
|---|---|---|
| L1 | Logging happens **in the backend**, by wrapping each endpoint's stream (`logged()`), not by having the browser post results. | The backend sees exactly what was streamed, including answers cut by the kill switch, CLEAR, a new question, a page reload or a crash. A browser-side logger would lose answers on reload and would race with CLEAR emptying state. |
| L2 | The browser sends a **`turn` id** (`<timestamp>-<n>`) with both requests. The backend holds the first side in memory and writes one entry when the second side arrives. | Keeps a question and its two answers together in the log. If `turn` is missing (an old client), each side is written on its own. |
| L3 | Each side is recorded in the wrapper's `finally`, so it runs on normal end, on error and on cancellation. The outcome is one of: `done`, `BLOCKED by safety filter: <reason> (<categories>)`, `ERROR: <message>`, or `cut off` (no terminal event, i.e. aborted). | Every question gets logged, and the log says how each answer ended. |
| L4 | Half-finished turns are written on server shutdown (`transcript.flush()` in `lifespan`). A missing side shows `_(no answer recorded)_`. | Ctrl+C mid-answer doesn't lose the question. |
| L5 | Format: `## <date time>`, `**Q:**`, then `### UNCENSORED — <model>` and `### COMMERCIAL — <model>` with the answer's markdown as-is and the outcome in italics. Entries are separated by `---`. A `# Question log` header is added when the file is created. The fallback model is shown as `<model> (fallback)`. | Kept simple, as Garv asked ("nothing too fancy"). Readable in any markdown viewer. |
| L6 | Entries are ordered by when **both** answers finished, not when the question was asked. | This comes from pairing. Fine for a record. |
| L7 | Append-only plain file writes. Any `OSError` is printed and swallowed. | Logging must never break the demo. There's a single event loop, so no lock is needed. |
| L8 | `log.md` is **gitignored**. | It may contain inappropriate model output, and it's meant to stay local. |

### 3.7 Frontend behaviour
| # | Decision | Why | Where |
|---|---|---|---|
| F1 | State: `msgs: {left: Msg[], right: Msg[]}`, where `Msg` has `status: streaming, done, error, blocked or cut`, plus optional `error`, `blocked` and `via`. | Each panel renders its own list independently. | `App.tsx`, `Panel.tsx` |
| F2 | **Submit** first aborts any in-flight streams (marking them `cut`), then adds the user message and an empty streaming AI message to **both** panels immediately, then starts two independent `streamChat` calls, each with its own AbortController. | The question appears instantly, and a new question can never be blocked by a stuck old one. | `send()` |
| F3 | **Token batching:** deltas go into a `Map<"side:id", text>` and are flushed once per `requestAnimationFrame`. A terminal event flushes immediately, and `abortAll` flushes first. | Fast streams don't cause a React and markdown re-render per token. The key includes the message id, so buffered text can never land in the wrong message after an abort and resubmit. | `flush()` |
| F4 | `streamChat` guarantees exactly **one terminal event**, ignores `delta` and `model` after it, and ends silently if the caller aborted. There's a **hard 120 s client timeout** via `AbortSignal.any`. | A stream can't hang forever in the UI. | `stream.ts` |
| F5 | A malformed NDJSON line is skipped rather than killing the answer. | Resilience. | `stream.ts` |
| F6 | `done` with empty text becomes the error "Model returned nothing". | Otherwise the panel would show a blank card. | `handleEvent()` |
| F7 | **Kill switch:** a global `keydown` listener in the **capture phase** that calls `preventDefault` and `stopPropagation`. Esc works even while typing in the input. Engaging aborts both streams and renders the overlay. Esc (or a double-click) resumes. | Double-click rather than single click, so a stray click can't accidentally reveal content. | `App.tsx` |
| F8 | The STANDBY overlay is a fixed full-screen div with **no animation**. | It must be instant. | `.standby` |
| F9 | **CLEAR** aborts streams, empties both panels, and refocuses the input. | Fast reset between segments. | `clear()` |
| F10 | The input auto-focuses on load, after CLEAR and after leaving STANDBY. The SEND button is disabled while the input is empty and shows "SEND ↻" while streaming. Sending is still allowed, since it interrupts. | Keyboard-only operation. | `App.tsx` |
| F11 | Markdown is rendered with `react-markdown` + `remark-gfm`. Images render as `[image: alt]`. | No surprise external image loads on stage. | `SafeMarkdown` |
| F12 | Each AI message's markdown is wrapped in an **error boundary** that falls back to plain text. | A markdown crash can't blank a panel. | `SafeMarkdown` |
| F13 | `AiMessage` is `memo`-ised. | Only the streaming message re-renders. | `Panel.tsx` |
| F14 | **Autoscroll** only if the user was within **80 px** of the bottom, using `useLayoutEffect`. | The presenter can scroll up to point at something without being yanked back down. | `Panel.tsx` |
| F15 | Typing dots show until the first token, then a blinking cursor while streaming. The CSS `p:has(+ .cursor) { display: inline }` keeps the cursor on the last paragraph's line. | A clear "thinking" versus "typing" signal. | `Panel.tsx`, CSS |
| F16 | Model tags show only the name after the last `/`, e.g. `qwen3-abliterated:8b`. | `huihui_ai/…` was too long and overlapped the VS badge. | `Panel.tsx` |
| F17 | A blocked answer with no text gets `.bare`: no white card around the blocked card. | Avoids a card inside a card. | `Panel.tsx`, CSS |
| F18 | Empty states: left "› awaiting input", right "Ask me anything." | Sets the tone of each side before the first question. | `Panel.tsx` |
| F19 | `StrictMode` is on. | Catches effect bugs in development. Harmless in production. | `main.tsx` |

### 3.8 Visual design
**v1 (first build, replaced):** neon red `#ff2d2d` with amber, a red-to-blue gradient header, CRT scanlines, a glitch keyframe on the label, glowing buttons, and a bright `#0a66ff` blue. Garv found it tacky.

**v2 (current), "premium":**
| # | Decision | Why |
|---|---|---|
| V1 | Neutral zinc chrome: `#09090b` header and input bar, 1 px hairlines (`#232327` / `#2e2e33`), no gradients, glows, scanlines or glitch. | Restraint reads as premium. The two panels carry the contrast. |
| V2 | **Left:** graphite `#0e0e10`, warm off-white `#ebe8e3` JetBrains Mono, and a **single ember accent `#e5484d`** for the label, the `›` prompt marker, the cursor and a 2 px answer rule (50 % alpha). Code in `#f5b7a8` on `#1b1b1e`. | Keeps the "raw terminal" feel with one disciplined accent. |
| V3 | **Right:** porcelain `#f5f6f8`, ink `#111827` Inter, a **single indigo accent `#3e63dd`** for the label, user bubble, dots and cursor. White answer cards with 14 px radius, a 1 px `#e5e7eb` border and a soft two-layer shadow. | Polished "corporate" feel. |
| V4 | Title: "UNCENSORED AI" in mono and ember, a small uppercase grey "vs", and "COMMERCIAL AI" in Inter with light indigo `#8da4ef`. | Echoes the two panels. The ember was changed from salmon `#ff8589` so it matches the panel label. |
| V5 | Buttons: CLEAR is a ghost button, KILL is solid ember with a `kbd` Esc hint, SEND is solid near-white. | The kill switch is obvious without glowing. |
| V6 | Blocked card: `#fff7f7` background, 1 px `#f7c7c9` border, 6 px ember left edge, an 800-weight title "⛔ RESPONSE BLOCKED", a small "SAFETY FILTER" subline (with the reason if it isn't SAFETY), and pill category chips. A 160 ms pop-in. | Unmissable from a distance, and still refined. "SAFETY FILTER · SAFETY" was repetitive, so the reason is hidden when it's SAFETY. |
| V7 | Status dots: 0.6 em, green `#30a46c` or ember, each with a 3 px ring. The red dot pulses. | Visible without shouting. |
| V8 | STANDBY: `#09090b` background, 600-weight text with 0.4 em letter-spacing in `#2a2a2e`. | Neutral, and nearly invisible on a projector. |
| V9 | Sizing: `clamp()` + `vw`. Body text `clamp(18px, 2.2vw, 34px)` is about 22 px at 1024×768. | Scales from 720p to 4K. |
| V10 | Grid columns are `minmax(0, 1fr)` twice. | Plain `1fr` let the long model tag stretch the left column, so the split wasn't 50/50. |
| V11 | The VS badge is centered on the divider, and the panel heads have extra inner padding (about 2.6 em) on the badge side. | Otherwise the model tags ran under the badge. |
| V12 | Fonts are bundled with `@fontsource` (Inter 400/600/800, JetBrains Mono 400/700/800), not loaded from a CDN. | Venue internet shouldn't be able to break the typography. |
| V13 | All animations are 160 ms or less, and none delays text appearing. | Requirement: smooth but fast. |

### 3.9 Tooling and scripts
| # | Decision | Why |
|---|---|---|
| T1 | `start.sh` always rebuilds the frontend before serving (about 0.2 s). | The served UI can never be stale. |
| T2 | `start.sh` refuses to run without `.env`. | Fail loudly and early. |
| T3 | `connect-krish.sh` accepts a bare IP (adds `:11434`), `host:port`, or a full URL. It checks both reachability and that the model is in `/api/tags` (accepting a `:latest` suffix), and lists the models that do exist if there's a mismatch. On failure it prints Garv's own IP. | This is the most likely failure point on the day, so it gives clear, actionable output. |
| T4 | `dev/fake_models.py` fakes both Ollama and Gemini on one port. It includes a `<think>` block, a "bomb" → blocked path, a disconnect log, and `FAKE_DELAY`. | Everything can be tested without Krish or spending Gemini quota. |
| T5 | TypeScript is strict, and `npm run build` runs `tsc --noEmit` first. | Type errors fail the build, not the demo. |
| T6 | git: `.env`, `log.md`, `node_modules/`, `frontend/dist/`, `.venv/` and `__pycache__/` are ignored. | Secrets and generated files stay out. |

---

## 4. Findings during setup (2026-09-29)

- **Krish's first address (a guest-Wi-Fi IP on port 8080) was unreachable.** It was his PC's address on that network, and 8080 was Open WebUI (a chat page). Guest Wi-Fi also isolates clients. The fix: both laptops on one phone hotspot, Ollama on 11434, `OLLAMA_HOST=0.0.0.0:11434`, and a Windows firewall rule scoped to `LocalSubnet`.
- **Krish's laptop runs Windows.** The Mac-style `launchctl` and `ipconfig getifaddr` steps were replaced with `setx`, `New-NetFirewallRule` and `Get-NetIPAddress`. His Claude session supplied these, and they were cross-checked.
- **Gemini key format** is `AQ.…` rather than the older `AIza…`. It worked with the `x-goog-api-key` header.
- **Model availability for this key:** 3.8, 3.7, 3.6, 3.5 and 3.5-lite Flash, among others. `gemini-2.5-flash` returned 404 ("no longer available to new users").
- **Free tier limit: 20 requests per day per model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). Testing used up 3.8's allowance for the day. **Billing must be enabled before the event.**
- **`gemini-3.8-flash` was frequently overloaded (503)** on 2026-09-29, and 3.7 as well. 3.5-flash and `gemini-flash-latest` sometimes hung for 30 s or more.
- **Qwen3 thinking:** handled with `think:false` plus ThinkFilter. This has not yet been verified against Krish's real model.

---

## 5. Testing without real models

```bash
# terminal 1: fake Ollama + fake Gemini on :11434
uv run --no-project --with fastapi --with uvicorn uvicorn --app-dir dev fake_models:app --port 11434
```
```bash
# terminal 2: a second backend on :8001, using the fakes and a throwaway log
cd frontend && npm run build && cd ../backend
ENV_FILE=../dev/test.env LOG_FILE=../dev/log.md uv run uvicorn main:app --port 8001
```
Open http://localhost:8001. `dev/log.md` is gitignored (it matches `log.md`).

Checks that were run and passed:
- Both panels stream independently, and the right side finishes before the left.
- A "bomb" prompt shows the blocked card with a `DANGEROUS_CONTENT` chip.
- Esc mid-stream: both streams stop, the left answer shows `[ cut ]`, and the fake prints "client disconnected". Esc again restores the panels with history.
- CLEAR empties both panels and focus returns to the input.
- Killing the fake with SIGKILL mid-answer: the left panel shows "CONNECTION TO KRISH'S LAPTOP DROPPED", and the right panel is unaffected.
- Missing Gemini key: the right panel shows an error, and the left panel works.
- Status dots turn red within about 10 s of a side going down.
- Real Gemini: the fallback 3.8 (503) → 3.6 answered, and a hotwiring prompt got a refusal. About 2–3 s to first text with `minimal` thinking.
- A bogus `GEMINI_THINKING` value → retried without it, and the answer succeeded.
- `connect-krish.sh`: the wrong-model, unreachable and success paths all give the right output.
- `ollama_cfg()` picks up `.env` edits without a restart.
- `log.md`: normal, blocked, cut-off (killed) and shutdown-with-half-turn cases are all logged correctly, and a browser-driven turn pairs both sides.

---

## 6. Known limitations and open items

- [ ] **Enable Gemini billing** before the event (see section 4).
- [ ] **Rotate the Gemini key** after the event. It was pasted into a chat session.
- [ ] **End-to-end test with Krish's real Ollama** on the hotspot. The ThinkFilter and `think:false` haven't been checked against real Qwen3 output yet.
- Every Gemini request first tries 3.8. While 3.8 is returning 503, that adds about 0.4–2 s. If it's still overloaded on the day, consider making `gemini-3.6-flash` the main model.
- If 3.6 is silent, the fallback waits up to 10 s before moving on.
- Esc-resume brings back cut content. Use CLEAR if it must never reappear (see P6).
- The health check doesn't detect Gemini capacity problems, only key and model validity.
- `log.md` grows without limit. That's fine for a few hours.
- Ollama on the hotspot is unauthenticated (see the README security note).
- The build includes non-Latin font subsets (Cyrillic, Greek, Vietnamese). They're harmless but make the build output long. They could be trimmed by importing the `latin-*.css` files only.

---

## 7. Timeline
1. **Plan** (plan mode). Garv answered the requirements questions (P1–P13).
2. **v1 build:** backend, frontend, fake servers in a scratchpad, tests at 1024×768.
3. **Real credentials:** Krish's endpoint (unreachable), the Qwen3 model, the Gemini key, and 3.8 Flash. Added think handling, the Gemini fallback chain, thinking levels, and friendlier drop errors. Fixed the column width and badge overlap.
4. **Krish on Windows:** `.env` hot-reload of the Ollama settings, `connect-krish.sh`, and a Windows-first README.
5. **Premium restyle (v2).**
6. **Question log** (`transcript.py`), simple README controls, this file, `dev/` fakes, and the first commit.
