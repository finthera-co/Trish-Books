import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error("Signup failed");

      const { data: planData } = await supabase
        .from("subscription_plans")
        .select("id")
        .eq("name", "Starter")
        .single();

      const { data: tenantData, error: tenantError } = await supabase
        .from("tenants")
        .insert({ company_name: companyName, subscription_plan_id: planData?.id })
        .select()
        .single();

      if (tenantError) throw tenantError;

      const { data: roleData } = await supabase
        .from("roles")
        .select("id")
        .eq("role_name", "Company Admin")
        .single();

      const { error: userError } = await supabase.from("users").insert({
        auth_user_id: authData.user.id,
        tenant_id: tenantData.id,
        email,
        first_name: firstName,
        last_name: lastName,
        role_id: roleData?.id,
      });

      if (userError) throw userError;

      toast.success("Account created! Please check your email to verify.");
      navigate("/login");
    } catch (error: any) {
      toast.error(error.message);
    }

    setLoading(false);
  };

  const inputClass = "mt-1.5 w-full text-sm border border-input rounded-xl px-4 py-3 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200";

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary mb-4 shadow-sm">
            <BookOpen className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Create your account</h1>
          <p className="text-muted-foreground mt-2">Start your 14-day free trial</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border p-6 space-y-4 shadow-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-foreground">First Name</label>
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} required />
            </div>
            <div>
              <label className="text-sm font-medium text-foreground">Last Name</label>
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} required />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Company Name</label>
            <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={inputClass} placeholder="Acme Inc" required />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} placeholder="you@company.com" required />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground">Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} placeholder="••••••••" minLength={6} required />
          </div>
          <Button type="submit" className="w-full h-12 rounded-xl font-semibold shadow-sm transition-all duration-200 hover:shadow-md" disabled={loading}>
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link to="/login" className="text-primary font-semibold hover:text-primary/80 transition-colors">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
