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

/* A real sequence — the order the work happens in, so the numbers mean something. */
const CLOSE_STEPS = [
  ["Capture", "Invoices, bills, expense claims and petty cash vouchers enter as documents, not as numbers typed twice."],
  ["Import", "Drop in the bank statement. The rules engine categorises what it recognises and refuses to guess at the rest."],
  ["Post", "Every approved document writes a balanced journal entry. Nothing reaches the ledger any other way."],
  ["Reconcile", "Statement lines are matched against posted entries until the bank agrees with the books."],
  ["Close", "The fiscal period locks. Opening balance equity is cleared, and a closed month stops moving."],
  ["Report", "Trial balance, statements and ageing read from the same posted entries you just closed."],
];

const REPORTS = [
  ["Trial Balance", "Debits against credits, account by account"],
  ["Income Statement", "Revenue, cost of goods sold, expenses, net income"],
  ["Balance Sheet", "Assets, liabilities and equity as at a date"],
  ["Cash Flow Statement", "Operating, investing and financing movements"],
  ["Aged Receivables", "Outstanding invoices by ageing bucket"],
  ["PPE Schedule", "Cost, depreciation and written-down value per IAS 16"],
  ["Budget vs Actual", "Variance against the budget you set"],
  ["Customer Statements", "Everything a customer owes, straight from the ledger"],
];

const LOCAL = [
  ["LKR first", "Amounts, statements and documents are kept in rupees, with foreign exchange handled where it applies."],
  ["VAT and WHT", "VAT on tax invoices, withholding tax on customer payments — both posted to their own control accounts."],
  ["Payroll statutories", "EPF and ETF, plus gratuity, staff loans and advances, all mapped to the chart of accounts."],
  ["Attendance and OT", "Attendance registers, biometric linking and overtime feed the payroll run that posts the entry."],
];

/* Finthera's three tiers, each deliberately set below the going rate for
   comparable accounting software in Sri Lanka. vsPrice is that going rate,
   as published in July 2026 — kept in one place so it's easy to refresh. */
const PLANS = [
  {
    name: "Starter",
    tag: "Sole traders & new companies",
    price: 2900,
    vsPrice: 3440,
    features: [
      "1 user + your accountant",
      "Invoices, quotes & receipts",
      "Bank statement import",
      "VAT & WHT tracking",
      "Trial balance & core statements",
    ],
  },
  {
    name: "Growth",
    tag: "Growing teams",
    price: 4400,
    popular: true,
    vsPrice: 5158,
    features: [
      "Up to 5 users",
      "Everything in Starter",
      "Payroll with EPF & ETF",
      "Bills & payment vouchers",
      "Multi-currency",
      "Aged receivables & payables",
    ],
  },
  {
    name: "Scale",
    tag: "Established businesses",
    price: 5900,
    vsPrice: 7034,
    features: [
      "Unlimited users",
      "Everything in Growth",
      "Fixed assets & depreciation",
      "Budgets & variance",
      "Attendance & biometric linking",
      "Audit trail & period locks",
    ],
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
  const stepsRef = useReveal<HTMLOListElement>();
  const reportsRef = useReveal<HTMLUListElement>();
  const controlsRef = useReveal<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Hold the poster frame instead of playing when motion is unwelcome.
  useEffect(() => {
    if (prefersReducedMotion()) videoRef.current?.pause();
  }, []);

  const scrollToPricing = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("pricing")?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <div className="lp min-h-screen text-[#08281B] antialiased">
      <style>{css}</style>

      {/* ── Announcement bar ────────────────────────────────── */}
      <a href="#pricing" onClick={scrollToPricing} className="lp-promo">
        <span className="lp-promo-badge">Launch offer</span>
        <span className="lp-promo-text">
          First 3 months at launch pricing — <strong>save up to 16%</strong> on what you pay now.
        </span>
        <span className="lp-promo-cta">
          See packages &amp; pricing
          <ArrowRight className="w-3.5 h-3.5" />
        </span>
      </a>

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
          <div className="flex items-center gap-2 sm:gap-5">
            <a href="#pricing" onClick={scrollToPricing} className="lp-navlink">
              Pricing
            </a>
            <Link to="/login" className="lp-btn lp-btn-sm">
              Log in
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero: the claim on the debit side, the proof on the credit side.
               An ambient green loop runs behind it, under a light scrim. ── */}
        <div className="lp-stage">
          <video
            ref={videoRef}
            className="lp-video"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster="/media/landing-poster.jpg"
            aria-hidden="true"
            tabIndex={-1}
          >
            <source src="/media/landing-loop.mp4" type="video/mp4" />
          </video>
          <div className="lp-scrim" aria-hidden="true" />

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
        </div>

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

        {/* ── The close cycle. Numbered because it genuinely is an order. ── */}
        <section className="lp-shell lp-section">
          <header className="lp-section-head">
            <p className="lp-eyebrow">The month, end to end</p>
            <h2 className="lp-h2">Six steps, and the books are closed</h2>
          </header>

          <ol className="lp-steps" ref={stepsRef}>
            {CLOSE_STEPS.map(([term, desc], i) => (
              <li key={term} className="lp-step" style={{ transitionDelay: `${i * 60}ms` }}>
                <span className="lp-mono lp-step-no">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3 className="lp-step-term">{term}</h3>
                  <p className="lp-body">{desc}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ── What the ledger produces ─────────────────────────── */}
        <section className="lp-shell lp-section">
          <header className="lp-section-head">
            <p className="lp-eyebrow">Reports</p>
            <h2 className="lp-h2">Statements, not spreadsheets</h2>
            <p className="lp-body lp-section-lede">
              Every report is generated from posted entries at the moment you ask for it, so two
              people running the same statement on the same date get the same numbers.
            </p>
          </header>

          <ul className="lp-reports" ref={reportsRef}>
            {REPORTS.map(([name, desc], i) => (
              <li key={name} className="lp-report" style={{ transitionDelay: `${i * 45}ms` }}>
                <h3>{name}</h3>
                <p>{desc}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Local specifics ──────────────────────────────────── */}
        <section className="lp-shell lp-section">
          <header className="lp-section-head">
            <p className="lp-eyebrow">Sri Lanka</p>
            <h2 className="lp-h2">Keeps the books the way they are kept here</h2>
          </header>

          <div className="lp-locale">
            {LOCAL.map(([term, desc]) => (
              <div key={term} className="lp-locale-item">
                <h3 className="lp-h3">{term}</h3>
                <p className="lp-body">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Pricing ──────────────────────────────────────────── */}
        <section id="pricing" className="lp-shell lp-section lp-pricing">
          <header className="lp-section-head">
            <p className="lp-eyebrow">Packages &amp; pricing</p>
            <h2 className="lp-h2">The same books, for less</h2>
            <p className="lp-body lp-section-lede">
              Every plan is the full double-entry system — no crippled starter tier. Priced in
              rupees, and set below what you'd pay elsewhere for the same books.
            </p>
          </header>

          <div className="lp-plans">
            {PLANS.map((plan) => (
              <article key={plan.name} className={`lp-plan${plan.popular ? " is-popular" : ""}`}>
                {plan.popular && <span className="lp-plan-flag">Most popular</span>}
                <h3 className="lp-plan-name">{plan.name}</h3>
                <p className="lp-plan-tag">{plan.tag}</p>

                <p className="lp-plan-price">
                  <span className="lp-plan-cur">LKR</span>
                  <span className="lp-plan-amt">{plan.price.toLocaleString("en-LK")}</span>
                  <span className="lp-plan-per">/mo</span>
                </p>
                <p className="lp-plan-vs">
                  <span className="lp-plan-was">LKR {plan.vsPrice.toLocaleString("en-LK")}</span>
                  elsewhere
                  <span className="lp-plan-save">
                    save {Math.round((1 - plan.price / plan.vsPrice) * 100)}%
                  </span>
                </p>

                <ul className="lp-plan-feats">
                  {plan.features.map((f) => (
                    <li key={f}>
                      <Check className="w-4 h-4" strokeWidth={2.5} />
                      {f}
                    </li>
                  ))}
                </ul>

                <Link
                  to="/login"
                  className={`lp-btn lp-btn-lg lp-plan-cta${plan.popular ? "" : " lp-btn-ghost"}`}
                >
                  Get started
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </article>
            ))}
          </div>

          <p className="lp-plans-note">
            Prices in Sri Lanka rupees. Launch pricing applies to your first three months.
          </p>
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
          <p className="lp-mono text-xs text-[#4A7360]">
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
  --ink: #08281B;
  --body: #3A6553;
  --muted: #4A7360;
  --emerald: #17845A;
  --bright: #24B573;
  --mint: #BFEBD3;
  --rule: rgba(13, 78, 53, 0.14);
  font-family: var(--font-sans);
  /* The page itself is the gradient: near-white at the top, deepening
     through mint into a soft green by the footer. */
  background-image:
    radial-gradient(58rem 38rem at 88% -12%, rgba(36, 181, 115, 0.26), transparent 62%),
    radial-gradient(46rem 34rem at -10% 24%, rgba(23, 132, 90, 0.14), transparent 64%),
    linear-gradient(180deg, #FFFFFF 0%, #F2FBF6 20%, #E3F5EC 56%, #CDEBDC 100%);
  background-repeat: no-repeat;
  /* clip, not hidden — hidden would create a scroll container and break the sticky header */
  overflow-x: clip;
}
.lp .lp-shell { width: 100%; max-width: 74rem; margin-inline: auto; padding-inline: 1.5rem; }

/* Hero stage — ambient video under a light scrim */
.lp .lp-stage { position: relative; isolation: isolate; overflow: hidden; }
.lp .lp-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; pointer-events: none; }
.lp .lp-scrim { position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image:
    radial-gradient(44rem 30rem at 24% 48%, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.42) 62%, transparent 80%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.74) 0%, rgba(255, 255, 255, 0.56) 40%, rgba(243, 251, 247, 0.88) 84%, #F1FAF5 100%); }
.lp .lp-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.lp .font-serif { font-family: var(--font-serif); }

/* Mark: two stacked bars — the debit and credit column */
.lp .lp-mark { display: inline-flex; flex-direction: column; justify-content: center; gap: 3px; width: 1.65rem; height: 1.65rem; }
.lp .lp-mark > span { display: block; height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--bright), #6FD9A6); }
.lp .lp-mark > span:last-child { width: 62%; background: var(--emerald); }
.lp .lp-mark-sm { width: 1.3rem; height: 1.3rem; gap: 2px; }
.lp .lp-mark-sm > span { height: 3px; }

.lp .lp-header { position: sticky; top: 0; z-index: 20; backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.74); border-bottom: 1px solid var(--rule); }

/* Buttons */
.lp .lp-btn { display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 999px; background-image: linear-gradient(135deg, #1FA671 0%, #12704C 100%); color: #FFFFFF; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; box-shadow: 0 10px 22px -12px rgba(16, 92, 63, 0.75); transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease; }
.lp .lp-btn:hover { filter: brightness(1.09); transform: translateY(-1px); box-shadow: 0 16px 30px -14px rgba(16, 92, 63, 0.85); }
.lp .lp-btn:focus-visible { outline: 2px solid #12704C; outline-offset: 3px; }
.lp .lp-btn-sm { padding: 0.5rem 1rem; font-size: 0.875rem; }
.lp .lp-btn-lg { padding: 0.85rem 1.6rem; font-size: 1rem; }
.lp .lp-btn-ghost { background-image: none; background-color: transparent; color: #12704C; box-shadow: inset 0 0 0 1.5px rgba(18, 112, 76, 0.4); }
.lp .lp-btn-ghost:hover { filter: none; background-color: rgba(18, 112, 76, 0.06); box-shadow: inset 0 0 0 1.5px rgba(18, 112, 76, 0.6); }

/* Announcement bar */
.lp .lp-promo { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 0.5rem 0.85rem; padding: 0.6rem 1.25rem; text-align: center; color: #EAFBF1; text-decoration: none; background-image: linear-gradient(90deg, #0F3D2A 0%, #17724E 52%, #23A96F 100%); }
.lp .lp-promo-badge { font-family: var(--font-mono); font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #0C3A28; background: #BFEBD3; border-radius: 999px; padding: 0.2rem 0.55rem; }
.lp .lp-promo-text { font-size: 0.8125rem; }
.lp .lp-promo-text strong { color: #FFFFFF; font-weight: 700; }
.lp .lp-promo-cta { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.8125rem; font-weight: 600; color: #FFFFFF; }
.lp .lp-promo:hover .lp-promo-cta { text-decoration: underline; text-underline-offset: 3px; }
.lp .lp-promo:focus-visible { outline: 2px solid #BFEBD3; outline-offset: -2px; }

/* Header nav link */
.lp .lp-navlink { font-size: 0.875rem; font-weight: 600; color: var(--body); text-decoration: none; padding: 0.35rem 0.15rem; }
.lp .lp-navlink:hover { color: var(--emerald); }
.lp .lp-navlink:focus-visible { outline: 2px solid #12704C; outline-offset: 3px; border-radius: 4px; }

/* Hero */
.lp .lp-hero { display: grid; grid-template-columns: 1fr; gap: 3.5rem; padding-block: clamp(3.5rem, 9vw, 7rem) clamp(3rem, 7vw, 5.5rem); align-items: center; }
.lp .lp-hero > * { min-width: 0; }
@media (min-width: 62rem) { .lp .lp-hero { grid-template-columns: 1.05fr 1fr; gap: 4.5rem; } }
.lp .lp-eyebrow { font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--emerald); margin-bottom: 1.25rem; }
.lp .lp-h1 { font-family: var(--font-serif); font-weight: 500; font-size: clamp(2.5rem, 6.4vw, 4.15rem); line-height: 1.03; letter-spacing: -0.03em; color: var(--ink); }
.lp .lp-h1 em { font-style: italic; background-image: linear-gradient(100deg, #1FA671 0%, #4FCB93 55%, #12704C 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.lp .lp-lede { margin-top: 1.5rem; max-width: 34rem; font-size: 1.0625rem; line-height: 1.65; color: var(--body); }
.lp .lp-cta-row { margin-top: 2.25rem; display: flex; flex-wrap: wrap; align-items: center; gap: 1.25rem 1.75rem; }
.lp .lp-note { font-size: 0.8125rem; line-height: 1.5; color: var(--muted); }

/* Ledger card — the one deep object on a light page */
.lp .lp-ledger { background-image: linear-gradient(158deg, #0F3D2A 0%, #17724E 58%, #1E9463 100%); color: #DDF1E5; border-radius: 1.25rem; padding: 1.5rem 1.5rem 1.25rem; box-shadow: 0 36px 68px -34px rgba(9, 60, 40, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.09); }
.lp .lp-ledger-head { display: flex; align-items: center; justify-content: space-between; }
.lp .lp-ledger-ref { font-size: 0.75rem; letter-spacing: 0.06em; color: #93CFB0; }
.lp .lp-ledger-status { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #C6F0DA; background: rgba(191, 235, 211, 0.18); border-radius: 999px; padding: 0.25rem 0.6rem; }
.lp .lp-ledger-title { margin-top: 0.85rem; font-family: var(--font-serif); font-size: 1.2rem; letter-spacing: -0.015em; color: #F3FCF7; }
.lp .lp-ledger-cols, .lp .lp-row, .lp .lp-totals { display: grid; grid-template-columns: minmax(0, 1fr) 6.5rem 6.5rem; gap: 0.75rem; align-items: baseline; }
.lp .lp-ledger-cols { margin-top: 1.35rem; padding-bottom: 0.5rem; border-bottom: 1.5px solid rgba(191, 235, 211, 0.3); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: #93CFB0; }
.lp .lp-rows { margin: 0; padding: 0; list-style: none; }
.lp .lp-row { padding-block: 0.7rem; border-bottom: 1px solid rgba(191, 235, 211, 0.15); font-size: 0.875rem; color: #E4F6EA; }
.lp .lp-acct { display: flex; align-items: baseline; gap: 0.55rem; min-width: 0; }
.lp .lp-code { font-size: 0.75rem; color: #93CFB0; }
.lp .lp-num { text-align: right; font-size: 0.8125rem; }
.lp .lp-totals { padding-top: 0.8rem; font-size: 0.8125rem; color: #A8DCC1; }
.lp .lp-num-strong { color: #FFFFFF; font-weight: 700; font-size: 0.9375rem; }
.lp .lp-balance { margin-top: 0.9rem; padding-top: 0.85rem; border-top: 1.5px solid rgba(191, 235, 211, 0.3); display: flex; align-items: center; justify-content: space-between; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: #93CFB0; }
.lp .lp-balance-value { display: inline-flex; align-items: center; gap: 0.35rem; color: #7BE3AC; font-weight: 700; letter-spacing: 0.04em; }
@media (max-width: 30rem) {
  .lp .lp-ledger { padding: 1.15rem 1.15rem 1rem; }
  .lp .lp-ledger-cols, .lp .lp-row, .lp .lp-totals { grid-template-columns: minmax(0, 1fr) 4.9rem 4.9rem; gap: 0.4rem; }
  .lp .lp-acct { flex-wrap: wrap; gap: 0.35rem; }
  .lp .lp-row { font-size: 0.8125rem; }
  .lp .lp-num { font-size: 0.75rem; }
  .lp .lp-num-strong { font-size: 0.8125rem; }
}

/* Axiom line */
.lp .lp-axiom { border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); padding-block: 1.75rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1.5rem; font-size: 1.0625rem; color: var(--body); }
.lp .lp-axiom-eq { font-size: 0.8125rem; letter-spacing: 0.08em; color: var(--emerald); border: 1px solid rgba(23, 132, 90, 0.3); background-image: linear-gradient(120deg, rgba(36, 181, 115, 0.14), rgba(36, 181, 115, 0.04)); border-radius: 999px; padding: 0.3rem 0.75rem; }

/* Sections */
.lp .lp-section { padding-block: clamp(3rem, 6vw, 4.5rem); }
.lp .lp-section + .lp-section { padding-top: clamp(2.5rem, 5vw, 4rem); }
.lp .lp-section-head { margin-bottom: 2.75rem; }
.lp .lp-h2 { font-family: var(--font-serif); font-weight: 500; font-size: clamp(1.9rem, 3.8vw, 2.7rem); line-height: 1.12; letter-spacing: -0.025em; color: var(--ink); max-width: 22ch; }
.lp .lp-h3 { font-family: var(--font-serif); font-size: 1.3rem; letter-spacing: -0.015em; color: var(--ink); }
.lp .lp-body { margin-top: 0.6rem; font-size: 0.9375rem; line-height: 1.62; color: var(--body); max-width: 46rem; }

/* Account groups — ruled like a ledger sheet */
.lp .lp-group { display: grid; grid-template-columns: 1fr; gap: 0.85rem; padding-block: 1.75rem; border-top: 1px solid var(--rule); }
.lp .lp-group:last-child { border-bottom: 1px solid var(--rule); }
.lp .lp-armed .lp-group { opacity: 0; transform: translateY(14px); transition: opacity 600ms ease, transform 600ms ease; }
.lp .lp-armed.is-visible .lp-group { opacity: 1; transform: none; }
@media (min-width: 48rem) { .lp .lp-group { grid-template-columns: 10rem 1fr; gap: 2.5rem; } }
.lp .lp-group-key { display: flex; align-items: baseline; gap: 0.75rem; }
.lp .lp-group-code { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; background-image: linear-gradient(135deg, #24B573 0%, #12704C 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.lp .lp-group-class { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.lp .lp-chips { margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.45rem; list-style: none; padding: 0; }
.lp .lp-chips li { font-size: 0.7rem; letter-spacing: 0.04em; color: #176B49; background-image: linear-gradient(140deg, rgba(36, 181, 115, 0.14), rgba(36, 181, 115, 0.05)); border: 1px solid rgba(13, 78, 53, 0.12); border-radius: 999px; padding: 0.3rem 0.7rem; }

/* Close cycle */
.lp .lp-section-lede { margin-top: 1rem; max-width: 44rem; font-size: 1rem; }
.lp .lp-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 1px; background: var(--rule); border-block: 1px solid var(--rule); }
@media (min-width: 44rem) { .lp .lp-steps { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-steps { grid-template-columns: repeat(3, 1fr); } }
.lp .lp-step { display: flex; gap: 1rem; padding: 1.6rem 1.4rem; background-image: linear-gradient(165deg, rgba(255, 255, 255, 0.92), rgba(240, 250, 245, 0.72)); }
.lp .lp-armed .lp-step { opacity: 0; transform: translateY(14px); transition: opacity 600ms ease, transform 600ms ease; }
.lp .lp-armed.is-visible .lp-step { opacity: 1; transform: none; }
.lp .lp-step-no { font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.06em; color: var(--emerald); padding-top: 0.15rem; }
.lp .lp-step-term { font-family: var(--font-serif); font-size: 1.15rem; letter-spacing: -0.015em; color: var(--ink); }
.lp .lp-step .lp-body { margin-top: 0.4rem; font-size: 0.875rem; }

/* Reports */
.lp .lp-reports { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 0.75rem; }
@media (min-width: 44rem) { .lp .lp-reports { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-reports { grid-template-columns: repeat(4, 1fr); } }
.lp .lp-report { padding: 1.15rem 1.15rem 1.25rem; border: 1px solid var(--rule); border-radius: 0.85rem; background-image: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(233, 247, 240, 0.75)); border-top: 2px solid rgba(36, 181, 115, 0.55); }
.lp .lp-armed .lp-report { opacity: 0; transform: translateY(12px); transition: opacity 520ms ease, transform 520ms ease; }
.lp .lp-armed.is-visible .lp-report { opacity: 1; transform: none; }
.lp .lp-report h3 { font-size: 0.9375rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.lp .lp-report p { margin-top: 0.35rem; font-size: 0.8125rem; line-height: 1.55; color: var(--body); }

/* Local specifics */
.lp .lp-locale { display: grid; grid-template-columns: 1fr; gap: 2rem 3rem; }
@media (min-width: 48rem) { .lp .lp-locale { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-locale-item { padding-left: 1.1rem; border-left: 2px solid rgba(36, 181, 115, 0.45); }

/* Pricing */
.lp .lp-pricing { scroll-margin-top: 5rem; }
.lp .lp-plans { display: grid; grid-template-columns: 1fr; gap: 1.25rem; align-items: start; }
@media (min-width: 60rem) { .lp .lp-plans { grid-template-columns: repeat(3, 1fr); } }
.lp .lp-plan { position: relative; display: flex; flex-direction: column; padding: 1.75rem 1.5rem; border: 1px solid var(--rule); border-radius: 1.15rem; background-image: linear-gradient(165deg, rgba(255, 255, 255, 0.96), rgba(238, 249, 243, 0.8)); box-shadow: 0 22px 44px -34px rgba(9, 60, 40, 0.4); }
.lp .lp-plan.is-popular { border-color: transparent; box-shadow: 0 0 0 2px #1E9463, 0 30px 56px -32px rgba(9, 60, 40, 0.55); background-image: linear-gradient(165deg, #FFFFFF, #EAF9F1); }
@media (min-width: 60rem) { .lp .lp-plan.is-popular { transform: translateY(-0.6rem); } }
.lp .lp-plan-flag { position: absolute; top: -0.75rem; left: 1.5rem; font-family: var(--font-mono); font-size: 0.62rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FFFFFF; background-image: linear-gradient(135deg, #1FA671, #12704C); border-radius: 999px; padding: 0.28rem 0.7rem; }
.lp .lp-plan-name { font-family: var(--font-serif); font-size: 1.5rem; letter-spacing: -0.02em; color: var(--ink); }
.lp .lp-plan-tag { margin-top: 0.15rem; font-size: 0.8125rem; color: var(--muted); }
.lp .lp-plan-price { margin-top: 1.25rem; display: flex; align-items: baseline; gap: 0.3rem; color: var(--ink); }
.lp .lp-plan-cur { font-family: var(--font-mono); font-size: 0.85rem; font-weight: 600; color: var(--emerald); }
.lp .lp-plan-amt { font-family: var(--font-serif); font-size: 2.5rem; line-height: 1; letter-spacing: -0.03em; }
.lp .lp-plan-per { font-size: 0.85rem; color: var(--muted); }
.lp .lp-plan-vs { margin-top: 0.55rem; display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; font-size: 0.78rem; color: var(--muted); }
.lp .lp-plan-was { text-decoration: line-through; text-decoration-color: rgba(74, 115, 96, 0.55); }
.lp .lp-plan-vs .lp-plan-save { font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #12704C; background-image: linear-gradient(135deg, rgba(36, 181, 115, 0.18), rgba(36, 181, 115, 0.07)); border: 1px solid rgba(23, 132, 90, 0.28); border-radius: 999px; padding: 0.12rem 0.5rem; }
.lp .lp-plan-feats { list-style: none; margin: 1.4rem 0 1.75rem; padding: 1.4rem 0 0; border-top: 1px solid var(--rule); display: grid; gap: 0.7rem; }
.lp .lp-plan-feats li { display: flex; align-items: flex-start; gap: 0.55rem; font-size: 0.875rem; line-height: 1.45; color: var(--body); }
.lp .lp-plan-feats svg { flex: none; margin-top: 0.1rem; color: var(--emerald); }
.lp .lp-plan-cta { margin-top: auto; justify-content: center; }
.lp .lp-plans-note { margin-top: 1.75rem; font-size: 0.78rem; color: var(--muted); }

/* Controls */
.lp .lp-controls { display: grid; grid-template-columns: 1fr; gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 1rem; overflow: hidden; box-shadow: 0 24px 48px -36px rgba(9, 60, 40, 0.5); }
@media (min-width: 48rem) { .lp .lp-controls { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-control { background-image: linear-gradient(160deg, #FFFFFF 0%, #F2FBF6 100%); padding: 1.6rem 1.5rem; }
.lp .lp-armed .lp-control { opacity: 0; transform: translateY(14px); transition: opacity 600ms ease, transform 600ms ease; }
.lp .lp-armed.is-visible .lp-control { opacity: 1; transform: none; }
.lp .lp-control dt { font-size: 0.95rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.lp .lp-control dd { margin: 0.45rem 0 0; font-size: 0.875rem; line-height: 1.6; color: var(--body); }

/* Close — the page's green deepens into one last panel */
.lp .lp-closing { margin-block: clamp(2rem, 5vw, 3rem) clamp(3rem, 7vw, 4.5rem); padding: clamp(2.5rem, 6vw, 4rem); border-radius: 1.5rem; background-image: linear-gradient(135deg, #0F3D2A 0%, #17724E 55%, #23A96F 100%); display: flex; flex-direction: column; align-items: flex-start; gap: 1.75rem; box-shadow: 0 40px 70px -42px rgba(9, 60, 40, 0.6); }
.lp .lp-closing-h { max-width: none; color: #FFFFFF; }
.lp .lp-closing .lp-btn { background-image: linear-gradient(135deg, #FFFFFF 0%, #D6F4E4 100%); color: #0C3A28; box-shadow: 0 12px 26px -14px rgba(0, 0, 0, 0.5); }
.lp .lp-closing .lp-btn:focus-visible { outline-color: #FFFFFF; }
.lp .lp-footer { border-top: 1px solid var(--rule); background: rgba(255, 255, 255, 0.55); }

/* Motion */
@keyframes lp-fade-up { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes lp-row-in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }
.lp .lp-fade { opacity: 0; animation: lp-fade-up 700ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.lp .lp-row-in { opacity: 0; animation: lp-row-in 520ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }

@media (prefers-reduced-motion: reduce) {
  .lp .lp-fade, .lp .lp-row-in { animation: none; opacity: 1; transform: none; }
  .lp .lp-armed .lp-group, .lp .lp-armed .lp-control,
  .lp .lp-armed .lp-step, .lp .lp-armed .lp-report { opacity: 1; transform: none; transition: none; }
  .lp .lp-btn:hover { transform: none; }
}
`;
