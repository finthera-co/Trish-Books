import { fetchAccountLedgerAll, type AccountLedgerPageRow } from "@/hooks/useData";
import { exportToCsv } from "@/lib/csvExport";
import { downloadDataExcel, type DataColumn } from "@/lib/reportExcel";
import { isDebitNormal } from "@/lib/accountTypes";
import { formatDate } from "@/lib/format";

interface ExportAccount {
  id: string;
  account_code: string;
  account_name: string;
  account_type: string;
}

interface ExportRow {
  date: string;
  type: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
}

/** account_code + account_name → a safe filename with no extension. */
function baseFileName(account: ExportAccount): string {
  return `${account.account_code}-${account.account_name}-transactions`.replace(/\s+/g, "_");
}

/**
 * Pulls an account's ENTIRE posted history (no date filter — the account's
 * whole window, same "no dateFrom means opening balance is zero" rule the
 * Ledger register relies on) and turns it into export rows with a running
 * balance computed from the server's cumulative sums, in ledger order.
 */
async function buildExportRows(account: ExportAccount): Promise<ExportRow[]> {
  const lines: AccountLedgerPageRow[] = await fetchAccountLedgerAll({
    accountId: account.id,
    sort: "date",
    sortDir: "asc",
  });
  const debitNormal = isDebitNormal(account.account_type);

  return lines.map((line) => ({
    date: formatDate(line.entry_date),
    type: line.txn_type || "Journal Entry",
    description: line.line_memo || line.description || "",
    reference: line.reference || "",
    debit: Number(line.debit) || 0,
    credit: Number(line.credit) || 0,
    balance: debitNormal
      ? Number(line.cum_debit ?? 0) - Number(line.cum_credit ?? 0)
      : Number(line.cum_credit ?? 0) - Number(line.cum_debit ?? 0),
  }));
}

export async function exportAccountTransactionsCsv(account: ExportAccount): Promise<number> {
  const rows = await buildExportRows(account);
  if (rows.length === 0) return 0;

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  exportToCsv(
    `${baseFileName(account)}.csv`,
    ["Date", "Type", "Description", "Reference", "Debit", "Credit", "Balance"],
    [
      ...rows.map((r) => [r.date, r.type, r.description, r.reference, r.debit.toFixed(2), r.credit.toFixed(2), r.balance.toFixed(2)]),
      ["TOTALS", "", "", "", totalDebit.toFixed(2), totalCredit.toFixed(2), rows[rows.length - 1].balance.toFixed(2)],
    ]
  );
  return rows.length;
}

export async function exportAccountTransactionsExcel(account: ExportAccount): Promise<number> {
  const rows = await buildExportRows(account);
  if (rows.length === 0) return 0;

  const columns: DataColumn<ExportRow>[] = [
    { header: "Date", value: (r) => r.date },
    { header: "Type", value: (r) => r.type },
    { header: "Description", value: (r) => r.description },
    { header: "Reference", value: (r) => r.reference },
    { header: "Debit", numeric: true, value: (r) => (r.debit ? r.debit : null) },
    { header: "Credit", numeric: true, value: (r) => (r.credit ? r.credit : null) },
    { header: "Balance", numeric: true, value: (r) => r.balance },
  ];
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  downloadDataExcel(
    {
      title: `${account.account_code} — ${account.account_name}`,
      subtitle: "Account Transactions",
      fileName: `${baseFileName(account)}.xlsx`,
      sheetName: `${account.account_code} ${account.account_name}`,
    },
    columns,
    rows,
    ["TOTALS", "", "", "", totalDebit, totalCredit, rows[rows.length - 1].balance]
  );
  return rows.length;
}
