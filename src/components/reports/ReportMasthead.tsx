import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseISO, isValid } from "date-fns";
import { formatDate, formatDateTime } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * The standard heading block that sits above every financial report.
 *
 * Every statement a company hands to an auditor, a bank or a director has to
 * answer the same four questions before the first figure is read: whose books
 * are these, what statement is it, what period does it cover, and in what
 * currency and on what basis was it prepared. Those were previously answered
 * differently on each report — the Trial Balance printed raw ISO dates with no
 * company name, the Account Report had no heading at all, and only the
 * Financial Reports page carried the entity block (print-only). One component
 * now answers all four everywhere, so a printed pack reads as one document set.
 */

export interface ReportCompany {
  company_name: string;
  address: string | null;
  phone: string | null;
  tax_id: string | null;
  registration_number: string | null;
  logo_url: string | null;
}

/**
 * Entity identity for the masthead. Shared query key: several reports render on
 * the same page (Ledger's tabs, the Reports hub), and they must not each fetch
 * — nor disagree about — the company block.
 */
export function useReportCompany() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["report_company", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<ReportCompany | null> => {
      const { data, error } = await supabase
        .from("tenants")
        .select("company_name, address, phone, tax_id, registration_number, logo_url")
        .eq("id", appUser!.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return data as ReportCompany | null;
    },
  });
}

/** ISO date → "14 Aug 2026". Falls back to the raw string if unparseable. */
export function formatReportDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  return isValid(d) ? formatDate(d) : iso;
}

/** One scope/filter fact shown under the period line. */
export interface ScopeItem {
  label: string;
  value: string;
}

/** Falsy entries are dropped, so callers can inline conditionals. */
export type ScopeInput = (ScopeItem | null | false | undefined)[];

export interface ReportMastheadProps {
  /** The statement's formal name, e.g. "Trial Balance". */
  title: string;
  /** Second line under the title — the account being reported on, a method, a basis. */
  subtitle?: string | null;
  /** Period covered. Omit both and pass `asAt` for a point-in-time statement. */
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Point-in-time statements (Balance Sheet) report "As at" a single date. */
  asAt?: string | null;
  /** Replaces the generated period sentence entirely (e.g. "For the Year Ended 31st March 2026"). */
  periodCaption?: string | null;
  /** Reporting currency shown in the basis line. */
  currency?: string;
  /** Accounting basis. Pass null to omit. */
  basis?: string | null;
  /** Filters/scope in force — what a reader needs to know to reproduce the figures. */
  scope?: ScopeInput;
  /** Export fingerprint or document id, rendered in monospace at the foot. */
  documentId?: string | null;
  /** Extra note rendered above the generated-on line (e.g. a restatement caveat). */
  note?: string | null;
  className?: string;
}

export function ReportMasthead({
  title,
  subtitle,
  dateFrom,
  dateTo,
  asAt,
  periodCaption,
  currency = "LKR",
  basis = "Accrual basis",
  scope,
  documentId,
  note,
  className = "",
}: ReportMastheadProps) {
  const { appUser } = useAuth();
  const { data: company } = useReportCompany();

  const periodLine = useMemo(() => {
    if (periodCaption) return periodCaption;
    if (asAt) return `As at ${formatReportDate(asAt)}`;
    if (dateFrom && dateTo) return `For the period ${formatReportDate(dateFrom)} to ${formatReportDate(dateTo)}`;
    if (dateTo) return `Up to ${formatReportDate(dateTo)}`;
    if (dateFrom) return `From ${formatReportDate(dateFrom)}`;
    return null;
  }, [periodCaption, asAt, dateFrom, dateTo]);

  const scopeItems = useMemo(
    () => (scope ?? []).filter((s): s is ScopeItem => !!s && !!s.value),
    [scope]
  );

  const contactLine = [
    company?.phone,
    company?.tax_id ? `TIN: ${company.tax_id}` : null,
    company?.registration_number ? `Reg. No: ${company.registration_number}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const preparedBy = [appUser?.first_name, appUser?.last_name].filter(Boolean).join(" ").trim();

  return (
    <header className={`report-masthead text-center mb-5 print:mb-4 ${className}`}>
      {/* ── Entity block ── */}
      <div className="pb-3 mb-3 border-b border-border">
        {company?.logo_url && (
          <img
            src={company.logo_url}
            alt=""
            className="h-10 max-w-[180px] object-contain mx-auto mb-2"
          />
        )}
        <p className="text-base font-bold uppercase tracking-wide text-foreground leading-snug">
          {company?.company_name || "—"}
        </p>
        {company?.address && (
          <p className="text-xs text-muted-foreground whitespace-pre-line leading-snug mt-0.5">{company.address}</p>
        )}
        {contactLine && <p className="text-xs text-muted-foreground leading-snug mt-0.5">{contactLine}</p>}
      </div>

      {/* ── Statement identity ── */}
      <h2 className="text-lg font-bold uppercase tracking-[0.12em] text-foreground">{title}</h2>
      {subtitle && <p className="text-sm font-medium text-foreground/80 mt-0.5">{subtitle}</p>}
      {periodLine && <p className="text-sm text-muted-foreground mt-1">{periodLine}</p>}

      <p className="text-xs text-muted-foreground mt-1">
        {basis ? `${basis}  ·  ` : ""}All amounts in {currency}
      </p>

      {scopeItems.length > 0 && (
        <p className="text-xs text-muted-foreground mt-1">
          {scopeItems.map((s, i) => (
            <span key={s.label}>
              {i > 0 && <span className="mx-1.5 text-muted-foreground/50">·</span>}
              <span className="text-muted-foreground/70">{s.label}:</span> {s.value}
            </span>
          ))}
        </p>
      )}

      {note && <p className="text-xs text-muted-foreground italic mt-1">{note}</p>}

      <p className="text-[10px] text-muted-foreground/80 mt-1.5">
        Generated {formatDateTime(new Date())}
        {preparedBy ? ` by ${preparedBy}` : ""}
      </p>
      {documentId && (
        <p className="text-[10px] font-mono text-muted-foreground/70 mt-0.5 break-all">{documentId}</p>
      )}
    </header>
  );
}

export default ReportMasthead;
