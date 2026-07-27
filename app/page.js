// Phase 1 is headless by design (spec §10): the pipeline is exercised with curl
// against /api/chat. The input form and chat UI arrive in Phase 2.

export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '40rem' }}>
      <h1>Scholarship Assistant (Lite)</h1>
      <p>Phase 1 — headless RAG pipeline. No UI yet; that is Phase 2.</p>
      <p>
        Ingest the corpus with <code>npm run ingest</code>, then POST to{' '}
        <code>/api/chat</code> with <code>{'{ "user_message": "..." }'}</code>.
      </p>
    </main>
  );
}
