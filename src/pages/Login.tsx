import { useEffect, useState } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Landmark, Lock, Mail, ShieldCheck, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import BrandMark from "@/components/BrandMark";
import { supabase } from "@/integrations/supabase/client";
import { takeSignOutReason } from "@/lib/browserSession";
import { IDLE_TIMEOUT_MS } from "@/hooks/useIdleLogout";

/* Brand greens, taken from the BrandMark so the page and logo read as one. */
const FOREST = "#0F6E56";
const MINT = "#5DCAA5";
const MINT_PALE = "#F0FBF6";
const MINT_SOFT = "#D6F3E6";
const MINT_LIGHT = "#B4E8D1";

/* Illustrative cash-in bars for the preview card (relative heights, %). */
const PREVIEW_BARS = [38, 52, 44, 63, 58, 72, 66, 84, 78, 92];

const HIGHLIGHTS = [
  { icon: Landmark, text: "Bank statements imported and categorised for you" },
  { icon: TrendingUp, text: "IFRS-ready P&L, Balance Sheet and Cash Flow" },
  { icon: ShieldCheck, text: "Two-factor sign-in and tenant-isolated data" },
];

const inputClass =
  "w-full text-sm border border-input rounded-xl pl-11 pr-4 py-3 bg-card text-foreground placeholder:text-muted-foreground/80 shadow-[0_1px_2px_rgba(6,46,36,0.04)] focus:outline-none focus:ring-4 focus:ring-[#5DCAA5]/25 focus:border-[#0F6E56] transition-all duration-200";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { signIn, user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Explain the redirect when the session was ended for us rather than by the
  // user clicking sign out.
  useEffect(() => {
    if (takeSignOutReason() === "idle") {
      toast.info(`You were signed out after ${Math.round(IDLE_TIMEOUT_MS / 60000)} minutes of inactivity.`);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Pass through as typed — signIn() enforces the stored (lowercase) form.
    const { error } = await signIn(email, password);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Welcome back!");
      navigate("/home");
    }
    setLoading(false);
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      toast.error("Enter your email above first, then click “Forgot password?”");
      return;
    }
    setResetting(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setResetting(false);
    // Always show the same message so we don't reveal which emails have accounts.
    if (error && !/rate|limit/i.test(error.message)) {
      toast.error(error.message);
    } else {
      toast.success("If that email has an account, a password reset link is on its way.");
    }
  };

  // Arriving from the landing page with a live session — skip the form.
  if (!authLoading && user) return <Navigate to="/home" replace />;

  return (
    <div className="min-h-screen flex bg-background">
      {/* ───────────── Form panel ───────────── */}
      <div className="relative w-full lg:w-[52%] flex flex-col overflow-hidden">
        {/* Soft mint wash behind the form */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background: `radial-gradient(700px 420px at 0% 0%, ${MINT}2E, transparent 65%),
                         radial-gradient(600px 400px at 100% 100%, ${FOREST}14, transparent 70%)`,
          }}
        />

        {/* Logo */}
        <div className="relative px-6 sm:px-10 pt-8">
          <Link to="/" className="inline-flex items-center gap-2.5 group">
            <BrandMark className="w-9 h-9 shrink-0 rounded-xl shadow-md shadow-[#0F6E56]/20 transition-transform group-hover:scale-105" />
            <span className="text-lg font-bold text-foreground tracking-tight">Trish Books</span>
          </Link>
        </div>

        {/* Form centered */}
        <div className="relative flex-1 flex items-center justify-center px-6 sm:px-10 py-10">
          <div className="w-full max-w-[400px] animate-fade-in">
            <div className="mb-8">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#5DCAA5]/40 bg-[#5DCAA5]/10 px-3 py-1 text-xs font-medium text-[#0F6E56] dark:text-[#5DCAA5]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#5DCAA5] motion-safe:animate-pulse-soft" />
                Secure sign-in
              </span>
              <h1 className="mt-4 text-[32px] leading-tight font-bold text-foreground tracking-tight">
                Welcome back
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                Sign in to pick up where your books left off.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="login-email" className="text-sm font-medium text-foreground">Email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className={inputClass}
                    placeholder="you@company.com"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="login-password" className="text-sm font-medium text-foreground">Password</label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetting}
                    className="text-sm font-semibold text-[#0F6E56] dark:text-[#5DCAA5] hover:opacity-80 transition-opacity disabled:opacity-60"
                  >
                    {resetting ? "Sending…" : "Forgot password?"}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className={`${inputClass} pr-11`}
                    placeholder="Your password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="group w-full h-12 text-sm font-semibold rounded-xl mt-2 text-white border-0 shadow-lg shadow-[#1FA67E]/30 transition-all duration-200 hover:shadow-xl hover:shadow-[#1FA67E]/35 hover:-translate-y-px active:translate-y-0 bg-[linear-gradient(135deg,#2BB88A_0%,#1FA67E_50%,#14916F_100%)] hover:bg-[linear-gradient(135deg,#34C595_0%,#24B087_50%,#179B76_100%)]"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Sign in
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-8 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              New to Trish Books?
              <span className="h-px flex-1 bg-border" />
            </div>
            <Link
              to="/signup"
              className="mt-4 flex h-11 w-full items-center justify-center rounded-xl border border-[#5DCAA5]/50 bg-[#5DCAA5]/[0.08] text-sm font-semibold text-[#0F6E56] dark:text-[#5DCAA5] hover:bg-[#5DCAA5]/15 transition-colors"
            >
              Create an account
            </Link>
          </div>
        </div>

        {/* Footer */}
        <div className="relative px-6 sm:px-10 pb-8 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="w-3 h-3" />
          <span>Encrypted connection · © {new Date().getFullYear()} Trish Books</span>
        </div>
      </div>

      {/* ───────────── Brand panel (desktop) ───────────── */}
      <aside
        aria-hidden="true"
        className="hidden lg:flex relative w-[48%] m-3 ml-0 rounded-[28px] overflow-hidden text-[#073B2E] border border-[#5DCAA5]/30"
        style={{ background: `linear-gradient(155deg, ${MINT_PALE} 0%, ${MINT_SOFT} 45%, ${MINT_LIGHT} 100%)` }}
      >
        {/* Glows */}
        <div
          className="absolute -top-32 -right-24 w-[520px] h-[520px] rounded-full blur-3xl opacity-70"
          style={{ background: `radial-gradient(closest-side, ${MINT}80, transparent)` }}
        />
        <div
          className="absolute -bottom-40 -left-24 w-[480px] h-[480px] rounded-full blur-3xl opacity-60"
          style={{ background: `radial-gradient(closest-side, #FFFFFF, transparent)` }}
        />
        {/* Dot grid */}
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage: `radial-gradient(${FOREST} 1px, transparent 1px)`,
            backgroundSize: "22px 22px",
            maskImage: "linear-gradient(to bottom, black, transparent 85%)",
            WebkitMaskImage: "linear-gradient(to bottom, black, transparent 85%)",
          }}
        />

        <div className="relative z-10 flex flex-col w-full p-12 xl:p-14">
          <div>
            <h2 className="text-[34px] xl:text-[40px] leading-[1.1] font-bold tracking-tight max-w-md">
              Your books,{" "}
              <span className="bg-gradient-to-r from-[#0F6E56] to-[#1FA67E] bg-clip-text text-transparent">
                balanced
              </span>{" "}
              every day.
            </h2>
            <p className="mt-4 text-[15px] text-[#0F6E56]/80 max-w-sm leading-relaxed">
              Invoicing, banking, payroll and reporting in one place, built for growing businesses.
            </p>
          </div>

          {/* Product preview */}
          <div className="relative flex-1 flex items-center justify-center my-10 min-h-[300px]">
            <div className="w-full max-w-[400px] rounded-2xl border border-white/80 bg-white/70 backdrop-blur-md p-6 shadow-2xl shadow-[#0F6E56]/15 motion-safe:animate-float">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-[#0F6E56]/70">Cash in · last 10 weeks</p>
                  <p className="mt-1 text-2xl font-bold tracking-tight">LKR 4.82M</p>
                </div>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#5DCAA5]/20 px-2 py-0.5 text-xs font-semibold text-[#0F6E56]">
                  <TrendingUp className="w-3 h-3" /> 18.4%
                </span>
              </div>
              <div className="mt-6 flex h-28 items-end gap-2">
                {PREVIEW_BARS.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 rounded-t-md"
                    style={{
                      height: `${h}%`,
                      background:
                        i === PREVIEW_BARS.length - 1
                          ? `linear-gradient(to top, #1FA67E, ${MINT})`
                          : `linear-gradient(to top, ${MINT}40, ${MINT}99)`,
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="absolute -bottom-2 left-0 xl:-left-2 flex items-center gap-3 rounded-2xl border border-white/80 bg-white/85 backdrop-blur-md px-4 py-3 shadow-xl shadow-[#0F6E56]/15 motion-safe:animate-float-slow">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#5DCAA5]/25">
                <CheckCircle2 className="w-5 h-5 text-[#1FA67E]" />
              </span>
              <div>
                <p className="text-sm font-semibold">Invoice paid</p>
                <p className="text-xs text-[#0F6E56]/70">INV-0142 · LKR 48,500</p>
              </div>
            </div>

            <div className="absolute top-2 right-0 xl:-right-2 flex items-center gap-2 rounded-xl border border-white/80 bg-white/75 backdrop-blur-md px-3 py-2 shadow-lg shadow-[#0F6E56]/10 motion-safe:animate-float-slow">
              <span className="h-2 w-2 rounded-full bg-[#1FA67E]" />
              <p className="text-xs font-medium text-[#0F6E56]">Trial balance in balance</p>
            </div>
          </div>

          <ul className="space-y-3">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-[#0B4A3B]">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/70 border border-white shadow-sm shadow-[#0F6E56]/10">
                  <Icon className="w-4 h-4 text-[#1FA67E]" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
