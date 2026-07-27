// Everything that gets sent to Gemini is assembled here, so there is exactly one
// place to read (or change) the prompt. Phase 2 extends this with the conversation
// turns and the four profile inputs (RAG-3); Phase 1 sends instruction + context +
// question only.

// Gemini has a dedicated systemInstruction field, but this is passed as the opening
// of the single user turn instead: with one turn and no conversation history yet,
// there is nothing for a separate system role to persist across. Phase 2 should move
// this into config.systemInstruction once turns start accumulating.
export const SYSTEM_INSTRUCTION = `You are a helpful assistant answering questions about Indian government scholarship schemes.

Answer using the scholarship context provided below. The context is extracted from official scheme guideline documents.

If the context does not cover what was asked, say so plainly, answer as best you can from what you do know, and tell the user to verify on the scheme's official page. Do not refuse to answer.

Never invent scheme names, amounts, income limits, percentages, or deadlines. Every specific figure you state must come from the context.`;

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

/** The complete text sent to Gemini. */
export function buildPrompt(userMessage, matches) {
  const context = buildContext(matches);
  return `${SYSTEM_INSTRUCTION}

--- SCHOLARSHIP CONTEXT ---
${context || '(no relevant context was retrieved)'}
--- END CONTEXT ---

Question: ${userMessage.trim()}`;
}
