import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { MapPin, LocateFixed, LogIn, LogOut, RefreshCw, ExternalLink, Loader2 } from "lucide-react";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import {
  useMyOpenVisit, useMyFieldVisits, useFieldCheckIn, useFieldCheckOut,
  useFieldAttendanceSettings, getCurrentLocation, mapLink, type GeoFix,
} from "@/hooks/useFieldVisits";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatDate, formatTime } from "@/lib/format";

function fmtDuration(fromIso: string, toMs: number) {
  const secs = Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${h > 0 ? `${h}h ` : ""}${m}m ${String(s).padStart(2, "0")}s`;
}

export default function FieldCheckIn() {
  const { data: me } = useMyEmployee();
  const { data: openVisit } = useMyOpenVisit(me?.id);
  const { data: visits } = useMyFieldVisits(me?.id);
  const checkIn = useFieldCheckIn();
  const checkOut = useFieldCheckOut();
  const { data: fieldPolicy } = useFieldAttendanceSettings();

  const [geo, setGeo] = useState<GeoFix | null>(null);
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [client, setClient] = useState("");
  const [notes, setNotes] = useState("");
  const [now, setNow] = useState(Date.now());

  // Live ticking clock for the elapsed timer.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const locate = async () => {
    setLocating(true); setGeoErr(null);
    try { setGeo(await getCurrentLocation()); }
    catch (e: any) { setGeoErr(e.message); setGeo(null); }
    finally { setLocating(false); }
  };

  // Grab location once on load.
  useEffect(() => { locate(); /* eslint-disable-next-line */ }, []);

  const doCheckIn = async () => {
    let fix = geo;
    if (!fix) { try { fix = await getCurrentLocation(); setGeo(fix); } catch (e: any) { toast.error(e.message); return; } }
    await checkIn.mutateAsync({ ...fix, client_name: client, notes });
    setClient(""); setNotes("");
  };

  const doCheckOut = async () => {
    if (!openVisit) return;
    let fix = geo;
    if (!fix) { try { fix = await getCurrentLocation(); setGeo(fix); } catch { /* allow checkout without a fresh fix */ } }
    await checkOut.mutateAsync({ visit_id: openVisit.id, ...(fix ?? {}) });
  };

  const inLink = useMemo(() => geo ? mapLink(geo.lat, geo.lng) : null, [geo]);

  // Late-cutoff policy banner. Compares the cutoff to the current Asia/Colombo
  // time (the server uses that zone to stamp the check-in), re-evaluated each tick.
  const cutoffInfo = useMemo(() => {
    if (!fieldPolicy?.late_cutoff_enabled || !fieldPolicy.late_cutoff_time) return null;
    const cutoff = fieldPolicy.late_cutoff_time.slice(0, 5);
    const nowColombo = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Colombo", hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(now));
    return { cutoff, isLate: nowColombo > cutoff };
  }, [fieldPolicy, now]);

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Field Check-in</h1>
        <p className="text-sm text-muted-foreground">Mark attendance from a client site — your location is captured as proof.</p>
      </div>

      {cutoffInfo && !openVisit && (
        <div className={`rounded-xl border p-3 text-sm flex items-start gap-2 ${
          cutoffInfo.isLate
            ? "border-rose-300 bg-rose-50 text-rose-800 dark:bg-rose-950/20 dark:text-rose-300"
            : "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300"}`}>
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {cutoffInfo.isLate
              ? `It's past the ${cutoffInfo.cutoff} cutoff — checking in now will be recorded as absent for today.`
              : `Check in by ${cutoffInfo.cutoff} to be marked present. Later check-ins count as absent.`}
          </span>
        </div>
      )}

      {/* Live location — animated map / radar */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="relative h-56 overflow-hidden bg-gradient-to-br from-indigo-500/15 via-sky-500/10 to-emerald-500/15">
          {geo && !locating ? (
            /* Real Google Map of the captured location (no API key — embed URL) */
            <iframe
              key={`${geo.lat!.toFixed(5)},${geo.lng!.toFixed(5)}`}
              title="Captured location"
              className="absolute inset-0 w-full h-full border-0 animate-fade-in"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={`https://maps.google.com/maps?q=${geo.lat},${geo.lng}&z=16&output=embed`}
            />
          ) : (
            <>
              {/* panning map grid */}
              <div className="absolute inset-0 animate-map-pan opacity-[0.5] dark:opacity-30 [background-image:linear-gradient(to_right,hsl(var(--border))_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border))_1px,transparent_1px)] [background-size:28px_28px]" />
              <div className="absolute inset-0 opacity-60">
                <div className="absolute left-0 right-0 top-1/2 h-1.5 -translate-y-1/2 bg-background/70" />
                <div className="absolute top-0 bottom-0 left-[38%] w-1.5 bg-background/70" />
                <div className="absolute top-0 bottom-0 left-[72%] w-1 bg-background/50" />
              </div>
              {/* center radar while acquiring */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                {locating ? (
                  <>
                    <span className="absolute left-1/2 top-1/2 w-24 h-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/30 animate-radar-ping" />
                    <span className="absolute left-1/2 top-1/2 w-24 h-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/20 animate-radar-ping [animation-delay:0.6s]" />
                    <span className="absolute left-1/2 top-1/2 w-24 h-24 -translate-x-1/2 -translate-y-1/2 rounded-full animate-radar-sweep [background:conic-gradient(from_0deg,transparent_0deg,hsl(var(--primary)/0.35)_40deg,transparent_70deg)]" />
                    <LocateFixed className="relative w-8 h-8 text-indigo-600 dark:text-indigo-300" />
                  </>
                ) : (
                  <MapPin className="w-9 h-9 text-destructive/70" />
                )}
              </div>
            </>
          )}

          {/* status pill */}
          <div className="absolute left-3 top-3 z-10 px-2.5 py-1 rounded-full bg-background/85 backdrop-blur text-[11px] font-medium flex items-center gap-1.5 shadow-sm">
            {locating ? (
              <><Loader2 className="w-3 h-3 animate-spin text-indigo-600" /> Acquiring location…</>
            ) : geo ? (
              <><span className="w-2 h-2 rounded-full bg-emerald-500" /> Location locked</>
            ) : (
              <><span className="w-2 h-2 rounded-full bg-destructive" /> Location unavailable</>
            )}
          </div>
        </div>

        {/* coords + actions */}
        <div className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">Your location</p>
            {geo ? (
              <p className="text-xs text-muted-foreground truncate">
                {geo.lat!.toFixed(5)}, {geo.lng!.toFixed(5)} · ±{Math.round(geo.accuracy ?? 0)}m accuracy
              </p>
            ) : (
              <p className="text-xs text-muted-foreground truncate">{locating ? "Pinpointing your position…" : (geoErr ?? "Tap refresh to try again")}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {inLink && (
              <a href={inLink} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1">
                <ExternalLink className="w-3 h-3" /> Map
              </a>
            )}
            <Button variant="outline" size="sm" onClick={locate} disabled={locating}>
              <RefreshCw className={`w-3.5 h-3.5 ${locating ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Active session OR check-in */}
      {openVisit ? (
        <div className="rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> ON A FIELD VISIT
            </span>
            <span className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">
              {fmtDuration(openVisit.check_in_at, now)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted-foreground">Client / Site</p><p className="font-medium text-foreground">{openVisit.client_name || "—"}</p></div>
            <div><p className="text-xs text-muted-foreground">Checked in</p><p className="font-medium text-foreground">{formatTime(openVisit.check_in_at)}</p></div>
            {openVisit.notes && <div className="col-span-2"><p className="text-xs text-muted-foreground">Notes</p><p className="text-foreground">{openVisit.notes}</p></div>}
            {mapLink(openVisit.check_in_lat, openVisit.check_in_lng) && (
              <div className="col-span-2">
                <a href={mapLink(openVisit.check_in_lat, openVisit.check_in_lng)!} target="_blank" rel="noreferrer" className="text-xs text-primary inline-flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Check-in location
                </a>
              </div>
            )}
          </div>
          <Button className="w-full" size="lg" variant="destructive" onClick={doCheckOut} disabled={checkOut.isPending}>
            <LogOut className="w-4 h-4" /> {checkOut.isPending ? "Checking out…" : "Check Out"}
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-sm p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Start a field visit</h2>
          <div className="grid gap-4">
            <div>
              <Label>Client / Site name</Label>
              <Input value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Acme Pvt Ltd — Colombo" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Purpose of the visit" />
            </div>
          </div>
          <Button className="w-full" size="lg" onClick={doCheckIn} disabled={checkIn.isPending}>
            <LogIn className="w-4 h-4" /> {checkIn.isPending ? "Checking in…" : "Check In"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">Today will be marked as a field-work day on your attendance.</p>
        </div>
      )}

      {/* Recent visits */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-border"><h2 className="text-sm font-semibold text-foreground">Recent visits</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground bg-muted/50">
                <th className="px-5 py-2.5 font-medium">Date</th>
                <th className="px-5 py-2.5 font-medium">Client</th>
                <th className="px-5 py-2.5 font-medium">In</th>
                <th className="px-5 py-2.5 font-medium">Out</th>
                <th className="px-5 py-2.5 font-medium text-right">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {!visits?.length ? (
                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">No field visits yet.</td></tr>
              ) : visits.map((v) => {
                const link = mapLink(v.check_in_lat, v.check_in_lng);
                return (
                  <tr key={v.id}>
                    <td className="px-5 py-2.5 text-foreground">{formatDate(v.visit_date)}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{v.client_name || "—"}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{formatTime(v.check_in_at)}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{v.check_out_at ? formatTime(v.check_out_at) : <span className="text-emerald-600">Active</span>}</td>
                    <td className="px-5 py-2.5 text-right">
                      {link ? <a href={link} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /></a> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
