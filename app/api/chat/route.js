// Flow B — chat (spec §6). Phase 1 scope: embed query → retrieve top-k → Gemini →
// answer text. The profile and conversation fields are accepted but deliberately
// unused until Phase 2 (RAG-3/RAG-4/RAG-6).
//
// RAG-5: GEMINI_API_KEY is read here, in server-only code. It is never returned to
// the client and never included in an error body — see toSafeError below.

import { GoogleGenAI } from '@google/genai';

import { embedQuery } from '@/lib/embeddings.js';
import { getQdrant } from '@/lib/qdrant.js';
import { buildPrompt } from '@/lib/prompt.js';
import { QDRANT_COLLECTION, TOP_K, GEMINI_MODEL } from '@/lib/config.js';

// Transformers.js and the Qdrant client are Node-only; this route must not be
// pushed to the edge runtime.
export const runtime = 'nodejs';

/** Never let an upstream error message reach the client: SDK errors can embed the
 *  request URL, which carries the API key as a query parameter. */
function redact(message) {
  return String(message).replace(/key=[\w-]+/gi, 'key=[REDACTED]');
}

function jsonError(status, message) {
  return Response.json({ error: message }, { status });
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON.');
  }

  // `profile` and `conversation` are part of the Phase 2 contract (spec §6). They are
  // read here only so the client contract is stable; neither reaches retrieval.
  const { user_message: userMessage } = body ?? {};
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    return jsonError(400, 'user_message is required and must be a non-empty string.');
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set (see .env.local.example).');
    return jsonError(500, 'Server is not configured. Try again later.');
  }

  // RAG-1 / RAG-2: the query text is the only retrieval input. No profile, no filter.
  let matches;
  try {
    const vector = await embedQuery(userMessage.trim());
    const results = await getQdrant().search(QDRANT_COLLECTION, {
      vector,
      limit: TOP_K,
      with_payload: true,
    });
    matches = results ?? [];
  } catch (err) {
    console.error('Retrieval failed:', redact(err?.message ?? err));
    return jsonError(502, 'Could not search the scholarship corpus. Try again.');
  }

  const prompt = buildPrompt(userMessage, matches);

  let answer;
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    answer = response.text;
  } catch (err) {
    console.error('Gemini call failed:', redact(err?.message ?? err));
    return jsonError(502, 'The model is unavailable right now. Try again.');
  }

  if (!answer) {
    return jsonError(502, 'The model returned an empty response. Try again.');
  }

  return Response.json({
    answer,
    // Phase 1 verification aid only — lets the exit-criterion curl show which chunks
    // the answer was built from. `text` is the chunk verbatim as it went into the
    // prompt, so a figure in the answer can be traced to its source by eye.
    // Not a citation UI; drop or gate this in Phase 2.
    retrieved: matches.map((m) => ({
      doc_id: m.payload?.doc_id,
      scheme_name: m.payload?.scheme_name,
      year: m.payload?.year,
      page: m.payload?.page,
      score: m.score,
      text: m.payload?.text ?? '',
    })),
  });
}
