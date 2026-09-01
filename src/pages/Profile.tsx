import { useEffect, useMemo, useRef, useState } from "react";
import {
  Mail, ShieldCheck, User as UserIcon, Building2, CalendarDays, Clock,
  KeyRound, Eye, EyeOff, Loader2, BadgeCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MfaCard } from "@/components/security/MfaCard";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  useMyProfile, useUpdateMyName, useHasMfa,
  reauthenticate, changePassword, requestEmailChange, syncEmailFromAuth,
  MIN_PASSWORD_LENGTH,
} from "@/hooks/useMyProfile";

const inputClass =
  "mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground " +
  "focus:outline-none focus:ring-2 focus:ring-primary/20";

function Field({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2.5">
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, appUser } = useAuth();
  const { data: profile, isLoading } = useMyProfile();
  const { data: hasMfa, refetch: refetchMfa } = useHasMfa();
  const updateName = useUpdateMyName();

  // ── Name ────────────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  useEffect(() => {
    if (profile) {
      setFirstName(profile.first_name);
      setLastName(profile.last_name);
    }
  }, [profile]);

  const nameDirty =
    !!profile && (firstName.trim() !== profile.first_name || lastName.trim() !== profile.last_name);

  const saveName = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast.error("First and last name are both required");
      return;
    }
    updateName.mutate(
      { first_name: firstName.trim(), last_name: lastName.trim() },
      {
        onSuccess: () => toast.success("Profile updated"),
        onError: (e: any) => toast.error(e?.message || "Could not save your profile"),
      },
    );
  };

  // ── Email ───────────────────────────────────────────────────────────────
  // auth.users is the source of truth for the login address; public.users is a
  // copy that only catches up once a change is confirmed. If the user has just
  // confirmed one, pull it across so the whole app stops showing the old one.
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !user?.email || !profile) return;
    if (user.email.toLowerCase() === profile.email.toLowerCase()) return;
    synced.current = true;
    syncEmailFromAuth()
      .then(() => toast.success("Your email address has been updated"))
      .catch(() => { synced.current = false; });
  }, [user?.email, profile]);

  const [emailOpen, setEmailOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const pendingEmail = (user as any)?.new_email as string | undefined;

  const submitEmail = async () => {
    const next = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
      toast.error("Enter a valid email address");
      return;
    }
    if (next === (user?.email ?? "").toLowerCase()) {
      toast.error("That is already your email address");
      return;
    }
    setEmailBusy(true);
    try {
      await requestEmailChange(next);
      toast.success("Check your inbox — confirm the link to finish the change");
      setEmailOpen(false);
      setNewEmail("");
    } catch (e: any) {
      toast.error(e?.message || "Could not start the email change");
    }
    setEmailBusy(false);
  };

  // ── Password ────────────────────────────────────────────────────────────
  const [pwOpen, setPwOpen] = useState(false);
  const [currentPw, setCurrentPw] = useState("");
  const [totp, setTotp] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);

  // The 2FA card below can be used in the same visit, so re-check the factors
  // as the form opens rather than trusting whatever was cached on mount —
  // otherwise an enrolling user gets asked for a password the RPC won't accept.
  const openPasswordForm = () => {
    setPwOpen(true);
    void refetchMfa();
  };

  const resetPwForm = () => {
    setCurrentPw(""); setTotp(""); setNewPw(""); setConfirmPw(""); setShowPw(false);
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPw.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (newPw !== confirmPw) {
      toast.error("Passwords don't match");
      return;
    }
    setPwBusy(true);
    try {
      await reauthenticate({ email: user?.email ?? "", password: currentPw, totpCode: totp });
      await changePassword(newPw);
      toast.success("Password updated");
      setPwOpen(false);
      resetPwForm();
    } catch (err: any) {
      toast.error(err?.message || "Could not change your password");
    }
    setPwBusy(false);
  };

  const initials = useMemo(
    () => `${profile?.first_name?.[0] ?? ""}${profile?.last_name?.[0] ?? ""}`.toUpperCase(),
    [profile],
  );
  const fullName = profile ? `${profile.first_name} ${profile.last_name}` : "";
  const isActive = (profile?.status ?? "active").toLowerCase() === "active";

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">My Profile</h1>
          <p className="page-description">Your account details and sign-in security</p>
        </div>
      </div>

      {/* Two columns from lg up: who you are on the left, everything that
          guards the sign-in on the right — so Security is not buried below
          a fold of read-only facts. Stacks back to one column on narrow. */}
      <div className="grid gap-6 lg:grid-cols-2 items-start max-w-5xl">
        <div className="space-y-6">
          {/* Identity */}
          <div className="stat-card">
            {isLoading ? (
              <div className="flex items-center gap-4">
                <Skeleton className="w-16 h-16 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-56" />
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-[hsl(280,65%,60%)] flex items-center justify-center text-lg font-bold text-primary-foreground shadow-sm shrink-0">
                  {initials || "?"}
                </div>
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-foreground truncate">{fullName || "—"}</h2>
                  <p className="text-sm text-muted-foreground truncate">{profile?.email}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2 py-0.5 text-[11px] font-medium">
                      {profile?.role_name}
                    </span>
                    {profile?.is_primary && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-accent text-accent-foreground px-2 py-0.5 text-[11px] font-medium">
                        <BadgeCheck className="w-3 h-3" /> Primary
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground px-2 py-0.5 text-[11px] font-medium">
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-emerald-500" : "bg-amber-500"}`} />
                      {isActive ? "Active" : profile?.status}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Personal details */}
          <div className="stat-card">
            <h3 className="text-sm font-medium text-foreground mb-4">Personal Details</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-muted-foreground">First Name</label>
                  <input
                    type="text"
                    value={firstName}
                    maxLength={100}
                    onChange={(e) => setFirstName(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Last Name</label>
                  <input
                    type="text"
                    value={lastName}
                    maxLength={100}
                    onChange={(e) => setLastName(e.target.value)}
                    className={inputClass}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Your role and organisation are set by an administrator — ask them if either is wrong.
              </p>
              <Button size="sm" onClick={saveName} disabled={!nameDirty || updateName.isPending}>
                {updateName.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>

          {/* Account facts (read-only) */}
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Account</h3>
            </div>
            <div className="divide-y divide-border/70">
              <Field icon={UserIcon} label="Role" value={profile?.role_name} />
              <Field icon={Building2} label="Organisation" value={profile?.tenant_name} />
              <Field
                icon={CalendarDays}
                label="Member since"
                value={profile?.created_at ? formatDate(profile.created_at) : null}
              />
              {/* From the auth session, not users.last_login_at — nothing in the
                  app maintains that column, so it is always null. */}
              <Field
                icon={Clock}
                label="Last sign-in"
                value={user?.last_sign_in_at ? formatDateTime(user.last_sign_in_at) : "—"}
              />
              <Field icon={BadgeCheck} label="User ID" value={appUser?.id} />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Sign-in email */}
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-4">
              <Mail className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Sign-In Email</h3>
            </div>

            {pendingEmail && (
              <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                Change to <span className="font-semibold">{pendingEmail}</span> is waiting on the confirmation
                link. Until you click it, keep signing in with your current address.
              </div>
            )}

            <p className="text-sm text-foreground">{user?.email}</p>

            {!emailOpen ? (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => setEmailOpen(true)}>
                Change email
              </Button>
            ) : (
              <div className="mt-3 space-y-3">
                <div>
                  <label className="text-sm text-muted-foreground">New email address</label>
                  <input
                    type="email"
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="you@company.com"
                    className={inputClass}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  We'll email a confirmation link. The address only changes once you click it — your
                  current email keeps working until then.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={submitEmail} disabled={emailBusy}>
                    {emailBusy ? "Sending…" : "Send confirmation"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setEmailOpen(false); setNewEmail(""); }}
                    disabled={emailBusy}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Password */}
          <div className="stat-card">
            <div className="flex items-center gap-2 mb-4">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Password</h3>
            </div>

            {!pwOpen ? (
              <>
                <p className="text-sm text-muted-foreground">
                  Choose a password of at least {MIN_PASSWORD_LENGTH} characters that you don't use anywhere else.
                </p>
                <Button variant="outline" size="sm" className="mt-3" onClick={openPasswordForm}>
                  Change password
                </Button>
              </>
            ) : (
              <form onSubmit={submitPassword} className="space-y-3">
                {hasMfa ? (
                  <div>
                    <label className="text-sm text-muted-foreground">Code from your authenticator app</label>
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={totp}
                      onChange={(e) => setTotp(e.target.value.replace(/[^0-9]/g, "").slice(0, 6))}
                      placeholder="000000"
                      className="mt-1 w-32 text-center tracking-[0.4em] border border-input rounded-md px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Confirms it's really you before the password changes.
                    </p>
                  </div>
                ) : (
                  <div>
                    <label className="text-sm text-muted-foreground">Current password</label>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                )}

                <div>
                  <label className="text-sm text-muted-foreground">New password</label>
                  <div className="relative">
                    <input
                      type={showPw ? "text" : "password"}
                      autoComplete="new-password"
                      value={newPw}
                      minLength={MIN_PASSWORD_LENGTH}
                      onChange={(e) => setNewPw(e.target.value)}
                      className={`${inputClass} pr-10`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      aria-label={showPw ? "Hide password" : "Show password"}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="text-sm text-muted-foreground">Confirm new password</label>
                  <input
                    type={showPw ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPw}
                    minLength={MIN_PASSWORD_LENGTH}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    className={inputClass}
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={pwBusy}>
                    {pwBusy ? (<><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Updating…</>) : "Update password"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => { setPwOpen(false); resetPwForm(); }}
                    disabled={pwBusy}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>

          {/* Two-factor — same card the settings page uses */}
          <MfaCard />
        </div>
      </div>
    </div>
  );
}
