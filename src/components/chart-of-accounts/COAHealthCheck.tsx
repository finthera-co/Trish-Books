import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ShieldCheck, AlertTriangle, CheckCircle, ChevronDown, ChevronUp } from "lucide-react";
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES, OPENING_BALANCE_ELIGIBLE_TYPES } from "@/lib/accountTypes";

interface Account {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  account_subtype?: string | null;
  is_active: boolean;
  opening_balance?: number;
  opening_balance_type?: string;
}

interface HealthReport {
  totalAccounts: number;
  activeAccounts: number;
  missingDetailTypes: { type: string; subtype: string }[];
  accountsWithoutSubtype: Account[];
  balanceSheetWithoutOB: Account[];
  typeCoverage: { type: string; count: number; subtypesUsed: string[]; subtypesMissing: string[] }[];
  systemReady: boolean;
}

function runHealthCheck(accounts: Account[]): HealthReport {
  const activeAccounts = accounts.filter((a) => a.is_active);

  // Find which subtypes from master list have no accounts
  const missingDetailTypes: { type: string; subtype: string }[] = [];
  const typeCoverage: HealthReport["typeCoverage"] = [];

  for (const type of ACCOUNT_TYPES) {
    const masterSubtypes = ACCOUNT_SUBTYPES[type] || [];
    const typeAccounts = activeAccounts.filter((a) => a.account_type === type);
    const usedSubtypes = new Set(typeAccounts.map((a) => a.account_subtype).filter(Boolean) as string[]);
    const missing = masterSubtypes.filter((s) => !usedSubtypes.has(s));
    missing.forEach((s) => missingDetailTypes.push({ type, subtype: s }));
    typeCoverage.push({
      type,
      count: typeAccounts.length,
      subtypesUsed: [...usedSubtypes],
      subtypesMissing: missing,
    });
  }

  // Accounts without any subtype assigned
  const accountsWithoutSubtype = activeAccounts.filter((a) => !a.account_subtype);

  // Balance sheet accounts without opening balances
  const balanceSheetWithoutOB = activeAccounts.filter(
    (a) =>
      OPENING_BALANCE_ELIGIBLE_TYPES.includes(a.account_type as any) &&
      (!a.opening_balance || a.opening_balance === 0)
  );

  const systemReady =
    accountsWithoutSubtype.length === 0 && missingDetailTypes.length <= 5;

  return {
    totalAccounts: accounts.length,
    activeAccounts: activeAccounts.length,
    missingDetailTypes,
    accountsWithoutSubtype,
    balanceSheetWithoutOB,
    typeCoverage,
    systemReady,
  };
}

export default function COAHealthCheck({ accounts }: { accounts: Account[] }) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<HealthReport | null>(null);

  const handleRun = () => {
    setReport(runHealthCheck(accounts));
    setOpen(true);
  };

  return (
    <div>
      <Button variant="outline" size="sm" onClick={handleRun}>
        <ShieldCheck className="w-4 h-4 mr-1" /> Health Check
      </Button>

      {open && report && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <ShieldCheck className="w-4 h-4" /> COA Health Report
            </h3>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>

          {/* Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total Accounts" value={report.totalAccounts} />
            <Stat label="Active Accounts" value={report.activeAccounts} />
            <Stat
              label="Without Subtype"
              value={report.accountsWithoutSubtype.length}
              warn={report.accountsWithoutSubtype.length > 0}
            />
            <Stat
              label="Missing Detail Types"
              value={report.missingDetailTypes.length}
              warn={report.missingDetailTypes.length > 10}
            />
          </div>

          {/* System readiness */}
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium ${
              report.systemReady
                ? "bg-success/10 text-success"
                : "bg-warning/10 text-warning"
            }`}
          >
            {report.systemReady ? (
              <CheckCircle className="w-4 h-4" />
            ) : (
              <AlertTriangle className="w-4 h-4" />
            )}
            {report.systemReady
              ? "System is ready — all accounts have detail types assigned"
              : "Action needed — some accounts are missing detail types or subtypes"}
          </div>

          {/* Type coverage */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Coverage by Type
            </h4>
            {report.typeCoverage
              .filter((tc) => tc.count > 0 || tc.subtypesMissing.length > 0)
              .map((tc) => (
                <TypeCoverageRow key={tc.type} data={tc} />
              ))}
          </div>

          {/* Accounts without subtype */}
          {report.accountsWithoutSubtype.length > 0 && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold text-warning uppercase tracking-wide">
                Accounts Missing Detail Type
              </h4>
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {report.accountsWithoutSubtype.slice(0, 10).map((a) => (
                  <li key={a.id}>
                    <span className="font-mono">{a.account_code}</span> — {a.account_name} ({a.account_type})
                  </li>
                ))}
                {report.accountsWithoutSubtype.length > 10 && (
                  <li className="italic">...and {report.accountsWithoutSubtype.length - 10} more</li>
                )}
              </ul>
            </div>
          )}

          {/* Balance sheet without OB */}
          {report.balanceSheetWithoutOB.length > 0 && (
            <CollapsibleSection
              title={`Balance Sheet Accounts Without Opening Balance (${report.balanceSheetWithoutOB.length})`}
              items={report.balanceSheetWithoutOB}
            />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
      <div className={`text-lg font-bold ${warn ? "text-warning" : "text-foreground"}`}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function TypeCoverageRow({ data }: { data: HealthReport["typeCoverage"][0] }) {
  const [expanded, setExpanded] = useState(false);
  const total = data.subtypesUsed.length + data.subtypesMissing.length;
  const pct = total > 0 ? Math.round((data.subtypesUsed.length / total) * 100) : 100;

  return (
    <div className="rounded-lg border border-border p-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-xs"
      >
        <span className="font-medium text-foreground">{data.type}</span>
        <span className="flex items-center gap-2 text-muted-foreground">
          <span>{data.count} accts</span>
          <span className={pct === 100 ? "text-success" : "text-warning"}>
            {pct}% coverage
          </span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 flex flex-wrap gap-1">
          {data.subtypesUsed.map((s) => (
            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-success/10 text-success">
              ✓ {s}
            </span>
          ))}
          {data.subtypesMissing.map((s) => (
            <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              ○ {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({ title, items }: { title: string; items: Account[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1"
      >
        {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {title}
      </button>
      {expanded && (
        <ul className="text-xs text-muted-foreground space-y-0.5 mt-1">
          {items.slice(0, 15).map((a) => (
            <li key={a.id}>
              <span className="font-mono">{a.account_code}</span> — {a.account_name}
            </li>
          ))}
          {items.length > 15 && <li className="italic">...and {items.length - 15} more</li>}
        </ul>
      )}
    </div>
  );
}
