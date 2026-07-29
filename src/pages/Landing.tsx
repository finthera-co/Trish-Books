import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Check, Tag, X,
  Building2, ListTree, FileSpreadsheet, BookOpen, BarChart3,
} from "lucide-react";

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
/* Scroll-zoom hero.
   Tracks how far the stage has been scrolled through (0 at rest, 1 when its
   bottom reaches the top of the viewport) and writes that single number to a CSS
   custom property. The scale / blur / fade are then expressed in CSS off
   --lp-zoom, which keeps the per-frame JS to one property write.

   Deliberately not using Motion's useScroll/useTransform: this page carries no
   animation library today, and the effect is one scalar. Every frame runs inside
   rAF and only touches a custom property, so the compositor does the rest.        */
function useScrollZoom<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return; // hold the first frame; CSS default is 0

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      // Progress through the stage: 0 while its top is at/below the viewport top,
      // 1 once it has scrolled entirely past. Guard height 0 during layout.
      const travel = rect.height || 1;
      const progress = Math.min(Math.max(-rect.top / travel, 0), 1);
      el.style.setProperty("--lp-zoom", progress.toFixed(4));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return ref;
}

/* Gives a section its own 3D entrance as it scrolls into view — the same idea as
   the hero, but triggered by position rather than page load: the section arrives
   out of depth, tilted back, and rights itself.

   The class is added from JS rather than sitting in the markup, so a section is
   never left transformed-and-invisible if this never runs. Same safety timeout as
   useReveal for the case where the observer stays quiet.                        */
function useSection3d<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    el.classList.add("lp-s3d");
    const show = () => el.classList.add("is-in");

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          show();
          io.disconnect();
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);

    const timer = window.setTimeout(show, 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  return ref;
}

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

/* ── Pricing model ──────────────────────────────────────────────────
   All figures in LKR, published July 2026. Kept as plain data so the
   whole price book lives in one place and is easy to refresh. */

/* Every base tier ships the same core ledger; listed once, not per card. */
const CORE_LEDGER = [
  "Chart of accounts, journals & general ledger",
  "Trial balance, P&L and balance sheet",
  "Invoicing — IRD Gazette 2481/22 VAT/SSCL",
  "Expense tracker",
  "Customer & vendor masters",
];

/* Base tiers differ by seats, companies and caps — the core is identical. */
/* ── The running promotion ──────────────────────────────────────────────────
   Single source of truth. The announcement marquee, the "% off" badges and the
   struck-through list prices are all derived from this, so they can't drift apart
   the way the old hard-coded 0.78 multiplier did.

   `percentOff` is the one number to change when the offer changes; set
   `active: false` to pull the whole thing off the site.

   Note on direction: the `monthly` figures in BASE_PLANS are what a customer
   actually pays. The list price is derived upward from them, so the discount is
   advertised without changing anyone's bill.                                   */
const PROMO = {
  active: true,
  label: "Launch offer",
  percentOff: 30,
  /** Plans excluded from the offer (Free has nothing to discount). */
  excludes: ["Free"],
};

/** Pre-discount price, rounded to a clean hundred so it reads like a real list price. */
const listPrice = (monthly: number) =>
  monthly ? Math.ceil(monthly / (1 - PROMO.percentOff / 100) / 100) * 100 : 0;

/** The saving actually shown, computed from the rounded list price so the maths checks out. */
const discountFor = (plan: { name: string; monthly: number }) => {
  if (!PROMO.active || !plan.monthly || PROMO.excludes.includes(plan.name)) return null;
  const list = listPrice(plan.monthly);
  return { list, percent: Math.round(((list - plan.monthly) / list) * 100) };
};

const BASE_PLANS = [
  {
    name: "Free",
    users: "1",
    companies: "1",
    monthly: 0,
    annual: null,
    desc: "Get provisioned, seeded and posting your first entries.",
    highlights: ["1 user, 1 company", "Up to 25 invoices / month", "Core double-entry ledger"],
    limits: ["No module packs", "Community support"],
  },
  {
    name: "Lite",
    users: "1",
    companies: "1",
    monthly: 2900,
    annual: 29000,
    desc: "A sole trader or new company keeping its own books.",
    highlights: ["1 user, 1 company", "Unlimited invoices", "Add any module pack"],
    limits: ["Email support"],
  },
  {
    name: "Standard",
    users: "3",
    companies: "1",
    monthly: 5900,
    annual: 59000,
    desc: "A small finance team working one set of books.",
    highlights: ["3 users, 1 company", "Unlimited invoices", "Add any module pack", "Bundle discounts"],
    limits: ["Email & chat support"],
  },
  {
    name: "Pro",
    users: "6",
    companies: "2",
    monthly: 9900,
    annual: 99000,
    popular: true,
    badge: "Most popular",
    desc: "Two companies and room for the team to grow.",
    highlights: ["6 users, 2 companies", "Unlimited invoices", "Add any module pack", "Bundle discounts", "Priority onboarding"],
    limits: ["Priority support"],
  },
  {
    name: "Scale",
    users: "20",
    companies: "3",
    monthly: 18900,
    annual: 189000,
    desc: "Multiple entities and a larger finance function.",
    highlights: ["20 users, 3 companies", "Unlimited invoices", "All module packs", "Bundle discounts", "Consolidation-ready"],
    limits: ["Priority support"],
  },
  {
    name: "Enterprise",
    users: "Unlimited",
    companies: "Unlimited",
    monthly: 34900,
    annual: 349000,
    badge: "Best value",
    desc: "No seat or company limits, for groups at scale.",
    highlights: ["Unlimited users & companies", "Unlimited invoices", "All module packs", "Bundle discounts", "SSO / SAML ready"],
    limits: ["Dedicated account manager"],
  },
];

/* Module packs, grouped the way the app's modules are grouped. */
const PACK_GROUPS = [
  {
    title: "Sales & Receivables",
    packs: [
      ["Receivables — AR ageing, statements, credit notes", 1900],
      ["Quotations & Sales Orders", 1400],
      ["Recurring & Subscription Billing", 1400],
      ["Customer Portal", 1200],
    ],
  },
  {
    title: "Purchases & Payables",
    packs: [
      ["Payables — vendor bills, AP ageing, payment vouchers", 1900],
      ["Purchase Orders & GRN", 1400],
      ["Vendor Advances & Prepayments", 900],
    ],
  },
  {
    title: "Banking & Cash",
    packs: [
      ["Bank Reconciliation", 1400],
      ["Bank Statement Import — Sampath Excel + suspense clearing", 1900],
      ["Petty Cash", 900],
      ["Cash Flow Forecasting", 1500],
    ],
  },
  {
    title: "Inventory & Stock",
    packs: [
      ["Inventory Core — WAC/FIFO, single location", 2400],
      ["Multi-Warehouse & Stock Transfers", 2400],
      ["Batch / Serial / Expiry Tracking", 1900],
      ["Reorder Levels & Stock Alerts", 900],
    ],
  },
  {
    title: "Assets",
    packs: [
      ["Fixed Assets & PPE Schedule", 2400],
      ["Revaluation & Impairment — IAS 16/36", 1400],
    ],
  },
  {
    title: "Compliance & Close",
    packs: [
      ["Period Locking & Fiscal Close", 1400],
      ["Audit Trail", 1200],
      ["IFRS Statement Pack — SOCE, OCI, cash flow, comparatives", 1900],
      ["Tax Engine — WHT/AIT, SSCL compounding", 1900],
      ["Approval Workflows — maker-checker", 1900],
    ],
  },
  {
    title: "Planning & Insight",
    packs: [
      ["Budgeting & Variance", 1500],
      ["Custom Report Builder", 2400],
      ["Dashboards & KPIs", 1200],
    ],
  },
  {
    title: "Advanced",
    packs: [
      ["Multi-Currency", 2400],
      ["Multi-Entity Consolidation", 3900],
      ["Projects & Job Costing", 2900],
      ["Departments / Cost Centres", 1500],
      ["API Access & Webhooks", 2400],
      ["SSO / SAML", 2900],
    ],
  },
];

/* Payroll scales by headcount; add-ons layer on top. */
const PAYROLL_CORE = [
  ["Up to 5 employees", "1,500"],
  ["Up to 15", "3,400"],
  ["Up to 30", "5,900"],
  ["Up to 60", "9,900"],
  ["Up to 100", "14,900"],
  ["100+", "150 / employee"],
];
const PAYROLL_ADDONS = [
  ["Attendance & Biometric Import — ZKTeco AttLog", "1,400"],
  ["Leave Management & No-Pay Proration", "1,200"],
  ["Loans & Salary Advances", "1,200"],
  ["Gratuity & Leave Encashment", "1,200"],
  ["SLIPS/CEFTS Bulk Payment Export", "1,500"],
  ["Employee Self-Service Portal", "60 / employee"],
];

/* Discounted bundles — list is the à-la-carte sum, price is the bundle. */
const BUNDLES = [
  ["Finance Essentials", "Receivables, Payables, Bank Rec, Petty Cash", 6100, 4900],
  ["Trading", "Inventory Core, Multi-Warehouse, PO/GRN, Reorder", 7100, 5400],
  ["Compliance", "Period Close, Audit, IFRS Pack, Tax Engine, Approvals", 8300, 5900],
  ["Payroll Suite", "All five payroll add-ons", 6500, 4400],
  ["Complete Finance", "All 30 accounting packs", 56600, 24900],
  ["Everything", "Complete Finance + Payroll Suite", 63100, 27900],
];

/* Pre-configured base + packs by industry. */
const INDUSTRY_BUNDLES = [
  ["Services & Consulting", "Standard + Finance Essentials + Projects", 11900],
  ["Retail & Trading", "Standard + Trading + Finance Essentials", 13900],
  ["Restaurant & F&B", "Standard + Inventory Core + Batch/Expiry + Petty Cash + Payroll (30)", 14900],
  ["Construction & Contracting", "Pro + Projects + Payables + Fixed Assets + Approvals", 15900],
  ["Manufacturing", "Pro + Trading + Batch/Serial + Fixed Assets", 16900],
  ["NGO / Donor-Funded", "Standard + Cost Centres + Budgeting + Multi-Currency + Audit", 10900],
];

const MICRO_ADDONS = [
  ["Extra user", "LKR 1,200 / user / mo"],
  ["Extra company", "50% of base"],
  ["Custom invoice templates", "LKR 600 / mo"],
  ["SMS / WhatsApp invoice delivery", "LKR 900 / mo + per message"],
  ["Additional document storage — per 10 GB", "LKR 500 / mo"],
  ["Priority support — 12h response, phone", "LKR 2,900 / mo"],
  ["Dedicated account manager — 4h SLA", "LKR 9,900 / mo"],
];

const SERVICES = [
  ["Onboarding & CoA setup", "LKR 35,000"],
  ["Opening balance migration", "LKR 45,000"],
  ["Full historical data migration", "LKR 90,000–250,000"],
  ["On-site training — per day", "LKR 25,000"],
  ["Custom report build", "LKR 15,000 each"],
  ["Custom integration", "From LKR 150,000"],
];

const CONTROLS = [
  ["Audit trail", "Every posting, edit and approval is recorded against a user and a timestamp."],
  ["Period locks", "Closed periods reject new entries until an admin reopens them."],
  ["Role-based access", "Company admins, accountants and employees each see only their own ledger."],
  ["Two-factor sign-in", "TOTP step-up on every session, enforced before the app loads."],
];

/* ── Kinetic headlines ───────────────────────────────────────────────────────
   Splits a headline into words and rises each one into place on a stagger. Every
   word sits in its own overflow-hidden box, so the word is genuinely masked as it
   travels — that clipped edge is what separates a type reveal from a plain fade.

   Each heading owns its observer rather than leaning on the page's useReveal, so
   it can be dropped anywhere without the section having to cooperate. The timeout
   is a safety net: a headline must never be left invisible because an observer
   stayed quiet.                                                                 */
function SplitHeading({
  text,
  accent,
  className = "",
  step = 55,
}: {
  text: string;
  /** Word or contiguous phrase within `text` to carry the shifting gradient. */
  accent?: string;
  className?: string;
  step?: number;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  // Reduced motion starts (and stays) revealed.
  const [shown, setShown] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    const timer = window.setTimeout(() => setShown(true), 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const words = text.split(" ");

  // Locate the accent phrase by word index, so a multi-word accent stays contiguous
  // and each of its words still animates on its own step.
  const accentWords = accent ? accent.split(" ") : [];
  let accentStart = -1;
  if (accentWords.length) {
    for (let i = 0; i + accentWords.length <= words.length; i++) {
      if (accentWords.every((w, k) => words[i + k] === w)) {
        accentStart = i;
        break;
      }
    }
  }
  const isAccent = (i: number) =>
    accentStart >= 0 && i >= accentStart && i < accentStart + accentWords.length;

  return (
    <h2 ref={ref} className={`lp-h2 lp-split${shown ? " is-shown" : ""} ${className}`}>
      {words.map((word, i) => (
        <Fragment key={`${word}-${i}`}>
          <span className="lp-split-w">
            <span className="lp-split-i" style={{ transitionDelay: `${i * step}ms` }}>
              {isAccent(i) ? <em className="lp-grad">{word}</em> : word}
            </span>
          </span>
          {/* Real space between the inline-blocks, so wrapping stays natural. */}
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </h2>
  );
}

/* ── Getting started ─────────────────────────────────────────────────────────
   The onboarding path, played back as a sequence. Each step moves through three
   states — waiting, working, done — and the run loops so a visitor who arrives
   mid-cycle still sees the whole story.

   Same reasoning as the hero: no animation library. The only state is which step
   is current; every transition below is CSS.                                    */
const START_STEPS = [
  { icon: Building2, title: "Create your company", note: "Provisioned with your fiscal year and currency." },
  { icon: ListTree, title: "Chart of accounts, ready", note: "Seeded and yours to extend, not a blank page." },
  { icon: FileSpreadsheet, title: "Import your bank statement", note: "Excel in, categorised transactions out." },
  { icon: BookOpen, title: "Post your first entry", note: "Debits and credits, balanced before it saves." },
  { icon: BarChart3, title: "Reports run themselves", note: "Trial balance, P&L and balance sheet, live." },
];

const STEP_MS = 1900;

function GettingStarted() {
  const [active, setActive] = useState(0);
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Hold at the first step until the section is actually on screen, so the
  // sequence isn't already over by the time the visitor scrolls down to it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArmed(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!armed) return;
    // +1 so the finished state holds for a beat before looping back.
    const id = setInterval(
      () => setActive((i) => (i + 1) % (START_STEPS.length + 1)),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, [armed]);

  // Without motion, present the finished state rather than a frozen first step.
  const current = prefersReducedMotion() ? START_STEPS.length : active;

  return (
    <div className="lp-start" ref={ref}>
      <ol className="lp-start-list">
        {START_STEPS.map((step, i) => {
          const state = i < current ? "is-done" : i === current ? "is-live" : "is-wait";
          const Icon = step.icon;
          return (
            <li className={`lp-start-step ${state}`} key={step.title}>
              <span className="lp-start-rail" aria-hidden="true">
                <span className="lp-start-rail-fill" />
              </span>

              <span className="lp-start-dot" aria-hidden="true">
                <Icon className="lp-start-icon-idle w-4 h-4" strokeWidth={2} />
                <Check className="lp-start-icon-done w-4 h-4" strokeWidth={3} />
                <span className="lp-start-spin" />
              </span>

              <span className="lp-start-copy">
                <span className="lp-start-title">{step.title}</span>
                <span className="lp-start-note">{step.note}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

type TickerPlan = { name: string; monthly: number; list: number; percent: number };

/* The popup shows more than the marquee, so it reads the plan's seat/company
   metadata too. Optional, so a TickerPlan is still assignable. */
type PopupPlan = TickerPlan & {
  users?: string;
  companies?: string;
  annual?: number | null;
};

/* Popup cadence — the standard advertising pattern: an opening delay, then it
   returns on a timer after each dismissal, with a cap so it can't badger someone
   all day. All four numbers live here; nothing else needs touching to retime it. */
const PROMO_POPUP = {
  /** First appearance — inside the opening 6 seconds of the visit. */
  firstDelayMs: 5_000,
  /** Floor for a resumed cooldown, so a reload never fires it before first paint. */
  minDelayMs: 1_200,
  /** How long a dismissal is respected before it comes back. */
  repeatEveryMs: 60_000,
  /** Ceiling on appearances per calendar day, per browser. */
  maxPerDay: 5,
};

/* Keyed to the offer, so changing the promo gives everyone a clean slate rather
   than inheriting the previous offer's dismissals and counts. */
const PROMO_STATE_KEY = `finthera.promo.${PROMO.label}.${PROMO.percentOff}`;

type PromoState = { day: string; shows: number; closedAt: number };

const today = () => new Date().toISOString().slice(0, 10);

/* The daily cap is persisted, which means that on a dev machine you burn through it
   in a handful of reloads and the popup then goes silent for the rest of the day
   with nothing to indicate why. Don't persist it locally: the cooldown still works
   inside the session (it lives in a ref), but a reload starts clean, so the thing
   stays testable. */
const isLocalHost = () =>
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

/* localStorage throws outright in some private-browsing modes, so every access is
   guarded — an ad is never worth breaking the page over. A failed read just means
   the visitor is treated as new. */
function readPromoState(): PromoState {
  const fresh: PromoState = { day: today(), shows: 0, closedAt: 0 };
  if (isLocalHost()) return fresh;
  try {
    const raw = window.localStorage.getItem(PROMO_STATE_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as PromoState;
    // A stored count from a previous day must not eat into today's allowance.
    if (parsed.day !== fresh.day) return fresh;
    return { day: parsed.day, shows: parsed.shows ?? 0, closedAt: parsed.closedAt ?? 0 };
  } catch {
    return fresh;
  }
}

function writePromoState(state: PromoState) {
  if (isLocalHost()) return;
  try {
    window.localStorage.setItem(PROMO_STATE_KEY, JSON.stringify(state));
  } catch {
    /* cadence just won't survive a reload */
  }
}

/* ── Promo popup ─────────────────────────────────────────────────────────────
   Centred on the page over a scrim. Closes on the X, on Escape, or on a click
   outside — and then comes back on a timer rather than being gone for good.

   The cooldown is persisted, so reloading the page doesn't reset it back to a
   fresh appearance; a reload part-way through a cooldown resumes the remainder.

   Because it sits in front of the page it behaves as a real dialog: it takes focus
   while open and returns it on close.                                            */
function PromoPopup({
  plans,
  onPricing,
}: {
  plans: PopupPlan[];
  onPricing: (e: React.MouseEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const state = useRef<PromoState>(readPromoState());
  const timer = useRef<number>();

  const close = () => {
    setOpen(false);
    state.current = { ...state.current, closedAt: Date.now() };
    writePromoState(state.current);
  };

  // One scheduler drives both the first appearance and every repeat. It re-runs
  // whenever `open` flips back to false, which is what produces the loop.
  useEffect(() => {
    if (!PROMO.active || plans.length === 0 || open) return;

    const s = state.current;
    if (s.shows >= PROMO_POPUP.maxPerDay) return;

    // Resume a cooldown in progress rather than restarting it on every mount, and
    // never fire at 0ms — an expired cooldown on a fresh load still waits for paint.
    const since = s.closedAt ? Date.now() - s.closedAt : Infinity;
    const wait = s.closedAt
      ? Math.max(PROMO_POPUP.minDelayMs, PROMO_POPUP.repeatEveryMs - since)
      : PROMO_POPUP.firstDelayMs;

    timer.current = window.setTimeout(() => {
      state.current = { ...state.current, shows: state.current.shows + 1 };
      writePromoState(state.current);
      setOpen(true);
    }, wait);

    return () => window.clearTimeout(timer.current);
  }, [open, plans.length]);

  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusTo = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);

    // It sits in the middle of the page over a scrim, so it takes focus while open
    // and hands it back on close — otherwise keyboard users are left behind it.
    returnFocusTo.current = document.activeElement;
    closeRef.current?.focus();

    return () => {
      window.removeEventListener("keydown", onKey);
      (returnFocusTo.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  // Stays mounted between appearances — the scheduler needs to keep running, and
  // the scrim is inert while closed (opacity 0, pointer-events none).
  if (!PROMO.active || plans.length === 0) return null;

  const best = Math.max(...plans.map((p) => p.percent));
  // Lead with the cheapest paid tiers; the rest are named in the footnote rather
  // than making the card scroll.
  const shown = plans.slice(0, 3);
  const rest = plans.slice(3);
  const lkr = (n: number) => n.toLocaleString("en-LK");

  return (
    <div
      className={`lp-pop-wrap${open ? " is-open" : ""}`}
      aria-hidden={!open}
      // Clicking the scrim dismisses, same as the X. The card stops propagation so
      // a click inside it never counts as a click outside.
      onClick={close}
    >
      <div
        className="lp-pop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lp-pop-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button ref={closeRef} type="button" className="lp-pop-x" onClick={close} aria-label="Close offer">
          <X className="w-4 h-4" strokeWidth={2.5} />
        </button>

        <p className="lp-pop-kicker">
          <Tag className="w-3 h-3" strokeWidth={2.5} />
          {PROMO.label}
        </p>
        <p className="lp-pop-title" id="lp-pop-title">
          Up to <strong>{best}% off</strong> every plan
        </p>
        <p className="lp-pop-lede">
          Launch pricing on every paid tier — every one ships the full double-entry
          ledger, and you can add module packs à la carte.
        </p>

        <ul className="lp-pop-list">
          {shown.map((p) => (
            <li key={p.name}>
              <span className="lp-pop-plan">{p.name}</span>
              <span className="lp-pop-meta">
                {p.users} {p.users === "1" ? "user" : "users"} · {p.companies}{" "}
                {p.companies === "1" ? "company" : "companies"}
              </span>
              <span className="lp-pop-off">{p.percent}% off</span>
              <span className="lp-pop-price">
                <s>LKR {lkr(p.list)}</s>
                <strong>LKR {lkr(p.monthly)}</strong>
                <span className="lp-pop-per">/mo</span>
              </span>
              {/* The saving stated in rupees, not just as a percentage — it's the
                  number a buyer actually weighs. */}
              <span className="lp-pop-save">save LKR {lkr(p.list - p.monthly)}/mo</span>
            </li>
          ))}
        </ul>

        {rest.length > 0 && (
          <p className="lp-pop-more">
            Also {rest.map((p) => `${p.name} ${p.percent}% off`).join(" · ")}
          </p>
        )}

        {/* The discount is meaningless without the thing being discounted. These are
            the CORE_LEDGER items every tier ships, so the reader can see what the
            price actually buys rather than just how much is off it. */}
        <div className="lp-pop-incl">
          <p className="lp-pop-incl-head">Every plan includes</p>
          <ul className="lp-pop-incl-list">
            {CORE_LEDGER.map((f) => (
              <li key={f}>
                <Check className="w-3 h-3" strokeWidth={3} />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <ul className="lp-pop-trust">
          {["30-day money-back", "Cancel anytime", "Free tier, no card"].map((t) => (
            <li key={t}>
              <Check className="w-3 h-3" strokeWidth={3} />
              {t}
            </li>
          ))}
        </ul>

        {/* Primary action is signup — this is the highest-intent moment on the page,
            so it shouldn't spend it sending someone to a price list they just read. */}
        <div className="lp-pop-actions">
          <Link to="/signup" className="lp-pop-cta" onClick={close}>
            Claim this price
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
          <a href="#pricing" className="lp-pop-later" onClick={(e) => { onPricing(e); close(); }}>
            Compare all packages
          </a>
        </div>

        <p className="lp-pop-fine">
          Two months free when billed yearly. Renews at list price — cancel before
          renewal at any time.
        </p>
      </div>
    </div>
  );
}

/* The discount marquee. Rendered twice on the page — as the full-bleed bar at the
   very top ("bar") and again as an inset band further down ("band") — so a visitor
   who scrolls past the header still meets the offer. Both read the same PROMO
   figures, so they can never disagree with each other or with the pricing cards. */
function PromoTicker({
  plans,
  onPricing,
  variant = "bar",
}: {
  plans: TickerPlan[];
  onPricing: (e: React.MouseEvent) => void;
  variant?: "bar" | "band";
}) {
  if (!PROMO.active || plans.length === 0) return null;

  return (
    <a
      href="#pricing"
      onClick={onPricing}
      className={`lp-ticker${variant === "band" ? " is-band" : ""}`}
      aria-label={`${PROMO.label}: ${plans
        .map((p) => `${p.name} ${p.percent}% off`)
        .join(", ")}. See packages and pricing.`}
    >
      <span className="lp-ticker-badge">
        <Tag className="w-3 h-3" strokeWidth={2.5} />
        {PROMO.label}
      </span>

      <span className="lp-ticker-window">
        {/* Two identical runs: the track slides by exactly half its width, so the
            second run is in place the moment the first scrolls out — no seam. The
            duplicate is aria-hidden so the list is announced once. */}
        <span className="lp-ticker-track">
          {[0, 1].map((copy) => (
            <span className="lp-ticker-run" key={copy} aria-hidden={copy === 1}>
              {plans.map((p) => (
                <span className="lp-ticker-item" key={p.name}>
                  <strong>{p.name}</strong>
                  <span className="lp-ticker-off">{p.percent}% off</span>
                  <s className="lp-ticker-was">LKR {p.list.toLocaleString("en-LK")}</s>
                  <span className="lp-ticker-now">
                    LKR {p.monthly.toLocaleString("en-LK")}/mo
                  </span>
                  <span className="lp-ticker-dot" aria-hidden="true">
                    ◆
                  </span>
                </span>
              ))}
            </span>
          ))}
        </span>
      </span>

      <span className="lp-ticker-cta">
        See pricing
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </a>
  );
}

export default function Landing() {
  const debits = useCountUp(ENTRY_TOTAL);
  const credits = useCountUp(ENTRY_TOTAL, 1100, 550);
  const mapRef = useReveal<HTMLDivElement>();
  const stepsRef = useReveal<HTMLOListElement>();
  const reportsRef = useReveal<HTMLUListElement>();
  const controlsRef = useReveal<HTMLDivElement>();
  const stageRef = useScrollZoom<HTMLDivElement>();
  // One 3D entrance per section. Separate refs rather than a loop, since hooks
  // can't be called conditionally or iteratively.
  const s3dBalance = useSection3d<HTMLDivElement>();
  const s3dCoa = useSection3d<HTMLDivElement>();
  const s3dClose = useSection3d<HTMLElement>();
  const s3dReports = useSection3d<HTMLElement>();
  const s3dLocal = useSection3d<HTMLElement>();
  const s3dStart = useSection3d<HTMLElement>();
  const s3dPricing = useSection3d<HTMLElement>();
  const s3dClosing = useSection3d<HTMLElement>();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Hold the poster frame instead of playing when motion is unwelcome.
  useEffect(() => {
    if (prefersReducedMotion()) videoRef.current?.pause();
  }, []);

  // Plans carrying an offer, in price order — drives the marquee.
  const discountedPlans = useMemo(
    () =>
      BASE_PLANS.map((p) => ({ ...p, ...(discountFor(p) ?? {}) }))
        .filter((p): p is typeof p & { list: number; percent: number } => "percent" in p)
        .sort((a, b) => a.monthly - b.monthly),
    [],
  );

  const scrollToPricing = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("pricing")?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <div className="lp min-h-screen text-[#001D39] antialiased">
      <style>{css}</style>

      {/* ── Announcement marquee ────────────────────────────────
             Scrolls the discounted packages and their savings. The track is
             rendered twice so the loop has no visible seam; the duplicate is
             aria-hidden so a screen reader hears the list once. Percentages come
             from PROMO, the same source the pricing cards read. ── */}
      <PromoTicker plans={discountedPlans} onPricing={scrollToPricing} />
      <PromoPopup plans={discountedPlans} onPricing={scrollToPricing} />

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
            <Link to="/login" className="lp-navlink">
              Log in
            </Link>
            <Link to="/signup" className="lp-btn lp-btn-sm">
              Start free
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero: the claim on the debit side, the proof on the credit side.
               An ambient green loop runs behind it, under a light scrim. ── */}
        <div className="lp-stage" ref={stageRef}>
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
            {/* The headline reveals line by line rather than arriving with the rest
                of the column — each line is masked and rises into place on a
                stagger, so the eye is walked down the claim. Deliberately not
                given lp-fade: two entrances on one element would fight. */}
            <h1 className="lp-h1 lp-kinetic">
              {[
                <>Every rupee,</>,
                <>
                  on <em>both</em> sides
                </>,
                <>of the ledger.</>,
              ].map((line, i) => (
                <span className="lp-line" key={i}>
                  <span className="lp-line-i" style={{ animationDelay: `${160 + i * 145}ms` }}>
                    {line}
                  </span>
                </span>
              ))}
            </h1>
            <p className="lp-lede lp-fade" style={{ animationDelay: "240ms" }}>
              Stop stitching your accounts together from spreadsheets. Invoices, bank
              feeds, payroll and period close all post to one ledger that always
              balances — so month-end takes an afternoon, not a fortnight.
            </p>
            <div className="lp-fade lp-cta-row" style={{ animationDelay: "340ms" }}>
              <Link to="/signup" className="lp-btn lp-btn-lg">
                Start free — no card
                <ArrowRight className="w-4 h-4" />
              </Link>
              <p className="lp-note">
                Your company is set up in minutes.
                <br />
                Already have an account? <Link to="/login" className="lp-note-link">Log in</Link>
              </p>
            </div>
          </div>

          {/* Signature element: a journal entry that posts and balances itself. */}
          <div className="lp-ledger lp-ledger-anim">
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
        <section className="lp-shell" ref={s3dBalance}>
          <p className="lp-axiom">
            <span className="lp-mono lp-axiom-eq">Σ debits = Σ credits</span>
            Nothing saves until it balances. Nothing posts twice. Nothing disappears.
          </p>
        </section>

        {/* ── Capabilities, organised by the account range they post to.
               Set on navy and run full-bleed, matching the Industry-bundles panel
               further down; the inner shell keeps the content on the page grid. ── */}
        <section className="lp-band is-navy" ref={mapRef}>
          <div className="lp-shell lp-section" ref={s3dCoa}>
            <header className="lp-section-head">
              <p className="lp-eyebrow">Chart of accounts</p>
              <SplitHeading text="Every number traceable to the document behind it" accent="traceable" />
              <p className="lp-body lp-section-lede">
                Nothing lives in a side spreadsheet. Click any balance and you land on the
                entry, the document and the person who posted it — which is what turns an
                audit question into a ten-second answer.
              </p>
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
          </div>
        </section>

        <div className="lp-shell" aria-hidden="true"><div className="lp-stripe" /></div>

        {/* ── The close cycle. Numbered because it genuinely is an order. ── */}
        <section className="lp-shell lp-section" ref={s3dClose}>
          <header className="lp-section-head">
            <p className="lp-eyebrow">The month, end to end</p>
            <SplitHeading text="Close the month in six steps, not six weeks" accent="six steps" />
            <p className="lp-body lp-section-lede">
              The same order every month, with the system checking the work as you go.
              Nothing posts unbalanced, and a closed period stays closed.
            </p>
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
        <section className="lp-shell lp-section" ref={s3dReports}>
          <header className="lp-section-head">
            <p className="lp-eyebrow">Reports</p>
            <SplitHeading text="The statement your accountant asks for, ready now" accent="ready now" />
            <p className="lp-body lp-section-lede">
              No export, no rebuild, no version that disagrees with last week’s. Every
              report is generated from posted entries the moment you ask for it — so two
              people running it on the same date get the same numbers, every time.
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
        <section className="lp-shell lp-section" ref={s3dLocal}>
          <header className="lp-section-head">
            <p className="lp-eyebrow">Sri Lanka</p>
            <SplitHeading text="Built for Sri Lankan compliance, not adapted to it" accent="not adapted to it" />
            <p className="lp-body lp-section-lede">
              VAT, SSCL, WHT, EPF, ETF and gratuity are in the ledger from day one — not
              a plugin you configure, and not a workaround your accountant maintains.
            </p>
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

        {/* ── Getting started ──────────────────────────────────────
               The path from signup to live reports, immediately before pricing so
               the offer lands on someone who has just seen how short it is.

               Set on violet and run full-bleed: this is the section the page is
               built to deliver a reader to, so it gets the one dark band on an
               otherwise pale page. Contents invert for the dark ground. ── */}
        <section className="lp-band" ref={s3dStart}>
          <div className="lp-shell lp-section">
            <header className="lp-section-head">
              <p className="lp-eyebrow">Getting started</p>
              <SplitHeading text="Live books by the end of the afternoon" accent="afternoon" />
              <p className="lp-body lp-section-lede">
                No migration project, no consultant, no implementation fee. Five steps
                from an empty company to a trial balance that ties — most people get
                there before their coffee goes cold.
              </p>
            </header>
            <GettingStarted />
          </div>
        </section>

        {/* Mid-page repeat of the offer. Deliberately outside lp-shell so it runs
            edge to edge, cutting the full width of the page between the steps and
            the packages. */}
        <div className="lp-ticker-inset">
          <PromoTicker plans={discountedPlans} onPricing={scrollToPricing} variant="band" />
        </div>

        {/* ── Pricing ──────────────────────────────────────────── */}
        <section id="pricing" className="lp-shell lp-section lp-pricing" ref={s3dPricing}>
          <header className="lp-section-head">
            <p className="lp-eyebrow">Packages &amp; pricing</p>
            <SplitHeading text="Pay for the ledger, not for seats you don’t fill" accent="you don’t fill" />
            <p className="lp-body lp-section-lede">
              Every tier — including the free one — ships the complete double-entry
              ledger. Add module packs, payroll and bundles only when you need them, all
              priced in rupees with no setup fee and no annual lock-in.
            </p>
          </header>

          {/* Trust row */}
          <ul className="lp-trust">
            {["Free tier, no card required", "30-day money-back guarantee", "2 months free billed yearly", "Cancel anytime"].map((t) => (
              <li key={t}>
                <Check className="w-4 h-4" strokeWidth={2.5} />
                {t}
              </li>
            ))}
          </ul>

          {/* Base plans — big, detailed cards */}
          <div className="lp-bases">
            {BASE_PLANS.map((plan) => (
              <article key={plan.name} className={`lp-tier${plan.popular ? " is-popular" : ""}`}>
                {(() => {
                  // Same helper the marquee uses, so badge and strip always agree.
                  const offer = discountFor(plan);
                  const regular = offer?.list ?? 0;
                  const off = offer?.percent ?? 0;
                  return (
                    <>
                      <div className="lp-tier-top">
                        {plan.badge && (
                          <span className={`lp-tier-badge${plan.popular ? " is-pop" : ""}`}>{plan.badge}</span>
                        )}
                        {off > 0 && <span className="lp-tier-off">{off}% off</span>}
                      </div>

                      <h3 className="lp-tier-name">{plan.name}</h3>
                      <p className="lp-tier-desc">{plan.desc}</p>

                      {plan.monthly === 0 ? (
                        <>
                          <div className="lp-tier-price">
                            <span className="lp-tier-amt">Free</span>
                          </div>
                          <p className="lp-tier-billed">No card required</p>
                        </>
                      ) : (
                        <>
                          {offer && (
                            <p className="lp-tier-reg">
                              LKR {regular.toLocaleString("en-LK")}
                              <span className="lp-tier-reg-per">/mo</span>
                            </p>
                          )}
                          <div className="lp-tier-price">
                            <span className="lp-tier-cur">LKR</span>
                            <span className="lp-tier-amt">{plan.monthly.toLocaleString("en-LK")}</span>
                            <span className="lp-tier-per">/mo</span>
                          </div>
                          <p className="lp-tier-billed">
                            {offer
                              ? `${PROMO.label} \u00b7 renews at LKR ${regular.toLocaleString("en-LK")}/mo`
                              : "Billed monthly \u00b7 cancel anytime"}
                          </p>
                        </>
                      )}
                    </>
                  );
                })()}

                {/* Every tier routes to signup — a visitor convinced by a plan must
                    be able to act on it here, not be sent to a login form. */}
                <Link
                  to="/signup"
                  className={`lp-btn lp-btn-lg lp-tier-cta${plan.popular ? "" : " lp-btn-ghost"}`}
                >
                  {plan.monthly === 0 ? "Start free" : `Start on ${plan.name}`}
                </Link>

                <p className="lp-tier-group">What you get</p>
                <ul className="lp-tier-feats">
                  {plan.highlights.map((f) => (
                    <li key={f}>
                      <Check className="w-4 h-4" strokeWidth={2.5} />
                      {f}
                    </li>
                  ))}
                </ul>

                <p className="lp-tier-group">In the core ledger</p>
                <ul className="lp-tier-feats lp-tier-feats-core">
                  {CORE_LEDGER.map((f) => (
                    <li key={f}>
                      <Check className="w-4 h-4" strokeWidth={2.5} />
                      {f}
                    </li>
                  ))}
                </ul>

                <ul className="lp-tier-limits">
                  {plan.limits.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>

          {/* Module packs — set on violet, since this is the part of pricing that
              does the selling once someone has picked a base plan. The panel runs
              full-bleed; the inner lp-shell puts its content back on the page grid
              so the type still lines up with every other section. */}
          <div className="lp-sub is-violet">
            <div className="lp-shell">
              <h3 className="lp-h3 lp-sub-title">Module packs</h3>
              <p className="lp-body lp-sub-lede">
                Attach any pack to a paid base plan. Take 3+ for 15% off, 6+ for 25%, 10+ for 35%.
              </p>
              <div className="lp-packs">
                {PACK_GROUPS.map((group) => (
                  <div key={group.title} className="lp-pack-group is-boxed">
                    <h4 className="lp-pack-head">{group.title}</h4>
                    <ul className="lp-pricelist">
                      {group.packs.map(([label, price]) => (
                        <li key={label as string}>
                          <span className="lp-pl-label">{label}</span>
                          <span className="lp-pl-price">
                            <span className="lp-pl-cur">LKR</span>
                            {(price as number).toLocaleString("en-LK")}
                            <span className="lp-pl-per">/mo</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Payroll */}
          <div className="lp-sub">
            <h3 className="lp-h3 lp-sub-title">Payroll &amp; people</h3>
            <div className="lp-packs lp-packs-two">
              <div className="lp-pack-group">
                <h4 className="lp-pack-head">Payroll Core — EPF/ETF/APIT, payslips, statutory returns</h4>
                <ul className="lp-pricelist">
                  {PAYROLL_CORE.map(([label, price]) => (
                    <li key={label}>
                      <span className="lp-pl-label">{label}</span>
                      <span className="lp-pl-price">{price}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="lp-pack-group">
                <h4 className="lp-pack-head">Payroll add-ons</h4>
                <ul className="lp-pricelist">
                  {PAYROLL_ADDONS.map(([label, price]) => (
                    <li key={label}>
                      <span className="lp-pl-label">{label}</span>
                      <span className="lp-pl-price">{price}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Bundles */}
          <div className="lp-sub">
            <h3 className="lp-h3 lp-sub-title">Bundles</h3>
            <p className="lp-body lp-sub-lede">Grouped packs at a standing discount off the à-la-carte total.</p>
            <div className="lp-table-scroll">
              <table className="lp-ptable">
                <thead>
                  <tr>
                    <th scope="col">Bundle</th>
                    <th scope="col" className="lp-th-wide">Contents</th>
                    <th scope="col" className="lp-num-col">List</th>
                    <th scope="col" className="lp-num-col">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {BUNDLES.map(([name, contents, list, price]) => (
                    <tr key={name as string}>
                      <th scope="row">{name}</th>
                      <td>{contents}</td>
                      <td className="lp-num-col lp-strike">{(list as number).toLocaleString("en-LK")}</td>
                      <td className="lp-num-col lp-price-em">{(price as number).toLocaleString("en-LK")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Industry bundles — set on navy, the third and last of the tinted
              panels through the page (violet for module packs, navy here). */}
          <div className="lp-sub is-navy">
            <div className="lp-shell">
              <h3 className="lp-h3 lp-sub-title">Industry bundles</h3>
              <p className="lp-body lp-sub-lede">Base plus packs, pre-configured for a line of work.</p>
              <div className="lp-table-scroll">
                <table className="lp-ptable">
                  <thead>
                    <tr>
                      <th scope="col">Bundle</th>
                      <th scope="col" className="lp-th-wide">Configuration</th>
                      <th scope="col" className="lp-num-col">Monthly</th>
                    </tr>
                  </thead>
                  <tbody>
                    {INDUSTRY_BUNDLES.map(([name, config, monthly]) => (
                      <tr key={name as string}>
                        <th scope="row">{name}</th>
                        <td>{config}</td>
                        <td className="lp-num-col lp-price-em">{(monthly as number).toLocaleString("en-LK")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Micro add-ons + services, side by side */}
          <div className="lp-sub lp-sub-split">
            <div>
              <h3 className="lp-h3 lp-sub-title">Micro add-ons</h3>
              <ul className="lp-pricelist lp-pricelist-boxed">
                {MICRO_ADDONS.map(([label, price]) => (
                  <li key={label}>
                    <span className="lp-pl-label">{label}</span>
                    <span className="lp-pl-price lp-pl-price-text">{price}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="lp-h3 lp-sub-title">Services — one-off</h3>
              <ul className="lp-pricelist lp-pricelist-boxed">
                {SERVICES.map(([label, price]) => (
                  <li key={label}>
                    <span className="lp-pl-label">{label}</span>
                    <span className="lp-pl-price lp-pl-price-text">{price}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="lp-plans-note">
            All prices in Sri Lanka rupees, per month unless noted. Launch pricing applies to your
            first three months. Extra companies bill at 50% of the base plan.
          </p>
        </section>

        {/* ── Controls ─────────────────────────────────────────── */}
        <section className="lp-shell lp-section" ref={controlsRef}>
          <header className="lp-section-head">
            <p className="lp-eyebrow">Controls</p>
            <SplitHeading text="Built to survive an audit" accent="audit" />
            <p className="lp-body lp-section-lede">
              Approvals, period locks and a full audit trail come as standard — so the
              question is never “who changed this?”, and your auditor gets an answer
              without a single email.
            </p>
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
        <section className="lp-shell lp-closing" ref={s3dClosing}>
          <h2 className="lp-h2 lp-closing-h">Post your first entry today.</h2>
          <p className="lp-closing-lede">
            Create your company, import a bank statement, and watch the trial balance
            tie — before you spend a rupee.
          </p>
          <Link to="/signup" className="lp-btn lp-btn-lg">
            Start free — no card
            <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="lp-closing-note">
            Free tier, no card required · 30-day money-back on paid plans ·{" "}
            <Link to="/login" className="lp-note-link">Log in</Link>
          </p>
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
          <p className="lp-mono text-xs text-[#4A6C8E]">
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
  --ink: #001D39;
  --body: #2F4B66;
  --muted: #4A6C8E;
  --emerald: #0A4174;
  --bright: #4E8EA2;
  --mint: #BDD8E9;
  --rule: rgba(10, 65, 116, 0.14);
  /* Two accents carried through the page: the promo amber and a violet to sit
     against it. Kept as tokens so the marquee, stripes, card edges and step dots
     all pull from the same two values. */
  --amber: #FFC01E;
  --amber-lo: #FFD24A;
  --violet: #6241DC;
  --violet-lo: #8A72E8;
  font-family: var(--font-sans);
  /* The page itself is the gradient: near-white at the top, deepening
     through mint into a soft green by the footer. */
  background-image:
    radial-gradient(58rem 38rem at 88% -12%, rgba(78, 142, 162, 0.26), transparent 62%),
    radial-gradient(46rem 34rem at -10% 24%, rgba(10, 65, 116, 0.14), transparent 64%),
    linear-gradient(180deg, #FFFFFF 0%, #F2F8FD 20%, #E1EEF7 56%, #C9E1F0 100%);
  background-repeat: no-repeat;
  /* clip, not hidden — hidden would create a scroll container and break the sticky header */
  overflow-x: clip;
}
.lp .lp-shell { width: 100%; max-width: 74rem; margin-inline: auto; padding-inline: 1.5rem; }

/* Hero stage — ambient video under a light scrim */
/* Scroll-zoom hero. --lp-zoom runs 0 -> 1 as the stage scrolls past (set from JS in
   useScrollZoom); everything below is derived from it, so the browser animates
   transform/filter/opacity on the compositor and JS only writes one number.
   The stage keeps its own height — the backdrop is what moves. */
/* perspective here is what makes the hero's translateZ read as depth rather than
   as a flat scale. overflow:hidden then clips the content as it flies past the
   viewer, which is what sells the "pop and disappear". */
.lp .lp-stage { position: relative; isolation: isolate; overflow: hidden; --lp-zoom: 0; perspective: 1100px; perspective-origin: 50% 40%; }

/* Backdrop pushes away and softens as the foreground comes forward — opposing
   directions are what give the shot its depth. */
.lp .lp-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; pointer-events: none;
  transform: scale(calc(1 + var(--lp-zoom) * 0.38));
  filter: blur(calc(var(--lp-zoom) * 16px));
  opacity: calc(1 - var(--lp-zoom) * 0.8);
  transform-origin: 50% 45%;
  will-change: transform, filter, opacity; }

/* The hero itself pops toward the reader and dissolves. Opacity is multiplied so
   it reaches zero around 65% of the travel — gone before the stage ends, rather
   than lingering as a ghost over the next section. */
.lp .lp-stage .lp-hero {
  transform:
    translate3d(0, calc(var(--lp-zoom) * -2.2rem), calc(var(--lp-zoom) * 300px))
    rotateX(calc(var(--lp-zoom) * -10deg))
    scale(calc(1 + var(--lp-zoom) * 0.06));
  opacity: calc(1 - var(--lp-zoom) * 1.55);
  transform-origin: 50% 100%;
  will-change: transform, opacity; }
.lp .lp-scrim { position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image:
    radial-gradient(44rem 30rem at 24% 48%, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.42) 62%, transparent 80%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.74) 0%, rgba(255, 255, 255, 0.56) 40%, rgba(240, 246, 252, 0.88) 84%, #EFF7FD 100%); }
.lp .lp-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.lp .font-serif { font-family: var(--font-serif); }

/* Mark: two stacked bars — the debit and credit column */
.lp .lp-mark { display: inline-flex; flex-direction: column; justify-content: center; gap: 3px; width: 1.65rem; height: 1.65rem; }
.lp .lp-mark > span { display: block; height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--bright), #7BBDE8); }
.lp .lp-mark > span:last-child { width: 62%; background: var(--emerald); }
.lp .lp-mark-sm { width: 1.3rem; height: 1.3rem; gap: 2px; }
.lp .lp-mark-sm > span { height: 3px; }

.lp .lp-header { position: sticky; top: 0; z-index: 20; backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.74); border-bottom: 1px solid var(--rule); }

/* Buttons */
.lp .lp-btn { display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 999px; background-image: linear-gradient(135deg, #49769F 0%, #0A4174 100%); color: #FFFFFF; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; box-shadow: 0 10px 22px -12px rgba(10, 65, 116, 0.75); transition: transform 160ms ease, box-shadow 160ms ease, filter 160ms ease; }
.lp .lp-btn:hover { filter: brightness(1.09); transform: translateY(-1px); box-shadow: 0 16px 30px -14px rgba(10, 65, 116, 0.85); }
.lp .lp-btn:focus-visible { outline: 2px solid #0A4174; outline-offset: 3px; }
.lp .lp-btn-sm { padding: 0.5rem 1rem; font-size: 0.875rem; }
.lp .lp-btn-lg { padding: 0.85rem 1.6rem; font-size: 1rem; }
.lp .lp-btn-ghost { background-image: none; background-color: transparent; color: #0A4174; box-shadow: inset 0 0 0 1.5px rgba(10, 65, 116, 0.4); }
.lp .lp-btn-ghost:hover { filter: none; background-color: rgba(10, 65, 116, 0.06); box-shadow: inset 0 0 0 1.5px rgba(10, 65, 116, 0.6); }

/* Announcement marquee — a yellow strip listing the discounted packages.
   Deep navy ink on amber, so it reads as a promotional flash against the page's
   cool palette while still clearing contrast on small text. */
.lp .lp-ticker { position: relative; display: flex; align-items: center; gap: 0.85rem; padding: 0.5rem 1rem; color: #3D2A00; text-decoration: none; background: linear-gradient(90deg, #FFD24A 0%, #FFC01E 55%, #FFB300 100%); border-bottom: 1px solid rgba(61, 42, 0, 0.18); overflow: hidden; }
.lp .lp-ticker-badge { display: inline-flex; align-items: center; gap: 0.3rem; flex: none; font-family: var(--font-mono); font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #FFF6DC; background: #3D2A00; border-radius: 999px; padding: 0.25rem 0.6rem; }

/* The window clips; the track carries the two runs and slides by exactly half its
   width, which is one full run — so the loop repeats seamlessly. */
.lp .lp-ticker-window { flex: 1 1 auto; min-width: 0; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 3rem, #000 calc(100% - 3rem), transparent); mask-image: linear-gradient(90deg, transparent, #000 3rem, #000 calc(100% - 3rem), transparent); }
.lp .lp-ticker-track { display: flex; width: max-content; animation: lp-ticker-scroll 34s linear infinite; }
.lp .lp-ticker-run { display: flex; align-items: center; flex: none; }
.lp .lp-ticker:hover .lp-ticker-track { animation-play-state: paused; }

.lp .lp-ticker-item { display: inline-flex; align-items: center; gap: 0.45rem; font-size: 0.8125rem; white-space: nowrap; }
.lp .lp-ticker-item strong { font-weight: 700; }
.lp .lp-ticker-off { font-weight: 800; color: #7A1F00; background: rgba(255, 255, 255, 0.72); border-radius: 999px; padding: 0.1rem 0.45rem; }
.lp .lp-ticker-was { opacity: 0.62; }
.lp .lp-ticker-now { font-weight: 700; }
.lp .lp-ticker-dot { padding: 0 0.9rem; font-size: 0.5rem; opacity: 0.45; }

.lp .lp-ticker-cta { display: none; flex: none; align-items: center; gap: 0.3rem; font-size: 0.8125rem; font-weight: 700; }
.lp .lp-ticker:hover .lp-ticker-cta { text-decoration: underline; text-underline-offset: 3px; }
.lp .lp-ticker:focus-visible { outline: 2px solid #3D2A00; outline-offset: -3px; }
@media (min-width: 640px) { .lp .lp-ticker-cta { display: inline-flex; } }

@keyframes lp-ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* ── Promo popup ─────────────────────────────────────────────────────────────
   Violet into navy, so it belongs to both tinted bands on the page. Fixed to the
   bottom-left corner and kept narrow: it should read as an aside, not a barrier.
   pointer-events go off while closed so the hidden card can never swallow a click
   on the page beneath it. */
/* Scrim: centres the card and dims the page behind it. pointer-events go off while
   closed so the invisible layer can never swallow a click on the page. */
.lp .lp-pop-wrap { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 1.25rem;
  background: rgba(0, 21, 39, 0.55); backdrop-filter: blur(3px);
  opacity: 0; pointer-events: none; transition: opacity 320ms ease; }
.lp .lp-pop-wrap.is-open { opacity: 1; pointer-events: auto; }

.lp .lp-pop { position: relative; width: min(31rem, 100%);
  /* Tall content: cap the height and let the card scroll rather than overflow the
     viewport on a short window. */
  max-height: calc(100dvh - 2.5rem); overflow-y: auto;
  padding: 2.1rem 2.1rem 1.9rem; border-radius: 1.35rem; color: #F1EEFD;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background-image:
    radial-gradient(26rem 16rem at 8% -20%, rgba(138, 114, 232, 0.6), transparent 64%),
    linear-gradient(155deg, #5B37D6 0%, var(--violet) 42%, #0A2E58 100%);
  box-shadow: 0 34px 80px -26px rgba(0, 12, 30, 0.8);
  transform: translate3d(0, 1.25rem, 0) scale(0.95);
  transition: transform 520ms cubic-bezier(0.22, 1.12, 0.36, 1); }
.lp .lp-pop-wrap.is-open .lp-pop { transform: none; }
/* Amber top hairline, the same signal the marquee and bands use. */
.lp .lp-pop::before { content: ""; position: absolute; left: 1.1rem; right: 1.1rem; top: 0; height: 3px; border-radius: 0 0 3px 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 25%, var(--amber-lo) 75%, transparent); }

.lp .lp-pop-x { position: absolute; top: 1rem; right: 1rem; display: grid; place-items: center; width: 1.85rem; height: 1.85rem;
  border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 999px; background: rgba(255, 255, 255, 0.1); color: #F1EEFD; cursor: pointer;
  transition: background 200ms ease, border-color 200ms ease; }
.lp .lp-pop-x:hover { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.34); }
.lp .lp-pop-x:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

.lp .lp-pop-kicker { display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 0 0.9rem;
  font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: #3D2A00; background: var(--amber); border-radius: 999px; padding: 0.22rem 0.55rem; }
.lp .lp-pop-title { margin: 0 0 0.7rem; padding-right: 2.5rem; font-family: var(--font-serif); font-size: 1.45rem; line-height: 1.3; color: #FFFFFF; }
.lp .lp-pop-title strong { color: var(--amber); font-weight: 700; }

.lp .lp-pop-lede { margin: 0 0 1.5rem; font-size: 0.8125rem; line-height: 1.5; color: rgba(241, 238, 253, 0.78); }

/* Each row is a small grid: name and seat count on the left, the discount pill
   right-aligned, then price and saving on the row beneath. */
.lp .lp-pop-list { list-style: none; margin: 0 0 1.25rem; padding: 0; display: grid; gap: 1rem; }
.lp .lp-pop-list li { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 0.15rem 0.6rem;
  padding-bottom: 1rem; border-bottom: 1px solid rgba(255, 255, 255, 0.13); font-size: 0.875rem; }
.lp .lp-pop-list li:last-child { border-bottom: none; padding-bottom: 0; }
.lp .lp-pop-plan { font-weight: 700; color: #FFFFFF; }
.lp .lp-pop-meta { grid-column: 1; margin-top: 0.15rem; font-size: 0.73rem; color: rgba(241, 238, 253, 0.62); }
.lp .lp-pop-off { grid-row: 1; grid-column: 2; justify-self: end; font-size: 0.68rem; font-weight: 800; color: #3D2A00; background: var(--amber-lo); border-radius: 999px; padding: 0.1rem 0.4rem; }
.lp .lp-pop-price { grid-column: 1; display: flex; align-items: baseline; gap: 0.45rem; margin-top: 0.5rem; font-family: var(--font-mono); font-size: 0.875rem; }
.lp .lp-pop-price s { color: rgba(241, 238, 253, 0.5); }
.lp .lp-pop-price strong { color: #FFFFFF; font-weight: 700; }
.lp .lp-pop-per { font-size: 0.66rem; color: rgba(241, 238, 253, 0.55); }
.lp .lp-pop-save { grid-column: 2; justify-self: end; align-self: end; font-size: 0.68rem; font-weight: 700; color: var(--amber-lo); }

.lp .lp-pop-more { margin: 0 0 1.35rem; font-size: 0.75rem; color: rgba(241, 238, 253, 0.66); }

/* What the price buys. Slightly inset so it reads as a panel within the card. */
.lp .lp-pop-incl { margin: 0 0 1.35rem; padding: 1.1rem 1.15rem; border-radius: 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.07); }
.lp .lp-pop-incl-head { margin: 0 0 0.7rem; font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--amber-lo); }
.lp .lp-pop-incl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
.lp .lp-pop-incl-list li { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 0.4rem;
  font-size: 0.78rem; line-height: 1.5; color: rgba(241, 238, 253, 0.88); }
.lp .lp-pop-incl-list svg { margin-top: 0.22rem; color: var(--amber); }

.lp .lp-pop-trust { list-style: none; margin: 0 0 1.5rem; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; }
.lp .lp-pop-trust li { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; color: rgba(241, 238, 253, 0.78); }
.lp .lp-pop-trust svg { color: var(--amber); }

.lp .lp-pop-actions { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; }
.lp .lp-pop-cta { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; font-weight: 700;
  color: #3D2A00; background-image: linear-gradient(90deg, var(--amber-lo), var(--amber)); border-radius: 999px; padding: 0.55rem 1rem; text-decoration: none; }
.lp .lp-pop-cta:hover { filter: brightness(1.06); }
.lp .lp-pop-cta:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
/* A second way out besides the X — some people won't look for the corner. */
.lp .lp-pop-later { border: 0; background: none; padding: 0.35rem 0; font-size: 0.75rem; font-weight: 600;
  color: rgba(241, 238, 253, 0.7); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.lp .lp-pop-later:hover { color: #FFFFFF; }
.lp .lp-pop-later:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

.lp .lp-pop-fine { margin: 1.35rem 0 0; font-size: 0.68rem; line-height: 1.55; color: rgba(241, 238, 253, 0.55); }

/* ── Violet highlight band ───────────────────────────────────────────────────
   The one dark section on the page. Everything inside inverts: type goes light,
   the amber accent does the work the violet does elsewhere, and the step dots
   flip to reading light-on-dark. */
.lp .lp-band { position: relative; margin-top: 4.5rem; color: #F3EFFE;
  background-image:
    radial-gradient(48rem 26rem at 12% -10%, rgba(138, 114, 232, 0.55), transparent 62%),
    radial-gradient(40rem 24rem at 92% 110%, rgba(255, 192, 30, 0.18), transparent 64%),
    linear-gradient(160deg, #5B37D6 0%, var(--violet) 46%, #4B2FB4 100%); }
/* Amber hairlines top and bottom tie the band to the marquee that follows it. */
.lp .lp-band::before, .lp .lp-band::after { content: ""; position: absolute; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--amber-lo) 78%, transparent); }
.lp .lp-band::before { top: 0; }
.lp .lp-band::after { bottom: 0; }

.lp .lp-band .lp-h2 { color: #FFFFFF; }
.lp .lp-band .lp-eyebrow { color: var(--amber-lo); }
.lp .lp-band .lp-section-head .lp-eyebrow::before { background: linear-gradient(90deg, var(--amber), #FFFFFF); }
.lp .lp-band .lp-body, .lp .lp-band .lp-section-lede { color: rgba(243, 239, 254, 0.82); }

/* Steps, inverted for the dark ground. */
.lp .lp-band .lp-start-rail { background: rgba(255, 255, 255, 0.22); }
.lp .lp-band .lp-start-rail-fill { background: linear-gradient(180deg, var(--amber), #FFFFFF); }
@media (min-width: 60rem) { .lp .lp-band .lp-start-rail-fill { background: linear-gradient(90deg, var(--amber), #FFFFFF); } }
.lp .lp-band .lp-start-dot { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.34); color: rgba(243, 239, 254, 0.72); }
.lp .lp-band .lp-start-step.is-live .lp-start-dot { border-color: var(--amber); color: var(--amber); }
.lp .lp-band .lp-start-step.is-done .lp-start-dot { background: var(--amber); border-color: var(--amber); color: #3D2A00; }
.lp .lp-band .lp-start-spin { border-top-color: #FFFFFF; border-right-color: #FFFFFF; }
.lp .lp-band .lp-start-title { color: #FFFFFF; }
.lp .lp-band .lp-start-step.is-wait .lp-start-title { color: rgba(243, 239, 254, 0.6); }
.lp .lp-band .lp-start-note { color: rgba(243, 239, 254, 0.72); opacity: 1; }

/* Navy variant of the band, sharing the geometry and hairlines with the violet
   one. Used for Chart of accounts; the ledger-map rows invert with it. */
.lp .lp-band.is-navy { color: #E4EEF7;
  background-image:
    radial-gradient(48rem 26rem at 10% -10%, rgba(78, 142, 162, 0.4), transparent 62%),
    radial-gradient(42rem 24rem at 94% 112%, rgba(98, 65, 220, 0.3), transparent 64%),
    linear-gradient(160deg, #052A4E 0%, var(--ink) 50%, #001527 100%); }
.lp .lp-band.is-navy::before, .lp .lp-band.is-navy::after {
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--violet-lo) 78%, transparent); }
.lp .lp-band.is-navy .lp-eyebrow { color: var(--mint); }
.lp .lp-band.is-navy .lp-section-head .lp-eyebrow::before { background: linear-gradient(90deg, var(--amber), var(--violet-lo)); }
.lp .lp-band.is-navy .lp-body { color: rgba(228, 238, 247, 0.8); }
.lp .lp-band.is-navy .lp-h3 { color: #FFFFFF; }
.lp .lp-band.is-navy .lp-group { border-top-color: rgba(255, 255, 255, 0.14); }
.lp .lp-band.is-navy .lp-group:last-child { border-bottom-color: rgba(255, 255, 255, 0.14); }
.lp .lp-band.is-navy .lp-group-code { background-image: linear-gradient(135deg, var(--mint) 0%, var(--amber) 100%); }
.lp .lp-band.is-navy .lp-group-class { color: rgba(228, 238, 247, 0.58); }
.lp .lp-band.is-navy .lp-chips li { color: #DCEBF6; background-image: linear-gradient(140deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.05)); border-color: rgba(255, 255, 255, 0.2); }

/* ── Getting-started sequence ────────────────────────────────────────────────
   Three visual states per step, driven purely by the class on the <li>:
     .is-wait  muted, outlined dot
     .is-live  filled, ring pulse, spinner over the icon
     .is-done  solid, tick swapped in, rail filled through                      */
.lp .lp-start { margin-top: 2.5rem; }
.lp .lp-start-list { display: grid; gap: 0; list-style: none; padding: 0; margin: 0; }
@media (min-width: 60rem) { .lp .lp-start-list { grid-auto-flow: column; grid-auto-columns: 1fr; } }

.lp .lp-start-step { position: relative; display: flex; align-items: flex-start; gap: 0.9rem; padding: 0 0 2rem 0; }
@media (min-width: 60rem) {
  .lp .lp-start-step { flex-direction: column; align-items: flex-start; gap: 0.85rem; padding: 2.6rem 1.1rem 0 0; }
}

/* Connector: vertical when stacked, horizontal once the row lays out.
   Both offsets are pinned to the dot's centre line — the dot is 2.15rem, so its
   centre sits 1.075rem into wherever the dot starts. Stacked, that is 1.075rem
   from the top of the step; in a row the step carries 2.6rem of padding-top
   first, hence 3.675rem. Getting this wrong leaves the rail floating above the
   dots instead of threading through them. */
.lp .lp-start-rail { position: absolute; background: #D8E6F2; overflow: hidden;
  left: calc(1.075rem - 1px); top: 2.35rem; bottom: 0.35rem; width: 2px; }
@media (min-width: 60rem) {
  .lp .lp-start-rail { left: 1.075rem; right: 0; top: calc(2.6rem + 1.075rem - 1px); bottom: auto; width: auto; height: 2px; }
}
.lp .lp-start-step:last-child .lp-start-rail { display: none; }
.lp .lp-start-rail-fill { display: block; width: 100%; height: 100%; background: linear-gradient(180deg, var(--violet), var(--amber));
  transform: scaleY(0); transform-origin: top; transition: transform 620ms cubic-bezier(0.4, 0, 0.2, 1); }
@media (min-width: 60rem) {
  .lp .lp-start-rail-fill { background: linear-gradient(90deg, var(--violet), var(--amber)); transform: scaleX(0); transform-origin: left; }
}
.lp .lp-start-step.is-done .lp-start-rail-fill { transform: scale(1); }

/* The dot stacks three marks; opacity picks which one reads. */
.lp .lp-start-dot { position: relative; flex: none; display: grid; place-items: center; width: 2.15rem; height: 2.15rem; border-radius: 999px;
  background: #FFFFFF; border: 2px solid #D8E6F2; color: #6B8CA8;
  transition: background 320ms ease, border-color 320ms ease, color 320ms ease, transform 320ms ease; }
.lp .lp-start-dot > * { grid-area: 1 / 1; transition: opacity 260ms ease, transform 260ms ease; }
.lp .lp-start-icon-done { opacity: 0; transform: scale(0.6); }
/* Violet marks the step being worked, amber the rail it has already filled — the
   two accents split the "now" and "done" states between them. */
.lp .lp-start-step.is-live .lp-start-dot { border-color: var(--violet); color: var(--violet); animation: lp-pulse-ring 1.6s ease-out infinite; }
.lp .lp-start-step.is-done .lp-start-dot { background: var(--violet); border-color: var(--violet); color: #FFFFFF; }
.lp .lp-start-step.is-done .lp-start-icon-idle { opacity: 0; transform: scale(0.6); }
.lp .lp-start-step.is-done .lp-start-icon-done { opacity: 1; transform: scale(1); }

/* Spinner rides the rim while the step is working. */
.lp .lp-start-spin { width: 2.15rem; height: 2.15rem; border-radius: 999px; opacity: 0;
  border: 2px solid transparent; border-top-color: #4E8EA2; border-right-color: #4E8EA2; }
.lp .lp-start-step.is-live .lp-start-spin { opacity: 1; animation: lp-start-spin 900ms linear infinite; }
@keyframes lp-start-spin { to { transform: rotate(360deg); } }

/* When a step becomes current it pops toward the reader in 3D and settles back —
   the whole card lifts, not just the dot, so the eye is pulled along the row. The
   keyframe returns to its own start, so a step that has already played sits flat
   again once the sequence moves on. */
@keyframes lp-start-pop {
  0%   { transform: perspective(700px) translate3d(0, 0, 0) scale(1); }
  38%  { transform: perspective(700px) translate3d(0, -6px, 46px) scale(1.05); }
  100% { transform: perspective(700px) translate3d(0, 0, 0) scale(1); }
}
.lp .lp-start-step { transform-origin: 50% 70%; }
.lp .lp-start-step.is-live { animation: lp-start-pop 1900ms cubic-bezier(0.22, 1.1, 0.36, 1) both; z-index: 1; }
.lp .lp-start-step.is-live .lp-start-copy { transition: none; }

.lp .lp-start-copy { display: flex; flex-direction: column; gap: 0.2rem; }
.lp .lp-start-title { font-weight: 700; font-size: 0.9375rem; color: var(--ink); transition: color 320ms ease; }
.lp .lp-start-note { font-size: 0.8125rem; color: var(--body); opacity: 0.75; max-width: 22ch; }
.lp .lp-start-step.is-wait .lp-start-title { color: #6B8CA8; }

/* Mid-page variant: full-bleed, so it cuts the whole width of the page. Ruled top
   and bottom rather than boxed, which is what lets it read as a band rather than
   as a second announcement bar. */
.lp .lp-ticker-inset { margin: 4.5rem 0 0; }
.lp .lp-ticker.is-band { border-top: 1px solid rgba(61, 42, 0, 0.22); border-bottom: 1px solid rgba(61, 42, 0, 0.22); padding: 0.8rem 1.25rem; box-shadow: 0 14px 34px -26px rgba(61, 42, 0, 0.6); }
.lp .lp-ticker.is-band .lp-ticker-item { font-size: 0.875rem; }
/* The band sits mid-page where it would catch the eye repeatedly; let it scroll
   without the extra sheen sweep the top bar uses. */
.lp .lp-ticker.is-band::after { content: none; }

/* Header nav link */
.lp .lp-navlink { font-size: 0.875rem; font-weight: 600; color: var(--body); text-decoration: none; padding: 0.35rem 0.15rem; }
.lp .lp-navlink:hover { color: var(--emerald); }
.lp .lp-navlink:focus-visible { outline: 2px solid #0A4174; outline-offset: 3px; border-radius: 4px; }

/* Hero */
.lp .lp-hero { display: grid; grid-template-columns: 1fr; gap: 3.5rem; padding-block: clamp(3.5rem, 9vw, 7rem) clamp(3rem, 7vw, 5.5rem); align-items: center; }
.lp .lp-hero > * { min-width: 0; }
@media (min-width: 62rem) { .lp .lp-hero { grid-template-columns: 1.05fr 1fr; gap: 4.5rem; } }
/* Section eyebrows carry a short amber tick, so the promo colour recurs quietly
   through the page instead of appearing only in the marquee. */
.lp .lp-eyebrow { font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.18em; text-transform: uppercase; color: var(--emerald); margin-bottom: 1.25rem; }
.lp .lp-section-head .lp-eyebrow::before { content: ""; display: inline-block; vertical-align: middle; width: 1.6rem; height: 3px; margin-right: 0.6rem; border-radius: 2px; background: linear-gradient(90deg, var(--amber), var(--violet)); }

/* Hairline of stripes used to separate sections — the same diagonal ruling as the
   marquee, dialled right down so it reads as a texture, not a banner. Amber and
   violet alternate so both accents recur together. */
.lp .lp-stripe { height: 6px; margin: 3.25rem 0 0; border-radius: 3px; opacity: 0.85;
  background-image: repeating-linear-gradient(115deg, var(--amber) 0 10px, var(--violet) 10px 20px, transparent 20px 34px);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent); }
.lp .lp-stripe-tight { margin-top: 1.75rem; }
.lp .lp-h1 { font-family: var(--font-serif); font-weight: 500; font-size: clamp(2.5rem, 6.4vw, 4.15rem); line-height: 1.03; letter-spacing: -0.03em; color: var(--ink); }
/* .lp-h1 em is styled with .lp-grad in the kinetic-typography block below — one
   gradient definition serves the hero and every heading accent. */
.lp .lp-lede { margin-top: 1.5rem; max-width: 34rem; font-size: 1.0625rem; line-height: 1.65; color: var(--body); }
.lp .lp-cta-row { margin-top: 2.25rem; display: flex; flex-wrap: wrap; align-items: center; gap: 1.25rem 1.75rem; }
.lp .lp-note { font-size: 0.8125rem; line-height: 1.5; color: var(--muted); }

/* Ledger card — the one deep object on a light page */
.lp .lp-ledger { background-image: linear-gradient(158deg, #001D39 0%, #0A4174 58%, #49769F 100%); color: #DCEBF5; border-radius: 1.25rem; padding: 1.5rem 1.5rem 1.25rem; box-shadow: 0 36px 68px -34px rgba(0, 29, 57, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.09); }
.lp .lp-ledger-head { display: flex; align-items: center; justify-content: space-between; }
.lp .lp-ledger-ref { font-size: 0.75rem; letter-spacing: 0.06em; color: #9BC4DE; }
.lp .lp-ledger-status { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #D2E8F5; background: rgba(189, 216, 233, 0.18); border-radius: 999px; padding: 0.25rem 0.6rem; }
.lp .lp-ledger-title { margin-top: 0.85rem; font-family: var(--font-serif); font-size: 1.2rem; letter-spacing: -0.015em; color: #F4FAFE; }
.lp .lp-ledger-cols, .lp .lp-row, .lp .lp-totals { display: grid; grid-template-columns: minmax(0, 1fr) 6.5rem 6.5rem; gap: 0.75rem; align-items: baseline; }
.lp .lp-ledger-cols { margin-top: 1.35rem; padding-bottom: 0.5rem; border-bottom: 1.5px solid rgba(189, 216, 233, 0.3); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: #9BC4DE; }
.lp .lp-rows { margin: 0; padding: 0; list-style: none; }
.lp .lp-row { padding-block: 0.7rem; border-bottom: 1px solid rgba(189, 216, 233, 0.15); font-size: 0.875rem; color: #E6F2FA; }
.lp .lp-acct { display: flex; align-items: baseline; gap: 0.55rem; min-width: 0; }
.lp .lp-code { font-size: 0.75rem; color: #9BC4DE; }
.lp .lp-num { text-align: right; font-size: 0.8125rem; }
.lp .lp-totals { padding-top: 0.8rem; font-size: 0.8125rem; color: #A7CBE4; }
.lp .lp-num-strong { color: #FFFFFF; font-weight: 700; font-size: 0.9375rem; }
.lp .lp-balance { margin-top: 0.9rem; padding-top: 0.85rem; border-top: 1.5px solid rgba(189, 216, 233, 0.3); display: flex; align-items: center; justify-content: space-between; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: #9BC4DE; }
.lp .lp-balance-value { display: inline-flex; align-items: center; gap: 0.35rem; color: #7BBDE8; font-weight: 700; letter-spacing: 0.04em; }
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
.lp .lp-axiom-eq { font-size: 0.8125rem; letter-spacing: 0.08em; color: var(--emerald); border: 1px solid rgba(10, 65, 116, 0.3); background-image: linear-gradient(120deg, rgba(78, 142, 162, 0.14), rgba(78, 142, 162, 0.04)); border-radius: 999px; padding: 0.3rem 0.75rem; }

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
.lp .lp-group-code { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; background-image: linear-gradient(135deg, #4E8EA2 0%, #0A4174 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.lp .lp-group-class { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.lp .lp-chips { margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.45rem; list-style: none; padding: 0; }
.lp .lp-chips li { font-size: 0.7rem; letter-spacing: 0.04em; color: #0A4174; background-image: linear-gradient(140deg, rgba(78, 142, 162, 0.14), rgba(78, 142, 162, 0.05)); border: 1px solid rgba(10, 65, 116, 0.12); border-radius: 999px; padding: 0.3rem 0.7rem; }

/* Close cycle */
.lp .lp-section-lede { margin-top: 1rem; max-width: 44rem; font-size: 1rem; }
.lp .lp-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 1px; background: var(--rule); border-block: 1px solid var(--rule); }
@media (min-width: 44rem) { .lp .lp-steps { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-steps { grid-template-columns: repeat(3, 1fr); } }
.lp .lp-step { display: flex; gap: 1rem; padding: 1.6rem 1.4rem; background-image: linear-gradient(165deg, rgba(255, 255, 255, 0.92), rgba(238, 244, 251, 0.72)); }
.lp .lp-armed .lp-step { opacity: 0; transform: translateY(14px); transition: opacity 600ms ease, transform 600ms ease; }
.lp .lp-armed.is-visible .lp-step { opacity: 1; transform: none; }
.lp .lp-step-no { font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.06em; color: var(--emerald); padding-top: 0.15rem; }
.lp .lp-step-term { font-family: var(--font-serif); font-size: 1.15rem; letter-spacing: -0.015em; color: var(--ink); }
.lp .lp-step .lp-body { margin-top: 0.4rem; font-size: 0.875rem; }

/* Reports */
.lp .lp-reports { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 0.75rem; }
@media (min-width: 44rem) { .lp .lp-reports { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-reports { grid-template-columns: repeat(4, 1fr); } }
.lp .lp-report { padding: 1.15rem 1.15rem 1.25rem; border: 1px solid var(--rule); border-radius: 0.85rem; background-image: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(230, 241, 250, 0.75)); border-top: 2px solid rgba(78, 142, 162, 0.55); }
.lp .lp-armed .lp-report { opacity: 0; transform: translateY(12px); transition: opacity 520ms ease, transform 520ms ease; }
.lp .lp-armed.is-visible .lp-report { opacity: 1; transform: none; }
.lp .lp-report h3 { font-size: 0.9375rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.lp .lp-report p { margin-top: 0.35rem; font-size: 0.8125rem; line-height: 1.55; color: var(--body); }

/* Local specifics */
.lp .lp-locale { display: grid; grid-template-columns: 1fr; gap: 2rem 3rem; }
@media (min-width: 48rem) { .lp .lp-locale { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-locale-item { padding-left: 1.1rem; border-left: 2px solid rgba(78, 142, 162, 0.45); }

/* Pricing — wider than the rest of the page so dense tables breathe */
.lp .lp-pricing { scroll-margin-top: 5rem; max-width: 90rem; }
.lp .lp-plan-cur { font-family: var(--font-mono); font-size: 0.85rem; font-weight: 600; color: var(--emerald); }
.lp .lp-plan-per { font-size: 0.85rem; color: var(--muted); }
.lp .lp-plan-flag { position: absolute; top: -0.75rem; left: 1.35rem; font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FFFFFF; background-image: linear-gradient(135deg, #49769F, #0A4174); border-radius: 999px; padding: 0.26rem 0.65rem; }
.lp .lp-plan-cta { margin-top: auto; justify-content: center; }
.lp .lp-plans-note { margin-top: 2rem; font-size: 0.78rem; line-height: 1.55; color: var(--muted); }

/* Core-ledger band */
.lp .lp-core { margin-bottom: 2rem; padding: 1.4rem 1.5rem; border: 1px solid rgba(10, 65, 116, 0.22); border-radius: 1rem; background-image: linear-gradient(150deg, rgba(78, 142, 162, 0.10), rgba(78, 142, 162, 0.03)); }
.lp .lp-core-label { font-family: var(--font-mono); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--emerald); margin-bottom: 0.9rem; }
.lp .lp-core-list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 0.55rem 1.5rem; }
@media (min-width: 40rem) { .lp .lp-core-list { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 64rem) { .lp .lp-core-list { grid-template-columns: repeat(3, 1fr); } }
.lp .lp-core-list li { display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.875rem; line-height: 1.4; color: var(--body); }
.lp .lp-core-list svg { flex: none; margin-top: 0.1rem; color: var(--emerald); }

/* Base plan cards — big, detailed, Hostinger-style */
.lp .lp-bases { display: grid; grid-template-columns: 1fr; gap: 1.5rem; align-items: stretch; padding-top: 1rem; }
@media (min-width: 44rem) { .lp .lp-bases { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-bases { grid-template-columns: repeat(3, 1fr); } }
.lp .lp-tier { position: relative; display: flex; flex-direction: column; padding: 2.25rem 2rem; border: 1px solid var(--rule); border-radius: 1.5rem; background-image: linear-gradient(168deg, rgba(255, 255, 255, 0.98), rgba(233, 242, 250, 0.85)); box-shadow: 0 24px 48px -34px rgba(0, 29, 57, 0.4); transition: transform 260ms cubic-bezier(0.16, 1, 0.3, 1), box-shadow 260ms ease, border-color 260ms ease; }
.lp .lp-tier:hover { transform: translateY(-10px); border-color: rgba(73, 118, 159, 0.65); box-shadow: 0 40px 70px -30px rgba(0, 29, 57, 0.55); z-index: 2; }
/* Accent edge on every tier: a hairline of amber running into violet across the
   top of the card, tucked inside the rounded corner. */
.lp .lp-tier::before { content: ""; position: absolute; left: 1.75rem; right: 1.75rem; top: -1px; height: 3px; border-radius: 0 0 3px 3px;
  background: linear-gradient(90deg, var(--amber), var(--amber-lo) 38%, var(--violet-lo) 72%, var(--violet)); opacity: 0.9; }
.lp .lp-tier:hover { border-color: rgba(98, 65, 220, 0.42); }
.lp .lp-tier.is-popular { border-color: transparent; box-shadow: 0 0 0 2px var(--violet), 0 34px 60px -30px rgba(98, 65, 220, 0.45); background-image: linear-gradient(168deg, #FFFFFF, #F1EDFD); }
.lp .lp-tier.is-popular::before { left: 1.25rem; right: 1.25rem; height: 4px; opacity: 1; }
@media (min-width: 68rem) { .lp .lp-tier.is-popular { transform: scale(1.04); } .lp .lp-tier.is-popular:hover { transform: scale(1.04) translateY(-10px); } }
.lp .lp-tier.is-popular:hover { box-shadow: 0 0 0 2px var(--violet), 0 40px 70px -30px rgba(98, 65, 220, 0.5); }

.lp .lp-tier-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; min-height: 1.6rem; margin-bottom: 0.9rem; }
.lp .lp-tier-badge { font-family: var(--font-sans); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #0A4174; background: rgba(123, 189, 232, 0.3); border-radius: 999px; padding: 0.32rem 0.75rem; }
.lp .lp-tier-badge.is-pop { color: #FFFFFF; background-image: linear-gradient(135deg, #0A4174, #001D39); }
.lp .lp-tier-off { margin-left: auto; font-family: var(--font-sans); font-size: 0.8rem; font-weight: 800; letter-spacing: -0.01em; color: #FFFFFF; background-image: linear-gradient(135deg, #2E7BB8, #0A4174); border-radius: 0.5rem; padding: 0.3rem 0.6rem; box-shadow: 0 6px 14px -6px rgba(10, 65, 116, 0.7); }

.lp .lp-tier-name { font-family: var(--font-sans); font-weight: 800; font-size: 1.7rem; letter-spacing: -0.03em; color: var(--ink); }
.lp .lp-tier-desc { margin-top: 0.35rem; font-size: 0.9rem; line-height: 1.5; color: var(--muted); min-height: 2.7rem; }
.lp .lp-tier-reg { margin-top: 1.35rem; font-size: 1rem; font-weight: 500; color: var(--muted); text-decoration: line-through; text-decoration-color: rgba(74, 108, 142, 0.6); }
.lp .lp-tier-reg-per { font-size: 0.8rem; text-decoration: none; display: inline-block; margin-left: 0.15rem; }
.lp .lp-tier-price { margin-top: 0.2rem; display: flex; align-items: baseline; gap: 0.3rem; color: var(--ink); }
.lp .lp-tier-cur { font-family: var(--font-sans); font-size: 1.1rem; font-weight: 700; color: var(--emerald); }
.lp .lp-tier-amt { font-family: var(--font-sans); font-weight: 800; font-size: 3.1rem; line-height: 1; letter-spacing: -0.04em; }
.lp .lp-tier-per { font-size: 0.95rem; font-weight: 600; color: var(--muted); }
.lp .lp-tier-billed { margin-top: 0.6rem; font-size: 0.78rem; color: var(--muted); min-height: 1.1rem; }
.lp .lp-tier-cta { margin-top: 1.5rem; justify-content: center; width: 100%; }

/* Trust row */
.lp .lp-trust { list-style: none; margin: 0 0 2.25rem; padding: 1rem 1.25rem; display: flex; flex-wrap: wrap; gap: 0.6rem 1.75rem; border: 1px solid var(--rule); border-radius: 0.85rem; background: rgba(255, 255, 255, 0.6); }
.lp .lp-trust li { display: flex; align-items: center; gap: 0.45rem; font-size: 0.82rem; font-weight: 600; color: var(--ink); }
.lp .lp-trust svg { flex: none; color: var(--emerald); }

.lp .lp-tier-group { margin-top: 1.75rem; margin-bottom: 0.75rem; font-family: var(--font-sans); font-size: 0.7rem; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; color: var(--emerald); padding-bottom: 0.6rem; border-bottom: 1px solid var(--rule); }
.lp .lp-tier-feats { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.65rem; }
.lp .lp-tier-feats li { display: flex; align-items: flex-start; gap: 0.55rem; font-size: 0.875rem; line-height: 1.4; color: var(--body); }
.lp .lp-tier-feats svg { flex: none; margin-top: 0.1rem; color: var(--emerald); }
.lp .lp-tier-feats-core li { color: var(--muted); }
.lp .lp-tier-feats-core svg { color: var(--muted); }
.lp .lp-tier-limits { list-style: none; margin: 1.1rem 0 0; padding: 0; display: grid; gap: 0.4rem; }
.lp .lp-tier-limits li { font-size: 0.78rem; color: var(--muted); font-style: italic; }
@media (prefers-reduced-motion: reduce) {
  .lp .lp-tier { transition: none; }
  .lp .lp-tier:hover { transform: none; }
  .lp .lp-tier.is-popular:hover { transform: scale(1.04); }
}

/* Sub-sections within pricing */
.lp .lp-sub { margin-top: 3rem; }
.lp .lp-sub-title { margin-bottom: 0.4rem; }
.lp .lp-sub-lede { margin-top: 0; margin-bottom: 1.5rem; font-size: 0.9rem; }

/* ── Module packs on violet ──────────────────────────────────────────────────
   A contained panel rather than a full-bleed band: this sits inside the pricing
   section, and running it edge to edge would cut the section in half. Same violet
   as the Getting-started band so the two read as one accent, not two.
   Everything inside inverts — the pack cards become translucent white, and amber
   takes over the small emphasis that violet carries elsewhere. */
/* Both tinted panels break out of the pricing section's shell to run the full
   width of the viewport. The calc(50% - 50vw) on each side is measured against
   the shell's content box, which lands the edges exactly on the viewport — and
   .lp already carries overflow-x: clip, so the vw units cannot introduce a
   horizontal scrollbar. Horizontal padding moves to the inner .lp-shell. */
.lp .lp-sub.is-violet, .lp .lp-sub.is-navy {
  margin-inline: calc(50% - 50vw); width: auto; border-radius: 0; padding-inline: 0; }

.lp .lp-sub.is-violet { position: relative; margin-top: 3.5rem; padding-block: 2.5rem 2.25rem; color: #F3EFFE;
  background-image:
    radial-gradient(48rem 24rem at 8% -12%, rgba(138, 114, 232, 0.55), transparent 62%),
    radial-gradient(42rem 24rem at 96% 112%, rgba(255, 192, 30, 0.2), transparent 64%),
    linear-gradient(158deg, #5B37D6 0%, var(--violet) 48%, #4B2FB4 100%); }
@media (min-width: 48rem) { .lp .lp-sub.is-violet { padding-block: 3.25rem 3rem; } }
/* Amber hairline across the top, matching the band and the marquee. Edge to edge
   now, so it fades out at the viewport rather than at a card corner. */
.lp .lp-sub.is-violet::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--amber-lo) 78%, transparent); }

.lp .lp-sub.is-violet .lp-sub-title { color: #FFFFFF; }
.lp .lp-sub.is-violet .lp-sub-lede { color: rgba(243, 239, 254, 0.82); }
.lp .lp-sub.is-violet .lp-pack-group.is-boxed { border-color: rgba(255, 255, 255, 0.2); background-image: linear-gradient(165deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.06)); box-shadow: none; backdrop-filter: blur(2px); }
.lp .lp-sub.is-violet .lp-pack-head { color: #FFFFFF; border-bottom-color: rgba(255, 192, 30, 0.65); }
.lp .lp-sub.is-violet .lp-pricelist li { border-bottom-color: rgba(255, 255, 255, 0.14); }
.lp .lp-sub.is-violet .lp-pl-label { color: rgba(243, 239, 254, 0.86); }
.lp .lp-sub.is-violet .lp-pl-price { color: #FFFFFF; }
.lp .lp-sub.is-violet .lp-pl-cur { color: var(--amber); }
.lp .lp-sub.is-violet .lp-pl-per { color: rgba(243, 239, 254, 0.6); }

/* ── Industry bundles on navy ────────────────────────────────────────────────
   Same panel geometry as the violet one so the two read as a set, in the page's
   own darkest ink rather than a new hue. The content here is a table, so the
   inversion is about rules and cell colour rather than cards. */
.lp .lp-sub.is-navy { position: relative; margin-top: 3.5rem; padding-block: 2.5rem 2.25rem; color: #E4EEF7;
  background-image:
    radial-gradient(46rem 24rem at 6% -14%, rgba(78, 142, 162, 0.35), transparent 62%),
    radial-gradient(40rem 24rem at 98% 114%, rgba(98, 65, 220, 0.28), transparent 64%),
    linear-gradient(158deg, #052A4E 0%, var(--ink) 52%, #001527 100%); }
@media (min-width: 48rem) { .lp .lp-sub.is-navy { padding-block: 3.25rem 3rem; } }
.lp .lp-sub.is-navy::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--violet-lo) 78%, transparent); }

.lp .lp-sub.is-navy .lp-sub-title { color: #FFFFFF; }
.lp .lp-sub.is-navy .lp-sub-lede { color: rgba(228, 238, 247, 0.78); }
/* The scroll container carries the table's own frame — drop it to translucent so
   the panel gradient reads through rather than sitting behind a white slab. */
.lp .lp-sub.is-navy .lp-table-scroll { border-color: rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.05); }
.lp .lp-sub.is-navy .lp-ptable th, .lp .lp-sub.is-navy .lp-ptable td { border-bottom-color: rgba(255, 255, 255, 0.13); }
.lp .lp-sub.is-navy .lp-ptable thead th { color: rgba(228, 238, 247, 0.6); }
.lp .lp-sub.is-navy .lp-ptable tbody th { color: #FFFFFF; }
.lp .lp-sub.is-navy .lp-ptable td { color: rgba(228, 238, 247, 0.82); }
.lp .lp-sub.is-navy .lp-price-em { color: var(--amber); }

/* Pack groups */
.lp .lp-packs { display: grid; grid-template-columns: 1fr; gap: 1.5rem 2.5rem; }
@media (min-width: 44rem) { .lp .lp-packs { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-packs { grid-template-columns: repeat(3, 1fr); } }
.lp .lp-packs-two { grid-template-columns: 1fr; }
@media (min-width: 52rem) { .lp .lp-packs-two { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-pack-group.is-boxed { padding: 1.35rem 1.4rem; border: 1px solid var(--rule); border-radius: 1rem; background-image: linear-gradient(165deg, rgba(255, 255, 255, 0.95), rgba(233, 242, 250, 0.7)); box-shadow: 0 16px 32px -30px rgba(0, 29, 57, 0.4); }
.lp .lp-pack-head { font-family: var(--font-serif); font-size: 1.02rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; margin-bottom: 0.5rem; padding-bottom: 0.6rem; border-bottom: 2px solid rgba(78, 142, 162, 0.4); }

/* Price list rows */
.lp .lp-pricelist { list-style: none; margin: 0; padding: 0; }
.lp .lp-pricelist li { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: 0.6rem 0; border-bottom: 1px solid var(--rule); }
.lp .lp-pricelist li:last-child { border-bottom: none; }
.lp .lp-pl-label { font-size: 0.85rem; line-height: 1.4; color: var(--body); }
.lp .lp-pl-price { flex: none; display: inline-flex; align-items: baseline; gap: 0.25rem; font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.lp .lp-pl-cur { font-size: 0.62rem; font-weight: 600; letter-spacing: 0.03em; color: var(--emerald); }
.lp .lp-pl-per { font-size: 0.66rem; font-weight: 500; color: var(--muted); }
.lp .lp-pl-price-text { font-weight: 600; font-size: 0.8rem; color: var(--emerald); }
.lp .lp-pricelist-boxed { border: 1px solid var(--rule); border-radius: 0.85rem; padding: 0.4rem 1.1rem; background: rgba(255, 255, 255, 0.6); }

/* Price tables */
.lp .lp-table-scroll { overflow-x: auto; border: 1px solid var(--rule); border-radius: 1rem; background: rgba(255, 255, 255, 0.65); }
.lp .lp-ptable { width: 100%; min-width: 40rem; border-collapse: collapse; font-size: 0.875rem; }
.lp .lp-ptable th, .lp .lp-ptable td { padding: 0.8rem 1rem; text-align: left; border-bottom: 1px solid var(--rule); }
.lp .lp-ptable thead th { font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.lp .lp-ptable tbody th { font-weight: 600; color: var(--ink); }
.lp .lp-ptable td { color: var(--body); }
.lp .lp-ptable tr:last-child th, .lp .lp-ptable tr:last-child td { border-bottom: none; }
.lp .lp-th-wide { width: 45%; }
.lp .lp-num-col { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.lp .lp-strike { color: var(--muted); text-decoration: line-through; }
.lp .lp-price-em { color: var(--ink); font-weight: 700; }

/* Micro add-ons + services split */
.lp .lp-sub-split { display: grid; grid-template-columns: 1fr; gap: 2.5rem; }
@media (min-width: 52rem) { .lp .lp-sub-split { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-sub-split > div > .lp-sub-title { margin-top: 0; }

/* Controls */
.lp .lp-controls { display: grid; grid-template-columns: 1fr; gap: 1px; background: var(--rule); border: 1px solid var(--rule); border-radius: 1rem; overflow: hidden; box-shadow: 0 24px 48px -36px rgba(0, 29, 57, 0.5); }
@media (min-width: 48rem) { .lp .lp-controls { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-control { background-image: linear-gradient(160deg, #FFFFFF 0%, #F2F8FD 100%); padding: 1.6rem 1.5rem; }
.lp .lp-armed .lp-control { opacity: 0; transform: translateY(14px); transition: opacity 600ms ease, transform 600ms ease; }
.lp .lp-armed.is-visible .lp-control { opacity: 1; transform: none; }
.lp .lp-control dt { font-size: 0.95rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.lp .lp-control dd { margin: 0.45rem 0 0; font-size: 0.875rem; line-height: 1.6; color: var(--body); }

/* Close — the page's green deepens into one last panel */
.lp .lp-closing { margin-block: clamp(2rem, 5vw, 3rem) clamp(3rem, 7vw, 4.5rem); padding: clamp(2.5rem, 6vw, 4rem); border-radius: 1.5rem; background-image: linear-gradient(135deg, #001D39 0%, #0A4174 55%, #4E8EA2 100%); display: flex; flex-direction: column; align-items: flex-start; gap: 1.75rem; box-shadow: 0 40px 70px -42px rgba(0, 29, 57, 0.6); }
.lp .lp-closing-h { max-width: none; color: #FFFFFF; }
.lp .lp-closing-lede { max-width: 40rem; margin: 1rem auto 1.75rem; font-size: 1rem; line-height: 1.6; color: rgba(255, 255, 255, 0.82); }
.lp .lp-closing-note { margin-top: 1.15rem; font-size: 0.8125rem; color: rgba(255, 255, 255, 0.7); }
/* Inline "log in" escape hatch — present for returning users without competing
   with the primary signup action. */
.lp .lp-note-link { color: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
.lp .lp-note-link:hover { opacity: 0.8; }
.lp .lp-closing .lp-btn { background-image: linear-gradient(135deg, #FFFFFF 0%, #D6E9F6 100%); color: #062A4D; box-shadow: 0 12px 26px -14px rgba(0, 0, 0, 0.5); }
.lp .lp-closing .lp-btn:focus-visible { outline-color: #FFFFFF; }
.lp .lp-footer { border-top: 1px solid var(--rule); background: rgba(255, 255, 255, 0.55); }

/* Motion
   Hero entrance runs as two animations on different clocks: the element pops
   forward out of depth on a short, slightly overshooting curve, while the opacity
   comes up on its own much longer ramp. Splitting them is the whole effect —
   things arrive in space well before they arrive in colour, which reads as
   dimensional rather than as a plain slide-and-fade. */
/* The two hero columns fly in from opposite sides and meet in the middle: the copy
   swings in from the left, the ledger card from the right, each rotating on Y out
   of depth so the movement reads as dimensional rather than as a slide. The
   overshoot in the easing is what makes them pop as they land. */
@keyframes lp-in-left {
  from { transform: perspective(1200px) translate3d(-120px, 14px, -260px) rotateY(16deg) rotateX(5deg) scale(0.94); }
  to   { transform: perspective(1200px) translate3d(0, 0, 0) rotateY(0deg) rotateX(0deg) scale(1); }
}
@keyframes lp-in-right {
  from { transform: perspective(1200px) translate3d(120px, 14px, -260px) rotateY(-16deg) rotateX(5deg) scale(0.94); }
  to   { transform: perspective(1200px) translate3d(0, 0, 0) rotateY(0deg) rotateX(0deg) scale(1); }
}
/* Opacity runs on its own, much longer ramp than the movement — things arrive in
   space well before they arrive in colour, which is what makes it feel slow. */
@keyframes lp-fade-slow { from { opacity: 0; } to { opacity: 1; } }
@keyframes lp-row-in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }

.lp .lp-fade { opacity: 0; transform-origin: 100% 50%; backface-visibility: hidden;
  animation:
    lp-in-left 1250ms cubic-bezier(0.22, 1.12, 0.36, 1) forwards,
    lp-fade-slow 1900ms cubic-bezier(0.33, 0, 0.2, 1) forwards; }
.lp .lp-row-in { opacity: 0; animation: lp-row-in 520ms cubic-bezier(0.16, 1, 0.3, 1) forwards; }

/* Hero ledger — pops in out of depth, then drifts forever like paper on a desk.
   lp-float is declared last so it owns the transform once its delay elapses; until
   then lp-pop-3d holds the entrance, which is why that one uses "both". */
@keyframes lp-float { 0%, 100% { transform: translateY(0) rotate(-0.15deg); } 50% { transform: translateY(-12px) rotate(0.15deg); } }
.lp .lp-ledger-anim { opacity: 0; transform-origin: 0% 50%; backface-visibility: hidden;
  animation:
    lp-in-right 1250ms cubic-bezier(0.22, 1.12, 0.36, 1) 260ms both,
    lp-fade-slow 2000ms cubic-bezier(0.33, 0, 0.2, 1) 260ms forwards,
    lp-float 7s ease-in-out 1.9s infinite; }

/* Promo bar — a slow light sweep passes across the offer */
@keyframes lp-sheen { 0% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
.lp .lp-ticker::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(105deg, transparent 30%, rgba(255, 255, 255, 0.45) 48%, rgba(255, 255, 255, 0.45) 52%, transparent 70%); transform: translateX(-120%); animation: lp-sheen 5.5s ease-in-out 1.5s infinite; }

/* "both" — the gradient itself pans back and forth */
/* ── Kinetic typography ──────────────────────────────────────────────────────
   Two reveals, same idea: the text sits in a box that clips, and travels up into
   it. The clipped edge is what makes it read as typography rather than as a fade.

   overflow: hidden would otherwise cut descenders (g, y, p) at the baseline, so
   each box carries a little bottom padding and aligns on its bottom edge — that
   moves the mask below the baseline without shifting the line. */

/* Hero: line by line, on a delay set per line in the markup. */
@keyframes lp-line-rise {
  from { transform: translateY(108%) rotateX(-38deg); opacity: 0; }
  to   { transform: translateY(0) rotateX(0deg); opacity: 1; }
}
.lp .lp-kinetic { perspective: 800px; }
.lp .lp-line { display: block; overflow: hidden; padding-bottom: 0.09em; margin-bottom: -0.09em; }
.lp .lp-line-i { display: block; transform-origin: 50% 0; will-change: transform, opacity;
  animation: lp-line-rise 1150ms cubic-bezier(0.19, 1, 0.22, 1) both; }

/* Per-section 3D entrance. Angles and depth are deliberately small: these elements
   are often 1000px+ tall, and a rotateX that looks good on a card turns into heavy
   keystone distortion across a whole section. transform-origin sits at the top edge
   so the section hinges down from where the reader already is, rather than pivoting
   about a centre that may be off-screen. */
.lp .lp-s3d { opacity: 0; transform-origin: 50% 0;
  transform: perspective(1800px) rotateX(4.5deg) translate3d(0, 34px, -70px);
  transition: transform 1150ms cubic-bezier(0.19, 1, 0.22, 1), opacity 850ms ease;
  will-change: transform, opacity; }
.lp .lp-s3d.is-in { opacity: 1; transform: none; }

/* Section headings: word by word, released when the heading scrolls into view. */
.lp .lp-split { perspective: 800px; }
.lp .lp-split-w { display: inline-block; overflow: hidden; vertical-align: bottom; padding-bottom: 0.1em; margin-bottom: -0.1em; }
.lp .lp-split-i { display: inline-block; transform: translateY(112%) rotateX(-42deg); opacity: 0; transform-origin: 50% 0;
  transition: transform 820ms cubic-bezier(0.19, 1, 0.22, 1), opacity 620ms ease; }
.lp .lp-split.is-shown .lp-split-i { transform: translateY(0) rotateX(0deg); opacity: 1; }

/* The emphasised word carries a gradient that keeps moving, so the headline has
   one point of continuous motion after the reveal has settled. Amber and violet
   are woven in so it belongs to the same accent system as the rest of the page. */
@keyframes lp-gradient-pan { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
/* One definition shared by the hero's emphasised word and any heading accent, so
   the two can never drift apart. Clipping a gradient to text needs the fill made
   transparent — hence both the standard and -webkit- properties. */
.lp .lp-h1 em, .lp .lp-grad {
  font-style: italic;
  background-image: linear-gradient(100deg, #49769F 0%, var(--violet) 32%, #6EA2B3 58%, var(--amber) 78%, #0A4174 100%);
  background-size: 280% 100%;
  -webkit-background-clip: text; background-clip: text;
  color: transparent; -webkit-text-fill-color: transparent;
  animation: lp-gradient-pan 7s ease-in-out infinite; }

/* On the violet band the cool half of that ramp disappears into the background,
   so the accent there runs amber into white instead. */
.lp .lp-band .lp-grad { background-image: linear-gradient(100deg, #FFFFFF 0%, var(--amber) 34%, #FFF3D0 62%, var(--amber-lo) 100%); }

/* Balanced badge — the tick gives one satisfied pulse on loop */
@keyframes lp-pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(123, 189, 232, 0.5); } 70%, 100% { box-shadow: 0 0 0 8px rgba(123, 189, 232, 0); } }
.lp .lp-balance-value { border-radius: 999px; animation: lp-pulse-ring 3.5s ease-out 2s infinite; }

@media (prefers-reduced-motion: reduce) {
  .lp .lp-fade, .lp .lp-row-in { animation: none; opacity: 1; transform: none; }
  .lp .lp-ledger-anim { animation: none; opacity: 1; transform: none; }
  .lp .lp-ticker::after, .lp .lp-h1 em, .lp .lp-grad, .lp .lp-balance-value { animation: none; }
  /* useSection3d never adds its class in this mode, but pin the values anyway so
     nothing depends on that hook having run. */
  .lp .lp-s3d { opacity: 1; transform: none; transition: none; }
  /* The popup still appears, it just doesn't travel to get there. */
  .lp .lp-pop { transition: none; transform: none; }
  .lp .lp-pop-wrap.is-open .lp-pop { transform: none; }
  /* Headlines land already revealed; the masks stay but nothing travels. */
  .lp .lp-line-i { animation: none; transform: none; opacity: 1; }
  .lp .lp-split-i { transition: none; transform: none; opacity: 1; }
  /* useScrollZoom bails out early here, so --lp-zoom stays 0 — pin the derived
     values anyway so nothing depends on that hook having run. */
  .lp .lp-video { transform: none; filter: none; opacity: 1; }
  .lp .lp-stage .lp-hero { transform: none; opacity: 1; }
  /* GettingStarted renders every step complete in this mode; kill the motion that
     would otherwise still run on the dot and rail. */
  .lp .lp-start-dot, .lp .lp-start-spin, .lp .lp-start-step.is-live { animation: none; transform: none; }
  .lp .lp-start-spin { opacity: 0; }
  .lp .lp-start-rail-fill, .lp .lp-start-dot, .lp .lp-start-dot > * { transition: none; }
  /* Marquee holds still and wraps to the visible offers instead of scrolling. */
  .lp .lp-ticker-track { animation: none; width: 100%; }
  .lp .lp-ticker-run:nth-child(2) { display: none; }
  .lp .lp-ticker-window { overflow-x: auto; -webkit-mask-image: none; mask-image: none; }
  .lp .lp-h1 em { background-position: 0% 50%; }
  .lp .lp-armed .lp-group, .lp .lp-armed .lp-control,
  .lp .lp-armed .lp-step, .lp .lp-armed .lp-report { opacity: 1; transform: none; transition: none; }
  .lp .lp-btn:hover { transform: none; }
}
`;
