import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import AccountSelector from "@/components/shared/AccountSelector";
import { usePettyCashAccounts } from "@/hooks/usePettyCash";
import { useReclassifySuspenseLines, useSuspenseLines } from "@/hooks/usePettyCashImport";
import { useMyPermissions } from "@/hooks/usePermissions";
import { normalizeKey } from "@/lib/pettyCashImportParser";
import { formatCurrency } from "@/lib/currency";

type SuspenseLine = {
  id: string;
  row_no: number;
  parsed_date: string | null;
  raw_description: string | null;
  raw_account_type: string | null;
  raw_voucher_no: string | null;
  amount: number | null;
  direction: string | null;
  petty_cash_import_batches?: {
    file_name: string;
    petty_cash_accounts?: { account_name: string } | null;
  } | null;
};

export default function PettyCashSuspenseClearing() {
  const [fundId, setFundId] = useState<string>("");
  const [target, setTarget] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});

  const { data: funds } = usePettyCashAccounts();
  const { data: lines, isLoading } = useSuspenseLines(fundId || undefined);
  const reclassify = useReclassifySuspenseLines();
  const { canEdit } = useMyPermissions();

  // Grouped by the normalized account-type key, so a whole class of rows —
  // every "sundry", say — is reclassified in one action rather than one by one.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; lines: SuspenseLine[]; total: number }>();
    for (const l of (lines ?? []) as unknown as SuspenseLine[]) {
      const key = normalizeKey(l.raw_account_type ?? "") || "(blank)";
      const entry = map.get(key) ?? { key, label: l.raw_account_type || "(blank)", lines: [], total: 0 };
      entry.lines.push(l);
      entry.total += Number(l.amount ?? 0) * (l.direction === "in" ? 1 : -1);
      map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.lines.length - a.lines.length);
  }, [lines]);

  const totalLines = (lines ?? []).length;

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Petty Cash Suspense Clearing</h1>
          <p className="page-description">
            Imported rows sitting on the suspense account. Clear these to zero before closing a period.
          </p>
        </div>
        <div className="w-64">
          <Select value={fundId || "all"} onValueChange={(v) => setFundId(v === "all" ? "" : v)}>
            <SelectTrigger>
              <SelectValue placeholder="All funds" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All funds</SelectItem>
              {(funds ?? []).map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.account_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : totalLines === 0 ? (
        <Card>
          <CardContent className="py-8 text-center space-y-1">
            <p className="text-sm font-medium">Nothing in suspense</p>
            <p className="text-xs text-muted-foreground">
              Either no import has fallen through to suspense, or no suspense account is configured yet — see{" "}
              <Link to="/settings/account-mapping" className="underline">
                Settings → Account Mapping
              </Link>
              .
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.key}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <HelpCircle className="w-4 h-4" />
                  {g.label}
                  <Badge variant="secondary" className="text-xs">
                    {g.lines.length} row(s)
                  </Badge>
                  <span className="text-xs font-normal text-muted-foreground ml-auto font-mono">
                    net {formatCurrency(g.total)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="overflow-x-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead className="h-8">Date</TableHead>
                        <TableHead className="h-8">Voucher No.</TableHead>
                        <TableHead className="h-8">Description</TableHead>
                        <TableHead className="h-8">File</TableHead>
                        <TableHead className="h-8 text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.lines.map((l) => (
                        <TableRow key={l.id} className="text-xs">
                          <TableCell className="py-1.5 whitespace-nowrap">{l.parsed_date ?? "—"}</TableCell>
                          <TableCell className="py-1.5">{l.raw_voucher_no}</TableCell>
                          <TableCell className="py-1.5">{l.raw_description}</TableCell>
                          <TableCell className="py-1.5 text-muted-foreground">
                            {l.petty_cash_import_batches?.file_name}
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-mono">
                            {l.direction === "in" ? "+" : "−"}
                            {formatCurrency(Number(l.amount ?? 0))}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {canEdit("banking") && (
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="flex-1 min-w-[240px] space-y-1">
                      <Label className="text-xs">Reclassify all {g.lines.length} to</Label>
                      <AccountSelector
                        value={target[g.key] ?? ""}
                        onChange={(id) => setTarget((t) => ({ ...t, [g.key]: id }))}
                        placeholder="Pick the correct account…"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer pb-2">
                      <Checkbox
                        checked={!!remember[g.key]}
                        onCheckedChange={(c) => setRemember((r) => ({ ...r, [g.key]: c === true }))}
                      />
                      Remember “{g.key}” for next time
                    </label>
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={!target[g.key] || reclassify.isPending}
                      onClick={() =>
                        reclassify.mutate(
                          {
                            lineIds: g.lines.map((l) => l.id),
                            accountId: target[g.key],
                            remember: !!remember[g.key],
                          },
                          {
                            onSuccess: () => {
                              setTarget((t) => ({ ...t, [g.key]: "" }));
                              setRemember((r) => ({ ...r, [g.key]: false }));
                            },
                          },
                        )
                      }
                    >
                      Reclassify
                    </Button>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Reclassifying writes a correcting journal entry. The original vouchers stay exactly as posted —
                  they are the historical record.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
