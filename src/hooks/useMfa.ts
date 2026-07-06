import { supabase } from "@/integrations/supabase/client";

/**
 * Thin wrappers over Supabase's TOTP MFA API, shared by the enrollment card
 * (settings) and the login-time challenge gate (ProtectedRoute).
 */

export interface TotpEnrollment {
  factorId: string;
  qrCode: string; // data-URL SVG, render directly in an <img>
  secret: string; // manual-entry key
  uri: string;
}

/** Verified (active) TOTP factors on the current user. */
export async function listVerifiedTotpFactors() {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.totp ?? []).filter((f) => f.status === "verified");
}

/**
 * Whether the current session still needs to step up to AAL2. True when the
 * user has a verified factor (nextLevel = aal2) but this session is only aal1.
 */
export async function mfaStepUpRequired(): Promise<boolean> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || !data) return false;
  return data.nextLevel === "aal2" && data.currentLevel === "aal1";
}

/** Begin TOTP enrollment, clearing any half-finished (unverified) factor first. */
export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  const { data: list } = await supabase.auth.mfa.listFactors();
  const stale = (list?.all ?? []).filter((f) => f.status === "unverified");
  for (const f of stale) await supabase.auth.mfa.unenroll({ factorId: f.id });

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/** Challenge + verify a TOTP code for the given factor (activates or steps up). */
export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
  if (chErr) throw chErr;
  const { error: vErr } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: ch.id,
    code: code.replace(/\s+/g, ""),
  });
  if (vErr) throw vErr;
}

export async function unenrollFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}
