import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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
    <div className="min-h-screen flex bg-background">
      {/* Left panel — form */}
      <div className="w-full lg:w-[520px] xl:w-[560px] flex flex-col border-r border-border">
        {/* Logo */}
        <div className="px-8 pt-8">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-sm">
              <BookOpen className="w-4.5 h-4.5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-tight">Finthera</span>
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
                  className="w-full text-sm border border-input rounded-xl px-4 py-3 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200"
                  placeholder="Enter Your Email Address"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">Password</label>
                  <button type="button" className="text-sm font-semibold text-primary hover:text-primary/80 transition-colors">
                    Forgot Your Password?
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
          <p className="text-xs text-muted-foreground">Finthera {new Date().getFullYear()}</p>
        </div>
      </div>

      {/* Right panel — product showcase */}
      <div className="hidden lg:flex flex-1 flex-col p-10 overflow-hidden bg-accent/30">
        {/* What's new header */}
        <div className="flex items-start justify-between mb-6 animate-fade-in">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse-soft" />
              <span className="text-sm font-semibold text-primary">What's new?</span>
            </div>
            <h2 className="text-xl font-bold text-foreground tracking-tight">Latest Release</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-md leading-relaxed">
              Track revenue, journals, and financial health in real-time.
              Your data — clean, clear, and ready for action.
            </p>
          </div>
          <button className="text-sm font-medium text-primary hover:text-primary/80 transition-colors whitespace-nowrap">
            View All Changes →
          </button>
        </div>

        {/* Dashboard preview card */}
        <div className="flex-1 bg-card rounded-2xl border border-border shadow-lg overflow-hidden p-6 animate-slide-up">
          {/* Mini header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                <BookOpen className="w-3.5 h-3.5 text-primary-foreground" />
              </div>
              <span className="text-sm font-bold text-foreground">Finthera</span>
            </div>
          </div>

          <h3 className="text-lg font-bold text-foreground mb-4 tracking-tight">Overview</h3>

          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: "Journal Entries", value: "1,483", change: "+12.5%", up: true, color: "hsl(217, 91%, 60%)" },
              { label: "Pending Reviews", value: "54", change: "-12.5%", up: false, color: "hsl(38, 92%, 50%)" },
              { label: "Reconciled", value: "27", change: "+4.1%", up: true, color: "hsl(160, 84%, 39%)" },
              { label: "Active Accounts", value: "259", change: "+41.4%", up: true, color: "hsl(280, 65%, 60%)" },
            ].map((kpi, i) => (
              <div key={i} className="border border-border rounded-xl p-3 bg-card hover:shadow-sm transition-shadow duration-200">
                <div className="w-7 h-7 rounded-lg mb-2 flex items-center justify-center" style={{ backgroundColor: `${kpi.color}15` }}>
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: kpi.color }} />
                </div>
                <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-foreground tabular-nums">{kpi.value}</span>
                  <span className={`text-xs font-medium ${kpi.up ? "text-[hsl(160,84%,39%)]" : "text-destructive"}`}>
                    {kpi.up ? "↑" : "↓"} {kpi.change}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Chart area placeholder */}
          <div className="h-32 rounded-xl bg-muted/30 border border-border/60 mb-4 flex items-end px-4 pb-3 gap-1.5">
            {[40, 55, 35, 60, 45, 70, 65, 50, 75, 55, 80, 60].map((h, i) => (
              <div key={i} className="flex-1 rounded-t-md transition-all duration-500" style={{ height: `${h}%`, backgroundColor: `hsl(217, 91%, 60%, ${0.3 + (h / 100) * 0.7})` }} />
            ))}
          </div>

          {/* Table preview */}
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40">
                  <th className="text-left font-medium text-muted-foreground px-3 py-2.5">No</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-2.5">Description</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-2.5">Type</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-2.5">Status</th>
                  <th className="text-right font-medium text-muted-foreground px-3 py-2.5">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {[
                  { no: "JE-1024", desc: "Office Supplies", type: "Expense", status: "Posted", amount: "3,165" },
                  { no: "JE-1025", desc: "Client Payment", type: "Revenue", status: "Draft", amount: "4,450" },
                  { no: "JE-1026", desc: "Payroll Run", type: "Payroll", status: "Posted", amount: "2,220" },
                ].map((row, i) => (
                  <tr key={i} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{row.no}</td>
                    <td className="px-3 py-2.5 text-foreground font-medium">{row.desc}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{row.type}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${row.status === "Posted" ? "bg-[hsl(160,84%,39%)]/10 text-[hsl(160,84%,39%)]" : "bg-[hsl(38,92%,50%)]/10 text-[hsl(38,92%,50%)]"}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-foreground tabular-nums font-medium">LKR {row.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
