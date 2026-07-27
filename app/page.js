'use client';

// The four-input form gates the chat (INP-1…5), the profile rides along with every
// request, and the conversation lives here and only here.
//
// INP-3 / NFR-2: profile and conversation are React state in this component. They are
// never written to localStorage, a cookie, or any server-side store — a refresh loses
// them, which is the intended behaviour. Nothing about the user is persisted.

import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  Compass,
  Flag,
  GraduationCap,
  Info,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  User,
  Users,
  Wallet,
} from 'lucide-react';

import { PROFILE_FIELDS, EMPTY_PROFILE, validateProfile } from '@/lib/profile.js';

const DISCLAIMER = 'Not official guidance. Verify on the scheme’s official page.';

// Presentation only — icon and colour per question. Keyed by the field keys defined
// in lib/profile.js, which stays the single source of truth for the options.
//
// Literal hex, deliberately, not `var(--royal)`: these are written to inline custom
// properties on the fieldset and read by a `:has()` rule on a descendant. A nested
// var() passed that way fails to substitute — the declarations reading it are dropped
// silently, which showed up as invisible white-on-white selected pills.
//
// `onPill` is not decoration: white on orange/amber is ~2.9:1 and fails WCAG AA, so
// those two selected states use dark ink instead. Blue and red are dark enough for white.
const FIELD_STYLE = {
  course_level: { icon: BookOpen, color: '#2563eb', onPill: '#ffffff' },
  category: { icon: Users, color: '#e11d48', onPill: '#ffffff' },
  income_band: { icon: Wallet, color: '#fbbf24', onPill: '#16182f' },
  stage: { icon: Flag, color: '#f97316', onPill: '#16182f' },
};

const SUGGESTIONS = [
  'What schemes are available for me?',
  'What are the income limits?',
  'Which documents do I need to apply?',
];

function Masthead() {
  return (
    <>
      <div className="masthead">
        <span className="crest" aria-hidden="true">
          <GraduationCap size={21} strokeWidth={2} />
        </span>
        <h1>
          Scholarship <span className="accent">Assistant</span>
        </h1>
      </div>
      <p className="tagline">Straight answers, from the official guidelines.</p>
    </>
  );
}

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
    <form onSubmit={submit} noValidate>
      {PROFILE_FIELDS.map((field, index) => {
        const isMissing = missing.includes(field.key);
        const style = FIELD_STYLE[field.key] ?? {};
        const Icon = style.icon ?? BookOpen;
        return (
          <fieldset
            key={field.key}
            className={`question${isMissing ? ' invalid' : ''}`}
            style={{ '--q-color': style.color, '--on-pill': style.onPill }}
          >
            <legend>
              <Icon size={19} strokeWidth={2.25} aria-hidden="true" />
              {field.legend}
              <span className="step">{index + 1} of {PROFILE_FIELDS.length}</span>
            </legend>
            <div className="options">
              {field.options.map((option) => (
                <label
                  className={`option${profile[field.key] === option ? ' is-selected' : ''}`}
                  key={option}
                >
                  <input
                    type="radio"
                    name={field.key}
                    value={option}
                    checked={profile[field.key] === option}
                    onChange={() => choose(field.key, option)}
                  />
                  <Check className="tick" size={15} strokeWidth={3} aria-hidden="true" />
                  {field.labels?.[option] ?? option}
                </label>
              ))}
            </div>
            {/* Error sits beside the field it belongs to, not in a summary at the top. */}
            {isMissing && (
              <p className="field-error" role="alert">
                <AlertCircle size={15} strokeWidth={2.5} aria-hidden="true" />
                Pick one to continue.
              </p>
            )}
          </fieldset>
        );
      })}

      <div className="start-row">
        <button type="submit">
          Start chatting
          <ArrowRight size={18} strokeWidth={2.5} aria-hidden="true" />
        </button>
        {attempted && missing.length > 0 ? (
          <span className="field-error" role="status" style={{ margin: 0 }}>
            {missing.length} still unanswered
          </span>
        ) : (
          <span className="hand">all four, then you’re in</span>
        )}
      </div>

      {/* REL-5: first-run notice. Sits below the form so it does not delay the task,
          but is still on screen the first time anyone lands here. */}
      <div className="notice">
        <Info size={16} strokeWidth={2.25} aria-hidden="true" />
        <div>
          <strong>Before you start.</strong> {DISCLAIMER} Answers are drawn from official
          scheme guideline documents, but this is not a substitute for them. Your four
          answers stay in this browser tab and are never stored.
        </div>
      </div>
    </form>
  );
}

function Chat({ profile, onStartOver }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The partial answer while tokens are still arriving. Held separately from
  // `messages` so a failed or cut-short stream never lands in the conversation.
  const [streaming, setStreaming] = useState('');
  // The message currently in flight. The composer is cleared the instant Send is
  // pressed, so this is what the in-flight bubble renders and what Retry re-sends —
  // and what gets put back in the composer if the request fails (REL-2).
  const [pending, setPending] = useState('');
  const endRef = useRef(null);
  const inputRef = useRef(null);

  // Keep the newest text in view as it streams, on a phone as much as on desktop.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, streaming, busy]);

  async function send(text) {
    setBusy(true);
    setError('');
    setStreaming('');
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

      // Failures before generation starts still arrive as a normal JSON error with a
      // real status code, so REL-2 behaves exactly as it did before streaming.
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Something went wrong.');
      }

      // REL-3: NDJSON — render each delta as it lands rather than waiting for the
      // whole answer.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let answer = '';

      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // The last element is whatever sits after the final newline — an incomplete
        // line — so it is kept in the buffer for the next read.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === 'delta') {
            answer += event.text;
            setStreaming(answer);
          } else if (event.type === 'error') {
            throw new Error(event.error);
          }
        }
      }

      if (!answer.trim()) throw new Error('The model returned an empty response. Try again.');

      // RAG-6: both sides of the exchange are appended, so the next request carries
      // the history. Only committed on success — see REL-2 below.
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: answer },
      ]);
      setPending('');
    } catch (err) {
      // REL-2: the composer was emptied on send, so hand the message back rather
      // than making the user retype it. Retry re-sends it either way.
      setError(err.message || 'Something went wrong.');
      setInput(text);
    } finally {
      setStreaming('');
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setPending(text);
    setInput('');
    send(text);
  }

  // Suggestions fill the composer rather than sending — a stray tap should never
  // spend a request against the free-tier quota.
  function applySuggestion(text) {
    setInput(text);
    inputRef.current?.focus();
  }

  const chips = [profile.course_level, profile.category, profile.income_band, profile.stage];

  return (
    <>
      <div className="chat-header">
        {/* INP-5: the profile is shown but not editable. "Start over" is the only path. */}
        <div className="chips" aria-label="Your profile">
          {chips.map((label) => (
            <span className="chip" key={label}>
              {label}
            </span>
          ))}
        </div>
        <span className="spacer" />
        <button type="button" className="secondary" onClick={onStartOver}>
          <RotateCcw size={15} strokeWidth={2.5} aria-hidden="true" />
          Start over
        </button>
      </div>

      <div className="messages">
        {messages.length === 0 && !busy && (
          <div className="empty">
            <span className="halo" aria-hidden="true">
              <Compass size={30} strokeWidth={2} />
            </span>
            <h2>Ask away</h2>
            <p>Eligibility, amounts, renewal rules, documents — anything in the guidelines.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  type="button"
                  className="suggestion"
                  key={s}
                  onClick={() => applySuggestion(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div className={`msg ${m.role}`} key={i}>
            <span className="who">
              {m.role === 'user' ? (
                <>
                  <User size={12} strokeWidth={2.5} aria-hidden="true" /> You
                </>
              ) : (
                <>
                  <Sparkles size={12} strokeWidth={2.5} aria-hidden="true" /> Assistant
                </>
              )}
            </span>
            {m.content}
          </div>
        ))}

        {/* REL-3: the in-flight turn. Shows the user's message immediately, then the
            answer as it streams — dots only until the first token lands. */}
        {busy && (
          <>
            <div className="msg user">
              <span className="who">
                <User size={12} strokeWidth={2.5} aria-hidden="true" /> You
              </span>
              {pending}
            </div>
            <div className="msg assistant">
              <span className="who">
                <Sparkles size={12} strokeWidth={2.5} aria-hidden="true" /> Assistant
              </span>
              {streaming || (
                <span className="dots" role="status" aria-label="Thinking">
                  <span />
                  <span />
                  <span />
                </span>
              )}
            </div>
          </>
        )}

        {error && (
          <div className="error" role="alert">
            <AlertCircle size={20} strokeWidth={2.25} aria-hidden="true" />
            <span className="msg-text">{error}</span>
            <button
              type="button"
              onClick={() => {
                setInput('');
                send(pending);
              }}
              disabled={busy || !pending}
            >
              <RotateCcw size={15} strokeWidth={2.5} aria-hidden="true" />
              Retry
            </button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={submit}>
        <label htmlFor="composer-input" className="sr-only" style={{ display: 'none' }}>
          Your question
        </label>
        <textarea
          id="composer-input"
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about eligibility, amounts, documents…"
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) submit(e);
          }}
        />
        <button type="submit" className="send" disabled={busy || !input.trim()} aria-label="Send message">
          <Send size={19} strokeWidth={2.5} aria-hidden="true" />
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
      <Masthead />

      {profile ? (
        <Chat profile={profile} onStartOver={() => setProfile(null)} />
      ) : (
        <ProfileForm onStart={setProfile} />
      )}

      {/* REL-5: persistent, visible on both screens. */}
      <p className="disclaimer">
        <ShieldAlert size={14} strokeWidth={2.25} aria-hidden="true" />
        {DISCLAIMER}
      </p>
    </main>
  );
}
