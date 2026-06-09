import { differenceInCalendarDays } from "date-fns";

export type BillStatus = "draft" | "posted" | "partial" | "paid" | "overdue";

export interface BillWithStatus {
  id: string;
  status: string;
  total_amount: number | string;
  amount_paid: number | string;
  due_date?: string | null;
  [key: string]: any;
}

export function computeBillStatus(bill: BillWithStatus): BillStatus {
  const totalAmount = Number(bill.total_amount);
  const amountPaid = Number(bill.amount_paid ?? 0);
  const balanceDue = totalAmount - amountPaid;

  if (bill.status === "draft") return "draft";
  if (balanceDue <= 0.005 || bill.status === "paid") return "paid";

  const isOverdue =
    bill.due_date &&
    differenceInCalendarDays(new Date(), new Date(bill.due_date)) > 0 &&
    balanceDue > 0.005;

  if (isOverdue) return "overdue";
  if (amountPaid > 0 && amountPaid < totalAmount) return "partial";
  return "posted";
}

export const BILL_STATUS_BADGE: Record<
  BillStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft:   { label: "Draft",   variant: "secondary" },
  posted:  { label: "Unpaid",  variant: "outline" },
  partial: { label: "Partial", variant: "outline" },
  paid:    { label: "Paid",    variant: "default" },
  overdue: { label: "Overdue", variant: "destructive" },
};
