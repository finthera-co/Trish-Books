import { useMemo, useState } from "react";
import { Wand2, Plus, Trash2, Lightbulb, Loader2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCurrency } from "@/lib/currency";
import { normalizeText } from "@/lib/bankCategorization";
import { useAccounts } from "@/hooks/useData";
import {
  useCategorizationRules,
  useUpsertCategorizationRule,
  useDeleteCategorizationRule,
  useSuggestedRuleCandidates,
  type CategorizationRuleRow,
} from "@/hooks/useBankStatementImport";

type Draft = {
  id?: string;
  match_field: "description" | "name";
  match_value: string;
  account_id: string;
  expected_side: "debit" | "credit" | "either";
  priority: number;
  is_active: boolean;
};

const EMPTY: Draft = {
  match_field: "description", match_value: "", account_id: "",
  expected_side: "either", priority: 100, is_active: true,
};

export default function BankImportRules() {
  const { data: rules, isLoading } = useCategorizationRules();
  const { data: accounts } = useAccounts();
  const upsert = useUpsertCategorizationRule();
  const del = useDeleteCategorizationRule();
  const candidates = useSuggestedRuleCandidates();

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const postable = useMemo(
    () => (accounts || []).filter((a: any) => a.is_active && a.is_postable && !a.is_control_account),
    [accounts]
  );
  const acctLabel = (id: string) => {
    const a = (accounts || []).find((x: any) => x.id === id);
    return a ? `${a.account_code} — ${a.account_name}` : "—";
  };

  // Two active rules with the same match text AND priority make every matching
  // line ambiguous; the engine refuses to guess and sends them all to Suspense.
  const conflicts = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rules ?? []) {
      if (!r.is_active) continue;
      const k = `${r.match_field}|${r.match_value}|${r.priority}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  }, [rules]);

  function edit(r: CategorizationRuleRow) {
    setDraft({ ...r });
    setOpen(true);
  }
  function fromCandidate(c: { match_value: string; side: "debit" | "credit" | "either" }) {
    setDraft({ ...EMPTY, match_value: c.match_value, expected_side: c.side });
    setOpen(true);
  }
  async function save() {
    await upsert.mutateAsync(draft);
    setOpen(false);
    setDraft(EMPTY);
  }

  const preview = normalizeText(draft.match_value);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Wand2 className="w-6 h-6 text-primary" /> Bank Import Rules
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Rules resolve statement rows that carry <strong>no Account Type</strong> — cash deposits, transfers,
            customer receipts. Matching is exact on normalized text, never fuzzy: a row either matches a rule and
            posts to that account, or it goes to Suspense.
          </p>
        </div>
        <Button onClick={() => { setDraft(EMPTY); setOpen(true); }} className="shrink-0">
          <Plus className="w-4 h-4 mr-2" /> New rule
        </Button>
      </div>

      {conflicts.size > 0 && (
        <Alert variant="destructive">
          <Info className="h-4 w-4" />
          <AlertTitle>{conflicts.size} conflicting rule group(s)</AlertTitle>
          <AlertDescription>
            Two or more active rules share the same match text <em>and</em> priority. The engine will not pick
            between them — every matching line goes to Suspense. Give one a lower priority number to break the tie.
          </AlertDescription>
        </Alert>
      )}

      {candidates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-500" /> Suggested from Suspense
            </CardTitle>
            <CardDescription>
              Descriptions currently stuck in Suspense with no rule, most frequent first. Creating a rule clears
              this text on every future import.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Occurrences</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="w-28" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.slice(0, 15).map((c) => (
                  <TableRow key={c.match_value}>
                    <TableCell className="font-mono text-sm">{c.match_value}</TableCell>
                    <TableCell className="text-right font-medium">{c.count}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatCurrency(c.value)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" onClick={() => fromCandidate(c)}>Create rule</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (rules ?? []).length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <Wand2 className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">
                No rules yet. Until one exists, every row without an Account Type goes to Suspense.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Match on</TableHead>
                  <TableHead>Exact text (normalized)</TableHead>
                  <TableHead>Posts to</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead className="text-right">Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {(rules ?? []).map((r) => {
                  const conflicted = conflicts.has(`${r.match_field}|${r.match_value}|${r.priority}`);
                  return (
                    <TableRow key={r.id} className={conflicted ? "bg-destructive/5" : undefined}>
                      <TableCell className="text-muted-foreground text-sm">{r.match_field}</TableCell>
                      <TableCell className="font-mono text-sm">
                        {r.match_value}
                        {conflicted && <Badge variant="destructive" className="ml-2 text-xs">conflict</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">{acctLabel(r.account_id)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{r.expected_side}</Badge></TableCell>
                      <TableCell className="text-right font-mono text-sm">{r.priority}</TableCell>
                      <TableCell>
                        <Badge variant={r.is_active ? "default" : "secondary"}>
                          {r.is_active ? "Active" : "Off"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => edit(r)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => del.mutate(r.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{draft.id ? "Edit rule" : "New rule"}</DialogTitle>
            <DialogDescription>
              The text must match the statement row exactly after normalization (lowercased, whitespace collapsed,
              trailing punctuation stripped). Partial and fuzzy matches are deliberately not supported.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-sm">Match on</Label>
                <Select value={draft.match_field}
                  onValueChange={(v) => setDraft({ ...draft, match_field: v as Draft["match_field"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="description">Description</SelectItem>
                    <SelectItem value="name">Name</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Expected side</Label>
                <Select value={draft.expected_side}
                  onValueChange={(v) => setDraft({ ...draft, expected_side: v as Draft["expected_side"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="either">Either</SelectItem>
                    <SelectItem value="debit">Debit (money out)</SelectItem>
                    <SelectItem value="credit">Credit (money in)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-sm">Exact text</Label>
              <Input value={draft.match_value} placeholder="e.g. cash deposit"
                onChange={(e) => setDraft({ ...draft, match_value: e.target.value })} />
              {draft.match_value && (
                <p className="text-xs text-muted-foreground mt-1">
                  Stored and matched as <span className="font-mono">{preview || "—"}</span>
                </p>
              )}
            </div>

            <div>
              <Label className="text-sm">Posts to account</Label>
              <Select value={draft.account_id} onValueChange={(v) => setDraft({ ...draft, account_id: v })}>
                <SelectTrigger><SelectValue placeholder="Choose an account…" /></SelectTrigger>
                <SelectContent>
                  {postable.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.account_code} — {a.account_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <Label className="text-sm">Priority</Label>
                <Input type="number" value={draft.priority}
                  onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) })} />
                <p className="text-xs text-muted-foreground mt-1">Lower wins. Ties go to Suspense.</p>
              </div>
              <label className="flex items-center gap-2 pb-2">
                <Switch checked={draft.is_active}
                  onCheckedChange={(v) => setDraft({ ...draft, is_active: v })} />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={!preview || !draft.account_id || upsert.isPending}>
              {upsert.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving…</> : "Save rule"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
