import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { MailCheck } from "lucide-react";
import { toast } from "sonner";

/**
 * Shown by ProtectedRoute when a session exists but the email is unconfirmed.
 * Enforces email verification at the app level regardless of the Supabase
 * "Confirm email" setting. Inert when the project auto-confirms (email is
 * already confirmed on signup), a safety net once confirmations are enabled.
 */
export function EmailNotVerified({ email }: { email?: string }) {
  const { signOut } = useAuth();
  const [sending, setSending] = useState(false);

  const resend = async () => {
    if (!email) return;
    setSending(true);
    const { error } = await supabase.auth.resend({ type: "signup", email });
    setSending(false);
    if (error && !/rate|limit/i.test(error.message)) toast.error(error.message);
    else toast.success("Verification email sent — check your inbox.");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm text-center">
        <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
          <MailCheck className="w-5 h-5 text-primary" />
        </div>
        <h1 className="text-xl font-bold text-foreground">Verify your email</h1>
        <p className="text-sm text-muted-foreground mt-1">
          We sent a verification link to {email ? <span className="font-medium text-foreground">{email}</span> : "your email"}.
          Confirm it to continue.
        </p>
        <div className="mt-6 space-y-3">
          <Button onClick={resend} disabled={sending} className="w-full h-11 rounded-xl font-semibold">
            {sending ? "Sending…" : "Resend verification email"}
          </Button>
          <button
            type="button"
            onClick={() => signOut()}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
