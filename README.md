# Scholarship Assistant (Lite)

RAG chatbot over Indian government scholarship guideline PDFs.
Built to `scholarship-assistant-lite-spec.md`. **All three phases implemented** —
ingestion pipeline, four-input form gating the chat, profile-tailored answers,
conversation memory, rate-limit handling, streamed responses and a mobile layout.

Stack: Next.js (App Router, plain JavaScript) · Gemini 2.5 Flash · Qdrant Cloud ·
Transformers.js embeddings (`Xenova/bge-small-en-v1.5`, 384-dim). All free tier.

## Setup

1. Install: `npm install`
2. Copy `.env.local.example` to `.env.local` and fill in three values:
   - `GEMINI_API_KEY` — https://aistudio.google.com/apikey
   - `QDRANT_URL`, `QDRANT_API_KEY` — https://cloud.qdrant.io (free cluster)

   `.env.local` is gitignored. None of these are `NEXT_PUBLIC_*`; they are read only
   in server code, so no key reaches the browser bundle.
3. Optional: fill in `corpus/manifest.json` with each PDF's `scheme_name` and `year`.
   These populate the Qdrant payload (ING-5). Ingestion runs without them and warns.

## Ingest the corpus

```
npm run ingest
```

Reads every PDF in `corpus/`, extracts text page by page, chunks to ~500 tokens with
~50-token overlap, embeds in-process, and upserts to Qdrant. Chunk IDs are derived
from `(doc_id, chunk index)`, so re-running overwrites instead of duplicating.

Pages with no text layer are skipped and logged (OCR is out of scope). Currently one:
`GuidelinesFellowshipandScholarship2021.pdf` page 36, a blank back page.

Tables are not extracted separately. `pdf-parse`'s `getTable()` detects tables from
drawn vector rules, and these documents use borderless text-aligned layout — it finds
0 tables across all 10 PDFs, all 133 pages. Table content still arrives via the text
layer, just flattened. Revisit if a ruled-table PDF is added to the corpus.

### Known limitation — CSSS text quality

`CSSS_GUIDLINES_06022024.pdf` was produced with broken inter-word spacing
(`uptoRs.`, `areeligible`, `Pursuingregulardegreecoursesand`). Roughly 1.6% of its
words are run-ons, against ~0% for the other nine documents. Mangled text embeds
poorly, so its eligibility chunk ranks ~29th of 137 for a direct question about its
own income limit and never enters the top-k. The model then correctly declines rather
than inventing a figure. Fixing this needs a cleaner source PDF, not retrieval tuning.

## Query

```
npm run dev
```

```bash
curl -s -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d "{\"user_message\":\"What is the income limit for the CSSS scholarship?\"}"
```

Retrieval ([lib/retrieve.js](lib/retrieve.js)) runs two passes and merges them: a
similarity pass (top-k, k=10 — raised from the spec default of 5, rationale in
`lib/config.js`) for depth, and a coverage pass grouped by `doc_id` that contributes
the best chunk from any document the first pass missed. Capped at 16 chunks.
Without the coverage pass, "what schemes are available for me?" reached only 4–7 of
10 documents depending on phrasing; with it, every query reaches 10/10. Returns `{ answer, retrieved }`, where each `retrieved` entry carries
`doc_id`, `scheme_name`, `year`, `page`, `score` and the chunk `text` verbatim as it went
into the prompt — so any figure in the answer can be traced to its source by eye.
A Phase 1 verification aid, not a citation UI.

`profile` and `conversation` are optional in the request body. When present, the
profile is appended to the very end of the prompt (§6.3) and the last 10 conversation
turns are included. **Retrieval uses the query text only** — the profile never enters
the embedding or a Qdrant filter (RAG-2), so two users with different profiles
retrieve identical chunks and only the phrasing differs.

Gemini is called with `temperature: 0`, so a difference between two answers is
attributable to the profile rather than sampling noise.

## The chat UI

`npm run dev` and open the app. The four inputs (§3) must all be set before the chat
opens (INP-1/INP-2); they live in React state only — no localStorage, no cookie, no
server-side store (INP-3, NFR-2). They cannot be edited in place; "Start over" clears
the profile and the whole conversation (INP-4/INP-5).

Answers stream token by token (REL-3). `/api/chat` responds with newline-delimited
JSON — one `meta` line carrying the retrieved chunks, a `delta` line per model chunk,
then `done`. Failures *before* generation starts still return a normal JSON error with
a real HTTP status, so error handling is unchanged; a failure mid-stream arrives as an
`error` line instead.

On an API failure the typed message is preserved and a Retry appears (REL-2). A
Gemini 429 is retried server-side at 1s → 2s → 4s before the user sees "Service busy,
try again" (REL-1). The disclaimer is permanent on both screens plus a first-run
notice (REL-5). The conversation is trimmed to the last 10 messages before being sent
(REL-6).

The layout is single-column at every width (REL-4): 44px minimum tap targets, a 16px
composer font so iOS Safari does not zoom on focus, safe-area padding for notched
phones, and no horizontal overflow at 375px.

### Free-tier quota

`gemini-2.5-flash` allows **20 requests per day** on the free tier
(`GenerateRequestsPerDayPerProjectPerModel-FreeTier`). The quota is per project **per
model**, so switching `GEMINI_MODEL` in `lib/config.js` draws from a separate bucket.
Embeddings run locally and consume no quota at all.

### Known limitation — follow-up questions retrieve poorly

RAG-2 mandates that retrieval use the current message alone. A follow-up like "What
is the income limit for it?" therefore embeds without the scheme name, and retrieves
generic income-limit chunks rather than that scheme's. Gemini still resolves "it"
correctly from the conversation, but may answer from the wrong chunks or say the
context does not cover it. Query rewriting is the standard fix and is out of scope
for v0.

## Layout

```
ingest.js              offline ingestion (Flow A)
lib/config.js          pinned embedding model, chunk sizes, k — shared by both flows
lib/chunk.js           token-budgeted chunking
lib/embeddings.js      Transformers.js singleton
lib/qdrant.js          Qdrant client + collection bootstrap
app/api/chat/route.js  Flow B — embed → retrieve → Gemini
corpus/                source PDFs + manifest.json
```
