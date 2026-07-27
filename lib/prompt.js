// Everything that gets sent to Gemini is assembled here, so there is exactly one
// place to read (or change) the prompt.
//
// RAG-3 fixes the order: system instruction, retrieved chunks, the last 10
// conversation turns, then the four profile inputs appended at the very end.
// The system instruction now travels in Gemini's dedicated `systemInstruction`
// field rather than inline (it is still delivered first, and as a system role it
// persists properly across accumulating turns); the other three are assembled below
// in spec order as a single user turn.

import { STAGES } from './profile.js';

export const SYSTEM_INSTRUCTION = `You are a helpful assistant answering questions about Indian government scholarship schemes.

Answer using the scholarship context provided below. The context is extracted from official scheme guideline documents.

If the context does not cover what was asked, say so plainly, answer as best you can from what you do know, and tell the user to verify on the scheme's official page. Do not refuse to answer.

Never invent scheme names, amounts, income limits, percentages, or deadlines. Every specific figure you state must come from the context.

A user profile may appear at the end of the message. Use it to tailor emphasis, examples and tone — mention the schemes and rules that apply to that user first. Never state or imply that the user is eligible or ineligible for a scheme on the basis of the profile alone; the profile is context for phrasing, not a verdict.`;

// Spec §7: "Keep last 10 turns; drop older." Counted as 10 individual messages
// (≈5 exchanges) rather than 10 full exchanges — the cheaper reading, and it keeps
// requests comfortably inside the free-tier token budget alongside ~22k characters
// of retrieved context.
export const MAX_TURNS = 10;

/** Render retrieved Qdrant hits as the numbered context block. */
export function buildContext(matches) {
  return matches
    .map((m, i) => {
      const p = m.payload ?? {};
      // Falls back to doc_id when the manifest has no scheme_name, so a chunk is
      // never presented to the model as anonymous.
      const label = [p.scheme_name, p.year].filter(Boolean).join(' ') || p.doc_id;
      return `[${i + 1}] ${label} — ${p.doc_id}, page ${p.page}\n${p.text}`;
    })
    .join('\n\n---\n\n');
}

/** Last MAX_TURNS messages, oldest first. Older turns are dropped (REL-6). */
export function trimConversation(conversation) {
  if (!Array.isArray(conversation)) return [];
  return conversation
    .filter((t) => t && typeof t.content === 'string' && (t.role === 'user' || t.role === 'assistant'))
    .slice(-MAX_TURNS);
}

export function buildConversationBlock(conversation) {
  const turns = trimConversation(conversation);
  if (!turns.length) return '';
  const rendered = turns
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
  return `\n--- CONVERSATION SO FAR ---\n${rendered}\n--- END CONVERSATION ---\n`;
}

/** The profile line, exactly as specified in §6.3. */
export function buildProfileLine(profile) {
  if (!profile) return '';
  const stage = STAGES.find((s) => s.value === profile.stage)?.value ?? profile.stage;
  return `\n\n[User profile — tailor your answer to this: course level ${profile.course_level}, category ${profile.category}, family income ${profile.income_band}, stage ${stage}]`;
}

/**
 * The complete user-turn text sent to Gemini.
 * @param userMessage  the current question
 * @param matches      Qdrant hits
 * @param options      { profile, conversation } — both optional
 */
export function buildPrompt(userMessage, matches, { profile, conversation } = {}) {
  const context = buildContext(matches);

  return `--- SCHOLARSHIP CONTEXT ---
${context || '(no relevant context was retrieved)'}
--- END CONTEXT ---
${buildConversationBlock(conversation)}
Question: ${userMessage.trim()}${buildProfileLine(profile)}`;
}
