'use client';

// Phase 2 UI: the four-input form gates the chat (INP-1…5), the profile rides along
// with every request, and the conversation lives here and only here.
//
// INP-3 / NFR-2: profile and conversation are React state in this component. They are
// never written to localStorage, a cookie, or any server-side store — a refresh loses
// them, which is the intended behaviour. Nothing about the user is persisted.

import { useState } from 'react';

import { PROFILE_FIELDS, EMPTY_PROFILE, validateProfile } from '@/lib/profile.js';

const DISCLAIMER = 'Not official guidance. Verify on the scheme’s official page.';

function ProfileForm({ onStart }) {
  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [missing, setMissing] = useState([]);
  const [attempted, setAttempted] = useState(false);

  function choose(key, value) {
    const next = { ...profile, [key]: value };
    setProfile(next);
    if (attempted) setMissing(validateProfile(next));
  }

  function submit(event) {
    event.preventDefault();
    const invalid = validateProfile(profile);
    setAttempted(true);
    setMissing(invalid);
    // INP-2: any unset input blocks entry to the chat.
    if (invalid.length === 0) onStart(profile);
  }

  return (
    <form onSubmit={submit}>
      <p className="notice">
        <strong>Before you start.</strong> {DISCLAIMER} Answers come from official scheme
        guideline documents, but this tool is not a substitute for them. Your four answers
        below stay in this browser tab and are never stored.
      </p>

      {PROFILE_FIELDS.map((field) => {
        const isMissing = missing.includes(field.key);
        return (
          <fieldset key={field.key} className={isMissing ? 'invalid' : undefined}>
            <legend>{field.legend}</legend>
            <div className="options">
              {field.options.map((option) => (
                <label className="option" key={option}>
                  <input
                    type="radio"
                    name={field.key}
                    value={option}
                    checked={profile[field.key] === option}
                    onChange={() => choose(field.key, option)}
                  />
                  {field.labels?.[option] ?? option}
                </label>
              ))}
            </div>
            {isMissing && <p className="field-error">Pick one to continue.</p>}
          </fieldset>
        );
      })}

      <button type="submit">Start chat</button>
      {attempted && missing.length > 0 && (
        <p className="field-error">
          All four are required — {missing.length} still unanswered.
        </p>
      )}
    </form>
  );
}

function Chat({ profile, onStartOver }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(text) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_message: text,
          profile,
          conversation: messages,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Something went wrong.');

      // RAG-6: both sides of the exchange are appended, so the next request carries
      // the history. Only committed on success — see REL-2 below.
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: data.answer },
      ]);
      setInput('');
    } catch (err) {
      // REL-2: the typed message stays in the box so a retry costs nothing.
      setError(err.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    send(text);
  }

  const summary = `${profile.course_level} · ${profile.category} · ${profile.income_band} · ${profile.stage}`;

  return (
    <>
      <div className="chat-header">
        {/* INP-5: the profile is shown but not editable. "Start over" is the only path. */}
        <span className="profile-summary">{summary}</span>
        <button type="button" className="secondary" onClick={onStartOver}>
          Start over
        </button>
      </div>

      <div className="messages">
        {messages.length === 0 && !busy && (
          <p className="empty">
            Ask anything about these scholarship schemes — eligibility, amounts, renewal
            rules, documents required.
          </p>
        )}
        {messages.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>
            <span className="who">{m.role === 'user' ? 'You' : 'Assistant'}</span>
            {m.content}
          </div>
        ))}
        {busy && <p className="empty">Thinking…</p>}
        {error && (
          <div className="error">
            <span>{error}</span>
            <button type="button" onClick={() => send(input.trim())} disabled={busy}>
              Retry
            </button>
          </div>
        )}
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </>
  );
}

export default function Home() {
  const [profile, setProfile] = useState(null);

  // INP-4: clearing the profile unmounts Chat, which discards the entire
  // conversation with it — back to an empty form.
  return (
    <main className="shell">
      <h1>Scholarship Assistant</h1>
      <p className="tagline">
        Questions about Indian government scholarship schemes, answered from their
        official guideline documents.
      </p>

      {profile ? (
        <Chat profile={profile} onStartOver={() => setProfile(null)} />
      ) : (
        <ProfileForm onStart={setProfile} />
      )}

      {/* REL-5: persistent, visible on both screens. */}
      <p className="disclaimer">{DISCLAIMER}</p>
    </main>
  );
}
