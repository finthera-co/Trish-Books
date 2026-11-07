import { Link } from "react-router-dom";
import {
  ArrowRight, FileText, Users, CalendarClock, Landmark, BarChart3, Zap,
} from "lucide-react";

/* ────────────────────────────────────────────────────────────────
   Invoicing-only offer, LKR 1,500 / month. Sits on the landing page
   directly above the full-ledger packages, so a visitor who only
   needs to bill customers sees the one price that fits before the
   tier grid.

   Renders the section's contents only; the page owns the <section>
   so it can attach its entrance ref like every other section. Styles
   are scoped under .lp-io and carry their own brand tokens (navy,
   orange, cream) rather than borrowing the page's terracotta.
   ──────────────────────────────────────────────────────────────── */

export const INVOICING_OFFER = {
  name: "Trish Books",
  monthly: 1500,
  /** Read by /signup to tag the request so the reviewer knows which offer it came from. */
  signupParam: "invoicing",
};

/** Sales line, 077 815 9821, in the international form wa.me expects. */
const WHATSAPP_NUMBER = "94778159821";

const FEATURES = [
  { icon: FileText, text: "Create VAT invoices in seconds." },
  { icon: Users, text: "Save customers and item details." },
  { icon: CalendarClock, text: "Track paid, pending and overdue payments." },
  { icon: Landmark, text: "Manage VAT and SSCL invoices using the supported IRD format." },
  { icon: BarChart3, text: "Access invoicing and business reports." },
  { icon: Zap, text: "Simplify your daily invoicing workflow." },
];

export default function InvoicingOffer() {
  const price = INVOICING_OFFER.monthly.toLocaleString("en-LK");

  return (
    <div className="lp-io">
      <style>{css}</style>
      <div className="lp-shell lp-io-grid">
        <header className="lp-io-head">
          <p className="lp-io-eyebrow">Simple &amp; transparent pricing</p>
          <h2 className="lp-io-h2" id="lp-io-title">
            Powerful Invoicing. <span className="lp-io-accent">One Simple Price.</span>
          </h2>
          <p className="lp-io-lede">
            Everything your business needs to manage invoicing and payments, without
            complicated pricing.
          </p>

          {/* The three things a visitor should leave knowing: what, how much, how to try. */}
          <dl className="lp-io-facts">
            <div>
              <dt>What it does</dt>
              <dd>VAT &amp; SSCL invoicing, payments and reports</dd>
            </div>
            <div>
              <dt>What it costs</dt>
              <dd>LKR {price} a month</dd>
            </div>
            <div>
              <dt>How to try it</dt>
              <dd>Free trial, no card required</dd>
            </div>
          </dl>
        </header>

        <article className="lp-io-card" aria-labelledby="lp-io-title">
          <svg className="lp-io-deco" viewBox="0 0 200 200" aria-hidden="true">
            <circle cx="100" cy="100" r="96" />
            <circle cx="100" cy="100" r="68" />
            <circle cx="100" cy="100" r="40" />
            <circle className="lp-io-deco-dot" cx="100" cy="4" r="6" />
          </svg>

          <p className="lp-io-brand">{INVOICING_OFFER.name}</p>

          <div className="lp-io-price" aria-label={`LKR ${price} per month`}>
            <span className="lp-io-cur" aria-hidden="true">LKR</span>
            <span className="lp-io-amt" aria-hidden="true">{price}</span>
          </div>
          <p className="lp-io-per" aria-hidden="true">Per month</p>

          <p className="lp-io-desc">Affordable invoicing software designed for growing businesses.</p>

          <ul className="lp-io-feats">
            {FEATURES.map(({ icon: Icon, text }, i) => (
              <li key={text} className="lp-io-feat" style={{ "--i": i } as React.CSSProperties}>
                <span className="lp-io-ico" aria-hidden="true">
                  <Icon className="w-4 h-4" strokeWidth={2.2} />
                </span>
                {text}
              </li>
            ))}
          </ul>

          <Link to={`/signup?offer=${INVOICING_OFFER.signupParam}`} className="lp-io-cta">
            Start your free trial
            <ArrowRight className="w-5 h-5" strokeWidth={2.4} aria-hidden="true" />
          </Link>

          <div className="lp-io-contact">
            <p>Want to see how it works? Get in touch with our team.</p>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="lp-io-wa"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48 0 1.46 1.07 2.88 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.69.63.71.23 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.05 21.5h-.01a9.4 9.4 0 0 1-4.8-1.31l-.34-.2-3.57.94.95-3.48-.22-.36a9.4 9.4 0 0 1-1.44-5.02c0-5.2 4.24-9.43 9.44-9.43 2.52 0 4.89.98 6.67 2.77a9.37 9.37 0 0 1 2.76 6.67c0 5.2-4.24 9.43-9.44 9.43zm8.03-17.46A11.27 11.27 0 0 0 12.05.72C5.8.72.7 5.8.7 12.06c0 2 .52 3.95 1.52 5.67L.6 23.28l5.69-1.49a11.3 11.3 0 0 0 5.75 1.47h.01c6.25 0 11.34-5.09 11.35-11.34 0-3.03-1.18-5.88-3.32-8.02z" />
              </svg>
              WhatsApp Us – 077 815 9821
            </a>
            <a href="https://www.trishbooks.com" className="lp-io-site">www.trishbooks.com</a>
          </div>
        </article>
      </div>
    </div>
  );
}

const css = `
.lp .lp-io {
  --io-navy: #101C2B;
  --io-navy-hi: #1A2A3F;
  --io-orange: #FF6500;
  --io-orange-hi: #FF8433;
  --io-cream: #F6EEE4;
  background: var(--io-cream);
  padding-block: clamp(3.5rem, 7vw, 5.5rem);
}
.lp .lp-io-grid { display: grid; gap: clamp(2.25rem, 5vw, 4rem); align-items: center; }
@media (min-width: 960px) { .lp .lp-io-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 30rem); } }

.lp .lp-io-eyebrow { margin: 0 0 1.1rem; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--io-orange); }
.lp .lp-io-eyebrow::before { content: ""; display: inline-block; vertical-align: middle; width: 1.6rem; height: 3px;
  margin-right: 0.6rem; border-radius: 2px; background: var(--io-orange); }
.lp .lp-io-h2 { margin: 0; font-family: var(--font-serif); font-weight: 500; font-size: clamp(2.1rem, 5vw, 3.4rem);
  line-height: 1.06; letter-spacing: -0.025em; color: var(--io-navy); }
.lp .lp-io-accent { color: var(--io-orange); }
.lp .lp-io-lede { margin: 1.25rem 0 0; max-width: 34rem; font-size: 1.075rem; line-height: 1.65; color: rgba(16, 28, 43, 0.74); }

.lp .lp-io-facts { display: grid; gap: 0; margin: 2.25rem 0 0; max-width: 34rem;
  border-top: 1px solid rgba(16, 28, 43, 0.12); }
.lp .lp-io-facts > div { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0.25rem 1.5rem;
  padding: 0.95rem 0; border-bottom: 1px solid rgba(16, 28, 43, 0.12); }
.lp .lp-io-facts dt { font-family: var(--font-mono); font-size: 0.66rem; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: rgba(16, 28, 43, 0.55); align-self: center; }
.lp .lp-io-facts dd { margin: 0; font-weight: 600; color: var(--io-navy); }

/* The card */
.lp .lp-io-card { position: relative; isolation: isolate; overflow: hidden; color: #FFFFFF;
  padding: clamp(1.75rem, 4.5vw, 2.6rem); border-radius: 1.75rem;
  background: radial-gradient(28rem 20rem at 100% 0%, var(--io-navy-hi), transparent 70%), var(--io-navy);
  box-shadow: 0 40px 80px -36px rgba(16, 28, 43, 0.7), 0 2px 0 rgba(255, 255, 255, 0.04) inset;
  transition: transform var(--lp-dur-ui) var(--lp-ease), box-shadow var(--lp-dur-ui) ease; }
.lp .lp-io-card::before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; z-index: 1;
  background: linear-gradient(90deg, var(--io-orange), var(--io-orange-hi) 60%, transparent); }
@media (hover: hover) {
  .lp .lp-io-card:hover { transform: translate3d(0, -6px, 0);
    box-shadow: 0 52px 96px -40px rgba(16, 28, 43, 0.78), 0 2px 0 rgba(255, 255, 255, 0.04) inset; }
}

/* Concentric orange rings in the corner — the brand's circle, kept quiet. */
.lp .lp-io-deco { position: absolute; z-index: -1; top: -5.5rem; right: -5.5rem; width: 15rem; height: 15rem;
  fill: none; stroke: var(--io-orange); stroke-width: 1.2; opacity: 0.4;
  animation: lp-io-spin 60s linear infinite; }
.lp .lp-io-deco-dot { fill: var(--io-orange); stroke: none; }
@keyframes lp-io-spin { to { transform: rotate(360deg); } }

.lp .lp-io-brand { margin: 0; font-family: var(--font-mono); font-size: 0.74rem; font-weight: 700;
  letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255, 255, 255, 0.72); }

.lp .lp-io-price { display: flex; align-items: flex-start; gap: 0.5rem; margin-top: 1.4rem; line-height: 1; }
.lp .lp-io-cur { margin-top: 0.55em; font-family: var(--font-mono); font-size: clamp(1rem, 2.4vw, 1.25rem);
  font-weight: 700; letter-spacing: 0.06em; color: var(--io-orange); }
.lp .lp-io-amt { font-family: var(--font-serif); font-weight: 600; font-size: clamp(4rem, 15vw, 6rem);
  letter-spacing: -0.045em; font-variant-numeric: tabular-nums; color: #FFFFFF; }
.lp .lp-io-per { margin: 0.6rem 0 0; font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--io-orange); }
.lp .lp-io-desc { margin: 1.1rem 0 0; font-size: 1rem; line-height: 1.55; color: rgba(255, 255, 255, 0.78); }

.lp .lp-io-feats { list-style: none; margin: 1.6rem 0 0; padding: 1.5rem 0 0; display: grid; gap: 0.85rem;
  border-top: 1px solid rgba(255, 255, 255, 0.12); }
.lp .lp-io-feat { display: flex; align-items: flex-start; gap: 0.75rem; font-size: 0.95rem; line-height: 1.45;
  color: rgba(255, 255, 255, 0.92); }
.lp .lp-io-ico { flex: none; display: grid; place-items: center; width: 1.85rem; height: 1.85rem; margin-top: -0.2rem;
  border-radius: 0.6rem; color: var(--io-orange); background: rgba(255, 101, 0, 0.14);
  box-shadow: inset 0 0 0 1px rgba(255, 101, 0, 0.28); }
/* Features follow the section in one after another; only when the rise runs, so
   reduced motion (which never adds lp-srise) shows them at once. */
.lp .lp-srise .lp-io-feat { opacity: 0; transform: translate3d(0, 0.6rem, 0);
  transition: opacity 600ms var(--lp-ease), transform 600ms var(--lp-ease);
  transition-delay: calc(350ms + var(--i, 0) * 70ms); }
.lp .lp-srise.is-in .lp-io-feat { opacity: 1; transform: none; }

.lp .lp-io-cta { display: flex; align-items: center; justify-content: center; gap: 0.6rem; width: 100%;
  margin-top: 2rem; padding: 1.05rem 1.5rem; border-radius: 999px; text-decoration: none;
  font-weight: 700; font-size: 1.02rem; letter-spacing: 0.06em; text-transform: uppercase; color: #FFFFFF;
  background-image: linear-gradient(135deg, var(--io-orange-hi) 0%, var(--io-orange) 100%);
  box-shadow: 0 16px 32px -14px rgba(255, 101, 0, 0.85);
  transition: transform 260ms var(--lp-ease), box-shadow 260ms ease, filter 260ms ease; }
@media (max-width: 420px) { .lp .lp-io-cta { padding-inline: 1rem; font-size: 0.9rem; letter-spacing: 0.04em; white-space: nowrap; } }
.lp .lp-io-cta svg { flex: none; transition: transform 260ms var(--lp-ease); }
.lp .lp-io-cta:hover { filter: brightness(1.06); transform: translate3d(0, -2px, 0);
  box-shadow: 0 22px 40px -16px rgba(255, 101, 0, 0.95); }
.lp .lp-io-cta:hover svg { transform: translate3d(3px, 0, 0); }
.lp .lp-io-cta:focus-visible, .lp .lp-io-wa:focus-visible, .lp .lp-io-site:focus-visible {
  outline: 2px solid #FFFFFF; outline-offset: 3px; }

.lp .lp-io-contact { margin-top: 1.5rem; display: grid; justify-items: center; gap: 0.8rem; text-align: center; }
.lp .lp-io-contact p { margin: 0; font-size: 0.9rem; color: rgba(255, 255, 255, 0.7); }
.lp .lp-io-wa { display: inline-flex; align-items: center; gap: 0.55rem; padding: 0.65rem 1.15rem; border-radius: 999px;
  font-weight: 600; font-size: 0.92rem; color: #FFFFFF; text-decoration: none;
  box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.28);
  transition: background-color 260ms ease, box-shadow 260ms ease, color 260ms ease; }
.lp .lp-io-wa svg { color: #25D366; }
.lp .lp-io-wa:hover { background-color: rgba(37, 211, 102, 0.12); box-shadow: inset 0 0 0 1.5px #25D366; }
.lp .lp-io-site { font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.12em; color: rgba(255, 255, 255, 0.5);
  text-decoration: none; transition: color 200ms ease; }
.lp .lp-io-site:hover { color: var(--io-orange); }

@media (prefers-reduced-motion: reduce) {
  .lp .lp-io-deco { animation: none; }
  .lp .lp-io-card, .lp .lp-io-cta, .lp .lp-io-cta svg { transition: none; }
}
`;
