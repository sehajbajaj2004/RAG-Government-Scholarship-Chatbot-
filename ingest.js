// Flow A — offline ingestion (spec §5). Run once per corpus change:
//
//   npm run ingest
//
// Not part of the request path. Re-running is safe: chunk IDs are derived from
// (doc_id, chunk index), so a second run overwrites rather than duplicates (ING-5).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

import { chunkDocument } from './lib/chunk.js';
import { embedPassages, countTokens } from './lib/embeddings.js';
import { getQdrant, ensureCollection } from './lib/qdrant.js';
import { QDRANT_COLLECTION } from './lib/config.js';

const CORPUS_DIR = path.join(import.meta.dirname, 'corpus');
const MANIFEST_PATH = path.join(CORPUS_DIR, 'manifest.json');

// Below this many non-whitespace characters a page is treated as having no text
// layer — almost always a scanned image. OCR is out of scope (spec §5.1), so the
// page is skipped and logged rather than silently ingested as an empty chunk.
const MIN_CHARS_PER_PAGE = 20;

const EMBED_BATCH = 16;
const UPSERT_BATCH = 64;

/** Deterministic UUID (v5-shaped) so re-ingesting is an overwrite, not a duplicate. */
function chunkId(docId, index) {
  const h = createHash('md5').update(`${docId}#${index}`).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function loadManifest() {
  if (!existsSync(MANIFEST_PATH)) {
    console.warn(`! No corpus/manifest.json found — scheme_name and year will be null.`);
    return {};
  }
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch (err) {
    console.warn(`! corpus/manifest.json could not be parsed (${err.message}) — scheme_name and year will be null.`);
    return {};
  }
}

async function extractPages(file) {
  const parser = new PDFParse({ data: readFileSync(path.join(CORPUS_DIR, file)) });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => ({ page: p.num, text: p.text || '' }));
  } finally {
    await parser.destroy();
  }
}

async function main() {
  if (!existsSync(CORPUS_DIR)) {
    console.error(`No /corpus directory at ${CORPUS_DIR}.`);
    process.exitCode = 1;
    return;
  }

  const files = readdirSync(CORPUS_DIR).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
  if (files.length === 0) {
    console.error(`/corpus has no PDFs (${CORPUS_DIR}).`);
    process.exitCode = 1;
    return;
  }

  const manifest = loadManifest();
  const missingName = [];
  const missingYear = [];
  const created = await ensureCollection();
  console.log(
    created
      ? `Created Qdrant collection "${QDRANT_COLLECTION}".`
      : `Using existing Qdrant collection "${QDRANT_COLLECTION}".`,
  );
  console.log(`Ingesting ${files.length} PDF(s) from /corpus\n`);

  const qdrant = getQdrant();
  let docsProcessed = 0;
  let docsFailed = 0;
  let totalChunks = 0;
  const skippedPages = [];

  for (const file of files) {
    const docId = file.replace(/\.pdf$/i, '');
    const meta = manifest[file] || {};
    const schemeName = meta.scheme_name || null;
    const year = meta.year ?? null;
    if (!schemeName) missingName.push(file);
    if (year === null || year === undefined) missingYear.push(file);

    let pages;
    try {
      pages = await extractPages(file);
    } catch (err) {
      // A single unreadable PDF must not abort the run (ING-1).
      console.error(`✗ ${file} — could not be parsed: ${err.message}`);
      docsFailed++;
      continue;
    }

    const usablePages = [];
    for (const p of pages) {
      if (p.text.replace(/\s/g, '').length < MIN_CHARS_PER_PAGE) {
        // ING-2: log filename + page number, keep going.
        console.warn(`  skipped: ${file} page ${p.page} — no text layer`);
        skippedPages.push({ file, page: p.page });
        continue;
      }
      usablePages.push(p);
    }

    if (usablePages.length === 0) {
      console.warn(`✗ ${file} — every page skipped, nothing to ingest`);
      docsProcessed++;
      continue;
    }

    const chunks = await chunkDocument(usablePages, countTokens);

    // Stable IDs stop re-runs from duplicating, but they do not clean up after a run
    // that produces *fewer* chunks than the last one (edited PDF, changed chunk size):
    // the tail points from the previous run would linger and still be retrievable.
    // Clearing the document first makes re-ingestion a true replace.
    await qdrant.delete(QDRANT_COLLECTION, {
      wait: true,
      filter: { must: [{ key: 'doc_id', match: { value: docId } }] },
    });

    for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
      const batch = chunks.slice(i, i + EMBED_BATCH);
      const vectors = await embedPassages(batch.map((c) => c.text));
      const points = batch.map((chunk, j) => ({
        id: chunkId(docId, i + j),
        vector: vectors[j],
        payload: {
          doc_id: docId,
          scheme_name: schemeName,
          year,
          page: chunk.page,
          text: chunk.text,
        },
      }));
      for (let k = 0; k < points.length; k += UPSERT_BATCH) {
        await qdrant.upsert(QDRANT_COLLECTION, {
          wait: true,
          points: points.slice(k, k + UPSERT_BATCH),
        });
      }
    }

    console.log(`✓ ${file} — ${usablePages.length}/${pages.length} page(s), ${chunks.length} chunk(s)`);
    docsProcessed++;
    totalChunks += chunks.length;
  }

  // ING-6
  console.log('\nSummary');
  console.log(`  documents processed: ${docsProcessed}/${files.length}`);
  if (docsFailed) console.log(`  documents failed to parse: ${docsFailed}`);
  console.log(`  chunks created: ${totalChunks}`);
  console.log(`  pages skipped (no text layer): ${skippedPages.length}`);
  for (const s of skippedPages) console.log(`    - ${s.file} page ${s.page}`);

  // scheme_name and year fail differently: a missing name leaves chunks labelled by
  // filename in the prompt, a missing year just omits it. Reported separately so a
  // deliberate null year does not read like an unfilled manifest entry.
  if (missingName.length) {
    console.log(`\n! ${missingName.length} document(s) have no scheme_name in corpus/manifest.json:`);
    for (const f of missingName) console.log(`    - ${f}`);
    console.log('  Their chunks will be labelled by filename in the prompt.');
  }
  if (missingYear.length) {
    console.log(`\n! ${missingYear.length} document(s) have year: null in corpus/manifest.json:`);
    for (const f of missingYear) console.log(`    - ${f}`);
    console.log('  Expected where the document states no year. Fill in and re-run if you know it.');
  }
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exitCode = 1;
});
