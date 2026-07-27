// Transformers.js embeddings, in-process. Loaded once per Node process and reused:
// the model is ~130MB and takes seconds to warm up, so a per-request load would make
// /api/chat unusable. Both ingest.js and /api/chat import from here so they cannot
// drift apart (ING-4).

import { pipeline, AutoTokenizer, env } from '@huggingface/transformers';
import { EMBEDDING_MODEL, QUERY_PREFIX } from './config.js';

// Weights are fetched from the HF hub on first run and then served from the local
// cache. Nothing here calls out to a paid or rate-limited API (spec §2).
env.allowLocalModels = false;

let extractorPromise = null;
let tokenizerPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL);
  }
  return extractorPromise;
}

export function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = AutoTokenizer.from_pretrained(EMBEDDING_MODEL);
  }
  return tokenizerPromise;
}

// bge-small is a CLS-pooled model and Qdrant is configured for cosine distance,
// so vectors are normalised here rather than at search time.
async function embed(texts) {
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'cls', normalize: true });
  return output.tolist();
}

/** Embed corpus chunks. No instruction prefix — passages are stored bare. */
export async function embedPassages(texts) {
  return embed(texts);
}

/** Embed a user query. Gets the bge instruction prefix; passages do not. */
export async function embedQuery(text) {
  const [vector] = await embed([QUERY_PREFIX + text]);
  return vector;
}

/** Token count using the *embedding model's own* tokenizer, so "500 tokens" in the
 *  chunker means the same thing the model will actually see. */
export async function countTokens(text) {
  const tokenizer = await getTokenizer();
  const encoded = tokenizer.encode(text, { add_special_tokens: false });
  return Array.isArray(encoded) ? encoded.length : encoded.input_ids.length;
}
