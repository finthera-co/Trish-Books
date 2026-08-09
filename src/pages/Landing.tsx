import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import LandingChat from "@/components/landing/LandingChat";
import {
  ArrowRight, Check, Tag, X, Menu,
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

/* Gives a section its own entrance as it scrolls into view — the same idea as the
   hero, but triggered by position rather than page load: the section rises the
   last few centimetres into place and comes up to full opacity.

   Fired early, at a 12% negative bottom margin, so the movement is finished by the
   time the section is properly in the reading area. A reveal the reader has to
   wait on is a reveal they are watching instead of reading.

   The class is added from JS rather than sitting in the markup, so a section is
   never left transformed-and-invisible if this never runs. Same safety timeout as
   useReveal for the case where the observer stays quiet.                        */
function useSectionRise<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    el.classList.add("lp-srise");
    const show = () => el.classList.add("is-in");

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          show();
          io.disconnect();
        }
      },
      { threshold: 0, rootMargin: "0px 0px -12% 0px" },
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

/* Writes 0→1 into --lp-p as the element travels through the viewport: 0 when its
   top edge reaches the bottom of the screen, 1 when its bottom edge reaches the
   top. Same shape as useScrollZoom — one rAF-throttled custom-property write, and
   everything that moves is expressed in CSS off that number.

   Used to pan the product gallery sideways as the page scrolls past it, which is a
   scroll-linked animation rather than a scroll hijack: the page never stops
   scrolling normally. */
function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const span = window.innerHeight + rect.height || 1;
      const travelled = window.innerHeight - rect.top;
      el.style.setProperty("--lp-p", Math.min(Math.max(travelled / span, 0), 1).toFixed(4));
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

/* The product itself, in three screens. Files live in public/media, named 1, 2, 3
   in the order they appear here.

   Each entry lists candidate extensions rather than one filename: a screenshot may
   be saved as .png or .jpg depending on where it came from, and the component walks
   the list on error. If none load, the frame collapses to a placeholder rather than
   showing a broken-image icon on a production page. */
const SHOT_EXTS = [".png", ".jpg", ".jpeg", ".webp"];

const SHOTS = [
  {
    base: "/media/1",
    alt: "Cash flow dashboard showing monthly inflows, outflows and the net trend",
    title: "Cash flow, month by month",
    body: "Money in against money out, with the net trend overlaid and the best month called out.",
  },
  {
    base: "/media/2",
    alt: "Monthly profit trend with net margin, income versus expenses, and a live transaction feed",
    title: "Profit and margin together",
    body: "Net profit per month with net-margin % on its own axis, beside a live feed of what just posted.",
  },
  {
    base: "/media/3",
    alt: "Journal entries list with search, status and source filters",
    title: "Every entry, searchable",
    body: "Ten thousand entries or ten — filter by status and source, and open any one to its lines.",
  },
];

/**
 * Pinned horizontal gallery.
 *
 * The stage is a tall spacer; the panel inside it sticks to the top of the viewport
 * while that spacer passes. Scroll during that window drives the track sideways, and
 * once the last screen is reached the stage ends and the page carries on downwards.
 *
 * The stage's height is set from the track's own overflow rather than hard-coded, so
 * the sideways distance matches the vertical distance one-to-one — the row moves at
 * the speed the wheel is turned, and the section is never taller than it needs to be
 * for the number of screens in SHOTS.
 */
function ProductGallery() {
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Which extension each shot is currently trying. Advanced by onError until the
  // candidates run out, at which point the frame shows a placeholder.
  const [extIdx, setExtIdx] = useState<Record<string, number>>({});

  useEffect(() => {
    const stage = stageRef.current;
    const track = trackRef.current;
    if (!stage || !track) return;
    if (prefersReducedMotion()) return; // plain horizontal scroll instead; see CSS

    let frame = 0;
    let overflow = 0;

    const measure = () => {
      overflow = Math.max(0, track.scrollWidth - window.innerWidth);
      // Vertical room needed = one screen to read it in, plus the sideways distance.
      stage.style.height = `${window.innerHeight + overflow}px`;
    };

    const update = () => {
      frame = 0;
      const rect = stage.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = span > 0 ? Math.min(Math.max(-rect.top / span, 0), 1) : 0;
      stage.style.setProperty("--lp-x", `${-(overflow * p)}px`);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onResize = () => {
      measure();
      onScroll();
    };

    measure();
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });

    // Images arrive after first paint and change the track width, so re-measure
    // when the layout settles rather than trusting the initial reading.
    const ro = new ResizeObserver(onResize);
    ro.observe(track);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="lp-shots-stage" ref={stageRef}>
      <div className="lp-shots-pin">
        <div className="lp-shots-track" ref={trackRef}>
        {SHOTS.map((shot) => {
          const i = extIdx[shot.base] ?? 0;
          const exhausted = i >= SHOT_EXTS.length;
          return (
          <figure className="lp-shot" key={shot.base}>
            <div className="lp-shot-frame">
              {/* Chrome bar, so the screenshot reads as an application window. */}
              <span className="lp-shot-bar" aria-hidden="true">
                <i /><i /><i />
              </span>
              {/* Fixed-ratio canvas so every frame is the same size regardless of
                  how the screenshot was cropped. */}
              <div className="lp-shot-canvas">
                {exhausted ? (
                  <div className="lp-shot-missing" aria-hidden="true" />
                ) : (
                  <img
                    // key forces a fresh element per candidate, so the browser
                    // actually retries instead of reusing the failed one.
                    key={SHOT_EXTS[i]}
                    src={`${shot.base}${SHOT_EXTS[i]}`}
                    alt={shot.alt}
                    loading="lazy"
                    decoding="async"
                    onError={() => setExtIdx((m) => ({ ...m, [shot.base]: (m[shot.base] ?? 0) + 1 }))}
                  />
                )}
              </div>
            </div>
            <figcaption>
              <p className="lp-shot-title">{shot.title}</p>
              <p className="lp-shot-body">{shot.body}</p>
            </figcaption>
          </figure>
          );
        })}
        </div>
      </div>
    </div>
  );
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
      { threshold: 0, rootMargin: "0px 0px -12% 0px" },
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

/* ── Document specimens ──────────────────────────────────────────────────────
   Mockups of the two documents the system actually issues, laid out with the same
   field set the real generators use — the statutory tax invoice from
   src/lib/taxInvoiceData.ts (Gazette 2481/2022: supplier and purchaser TIN, date of
   supply, place of supply, nature of each line, amount in words) and the payment
   receipt from src/lib/receiptPdf.ts.

   The figures follow the compound rule in src/lib/taxEngine.ts — SSCL applies to the
   value of supply, then VAT applies to the SSCL-inclusive total:

     100,000.00  value of supply
     + 2,500.00  SSCL @ 2.5%
     ----------
       102,500.00  total value of supply
     + 18,450.00  VAT @ 18%  (102,500 × 0.18)
     ----------
       120,950.00  total including VAT

   Everything here is a specimen: the TINs and registration numbers are
   format-correct placeholders, not anyone's real numbers, and each sheet is
   labelled as a sample so it can't be mistaken for an issued document.        */
const SPEC_TOTALS = {
  valueOfSupply: 100_000,
  ssclRate: 2.5,
  sscl: 2_500,
  totalValueOfSupply: 102_500,
  vatRate: 18,
  vat: 18_450,
  total: 120_950,
  inWords: "One Lakh Twenty Thousand Nine Hundred Fifty Rupees and Zero Cents",
};

const SPEC_LINES = [
  {
    reference: "SVC-1042",
    description: "Management accounting retainer — March 2026",
    nature: "Service",
    qty: 1,
    unitPrice: 80_000,
    amount: 80_000,
  },
  {
    reference: "SVC-1043",
    description: "Statutory reporting & VAT return preparation",
    nature: "Service",
    qty: 2,
    unitPrice: 10_000,
    amount: 20_000,
  },
];

/* Footer link groups, numbered like account ranges to match the chart-of-accounts
   section. Every destination is real — an anchor on this page or one of the four
   public routes. Nothing here points at a page that doesn't exist yet. */
const FOOT_GROUPS: { code: string; title: string; links: [string, string][] }[] = [
  {
    code: "1000",
    title: "The ledger",
    links: [
      ["Chart of accounts", "#ledger"],
      ["Month-end close", "#close"],
      ["Reports & statements", "#reports"],
    ],
  },
  {
    code: "2000",
    title: "Compliance",
    links: [
      ["Sri Lankan tax", "#sri-lanka"],
      ["Invoice & receipt", "#documents"],
      ["Audit controls", "#controls"],
    ],
  },
  {
    code: "3000",
    title: "Pricing",
    links: [
      ["Packages & plans", "#pricing"],
      ["Getting started", "#getting-started"],
    ],
  },
  {
    code: "4000",
    title: "Account",
    links: [
      ["Start free", "/signup"],
      ["Log in", "/login"],
      ["Reset password", "/reset-password"],
    ],
  },
];

function TaxInvoiceSpecimen() {
  return (
    <article className="lp-doc" aria-label="Sample tax invoice">
      <span className="lp-doc-stamp">Specimen</span>

      <header className="lp-doc-top">
        <div>
          <p className="lp-doc-co">Trish Books Advisory (Pvt) Ltd</p>
          <p className="lp-doc-sm">No. 42, Janadhipathi Mawatha, Colombo 01</p>
          <p className="lp-doc-sm">TIN 104567890-7000 · BR No. PV 128394</p>
        </div>
        <div className="lp-doc-title-wrap">
          <p className="lp-doc-title">TAX INVOICE</p>
          <p className="lp-doc-sm">No. INV-2026-0418</p>
        </div>
      </header>

      {/* The gazette requires both parties' TIN, and the date of supply stated
          separately from the invoice date. */}
      <div className="lp-doc-grid">
        <div>
          <p className="lp-doc-lbl">Purchaser</p>
          <p className="lp-doc-strong">Ceylon Robotics (Pvt) Ltd</p>
          <p className="lp-doc-sm">No. 7, Duplication Road, Colombo 04</p>
          <p className="lp-doc-sm">TIN 117654321-7000</p>
        </div>
        <div className="lp-doc-meta">
          <p><span>Date of invoice</span><b>03/31/2026</b></p>
          <p><span>Date of supply</span><b>03/31/2026</b></p>
          <p><span>Place of supply</span><b>Colombo, Sri Lanka</b></p>
          <p><span>Mode of payment</span><b>Bank transfer</b></p>
        </div>
      </div>

      <table className="lp-doc-table">
        <thead>
          <tr>
            <th>Ref</th>
            <th>Description of Services</th>
            <th>Nature</th>
            <th className="lp-doc-r">Qty</th>
            <th className="lp-doc-r">Unit price</th>
            <th className="lp-doc-r">Amount (excl. VAT)</th>
          </tr>
        </thead>
        <tbody>
          {SPEC_LINES.map((l) => (
            <tr key={l.reference}>
              <td className="lp-doc-mono">{l.reference}</td>
              <td>{l.description}</td>
              <td>{l.nature}</td>
              <td className="lp-doc-r lp-doc-mono">{l.qty}</td>
              <td className="lp-doc-r lp-doc-mono">{money(l.unitPrice)}</td>
              <td className="lp-doc-r lp-doc-mono">{money(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="lp-doc-sum">
        <p><span>Value of supply</span><b>{money(SPEC_TOTALS.valueOfSupply)}</b></p>
        <p><span>SSCL @ {SPEC_TOTALS.ssclRate}%</span><b>{money(SPEC_TOTALS.sscl)}</b></p>
        <p className="lp-doc-sum-rule">
          <span>Total value of supply</span><b>{money(SPEC_TOTALS.totalValueOfSupply)}</b>
        </p>
        <p><span>VAT @ {SPEC_TOTALS.vatRate}%</span><b>{money(SPEC_TOTALS.vat)}</b></p>
        <p className="lp-doc-sum-total">
          <span>Total including VAT (LKR)</span><b>{money(SPEC_TOTALS.total)}</b>
        </p>
      </div>

      <p className="lp-doc-words">
        <span className="lp-doc-lbl">Amount in words</span>
        {SPEC_TOTALS.inWords}
      </p>

      <p className="lp-doc-foot">
        Issued under the Value Added Tax Act. Tax invoice format per Gazette
        Extraordinary No. 2481/22.
      </p>
    </article>
  );
}

function ReceiptSpecimen() {
  return (
    <article className="lp-doc" aria-label="Sample payment receipt">
      <span className="lp-doc-stamp">Specimen</span>

      <header className="lp-doc-top">
        <div>
          <p className="lp-doc-co">Trish Books Advisory (Pvt) Ltd</p>
          <p className="lp-doc-sm">No. 42, Janadhipathi Mawatha, Colombo 01</p>
          <p className="lp-doc-sm">TIN 104567890-7000</p>
        </div>
        <div className="lp-doc-title-wrap">
          <p className="lp-doc-title">PAYMENT RECEIPT</p>
          <p className="lp-doc-sm">No. RCP-2026-0117</p>
        </div>
      </header>

      <div className="lp-doc-grid">
        <div>
          <p className="lp-doc-lbl">Received from</p>
          <p className="lp-doc-strong">Ceylon Robotics (Pvt) Ltd</p>
          <p className="lp-doc-sm">No. 7, Duplication Road, Colombo 04</p>
        </div>
        <div className="lp-doc-amt">
          <p className="lp-doc-lbl">Amount received</p>
          <p className="lp-doc-amt-val">LKR {money(SPEC_TOTALS.total)}</p>
          <p className="lp-doc-sm">Received on 04/02/2026</p>
        </div>
      </div>

      <table className="lp-doc-table">
        <thead>
          <tr>
            <th>Invoice #</th>
            <th>Payment method</th>
            <th>Reference</th>
            <th className="lp-doc-r">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="lp-doc-mono">INV-2026-0418</td>
            <td>Bank transfer</td>
            <td className="lp-doc-mono">SAMP/0402/9931</td>
            <td className="lp-doc-r lp-doc-mono">{money(SPEC_TOTALS.total)}</td>
          </tr>
        </tbody>
      </table>

      <div className="lp-doc-sum">
        <p><span>Amount received</span><b>{money(SPEC_TOTALS.total)}</b></p>
        <p className="lp-doc-sum-total"><span>Balance due (LKR)</span><b>0.00</b></p>
      </div>

      <p className="lp-doc-words">
        <span className="lp-doc-lbl">Amount in words</span>
        {SPEC_TOTALS.inWords}
      </p>

      <div className="lp-doc-sign">
        <span />
        <p className="lp-doc-sm">Authorised signature</p>
      </div>
    </article>
  );
}

const DOC_CYCLE_MS = 6000;

/* Alternates the two sheets: each pops in, holds, then fades out as the next
   arrives. Gated on visibility so the cycle isn't already part-way through by the
   time the section is reached. */
function DocumentShowcase() {
  const [idx, setIdx] = useState(0);
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // The sheet drifts against the page as the section passes, which separates it
  // from the band behind it. Scroll-linked rather than triggered, so it keeps
  // answering the scroll for as long as the section is on screen.
  const parallaxRef = useScrollProgress<HTMLDivElement>();
  const docs = ["Tax invoice", "Payment receipt"];

  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion()) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArmed(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!armed) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % 2), DOC_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [armed]);

  return (
    <div className="lp-docs" ref={ref}>
      {/* Both sheets stay mounted and stacked; only the active one is shown, so the
          block never changes height as they swap. */}
      <div className="lp-docs-stack" ref={parallaxRef}>
        <div className={`lp-docs-slot${idx === 0 ? " is-live" : ""}`} aria-hidden={idx !== 0}>
          <TaxInvoiceSpecimen />
        </div>
        <div className={`lp-docs-slot${idx === 1 ? " is-live" : ""}`} aria-hidden={idx !== 1}>
          <ReceiptSpecimen />
        </div>
      </div>

      <div className="lp-docs-tabs" role="tablist" aria-label="Document samples">
        {docs.map((d, i) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={idx === i}
            className={`lp-docs-tab${idx === i ? " is-on" : ""}`}
            onClick={() => {
              setArmed(false); // stop the carousel once a choice is made
              setIdx(i);
            }}
          >
            {d}
          </button>
        ))}
      </div>
    </div>
  );
}

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
  step = 90,
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

/* The star. A sale sticker in the oldest sense — a spiked burst stamped on the
   corner of the page, carrying the single best number in the offer. It turns on
   its own axis in 3D, the way a card hung on a thread does, so it reads as an
   object sitting in front of the page rather than a graphic printed on it.
   Dismissible, and it remembers nothing: it is the loudest thing here, so it
   must also be the easiest to be rid of. */
function StarAd({
  best,
  onPricing,
}: {
  best: number;
  onPricing: (e: React.MouseEvent) => void;
}) {
  const [gone, setGone] = useState(false);
  const [shown, setShown] = useState(false);

  // Held back a beat so it lands after the hero, not against it.
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 1400);
    return () => window.clearTimeout(t);
  }, []);

  if (!PROMO.active || gone) return null;

  return (
    <div className={`lp-star-wrap${shown ? " is-in" : ""}`}>
      <a
        href="#pricing"
        className="lp-star"
        onClick={onPricing}
        aria-label={`Launch offer: up to ${best} percent off. See packages and pricing.`}
      >
        <span className="lp-star-face" aria-hidden="true">
          <span className="lp-star-up">Save up to</span>
          <span className="lp-star-num">{best}%</span>
          <span className="lp-star-sub">launch offer</span>
        </span>
      </a>
      <button
        type="button"
        className="lp-star-x"
        onClick={() => setGone(true)}
        aria-label="Dismiss offer"
      >
        <X className="w-3 h-3" />
      </button>
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
  // One entrance per section. Separate refs rather than a loop, since hooks
  // can't be called conditionally or iteratively.
  const sRiseBalance = useSectionRise<HTMLDivElement>();
  const sRiseCoa = useSectionRise<HTMLDivElement>();
  const sRiseClose = useSectionRise<HTMLElement>();
  const sRiseReports = useSectionRise<HTMLElement>();
  const sRiseLocal = useSectionRise<HTMLElement>();
  const sRiseDocs = useSectionRise<HTMLElement>();
  const sRiseShots = useSectionRise<HTMLElement>();
  const sRiseStart = useSectionRise<HTMLElement>();
  const sRisePricing = useSectionRise<HTMLElement>();
  const sRiseClosing = useSectionRise<HTMLElement>();
  const sRiseControls = useSectionRise<HTMLDivElement>();
  const sRiseFooter = useSectionRise<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Hold the poster frame instead of playing when motion is unwelcome.
  useEffect(() => {
    if (prefersReducedMotion()) videoRef.current?.pause();
  }, []);

  // Mobile menu: lock body scroll while open and close on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Plans carrying an offer, in price order — drives the marquee.
  const discountedPlans = useMemo(
    () =>
      BASE_PLANS.map((p) => ({ ...p, ...(discountFor(p) ?? {}) }))
        .filter((p): p is typeof p & { list: number; percent: number } => "percent" in p)
        .sort((a, b) => a.monthly - b.monthly),
    [],
  );

  // Headline discount, so the closing CTA and the marquee always quote the same
  // number — and it disappears cleanly if the offer is switched off.
  const bestDiscount = discountedPlans.length
    ? Math.max(...discountedPlans.map((p) => p.percent))
    : 0;

  const scrollToPricing = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById("pricing")?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <div className="lp min-h-screen text-[#141413] antialiased">
      <style>{css}</style>

      {/* ── Announcement marquee ────────────────────────────────
             Scrolls the discounted packages and their savings. The track is
             rendered twice so the loop has no visible seam; the duplicate is
             aria-hidden so a screen reader hears the list once. Percentages come
             from PROMO, the same source the pricing cards read. ── */}
      <PromoTicker plans={discountedPlans} onPricing={scrollToPricing} />
      <PromoPopup plans={discountedPlans} onPricing={scrollToPricing} />
      {discountedPlans.length > 0 && (
        <StarAd
          best={Math.max(...discountedPlans.map((p) => p.percent))}
          onPricing={scrollToPricing}
        />
      )}
      {/* Public site only — deliberately not mounted anywhere inside the app. */}
      <LandingChat />

      {/* ── Top bar ─────────────────────────────────────────── */}
      <header className="lp-header">
        <div className="lp-shell lp-header-row">
          <div className="lp-brand">
            <span className="lp-mark" aria-hidden="true">
              <span />
              <span />
            </span>
            <span className="font-serif text-[1.35rem] leading-none tracking-tight">Trish Books</span>
          </div>

          {/* Desktop nav */}
          <nav className="lp-nav-desktop" aria-label="Primary">
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
          </nav>

          {/* Mobile: hamburger */}
          <button
            type="button"
            className="lp-burger"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="lp-mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </header>

      {/* Mobile menu overlay */}
      <div
        className={`lp-menu-scrim${menuOpen ? " is-open" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden="true"
      />
      <nav
        id="lp-mobile-menu"
        className={`lp-menu${menuOpen ? " is-open" : ""}`}
        aria-label="Mobile"
        aria-hidden={!menuOpen}
      >
        <a
          href="#pricing"
          className="lp-menu-link"
          onClick={(e) => {
            scrollToPricing(e);
            setMenuOpen(false);
          }}
        >
          Pricing
        </a>
        <a
          href="#getting-started"
          className="lp-menu-link"
          onClick={() => setMenuOpen(false)}
        >
          Getting started
        </a>
        <Link to="/login" className="lp-menu-link" onClick={() => setMenuOpen(false)}>
          Log in
        </Link>
        <Link
          to="/signup"
          className="lp-btn lp-btn-lg lp-menu-cta"
          onClick={() => setMenuOpen(false)}
        >
          Start free
          <ArrowRight className="w-4 h-4" />
        </Link>
      </nav>

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
        <section className="lp-shell" ref={sRiseBalance}>
          <p className="lp-axiom">
            <span className="lp-mono lp-axiom-eq">Σ debits = Σ credits</span>
            Nothing saves until it balances. Nothing posts twice. Nothing disappears.
          </p>
        </section>

        {/* ── Capabilities, organised by the account range they post to.
               Set on navy and run full-bleed, matching the Industry-bundles panel
               further down; the inner shell keeps the content on the page grid. ── */}
        <section id="ledger" className="lp-band is-navy" ref={mapRef}>
          <div className="lp-shell lp-section" ref={sRiseCoa}>
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
                <article key={group.code} className="lp-group" style={{ transitionDelay: `${i * 110}ms` }}>
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
        <section id="close" className="lp-shell lp-section" ref={sRiseClose}>
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
              <li key={term} className="lp-step" style={{ transitionDelay: `${i * 100}ms` }}>
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
        <section id="reports" className="lp-shell lp-section" ref={sRiseReports}>
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
              <li key={name} className="lp-report" style={{ transitionDelay: `${i * 90}ms` }}>
                <h3>{name}</h3>
                <p>{desc}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── The product itself ───────────────────────────────────
               Placed straight after Reports: the claim is made above, the screens
               that back it are here. Dark ground so the light UI reads as a screen
               rather than as more page. ── */}
        <section id="screens" className="lp-band is-navy" ref={sRiseShots}>
          <div className="lp-shell lp-section">
            <header className="lp-section-head">
              <p className="lp-eyebrow">Inside Trish Books</p>
              <SplitHeading text="This is what you get on day one" accent="day one" />
              <p className="lp-body lp-section-lede">
                Not a mock-up. These are the dashboards and the ledger as they ship —
                the same screens your first bank import lands in.
              </p>
            </header>
          </div>
          <ProductGallery />
        </section>

        {/* ── Local specifics ──────────────────────────────────── */}
        <section id="sri-lanka" className="lp-shell lp-section" ref={sRiseLocal}>
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

        {/* ── Document specimens ───────────────────────────────────
               The compliance claim made concrete: the actual tax invoice and receipt
               the system issues, on a dark ground so the white sheets read as paper.
               Kept immediately after the Sri Lanka section it evidences. ── */}
        <section id="documents" className="lp-band is-navy is-docs" ref={sRiseDocs}>
          <div className="lp-shell lp-section">
            <header className="lp-section-head">
              <p className="lp-eyebrow">Documents</p>
              <SplitHeading
                text="The invoice your customer gets, and the receipt that clears it"
                accent="clears it"
              />
              <p className="lp-body lp-section-lede">
                Both are generated as PDFs straight from the posted entry — the tax
                invoice in the statutory format of Gazette Extraordinary No. 2481/22,
                with SSCL and VAT compounded the way the IRD requires.
              </p>
            </header>
            <DocumentShowcase />
          </div>
        </section>

        {/* ── Getting started ──────────────────────────────────────
               The path from signup to live reports, immediately before pricing so
               the offer lands on someone who has just seen how short it is.

               Set on violet and run full-bleed: this is the section the page is
               built to deliver a reader to, so it gets the one dark band on an
               otherwise pale page. Contents invert for the dark ground. ── */}
        <section id="getting-started" className="lp-band" ref={sRiseStart}>
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
        <section id="pricing" className="lp-shell lp-section lp-pricing" ref={sRisePricing}>
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

          {/* Micro add-ons + services — on rich black, running full width. The
              closing fine print belongs inside the panel, since it qualifies these
              prices as much as the plan prices above. */}
          <div className="lp-sub is-violet is-flush">
            <div className="lp-shell">
              <div className="lp-sub-split">
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
            </div>
          </div>
        </section>

        {/* ── Controls ─────────────────────────────────────────── */}
        <section id="controls" className="lp-band is-joined" ref={controlsRef}>
          <div className="lp-shell lp-section" ref={sRiseControls}>
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
                <div key={term} className="lp-control" style={{ transitionDelay: `${i * 110}ms` }}>
                  <dt>{term}</dt>
                  <dd>{desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── Close ──────────────────────────────────────────────
               The last thing a visitor reads, so it has to do three jobs at once:
               make the next step concrete and small, remove the risk of taking it,
               and give a reason to take it now. The offer figure is read from PROMO,
               so this section can never quote a discount the rest of the page has
               stopped running. ── */}
        <section className="lp-shell lp-closing" ref={sRiseClosing}>
          <div className="lp-closing-main">
            <p className="lp-closing-eyebrow">
              <Tag className="w-3 h-3" strokeWidth={2.5} />
              {PROMO.active && bestDiscount
                ? `${PROMO.label} — up to ${bestDiscount}% off`
                : "Free tier, no card required"}
            </p>

            <h2 className="lp-h2 lp-closing-h">
              Your books can be balancing
              <br />
              <em className="lp-grad">ten minutes from now</em>
            </h2>

            <p className="lp-closing-lede">
              Not after a migration. Not after a demo call. Create your company, drop in
              a bank statement, and watch the trial balance tie — on the free tier,
              without handing over a card.
            </p>

            {/* Three concrete things that happen next, so "start free" stops being an
                abstraction and becomes a short, known sequence. */}
            <ol className="lp-closing-steps">
              {[
                ["01", "Create your company", "Fiscal year, currency, chart of accounts — seeded, not blank."],
                ["02", "Import a statement", "Excel in. The rules engine categorises and posts it."],
                ["03", "Run the trial balance", "Debits equal credits, or it tells you exactly where they don’t."],
              ].map(([no, title, body]) => (
                <li key={no}>
                  <span className="lp-mono lp-closing-no">{no}</span>
                  <span>
                    <b>{title}</b>
                    {body}
                  </span>
                </li>
              ))}
            </ol>

            <div className="lp-closing-cta">
              <Link to="/signup" className="lp-btn lp-btn-lg">
                Start free — no card
                <ArrowRight className="w-4 h-4" />
              </Link>
              <a href="#pricing" onClick={scrollToPricing} className="lp-closing-second">
                or see the packages
              </a>
            </div>

            <ul className="lp-closing-risk">
              {[
                "No card required to start",
                "30-day money-back on paid plans",
                "Cancel anytime — your data exports with you",
              ].map((t) => (
                <li key={t}>
                  <Check className="w-3.5 h-3.5" strokeWidth={3} />
                  {t}
                </li>
              ))}
            </ul>

            <p className="lp-closing-note">
              Already have an account?{" "}
              <Link to="/login" className="lp-note-link">Log in</Link>
            </p>
          </div>

          {/* The proof, restated as the thing they'll see: a balanced entry. */}
          <aside className="lp-closing-proof" aria-hidden="true">
            <p className="lp-mono lp-closing-proof-ref">JV-0001 · your first entry</p>
            <div className="lp-closing-proof-rows lp-mono">
              <p><span>Debits</span><b>{money(ENTRY_TOTAL)}</b></p>
              <p><span>Credits</span><b>{money(ENTRY_TOTAL)}</b></p>
            </div>
            <p className="lp-closing-proof-ok lp-mono">
              <Check className="w-3.5 h-3.5" strokeWidth={3} />
              Balanced · 0.00
            </p>
          </aside>
        </section>
      </main>

      {/* ── Footer: the closing entry ─────────────────────────────
             Laid out as the last journal entry of the period. The link groups are
             account ranges, mirroring the chart-of-accounts section above, and the
             foot carries the same balance check as the hero card — same specimen
             figure (ENTRY_TOTAL), so the page opens and closes on a ledger that
             ties. It stays a plain <nav> of real links underneath the styling. ── */}
      <footer className="lp-footer">
        <div className="lp-shell" ref={sRiseFooter}>
          <div className="lp-foot-head">
            <span className="lp-mono lp-foot-jv">JV-2026-CLOSE</span>
            <span className="lp-foot-posted">
              <Check className="w-3 h-3" strokeWidth={3} />
              Posted
            </span>
            <span className="lp-foot-rule" aria-hidden="true" />
            <span className="lp-mono lp-foot-period">Period 03/2026 · locked</span>
          </div>

          <div className="lp-foot-ledger">
            {FOOT_GROUPS.map((group) => (
              <nav key={group.code} className="lp-foot-col" aria-label={group.title}>
                <p className="lp-foot-key">
                  <span className="lp-mono lp-foot-code">{group.code}</span>
                  <span className="lp-mono lp-foot-class">{group.title}</span>
                </p>
                <ul className="lp-foot-links">
                  {group.links.map(([label, href]) =>
                    href.startsWith("#") ? (
                      <li key={label}>
                        <a href={href}>{label}</a>
                      </li>
                    ) : (
                      <li key={label}>
                        <Link to={href}>{label}</Link>
                      </li>
                    ),
                  )}
                </ul>
              </nav>
            ))}
          </div>

          {/* The closing check, echoing the hero's entry. */}
          <div className="lp-foot-totals lp-mono" aria-hidden="true">
            <span className="lp-foot-tot-lbl">Σ Debits</span>
            <span className="lp-foot-tot-val">{money(ENTRY_TOTAL)}</span>
            <span className="lp-foot-tot-lbl">Σ Credits</span>
            <span className="lp-foot-tot-val">{money(ENTRY_TOTAL)}</span>
            <span className="lp-foot-tot-diff">
              <Check className="w-3.5 h-3.5" strokeWidth={3} />
              Difference 0.00
            </span>
          </div>

          <div className="lp-foot-base">
            <div className="lp-foot-brand">
              <span className="lp-mark lp-mark-sm" aria-hidden="true">
                <span />
                <span />
              </span>
              <span className="font-serif text-base">Trish Books</span>
              <span className="lp-foot-tag">Double-entry accounting, built in Sri Lanka</span>
            </div>
            <div className="lp-foot-meta">
              <Link to="/signup" className="lp-foot-cta">
                Start free
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
              <p className="lp-mono lp-foot-copy">
                © {new Date().getFullYear()} Trish Books
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* Scoped to `.lp` so nothing here leaks into the authenticated app. */
const css = `
.lp {
  --ink: #141413;
  --body: #3D3D3A;
  --muted: #6F6E69;
  --emerald: #BD5D3A;
  --bright: #D97757;
  --mint: #E8D5CB;
  --rule: rgba(189, 93, 58, 0.14);
  /* Two accents carried through the page: the promo amber and a violet to sit
     against it. Kept as tokens so the marquee, stripes, card edges and step dots
     all pull from the same two values. */
  --amber: #FFC01E;
  --amber-lo: #FFD24A;
  --violet: #1F1E1D;
  --violet-lo: #D97757;
  /* ── Motion system ─────────────────────────────────────────────────────
     One curve and one travel distance for the whole page.

     The curve leaves decisively and settles without overshoot. Nothing here
     bounces: a bounce reads as playful, and the subject is a ledger. Reveals
     are long and unhurried — the movement finishes before the reader has
     finished reading what moved, so the animation is never the thing being
     watched.

     Entrances travel on one axis only, up. A section that rotates into place
     announces the transition rather than the content, and at 1000px+ tall it
     keystones badly at the far edge. Depth is kept for the pointer alone,
     where a small lift reads as a surface answering the cursor.              */
  --lp-ease: cubic-bezier(0.28, 0.11, 0.32, 1);  /* the page's only easing */
  --lp-ease-io: var(--lp-ease-io);    /* for things that leave and return */
  --lp-rise: 3rem;         /* how far a section travels into place */
  --lp-rise-sm: 1.5rem;    /* items inside a section that is already arriving */
  --lp-dur: 900ms;         /* item reveal */
  --lp-dur-lg: 1200ms;     /* whole-section reveal */
  --lp-dur-ui: 400ms;      /* hover / pointer response */
  --lp-persp: 1200px;      /* shared camera, pointer states only */
  --lp-lift: 10px;         /* how far a card lifts under the pointer */
  font-family: var(--font-sans);
  /* The page itself is the gradient: near-white at the top, deepening
     through mint into a soft green by the footer. */
  background-image:
    radial-gradient(58rem 38rem at 88% -12%, rgba(217, 119, 87, 0.26), transparent 62%),
    radial-gradient(46rem 34rem at -10% 24%, rgba(189, 93, 58, 0.14), transparent 64%),
    linear-gradient(180deg, #FFFFFF 0%, #FAF9F5 20%, #F0EEE6 56%, #E8E4D9 100%);
  background-repeat: no-repeat;
  /* clip, not hidden — hidden would create a scroll container and break the sticky header */
  overflow-x: clip;
}
.lp .lp-shell { width: 100%; max-width: 74rem; margin-inline: auto; padding-inline: 1.5rem; }

/* Hero stage — ambient video under a light scrim */
/* Scroll-scrubbed hero. --lp-zoom runs 0 -> 1 as the stage scrolls past (set from
   JS in useScrollZoom); everything below is derived from it, so the browser
   animates transform/filter/opacity on the compositor and JS only writes one
   number. The stage keeps its own height — the backdrop is what moves.

   The hero doesn't fly at the reader on the way out. It drifts up a little faster
   than the page carries it and dissolves, while the video behind it drifts the
   other way: two planes separating at different rates, which is what reads as
   depth. Rushing the foreground toward the camera reads as a transition effect
   and makes the type illegible for the whole of it. */
.lp .lp-stage { position: relative; isolation: isolate; overflow: hidden; --lp-zoom: 0; }

/* Backdrop settles back and softens as the foreground lifts away — opposing
   directions are what give the shot its depth. */
.lp .lp-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; pointer-events: none;
  transform: scale(calc(1 + var(--lp-zoom) * 0.14)) translate3d(0, calc(var(--lp-zoom) * 3rem), 0);
  filter: blur(calc(var(--lp-zoom) * 7px));
  opacity: calc(1 - var(--lp-zoom) * 0.6);
  transform-origin: 50% 45%;
  will-change: transform, filter, opacity; }

/* The hero itself lifts and dissolves. Opacity is multiplied so it reaches zero
   around 70% of the travel — gone before the stage ends, rather than lingering as
   a ghost over the next section. */
.lp .lp-stage .lp-hero {
  transform: translate3d(0, calc(var(--lp-zoom) * -4rem), 0);
  opacity: calc(1 - var(--lp-zoom) * 1.45);
  will-change: transform, opacity; }
.lp .lp-scrim { position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background-image:
    radial-gradient(44rem 30rem at 24% 48%, rgba(255, 255, 255, 0.88), rgba(255, 255, 255, 0.42) 62%, transparent 80%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.74) 0%, rgba(255, 255, 255, 0.56) 40%, rgba(250, 249, 245, 0.88) 84%, #FAF9F5 100%); }
.lp .lp-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.lp .font-serif { font-family: var(--font-serif); }

/* Mark: two stacked bars — the debit and credit column */
.lp .lp-mark { display: inline-flex; flex-direction: column; justify-content: center; gap: 3px; width: 1.65rem; height: 1.65rem; }
.lp .lp-mark > span { display: block; height: 4px; border-radius: 2px; background: linear-gradient(90deg, var(--bright), #E09B7D); }
.lp .lp-mark > span:last-child { width: 62%; background: var(--emerald); }
.lp .lp-mark-sm { width: 1.3rem; height: 1.3rem; gap: 2px; }
.lp .lp-mark-sm > span { height: 3px; }

.lp .lp-header { position: sticky; top: 0; z-index: 40; backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.74); border-bottom: 1px solid var(--rule); }
.lp .lp-header-row { position: relative; display: flex; align-items: center; justify-content: space-between; padding-block: 1rem; }
.lp .lp-brand { display: flex; align-items: center; gap: 0.625rem; }
.lp .lp-nav-desktop { display: flex; align-items: center; gap: 1.25rem; }

/* Hamburger — hidden on desktop */
.lp .lp-burger { display: none; align-items: center; justify-content: center; width: 2.75rem; height: 2.75rem; margin-right: -0.5rem; border-radius: 0.75rem; color: var(--ink); background: transparent; border: 1px solid transparent; cursor: pointer; }
.lp .lp-burger:hover { background: rgba(189, 93, 58, 0.06); }
.lp .lp-burger:focus-visible { outline: 2px solid #BD5D3A; outline-offset: 2px; }

/* Mobile menu panel + scrim */
.lp .lp-menu-scrim { position: fixed; inset: 0; z-index: 38; background: rgba(20, 20, 19, 0.42); backdrop-filter: blur(2px); opacity: 0; visibility: hidden; transition: opacity 220ms ease, visibility 220ms ease; }
.lp .lp-menu-scrim.is-open { opacity: 1; visibility: visible; }
.lp .lp-menu { position: fixed; top: 0; right: 0; z-index: 39; display: flex; flex-direction: column; gap: 0.25rem; width: min(20rem, 84vw); height: 100dvh; padding: 5.5rem 1.5rem 2rem; background-image: linear-gradient(180deg, #FFFFFF, #FAF9F5); border-left: 1px solid var(--rule); box-shadow: -24px 0 60px -30px rgba(20, 20, 19, 0.5); transform: translateX(100%); transition: transform 280ms var(--lp-ease); overflow-y: auto; }
.lp .lp-menu.is-open { transform: translateX(0); }
.lp .lp-menu-link { font-size: 1.05rem; font-weight: 600; color: var(--ink); text-decoration: none; padding: 0.9rem 0.25rem; border-bottom: 1px solid var(--rule); }
.lp .lp-menu-link:hover { color: var(--emerald); }
.lp .lp-menu-cta { margin-top: 1.5rem; justify-content: center; width: 100%; }

@media (max-width: 46rem) {
  .lp .lp-nav-desktop { display: none; }
  /* Anchored to the header row rather than relying on flex ordering, so the
     button can't be collapsed or pushed out by a sibling. */
  .lp .lp-burger { display: inline-flex; position: absolute; top: 50%; right: 1.5rem; transform: translateY(-50%); margin-right: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .lp .lp-menu, .lp .lp-menu-scrim { transition: none; }
}

/* ── Pointer states ─────────────────────────────────────────────────────
   A surface answering the cursor lifts straight up and deepens its shadow. It
   does not turn: rotation under the pointer draws attention to the card's
   geometry, and the shadow alone already says "this is above the page". The
   lift is small enough that reading is never interrupted by it. */
.lp .lp-pack-group.is-boxed {
  transition: transform var(--lp-dur-ui) var(--lp-ease), box-shadow var(--lp-dur-ui) ease, border-color var(--lp-dur-ui) ease; }
.lp .lp-pack-group.is-boxed:hover { transform: translate3d(0, calc(var(--lp-lift) * -1), 0);
  border-color: rgba(196, 105, 74, 0.5); box-shadow: 0 26px 46px -28px rgba(20, 20, 19, 0.55); }

.lp .lp-report {
  transition: transform var(--lp-dur-ui) var(--lp-ease), box-shadow var(--lp-dur-ui) ease, border-color var(--lp-dur-ui) ease; }
.lp .lp-armed.is-visible .lp-report:hover, .lp .lp-reports .lp-report:hover {
  transform: translate3d(0, calc(var(--lp-lift) * -0.8), 0);
  box-shadow: 0 30px 50px -30px rgba(20, 20, 19, 0.5); }

.lp .lp-trust li { transition: transform var(--lp-dur-ui) var(--lp-ease); }
.lp .lp-trust li:hover { transform: translate3d(0, -4px, 0); }

.lp .lp-menu-link {
  transition: transform var(--lp-dur-ui) var(--lp-ease), color 200ms ease; }
.lp .lp-menu-link:hover { transform: translate3d(4px, 0, 0); }

@media (prefers-reduced-motion: reduce) {
  .lp .lp-pack-group.is-boxed, .lp .lp-report, .lp .lp-trust li, .lp .lp-menu-link { transition: none; }
  .lp .lp-pack-group.is-boxed:hover, .lp .lp-report:hover,
  .lp .lp-trust li:hover, .lp .lp-menu-link:hover { transform: none; }
}

/* ── Star ad ────────────────────────────────────────────────────────────
   A spiked sale sticker hung in the corner. It keeps its thickness — two
   bursts offset in depth — but holds still: a sticker that sways forever
   competes with the page for attention, and this one already has colour and
   position doing that work. It comes to rest at a slight angle so the depth
   still reads, and only moves when the pointer arrives. */
.lp .lp-star-wrap { position: fixed; left: 1.5rem; bottom: 1.5rem; z-index: 45;
  width: 8.5rem; height: 8.5rem; perspective: var(--lp-persp);
  opacity: 0; transform: translate3d(0, 1.5rem, 0) scale(0.92);
  transition: opacity var(--lp-dur) var(--lp-ease), transform var(--lp-dur-lg) var(--lp-ease); }
.lp .lp-star-wrap.is-in { opacity: 1; transform: none; }

.lp .lp-star { position: absolute; inset: 0; display: grid; place-items: center; text-decoration: none;
  transform-style: preserve-3d; transform: rotateY(-9deg) rotateX(4deg);
  transition: transform var(--lp-dur-ui) var(--lp-ease), filter var(--lp-dur-ui) ease; }
.lp .lp-star::before { content: ""; position: absolute; inset: 0;
  clip-path: polygon(50.0% 0.0%, 57.4% 12.7%, 69.1% 3.8%, 71.1% 18.4%, 85.4% 14.6%, 81.6% 28.9%, 96.2% 30.9%, 87.3% 42.6%, 100.0% 50.0%, 87.3% 57.4%, 96.2% 69.1%, 81.6% 71.1%, 85.4% 85.4%, 71.1% 81.6%, 69.1% 96.2%, 57.4% 87.3%, 50.0% 100.0%, 42.6% 87.3%, 30.9% 96.2%, 28.9% 81.6%, 14.6% 85.4%, 18.4% 71.1%, 3.8% 69.1%, 12.7% 57.4%, 0.0% 50.0%, 12.7% 42.6%, 3.8% 30.9%, 18.4% 28.9%, 14.6% 14.6%, 28.9% 18.4%, 30.9% 3.8%, 42.6% 12.7%);
  background-image: linear-gradient(150deg, #E89A72 0%, var(--bright) 44%, #B4462A 100%);
  transform: translateZ(-6px); }
/* A second burst behind, offset in depth — gives the sticker real thickness. */
.lp .lp-star::after { content: ""; position: absolute; inset: 0;
  clip-path: polygon(50.0% 0.0%, 57.4% 12.7%, 69.1% 3.8%, 71.1% 18.4%, 85.4% 14.6%, 81.6% 28.9%, 96.2% 30.9%, 87.3% 42.6%, 100.0% 50.0%, 87.3% 57.4%, 96.2% 69.1%, 81.6% 71.1%, 85.4% 85.4%, 71.1% 81.6%, 69.1% 96.2%, 57.4% 87.3%, 50.0% 100.0%, 42.6% 87.3%, 30.9% 96.2%, 28.9% 81.6%, 14.6% 85.4%, 18.4% 71.1%, 3.8% 69.1%, 12.7% 57.4%, 0.0% 50.0%, 12.7% 42.6%, 3.8% 30.9%, 18.4% 28.9%, 14.6% 14.6%, 28.9% 18.4%, 30.9% 3.8%, 42.6% 12.7%);
  background: #8E3A22; transform: translateZ(-14px) scale(0.985); }
.lp .lp-star:hover, .lp .lp-star:focus-visible { filter: brightness(1.06); transform: rotateY(0deg) rotateX(0deg) scale(1.04); }
.lp .lp-star:focus-visible { outline: 3px solid var(--ink); outline-offset: 6px; border-radius: 50%; }

.lp .lp-star-face { position: relative; display: grid; justify-items: center; gap: 0.05rem;
  transform: translateZ(10px); text-align: center; line-height: 1; pointer-events: none; }
.lp .lp-star-up { font-family: var(--font-mono); font-size: 0.5rem; font-weight: 700; letter-spacing: 0.12em;
  text-transform: uppercase; color: rgba(255, 255, 255, 0.9); }
.lp .lp-star-num { font-family: var(--font-serif); font-size: 2.1rem; font-weight: 600; letter-spacing: -0.03em; color: #FFFFFF;
  text-shadow: 0 2px 6px rgba(20, 20, 19, 0.28); }
.lp .lp-star-sub { font-family: var(--font-mono); font-size: 0.46rem; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: rgba(255, 255, 255, 0.82); }

.lp .lp-star-x { position: absolute; top: 0.1rem; right: 0.1rem; z-index: 2; display: grid; place-items: center;
  width: 1.35rem; height: 1.35rem; border-radius: 999px; cursor: pointer;
  color: var(--ink); background: #FFFFFF; border: 1px solid var(--rule);
  box-shadow: 0 4px 10px -4px rgba(20, 20, 19, 0.5); }
.lp .lp-star-x:hover { background: #F0EEE6; }
.lp .lp-star-x:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

@media (max-width: 46rem) {
  .lp .lp-star-wrap { left: 0.9rem; bottom: 0.9rem; width: 6.6rem; height: 6.6rem; }
  .lp .lp-star-num { font-size: 1.6rem; }
}
@media (prefers-reduced-motion: reduce) {
  .lp .lp-star-wrap { transition: none; opacity: 1; transform: none; }
  /* The resting tilt is geometry, not motion — it stays. Only the transition goes. */
  .lp .lp-star { transition: none; }
  .lp .lp-star:hover, .lp .lp-star:focus-visible { transform: rotateY(-9deg) rotateX(4deg); }
}

/* Buttons */
.lp .lp-btn { display: inline-flex; align-items: center; gap: 0.5rem; border-radius: 999px; background-image: linear-gradient(135deg, #C4694A 0%, #BD5D3A 100%); color: #FFFFFF; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; box-shadow: 0 10px 22px -12px rgba(189, 93, 58, 0.75); transition: transform 260ms var(--lp-ease), box-shadow 260ms ease, filter 260ms ease; }
.lp .lp-btn:hover { filter: brightness(1.09); transform: translate3d(0, -2px, 0); box-shadow: 0 16px 30px -14px rgba(189, 93, 58, 0.85); }
.lp .lp-btn:focus-visible { outline: 2px solid #BD5D3A; outline-offset: 3px; }
.lp .lp-btn-sm { padding: 0.5rem 1rem; font-size: 0.875rem; }
.lp .lp-btn-lg { padding: 0.85rem 1.6rem; font-size: 1rem; }
.lp .lp-btn-ghost { background-image: none; background-color: transparent; color: #BD5D3A; box-shadow: inset 0 0 0 1.5px rgba(189, 93, 58, 0.4); }
.lp .lp-btn-ghost:hover { filter: none; background-color: rgba(189, 93, 58, 0.06); box-shadow: inset 0 0 0 1.5px rgba(189, 93, 58, 0.6); }

/* Announcement marquee — a yellow strip listing the discounted packages.
   Deep navy ink on amber, so it reads as a promotional flash against the page's
   cool palette while still clearing contrast on small text. */
.lp .lp-ticker { position: relative; display: flex; align-items: center; gap: 0.85rem; padding: 0.5rem 1rem; color: #3D2A00; text-decoration: none; background: linear-gradient(90deg, #FFD24A 0%, #FFC01E 55%, #FFB300 100%); border-bottom: 1px solid rgba(61, 42, 0, 0.18); overflow: hidden; }
.lp .lp-ticker-badge { display: inline-flex; align-items: center; gap: 0.3rem; flex: none; font-family: var(--font-mono); font-size: 0.62rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #FFF6DC; background: #3D2A00; border-radius: 999px; padding: 0.25rem 0.6rem; }

/* The window clips; the track carries the two runs and slides by exactly half its
   width, which is one full run — so the loop repeats seamlessly. */
.lp .lp-ticker-window { flex: 1 1 auto; min-width: 0; overflow: hidden; -webkit-mask-image: linear-gradient(90deg, transparent, #000 5rem, #000 calc(100% - 5rem), transparent); mask-image: linear-gradient(90deg, transparent, #000 5rem, #000 calc(100% - 5rem), transparent); }
/* Slow enough to read a single offer without tracking it, and with a wide
   enough fade at each end that offers arrive and leave rather than clipping. */
.lp .lp-ticker-track { display: flex; width: max-content; animation: lp-ticker-scroll 56s linear infinite; }
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

/* ── Getting-started assistant ───────────────────────────────────────────────
   Bottom-right launcher and panel. Sits below the promo popup in the stack (55 vs
   60), so when both are open the popup still owns the screen. Amber launcher,
   because on this page amber means "act". */
.lp .lp-chat-fab { position: fixed; right: 1.5rem; bottom: 1.5rem; z-index: 55;
  display: grid; place-items: center; width: 4rem; height: 4rem; border-radius: 999px;
  border: 1px solid rgba(61, 42, 0, 0.2); color: #3D2A00; cursor: pointer;
  background-image: linear-gradient(135deg, var(--amber-lo), var(--amber));
  box-shadow: 0 18px 36px -14px rgba(20, 20, 19, 0.55);
  transition: transform var(--lp-dur-ui) var(--lp-ease), box-shadow var(--lp-dur-ui) ease; }
.lp .lp-chat-fab:hover { transform: translate3d(0, -3px, 0) scale(1.04); box-shadow: 0 26px 46px -16px rgba(20, 20, 19, 0.6); }
.lp .lp-chat-fab:focus-visible { outline: 2px solid #141413; outline-offset: 3px; }
/* A single unread pip, only before the first exchange. */
.lp .lp-chat-dot { position: absolute; top: 0.45rem; right: 0.45rem; width: 0.7rem; height: 0.7rem;
  border-radius: 999px; background: var(--violet); border: 2px solid #FFD24A; }

.lp .lp-chat { position: fixed; right: 1.5rem; bottom: 6.25rem; z-index: 55;
  width: min(27.5rem, calc(100vw - 3rem)); max-height: min(41rem, calc(100dvh - 9rem));
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: 1.1rem; border: 1px solid rgba(255, 255, 255, 0.14); color: #F0EEE6;
  background-image:
    radial-gradient(22rem 14rem at 8% -18%, rgba(217, 119, 87, 0.3), transparent 64%),
    linear-gradient(165deg, #0A3560 0%, var(--ink) 55%, #141413 100%);
  box-shadow: 0 34px 70px -26px rgba(20, 20, 19, 0.75);
  opacity: 0; pointer-events: none;
  transform: translate3d(0, 1rem, 0) scale(0.98);
  transform-origin: 50% 100%;
  transition: opacity 260ms ease, transform 480ms var(--lp-ease); }
.lp .lp-chat.is-open { opacity: 1; pointer-events: auto; transform: none; }

.lp .lp-chat-head { position: relative; padding: 1rem 3rem 0.85rem 1.15rem; border-bottom: 1px solid rgba(255, 255, 255, 0.12); }
.lp .lp-chat-title { display: block; font-family: var(--font-serif); font-size: 1.15rem; color: #FFFFFF; }
.lp .lp-chat-sub { display: block; margin-top: 0.15rem; font-family: var(--font-mono); font-size: 0.58rem;
  letter-spacing: 0.1em; text-transform: uppercase; color: rgba(240, 238, 230, 0.5); }
.lp .lp-chat-x { position: absolute; top: 0.85rem; right: 0.85rem; display: grid; place-items: center;
  width: 1.75rem; height: 1.75rem; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.08); color: inherit; }
.lp .lp-chat-x:hover { background: rgba(255, 255, 255, 0.18); }

.lp .lp-chat-log { flex: 1 1 auto; overflow-y: auto; padding: 1.15rem 1.3rem; display: grid; gap: 1rem; align-content: start; }
.lp .lp-chat-bubble { border-radius: 0.85rem; border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.07); padding: 0.9rem 1rem; font-size: 0.875rem; line-height: 1.6; }
.lp .lp-chat-bubble p { margin: 0 0 0.5rem; }
.lp .lp-chat-bubble p:last-child { margin-bottom: 0; }
.lp .lp-chat-bubble ol { margin: 0.35rem 0 0.5rem; padding-left: 1.1rem; display: grid; gap: 0.3rem; }
.lp .lp-chat-user { justify-self: end; max-width: 85%; margin: 0; padding: 0.6rem 0.9rem;
  border-radius: 0.85rem 0.85rem 0.25rem 0.85rem; font-size: 0.875rem;
  background: var(--amber); color: #3D2A00; font-weight: 600; }

.lp .lp-chat-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.55rem; }
.lp .lp-chat-chip { font-size: 0.78rem; padding: 0.4rem 0.75rem; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.06); color: rgba(240, 238, 230, 0.9);
  transition: background 180ms ease, border-color 180ms ease; text-align: left; }
.lp .lp-chat-chip:hover { background: rgba(255, 255, 255, 0.16); border-color: rgba(255, 255, 255, 0.4); color: #FFFFFF; }
.lp .lp-chat-chip:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

.lp .lp-chat-form { display: flex; gap: 0.5rem; padding: 0.75rem 1.15rem; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.lp .lp-chat-form input { flex: 1 1 auto; min-width: 0; font-size: 0.875rem; color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.06);
  border-radius: 999px; padding: 0.6rem 1rem; }
.lp .lp-chat-form input::placeholder { color: rgba(240, 238, 230, 0.45); }
.lp .lp-chat-form input:focus { outline: 2px solid var(--amber); outline-offset: 1px; }
.lp .lp-chat-form button { flex: none; display: grid; place-items: center; width: 2.6rem; height: 2.6rem;
  border-radius: 999px; cursor: pointer; border: 0; color: #3D2A00;
  background-image: linear-gradient(135deg, var(--amber-lo), var(--amber)); }
.lp .lp-chat-form button:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }

.lp .lp-chat-foot { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
  padding: 0.7rem 1.15rem 0.9rem; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.lp .lp-chat-cta { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.84rem; font-weight: 700;
  color: var(--amber); text-decoration: none; }
.lp .lp-chat-cta:hover { text-decoration: underline; text-underline-offset: 3px; }
.lp .lp-chat-alt { font-size: 0.75rem; color: rgba(240, 238, 230, 0.6); text-decoration: none; }
.lp .lp-chat-alt:hover { color: #FFFFFF; }

/* ── Promo popup ─────────────────────────────────────────────────────────────
   Violet into navy, so it belongs to both tinted bands on the page. Fixed to the
   bottom-left corner and kept narrow: it should read as an aside, not a barrier.
   pointer-events go off while closed so the hidden card can never swallow a click
   on the page beneath it. */
/* Scrim: centres the card and dims the page behind it. pointer-events go off while
   closed so the invisible layer can never swallow a click on the page. */
.lp .lp-pop-wrap { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; padding: 1.25rem;
  background: rgba(20, 20, 19, 0.55); backdrop-filter: blur(3px);
  opacity: 0; pointer-events: none; transition: opacity 320ms ease; }
.lp .lp-pop-wrap.is-open { opacity: 1; pointer-events: auto; }

.lp .lp-pop { position: relative; width: min(31rem, 100%);
  /* Tall content: cap the height and let the card scroll rather than overflow the
     viewport on a short window. */
  max-height: calc(100dvh - 2.5rem); overflow-y: auto;
  padding: 2.1rem 2.1rem 1.9rem; border-radius: 1.35rem; color: #F5F2EA;
  border: 1px solid rgba(255, 255, 255, 0.16);
  background-image:
    radial-gradient(26rem 16rem at 8% -20%, rgba(217, 119, 87, 0.6), transparent 64%),
    linear-gradient(155deg, #2A2724 0%, var(--violet) 42%, #0A2E58 100%);
  box-shadow: 0 34px 80px -26px rgba(20, 20, 19, 0.8);
  transform: translate3d(0, 1.25rem, 0) scale(0.96);
  transition: transform 560ms var(--lp-ease); }
.lp .lp-pop-wrap.is-open .lp-pop { transform: none; }
/* Amber top hairline, the same signal the marquee and bands use. */
.lp .lp-pop::before { content: ""; position: absolute; left: 1.1rem; right: 1.1rem; top: 0; height: 3px; border-radius: 0 0 3px 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 25%, var(--amber-lo) 75%, transparent); }

.lp .lp-pop-x { position: absolute; top: 1rem; right: 1rem; display: grid; place-items: center; width: 1.85rem; height: 1.85rem;
  border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 999px; background: rgba(255, 255, 255, 0.1); color: #F5F2EA; cursor: pointer;
  transition: background 200ms ease, border-color 200ms ease; }
.lp .lp-pop-x:hover { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.34); }
.lp .lp-pop-x:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

.lp .lp-pop-kicker { display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 0 0.9rem;
  font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: #3D2A00; background: var(--amber); border-radius: 999px; padding: 0.22rem 0.55rem; }
.lp .lp-pop-title { margin: 0 0 0.7rem; padding-right: 2.5rem; font-family: var(--font-serif); font-size: 1.45rem; line-height: 1.3; color: #FFFFFF; }
.lp .lp-pop-title strong { color: var(--amber); font-weight: 700; }

.lp .lp-pop-lede { margin: 0 0 1.5rem; font-size: 0.8125rem; line-height: 1.5; color: rgba(245, 242, 234, 0.78); }

/* Each row is a small grid: name and seat count on the left, the discount pill
   right-aligned, then price and saving on the row beneath. */
.lp .lp-pop-list { list-style: none; margin: 0 0 1.25rem; padding: 0; display: grid; gap: 1rem; }
.lp .lp-pop-list li { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 0.15rem 0.6rem;
  padding-bottom: 1rem; border-bottom: 1px solid rgba(255, 255, 255, 0.13); font-size: 0.875rem; }
.lp .lp-pop-list li:last-child { border-bottom: none; padding-bottom: 0; }
.lp .lp-pop-plan { font-weight: 700; color: #FFFFFF; }
.lp .lp-pop-meta { grid-column: 1; margin-top: 0.15rem; font-size: 0.73rem; color: rgba(245, 242, 234, 0.62); }
.lp .lp-pop-off { grid-row: 1; grid-column: 2; justify-self: end; font-size: 0.68rem; font-weight: 800; color: #3D2A00; background: var(--amber-lo); border-radius: 999px; padding: 0.1rem 0.4rem; }
.lp .lp-pop-price { grid-column: 1; display: flex; align-items: baseline; gap: 0.45rem; margin-top: 0.5rem; font-family: var(--font-mono); font-size: 0.875rem; }
.lp .lp-pop-price s { color: rgba(245, 242, 234, 0.5); }
.lp .lp-pop-price strong { color: #FFFFFF; font-weight: 700; }
.lp .lp-pop-per { font-size: 0.66rem; color: rgba(245, 242, 234, 0.55); }
.lp .lp-pop-save { grid-column: 2; justify-self: end; align-self: end; font-size: 0.68rem; font-weight: 700; color: var(--amber-lo); }

/* Narrow phones: stop the two-column rows from forcing the card wider than the
   viewport — stack each plan's price and saving, and tighten the card padding. */
@media (max-width: 30rem) {
  .lp .lp-pop-wrap { padding: 0.6rem; }
  .lp .lp-pop { padding: 1.6rem 1.15rem 1.35rem; border-radius: 1.1rem; }
  .lp .lp-pop-title { font-size: 1.15rem; padding-right: 2rem; }
  .lp .lp-pop-lede { font-size: 0.78rem; margin-bottom: 1.1rem; }
  .lp .lp-pop-list li { grid-template-columns: 1fr; gap: 0.3rem; }
  .lp .lp-pop-off { grid-row: auto; grid-column: 1; justify-self: start; }
  .lp .lp-pop-price { flex-wrap: wrap; grid-column: 1; margin-top: 0.35rem; }
  .lp .lp-pop-save { grid-column: 1; justify-self: start; align-self: start; }
}

.lp .lp-pop-more { margin: 0 0 1.35rem; font-size: 0.75rem; color: rgba(245, 242, 234, 0.66); }

/* What the price buys. Slightly inset so it reads as a panel within the card. */
.lp .lp-pop-incl { margin: 0 0 1.35rem; padding: 1.1rem 1.15rem; border-radius: 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(255, 255, 255, 0.07); }
.lp .lp-pop-incl-head { margin: 0 0 0.7rem; font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--amber-lo); }
.lp .lp-pop-incl-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
.lp .lp-pop-incl-list li { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 0.4rem;
  font-size: 0.78rem; line-height: 1.5; color: rgba(245, 242, 234, 0.88); }
.lp .lp-pop-incl-list svg { margin-top: 0.22rem; color: var(--amber); }

.lp .lp-pop-trust { list-style: none; margin: 0 0 1.5rem; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; }
.lp .lp-pop-trust li { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.72rem; color: rgba(245, 242, 234, 0.78); }
.lp .lp-pop-trust svg { color: var(--amber); }

.lp .lp-pop-actions { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; }
.lp .lp-pop-cta { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8125rem; font-weight: 700;
  color: #3D2A00; background-image: linear-gradient(90deg, var(--amber-lo), var(--amber)); border-radius: 999px; padding: 0.55rem 1rem; text-decoration: none; }
.lp .lp-pop-cta:hover { filter: brightness(1.06); }
.lp .lp-pop-cta:focus-visible { outline: 2px solid #FFFFFF; outline-offset: 2px; }
/* A second way out besides the X — some people won't look for the corner. */
.lp .lp-pop-later { border: 0; background: none; padding: 0.35rem 0; font-size: 0.75rem; font-weight: 600;
  color: rgba(245, 242, 234, 0.7); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
.lp .lp-pop-later:hover { color: #FFFFFF; }
.lp .lp-pop-later:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

.lp .lp-pop-fine { margin: 1.35rem 0 0; font-size: 0.68rem; line-height: 1.55; color: rgba(245, 242, 234, 0.55); }

/* ── Violet highlight band ───────────────────────────────────────────────────
   The one dark section on the page. Everything inside inverts: type goes light,
   the amber accent does the work the violet does elsewhere, and the step dots
   flip to reading light-on-dark. */
.lp .lp-band { position: relative; margin-top: 4.5rem; color: #F5F2EA;
  background-image:
    radial-gradient(48rem 26rem at 12% -10%, rgba(217, 119, 87, 0.55), transparent 62%),
    radial-gradient(40rem 24rem at 92% 110%, rgba(255, 192, 30, 0.18), transparent 64%),
    linear-gradient(160deg, #2A2724 0%, var(--violet) 46%, #141413 100%); }
/* Amber hairlines top and bottom tie the band to the marquee that follows it. */
.lp .lp-band::before, .lp .lp-band::after { content: ""; position: absolute; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--amber-lo) 78%, transparent); }
.lp .lp-band::before { top: 0; }
.lp .lp-band::after { bottom: 0; }

/* Closing dark run — butt the navy Documents band and the violet Getting-started
   band flush against what's above them, so no page-coloured gaps stack up before
   the CTA. Drop the doubled hairline where the two dark bands meet. */
.lp .lp-band.is-docs { margin-top: 0; }
.lp .lp-band#getting-started { margin-top: 0; }
.lp .lp-band#getting-started::before { content: none; }

.lp .lp-band .lp-h2 { color: #FFFFFF; }
.lp .lp-band .lp-eyebrow { color: var(--amber-lo); }
.lp .lp-band .lp-section-head .lp-eyebrow::before { background: linear-gradient(90deg, var(--amber), #FFFFFF); }
.lp .lp-band .lp-body, .lp .lp-band .lp-section-lede { color: rgba(245, 242, 234, 0.82); }

/* Steps, inverted for the dark ground. */
.lp .lp-band .lp-start-rail { background: rgba(255, 255, 255, 0.22); }
.lp .lp-band .lp-start-rail-fill { background: linear-gradient(180deg, var(--amber), #FFFFFF); }
@media (min-width: 60rem) { .lp .lp-band .lp-start-rail-fill { background: linear-gradient(90deg, var(--amber), #FFFFFF); } }
.lp .lp-band .lp-start-dot { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.34); color: rgba(245, 242, 234, 0.72); }
.lp .lp-band .lp-start-step.is-live .lp-start-dot { border-color: var(--amber); color: var(--amber); }
.lp .lp-band .lp-start-step.is-done .lp-start-dot { background: var(--amber); border-color: var(--amber); color: #3D2A00; }
.lp .lp-band .lp-start-spin { border-top-color: #FFFFFF; border-right-color: #FFFFFF; }
.lp .lp-band .lp-start-title { color: #FFFFFF; }
.lp .lp-band .lp-start-step.is-wait .lp-start-title { color: rgba(245, 242, 234, 0.6); }
.lp .lp-band .lp-start-note { color: rgba(245, 242, 234, 0.72); opacity: 1; }

/* Navy variant of the band, sharing the geometry and hairlines with the violet
   one. Used for Chart of accounts; the ledger-map rows invert with it. */
.lp .lp-band.is-navy { color: #F0EEE6;
  background-image:
    radial-gradient(48rem 26rem at 10% -10%, rgba(217, 119, 87, 0.4), transparent 62%),
    radial-gradient(42rem 24rem at 94% 112%, rgba(31, 30, 29, 0.3), transparent 64%),
    linear-gradient(160deg, #2A2724 0%, var(--ink) 50%, #141413 100%); }
.lp .lp-band.is-navy::before, .lp .lp-band.is-navy::after {
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--violet-lo) 78%, transparent); }
.lp .lp-band.is-navy .lp-eyebrow { color: var(--mint); }
.lp .lp-band.is-navy .lp-section-head .lp-eyebrow::before { background: linear-gradient(90deg, var(--amber), var(--violet-lo)); }
.lp .lp-band.is-navy .lp-body { color: rgba(240, 238, 230, 0.8); }
.lp .lp-band.is-navy .lp-h3 { color: #FFFFFF; }
.lp .lp-band.is-navy .lp-group { border-top-color: rgba(255, 255, 255, 0.14); }
.lp .lp-band.is-navy .lp-group:last-child { border-bottom-color: rgba(255, 255, 255, 0.14); }
.lp .lp-band.is-navy .lp-group-code { background-image: linear-gradient(135deg, var(--mint) 0%, var(--amber) 100%); }
.lp .lp-band.is-navy .lp-group-class { color: rgba(240, 238, 230, 0.58); }
.lp .lp-band.is-navy .lp-chips li { color: #EBE7DC; background-image: linear-gradient(140deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.05)); border-color: rgba(255, 255, 255, 0.2); }

/* ── Continuous violet run: add-ons panel + Controls ─────────────────────────
   These two sit directly on top of each other and share one violet field, with no
   pale gap between them. Three things have to give way for that:
     · the pricing section's bottom padding (the panel is its last child),
     · the Controls band's top margin,
     · the hairline that would otherwise draw across the junction.
   The result reads as a single tall panel rather than two stacked ones. */
/* Two classes on purpose. The .lp .lp-section rule further down sets padding-block,
   which covers both edges, so a single-class rule here would lose to it on source
   order. This wins on specificity instead. */
.lp .lp-section.lp-pricing { padding-bottom: 0; }
.lp .lp-sub.is-violet.is-flush { margin-bottom: 0; }
.lp .lp-sub.is-violet.is-flush::after { content: none; }

/* Industry bundles (navy) runs straight into the add-ons panel (violet) — no pale
   strip between them. The hairline at the junction stays, as the seam between the
   two colours; it's a 3px rule, not a gap. */
.lp .lp-sub.is-navy + .lp-sub.is-violet.is-flush { margin-top: 0; }

/* Controls: the violet base from .lp-band, butted against the panel above. */
.lp .lp-band.is-joined { margin-top: 0; }
.lp .lp-band.is-joined::before { content: none; }

/* Type and rules on the violet ground (shared by both blocks). */
.lp .is-violet .lp-h3, .lp .is-violet .lp-sub-title,
.lp .lp-band.is-joined .lp-h3 { color: #FFFFFF; }
.lp .is-violet .lp-plans-note,
.lp .lp-band.is-joined .lp-plans-note { color: rgba(245, 242, 234, 0.58); }

/* Price lists: translucent so the violet reads through instead of a white slab. */
.lp .is-violet .lp-pricelist-boxed { border-color: rgba(255, 255, 255, 0.18); background: rgba(255, 255, 255, 0.07); }
.lp .is-violet .lp-pricelist li { border-bottom-color: rgba(255, 255, 255, 0.13); }
.lp .is-violet .lp-pl-label { color: rgba(245, 242, 234, 0.88); }
.lp .is-violet .lp-pl-price-text { color: var(--amber); }

/* Controls on violet. The cards are discrete now (see the .lp-controls block), so
   only the cards themselves need restating — the container carries nothing. */
.lp .lp-band.is-joined .lp-control {
  border-color: rgba(255, 255, 255, 0.18);
  background-image: linear-gradient(160deg, rgba(255, 255, 255, 0.11) 0%, rgba(255, 255, 255, 0.045) 100%);
  box-shadow: 0 18px 36px -30px rgba(0, 0, 0, 0.6); }
/* On violet the lift reads through brightness and a white edge rather than a
   coloured border, which would disappear into the background. */
.lp .lp-band.is-joined .lp-armed.is-visible .lp-control:hover,
.lp .lp-band.is-joined .lp-controls .lp-control:hover {
  border-color: rgba(255, 255, 255, 0.45);
  background-image: linear-gradient(160deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.09) 100%);
  box-shadow: 0 34px 60px -26px rgba(0, 0, 0, 0.65); }
/* On violet the margin rule runs amber into white; the coloured half of the light
   ramp would otherwise sink into the background. */
.lp .lp-band.is-joined .lp-control::before { background: linear-gradient(180deg, var(--amber), #FFFFFF); }
.lp .lp-band.is-joined .lp-control::after { color: var(--amber-lo); }
.lp .lp-band.is-joined .lp-control dt { color: #FFFFFF; }
.lp .lp-band.is-joined .lp-control dd { color: rgba(245, 242, 234, 0.76); }

/* ── Product screens ─────────────────────────────────────────────────────────
   A horizontal track that drifts sideways as the section passes the viewport.
   --lp-p is written 0→1 by useScrollProgress; the pan is expressed off it here, so
   the only per-frame JS is one custom-property write.

   The track deliberately overflows the shell and is clipped by .lp (overflow-x:
   clip) — the shots run off both edges, which is what makes the drift readable.
   Nothing about this blocks or hijacks the page scroll. */
/* The stage is a tall spacer; its height is set from JS to one viewport plus the
   track's overflow. The panel inside sticks while that spacer passes, so the wheel
   drives the row sideways and then the page resumes downwards on its own. */
.lp .lp-shots-stage { position: relative; --lp-x: 0px; }
.lp .lp-shots-pin { position: sticky; top: 0; height: 100vh; height: 100dvh;
  display: flex; align-items: center; overflow: hidden; }
.lp .lp-shots-track { display: flex; align-items: center; gap: 1.75rem; width: max-content;
  padding-inline: max(1.5rem, calc((100vw - 74rem) / 2));
  transform: translate3d(var(--lp-x), 0, 0);
  will-change: transform; }

.lp .lp-shot { flex: none; width: min(52rem, 84vw); margin: 0; }
.lp .lp-shot-frame { position: relative; border-radius: 0.85rem; overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18); background: #0B1D30;
  box-shadow: 0 40px 80px -34px rgba(20, 20, 19, 0.8); }
.lp .lp-shot-bar { display: flex; align-items: center; gap: 0.35rem; padding: 0.55rem 0.75rem;
  background: rgba(255, 255, 255, 0.06); border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
.lp .lp-shot-bar i { width: 0.5rem; height: 0.5rem; border-radius: 999px; background: rgba(255, 255, 255, 0.22); }
/* Every frame is the same size, whatever shape the screenshot happens to be. The
   captures aren't uniform — the cash-flow one is ~2.14:1 while the other two are
   16:9 — so without this the row would step up and down as it pans.

   contain, not cover: these are UI screenshots, and cropping ~8% off each side of a
   chart to force it into the box loses axis labels. The canvas is filled with the
   app's own chrome grey instead, so the band on a wider capture reads as padding
   around the screen rather than as letterboxing. */
.lp .lp-shot-canvas { aspect-ratio: 16 / 9; background: #F0EEE6; display: grid; place-items: center; }
.lp .lp-shot-frame img { display: block; width: 100%; height: 100%; object-fit: contain; object-position: center; }
/* If a file is missing, hold the space quietly instead of a broken-image icon. */
.lp .lp-shot-missing { width: 100%; height: 100%; background:
  repeating-linear-gradient(135deg, rgba(20,20,19,0.06) 0 12px, rgba(20,20,19,0.02) 12px 24px); }

/* Depth without turning anything: the caption lags the frame it belongs to as the
   row pans, so the two planes separate. --lp-x is the track's own offset, and a
   small negative fraction of it moves the caption against the direction of travel,
   which is what reads as parallax. */
.lp .lp-shot figcaption { margin-top: 1rem;
  transform: translate3d(calc(var(--lp-x, 0px) * -0.075), 0, 0);
  will-change: transform; }
.lp .lp-shot-title { margin: 0; font-family: var(--font-serif); font-size: 1.1rem; color: #FFFFFF; }
.lp .lp-shot-body { margin: 0.3rem 0 0; font-size: 0.875rem; line-height: 1.55; color: rgba(240, 238, 230, 0.72); max-width: 42ch; }

@media (prefers-reduced-motion: reduce) {
  /* No pinning and no parallax — the row becomes an ordinary horizontal scroller,
     and the JS that would set the stage height bails out before running. */
  .lp .lp-shots-stage { height: auto !important; }
  .lp .lp-shots-pin { position: static; height: auto; overflow-x: auto; padding-block: 1rem; }
  .lp .lp-shots-track { transform: none; }
  .lp .lp-shot figcaption { transform: none; }
}

/* ── Document specimens ──────────────────────────────────────────────────────
   White sheets on the dark band, so they read as paper/PDF rather than as UI. Both
   sheets are stacked in the same grid cell and cross-fade, which keeps the block a
   fixed height while they swap — no layout jump mid-cycle. */
.lp .lp-docs { margin-top: 2.5rem; }
.lp .lp-docs-stack { display: grid; }
.lp .lp-docs-slot { grid-area: 1 / 1; display: flex; justify-content: center;
  /* A cross-dissolve, not a page flip: the incoming sheet rises the last few
     pixels into place while the outgoing one settles back. The scale is small
     enough that the type inside never visibly resamples. */
  opacity: 0; transform: translate3d(0, 1.25rem, 0) scale(0.985); pointer-events: none;
  transition: opacity 700ms var(--lp-ease), transform 900ms var(--lp-ease); }
.lp .lp-docs-slot.is-live { opacity: 1; transform: none; pointer-events: auto; }

/* The sheet itself. A4-ish proportion via max-width; type is deliberately small so
   it reads as a document rather than as page content.

   --lp-p is written 0→1 by useScrollProgress as the stack crosses the viewport.
   Re-centring it on 0.5 turns it into -0.5→0.5, so the sheet drifts up through the
   section instead of only ever moving one way from wherever it started. The travel
   is small: this is the sheet sitting a little in front of the band, not a
   separate thing sliding across it. */
.lp .lp-doc { transform: translate3d(0, calc((var(--lp-p, 0.5) - 0.5) * -3rem), 0);
  will-change: transform;
  position: relative; width: 100%; max-width: 46rem; padding: 1.9rem 1.9rem 1.6rem;
  background: #FFFFFF; color: #1F1E1D; border-radius: 0.4rem;
  box-shadow: 0 40px 80px -30px rgba(20, 20, 19, 0.75), 0 2px 0 rgba(255, 255, 255, 0.5) inset;
  font-size: 0.78rem; line-height: 1.5; text-align: left; }
@media (min-width: 48rem) { .lp .lp-doc { padding: 2.4rem 2.4rem 2rem; font-size: 0.82rem; } }

/* Marked as a sample — these are format-correct specimens, not issued documents. */
.lp .lp-doc-stamp { position: absolute; top: 1.1rem; right: 1.1rem; font-family: var(--font-mono);
  font-size: 0.55rem; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  color: #B4462A; border: 1px solid rgba(180, 70, 42, 0.4); border-radius: 0.2rem; padding: 0.16rem 0.4rem;
  transform: rotate(-4deg); }

.lp .lp-doc-top { display: flex; justify-content: space-between; gap: 1.5rem; flex-wrap: wrap;
  padding-bottom: 1rem; border-bottom: 2px solid #1F1E1D; }
.lp .lp-doc-co { margin: 0; font-family: var(--font-serif); font-size: 1.05rem; font-weight: 600; }
.lp .lp-doc-sm { margin: 0.1rem 0 0; font-size: 0.7rem; color: #6F6E69; }
.lp .lp-doc-title-wrap { text-align: right; }
.lp .lp-doc-title { margin: 0; font-family: var(--font-mono); font-size: 0.92rem; font-weight: 700; letter-spacing: 0.1em; }

.lp .lp-doc-grid { display: grid; grid-template-columns: 1fr; gap: 1.1rem; padding: 1rem 0; }
@media (min-width: 40rem) { .lp .lp-doc-grid { grid-template-columns: 1fr auto; } }
.lp .lp-doc-lbl { display: block; margin: 0 0 0.2rem; font-family: var(--font-mono); font-size: 0.58rem;
  font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #8A857A; }
.lp .lp-doc-strong { margin: 0; font-weight: 700; }
.lp .lp-doc-meta { display: grid; gap: 0.2rem; font-size: 0.72rem; }
.lp .lp-doc-meta p { display: grid; grid-template-columns: auto auto; gap: 0.9rem; justify-content: end; margin: 0; }
.lp .lp-doc-meta span { color: #8A857A; }
.lp .lp-doc-meta b { font-family: var(--font-mono); font-weight: 600; text-align: right; }

.lp .lp-doc-table { width: 100%; border-collapse: collapse; margin: 0.4rem 0 1rem; font-size: 0.73rem; }
.lp .lp-doc-table th { text-align: left; padding: 0.45rem 0.5rem; font-family: var(--font-mono); font-size: 0.58rem;
  font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #6F6E69;
  background: #FAF9F5; border-bottom: 1px solid #EBE7DC; }
.lp .lp-doc-table td { padding: 0.5rem 0.5rem; border-bottom: 1px solid #F0EEE6; vertical-align: top; }
.lp .lp-doc-r { text-align: right; }
.lp .lp-doc-mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

.lp .lp-doc-sum { margin-left: auto; width: min(20rem, 100%); display: grid; gap: 0.25rem; font-size: 0.75rem; }
.lp .lp-doc-sum p { display: flex; justify-content: space-between; gap: 1rem; margin: 0; }
.lp .lp-doc-sum span { color: #6F6E69; }
.lp .lp-doc-sum b { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }
.lp .lp-doc-sum-rule { padding-top: 0.3rem; border-top: 1px solid #EBE7DC; }
.lp .lp-doc-sum-total { margin-top: 0.3rem; padding-top: 0.4rem; border-top: 2px solid #1F1E1D; font-weight: 700; }
.lp .lp-doc-sum-total span { color: #1F1E1D; font-weight: 700; }
.lp .lp-doc-sum-total b { font-size: 0.9rem; }

/* Amount in words is a statutory requirement on the tax invoice, not decoration. */
.lp .lp-doc-words { margin: 1.2rem 0 0; padding-top: 0.8rem; border-top: 1px solid #F0EEE6; font-size: 0.72rem; font-style: italic; color: #35506D; }
.lp .lp-doc-foot { margin: 0.9rem 0 0; font-size: 0.64rem; color: #8A857A; }
.lp .lp-doc-sign { margin-top: 1.6rem; display: grid; justify-items: center; gap: 0.35rem; }
.lp .lp-doc-sign span { display: block; width: 12rem; border-bottom: 1px solid #A9BACB; }

/* Tabs double as a manual override: clicking one stops the carousel. */
.lp .lp-docs-tabs { display: flex; justify-content: center; gap: 0.5rem; margin-top: 1.5rem; }
.lp .lp-docs-tab { border: 1px solid rgba(255, 255, 255, 0.22); background: rgba(255, 255, 255, 0.07);
  color: rgba(240, 238, 230, 0.8); border-radius: 999px; padding: 0.35rem 0.85rem; font-size: 0.75rem; font-weight: 600;
  cursor: pointer; transition: background 200ms ease, color 200ms ease, border-color 200ms ease; }
.lp .lp-docs-tab:hover { background: rgba(255, 255, 255, 0.14); color: #FFFFFF; }
.lp .lp-docs-tab.is-on { background: var(--amber); border-color: var(--amber); color: #3D2A00; }
.lp .lp-docs-tab:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

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
.lp .lp-start-rail { position: absolute; background: #EBE7DC; overflow: hidden;
  left: calc(1.075rem - 1px); top: 2.35rem; bottom: 0.35rem; width: 2px; }
@media (min-width: 60rem) {
  .lp .lp-start-rail { left: 1.075rem; right: 0; top: calc(2.6rem + 1.075rem - 1px); bottom: auto; width: auto; height: 2px; }
}
.lp .lp-start-step:last-child .lp-start-rail { display: none; }
.lp .lp-start-rail-fill { display: block; width: 100%; height: 100%; background: linear-gradient(180deg, var(--violet), var(--amber));
  transform: scaleY(0); transform-origin: top; transition: transform 620ms var(--lp-ease-io); }
@media (min-width: 60rem) {
  .lp .lp-start-rail-fill { background: linear-gradient(90deg, var(--violet), var(--amber)); transform: scaleX(0); transform-origin: left; }
}
.lp .lp-start-step.is-done .lp-start-rail-fill { transform: scale(1); }

/* The dot stacks three marks; opacity picks which one reads. */
.lp .lp-start-dot { position: relative; flex: none; display: grid; place-items: center; width: 2.15rem; height: 2.15rem; border-radius: 999px;
  background: #FFFFFF; border: 2px solid #EBE7DC; color: #8A857A;
  transition: background 320ms ease, border-color 320ms ease, color 320ms ease, transform 320ms ease; }
.lp .lp-start-dot > * { grid-area: 1 / 1; transition: opacity 260ms ease, transform 260ms ease; }
.lp .lp-start-icon-done { opacity: 0; transform: scale(0.6); }
/* Violet marks the step being worked, amber the rail it has already filled — the
   two accents split the "now" and "done" states between them. */
/* One ring as the step becomes current, then it holds. The spinner on the rim is
   already saying "working" for as long as that lasts; a second looping signal
   saying the same thing is just noise. */
.lp .lp-start-step.is-live .lp-start-dot { border-color: var(--violet); color: var(--violet); animation: lp-pulse-ring 1.4s var(--lp-ease-io) 1 both; }
.lp .lp-start-step.is-done .lp-start-dot { background: var(--violet); border-color: var(--violet); color: #FFFFFF; }
.lp .lp-start-step.is-done .lp-start-icon-idle { opacity: 0; transform: scale(0.6); }
.lp .lp-start-step.is-done .lp-start-icon-done { opacity: 1; transform: scale(1); }

/* Spinner rides the rim while the step is working. */
.lp .lp-start-spin { width: 2.15rem; height: 2.15rem; border-radius: 999px; opacity: 0;
  border: 2px solid transparent; border-top-color: #D97757; border-right-color: #D97757; }
.lp .lp-start-step.is-live .lp-start-spin { opacity: 1; animation: lp-start-spin 900ms linear infinite; }
@keyframes lp-start-spin { to { transform: rotate(360deg); } }

/* When a step becomes current the whole card lifts and settles back, so the eye is
   carried along the row rather than having to find the next dot. It rises and
   returns — no scale, since scaling the step resamples the type inside it at every
   frame of a sequence that runs on a loop. The keyframe returns to its own start,
   so a step that has already played sits flat again once the sequence moves on. */
@keyframes lp-start-pop {
  0%   { transform: translate3d(0, 0, 0); }
  38%  { transform: translate3d(0, -8px, 0); }
  100% { transform: translate3d(0, 0, 0); }
}
.lp .lp-start-step.is-live { animation: lp-start-pop 1900ms var(--lp-ease-io) both; z-index: 1; }
.lp .lp-start-step.is-live .lp-start-copy { transition: none; }

.lp .lp-start-copy { display: flex; flex-direction: column; gap: 0.2rem; }
.lp .lp-start-title { font-weight: 700; font-size: 0.9375rem; color: var(--ink); transition: color 320ms ease; }
.lp .lp-start-note { font-size: 0.8125rem; color: var(--body); opacity: 0.75; max-width: 22ch; }
.lp .lp-start-step.is-wait .lp-start-title { color: #8A857A; }

/* Mid-page variant: full-bleed, so it cuts the whole width of the page. Ruled top
   and bottom rather than boxed, which is what lets it read as a band rather than
   as a second announcement bar. */
.lp .lp-ticker-inset { margin: 0; }
.lp .lp-ticker.is-band { border-top: 1px solid rgba(61, 42, 0, 0.22); border-bottom: 1px solid rgba(61, 42, 0, 0.22); padding: 0.8rem 1.25rem; box-shadow: 0 14px 34px -26px rgba(61, 42, 0, 0.6); }
.lp .lp-ticker.is-band .lp-ticker-item { font-size: 0.875rem; }
/* The band sits mid-page where it would catch the eye repeatedly; let it scroll
   without the extra sheen sweep the top bar uses. */
.lp .lp-ticker.is-band::after { content: none; }

/* Header nav link */
.lp .lp-navlink { font-size: 0.875rem; font-weight: 600; color: var(--body); text-decoration: none; padding: 0.35rem 0.15rem; }
.lp .lp-navlink:hover { color: var(--emerald); }
.lp .lp-navlink:focus-visible { outline: 2px solid #BD5D3A; outline-offset: 3px; border-radius: 4px; }

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
.lp .lp-ledger { background-image: linear-gradient(158deg, #141413 0%, #2A2724 55%, #4A3B33 100%); color: #EBE7DC; border-radius: 1.25rem; padding: 1.5rem 1.5rem 1.25rem; box-shadow: 0 36px 68px -34px rgba(20, 20, 19, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.09); }
.lp .lp-ledger-head { display: flex; align-items: center; justify-content: space-between; }
.lp .lp-ledger-ref { font-size: 0.75rem; letter-spacing: 0.06em; color: #E0C3B2; }
.lp .lp-ledger-status { display: inline-flex; align-items: center; gap: 0.3rem; font-size: 0.7rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: #EBE7DC; background: rgba(232, 213, 203, 0.18); border-radius: 999px; padding: 0.25rem 0.6rem; }
.lp .lp-ledger-title { margin-top: 0.85rem; font-family: var(--font-serif); font-size: 1.2rem; letter-spacing: -0.015em; color: #FAF9F5; }
.lp .lp-ledger-cols, .lp .lp-row, .lp .lp-totals { display: grid; grid-template-columns: minmax(0, 1fr) 6.5rem 6.5rem; gap: 0.75rem; align-items: baseline; }
.lp .lp-ledger-cols { margin-top: 1.35rem; padding-bottom: 0.5rem; border-bottom: 1.5px solid rgba(232, 213, 203, 0.3); font-size: 0.68rem; letter-spacing: 0.12em; text-transform: uppercase; color: #E0C3B2; }
.lp .lp-rows { margin: 0; padding: 0; list-style: none; }
.lp .lp-row { padding-block: 0.7rem; border-bottom: 1px solid rgba(232, 213, 203, 0.15); font-size: 0.875rem; color: #F0EEE6; }
.lp .lp-acct { display: flex; align-items: baseline; gap: 0.55rem; min-width: 0; }
.lp .lp-code { font-size: 0.75rem; color: #E0C3B2; }
.lp .lp-num { text-align: right; font-size: 0.8125rem; }
.lp .lp-totals { padding-top: 0.8rem; font-size: 0.8125rem; color: #A7CBE4; }
.lp .lp-num-strong { color: #FFFFFF; font-weight: 700; font-size: 0.9375rem; }
.lp .lp-balance { margin-top: 0.9rem; padding-top: 0.85rem; border-top: 1.5px solid rgba(232, 213, 203, 0.3); display: flex; align-items: center; justify-content: space-between; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: #E0C3B2; }
.lp .lp-balance-value { display: inline-flex; align-items: center; gap: 0.35rem; color: #E09B7D; font-weight: 700; letter-spacing: 0.04em; }
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
.lp .lp-axiom-eq { font-size: 0.8125rem; letter-spacing: 0.08em; color: var(--emerald); border: 1px solid rgba(189, 93, 58, 0.3); background-image: linear-gradient(120deg, rgba(217, 119, 87, 0.14), rgba(217, 119, 87, 0.04)); border-radius: 999px; padding: 0.3rem 0.75rem; }

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
/* Rows rise into place, staggered by a delay set per row in the markup. One axis,
   one curve — the same entrance every other group of items on this page uses. */
.lp .lp-armed .lp-group { opacity: 0;
  transform: translate3d(0, var(--lp-rise-sm), 0);
  transition: opacity var(--lp-dur) var(--lp-ease), transform var(--lp-dur) var(--lp-ease); }
.lp .lp-armed.is-visible .lp-group { opacity: 1; transform: none; }
@media (min-width: 48rem) { .lp .lp-group { grid-template-columns: 10rem 1fr; gap: 2.5rem; } }
.lp .lp-group-key { display: flex; align-items: baseline; gap: 0.75rem; }
.lp .lp-group-code { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; background-image: linear-gradient(135deg, #D97757 0%, #BD5D3A 100%); -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.lp .lp-group-class { font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.lp .lp-chips { margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.45rem; list-style: none; padding: 0; }
.lp .lp-chips li { font-size: 0.7rem; letter-spacing: 0.04em; color: #BD5D3A; background-image: linear-gradient(140deg, rgba(217, 119, 87, 0.14), rgba(217, 119, 87, 0.05)); border: 1px solid rgba(189, 93, 58, 0.12); border-radius: 999px; padding: 0.3rem 0.7rem; }

/* Close cycle */
.lp .lp-section-lede { margin-top: 1rem; max-width: 44rem; font-size: 1rem; }
.lp .lp-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 1px; background: var(--rule); border-block: 1px solid var(--rule); }
@media (min-width: 44rem) { .lp .lp-steps { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-steps { grid-template-columns: repeat(3, 1fr); } }
.lp .lp-step { display: flex; gap: 1rem; padding: 1.6rem 1.4rem; background-image: linear-gradient(165deg, rgba(255, 255, 255, 0.92), rgba(250, 249, 245, 0.72)); }
.lp .lp-armed .lp-step { opacity: 0;
  transform: translate3d(0, var(--lp-rise-sm), 0);
  transition: opacity var(--lp-dur) var(--lp-ease), transform var(--lp-dur) var(--lp-ease); }
.lp .lp-armed.is-visible .lp-step { opacity: 1; transform: none; }
.lp .lp-step-no { font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.06em; color: var(--emerald); padding-top: 0.15rem; }
.lp .lp-step-term { font-family: var(--font-serif); font-size: 1.15rem; letter-spacing: -0.015em; color: var(--ink); }
.lp .lp-step .lp-body { margin-top: 0.4rem; font-size: 0.875rem; }

/* Reports */
.lp .lp-reports { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr; gap: 0.75rem; }
@media (min-width: 44rem) { .lp .lp-reports { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-reports { grid-template-columns: repeat(4, 1fr); } }
.lp .lp-report { padding: 1.15rem 1.15rem 1.25rem; border: 1px solid var(--rule); border-radius: 0.85rem; background-image: linear-gradient(160deg, rgba(255, 255, 255, 0.95), rgba(240, 238, 230, 0.75)); border-top: 2px solid rgba(217, 119, 87, 0.55); }
.lp .lp-armed .lp-report { opacity: 0;
  transform: translate3d(0, var(--lp-rise-sm), 0);
  transition: opacity var(--lp-dur) var(--lp-ease), transform var(--lp-dur) var(--lp-ease); }
.lp .lp-armed.is-visible .lp-report { opacity: 1; transform: none; }
.lp .lp-report h3 { font-size: 0.9375rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.lp .lp-report p { margin-top: 0.35rem; font-size: 0.8125rem; line-height: 1.55; color: var(--body); }

/* Local specifics */
.lp .lp-locale { display: grid; grid-template-columns: 1fr; gap: 2rem 3rem; }
@media (min-width: 48rem) { .lp .lp-locale { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-locale-item { padding-left: 1.1rem; border-left: 2px solid rgba(217, 119, 87, 0.45); }

/* Pricing — wider than the rest of the page so dense tables breathe */
.lp .lp-pricing { scroll-margin-top: 5rem; max-width: 90rem; }
.lp .lp-plan-cur { font-family: var(--font-mono); font-size: 0.85rem; font-weight: 600; color: var(--emerald); }
.lp .lp-plan-per { font-size: 0.85rem; color: var(--muted); }
.lp .lp-plan-flag { position: absolute; top: -0.75rem; left: 1.35rem; font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FFFFFF; background-image: linear-gradient(135deg, #C4694A, #BD5D3A); border-radius: 999px; padding: 0.26rem 0.65rem; }
.lp .lp-plan-cta { margin-top: auto; justify-content: center; }
.lp .lp-plans-note { margin-top: 2rem; font-size: 0.78rem; line-height: 1.55; color: var(--muted); }

/* Core-ledger band */
.lp .lp-core { margin-bottom: 2rem; padding: 1.4rem 1.5rem; border: 1px solid rgba(189, 93, 58, 0.22); border-radius: 1rem; background-image: linear-gradient(150deg, rgba(217, 119, 87, 0.10), rgba(217, 119, 87, 0.03)); }
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
.lp .lp-tier { position: relative; display: flex; flex-direction: column; padding: 2.25rem 2rem; border: 1px solid var(--rule); border-radius: 1.5rem; background-image: linear-gradient(168deg, rgba(255, 255, 255, 0.98), rgba(240, 238, 230, 0.85)); box-shadow: 0 24px 48px -34px rgba(20, 20, 19, 0.4); transition: transform var(--lp-dur-ui) var(--lp-ease), box-shadow var(--lp-dur-ui) ease, border-color var(--lp-dur-ui) ease; }
.lp .lp-tier:hover { transform: translate3d(0, -10px, 0); border-color: rgba(196, 105, 74, 0.65); box-shadow: 0 40px 70px -30px rgba(20, 20, 19, 0.55); z-index: 2; }
/* Accent edge on every tier: a hairline of amber running into violet across the
   top of the card, tucked inside the rounded corner. */
.lp .lp-tier::before { content: ""; position: absolute; left: 1.75rem; right: 1.75rem; top: -1px; height: 3px; border-radius: 0 0 3px 3px;
  background: linear-gradient(90deg, var(--amber), var(--amber-lo) 38%, var(--violet-lo) 72%, var(--violet)); opacity: 0.9; }
.lp .lp-tier:hover { border-color: rgba(31, 30, 29, 0.42); }
.lp .lp-tier.is-popular { border-color: transparent; box-shadow: 0 0 0 2px var(--violet), 0 34px 60px -30px rgba(31, 30, 29, 0.45); background-image: linear-gradient(168deg, #FFFFFF, #F5F2EA); }
.lp .lp-tier.is-popular::before { left: 1.25rem; right: 1.25rem; height: 4px; opacity: 1; }
/* The popular tier already stands slightly proud of its neighbours; hovering it
   lifts from there rather than resetting to the row. */
@media (min-width: 68rem) { .lp .lp-tier.is-popular { transform: translate3d(0, -8px, 0); } .lp .lp-tier.is-popular:hover { transform: translate3d(0, -18px, 0); } }
.lp .lp-tier.is-popular:hover { box-shadow: 0 0 0 2px var(--violet), 0 40px 70px -30px rgba(31, 30, 29, 0.5); }

.lp .lp-tier-top { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; min-height: 1.6rem; margin-bottom: 0.9rem; }
.lp .lp-tier-badge { font-family: var(--font-sans); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: #BD5D3A; background: rgba(224, 155, 125, 0.3); border-radius: 999px; padding: 0.32rem 0.75rem; }
.lp .lp-tier-badge.is-pop { color: #FFFFFF; background-image: linear-gradient(135deg, #BD5D3A, #141413); }
.lp .lp-tier-off { margin-left: auto; font-family: var(--font-sans); font-size: 0.8rem; font-weight: 800; letter-spacing: -0.01em; color: #FFFFFF; background-image: linear-gradient(135deg, #2E7BB8, #BD5D3A); border-radius: 0.5rem; padding: 0.3rem 0.6rem; box-shadow: 0 6px 14px -6px rgba(189, 93, 58, 0.7); }

.lp .lp-tier-name { font-family: var(--font-sans); font-weight: 800; font-size: 1.7rem; letter-spacing: -0.03em; color: var(--ink); }
.lp .lp-tier-desc { margin-top: 0.35rem; font-size: 0.9rem; line-height: 1.5; color: var(--muted); min-height: 2.7rem; }
.lp .lp-tier-reg { margin-top: 1.35rem; font-size: 1rem; font-weight: 500; color: var(--muted); text-decoration: line-through; text-decoration-color: rgba(111, 110, 105, 0.6); }
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
  .lp .lp-tier.is-popular:hover { transform: translateZ(18px); }
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

.lp .lp-sub.is-violet { position: relative; margin-top: 3.5rem; padding-block: 2.5rem 2.25rem; color: #F5F2EA;
  background-image:
    radial-gradient(48rem 24rem at 8% -12%, rgba(217, 119, 87, 0.55), transparent 62%),
    radial-gradient(42rem 24rem at 96% 112%, rgba(255, 192, 30, 0.2), transparent 64%),
    linear-gradient(158deg, #2A2724 0%, var(--violet) 48%, #141413 100%); }
@media (min-width: 48rem) { .lp .lp-sub.is-violet { padding-block: 3.25rem 3rem; } }
/* Amber hairline across the top, matching the band and the marquee. Edge to edge
   now, so it fades out at the viewport rather than at a card corner. */
.lp .lp-sub.is-violet::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--amber-lo) 78%, transparent); }

.lp .lp-sub.is-violet .lp-sub-title { color: #FFFFFF; }
.lp .lp-sub.is-violet .lp-sub-lede { color: rgba(245, 242, 234, 0.82); }
.lp .lp-sub.is-violet .lp-pack-group.is-boxed { border-color: rgba(255, 255, 255, 0.2); background-image: linear-gradient(165deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.06)); box-shadow: none; backdrop-filter: blur(2px); }
.lp .lp-sub.is-violet .lp-pack-head { color: #FFFFFF; border-bottom-color: rgba(255, 192, 30, 0.65); }
.lp .lp-sub.is-violet .lp-pricelist li { border-bottom-color: rgba(255, 255, 255, 0.14); }
.lp .lp-sub.is-violet .lp-pl-label { color: rgba(245, 242, 234, 0.86); }
.lp .lp-sub.is-violet .lp-pl-price { color: #FFFFFF; }
.lp .lp-sub.is-violet .lp-pl-cur { color: var(--amber); }
.lp .lp-sub.is-violet .lp-pl-per { color: rgba(245, 242, 234, 0.6); }

/* ── Industry bundles on navy ────────────────────────────────────────────────
   Same panel geometry as the violet one so the two read as a set, in the page's
   own darkest ink rather than a new hue. The content here is a table, so the
   inversion is about rules and cell colour rather than cards. */
.lp .lp-sub.is-navy { position: relative; margin-top: 3.5rem; padding-block: 2.5rem 2.25rem; color: #F0EEE6;
  background-image:
    radial-gradient(46rem 24rem at 6% -14%, rgba(217, 119, 87, 0.35), transparent 62%),
    radial-gradient(40rem 24rem at 98% 114%, rgba(31, 30, 29, 0.28), transparent 64%),
    linear-gradient(158deg, #2A2724 0%, var(--ink) 52%, #141413 100%); }
@media (min-width: 48rem) { .lp .lp-sub.is-navy { padding-block: 3.25rem 3rem; } }
.lp .lp-sub.is-navy::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--violet-lo) 78%, transparent); }

.lp .lp-sub.is-navy .lp-sub-title { color: #FFFFFF; }
.lp .lp-sub.is-navy .lp-sub-lede { color: rgba(240, 238, 230, 0.78); }
/* The scroll container carries the table's own frame — drop it to translucent so
   the panel gradient reads through rather than sitting behind a white slab. */
.lp .lp-sub.is-navy .lp-table-scroll { border-color: rgba(255, 255, 255, 0.16); background: rgba(255, 255, 255, 0.05); }
.lp .lp-sub.is-navy .lp-ptable th, .lp .lp-sub.is-navy .lp-ptable td { border-bottom-color: rgba(255, 255, 255, 0.13); }
.lp .lp-sub.is-navy .lp-ptable thead th { color: rgba(240, 238, 230, 0.6); }
.lp .lp-sub.is-navy .lp-ptable tbody th { color: #FFFFFF; }
.lp .lp-sub.is-navy .lp-ptable td { color: rgba(240, 238, 230, 0.82); }
.lp .lp-sub.is-navy .lp-price-em { color: var(--amber); }

/* Pack groups */
.lp .lp-packs { display: grid; grid-template-columns: 1fr; gap: 1.5rem 2.5rem; }
@media (min-width: 44rem) { .lp .lp-packs { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 68rem) { .lp .lp-packs { grid-template-columns: repeat(3, 1fr); } }
.lp .lp-packs-two { grid-template-columns: 1fr; }
@media (min-width: 52rem) { .lp .lp-packs-two { grid-template-columns: repeat(2, 1fr); } }
.lp .lp-pack-group.is-boxed { padding: 1.35rem 1.4rem; border: 1px solid var(--rule); border-radius: 1rem; background-image: linear-gradient(165deg, rgba(255, 255, 255, 0.95), rgba(240, 238, 230, 0.7)); box-shadow: 0 16px 32px -30px rgba(20, 20, 19, 0.4); }
.lp .lp-pack-head { font-family: var(--font-serif); font-size: 1.02rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; margin-bottom: 0.5rem; padding-bottom: 0.6rem; border-bottom: 2px solid rgba(217, 119, 87, 0.4); }

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
/* Controls were one welded block: a 1px grid gap letting the container background
   show through as hairlines, with overflow:hidden clipping the rounded corners.
   That shape cannot pop — a card that lifts or scales gets its edges cut off at
   the container boundary. So they're now discrete cards with a real gap, which is
   what lets each one rise clear of its neighbours. */
.lp .lp-controls { display: grid; grid-template-columns: 1fr; gap: 0.85rem; }
@media (min-width: 48rem) { .lp .lp-controls { grid-template-columns: repeat(2, 1fr); gap: 1rem; } }
.lp .lp-control { position: relative; padding: 1.6rem 1.5rem; border-radius: 0.9rem;
  border: 1px solid var(--rule);
  background-image: linear-gradient(160deg, #FFFFFF 0%, #FAF9F5 100%);
  box-shadow: 0 16px 32px -28px rgba(20, 20, 19, 0.5);
  transition: transform var(--lp-dur-ui) var(--lp-ease), box-shadow var(--lp-dur-ui) ease, border-color var(--lp-dur-ui) ease; }

/* Hovering a control should read as the control ENGAGING, not as a card floating.
   Two borrowings from audit working papers, where these four things actually live:
     · the margin rule struck down the side of a control that is in place,
     · the tick that marks it as tested.
   A gradient wipe across the top would have been the generic SaaS card hover; it
   says nothing about what these cards are. */

/* The margin rule: snaps down the left edge, top-anchored, like a pen stroke. */
.lp .lp-control::before { content: ""; position: absolute; left: -1px; top: 0.9rem; bottom: 0.9rem; width: 3px;
  border-radius: 3px; background: linear-gradient(180deg, var(--amber), var(--violet));
  transform: scaleY(0); transform-origin: 50% 0;
  transition: transform 320ms var(--lp-ease); }

/* The tick: the mark an auditor leaves once a control has been tested. Decorative
   reinforcement — the section lede already states these come as standard. */
.lp .lp-control::after { content: "✓ Enforced"; position: absolute; top: 0.95rem; right: 1.1rem;
  font-family: var(--font-mono); font-size: 0.55rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: var(--amber); opacity: 0; transform: translateX(-0.35rem);
  transition: opacity 220ms ease, transform 320ms var(--lp-ease); }

/* The lift. Deliberately no scale: a control engaging is a snap, not a zoom, and
   scaling a card blurs the type inside it.

   Both selectors are needed — the first outranks the reveal rule below (which pins
   transform:none once the section is visible), the second covers the never-armed
   case. z-index lifts the card so its shadow isn't drawn under its neighbours. */
.lp .lp-armed.is-visible .lp-control:hover,
.lp .lp-controls .lp-control:hover {
  transform: translate3d(0, calc(var(--lp-lift) * -1), 0); z-index: 2;
  border-color: rgba(31, 30, 29, 0.45);
  box-shadow: 0 30px 56px -24px rgba(20, 20, 19, 0.55); }
.lp .lp-control:hover::before, .lp .lp-control:focus-within::before { transform: scaleY(1); }
.lp .lp-control:hover::after, .lp .lp-control:focus-within::after { opacity: 1; transform: none; }
/* Keyboard parity — same state on focus, since a card can hold links. */
.lp .lp-control:focus-within { border-color: rgba(31, 30, 29, 0.45); }

.lp .lp-armed .lp-control { opacity: 0;
  transform: translate3d(0, var(--lp-rise-sm), 0);
  transition: opacity var(--lp-dur) var(--lp-ease), transform var(--lp-dur) var(--lp-ease); }
/* Once revealed, the card hands its transform back to the hover rule — which needs
   the shorter pointer timing, not the long reveal one. */
.lp .lp-armed.is-visible .lp-control { opacity: 1; transform: none;
  transition: opacity var(--lp-dur) var(--lp-ease), transform var(--lp-dur-ui) var(--lp-ease), box-shadow var(--lp-dur-ui) ease, border-color var(--lp-dur-ui) ease; }
.lp .lp-control dt { padding-right: 5.5rem; font-size: 0.95rem; font-weight: 600; color: var(--ink); letter-spacing: -0.01em; }
.lp .lp-control dd { margin: 0.45rem 0 0; font-size: 0.875rem; line-height: 1.6; color: var(--body); }

/* Close — the page's green deepens into one last panel */
/* ── Closing call to action ──────────────────────────────────────────────────
   Two columns on wide screens: the argument on the left, the payoff restated as a
   balanced entry on the right. Amber is used only on the offer chip and the primary
   button, so the eye lands on those two things and nothing competes with them. */
.lp .lp-closing { position: relative; overflow: hidden;
  margin-block: clamp(2rem, 5vw, 3rem) clamp(3rem, 7vw, 4.5rem);
  padding: clamp(2.25rem, 5.5vw, 3.75rem); border-radius: 1.5rem;
  display: grid; grid-template-columns: 1fr; gap: 2.5rem; align-items: center;
  background-image:
    radial-gradient(40rem 22rem at 88% -20%, rgba(31, 30, 29, 0.45), transparent 62%),
    radial-gradient(34rem 20rem at 4% 116%, rgba(255, 192, 30, 0.16), transparent 64%),
    linear-gradient(135deg, #141413 0%, #BD5D3A 58%, #12507F 100%);
  box-shadow: 0 40px 70px -42px rgba(20, 20, 19, 0.6); }
@media (min-width: 62rem) { .lp .lp-closing { grid-template-columns: 1.35fr 0.65fr; gap: 3.5rem; } }
.lp .lp-closing::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 24%, var(--violet-lo) 76%, transparent); }

.lp .lp-closing-main { min-width: 0; }
.lp .lp-closing-eyebrow { display: inline-flex; align-items: center; gap: 0.35rem; margin: 0 0 1.1rem;
  font-family: var(--font-mono); font-size: 0.6rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: #3D2A00; background: var(--amber); border-radius: 999px; padding: 0.25rem 0.6rem; }
.lp .lp-closing-h { max-width: none; margin: 0; color: #FFFFFF; }
.lp .lp-closing-lede { max-width: 38rem; margin: 1.1rem 0 0; font-size: 1.0625rem; line-height: 1.6; color: rgba(255, 255, 255, 0.84); }

/* The next three steps, so "start free" resolves into a known sequence. */
.lp .lp-closing-steps { list-style: none; margin: 1.75rem 0 0; padding: 0; display: grid; gap: 0.9rem; }
@media (min-width: 44rem) { .lp .lp-closing-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.25rem; } }
.lp .lp-closing-steps li { display: grid; grid-template-columns: auto 1fr; gap: 0.6rem; align-items: start;
  padding-top: 0.85rem; border-top: 1px solid rgba(255, 255, 255, 0.2); font-size: 0.8rem; line-height: 1.5;
  color: rgba(255, 255, 255, 0.72); }
.lp .lp-closing-no { font-size: 0.68rem; font-weight: 700; color: var(--amber); }
.lp .lp-closing-steps b { display: block; margin-bottom: 0.15rem; color: #FFFFFF; font-size: 0.85rem; }

.lp .lp-closing-cta { display: flex; align-items: center; gap: 1.5rem; flex-wrap: wrap; margin-top: 2rem; }
.lp .lp-closing-second { font-size: 0.875rem; font-weight: 600; color: rgba(255, 255, 255, 0.78);
  text-decoration: underline; text-underline-offset: 4px; }
.lp .lp-closing-second:hover { color: #FFFFFF; }

.lp .lp-closing-risk { list-style: none; margin: 1.5rem 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem 1.35rem; }
.lp .lp-closing-risk li { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.78rem; color: rgba(255, 255, 255, 0.75); }
.lp .lp-closing-risk svg { color: #7A9A6B; flex: none; }
.lp .lp-closing-note { margin-top: 1.35rem; font-size: 0.8125rem; color: rgba(255, 255, 255, 0.62); }

/* Proof panel: the outcome, not another feature claim. */
.lp .lp-closing-proof { padding: 1.4rem 1.5rem; border-radius: 1rem;
  border: 1px solid rgba(255, 255, 255, 0.2); background: rgba(255, 255, 255, 0.08); backdrop-filter: blur(3px); }
.lp .lp-closing-proof-ref { margin: 0 0 1rem; font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255, 255, 255, 0.55); }
.lp .lp-closing-proof-rows { display: grid; gap: 0.5rem; font-size: 0.82rem; font-variant-numeric: tabular-nums; }
.lp .lp-closing-proof-rows p { display: flex; justify-content: space-between; gap: 1rem; margin: 0; }
.lp .lp-closing-proof-rows span { color: rgba(255, 255, 255, 0.6); }
.lp .lp-closing-proof-rows b { color: #FFFFFF; font-weight: 700; }
.lp .lp-closing-proof-ok { display: flex; align-items: center; gap: 0.35rem; margin: 0.9rem 0 0; padding-top: 0.7rem;
  border-top: 3px double rgba(255, 255, 255, 0.3); font-size: 0.75rem; font-weight: 700; color: #7A9A6B; }
/* Inline "log in" escape hatch — present for returning users without competing
   with the primary signup action. */
.lp .lp-note-link { color: inherit; font-weight: 700; text-decoration: underline; text-underline-offset: 3px; }
.lp .lp-note-link:hover { opacity: 0.8; }
/* Amber, not white — the primary action here should match the one in the marquee,
   the popup and the footer rather than reading as a third button style. */
.lp .lp-closing .lp-btn { background-image: linear-gradient(135deg, var(--amber-lo) 0%, var(--amber) 100%); color: #3D2A00; box-shadow: 0 14px 30px -12px rgba(0, 0, 0, 0.55); }
.lp .lp-closing .lp-btn:focus-visible { outline-color: #FFFFFF; }
/* ── Footer: the closing entry ───────────────────────────────────────────────
   Dark, so the page ends on the same ground as the ledger and document bands.
   Ruled like a journal page: a header line for the reference, account-range
   columns, then a double rule and the balance check — the accounting convention
   for a total, doing real work as the footer's bottom rule. */
.lp .lp-footer { position: relative; color: #EBE7DC; padding-top: 3.5rem; padding-bottom: 2rem;
  background-image:
    radial-gradient(52rem 26rem at 12% -18%, rgba(217, 119, 87, 0.32), transparent 62%),
    radial-gradient(44rem 24rem at 92% 118%, rgba(31, 30, 29, 0.26), transparent 64%),
    linear-gradient(168deg, #2A2724 0%, var(--ink) 46%, #001120 100%); }
/* Amber hairline seals the top edge, matching the bands and the marquee. */
.lp .lp-footer::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 3px;
  background: linear-gradient(90deg, transparent, var(--amber) 22%, var(--violet-lo) 78%, transparent); }

/* Header line: reference, status, then a rule that fills the remaining width. */
.lp .lp-foot-head { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 2.25rem; }
.lp .lp-foot-jv { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.08em; color: var(--mint); }
.lp .lp-foot-posted { display: inline-flex; align-items: center; gap: 0.25rem; font-family: var(--font-mono);
  font-size: 0.58rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
  color: #0C2F17; background: #7A9A6B; border-radius: 999px; padding: 0.16rem 0.5rem; }
.lp .lp-foot-rule { flex: 1 1 3rem; height: 1px; min-width: 2rem; background: rgba(255, 255, 255, 0.16); }
.lp .lp-foot-period { font-size: 0.65rem; color: rgba(235, 231, 220, 0.55); }

/* Account-range columns. */
.lp .lp-foot-ledger { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2rem 1.5rem; }
@media (min-width: 52rem) { .lp .lp-foot-ledger { grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 2.5rem; } }
.lp .lp-foot-key { display: flex; align-items: baseline; gap: 0.5rem; margin: 0 0 0.9rem;
  padding-bottom: 0.6rem; border-bottom: 1px solid rgba(255, 255, 255, 0.14); }
.lp .lp-foot-code { font-size: 1.05rem; font-weight: 700; letter-spacing: -0.02em;
  background-image: linear-gradient(135deg, var(--mint), var(--amber));
  -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent; }
.lp .lp-foot-class { font-size: 0.58rem; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(235, 231, 220, 0.55); }
.lp .lp-foot-links { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
.lp .lp-foot-links a { font-size: 0.83rem; color: rgba(235, 231, 220, 0.82); text-decoration: none;
  transition: color 180ms ease, padding-left 180ms ease; }
/* A ledger tick appears on hover, so the row reads as being selected. */
.lp .lp-foot-links a::before { content: "› "; opacity: 0; color: var(--amber); }
.lp .lp-foot-links a:hover { color: #FFFFFF; }
.lp .lp-foot-links a:hover::before { opacity: 1; }
.lp .lp-foot-links a:focus-visible { outline: 2px solid var(--amber); outline-offset: 3px; border-radius: 2px; }

/* The closing total: double rule above, as a ledger total is drawn. */
.lp .lp-foot-totals { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 0.4rem 1rem;
  margin-top: 2.5rem; padding-top: 0.7rem; font-size: 0.72rem; font-variant-numeric: tabular-nums;
  border-top: 3px double rgba(255, 255, 255, 0.28); }
.lp .lp-foot-tot-lbl { color: rgba(235, 231, 220, 0.55); }
.lp .lp-foot-tot-val { font-weight: 700; color: #FFFFFF; }
.lp .lp-foot-tot-diff { display: inline-flex; align-items: center; gap: 0.3rem; font-weight: 700; color: #7A9A6B; }

.lp .lp-foot-base { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.25rem;
  margin-top: 2.25rem; padding-top: 1.5rem; border-top: 1px solid rgba(255, 255, 255, 0.12); }
.lp .lp-foot-brand { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
.lp .lp-foot-tag { font-size: 0.75rem; color: rgba(235, 231, 220, 0.55); }
.lp .lp-foot-meta { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; }
.lp .lp-foot-cta { display: inline-flex; align-items: center; gap: 0.35rem; font-size: 0.8rem; font-weight: 700;
  color: #3D2A00; background-image: linear-gradient(90deg, var(--amber-lo), var(--amber));
  border-radius: 999px; padding: 0.45rem 0.9rem; text-decoration: none; }
.lp .lp-foot-cta:hover { filter: brightness(1.06); }
.lp .lp-foot-copy { font-size: 0.7rem; color: rgba(235, 231, 220, 0.5); }
/* The mark is drawn for the light page; invert it here. */
.lp .lp-footer .lp-mark span { background: var(--mint); }

/* Motion
   The hero's two columns rise into place rather than flying in from the sides.
   Movement and opacity still run on separate clocks — the travel finishes well
   before the fade does, so the copy is settled and legible while it is still
   coming up to full strength. That split is what makes an entrance feel
   unhurried instead of merely slow.

   The ledger card follows the copy by a beat. One direction, one curve, and a
   delay is enough to say which of the two is the subject. */
@keyframes lp-rise-in {
  from { transform: translate3d(0, 2.5rem, 0); }
  to   { transform: translate3d(0, 0, 0); }
}
/* Opacity runs on its own, much longer ramp than the movement — things arrive in
   place well before they arrive in colour, which is what makes it feel slow. */
@keyframes lp-fade-slow { from { opacity: 0; } to { opacity: 1; } }
/* Rows arrive one after another, as lines being written onto the sheet. */
@keyframes lp-row-in {
  from { opacity: 0; transform: translate3d(0, 0.75rem, 0); }
  to   { opacity: 1; transform: none; }
}

.lp .lp-fade { opacity: 0;
  animation:
    lp-rise-in var(--lp-dur-lg) var(--lp-ease) forwards,
    lp-fade-slow 1900ms var(--lp-ease-io) forwards; }
.lp .lp-row-in { opacity: 0; animation: lp-row-in 620ms var(--lp-ease) forwards; }

.lp .lp-ledger-anim { opacity: 0;
  animation:
    lp-rise-in var(--lp-dur-lg) var(--lp-ease) 180ms both,
    lp-fade-slow 2000ms var(--lp-ease-io) 180ms forwards; }

/* Promo bar — a light sweep passes across the offer, slowly enough that it reads
   as the surface catching the light rather than as something demanding a look. */
@keyframes lp-sheen { 0% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }
.lp .lp-ticker::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: linear-gradient(105deg, transparent 34%, rgba(255, 255, 255, 0.3) 48%, rgba(255, 255, 255, 0.3) 52%, transparent 66%); transform: translateX(-120%); animation: lp-sheen 9s var(--lp-ease-io) 2s infinite; }

/* "both" — the gradient itself pans back and forth */
/* ── Kinetic typography ──────────────────────────────────────────────────────
   Two reveals, same idea: the text sits in a box that clips, and travels up into
   it. The clipped edge is what makes it read as typography rather than as a fade.

   overflow: hidden would otherwise cut descenders (g, y, p) at the baseline, so
   each box carries a little bottom padding and aligns on its bottom edge — that
   moves the mask below the baseline without shifting the line. */

/* Hero: line by line, on a delay set per line in the markup. The line travels
   straight up out of its mask — no rotation, because a rotating line of type
   distorts its own letterforms on the way in, and the clipped edge is already
   doing all the work. */
@keyframes lp-line-rise {
  from { transform: translateY(105%); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}
.lp .lp-line { display: block; overflow: hidden;
  padding-bottom: 0.09em; margin-bottom: -0.09em;
  padding-inline: 0.09em; margin-inline: -0.09em; }
.lp .lp-line-i { display: block; will-change: transform, opacity;
  animation: lp-line-rise 1000ms var(--lp-ease) both; }

/* Per-section entrance: the whole section rises the last few centimetres into
   place and comes up to full opacity, and that is all. These elements are often
   1000px+ tall — anything rotational across that height keystones at the far edge,
   and any transform involving depth makes the section announce its own arrival
   rather than its contents.

   The travel is short on purpose. A long slide re-reads as the page scrolling
   twice; --lp-rise is roughly the distance at which movement is felt but not
   tracked. */
.lp .lp-srise { opacity: 0;
  transform: translate3d(0, var(--lp-rise), 0);
  transition: transform var(--lp-dur-lg) var(--lp-ease), opacity var(--lp-dur-lg) var(--lp-ease);
  will-change: transform, opacity; }
.lp .lp-srise.is-in { opacity: 1; transform: none; }

/* Section headings: word by word, released when the heading scrolls into view. */
/* The mask is only meant to clip vertically — the reveal travels up. But
   overflow:hidden clips both axes, and an italic glyph overhangs its box to the
   right, so the last letter of an accent word was being cut. Padding the sides and
   pulling it back with a negative margin gives the overhang room without moving
   the word. Same trick as the bottom padding, which keeps descenders. */
.lp .lp-split-w { display: inline-block; overflow: hidden; vertical-align: bottom;
  padding-bottom: 0.1em; margin-bottom: -0.1em;
  padding-inline: 0.09em; margin-inline: -0.09em; }
.lp .lp-split-i { display: inline-block; transform: translateY(108%); opacity: 0;
  transition: transform var(--lp-dur) var(--lp-ease), opacity var(--lp-dur) var(--lp-ease); }
.lp .lp-split.is-shown .lp-split-i { transform: translateY(0); opacity: 1; }

/* The emphasised word carries a gradient that keeps moving, so the headline has
   one point of continuous motion after the reveal has settled. Amber and violet
   are woven in so it belongs to the same accent system as the rest of the page. */
@keyframes lp-gradient-pan { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
/* One definition shared by the hero's emphasised word and any heading accent, so
   the two can never drift apart. Clipping a gradient to text needs the fill made
   transparent — hence both the standard and -webkit- properties. */
.lp .lp-h1 em, .lp .lp-grad {
  font-style: italic;
  /* background-clip:text paints the gradient only inside this element's background
     box. An italic glyph leans past that box, so the last letter of an accent word
     came out unpainted — reading as clipped. Widening the box on the right gives
     the overhang something to paint into; the negative margin keeps the word in
     the same place. */
  padding-right: 0.14em; margin-right: -0.14em;
  background-image: linear-gradient(100deg, #C4694A 0%, var(--violet) 32%, #6EA2B3 58%, var(--amber) 78%, #BD5D3A 100%);
  background-size: 280% 100%;
  -webkit-background-clip: text; background-clip: text;
  color: transparent; -webkit-text-fill-color: transparent;
  animation: lp-gradient-pan 16s var(--lp-ease-io) infinite; }

/* On the violet band the cool half of that ramp disappears into the background,
   so the accent there runs amber into white instead. */
.lp .lp-band .lp-grad { background-image: linear-gradient(100deg, #FFFFFF 0%, var(--amber) 34%, #FFF3D0 62%, var(--amber-lo) 100%); }

/* Balanced badge — one ring, once, as the entry lands. A pulse on loop turns an
   acknowledgement into a notification that never stops asking to be dealt with. */
@keyframes lp-pulse-ring { 0% { box-shadow: 0 0 0 0 rgba(224, 155, 125, 0.5); } 70%, 100% { box-shadow: 0 0 0 8px rgba(224, 155, 125, 0); } }
.lp .lp-balance-value { border-radius: 999px; animation: lp-pulse-ring 2.4s var(--lp-ease-io) 1.8s 1 both; }

@media (prefers-reduced-motion: reduce) {
  .lp .lp-fade, .lp .lp-row-in { animation: none; opacity: 1; transform: none; }
  .lp .lp-ledger-anim { animation: none; opacity: 1; transform: none; }
  .lp .lp-ticker::after, .lp .lp-h1 em, .lp .lp-grad, .lp .lp-balance-value { animation: none; }
  /* useSectionRise never adds its class in this mode, but pin the values anyway so
     nothing depends on that hook having run. */
  .lp .lp-srise { opacity: 1; transform: none; transition: none; }
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
  /* DocumentShowcase never starts its cycle here, so the first sheet must still be
     shown rather than sitting at opacity 0 behind a stopped carousel. */
  .lp .lp-docs-slot { transition: none; transform: none; }
  .lp .lp-docs-slot:first-child { opacity: 1; pointer-events: auto; }
  /* useScrollProgress bails out here so --lp-p never gets written and the sheet
     already resolves to no offset — pin it anyway, same reasoning as --lp-zoom. */
  .lp .lp-doc { transform: none; }
  /* Marquee holds still and wraps to the visible offers instead of scrolling. */
  .lp .lp-ticker-track { animation: none; width: 100%; }
  .lp .lp-ticker-run:nth-child(2) { display: none; }
  .lp .lp-ticker-window { overflow-x: auto; -webkit-mask-image: none; mask-image: none; }
  .lp .lp-h1 em { background-position: 0% 50%; }
  .lp .lp-armed .lp-group, .lp .lp-armed .lp-control,
  .lp .lp-armed .lp-step, .lp .lp-armed .lp-report { opacity: 1; transform: none; transition: none; }
  /* Controls still respond to hover, but through colour rather than movement. */
  .lp .lp-armed.is-visible .lp-control:hover,
  .lp .lp-controls .lp-control:hover { transform: none; }
  .lp .lp-control, .lp .lp-control::before, .lp .lp-control::after { transition: none; }
  .lp .lp-btn:hover { transform: none; }
}
`;
