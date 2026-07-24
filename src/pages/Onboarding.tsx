import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";
import { toast } from "sonner";

export default function Onboarding() {
  const { user, appUser, loading } = useAuth();
  const navigate = useNavigate();
  const [companyName, setCompanyName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate("/login", { replace: true });
    if (!loading && appUser) navigate("/home", { replace: true });
  }, [user, appUser, loading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("provision-google-user", {
        body: { company_name: companyName.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(typeof data.error === "string" ? data.error : "Provisioning failed");
      toast.success("Workspace created!");
      // Force refresh of auth user record
      window.location.href = "/";
    } catch (err: any) {
      toast.error(err.message ?? "Failed to create workspace");
      setSubmitting(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary mb-4 shadow-sm">
            <BookOpen className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Set up your workspace</h1>
          <p className="text-muted-foreground mt-2">Welcome{user.user_metadata?.given_name ? `, ${user.user_metadata.given_name}` : ""}! Tell us about your company.</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-card rounded-xl border border-border p-6 space-y-4 shadow-sm">
          <div>
            <label className="text-sm font-medium text-foreground">Company Name</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="mt-1.5 w-full text-sm border border-input rounded-xl px-4 py-3 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all duration-200"
              placeholder="Acme Inc"
              required
              autoFocus
            />
          </div>
          <Button type="submit" className="w-full h-12 rounded-xl font-semibold" disabled={submitting}>
            {submitting ? "Creating workspace..." : "Create Workspace"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            You'll be the Primary Admin of this workspace on the Starter plan.
          </p>
        </form>
      </div>
    </div>
  );
}
