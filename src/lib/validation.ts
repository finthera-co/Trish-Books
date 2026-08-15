import { z } from "zod";

/**
 * Shared input schemas for the browser.
 *
 * Two things this is and is not:
 *
 *  · It is NOT the security boundary. Anything here can be skipped by posting to
 *    PostgREST directly with the anon key, so every rule below also exists on the
 *    server — in the RLS WITH CHECK for public writes, and in
 *    supabase/functions/_shared/validate.ts for the edge functions. When the two
 *    disagree, the server wins and the user sees a raw Postgres error, which is
 *    the failure mode this file exists to prevent.
 *
 *  · It IS how a form fails readably. `required` and `type="email"` on an <input>
 *    stop a typo, but they say nothing about the length caps the database
 *    enforces — so an over-long note currently reaches Postgres and comes back as
 *    a constraint violation in a toast.
 *
 * Limits are copied from the signup_requests INSERT policy (migrations
 * 20260730000001 and 20260815000002). Keep them in step.
 */

/** Matches the `email LIKE '%_@_%.__%'` test in the RLS policy, not RFC 5322. */
export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Enter your email address")
  .max(320, "That email address is too long")
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/, "Enter a valid email address");

export const personNameField = (label: string) =>
  z.string().trim().min(1, `Enter your ${label}`).max(100, `${label} is too long`);

export const companyNameField = z
  .string()
  .trim()
  .min(1, "Enter your company name")
  .max(200, "Company name is too long");

/**
 * Kept deliberately permissive on shape — Sri Lankan numbers are written locally
 * and internationally and both are fine — but bounded, because the column is.
 */
export const phoneField = z
  .string()
  .trim()
  .max(32, "Phone number is too long")
  .regex(/^[\d\s+()-]*$/, "Phone number can only contain digits, spaces and + ( ) -");

export const TEAM_SIZES = ["1", "2-5", "6-20", "21-50", "50+", "51+"] as const;

export const teamSizeField = z
  .enum(TEAM_SIZES, { errorMap: () => ({ message: "Choose a team size" }) })
  .or(z.literal(""));

/** The database caps `message` at 2000 characters. */
export const MESSAGE_MAX = 2000;

export const messageField = z
  .string()
  .trim()
  .max(MESSAGE_MAX, `Please keep this under ${MESSAGE_MAX} characters`);

/**
 * The public "request an account" form, used by both /signup and /get-started.
 *
 * /get-started prepends a generated plan spec to `message` before inserting, so
 * it has less than MESSAGE_MAX to give the applicant — see remainingMessageRoom.
 */
export const signupRequestSchema = z.object({
  firstName: personNameField("first name"),
  lastName: personNameField("last name"),
  companyName: companyNameField,
  email: emailField,
  phone: phoneField,
  teamSize: teamSizeField,
  message: messageField,
});

export type SignupRequestInput = z.infer<typeof signupRequestSchema>;

/**
 * How much of the message cap is left once a generated prefix is accounted for.
 * /get-started writes `${spec}\n\n—\n${message}`; without this the applicant can
 * type a note that passes a 2000-character check and still overflows the column.
 */
export function remainingMessageRoom(prefix: string, separator = "\n\n—\n"): number {
  return Math.max(0, MESSAGE_MAX - prefix.length - separator.length);
}

/**
 * Runs a schema and returns errors keyed by field, which is the shape the plain
 * useState forms in this codebase can consume directly. react-hook-form pages
 * should use zodResolver instead of this.
 */
export function fieldErrors<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; errors: Record<string, string> } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };

  const errors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_form";
    // First message per field: a form shows one line under an input, and the
    // first failure is the one the user should fix first.
    if (!(key in errors)) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
