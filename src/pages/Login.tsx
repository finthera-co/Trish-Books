import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import dashboardPreview from "@/assets/login-dashboard-preview.png";
import { Button } from "@/components/ui/button";
import { BookOpen, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="min-h-screen flex bg-muted/30">
      {/* Left panel — form */}
      <div className="w-full lg:w-[520px] xl:w-[560px] flex flex-col bg-background border-r border-border">
        <div className="px-8 pt-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-tight">AccuBooks</span>
          </div>
        </div>

        <div className="flex-1 flex items-center justify-center px-8">
          <div className="w-full max-w-[400px]">
            <div className="mb-8">
              <h1 className="text-[28px] font-bold text-foreground">Welcome Back!</h1>
              <p className="text-sm text-muted-foreground mt-1">Let's get you signed in securely.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full text-sm border border-input rounded-lg px-4 py-3 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
                  placeholder="Enter Your Email Address"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <button type="button" className="text-sm font-semibold text-primary hover:underline">
                    Forgot Your Password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full text-sm border border-input rounded-lg px-4 py-3 pr-11 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors"
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

              <Button type="submit" className="w-full h-12 text-sm font-semibold rounded-full mt-2" disabled={loading}>
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
              <Link to="/signup" className="text-primary font-semibold hover:underline">Sign Up</Link>
            </p>
          </div>
        </div>

        <div className="px-8 pb-8">
          <p className="text-xs text-muted-foreground">AccuBooks {new Date().getFullYear()}</p>
        </div>
      </div>

      {/* Right panel — product showcase */}
      <div className="hidden lg:flex flex-1 flex-col p-10 overflow-hidden">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-sm font-semibold text-primary">What's new?</span>
            </div>
            <h2 className="text-xl font-bold text-foreground">Latest Release</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md leading-relaxed">
              Track revenue, journals, and financial health in real-time.
              Your data — clean, clear, and ready for action.
            </p>
          </div>
          <button className="text-sm font-medium text-primary hover:underline whitespace-nowrap">
            View All Changes →
          </button>
        </div>

        <div className="flex-1 rounded-2xl border border-border shadow-lg overflow-hidden relative bg-background">
          <img
            src={dashboardPreview}
            alt="AccuBooks financial dashboard showing charts, transactions and analytics"
            className="w-full h-full object-cover object-top"
          />
          <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background/80 to-transparent" />
        </div>
      </div>
    </div>
  );
}
