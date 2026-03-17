import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { BookOpen, Mail, Lock, Eye, EyeOff } from "lucide-react";
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
        {/* Logo */}
        <div className="px-8 pt-8">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-foreground tracking-tight">AccuBooks</span>
          </div>
        </div>

        {/* Form centered */}
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
                    {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-sm font-semibold rounded-full mt-2"
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
              <Link to="/signup" className="text-primary font-semibold hover:underline">Sign Up</Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 pb-8">
          <p className="text-xs text-muted-foreground">AccuBooks {new Date().getFullYear()}</p>
        </div>
      </div>

      {/* Right panel — product showcase */}
      <div className="hidden lg:flex flex-1 flex-col p-10 overflow-hidden">
        {/* What's new header */}
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

        {/* Dashboard preview card */}
        <div className="flex-1 bg-background rounded-2xl border border-border shadow-sm overflow-hidden p-6">
          {/* Mini header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
                <BookOpen className="w-3 h-3 text-primary-foreground" />
              </div>
              <span className="text-sm font-bold text-foreground">AccuBooks</span>
            </div>
          </div>

          <h3 className="text-lg font-bold text-foreground mb-4">Overview</h3>

          {/* KPI cards */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { label: "Journal Entries", value: "1,483", change: "+12.5%", up: true },
              { label: "Pending Reviews", value: "54", change: "-12.5%", up: false },
              { label: "Reconciled", value: "27", change: "+4.1%", up: true },
              { label: "Active Accounts", value: "259", change: "+41.4%", up: true },
            ].map((kpi, i) => (
              <div key={i} className="border border-border rounded-xl p-3">
                <p className="text-xs text-muted-foreground mb-1">{kpi.label}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-foreground tabular-nums">{kpi.value}</span>
                  <span className={`text-xs font-medium ${kpi.up ? "text-emerald-600" : "text-destructive"}`}>
                    {kpi.up ? "↑" : "↓"} {kpi.change}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Revenue placeholder */}
          <div className="mb-4">
            <p className="text-sm font-semibold text-foreground mb-1">Revenue</p>
            <div className="flex items-baseline gap-6">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-primary" />
                <span className="text-xs text-muted-foreground">Gross</span>
                <span className="text-sm font-bold text-foreground tabular-nums">LKR 96,540</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-sm bg-accent-foreground/30" />
                <span className="text-xs text-muted-foreground">Net</span>
                <span className="text-sm font-bold text-foreground tabular-nums">LKR 38,920</span>
              </div>
            </div>
          </div>

          {/* Chart area placeholder */}
          <div className="h-32 rounded-xl bg-muted/50 border border-border mb-4 flex items-end px-4 pb-2 gap-1">
            {[40, 55, 35, 60, 45, 70, 65, 50, 75, 55, 80, 60].map((h, i) => (
              <div key={i} className="flex-1 bg-primary/20 rounded-t" style={{ height: `${h}%` }} />
            ))}
          </div>

          {/* Table preview */}
          <div className="border border-border rounded-xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left font-medium text-muted-foreground px-3 py-2">No</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-2">Description</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-2">Type</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-2">Status</th>
                  <th className="text-right font-medium text-muted-foreground px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  { no: "JE-1024", desc: "Office Supplies", type: "Expense", status: "Posted", amount: "3,165" },
                  { no: "JE-1025", desc: "Client Payment", type: "Revenue", status: "Draft", amount: "4,450" },
                  { no: "JE-1026", desc: "Payroll Run", type: "Payroll", status: "Posted", amount: "2,220" },
                ].map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.no}</td>
                    <td className="px-3 py-2 text-foreground">{row.desc}</td>
                    <td className="px-3 py-2 text-muted-foreground">{row.type}</td>
                    <td className="px-3 py-2">
                      <span className={row.status === "Posted" ? "text-emerald-600 font-medium" : "text-amber-500 font-medium"}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right text-foreground tabular-nums">LKR {row.amount}</td>
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
