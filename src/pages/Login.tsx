import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { BookOpen, Mail, Lock, ArrowRight, BarChart3, Shield, Zap } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Welcome back!");
      navigate("/");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] bg-[hsl(var(--sidebar-background))] text-[hsl(var(--sidebar-foreground))] flex-col justify-between p-10 relative overflow-hidden">
        {/* Decorative elements */}
        <div className="absolute top-0 right-0 w-[400px] h-[400px] rounded-full bg-[hsl(var(--sidebar-primary))] opacity-[0.07] blur-[100px] -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-[300px] h-[300px] rounded-full bg-[hsl(var(--sidebar-primary))] opacity-[0.05] blur-[80px] translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-[hsl(var(--sidebar-primary))] flex items-center justify-center">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">AccuBooks</span>
          </div>
          <p className="text-sm text-[hsl(var(--sidebar-muted))] mt-1">Management Accounting Platform</p>
        </div>

        <div className="relative z-10 space-y-8">
          <h2 className="text-2xl font-bold leading-snug">
            Smarter accounting<br />for growing businesses
          </h2>
          <div className="space-y-5">
            {[
              { icon: BarChart3, title: "Real-time Financial Reports", desc: "Income statements, balance sheets, and cash flow — generated instantly." },
              { icon: Shield, title: "Multi-tenant & Secure", desc: "Role-based access control with full audit trail on every action." },
              { icon: Zap, title: "Automate Your Workflow", desc: "From journal entries to payroll — streamline your entire back office." },
            ].map((item, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-9 h-9 rounded-lg bg-[hsl(var(--sidebar-accent))] flex items-center justify-center shrink-0">
                  <item.icon className="w-4 h-4 text-[hsl(var(--sidebar-primary))]" />
                </div>
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-xs text-[hsl(var(--sidebar-muted))] mt-0.5 leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="relative z-10 text-xs text-[hsl(var(--sidebar-muted))]">
          © {new Date().getFullYear()} AccuBooks. All rights reserved.
        </p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center bg-background px-6">
        <div className="w-full max-w-[400px]">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 lg:hidden">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
              <BookOpen className="w-4.5 h-4.5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-tight">AccuBooks</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">Welcome back</h1>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm border border-input rounded-lg pl-10 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                  placeholder="you@company.com"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-foreground">Password</label>
                <button type="button" className="text-xs text-primary hover:underline">Forgot password?</button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-sm border border-input rounded-lg pl-10 pr-3 py-2.5 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <Button type="submit" className="w-full h-11 text-sm font-medium mt-2" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Signing in…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Sign In <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            Don't have an account?{" "}
            <Link to="/signup" className="text-primary font-medium hover:underline">Create account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
