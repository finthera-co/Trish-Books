import { useEffect } from "react";
import { useGLVerification, GLCheck } from "@/hooks/useGLVerification";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, XCircle, AlertTriangle, Shield, Loader2,
  RefreshCw, Wrench, ShieldCheck, Database, Link2, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";

const categoryMeta: Record<string, { label: string; icon: React.ElementType }> = {
  core: { label: "Core GL Validation", icon: BookOpen },
  schema: { label: "Schema & Data Quality", icon: Database },
  posting: { label: "Posting Engine", icon: Link2 },
  obe: { label: "Opening Balance Equity", icon: Shield },
  integrity: { label: "Data Integrity", icon: ShieldCheck },
};

const statusIcon: Record<string, React.ReactNode> = {
  pass: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  fail: <XCircle className="w-4 h-4 text-destructive" />,
  warn: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  pending: <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />,
  fixing: <Wrench className="w-4 h-4 animate-pulse text-primary" />,
};

export default function GLVerification() {
  const {
    checks, scanning, fixing, runScan, fixCheck,
    passCount, failCount, warnCount, totalCount, score,
  } = useGLVerification();

  useEffect(() => { runScan(); }, [runScan]);

  const categories = ["core", "schema", "posting", "obe", "integrity"];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">General Ledger Verification</h1>
          <p className="text-sm text-muted-foreground">Scan, validate, and repair your accounting data</p>
        </div>
        <Button onClick={runScan} disabled={scanning} size="sm">
          <RefreshCw className={cn("w-4 h-4 mr-2", scanning && "animate-spin")} />
          {scanning ? "Scanning…" : "Run GL Verification"}
        </Button>
      </div>

      {/* Score Card */}
      {totalCount > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div className={cn(
                "w-16 h-16 rounded-xl flex items-center justify-center text-xl font-bold",
                score === 100 ? "bg-emerald-500/10 text-emerald-500" :
                  score >= 80 ? "bg-amber-500/10 text-amber-500" :
                    "bg-destructive/10 text-destructive"
              )}>
                {score}%
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-3 text-sm">
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">
                    {passCount} Passed
                  </Badge>
                  {warnCount > 0 && (
                    <Badge variant="outline" className="text-amber-500 border-amber-500/30">
                      {warnCount} Warnings
                    </Badge>
                  )}
                  {failCount > 0 && (
                    <Badge variant="destructive">
                      {failCount} Failed
                    </Badge>
                  )}
                </div>
                <Progress value={score} className="h-2" />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Check Categories */}
      {categories.map((cat) => {
        const catChecks = checks.filter((c) => c.category === cat);
        if (catChecks.length === 0) return null;
        const meta = categoryMeta[cat];
        const Icon = meta.icon;
        return (
          <Card key={cat}>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                </div>
                <CardTitle className="text-sm font-semibold">{meta.label}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-0 space-y-1.5">
              {catChecks.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  onFix={() => fixCheck(check.id)}
                  isFixing={fixing === check.id}
                />
              ))}
            </CardContent>
          </Card>
        );
      })}

      {/* Quick Fix Actions */}
      {(failCount > 0 || warnCount > 0) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Wrench className="w-4 h-4" /> Quick Fix Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-2">
              {checks
                .filter((c) => c.fixable && c.status !== "pass" && c.status !== "pending")
                .map((c) => (
                  <Button
                    key={c.id}
                    variant="outline"
                    size="sm"
                    onClick={() => fixCheck(c.id)}
                    disabled={fixing === c.id}
                  >
                    {fixing === c.id ? (
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Wrench className="w-3.5 h-3.5 mr-1.5" />
                    )}
                    {c.fixLabel || `Fix ${c.label}`}
                  </Button>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CheckRow({ check, onFix, isFixing }: { check: GLCheck; onFix: () => void; isFixing: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-xs transition-colors",
        check.status === "pass" && "bg-emerald-500/5",
        check.status === "fail" && "bg-destructive/5",
        check.status === "warn" && "bg-amber-500/5",
        (check.status === "pending" || check.status === "fixing") && "bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <div className="mt-0.5 shrink-0">{statusIcon[check.status]}</div>
        <div className="min-w-0">
          <p className="font-medium text-foreground">{check.label}</p>
          <p className="text-muted-foreground mt-0.5 tabular-nums">{check.detail}</p>
        </div>
      </div>
      {check.fixable && check.status !== "pass" && check.status !== "pending" && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs shrink-0"
          onClick={onFix}
          disabled={isFixing}
        >
          {isFixing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wrench className="w-3 h-3 mr-1" />}
          Fix
        </Button>
      )}
    </div>
  );
}
