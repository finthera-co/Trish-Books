import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MessageCircle, X, ArrowRight, CornerDownLeft } from "lucide-react";

/**
 * Getting-started assistant for the public site.
 *
 * Deliberately not model-backed. This thing answers questions about how to obtain
 * an account, and getting that wrong costs a signup — so every answer here is a
 * fact about the real flow rather than something generated at request time. It also
 * means no unauthenticated endpoint to a paid API on a public page, no latency, and
 * nothing to abuse.
 *
 * Matching is keyword scoring over a curated set. When nothing scores, it says so
 * and offers the topics it does know instead of guessing.
 *
 * KEEP IN SYNC: if the signup or login flow changes, these answers must change with
 * it. They describe the approval queue introduced in 20260730000001_signup_requests.
 */

type Answer = {
  id: string;
  /** Shown as a suggested question when relevant. */
  question: string;
  /** Terms that point at this answer; matched case-insensitively as substrings. */
  keys: string[];
  body: React.ReactNode;
  /** Follow-ups to offer after answering. */
  next?: string[];
};

const ANSWERS: Answer[] = [
  {
    id: "signup",
    question: "How do I get an account?",
    keys: ["sign up", "signup", "register", "get an account", "create an account", "new account", "join", "apply", "get started", "start"],
    body: (
      <>
        <p>You request one, and we set it up for you. Three steps:</p>
        <ol>
          <li>Fill in the request form — your name, company and work email. No card, no password.</li>
          <li>Our team reviews it.</li>
          <li>When it's approved you get an email with a link to set your own password.</li>
        </ol>
        <p>Then you sign in and your company is already provisioned, with a chart of accounts ready to use.</p>
      </>
    ),
    next: ["why-approval", "how-long", "what-info"],
  },
  {
    id: "why-approval",
    question: "Why can't I sign up instantly?",
    keys: ["instant", "why approval", "why do i have to wait", "why review", "approve", "approval", "manual", "why not"],
    body: (
      <>
        <p>We don't take card payments online yet, so every company account is set up by hand.</p>
        <p>It means a person checks your details and provisions the company properly — you're not left configuring a blank system on your own.</p>
      </>
    ),
    next: ["how-long", "cost"],
  },
  {
    id: "how-long",
    question: "How long does approval take?",
    keys: ["how long", "how quick", "when will", "wait", "take", "turnaround", "time"],
    body: (
      <>
        <p>Most requests are reviewed within one business day.</p>
        <p>You'll get an email the moment it's approved — nothing else is needed from you in the meantime.</p>
      </>
    ),
    next: ["no-email", "login"],
  },
  {
    id: "what-info",
    question: "What details do I need to give?",
    keys: ["what info", "what details", "what do i need", "required", "form", "fields", "documents"],
    body: (
      <>
        <p>Your name, company name and a work email. Phone and team size are optional but help us set the company up correctly.</p>
        <p>No card details, and no password — you choose that yourself after approval.</p>
      </>
    ),
    next: ["signup", "cost"],
  },
  {
    id: "login",
    question: "I've been approved — how do I sign in?",
    keys: ["log in", "login", "sign in", "signin", "approved", "set password", "first time", "access"],
    body: (
      <>
        <p>Your approval email contains a link to set your password. Open it, choose a password, and you'll be signed in.</p>
        <p>After that, sign in at any time with your email address and that password.</p>
      </>
    ),
    next: ["no-email", "forgot", "first-steps"],
  },
  {
    id: "forgot",
    question: "I've forgotten my password",
    keys: ["forgot", "reset", "lost password", "can't log in", "cant log in", "locked out", "wrong password"],
    body: (
      <>
        <p>Use "Forgot password" on the sign-in page. You'll get an email with a link to set a new one.</p>
        <p>If your original set-password link has expired, use the same route — it issues a fresh one.</p>
      </>
    ),
    next: ["login"],
  },
  {
    id: "no-email",
    question: "I didn't get the email",
    keys: ["no email", "didn't get", "didnt get", "not received", "spam", "junk", "missing email", "never arrived"],
    body: (
      <>
        <p>Check your spam or junk folder first — approval emails sometimes land there.</p>
        <p>If it still hasn't arrived, your request may not have been reviewed yet. If it's been more than a business day, reply to your request confirmation and we'll look into it.</p>
      </>
    ),
    next: ["how-long", "login"],
  },
  {
    id: "cost",
    question: "What does it cost?",
    keys: ["cost", "price", "pricing", "how much", "free", "plan", "trial", "card", "payment", "pay"],
    body: (
      <>
        <p>There's a free tier with one user and one company, and it includes the full double-entry ledger. No card is needed for it.</p>
        <p>Paid plans start at LKR 2,900/mo, and launch pricing is currently discounted. Every tier is on the pricing section of this page.</p>
      </>
    ),
    next: ["signup", "why-approval"],
  },
  {
    id: "first-steps",
    question: "What happens once I'm in?",
    keys: ["what next", "once i", "after login", "first steps", "setup", "set up", "onboard", "import", "bank statement", "chart of accounts"],
    body: (
      <>
        <p>Your company arrives already provisioned. From there it's three things:</p>
        <ol>
          <li>Check your chart of accounts — it's seeded, not blank, and you can extend it.</li>
          <li>Import a bank statement. The rules engine categorises and posts it.</li>
          <li>Run the trial balance and confirm it ties.</li>
        </ol>
      </>
    ),
    next: ["cost"],
  },
  {
    id: "existing-books",
    question: "Can I bring my existing books across?",
    keys: ["existing", "migrate", "migration", "import old", "historical", "opening balance", "move from", "quickbooks", "current system"],
    body: (
      <>
        <p>Yes. Opening balances go in through the opening balance equity account, which you then clear — so history arrives without unbalancing anything.</p>
        <p>Mention what you're moving from in the notes on the request form and we'll set it up with you.</p>
      </>
    ),
    next: ["signup", "what-info"],
  },
];

/** Topics offered when a question doesn't match anything. */
const FALLBACK_IDS = ["signup", "login", "cost", "how-long"];

const byId = (id: string) => ANSWERS.find((a) => a.id === id);

/**
 * Score an utterance against the curated set. A key that appears as a phrase in the
 * question scores by its own length, so "forgot password" beats a stray "password".
 */
function match(input: string): Answer | null {
  const q = input.toLowerCase().trim();
  if (q.length < 2) return null;

  let best: { answer: Answer; score: number } | null = null;
  for (const answer of ANSWERS) {
    let score = 0;
    for (const key of answer.keys) {
      if (q.includes(key)) score += key.length;
    }
    if (score > 0 && (!best || score > best.score)) best = { answer, score };
  }
  return best?.answer ?? null;
}

type Turn =
  | { role: "bot"; id: string; body: React.ReactNode; suggestions: string[] }
  | { role: "user"; text: string };

const GREETING: Turn = {
  role: "bot",
  id: "greeting",
  body: (
    <>
      <p>Hello. I can explain how to get an account, how signing in works, and what happens once you're in.</p>
      <p>Ask me anything, or pick one of these:</p>
    </>
  ),
  suggestions: ["signup", "login", "cost", "how-long"],
};

export default function LandingChat() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([GREETING]);
  const [draft, setDraft] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    if (!open) return;
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const answer = (a: Answer, asked?: string) => {
    setTurns((t) => [
      ...t,
      { role: "user", text: asked ?? a.question },
      { role: "bot", id: a.id, body: a.body, suggestions: a.next ?? FALLBACK_IDS },
    ]);
  };

  const send = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setDraft("");

    const hit = match(q);
    if (hit) {
      answer(hit, q);
      return;
    }

    // No guessing. Say what it can't do, then offer what it can.
    setTurns((t) => [
      ...t,
      { role: "user", text: q },
      {
        role: "bot",
        id: "miss",
        body: (
          <>
            <p>I only know about getting started — accounts, signing in, and pricing. I don't have an answer for that one.</p>
            <p>Here's what I can help with:</p>
          </>
        ),
        suggestions: FALLBACK_IDS,
      },
    ]);
  };

  const unread = useMemo(() => !open && turns.length === 1, [open, turns.length]);

  return (
    <>
      <button
        type="button"
        className={`lp-chat-fab${open ? " is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="lp-chat-panel"
        aria-label={open ? "Close getting-started help" : "Open getting-started help"}
      >
        {open ? <X className="w-6 h-6" strokeWidth={2.5} /> : <MessageCircle className="w-6 h-6" strokeWidth={2.2} />}
        {unread && <span className="lp-chat-dot" aria-hidden="true" />}
      </button>

      <div
        id="lp-chat-panel"
        ref={panelRef}
        className={`lp-chat${open ? " is-open" : ""}`}
        role="dialog"
        aria-label="Getting started"
        aria-hidden={!open}
      >
        <header className="lp-chat-head">
          <span className="lp-chat-title">Getting started</span>
          <span className="lp-chat-sub">Accounts · signing in · pricing</span>
          <button type="button" className="lp-chat-x" onClick={() => setOpen(false)} aria-label="Close">
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </header>

        {/* polite, so answers are announced without interrupting */}
        <div className="lp-chat-log" ref={logRef} aria-live="polite">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p className="lp-chat-user" key={i}>{turn.text}</p>
            ) : (
              <div className="lp-chat-bot" key={i}>
                <div className="lp-chat-bubble">{turn.body}</div>
                {turn.suggestions.length > 0 && (
                  <div className="lp-chat-chips">
                    {turn.suggestions.map((id) => {
                      const a = byId(id);
                      if (!a) return null;
                      return (
                        <button key={id} type="button" className="lp-chat-chip" onClick={() => answer(a)}>
                          {a.question}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ),
          )}
        </div>

        <form
          className="lp-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about signing up…"
            aria-label="Ask a question"
            maxLength={200}
          />
          <button type="submit" aria-label="Send">
            <CornerDownLeft className="w-4 h-4" strokeWidth={2.5} />
          </button>
        </form>

        <div className="lp-chat-foot">
          <Link to="/signup" className="lp-chat-cta">
            Request your account
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <Link to="/login" className="lp-chat-alt">Sign in</Link>
        </div>
      </div>
    </>
  );
}
