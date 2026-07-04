import { useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSerialRegister } from "@/hooks/useSerialRegister";

const statusBadge = (s: string) =>
  s === "issued" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
  : s === "cancelled" ? "bg-destructive/10 text-destructive"
  : "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400";

export default function InvoiceSerialRegister() {
  const navigate = useNavigate();
  const { data: groups, isLoading } = useSerialRegister();

  const totalMissing = (groups ?? []).reduce((s, g) => s + g.missing.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><ShieldCheck className="w-6 h-6 text-primary" /> Invoice Number Register</h1>
          <p className="text-sm text-muted-foreground">Every system-generated IRD serial, accounted for — issued, reserved, or cancelled</p>
        </div>
      </div>

      {/* Compliance banner */}
      <div className={`rounded-lg border px-4 py-3 flex items-center gap-2 text-sm ${totalMissing === 0
        ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
        : "border-destructive/30 bg-destructive/10 text-destructive"}`}>
        {totalMissing === 0
          ? <><CheckCircle2 className="w-4 h-4" /> Every issued number is accounted for — no unexplained gaps in the sequence.</>
          : <><AlertTriangle className="w-4 h-4" /> {totalMissing} number(s) are missing from the sequence and need investigation.</>}
      </div>

      {isLoading ? (
        <p className="text-center py-8 text-muted-foreground">Loading…</p>
      ) : (groups ?? []).length === 0 ? (
        <p className="text-center py-8 text-muted-foreground">No invoice numbers issued yet</p>
      ) : (
        (groups ?? []).map((g) => (
          <Card key={g.key}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Branch {g.branch_code} · {g.mmm} 20{String(g.yy).padStart(2, "0")}</CardTitle>
                <div className="flex items-center gap-2 text-xs">
                  <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">{g.issued} issued</Badge>
                  {g.reserved > 0 && <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">{g.reserved} reserved</Badge>}
                  {g.cancelled > 0 && <Badge className="bg-destructive/10 text-destructive">{g.cancelled} cancelled</Badge>}
                  {g.missing.length > 0 && <Badge className="bg-destructive/10 text-destructive">gap: {g.missing.join(", ")}</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow>
                  <TableHead className="w-16">Seq</TableHead><TableHead>Serial</TableHead>
                  <TableHead>Status</TableHead><TableHead>Reason</TableHead><TableHead>Recorded</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {g.rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-muted-foreground tabular-nums">{r.seq}</TableCell>
                      <TableCell className="font-mono font-medium">{r.serial}</TableCell>
                      <TableCell><Badge className={statusBadge(r.status)}>{r.status}</Badge></TableCell>
                      <TableCell className="text-muted-foreground">{r.reason || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
