import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

/**
 * Request access.
 *
 * This used to create the auth user and provision a tenant on submit. Until online
 * payment exists, a visitor cannot be allowed to stand up a live tenant unattended,
 * so the form now records an application in `signup_requests` and a Super Admin
 * reviews it. On approval the account is created and the applicant is emailed a
 * link to set their own password.
 *
 * There is deliberately no password field: nothing here creates credentials, so
 * asking for one would be collecting a secret we have no use for — and it would
 * imply an account that does not exist yet.
 */
export default function Signup() {
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

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { error } = await supabase.from("signup_requests").insert({
        company_name: form.companyName.trim(),
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        team_size: form.teamSize || null,
        message: form.message.trim() || null,
        country: "Sri Lanka",
      });

      if (error) {
        // The partial unique index on pending applications surfaces here. Say what
        // happened plainly rather than showing a constraint name.
        if (error.code === "23505") {
          toast.error("We already have a request from this email address. We'll be in touch shortly.");
        } else {
          throw error;
        }
      } else {
        setSubmitted(true);
      }
    } catch (error: any) {
      toast.error(error.message ?? "Could not send your request. Please try again.");
    }

    setLoading(false);
  };

  const inputClass =
    "mt-1.5 w-full text-sm border border-input rounded-xl px-4 py-3 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200";

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-md animate-fade-in text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-success/10 mb-4">
            <CheckCircle2 className="w-6 h-6 text-success" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Request received</h1>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            We've sent your details to our team for review. Once your account is
            approved you'll get an email at <strong className="text-foreground">{form.email}</strong> with
            a link to set your password and sign in.
          </p>
          <p className="text-sm text-muted-foreground mt-6">
            Approvals are usually same business day.
          </p>
          <Link to="/" className="inline-block mt-8 text-primary font-semibold hover:text-primary/80 transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary mb-4 shadow-sm">
            <BookOpen className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Request your account</h1>
          <p className="text-muted-foreground mt-2">
            Tell us about your company and we'll set it up for you.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border p-6 space-y-4 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">First name</label>
              <input type="text" value={form.firstName} onChange={set("firstName")} className={inputClass} required />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Last name</label>
              <input type="text" value={form.lastName} onChange={set("lastName")} className={inputClass} required />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Company name</label>
            <input type="text" value={form.companyName} onChange={set("companyName")} className={inputClass} placeholder="Ceylon Robotics (Pvt) Ltd" required />
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">Work email</label>
            <input type="email" value={form.email} onChange={set("email")} className={inputClass} placeholder="you@company.lk" required />
            <p className="text-xs text-muted-foreground mt-1">Your sign-in details are sent here.</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">Phone</label>
              <input type="tel" value={form.phone} onChange={set("phone")} className={inputClass} placeholder="+94 77 000 0000" />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Team size</label>
              <select value={form.teamSize} onChange={set("teamSize")} className={inputClass}>
                <option value="">Select…</option>
                <option value="1">Just me</option>
                <option value="2-5">2–5</option>
                <option value="6-20">6–20</option>
                <option value="21-50">21–50</option>
                <option value="50+">More than 50</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-foreground">
              Anything we should know? <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <textarea
              value={form.message}
              onChange={set("message")}
              className={`${inputClass} min-h-[80px]`}
              maxLength={2000}
              placeholder="Existing books to migrate, modules you need, when you want to start…"
            />
          </div>

          <Button type="submit" className="w-full h-12 rounded-xl font-semibold shadow-sm transition-all duration-200 hover:shadow-md" disabled={loading}>
            {loading ? "Sending request..." : "Request account"}
          </Button>

          <p className="text-xs text-muted-foreground text-center leading-relaxed">
            No card required. We'll review your request and email your sign-in link.
          </p>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-semibold hover:text-primary/80 transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
