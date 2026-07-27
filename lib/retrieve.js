// Retrieval for Flow B.
//
// Two passes, merged:
//
//   1. Similarity — plain top-k. Gives depth: several chunks from the one document
//      that actually answers a specific question (the OBC income ceiling needs
//      pages 4 AND 5, so depth is not optional).
//   2. Coverage — best chunk per document, grouped by doc_id. Guarantees every
//      scheme in the corpus is represented at least once.
//
// Pass 1 alone cannot answer "what schemes are available for me?": top-k optimises
// similarity, not coverage, so a verbose scheme can take half the slots and leave
// others invisible. Measured before this existed, the same intent phrased four ways
// reached 7, 5, 5 and 4 of 10 documents. Pass 2 makes that floor 10/10.
//
// RAG-2 still holds: both passes embed the user's query and nothing else. No profile
// value reaches the vector or any filter.

import { embedQuery } from './embeddings.js';
import { getQdrant } from './qdrant.js';
import { QDRANT_COLLECTION, TOP_K, MAX_CONTEXT_CHUNKS, COVERAGE_GROUPS } from './config.js';

/** Normalise a grouped hit into the same shape a plain search hit has. */
function fromGroup(group) {
  const hit = group.hits?.[0];
  if (!hit) return null;
  return { id: hit.id, score: hit.score, payload: hit.payload };
}

export async function retrieve(userMessage) {
  const qdrant = getQdrant();
  const vector = await embedQuery(userMessage.trim());

  const [similarity, grouped] = await Promise.all([
    qdrant.search(QDRANT_COLLECTION, {
      vector,
      limit: TOP_K,
      with_payload: true,
    }),
    qdrant.searchPointGroups(QDRANT_COLLECTION, {
      vector,
      group_by: 'doc_id',
      limit: COVERAGE_GROUPS,
      group_size: 1,
      with_payload: true,
    }),
  ]);

  // Similarity hits come first and keep their order — the answer to a specific
  // question should still lead the context.
  const merged = [...(similarity ?? [])];
  const seenIds = new Set(merged.map((m) => m.id));
  const seenDocs = new Set(merged.map((m) => m.payload?.doc_id));

  for (const group of grouped?.groups ?? []) {
    if (merged.length >= MAX_CONTEXT_CHUNKS) break;
    const hit = fromGroup(group);
    // Only documents the similarity pass missed — otherwise this just duplicates
    // chunks already present and burns context.
    if (!hit || seenIds.has(hit.id) || seenDocs.has(hit.payload?.doc_id)) continue;
    merged.push(hit);
    seenIds.add(hit.id);
    seenDocs.add(hit.payload?.doc_id);
  }

  return merged;
}
