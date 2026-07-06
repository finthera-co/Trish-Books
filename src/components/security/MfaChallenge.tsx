import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { listVerifiedTotpFactors, verifyTotp } from "@/hooks/useMfa";

/**
 * Full-screen step-up shown by ProtectedRoute when the session is aal1 but the
 * user has a verified TOTP factor. Blocks all protected routes until a valid
 * code lifts the session to aal2 — so it can't be skipped by navigating directly.
 */
export function MfaChallenge({ onVerified }: { onVerified: () => void }) {
  const { signOut } = useAuth();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const factors = await listVerifiedTotpFactors();
      if (!factors.length) throw new Error("No authenticator is enrolled on this account.");
      await verifyTotp(factors[0].id, code);
      onVerified();
    } catch {
      toast.error("That code didn't work. Check your authenticator app and try again.");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
            <ShieldCheck className="w-5 h-5 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Two-factor verification</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Enter the 6-digit code from your authenticator app to continue.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <input
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
            placeholder="000000"
            className="w-full text-center tracking-[0.5em] text-lg border border-input rounded-xl px-4 py-3 bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
          <Button type="submit" className="w-full h-12 rounded-xl font-semibold" disabled={busy || code.length !== 6}>
            {busy ? "Verifying…" : "Verify"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => signOut()}
          className="mt-6 w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
