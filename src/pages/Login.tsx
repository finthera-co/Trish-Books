import { useEffect, useState } from "react";
import { useNavigate, Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import BrandMark from "@/components/BrandMark";
import { supabase } from "@/integrations/supabase/client";
import { takeSignOutReason } from "@/lib/browserSession";
import { IDLE_TIMEOUT_MS } from "@/hooks/useIdleLogout";

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
      toast.error("Enter your email above first, then click “Forgot Your Password?”");
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
      {/* Form panel */}
      <div className="w-full flex flex-col">
        {/* Logo */}
        <div className="px-8 pt-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="w-9 h-9 shrink-0 rounded-xl shadow-sm" />
            <span className="text-lg font-bold text-foreground tracking-tight">Trish Books</span>
          </div>
        </div>

        {/* Form centered */}
        <div className="flex-1 flex items-center justify-center px-8">
          <div className="w-full max-w-[400px] animate-fade-in">
            <div className="mb-8">
              <h1 className="text-[28px] font-bold text-foreground tracking-tight">Welcome Back!</h1>
              <p className="text-sm text-muted-foreground mt-1.5">Let's get you signed in securely.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full text-sm border border-input rounded-xl px-4 py-3 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200"
                  placeholder="Enter Your Email Address"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={resetting}
                    className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors disabled:opacity-60"
                  >
                    {resetting ? "Sending…" : "Forgot Your Password?"}
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full text-sm border border-input rounded-xl px-4 py-3 pr-11 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200"
                    placeholder="Your Password"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-sm font-semibold rounded-xl mt-2 shadow-sm transition-all duration-200 hover:shadow-md"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : (
                  "Log in with Email"
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-muted-foreground mt-8">
              Don't Have an Account?{" "}
              <Link to="/signup" className="text-primary font-semibold hover:text-primary/80 transition-colors">Sign Up</Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8">
          <p className="text-xs text-muted-foreground">Trish Books {new Date().getFullYear()}</p>
        </div>
      </div>
    </div>
  );
}

