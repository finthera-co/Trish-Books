import { Badge } from "@/components/ui/badge";

/**
 * Shows where a voucher sits in the imprest lifecycle:
 *   approved + no replenishment  → "Awaiting reimbursement" (amber)
 *   approved + replenishment set  → "Reimbursed" (green)
 * For non-approved vouchers (draft/reversed) nothing is shown — reimbursement
 * only becomes meaningful once the voucher has drained the fund.
 */
export function ReimbursementBadge({
  status,
  replenishmentId,
}: {
  status: string;
  replenishmentId: string | null | undefined;
}) {
  if (status !== "approved") return <span className="text-muted-foreground">—</span>;
  if (replenishmentId) {
    return <Badge className="bg-success/15 text-success hover:bg-success/15">Reimbursed</Badge>;
  }
  return <Badge className="bg-warning/15 text-warning hover:bg-warning/15">Awaiting reimbursement</Badge>;
}
