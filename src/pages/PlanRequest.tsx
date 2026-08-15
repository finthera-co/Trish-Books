import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fieldErrors, MESSAGE_MAX, remainingMessageRoom, signupRequestSchema } from "@/lib/validation";
import {
  BASE_PLANS,
  CORE_LEDGER,
  PACK_GROUPS,
  PAYROLL_CORE,
  PAYROLL_ADDONS,
} from "@/pages/Landing";

/**
 * Configure a plan, then apply for it.
 *
 * Reached from a package card on the landing page ("Start on Lite"). The plan
 * arrives as ?plan=Lite; anything unrecognised falls back to the first paid tier
 * rather than erroring, since a mistyped URL should still be able to buy.
 *
 * Like /signup this creates no account and takes no payment — it records an
 * application in `signup_requests` for a Super Admin to review. The chosen plan
 * and add-ons are written into `message`, because the table has no column for
 * them and inventing one here would mean a migration this page doesn't need.
 */

const lkr = (n: number) => n.toLocaleString("en-LK");

type Pack = { label: string; price: number; group: string };

export default function PlanRequest() {
  const [params] = useSearchParams();
  const planName = params.get("plan");

  const plan = useMemo(() => {
    const paid = BASE_PLANS.filter((p) => p.monthly > 0);
    return (
      BASE_PLANS.find((p) => p.name.toLowerCase() === (planName ?? "").toLowerCase()) ?? paid[0]
    );
  }, [planName]);

  // Flattened once so lookups by label stay cheap while the user clicks around.
  const allPacks: Pack[] = useMemo(
    () =>
      PACK_GROUPS.flatMap((g) =>
        g.packs.map(([label, price]) => ({
          label: label as string,
          price: price as number,
          group: g.title,
        })),
      ),
    [],
  );

  const [picked, setPicked] = useState<string[]>([]);
  const [payrollTier, setPayrollTier] = useState<string>("");
  const [payrollAddons, setPayrollAddons] = useState<string[]>([]);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    companyName: "",
    email: "",
    phone: "",
    teamSize: "",
    message: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm((f) => ({ ...f, [k]: e.target.value }));
      setErrors((prev) => (k in prev ? { ...prev, [k]: "" } : prev));
    };

  const toggle = (list: string[], setList: (v: string[]) => void, label: string) =>
    setList(list.includes(label) ? list.filter((x) => x !== label) : [...list, label]);

  /* Volume rule from the price book: the more packs, the deeper the discount. */
  const packDiscount = (n: number) => (n >= 10 ? 0.35 : n >= 6 ? 0.25 : n >= 3 ? 0.15 : 0);

  const totals = useMemo(() => {
    const packList = allPacks.filter((p) => picked.includes(p.label));
    const packsGross = packList.reduce((s, p) => s + p.price, 0);
    const rate = packDiscount(packList.length);
    const packsNet = Math.round(packsGross * (1 - rate));

    const payrollRow = PAYROLL_CORE.find(([label]) => label === payrollTier);
    // The 100+ band is per-employee, so it can't be totalled without a headcount.
    const payrollPrice =
      payrollRow && /^[\d,]+$/.test(payrollRow[1].replace(/\s/g, ""))
        ? Number(payrollRow[1].replace(/[^\d]/g, ""))
        : 0;

    const addonRows = PAYROLL_ADDONS.filter(([label]) => payrollAddons.includes(label));
    const addonsPrice = addonRows.reduce((s, [, price]) => {
      const n = Number(String(price).replace(/[^\d]/g, ""));
      return /employee/i.test(String(price)) ? s : s + n;
    }, 0);

    return {
      packsGross,
      packsNet,
      rate,
      payrollPrice,
      addonsPrice,
      monthly: plan.monthly + packsNet + payrollPrice + addonsPrice,
      hasPerEmployee:
        (payrollRow && /employee/i.test(payrollRow[1])) ||
        addonRows.some(([, p]) => /employee/i.test(String(p))),
    };
  }, [allPacks, picked, payrollTier, payrollAddons, plan.monthly]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = fieldErrors(signupRequestSchema, form);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }

    // The reviewer needs the configuration, and the table has nowhere else to put
    // it — so it goes at the top of the message, above whatever the applicant wrote.
    const spec = [
      `Plan: ${plan.name} — LKR ${lkr(plan.monthly)}/mo`,
      picked.length
        ? `Module packs (${picked.length}${totals.rate ? `, ${Math.round(totals.rate * 100)}% volume discount` : ""}): ${picked.join(", ")}`
        : "Module packs: none",
      payrollTier ? `Payroll core: ${payrollTier}` : null,
      payrollAddons.length ? `Payroll add-ons: ${payrollAddons.join(", ")}` : null,
      `Estimated monthly: LKR ${lkr(totals.monthly)}${totals.hasPerEmployee ? " + per-employee items" : ""}`,
    ]
      .filter(Boolean)
      .join("\n");

    // The column caps `message` at 2000 characters and this page spends part of
    // that budget on the spec above. Checking the applicant's note against the
    // plain 2000 would let a long one through here and fail at the database, so
    // it is checked against what is actually left.
    const values = parsed.data;
    const room = remainingMessageRoom(spec);
    if (values.message.length > room) {
      setErrors({
        message: `Your plan configuration takes up part of this field — please keep your note under ${room} characters.`,
      });
      return;
    }
    setErrors({});
    setLoading(true);

    try {
      const { error } = await supabase.from("signup_requests").insert({
        company_name: values.companyName,
        first_name: values.firstName,
        last_name: values.lastName,
        email: values.email,
        phone: values.phone || null,
        team_size: values.teamSize || null,
        message: values.message ? `${spec}\n\n—\n${values.message}` : spec,
        country: "Sri Lanka",
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("We already have a request from this email address. We'll be in touch shortly.");
        } else {
          throw error;
        }
      } else {
        setSubmitted(true);
      }
    } catch (err: any) {
      toast.error(err.message ?? "Could not send your request. Please try again.");
    }

    setLoading(false);
  };

  const Err = ({ field }: { field: string }) =>
    errors[field] ? <small className="pr-err">{errors[field]}</small> : null;

  if (submitted) {
    return (
      <div className="pr min-h-screen grid place-items-center px-4 py-10">
        <style>{css}</style>
        <div className="pr-done">
          <span className="pr-done-icon">
            <CheckCircle2 className="w-6 h-6" />
          </span>
          <h1 className="pr-done-h">Request received</h1>
          <p className="pr-done-p">
            Thanks {form.firstName || "—"}. We have your {plan.name} configuration and will email{" "}
            <strong>{form.email}</strong> once it's reviewed, with a link to set your password.
          </p>
          <Link to="/" className="pr-btn">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pr min-h-screen">
      <style>{css}</style>

      <header className="pr-top">
        <div className="pr-shell pr-top-row">
          <Link to="/#pricing" className="pr-back">
            <ArrowLeft className="w-4 h-4" />
            All packages
          </Link>
          <span className="pr-top-plan">{plan.name}</span>
        </div>
      </header>

      <main className="pr-shell pr-grid">
        {/* ── Configure ── */}
        <div>
          <p className="pr-eyebrow">Step 1 — configure</p>
          <h1 className="pr-h1">Build your {plan.name} plan</h1>
          <p className="pr-lede">
            {plan.desc} Every plan ships the full double-entry ledger; add only the modules you
            actually need.
          </p>

          <section className="pr-card">
            <h2 className="pr-card-h">Included in {plan.name}</h2>
            <ul className="pr-core">
              {CORE_LEDGER.map((f) => (
                <li key={f}>
                  <Check className="w-4 h-4" />
                  {f}
                </li>
              ))}
              <li>
                <Check className="w-4 h-4" />
                {plan.users} users · {plan.companies} {Number(plan.companies) === 1 ? "company" : "companies"}
              </li>
            </ul>
          </section>

          <p className="pr-eyebrow pr-eyebrow-2">Step 2 — add-ons</p>
          <p className="pr-note">
            Take 3 or more packs for 15% off, 6 or more for 25%, 10 or more for 35%.
          </p>

          {PACK_GROUPS.map((g) => (
            <section key={g.title} className="pr-card">
              <h2 className="pr-card-h">{g.title}</h2>
              <ul className="pr-picks">
                {g.packs.map(([label, price]) => {
                  const on = picked.includes(label as string);
                  return (
                    <li key={label as string}>
                      <label className={`pr-pick${on ? " is-on" : ""}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(picked, setPicked, label as string)}
                        />
                        <span className="pr-pick-box" aria-hidden="true">
                          {on && <Check className="w-3 h-3" strokeWidth={3} />}
                        </span>
                        <span className="pr-pick-label">{label}</span>
                        <span className="pr-pick-price">LKR {lkr(price as number)}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section className="pr-card">
            <h2 className="pr-card-h">Payroll</h2>
            <label className="pr-field">
              <span>Payroll core — by headcount</span>
              <select
                value={payrollTier}
                onChange={(e) => setPayrollTier(e.target.value)}
                className="pr-input"
              >
                <option value="">Not needed</option>
                {PAYROLL_CORE.map(([label, price]) => (
                  <option key={label} value={label}>
                    {label} — LKR {price}
                  </option>
                ))}
              </select>
            </label>

            <ul className="pr-picks pr-picks-2">
              {PAYROLL_ADDONS.map(([label, price]) => {
                const on = payrollAddons.includes(label);
                return (
                  <li key={label}>
                    <label className={`pr-pick${on ? " is-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(payrollAddons, setPayrollAddons, label)}
                      />
                      <span className="pr-pick-box" aria-hidden="true">
                        {on && <Check className="w-3 h-3" strokeWidth={3} />}
                      </span>
                      <span className="pr-pick-label">{label}</span>
                      <span className="pr-pick-price">LKR {price}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* ── Summary + form ── */}
        <aside className="pr-side">
          <div className="pr-sum">
            <h2 className="pr-sum-h">Your configuration</h2>
            <dl className="pr-sum-list">
              <div>
                <dt>{plan.name} base</dt>
                <dd>LKR {lkr(plan.monthly)}</dd>
              </div>
              {picked.length > 0 && (
                <div>
                  <dt>
                    {picked.length} module pack{picked.length > 1 ? "s" : ""}
                    {totals.rate > 0 && (
                      <span className="pr-sum-off">−{Math.round(totals.rate * 100)}%</span>
                    )}
                  </dt>
                  <dd>LKR {lkr(totals.packsNet)}</dd>
                </div>
              )}
              {totals.payrollPrice > 0 && (
                <div>
                  <dt>Payroll core</dt>
                  <dd>LKR {lkr(totals.payrollPrice)}</dd>
                </div>
              )}
              {totals.addonsPrice > 0 && (
                <div>
                  <dt>Payroll add-ons</dt>
                  <dd>LKR {lkr(totals.addonsPrice)}</dd>
                </div>
              )}
            </dl>
            <div className="pr-sum-total">
              <span>Estimated monthly</span>
              <strong>LKR {lkr(totals.monthly)}</strong>
            </div>
            {totals.hasPerEmployee && (
              <p className="pr-sum-fine">Plus per-employee items, priced once we know headcount.</p>
            )}
          </div>

          <form className="pr-form" onSubmit={handleSubmit}>
            <p className="pr-eyebrow">Step 3 — your details</p>
            <h2 className="pr-form-h">Request your account</h2>

            <div className="pr-row">
              <label className="pr-field">
                <span>First name</span>
                <input required maxLength={100} value={form.firstName} onChange={set("firstName")} className="pr-input" />
                <Err field="firstName" />
              </label>
              <label className="pr-field">
                <span>Last name</span>
                <input required maxLength={100} value={form.lastName} onChange={set("lastName")} className="pr-input" />
                <Err field="lastName" />
              </label>
            </div>

            <label className="pr-field">
              <span>Company name</span>
              <input
                required
                maxLength={200}
                value={form.companyName}
                onChange={set("companyName")}
                placeholder="Ceylon Robotics (Pvt) Ltd"
                className="pr-input"
              />
              <Err field="companyName" />
            </label>

            <label className="pr-field">
              <span>Work email</span>
              <input
                required
                type="email"
                maxLength={320}
                value={form.email}
                onChange={set("email")}
                placeholder="you@company.lk"
                className="pr-input"
              />
              <Err field="email" />
              <small>Your sign-in details are sent here.</small>
            </label>

            <div className="pr-row">
              <label className="pr-field">
                <span>Phone</span>
                <input
                  maxLength={32}
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="+94 77 000 0000"
                  className="pr-input"
                />
                <Err field="phone" />
              </label>
              <label className="pr-field">
                <span>Team size</span>
                <select value={form.teamSize} onChange={set("teamSize")} className="pr-input">
                  <option value="">Select…</option>
                  <option value="1">Just me</option>
                  <option value="2-5">2–5</option>
                  <option value="6-20">6–20</option>
                  <option value="21-50">21–50</option>
                  <option value="51+">51+</option>
                </select>
              </label>
            </div>

            <label className="pr-field">
              <span>Anything we should know? (optional)</span>
              <textarea
                rows={3}
                maxLength={MESSAGE_MAX}
                value={form.message}
                onChange={set("message")}
                placeholder="Existing books to migrate, modules you need, when you want to start…"
                className="pr-input"
              />
              <Err field="message" />
            </label>

            <button type="submit" disabled={loading} className="pr-btn pr-btn-full">
              {loading ? "Sending…" : "Request account"}
            </button>
            <p className="pr-form-fine">
              No payment now. We review the request and email you a link to set your password.
            </p>
          </form>
        </aside>
      </main>
    </div>
  );
}

const css = `
.pr {
  --ink: #141413; --body: #3D3D3A; --muted: #6F6E69;
  --clay: #D97757; --clay-dk: #BD5D3A; --rule: rgba(20, 20, 19, 0.12);
  background-image: linear-gradient(180deg, #FFFFFF 0%, #FAF9F5 30%, #F0EEE6 100%);
  color: var(--ink); font-family: var(--font-sans);
}
.pr .pr-shell { width: 100%; max-width: 72rem; margin-inline: auto; padding-inline: 1.5rem; }
.pr .pr-top { position: sticky; top: 0; z-index: 10; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(10px); border-bottom: 1px solid var(--rule); }
.pr .pr-top-row { display: flex; align-items: center; justify-content: space-between; padding-block: 0.9rem; }
.pr .pr-back { display: inline-flex; align-items: center; gap: 0.4rem; font-size: 0.875rem; font-weight: 600; color: var(--body); text-decoration: none; }
.pr .pr-back:hover { color: var(--clay-dk); }
.pr .pr-top-plan { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #FFFFFF; background: var(--ink); border-radius: 999px; padding: 0.3rem 0.7rem; }

.pr .pr-grid { display: grid; grid-template-columns: 1fr; gap: 2.5rem; padding-block: 2.5rem 4rem; align-items: start; }
@media (min-width: 64rem) { .pr .pr-grid { grid-template-columns: 1fr 23rem; gap: 3rem; } }
.pr .pr-side { display: grid; gap: 1.25rem; }
@media (min-width: 64rem) { .pr .pr-side { position: sticky; top: 5rem; } }

.pr .pr-eyebrow { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: var(--clay-dk); }
.pr .pr-eyebrow-2 { margin-top: 2.5rem; }
.pr .pr-h1 { margin-top: 0.5rem; font-size: clamp(1.7rem, 3.4vw, 2.3rem); font-weight: 800; letter-spacing: -0.03em; }
.pr .pr-lede { margin-top: 0.6rem; max-width: 44rem; font-size: 0.95rem; line-height: 1.6; color: var(--body); }
.pr .pr-note { margin-top: 0.5rem; font-size: 0.85rem; color: var(--muted); }

.pr .pr-card { margin-top: 1.25rem; padding: 1.35rem 1.4rem; border: 1px solid var(--rule); border-radius: 1rem; background: rgba(255, 255, 255, 0.75); }
.pr .pr-card-h { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.85rem; }
.pr .pr-core { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
.pr .pr-core li { display: flex; gap: 0.5rem; align-items: flex-start; font-size: 0.875rem; color: var(--body); }
.pr .pr-core svg { flex: none; margin-top: 0.15rem; color: var(--clay); }

.pr .pr-picks { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5rem; }
.pr .pr-picks-2 { margin-top: 1rem; }
.pr .pr-pick { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 0.7rem; padding: 0.7rem 0.85rem; border: 1px solid var(--rule); border-radius: 0.7rem; cursor: pointer; background: #FFFFFF; transition: border-color 160ms ease, background 160ms ease; }
.pr .pr-pick:hover { border-color: rgba(189, 93, 58, 0.5); }
.pr .pr-pick.is-on { border-color: var(--clay); background: rgba(217, 119, 87, 0.07); }
.pr .pr-pick input { position: absolute; opacity: 0; width: 0; height: 0; }
.pr .pr-pick-box { display: grid; place-items: center; width: 1.15rem; height: 1.15rem; border: 1.5px solid var(--rule); border-radius: 0.35rem; color: #FFFFFF; }
.pr .pr-pick.is-on .pr-pick-box { background: var(--clay-dk); border-color: var(--clay-dk); }
.pr .pr-pick input:focus-visible + .pr-pick-box { outline: 2px solid var(--ink); outline-offset: 2px; }
.pr .pr-pick-label { font-size: 0.85rem; line-height: 1.35; color: var(--body); }
.pr .pr-pick-price { font-size: 0.8rem; font-weight: 700; white-space: nowrap; }

.pr .pr-sum { padding: 1.35rem 1.4rem; border: 1px solid var(--rule); border-radius: 1rem; background: #FFFFFF; box-shadow: 0 18px 38px -30px rgba(20, 20, 19, 0.5); }
.pr .pr-sum-h { font-size: 0.95rem; font-weight: 700; }
.pr .pr-sum-list { margin: 0.9rem 0 0; display: grid; gap: 0.55rem; }
.pr .pr-sum-list > div { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; font-size: 0.85rem; color: var(--body); }
.pr .pr-sum-list dd { margin: 0; font-weight: 600; white-space: nowrap; }
.pr .pr-sum-off { margin-left: 0.4rem; font-size: 0.68rem; font-weight: 700; color: var(--clay-dk); background: rgba(217, 119, 87, 0.14); border-radius: 999px; padding: 0.1rem 0.4rem; }
.pr .pr-sum-total { margin-top: 1rem; padding-top: 0.9rem; border-top: 1.5px solid var(--rule); display: flex; align-items: baseline; justify-content: space-between; }
.pr .pr-sum-total span { font-size: 0.8rem; font-weight: 600; color: var(--muted); }
.pr .pr-sum-total strong { font-size: 1.35rem; font-weight: 800; letter-spacing: -0.02em; }
.pr .pr-sum-fine { margin-top: 0.5rem; font-size: 0.72rem; color: var(--muted); }

.pr .pr-form { padding: 1.5rem 1.4rem; border: 1px solid var(--rule); border-radius: 1rem; background: #FFFFFF; }
.pr .pr-form-h { margin-top: 0.4rem; margin-bottom: 1.1rem; font-size: 1.15rem; font-weight: 800; letter-spacing: -0.02em; }
.pr .pr-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.pr .pr-field { display: block; margin-bottom: 0.85rem; }
.pr .pr-field > span { display: block; font-size: 0.78rem; font-weight: 600; margin-bottom: 0.3rem; }
.pr .pr-field small { display: block; margin-top: 0.3rem; font-size: 0.7rem; color: var(--muted); }
.pr .pr-field small.pr-err { color: var(--clay-dk); font-weight: 600; }
.pr .pr-input { width: 100%; font-size: 0.875rem; padding: 0.65rem 0.8rem; border: 1px solid var(--rule); border-radius: 0.6rem; background: #FFFFFF; color: var(--ink); font-family: inherit; }
.pr .pr-input:focus { outline: none; border-color: var(--clay); box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.18); }

.pr .pr-btn { display: inline-flex; align-items: center; justify-content: center; padding: 0.8rem 1.6rem; border-radius: 0.6rem; font-size: 0.95rem; font-weight: 700; color: #F5F2EA; background: var(--ink); border: none; cursor: pointer; text-decoration: none; transition: filter 160ms ease; }
.pr .pr-btn:hover { filter: brightness(1.25); }
.pr .pr-btn:disabled { opacity: 0.6; cursor: default; }
.pr .pr-btn-full { width: 100%; margin-top: 0.35rem; }
.pr .pr-form-fine { margin-top: 0.7rem; font-size: 0.72rem; line-height: 1.5; color: var(--muted); }

.pr .pr-done { max-width: 30rem; text-align: center; padding: 2.5rem 2rem; border: 1px solid var(--rule); border-radius: 1.25rem; background: #FFFFFF; }
.pr .pr-done-icon { display: inline-grid; place-items: center; width: 3rem; height: 3rem; border-radius: 999px; background: rgba(217, 119, 87, 0.14); color: var(--clay-dk); margin-bottom: 1rem; }
.pr .pr-done-h { font-size: 1.5rem; font-weight: 800; letter-spacing: -0.02em; }
.pr .pr-done-p { margin: 0.6rem 0 1.5rem; font-size: 0.9rem; line-height: 1.6; color: var(--body); }

@media (max-width: 30rem) { .pr .pr-row { grid-template-columns: 1fr; } }
`;
