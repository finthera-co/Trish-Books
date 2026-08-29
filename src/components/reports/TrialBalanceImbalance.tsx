import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2, ArrowRight } from "lucide-react";
import { fmtBal } from "@/lib/glReportModel";
import { formatDate } from "@/lib/format";
import {
  useTrialBalanceDiagnostics,
  type ImbalanceComponent,
  type ImbalanceItem,
} from "@/hooks/useTrialBalanceDiagnostics";

/** Sub-cent noise is not a cause; the report's own totals use the same cut-off. */
const EPSILON = 0.005;

/** Debit-positive amounts, labelled so the direction is never ambiguous. */
function signed(amount: number): string {
  if (Math.abs(amount) < EPSILON) return "—";
  return `${fmtBal(Math.abs(amount))} ${amount > 0 ? "Dr" : "Cr"}`;
}

interface Props {
  dateFrom: string;
  dateTo: string;
  includeInactive: boolean;
  /** The difference the report itself is showing, used as the headline figure. */
  closingDifference: number;
  /** True when the table below is a filtered subset, so the banner must say so. */
  isFilteredView?: boolean;
  onOpenAccount: (accountId: string) => void;
  onOpenEntry: (entryId: string) => void;
}

/**
 * The out-of-balance banner, and the trail behind it.
 *
 * A trial balance that does not balance is useless as a number on its own —
 * what the reader needs is the account or the entry causing it. Clicking the
 * banner runs the server-side decomposition and lists every contributing
 * cause, each drillable to the ledger or the journal entry behind it. The
 * components add up to the headline figure exactly, so the panel proves its
 * own completeness rather than offering a plausible guess.
 */
export function TrialBalanceImbalance({
  dateFrom, dateTo, includeInactive, closingDifference, isFilteredView, onOpenAccount, onOpenEntry,
}: Props) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useTrialBalanceDiagnostics(dateFrom, dateTo, includeInactive, open);

  const direction = closingDifference > 0 ? "closing debits exceed credits" : "closing credits exceed debits";

  return (
    <div className="print:hidden mb-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-800 text-sm text-red-900 dark:text-red-200">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-start gap-2.5 px-4 py-2.5 text-left font-medium hover:bg-red-100/60 dark:hover:bg-red-950/40 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400/40"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span className="flex-1">
          Out of balance: {direction} by {fmtBal(Math.abs(closingDifference))}.{" "}
          <span className="underline underline-offset-2">
            {open ? "Hide where the difference comes from" : "Show where the difference comes from"}
          </span>
          {isFilteredView && (
            <span className="block mt-0.5 font-normal opacity-90">
              Measured across the whole report — the table below is filtered to audit variances, so
              its total covers only those rows.
            </span>
          )}
        </span>
        {open ? <ChevronDown className="w-4 h-4 mt-0.5" /> : <ChevronRight className="w-4 h-4 mt-0.5" />}
      </button>

      {open && (
        <div className="border-t border-red-200 dark:border-red-800 px-4 py-3">
          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" />
              Tracing the difference through the ledger…
            </div>
          ) : error ? (
            <p className="py-2 text-xs">Could not trace the difference: {(error as Error).message}</p>
          ) : data ? (
            <Breakdown
              data={data}
              reportDifference={closingDifference}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onOpenAccount={onOpenAccount}
              onOpenEntry={onOpenEntry}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function Breakdown({
  data, reportDifference, dateFrom, dateTo, onOpenAccount, onOpenEntry,
}: {
  data: NonNullable<ReturnType<typeof useTrialBalanceDiagnostics>["data"]>;
  reportDifference: number;
  dateFrom: string;
  dateTo: string;
  onOpenAccount: (id: string) => void;
  onOpenEntry: (id: string) => void;
}) {
  // Causes worth reading first; a zero component is proof it was ruled out, so
  // it stays on the list rather than disappearing.
  const causes = [...data.components].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

  // Summed from the figures actually printed, not from a parallel server
  // total: whatever a reader adds up by hand is what the last row says. Any
  // shortfall is shown as its own line rather than absorbed, so the column
  // always reconciles to the closing difference.
  const explained = causes.reduce((sum, c) => sum + c.amount, 0);
  const unexplained = data.closingDifference - explained;

  // The banner quotes the report's own total; this panel quotes the ledger scan
  // that explains it. They are computed independently and must agree — if a
  // filter changed while the scan was in flight, say so rather than presenting
  // a breakdown of a different number.
  const drift = data.closingDifference - reportDifference;

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono">
        <span>
          Opening ({formatDate(dateFrom)}): <strong>{signed(data.openingDifference)}</strong>
        </span>
        <span>
          Movement {formatDate(dateFrom)} – {formatDate(dateTo)}:{" "}
          <strong>{signed(data.periodDifference)}</strong>
        </span>
        <span>
          Closing difference: <strong>{signed(data.closingDifference)}</strong>
        </span>
      </div>

      {Math.abs(drift) > EPSILON && (
        <p className="font-medium">
          The report is showing {signed(reportDifference)} while this scan measured{" "}
          {signed(data.closingDifference)} — the filters changed while it was running. Reopen the
          panel to re-scan.
        </p>
      )}

      <div className="rounded-md border border-red-200/70 dark:border-red-800/70 overflow-hidden">
        {causes.map((c) => (
          <CauseRow
            key={c.code}
            cause={c}
            onOpenAccount={onOpenAccount}
            onOpenEntry={onOpenEntry}
          />
        ))}

        {Math.abs(unexplained) > EPSILON && (
          <div className="flex items-start gap-2 px-3 py-2 border-b border-red-200/70 dark:border-red-800/70">
            <span className="w-3.5 flex-shrink-0" />
            <span className="flex-1">
              <span className="font-semibold">Unexplained</span>
              <span className="block mt-0.5 opacity-90">
                Left over after every cause above — the ledger holds a discrepancy outside these
                checks. Worth raising before relying on this report.
              </span>
            </span>
            <span className="font-mono font-semibold whitespace-nowrap">{signed(unexplained)}</span>
          </div>
        )}

        <div className="flex items-center justify-between px-3 py-2 bg-red-100/60 dark:bg-red-950/40 font-semibold border-t border-red-200 dark:border-red-800">
          <span>Closing difference</span>
          <span className="font-mono">{signed(data.closingDifference)}</span>
        </div>
      </div>
    </div>
  );
}

function CauseRow({
  cause, onOpenAccount, onOpenEntry,
}: {
  cause: ImbalanceComponent;
  onOpenAccount: (id: string) => void;
  onOpenEntry: (id: string) => void;
}) {
  const isCause = Math.abs(cause.amount) > EPSILON;
  const [expanded, setExpanded] = useState(false);
  const canExpand = isCause && cause.items.length > 0;

  return (
    <div className="border-b border-red-200/70 dark:border-red-800/70 last:border-b-0">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((v) => !v)}
        aria-expanded={canExpand ? expanded : undefined}
        disabled={!canExpand}
        className={`w-full flex items-start gap-2 px-3 py-2 text-left ${
          canExpand ? "hover:bg-red-100/50 dark:hover:bg-red-950/40 cursor-pointer" : "cursor-default"
        } ${isCause ? "" : "opacity-60"}`}
      >
        <span className="w-3.5 mt-0.5 flex-shrink-0">
          {canExpand ? (expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />) : null}
        </span>
        <span className="flex-1">
          <span className={isCause ? "font-semibold" : ""}>{cause.label}</span>
          {isCause ? (
            <span className="block mt-0.5 opacity-90 font-normal">{cause.detail}</span>
          ) : (
            <span className="block mt-0.5 opacity-90 font-normal">Not a cause here — nothing found.</span>
          )}
        </span>
        <span className="font-mono font-semibold whitespace-nowrap">{signed(cause.amount)}</span>
      </button>

      {expanded && (
        <ul className="pb-2">
          {cause.items.map((item) => (
            <li key={`${item.kind}-${item.id}`}>
              <ItemRow item={item} onOpen={item.kind === "entry" ? onOpenEntry : onOpenAccount} />
            </li>
          ))}
          {cause.count > cause.items.length && (
            <li className="px-3 pl-10 py-1 opacity-80">
              …and {cause.count - cause.items.length} more, smaller than those listed.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function ItemRow({ item, onOpen }: { item: ImbalanceItem; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item.id)}
      title={item.kind === "entry" ? "Open this journal entry" : "Open this account in the General Ledger"}
      className="w-full flex items-center gap-3 px-3 pl-10 py-1 text-left hover:bg-red-100/60 dark:hover:bg-red-950/40 focus:outline-none focus:ring-2 focus:ring-red-400/40 rounded"
    >
      <span className="font-mono opacity-80 w-24 flex-shrink-0 truncate">{item.code}</span>
      <span className="flex-1 truncate">{item.label}</span>
      <span className="opacity-70 hidden sm:inline truncate max-w-[10rem]">{item.note}</span>
      <span className="font-mono whitespace-nowrap">{signed(item.amount)}</span>
      <ArrowRight className="w-3 h-3 flex-shrink-0 opacity-60" />
    </button>
  );
}
