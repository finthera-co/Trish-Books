import { useCallback, useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { mfaStepUpRequired } from "@/hooks/useMfa";
import { MfaChallenge } from "@/components/security/MfaChallenge";
import { EmailNotVerified } from "@/components/security/EmailNotVerified";

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="text-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
      <p className="text-muted-foreground">Loading...</p>
    </div>
  </div>
);

export default function ProtectedRoute() {
  const { user, appUser, loading } = useAuth();
  const location = useLocation();
  const [mfa, setMfa] = useState<"checking" | "ok" | "required">("checking");

  const checkMfa = useCallback(async () => {
    try {
      setMfa((await mfaStepUpRequired()) ? "required" : "ok");
    } catch {
      setMfa("ok");
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setMfa("ok");
      return;
    }
    setMfa("checking");
    checkMfa();
  }, [user, loading, checkMfa]);

  if (loading || (user && mfa === "checking")) {
    return <Loading />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Block until the email is confirmed (no-op when the project auto-confirms).
  if (!user.email_confirmed_at) {
    return <EmailNotVerified email={user.email} />;
  }

  // Session is aal1 but a verified factor exists — force step-up before anything else.
  if (mfa === "required") {
    return <MfaChallenge onVerified={checkMfa} />;
  }

  // Authenticated via OAuth but no tenant/profile yet — finish onboarding
  if (!appUser && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}

