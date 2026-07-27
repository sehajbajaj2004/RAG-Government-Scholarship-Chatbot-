// Single source of truth for everything ingestion and query time must agree on.
// ING-4 requires the embedding model to be pinned here and reused at query time —
// if these two ever diverge, retrieval silently returns garbage.

export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const EMBEDDING_DIM = 384;

// bge-* retrieval models are trained asymmetrically: the query gets an instruction
// prefix, the stored passage does not. Using the same text on both sides measurably
// degrades recall, so the prefix lives here and is applied only to queries.
export const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

export const QDRANT_COLLECTION = 'scholarships';

// Spec §5.2 [DEFAULT] ~500-token chunks, ~50-token overlap.
// 500 + [CLS] + [SEP] stays inside bge-small's 512-token window, so no chunk is
// silently truncated at embed time.
export const CHUNK_TOKENS = 500;
export const CHUNK_OVERLAP_TOKENS = 50;

// Spec §6.2 [DEFAULT] is k=5. Raised to 10: at k=5 the overview/objective page of each
// scheme crowded out the specific eligibility pages, so questions whose answer was in
// the corpus (CSSS income limit, OBC income ceiling) came back as "not specified".
export const TOP_K = 10;

export const GEMINI_MODEL = 'gemini-2.5-flash';
