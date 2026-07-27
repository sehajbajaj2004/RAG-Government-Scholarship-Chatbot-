import { QdrantClient } from '@qdrant/js-client-rest';
import { QDRANT_COLLECTION, EMBEDDING_DIM } from './config.js';

let client = null;

export function getQdrant() {
  if (client) return client;

  const url = process.env.QDRANT_URL;
  const apiKey = process.env.QDRANT_API_KEY;
  if (!url) throw new Error('QDRANT_URL is not set (see .env.local.example).');
  if (!apiKey) throw new Error('QDRANT_API_KEY is not set (see .env.local.example).');

  client = new QdrantClient({ url, apiKey });
  return client;
}

/** Create the collection if it does not exist. Safe to call on every ingest run. */
export async function ensureCollection() {
  const qdrant = getQdrant();
  const { collections } = await qdrant.getCollections();
  const exists = collections.some((c) => c.name === QDRANT_COLLECTION);

  if (!exists) {
    await qdrant.createCollection(QDRANT_COLLECTION, {
      vectors: { size: EMBEDDING_DIM, distance: 'Cosine' },
    });
  }

  // Ingestion clears a document before re-upserting it, which is a filtered delete on
  // doc_id. Qdrant rejects filters on unindexed payload keys, so the index is not
  // optional. Created every run because the collection may predate this code.
  await qdrant.createPayloadIndex(QDRANT_COLLECTION, {
    field_name: 'doc_id',
    field_schema: 'keyword',
    wait: true,
  });

  return !exists;
}
