import { useState } from "react";
import { Check, Lightbulb, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AccountSelector from "@/components/shared/AccountSelector";
import {
  useCreatePCExpenseAccount,
  useDeletePCAccountMap,
  usePCAccountSuggestions,
  usePCAccountTypeRegistry,
  usePCTypeTemplate,
  useUnmappedAccountTypes,
  useUpsertPCAccountMap,
  type PCAccountTypeRow,
} from "@/hooks/usePettyCashImport";
import { useMyPermissions } from "@/hooks/usePermissions";
import { normalizeKey } from "@/lib/pettyCashImportParser";

/**
 * One label awaiting a decision. Suggestions are advisory: the row shows the
 * candidates the database found and requires a click to accept one. Nothing
 * here writes on its own.
 */
function MapRow({
  label,
  seenCount,
  onMapped,
  canEdit,
}: {
  label: string;
  seenCount?: number;
  onMapped: () => void;
  canEdit: boolean;
}) {
  const [override, setOverride] = useState("");
  const { data: suggestions, isLoading } = usePCAccountSuggestions(label, 4);
  const upsert = useUpsertPCAccountMap();
  const createAccount = useCreatePCExpenseAccount();

  function map(accountId: string) {
    upsert.mutate(
      { matchType: "account_type", matchKey: normalizeKey(label), accountId, displayLabel: label },
      { onSuccess: onMapped },
    );
  }

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">{label}</span>
        <code className="text-xs text-muted-foreground">{normalizeKey(label)}</code>
        {seenCount !== undefined && (
          <Badge variant="outline" className="text-xs">
            {seenCount} row(s) in imported sheets
          </Badge>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Looking for matching accounts…</p>
      ) : (suggestions ?? []).length === 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Nothing in the chart resembles this label.
          </p>
          {canEdit && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-xs"
              disabled={createAccount.isPending}
              onClick={() =>
                createAccount.mutate(label, { onSuccess: (id) => map(id) })
              }
            >
              <Plus className="w-3 h-3 mr-1" /> Create “{label}” and map it
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lightbulb className="w-3 h-3" /> Suggested — pick one, or choose your own below
          </div>
          {(suggestions ?? []).map((s) => (
            <div key={s.account_id} className="flex items-center gap-2 text-xs">
              <Badge
                variant="outline"
                className={
                  s.confidence >= 0.9
                    ? "border-success/40 text-success"
                    : s.confidence >= 0.6
                      ? "border-warning/40 text-warning"
                      : "text-muted-foreground"
                }
              >
                {Math.round(Number(s.confidence) * 100)}%
              </Badge>
              <span className="font-mono">{s.account_code}</span>
              <span className="flex-1">{s.account_name}</span>
              <span className="text-muted-foreground hidden md:inline">{s.reason}</span>
              {canEdit && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  disabled={upsert.isPending}
                  onClick={() => map(s.account_id)}
                >
                  <Check className="w-3 h-3 mr-1" /> Use
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1 min-w-[220px]">
            <Label className="text-xs">Or map to</Label>
            <AccountSelector value={override} onChange={(id) => setOverride(id)} placeholder="Any account…" />
          </div>
          <Button
            size="sm"
            className="h-8"
            disabled={!override || upsert.isPending}
            onClick={() => map(override)}
          >
            Map
          </Button>
        </div>
      )}
    </div>
  );
}

export default function PettyCashAccountTypes() {
  const { data: registry, isLoading } = usePCAccountTypeRegistry();
  const { data: template } = usePCTypeTemplate();
  const { data: unmapped } = useUnmappedAccountTypes();
  const { canEdit } = useMyPermissions();
  const deleteMap = useDeletePCAccountMap();

  const [newLabel, setNewLabel] = useState("");
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<PCAccountTypeRow | null>(null);

  const mapped = registry ?? [];
  const mappedKeys = new Set(mapped.map((r) => r.match_key));
  const editable = canEdit("banking");

  // Template labels this tenant has not mapped yet — offered, never applied.
  const templateTodo = (template ?? [])
    .map((t) => t.label)
    .filter((l) => !mappedKeys.has(normalizeKey(l)));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Petty Cash Account Types</h1>
          <p className="page-description">
            What each “Account Type” in your petty cash book posts to. Every company words these
            differently, so this list is yours alone.
          </p>
        </div>
      </div>

      {/* Labels seen in real sheets but not yet mapped — the most urgent list,
          because these are the rows currently landing in suspense. */}
      {(unmapped ?? []).length > 0 && (
        <Card className="border-warning/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-warning" />
              Seen in your sheets, not yet mapped
              <Badge variant="secondary">{unmapped!.length}</Badge>
            </CardTitle>
            <CardDescription className="text-xs">
              These account types appeared in imported files with nowhere to post. Until they are
              mapped, rows carrying them go to suspense.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {unmapped!.map((u) => (
              <MapRow
                key={u.key}
                label={u.label}
                seenCount={u.count}
                canEdit={editable}
                onMapped={() => undefined}
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Your account types</CardTitle>
          <CardDescription className="text-xs">
            The import engine matches on the normalized key, so “Postage &amp; Courier”,
            “postage and courier” and “POSTAGE / COURIER” are all the same entry.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {editable && (
            <div className="flex items-end gap-2">
              <div className="flex-1 max-w-sm space-y-1">
                <Label className="text-xs">Add an account type</Label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="e.g. Fuel Charges"
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newLabel.trim()) setPendingLabel(newLabel.trim());
                  }}
                />
              </div>
              <Button
                size="sm"
                className="h-8"
                disabled={!newLabel.trim() || mappedKeys.has(normalizeKey(newLabel))}
                onClick={() => setPendingLabel(newLabel.trim())}
              >
                <Plus className="w-3 h-3 mr-1" /> Add
              </Button>
              {mappedKeys.has(normalizeKey(newLabel)) && newLabel.trim() !== "" && (
                <span className="text-xs text-muted-foreground pb-2">Already mapped.</span>
              )}
            </div>
          )}

          {pendingLabel && (
            <MapRow
              label={pendingLabel}
              canEdit={editable}
              onMapped={() => {
                setPendingLabel(null);
                setNewLabel("");
              }}
            />
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : mapped.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing mapped yet. Add the types your petty cash book uses, or start from the common
              list below.
            </p>
          ) : (
            <div className="overflow-x-auto border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="h-8">Account type</TableHead>
                    <TableHead className="h-8">Matches on</TableHead>
                    <TableHead className="h-8">Posts to</TableHead>
                    <TableHead className="h-8 text-right">Rows seen</TableHead>
                    <TableHead className="h-8 text-right">Times used</TableHead>
                    <TableHead className="h-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mapped.map((r) => (
                    <TableRow key={r.id} className="text-xs">
                      <TableCell className="py-1.5 font-medium">{r.display_label}</TableCell>
                      <TableCell className="py-1.5">
                        <code className="text-muted-foreground">{r.match_key}</code>
                        {r.match_type === "description" && (
                          <Badge variant="outline" className="ml-1 text-xs">
                            description
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="py-1.5">
                        <span className="font-mono">{r.account_code}</span> {r.account_name}
                        <span className="text-muted-foreground ml-1">({r.account_type})</span>
                      </TableCell>
                      <TableCell className="py-1.5 text-right">{r.seen_in_imports}</TableCell>
                      <TableCell className="py-1.5 text-right">{r.hit_count}</TableCell>
                      <TableCell className="py-1.5 text-right">
                        {editable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs text-destructive"
                            onClick={() => setToDelete(r)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {templateTodo.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Common petty cash types</CardTitle>
            <CardDescription className="text-xs">
              A starting list. Nothing is added until you map it — your chart is never changed
              behind your back.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {templateTodo.map((label) => (
              <MapRow key={label} label={label} canEdit={editable} onMapped={() => undefined} />
            ))}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this account type?</AlertDialogTitle>
            <AlertDialogDescription>
              “{toDelete?.display_label}” will no longer resolve automatically, and future rows
              carrying it will fall through to suspense until it is mapped again. Nothing already
              posted is affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                toDelete && deleteMap.mutate(toDelete.id, { onSuccess: () => setToDelete(null) })
              }
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
