import { useMemo, useCallback, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, Fingerprint, Wand2 } from "lucide-react";
import { useEmployees } from "@/hooks/useData";
import { useBulkSetBiometricIds } from "@/hooks/useAttendance";
import { useDraftPersistence } from "@/hooks/useDraftPersistence";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { useMyPermissions } from "@/hooks/usePermissions";
import { useAuth } from "@/contexts/AuthContext";

export default function BiometricLinking() {
  const { data: employees } = useEmployees();
  const bulkSet = useBulkSetBiometricIds();
  const { canEdit } = useMyPermissions();
  const allowed = canEdit("payroll");
  const { appUser } = useAuth();
  const scope = appUser ? `${appUser.tenant_id}:${appUser.id}` : undefined;

  const [search, setSearch] = useState("");

  const serverBaseline = useMemo(() => {
    const m: Record<string, string> = {};
    (employees ?? []).forEach((e: any) => { m[e.id] = e.biometric_id ?? ""; });
    return m;
  }, [employees]);

  const {
    value: edits, setValue: setEdits, clearDraft, wasRestored, dismissRestoredNotice,
  } = useDraftPersistence<Record<string, string>>({
    page: "biometric-linking",
    scope,
    initial: {},
  });

  const effective = useCallback(
    (id: string) => (id in edits ? edits[id] : (serverBaseline[id] ?? "")),
    [edits, serverBaseline],
  );
  const setCell = (id: string, v: string) => setEdits((prev) => ({ ...prev, [id]: v }));

  const dirtyIds = useMemo(
    () => Object.keys(edits).filter((id) => (edits[id] ?? "").trim() !== (serverBaseline[id] ?? "").trim()),
    [edits, serverBaseline],
  );

  const duplicateIds = useMemo(() => {
    const byVal: Record<string, string[]> = {};
    (employees ?? []).forEach((e: any) => {
      const v = effective(e.id).trim();
      if (v) (byVal[v] ??= []).push(e.id);
    });
    const dupes = new Set<string>();
    Object.values(byVal).forEach((ids) => { if (ids.length > 1) ids.forEach((id) => dupes.add(id)); });
    return dupes;
  }, [employees, effective]);

  // Name of the other employee a duplicate shares its value with (for the badge).
  const otherDupName = useCallback((id: string): string => {
    const v = effective(id).trim();
    const other = (employees ?? []).find((e: any) => e.id !== id && effective(e.id).trim() === v);
    return other ? `${other.first_name} ${other.last_name}` : "";
  }, [employees, effective]);

  useUnsavedChangesWarning(dirtyIds.length > 0);

  const onSave = async () => {
    const changes = dirtyIds.map((id) => ({ employeeId: id, biometricId: effective(id) }));
    await bulkSet.mutateAsync(changes);
    setEdits({});
    clearDraft();
  };

  const discard = () => { setEdits({}); clearDraft(); dismissRestoredNotice(); };

  const setDeviceFromEmpNo = () => setEdits((prev) => {
    const next = { ...prev };
    (employees ?? []).forEach((e: any) => {
      if (!effective(e.id).trim()) next[e.id] = String(e.employee_number ?? "").replace(/\D/g, "");
    });
    return next;
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (employees ?? []).filter((e: any) => {
      if (!q) return true;
      return `${e.first_name} ${e.last_name}`.toLowerCase().includes(q)
        || (e.employee_number ?? "").toLowerCase().includes(q)
        || effective(e.id).toLowerCase().includes(q);
    });
  }, [employees, search, effective]);

  const linkedCount = useMemo(
    () => Object.values(serverBaseline).filter((v) => (v ?? "").trim()).length,
    [serverBaseline],
  );
  const total = employees?.length ?? 0;
  const saveBlocked = dirtyIds.length === 0 || dirtyIds.some((id) => duplicateIds.has(id)) || !allowed || bulkSet.isPending;

  return (
    <div className="space-y-6 pb-24">
      <div className="page-header">
        <div>
          <h1 className="page-title flex items-center gap-2"><Fingerprint className="w-5 h-5" />Link employees to attendance device</h1>
          <p className="page-description">Enter the AC-No each person is enrolled under on the fingerprint scanner. Match these to your device's user list.</p>
        </div>
        <Badge variant="secondary">{linkedCount}/{total} linked</Badge>
      </div>

      {wasRestored && dirtyIds.length > 0 && (
        <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-2 text-sm">
          <span>Restored {dirtyIds.length} unsaved device ID change(s) from your last session.</span>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={discard}>Discard</Button>
            <Button size="sm" variant="ghost" onClick={dismissRestoredNotice}>Keep</Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-1">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text" placeholder="Search by name, employee no, or device ID..."
                value={search} onChange={(e) => setSearch(e.target.value)}
                className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
              />
            </div>
            {allowed && (
              <Button variant="outline" size="sm" onClick={setDeviceFromEmpNo}>
                <Wand2 className="w-4 h-4" />Set Device ID = Employee No
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="data-table">
              <thead><tr><th>Employee</th><th>Department / Designation</th><th>Device ID</th><th>Status</th></tr></thead>
              <tbody>
                {filtered.map((e: any) => {
                  const val = effective(e.id);
                  const isDirty = dirtyIds.includes(e.id);
                  const isDup = duplicateIds.has(e.id);
                  return (
                    <tr key={e.id}>
                      <td className="font-medium text-foreground whitespace-nowrap">
                        {(e.employee_number ? `${e.employee_number} — ` : "")}{e.first_name} {e.last_name}
                      </td>
                      <td className="text-muted-foreground">{e.designation || e.department || "—"}</td>
                      <td>
                        <Input
                          value={val}
                          disabled={!allowed}
                          onChange={(ev) => setCell(e.id, ev.target.value)}
                          className={`w-40 ${isDup ? "border-destructive" : ""}`}
                          placeholder="AC-No"
                        />
                      </td>
                      <td>
                        {isDup ? (
                          <Badge variant="destructive">Duplicate{otherDupName(e.id) ? ` of ${otherDupName(e.id)}` : ""}</Badge>
                        ) : !val.trim() ? (
                          <Badge variant="outline" className="text-muted-foreground">Not linked</Badge>
                        ) : isDirty ? (
                          <Badge className="bg-sky-600">Changed</Badge>
                        ) : (
                          <Badge className="bg-green-600">Linked</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Sticky save bar */}
      {dirtyIds.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {dirtyIds.length} unsaved change(s)
            {dirtyIds.some((id) => duplicateIds.has(id)) && <span className="text-destructive"> — resolve duplicates to save</span>}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={discard} disabled={bulkSet.isPending}>Discard</Button>
            <Button onClick={onSave} disabled={saveBlocked}>{bulkSet.isPending ? "Saving..." : "Save changes"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
