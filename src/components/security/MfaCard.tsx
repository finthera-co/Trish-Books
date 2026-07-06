import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  listVerifiedTotpFactors,
  startTotpEnrollment,
  verifyTotp,
  unenrollFactor,
  type TotpEnrollment,
} from "@/hooks/useMfa";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Factor = { id: string };

/** Enrollment + management of the user's TOTP authenticator, for the settings page. */
export function MfaCard() {
  const [factors, setFactors] = useState<Factor[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setFactors(await listVerifiedTotpFactors());
    } catch {
      /* leave empty on error */
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const enabled = factors.length > 0;

  const begin = async () => {
    setBusy(true);
    try {
      setEnrollment(await startTotpEnrollment());
    } catch (e: any) {
      toast.error(e?.message || "Could not start enrollment");
    }
    setBusy(false);
  };

  const confirmEnroll = async () => {
    if (!enrollment) return;
    setBusy(true);
    try {
      await verifyTotp(enrollment.factorId, code);
      toast.success("Two-factor authentication enabled");
      setEnrollment(null);
      setCode("");
      await refresh();
    } catch {
      toast.error("That code didn't work — try the current one from your app.");
    }
    setBusy(false);
  };

  const disable = async (id: string) => {
    setBusy(true);
    try {
      await unenrollFactor(id);
      toast.success("Two-factor authentication disabled");
      await refresh();
    } catch (e: any) {
      toast.error(e?.message || "Could not disable");
    }
    setBusy(false);
  };

  return (
    <div className="stat-card">
      <div className="flex items-center gap-2 mb-4">
        {enabled ? (
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
        ) : (
          <ShieldAlert className="w-4 h-4 text-amber-500" />
        )}
        <h3 className="text-sm font-medium text-foreground">Two-Factor Authentication</h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking…
        </div>
      ) : enabled ? (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Your account is protected with an authenticator app. You'll be asked for a code each time you sign in.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm" disabled={busy}>Disable</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disable two-factor authentication?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your account will be protected by password only. You can re-enable it at any time.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => disable(factors[0].id)}>Disable</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : enrollment ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Scan this QR code with Google Authenticator, 1Password, Authy, or any TOTP app — then enter the 6-digit code to confirm.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 items-start">
            <img
              src={enrollment.qrCode}
              alt="Authenticator QR code"
              className="w-40 h-40 rounded-lg border border-border bg-white p-2"
            />
            <div className="space-y-2 text-sm">
              <p className="text-muted-foreground">Can't scan? Enter this key manually:</p>
              <code className="block break-all rounded bg-muted px-2 py-1 text-xs">{enrollment.secret}</code>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
              placeholder="000000"
              className="w-32 text-center tracking-[0.4em] border border-input rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <Button size="sm" onClick={confirmEnroll} disabled={busy || code.length !== 6}>
              {busy ? "Verifying…" : "Confirm"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEnrollment(null); setCode(""); }} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Add an extra layer of security. After entering your password you'll also enter a code from your phone.
          </p>
          <Button size="sm" onClick={begin} disabled={busy}>
            {busy ? "Starting…" : "Enable"}
          </Button>
        </div>
      )}
    </div>
  );
}
