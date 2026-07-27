# Scholarship Assistant (Lite)

RAG chatbot over Indian government scholarship guideline PDFs.
Built to `scholarship-assistant-lite-spec.md`. **Phase 1 (headless pipeline) only** —
there is no chat UI yet; that is Phase 2.

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

Retrieval returns top-k chunks (k=10, raised from the spec default of 5 — rationale in
`lib/config.js`). Returns `{ answer, retrieved }`, where each `retrieved` entry carries
`doc_id`, `scheme_name`, `year`, `page`, `score` and the chunk `text` verbatim as it went
into the prompt — so any figure in the answer can be traced to its source by eye.
A Phase 1 verification aid, not a citation UI.

`profile` and `conversation` are accepted in the request body but ignored until
Phase 2. Retrieval uses the query text only, never the profile (RAG-2).

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
