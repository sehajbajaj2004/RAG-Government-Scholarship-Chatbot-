// ING-3: ~500-token chunks, ~50-token overlap, and a chunk never spans two documents.
// Documents are chunked one at a time by ingest.js, so the "never spans two documents"
// half is structural. This file handles the token budgeting.
//
// Chunks are assembled from paragraphs rather than a flat token window so a chunk
// rarely cuts a sentence in half — retrieval quality depends on chunks reading as
// coherent passages. A paragraph too big to fit is split down to sentences, then words.

import { CHUNK_TOKENS, CHUNK_OVERLAP_TOKENS } from './config.js';

function splitParagraphs(pageText) {
  return pageText
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean);
}

function splitSentences(text) {
  // Deliberately crude: a full stop / question mark / colon followed by whitespace.
  // Over-splitting is harmless here because units are re-joined into chunks anyway.
  const parts = text.split(/(?<=[.?!:])\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [text];
}

/** Break a unit that is over budget into pieces that fit, by words. */
async function splitOversized(text, maxTokens, countTokens, depth = 0) {
  const total = await countTokens(text);
  if (total <= maxTokens) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  // A single "word" over budget is a parsing artefact (e.g. a run-together heading
  // from a PDF with no spaces). Cut it by characters so ingestion cannot hang.
  if (words.length <= 1 || depth > 6) {
    const ratio = text.length / Math.max(total, 1);
    const size = Math.max(1, Math.floor(maxTokens * ratio));
    const pieces = [];
    for (let i = 0; i < text.length; i += size) pieces.push(text.slice(i, i + size));
    return pieces;
  }

  const groups = Math.ceil(total / maxTokens);
  const per = Math.ceil(words.length / groups);
  const out = [];
  for (let i = 0; i < words.length; i += per) {
    const piece = words.slice(i, i + per).join(' ');
    out.push(...(await splitOversized(piece, maxTokens, countTokens, depth + 1)));
  }
  return out;
}

/**
 * @param pages  [{ page: number, text: string }] for a single document
 * @param countTokens  async (string) => number
 * @returns [{ text, page }] where `page` is the page the chunk starts on
 */
export async function chunkDocument(pages, countTokens) {
  // Flatten to units first so a chunk can flow across a page boundary; without this,
  // a rule split across pages 3 and 4 would never be retrievable as one passage.
  const units = [];
  for (const { page, text } of pages) {
    for (const para of splitParagraphs(text)) {
      let tokens = await countTokens(para);
      if (tokens <= CHUNK_TOKENS) {
        units.push({ text: para, page, tokens });
        continue;
      }
      for (const sentence of splitSentences(para)) {
        tokens = await countTokens(sentence);
        if (tokens <= CHUNK_TOKENS) {
          units.push({ text: sentence, page, tokens });
          continue;
        }
        for (const piece of await splitOversized(sentence, CHUNK_TOKENS, countTokens)) {
          units.push({ text: piece, page, tokens: await countTokens(piece) });
        }
      }
    }
  }

  const chunks = [];
  let current = [];
  let currentTokens = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push({ text: current.map((u) => u.text).join('\n\n'), page: current[0].page });
  };

  // Units are joined with a blank line, which costs a token or two the unit counts
  // don't include. Charged explicitly so the budget below is honest — a chunk that
  // overruns bge-small's 512-token window gets silently truncated at embed time.
  const JOIN_TOKENS = 2;
  const costOf = (unit, existing) => unit.tokens + (existing.length ? JOIN_TOKENS : 0);

  for (const unit of units) {
    if (current.length && currentTokens + costOf(unit, current) > CHUNK_TOKENS) {
      flush();
      // Carry the tail of the emitted chunk into the next one so a passage split
      // across a boundary still has its lead-in context on at least one side.
      const overlap = [];
      let overlapTokens = 0;
      for (let i = current.length - 1; i >= 0; i--) {
        if (overlapTokens + current[i].tokens + JOIN_TOKENS > CHUNK_OVERLAP_TOKENS) break;
        overlap.unshift(current[i]);
        overlapTokens += current[i].tokens + JOIN_TOKENS;
      }
      // The overlap is a nicety; the budget is not. If this unit is large enough that
      // keeping the overlap would blow the window, drop overlap until it fits.
      while (overlap.length && overlapTokens + unit.tokens + JOIN_TOKENS > CHUNK_TOKENS) {
        overlapTokens -= overlap[0].tokens + JOIN_TOKENS;
        overlap.shift();
      }
      current = overlap;
      currentTokens = overlapTokens;
    }
    currentTokens += costOf(unit, current);
    current.push(unit);
  }
  flush();

  return chunks;
}
