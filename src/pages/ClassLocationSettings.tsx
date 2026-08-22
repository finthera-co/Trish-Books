import { useState } from "react";
import { Plus, Pencil, Tag, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAccountSettings, useUpsertAccountSettings } from "@/hooks/useAccountSettings";
import { useCostCenters, useSaveCostCenter, useLocations, useSaveLocation, type CostCenter, type Location } from "@/hooks/useDimensions";

export default function ClassLocationSettings() {
  const { data: settings } = useAccountSettings();
  const upsertSettings = useUpsertAccountSettings();

  const { data: costCenters, isLoading: loadingCC } = useCostCenters(true);
  const saveCostCenter = useSaveCostCenter();
  const { data: locations, isLoading: loadingLoc } = useLocations(true);
  const saveLocation = useSaveLocation();

  const [ccDialog, setCcDialog] = useState<CostCenter | null | "new">(null);
  const [ccName, setCcName] = useState("");
  const [ccDesc, setCcDesc] = useState("");

  const [locDialog, setLocDialog] = useState<Location | null | "new">(null);
  const [locName, setLocName] = useState("");

  const [locationLabel, setLocationLabel] = useState(settings?.location_label || "Location");

  const openCcDialog = (cc: CostCenter | "new") => {
    setCcDialog(cc);
    setCcName(cc === "new" ? "" : cc.name);
    setCcDesc(cc === "new" ? "" : cc.description || "");
  };
  const saveCc = async () => {
    if (!ccName.trim()) return;
    await saveCostCenter.mutateAsync({
      id: ccDialog !== "new" && ccDialog ? ccDialog.id : undefined,
      name: ccName.trim(),
      description: ccDesc || null,
    });
    setCcDialog(null);
  };

  const openLocDialog = (loc: Location | "new") => {
    setLocDialog(loc);
    setLocName(loc === "new" ? "" : loc.name);
  };
  const saveLoc = async () => {
    if (!locName.trim()) return;
    await saveLocation.mutateAsync({
      id: locDialog !== "new" && locDialog ? locDialog.id : undefined,
      name: locName.trim(),
    });
    setLocDialog(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Classes &amp; Locations</h1>
        <p className="text-sm text-muted-foreground">
          Tag transactions by business segment (Class) or physical site (Location) — the same dimension tracking QuickBooks offers.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Tracking Settings</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Track Classes</Label>
              <p className="text-xs text-muted-foreground">Shows a Class column on Write Checks, Enter Bills, and Journal Entry lines.</p>
            </div>
            <Switch
              checked={!!settings?.class_tracking_enabled}
              onCheckedChange={(v) => upsertSettings.mutate({ class_tracking_enabled: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Track Locations</Label>
              <p className="text-xs text-muted-foreground">Shows a {settings?.location_label || "Location"} field on the header of those transactions.</p>
            </div>
            <Switch
              checked={!!settings?.location_tracking_enabled}
              onCheckedChange={(v) => upsertSettings.mutate({ location_tracking_enabled: v })}
            />
          </div>
          {settings?.location_tracking_enabled && (
            <div className="flex items-end gap-2 max-w-sm">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Label for "Location"</Label>
                <Input value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} placeholder="Location / Branch / Store / Division" />
              </div>
              <Button size="sm" variant="outline" onClick={() => upsertSettings.mutate({ location_label: locationLabel || "Location" })}>
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><Tag className="w-4 h-4" /> Classes</CardTitle>
            <CardDescription>Business segments or product lines used to tag P&amp;L transactions.</CardDescription>
          </div>
          <Button size="sm" onClick={() => openCcDialog("new")}><Plus className="w-4 h-4 mr-1" /> New Class</Button>
        </CardHeader>
        <CardContent>
          {loadingCC ? (
            <p className="text-sm text-muted-foreground py-4">Loading…</p>
          ) : !costCenters?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No classes yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Status</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
              <TableBody>
                {costCenters.map((cc) => (
                  <TableRow key={cc.id}>
                    <TableCell className="font-medium">{cc.name}</TableCell>
                    <TableCell className="text-muted-foreground">{cc.description || "—"}</TableCell>
                    <TableCell><Badge variant={cc.is_active ? "default" : "secondary"}>{cc.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => openCcDialog(cc)}><Pencil className="w-3.5 h-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><MapPin className="w-4 h-4" /> Locations</CardTitle>
            <CardDescription>Physical sites, branches, or stores used to tag whole transactions.</CardDescription>
          </div>
          <Button size="sm" onClick={() => openLocDialog("new")}><Plus className="w-4 h-4 mr-1" /> New Location</Button>
        </CardHeader>
        <CardContent>
          {loadingLoc ? (
            <p className="text-sm text-muted-foreground py-4">Loading…</p>
          ) : !locations?.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No locations yet.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
              <TableBody>
                {locations.map((loc) => (
                  <TableRow key={loc.id}>
                    <TableCell className="font-medium">{loc.name}</TableCell>
                    <TableCell><Badge variant={loc.is_active ? "default" : "secondary"}>{loc.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => openLocDialog(loc)}><Pencil className="w-3.5 h-3.5" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!ccDialog} onOpenChange={(v) => !v && setCcDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{ccDialog === "new" ? "New Class" : "Edit Class"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={ccName} onChange={(e) => setCcName(e.target.value)} /></div>
            <div><Label>Description</Label><Input value={ccDesc} onChange={(e) => setCcDesc(e.target.value)} /></div>
            {ccDialog !== "new" && ccDialog && (
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={ccDialog.is_active} onCheckedChange={(v) => saveCostCenter.mutate({ id: ccDialog.id, name: ccDialog.name, description: ccDialog.description, is_active: v })} />
              </div>
            )}
            <Button className="w-full" onClick={saveCc} disabled={saveCostCenter.isPending || !ccName.trim()}>
              {saveCostCenter.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!locDialog} onOpenChange={(v) => !v && setLocDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{locDialog === "new" ? "New Location" : "Edit Location"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={locName} onChange={(e) => setLocName(e.target.value)} /></div>
            {locDialog !== "new" && locDialog && (
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={locDialog.is_active} onCheckedChange={(v) => saveLocation.mutate({ id: locDialog.id, name: locDialog.name, is_active: v })} />
              </div>
            )}
            <Button className="w-full" onClick={saveLoc} disabled={saveLocation.isPending || !locName.trim()}>
              {saveLocation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
