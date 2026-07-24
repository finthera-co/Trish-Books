import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check } from "lucide-react";

/* ────────────────────────────────────────────────────────────────
   Public marketing page at "/". Always the first paint — it never
   waits on the auth session and never redirects, so visitors and
   signed-in users alike land here. Colours are hard-coded rather
   than theme tokens so a tenant's custom palette never repaints
   the public page.
   ──────────────────────────────────────────────────────────────── */

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Counts up to `to` once, then holds. Skipped entirely for reduced motion. */
function useCountUp(to: number, duration = 1100, delay = 400) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? to : 0));

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let frame = 0;
    const start = performance.now() + delay;
    const tick = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      // easeOutExpo — fast settle, like a total snapping into place
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setValue(to * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, duration, delay]);

  return value;
}

/**
 * Reveals children on first scroll into view. Content renders visible by
 * default and is only hidden once JS has armed the animation, so a failed
 * observer can never leave a section blank.
 */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    el.classList.add("lp-armed");
    const show = () => el.classList.add("is-visible");

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          show();
          io.disconnect();
        }
      },
      { threshold: 0, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);

    // Safety net: never leave a section hidden if the observer stays quiet.
    const timer = window.setTimeout(show, 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return ref;
}

const money = (n: number) =>
  n.toLocaleString("en-LK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* The sample entry driving the hero ledger — VAT-inclusive services invoice. */
const ENTRY = [
  { code: "1200", name: "Accounts Receivable", debit: 486000, credit: 0 },
  { code: "4100", name: "Consulting Income", debit: 0, credit: 450000 },
  { code: "2310", name: "VAT Payable", debit: 0, credit: 36000 },
];
const ENTRY_TOTAL = 486000;

/* Sections keyed by the account-code range they actually post to. */
const LEDGER_MAP = [
  {
    code: "1000",
    klass: "Assets",
    heading: "Cash you can trace",
    body: "Import a bank statement, let the rules engine categorise it, and reconcile against posted entries. Fixed assets carry their own register, categories and depreciation runs.",
    items: ["Bank statement import", "Reconciliation", "Asset register", "Depreciation runs"],
  },
  {
    code: "2000",
    klass: "Liabilities",
    heading: "What you owe, aged",
    body: "Bills, payment vouchers and petty cash all land in the same payables ledger, with AP ageing buckets that tie back to the control account.",
    items: ["Bills", "Payment vouchers", "AP ageing", "Petty cash"],
  },
  {
    code: "3000",
    klass: "Equity",
    heading: "Opening balances that close",
    body: "Bring in history through the opening balance equity account, then clear it. Fiscal periods lock once closed, so a prior month cannot quietly change.",
    items: ["Opening balances", "OBE clearing", "Fiscal period locks", "Journal approvals"],
  },
  {
    code: "4000",
    klass: "Income",
    heading: "From quote to receipt",
    body: "Quotes become invoices, invoices become receipts, and every one of them posts a journal entry. Customer statements read straight from the ledger.",
    items: ["Quotes", "Invoices", "Receipts", "Customer statements"],
  },
  {
    code: "5000",
    klass: "Expenses",
    heading: "Every cost, coded",
    body: "Expense claims, payroll runs and attendance feed the same chart of accounts, mapped once through posting profiles.",
    items: ["Expense claims", "Payroll", "Attendance", "Posting profiles"],
  },
];

const CONTROLS = [
  ["Audit trail", "Every posting, edit and approval is recorded against a user and a timestamp."],
  ["Period locks", "Closed periods reject new entries until an admin reopens them."],
  ["Role-based access", "Company admins, accountants and employees each see only their own ledger."],
  ["Two-factor sign-in", "TOTP step-up on every session, enforced before the app loads."],
];

export default function Landing() {
  const debits = useCountUp(ENTRY_TOTAL);
  const credits = useCountUp(ENTRY_TOTAL, 1100, 550);
  const mapRef = useReveal<HTMLDivElement>();
  const controlsRef = useReveal<HTMLDivElement>();

  return (
    <div className="lp min-h-screen bg-[#0B2E21] text-[#E7F4EB] antialiased overflow-x-hidden">
      <style>{css}</style>

      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="lp-header">
        <div className="lp-shell flex items-center justify-between py-5">
          <div className="flex items-center gap-2.5">
            <span className="lp-mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <span className="font-serif text-[1.35rem] leading-none tracking-tight">Finthera</span>
          </div>
          <Link to="/login" className="lp-btn lp-btn-sm">
            Log in
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </header>

      <main>
        {/* ── Hero: the claim on the debit side, the proof on the credit side ── */}
        <section className="lp-shell lp-hero">
          <div className="lp-hero-copy">
            <p className="lp-eyebrow lp-fade" style={{ animationDelay: "60ms" }}>
              Double-entry accounting · Sri Lanka
            </p>
            <h1 className="lp-h1 lp-fade" style={{ animationDelay: "140ms" }}>
              Every rupee,
              <br />
              on <em>both</em> sides
              <br />
              of the ledger.
            </h1>
            <p className="lp-lede lp-fade" style={{ animationDelay: "240ms" }}>
              Finthera runs the invoices, bank feeds, payroll and period close for your company
              on one posted trail — from the source document all the way to the trial balance.
            </p>
            <div className="lp-fade lp-cta-row" style={{ animationDelay: "340ms" }}>
              <Link to="/login" className="lp-btn lp-btn-lg">
                Log in
                <ArrowRight className="w-4 h-4" />
              </Link>
              <p className="lp-note">
                Access is by company account.
                <br />
                Ask your administrator for an invite.
              </p>
            </div>
          </div>

          {/* Signature element: a journal entry that posts and balances itself. */}
          <div className="lp-ledger lp-fade" style={{ animationDelay: "300ms" }}>
            <div className="lp-ledger-head">
              <span className="lp-mono lp-ledger-ref">JV-2026-0418</span>
              <span className="lp-ledger-status">
                <Check className="w-3 h-3" strokeWidth={3} />
                Posted
              </span>
            </div>

            <p className="lp-ledger-title">Invoice to Ceylon Robotics (Pvt) Ltd</p>

            <div className="lp-ledger-cols lp-mono">
              <span>Account</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
            </div>

            <ol className="lp-rows">
              {ENTRY.map((line, i) => (
                <li
                  key={line.code}
                  className="lp-row lp-row-in"
                  style={{ animationDelay: `${520 + i * 150}ms` }}
                >
                  <span className="lp-acct">
                    <span className="lp-mono lp-code">{line.code}</span>
                    {line.name}
                  </span>
                  <span className="lp-mono lp-num">{line.debit ? money(line.debit) : "—"}</span>
                  <span className="lp-mono lp-num">{line.credit ? money(line.credit) : "—"}</span>
                </li>
              ))}
            </ol>

            <div className="lp-totals lp-mono">
              <span>Totals</span>
              <span className="lp-num lp-num-strong">{money(debits)}</span>
              <span className="lp-num lp-num-strong">{money(credits)}</span>
            </div>

            <div className="lp-balance">
              <span className="lp-mono">Difference</span>
              <span className="lp-balance-value lp-mono">
                <Check className="w-3.5 h-3.5" strokeWidth={3} />
                0.00
              </span>
            </div>
          </div>
        </section>

        {/* ── The rule that runs the product ───────────────────── */}
        <section className="lp-shell">
          <p className="lp-axiom">
            <span className="lp-mono lp-axiom-eq">Σ debits = Σ credits</span>
            Nothing saves until it balances. Nothing posts twice. Nothing disappears.
          </p>
        </section>

        {/* ── Capabilities, organised by the account range they post to ── */}
        <section className="lp-shell lp-section" ref={mapRef}>
          <header className="lp-section-head">
            <p className="lp-eyebrow">Chart of accounts</p>
            <h2 className="lp-h2">The whole company, filed where it belongs</h2>
          </header>

          <div className="lp-map">
            {LEDGER_MAP.map((group, i) => (
              <article key={group.code} className="lp-group" style={{ transitionDelay: `${i * 70}ms` }}>
                <div className="lp-group-key">
                  <span className="lp-mono lp-group-code">{group.code}</span>
                  <span className="lp-mono lp-group-class">{group.klass}</span>
                </div>
                <div className="lp-group-body">
                  <h3 className="lp-h3">{group.heading}</h3>
                  <p className="lp-body">{group.body}</p>
                  <ul className="lp-chips lp-mono">
                    {group.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── Controls ─────────────────────────────────────────── */}
        <section className="lp-shell lp-section" ref={controlsRef}>
          <header className="lp-section-head">
            <p className="lp-eyebrow">Controls</p>
            <h2 className="lp-h2">Built to survive an audit</h2>
          </header>

          <dl className="lp-controls">
            {CONTROLS.map(([term, desc], i) => (
              <div key={term} className="lp-control" style={{ transitionDelay: `${i * 70}ms` }}>
                <dt>{term}</dt>
                <dd>{desc}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── Close ────────────────────────────────────────────── */}
        <section className="lp-shell lp-closing">
          <h2 className="lp-h2 lp-closing-h">Your books are waiting.</h2>
          <Link to="/login" className="lp-btn lp-btn-lg">
            Log in
            <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-shell flex flex-wrap items-center justify-between gap-4 py-8">
          <div className="flex items-center gap-2.5">
            <span className="lp-mark lp-mark-sm" aria-hidden="true">
              <span />
              <span />
            </span>
            <span className="font-serif text-base">Finthera</span>
          </div>
          <p className="lp-mono text-xs text-[#7FB79B]">
            © {new Date().getFullYear()} Finthera · Accounting software
          </p>
        </div>
      </footer>
    </div>
  );
}

/* Scoped to `.lp` so nothing here leaks into the authenticated app. */
const css = `
.lp {
  --canvas: #0B2E21;
  --deep: #071E15;
  --panel: #103A2B;
  --paper: #EAF4EC;
  --mint: #9FE3BE;
  --emerald: #34A06A;
  --dim: #7FB79B;
  --rule: rgba(159, 227, 190, 0.16);
  font-family: var(--font-sans);
  background-image:
    radial-gradient(60rem 40rem at 82% -8%, rgba(52, 160, 106, 0.22), transparent 62%),
    radial-gradient(44rem 34rem at -6% 34%, rgba(159, 227, 190, 0.09), transparent 60%);
  background-repeat: no-repeat;
}
.lp .lp-shell { width: 100%; max-width: 74rem; margin-inline: auto; padding-inline: 1.5rem; }
.lp .lp-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.lp .font-serif { font-family: var(--font-serif); }

/* Mark: two stacked bars — the debit and credit column */
.lp .lp-mark { display: inline-flex; flex-direction: column; justify-content: center; gap: 3px; width: 1.65rem; height: 1.65rem; }
.lp .lp-mark > span { display: block; height: 4px; border-radius: 2px; background: var(--mint); }
.lp .lp-mark > span:last-child { width: 62%; background: var(--emerald); }
.lp .lp-mark-sm { width: 1.3rem; height: 1.3rem; gap: 2px; }
.lp .lp-mark-sm > span { height: 3px; }

.lp .lp-header { position: sticky; top: 0; z-index: 20; backdrop-filter: blur(12px); background: rgba(11, 46, 33, 0.78); border-bottom: 1px solid var(--rule); }

/* Buttons */
.lp .lp-btn { display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 999px; background: var(--mint); color: #06241A; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; transition: transform 160ms ease, box-shadow 160ms ease, background-color 160ms ease; }
.lp .lp-btn:hover { background: #B6EDCD; transform: translateY(-1px); box-shadow: 0 10px 26px -12px rgba(159, 227, 190, 0.8); }
.lp .lp-btn:focus-visible { outline: 2px solid var(--mint); outline-offset: 3px; }
.lp .lp-btn-sm { padding: 0.5rem 1rem; font-size: 0.875rem; }
.lp .lp-btn-lg { padding: 0.85rem 1.6rem; font-size: 1rem; }

/* Hero */
.lp .lp-hero { display: grid; grid-template-columns: 1fr; gap: 3.5rem; padding-block: clamp(3.5rem, 9vw, 7rem) clamp(3rem, 7vw, 5.5rem); align-items: center; }
.lp .lp-hero > * { min-width: 0; }
@media (min-width: 62rem) { .lp .lp-hero { grid-template-columns: 1.05fr 1fr; gap: 4.5rem; } }
.lp .lp-eyebrow { font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--mint); margin-bottom: 1.25rem; }
.lp .lp-h1 { font-family: var(--font-serif); font-weight: 500; font-size: clamp(2.5rem, 6.4vw, 4.15rem); line-height: 1.03; letter-spacing: -0.03em; color: #F2FBF5; }
.lp .lp-h1 em { font-style: italic; color: var(--mint); }
.lp .lp-lede { margin-top: 1.5rem; max-width: 34rem; font-size: 1.0625rem; line-height: 1.65; color: #BEDCCB; }
.lp .lp-cta-row { margin-top: 2.25rem; display: flex; flex-wrap: wrap; align-items: center; gap: 1.25rem 1.75rem; }
.lp .lp-note { font-size: 0.8125rem; line-height: 1.5; color: var(--dim); }

/* Ledger card — the one bright object on the page */
.lp .lp-ledger { background: var(--paper); color: #0B2E21; border-radius: 1.25rem; padding: 1.5rem 1.5rem 1.25rem; box-shadow: 0 40px 80px -40px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(11, 46, 33, 0.08); }
.lp .lp-ledger-head { display: flex; align-items: center; justify-content: space-between; }
.lp .lp-ledger-ref { font-size: 0.75rem; letter-spacing: 0.06em; color: #4A7A62; }
.lp .lp-ledger-status { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #1B7A4C; background: rgba(52, 160, 106, 0.14); border-radius: 999px; padding: 0.25rem 0.6rem; }
.lp .lp-ledger-title { margin-top: 0.85rem; font-family: var(--font-serif); font-size: 1.2rem; letter-spacing: -0.015em; }
.lp .lp-ledger-cols, .lp .lp-row, .lp .lp-totals { display: grid; grid-template-columns: minmax(0, 1fr) 6.5rem 6.5rem; gap: 0.75rem; align-items: baseline; }
.lp .lp-ledger-cols { margin-top: 1.35rem; padding-bottom: 0.5rem; border-bottom: 1.5px solid rgba(11, 46, 33, 0.22); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: #4A7A62; }
.lp .lp-rows { margin: 0; padding: 0; list-style: none; }
.lp .lp-row { padding-block: 0.7rem; border-bottom: 1px solid rgba(11, 46, 33, 0.09); font-size: 0.875rem; }
.lp .lp-acct { display: flex; align-items: baseline; gap: 0.55rem; min-width: 0; }
.lp .lp-code { font-size: 0.75rem; color: #4A7A62; }
.lp .lp-num { text-align: right; font-size: 0.8125rem; }
.lp .lp-totals { padding-top: 0.8rem; font-size: 0.8125rem; color: #4A7A62; }
.lp .lp-num-strong { color: #0B2E21; font-weight: 700; font-size: 0.9375rem; }
.lp .lp-balance { margin-top: 0.9rem; padding-top: 0.85rem; border-top: 1.5px solid rgba(11, 46, 33, 0.22); display: flex; align-items: center; justify-content: space-between; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: #4A7A62; }
.lp .lp-balance-value { display: inline-flex; align-items: center; gap: 0.35rem; color: #1B7A4C; font-weight: 700; letter-spacing: 0.04em; }
@media (max-width: 30rem) {
  .lp .lp-ledger { padding: 1.15rem 1.15rem 1rem; }
  .lp .lp-ledger-cols, .lp .lp-row, .lp .lp-totals { grid-template-columns: minmax(0, 1fr) 4.9rem 4.9rem; gap: 0.4rem; }
  .lp .lp-acct { flex-wrap: wrap; gap: 0.35rem; }
  .lp .lp-row { font-size: 0.8125rem; }
  .lp .lp-num { font-size: 0.75rem; }
  .lp .lp-num-strong { font-size: 0.8125rem; }
}

/* Axiom line */
.lp .lp-axiom { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding-block: 1.75rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1.5rem; font-size: 1.0625rem; color: #BEDCCB; }
.lp .lp-axiom-eq { font-size: 0.8125rem; letter-spacing: 0.08em; color: var(--mint); border: 1px solid var(--rule); border-radius: 999px; padding: 0.3rem 0.75rem; }

/* Sections */
.lp .lp-section { padding-block: clamp(3rem, 6vw, 4.5rem); }
.lp .lp-section + .lp-section { padding-top: clamp(2.5rem, 5vw, 4rem); }
.lp .lp-section-head { margin-bottom: 2.75rem; }
.lp .lp-h2 { font-family: var(--font-serif); font-weight: 500; font-size: clamp(1.9rem, 3.8vw, 2.7rem); line-height: 1.12; letter-spacing: -0.025em; color: #F2FBF5; max-width: 22ch; }
.lp .lp-h3 { font-family: var(--font-serif); font-size: 1.3rem; letter-spacing: -0.015em; color: #F2FBF5; }
.lp .lp-body { margin-top: 0.6rem; font-size: 0.9375rem; line-height: 1.62; color: #A8CCB8; max-width: 46rem; }

/* Account groups — ruled like a ledger sheet */
.lp .lp-group { display: grid; grid-template-columns: 1fr; gap: 0.85rem; padding-block: 1.75rem; border-top: 1px solid var(--rule); }
.lp .lp-group:last-child { border-bottom: 1px solid var(--rule); }
.lp .lp-armed .lp-group { opacity: 0; transform: translateY(14px); transition: opacity 600ms ease, transform 600ms ease; }
.lp .lp-armed.is-visible .lp-group { opacity: 1; transform: none; }
@media (min-width: 48rem) { .lp .lp-group { grid-template-columns: 10rem 1fr; gap: 2.5rem; } }
.lp .lp-group-key { display: flex; align-items: baseline; gap: 0.75rem; }
.lp .lp-group-code { font-size: 1.5rem; font-weight: 700; color: var(--mint); letter-spacing: -0.02em; }
.lp .lp-group-class { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); }
.lp .lp-chips { margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.45rem; list-style: none; padding: 0; }
.lp .lp-chips li { font-size: 0.7rem; letter-spacing: 0.04em; color: #CDE8D9; background: rgba(159, 227, 190, 0.08); border: 1px solid var(--rule); border-radius: 999px; padding: 0.3rem 0.7rem; }

/* Controls */
.lp .lp-controls { display: grid; grid-template-columns: 1fr; gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 1rem; overflow: hidden; }
@media (min-width: 48rem) { .lp .lp-controls { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-control { background: var(--deep); padding: 1.6rem 1.5rem; }
.lp .lp-armed .lp-control { opacity: 0; transform: translateY(14px); transition: opacity 600ms ease, transform 600ms ease; }
.lp .lp-armed.is-visible .lp-control { opacity: 1; transform: none; }
.lp .lp-control dt { font-size: 0.95rem; font-weight: 600; color: #F2FBF5; letter-spacing: -0.01em; }
.lp .lp-control dd { margin: 0.45rem 0 0; font-size: 0.875rem; line-height: 1.6; color: #A8CCB8; }

/* Close */
.lp .lp-closing { padding-block: clamp(3.5rem, 8vw, 6.5rem); display: flex; flex-direction: column; align-items: flex-start; gap: 1.75rem; border-top: 1px solid var(--rule); }
.lp .lp-closing-h { max-width: none; }
.lp .lp-footer { border-top: 1px solid var(--rule); background: var(--deep); }

/* Motion */
@keyframes lp-fade-up { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes lp-row-in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.lp .lp-fade { opacity: 0; animation: lp-fade-up 700ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.lp .lp-row-in { opacity: 0; animation: lp-row-in 520ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }

@media (prefers-reduced-motion: reduce) {
  .lp .lp-fade, .lp .lp-row-in { animation: none; opacity: 1; transform: none; }
  .lp .lp-armed .lp-group, .lp .lp-armed .lp-control { opacity: 1; transform: none; transition: none; }
  .lp .lp-btn:hover { transform: none; }
}
`;
