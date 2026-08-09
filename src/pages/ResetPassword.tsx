import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { BookOpen, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

/**
 * Landing page for the password-recovery email link. Supabase puts the user in
 * a temporary recovery session when they arrive here; we let them set a new
 * password via updateUser, then send them to login.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // The recovery link establishes a session and fires a PASSWORD_RECOVERY event.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Also handle the case where the session is already present on mount.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords don't match");
      return;
    }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated — please sign in.");
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-[400px] animate-fade-in">
        <div className="flex items-center gap-2.5 mb-8">
          <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center shadow-sm">
            <BookOpen className="w-4.5 h-4.5 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-foreground tracking-tight">Trish Books</span>
        </div>

        <h1 className="text-[28px] font-bold text-foreground tracking-tight">Set a new password</h1>
        <p className="text-sm text-muted-foreground mt-1.5 mb-6">Choose a strong password of at least 8 characters.</p>

        {!ready ? (
          <p className="text-sm text-muted-foreground">
            Open this page from the reset link in your email. If you got here by mistake,{" "}
            <button className="text-primary font-semibold" onClick={() => navigate("/login")}>return to sign in</button>.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">New password</label>
              <div className="relative">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={8}
                  required
                  className="w-full text-sm border border-input rounded-xl px-4 py-3 pr-11 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  placeholder="At least 8 characters"
                />
                <button type="button" onClick={() => setShow(!show)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Confirm password</label>
              <input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                required
                className="w-full text-sm border border-input rounded-xl px-4 py-3 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                placeholder="Re-enter password"
              />
            </div>
            <Button type="submit" className="w-full h-12 rounded-xl font-semibold" disabled={saving}>
              {saving ? "Updating…" : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
