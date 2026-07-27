// Flow B — chat (spec §6): embed query → retrieve top-k → Gemini → answer text.
//
// RAG-2: the four profile inputs steer the prompt only. They never enter the
// retrieval query or a Qdrant filter — retrieval sees the user message and nothing
// else, so two users with different profiles retrieve identical chunks.
//
// RAG-5: GEMINI_API_KEY is read here, in server-only code. It is never returned to
// the client and never included in an error body — see redact() below.

import { GoogleGenAI } from '@google/genai';

import { retrieve } from '@/lib/retrieve.js';
import { buildPrompt, SYSTEM_INSTRUCTION } from '@/lib/prompt.js';
import { validateProfile } from '@/lib/profile.js';
import { GEMINI_MODEL } from '@/lib/config.js';

// Transformers.js and the Qdrant client are Node-only; this route must not be
// pushed to the edge runtime.
export const runtime = 'nodejs';

// REL-1: exponential backoff on rate limiting — 1s → 2s → 4s, three retries.
const RETRY_DELAYS_MS = [1000, 2000, 4000];

/** Never let an upstream error message reach the client: SDK errors can embed the
 *  request URL, which carries the API key as a query parameter. */
function redact(message) {
  return String(message).replace(/key=[\w-]+/gi, 'key=[REDACTED]');
}

function jsonError(status, message) {
  return Response.json({ error: message }, { status });
}

function isRateLimit(err) {
  if (err?.status === 429) return true;
  return /\b429\b|RESOURCE_EXHAUSTED|rate limit|quota/i.test(String(err?.message ?? ''));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Call Gemini, retrying only on rate limiting. Other failures surface immediately —
 *  retrying a malformed request just burns free-tier quota. */
async function generateWithRetry(ai, prompt) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          // Deterministic: two profiles must differ because the profile differs,
          // not because of sampling noise (Phase 2 exit criterion).
          temperature: 0,
        },
      });
      return response.text;
    } catch (err) {
      lastErr = err;
      if (!isRateLimit(err) || attempt === RETRY_DELAYS_MS.length) throw err;
      console.warn(
        `Gemini rate limited, retrying in ${RETRY_DELAYS_MS[attempt]}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`,
      );
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastErr;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Request body must be valid JSON.');
  }

  const { user_message: userMessage, profile, conversation } = body ?? {};
  if (typeof userMessage !== 'string' || !userMessage.trim()) {
    return jsonError(400, 'user_message is required and must be a non-empty string.');
  }

  // INP-2 gates the chat on a complete profile in the UI. Here a profile is optional
  // so the corpus stays testable from curl, but a *malformed* one is rejected rather
  // than silently passed to the model.
  if (profile !== undefined && profile !== null) {
    const invalid = validateProfile(profile);
    if (invalid.length) {
      return jsonError(400, `Invalid or missing profile fields: ${invalid.join(', ')}.`);
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set (see .env.local.example).');
    return jsonError(500, 'Server is not configured. Try again later.');
  }

  // RAG-1 / RAG-2: the query text is the only retrieval input. No profile, no filter.
  let matches;
  try {
    matches = await retrieve(userMessage);
  } catch (err) {
    console.error('Retrieval failed:', redact(err?.message ?? err));
    return jsonError(502, 'Could not search the scholarship corpus. Try again.');
  }

  const prompt = buildPrompt(userMessage, matches, { profile, conversation });

  let answer;
  try {
    const ai = new GoogleGenAI({ apiKey });
    answer = await generateWithRetry(ai, prompt);
  } catch (err) {
    console.error('Gemini call failed:', redact(err?.message ?? err));
    if (isRateLimit(err)) {
      // REL-1: final failure after all retries.
      return jsonError(429, 'Service busy, try again.');
    }
    return jsonError(502, 'The model is unavailable right now. Try again.');
  }

  if (!answer) {
    return jsonError(502, 'The model returned an empty response. Try again.');
  }

  // RAG-6: the answer text goes back to the client, which owns conversation state
  // (INP-3 — nothing about the user is persisted server-side).
  return Response.json({
    answer,
    // Phase 1/2 verification aid: which chunks the answer was built from. Consumed by
    // curl and scripts/dump-prompt.js, deliberately not rendered in the UI — §9 puts
    // citation UI out of scope for v0.
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
