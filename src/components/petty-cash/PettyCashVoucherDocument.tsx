import { formatCurrency } from "@/lib/currency";
import { amountInWords } from "@/lib/numberToWords";
import { formatInvoiceDate as formatDocDate } from "@/lib/format";

export interface VoucherLineModel {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  accountCode?: string | null;
  accountName?: string | null;
}

export interface VoucherModel {
  voucherNumber: string;
  date: string;
  paidTo: string | null;
  fundName?: string | null;
  status: string;
  totalAmount: number;
  preparedBy?: string | null;
  authorizedBy?: string | null;
  approvedAt?: string | null;
  reversedAt?: string | null;
  reference?: string | null;
  lines: VoucherLineModel[];
  currency?: string;
}

/** Stamped across the document when the voucher no longer stands. */
function statusStamp(status: string, reversedAt?: string | null): { label: string; tone: string } | null {
  if (reversedAt || status === "reversed") return { label: "REVERSED", tone: "border-red-600 text-red-600" };
  if (status === "approved") return { label: "APPROVED", tone: "border-green-700 text-green-700" };
  if (status === "rejected") return { label: "REJECTED", tone: "border-red-600 text-red-600" };
  if (status === "pending") return { label: "PENDING APPROVAL", tone: "border-amber-600 text-amber-600" };
  return { label: "DRAFT", tone: "border-neutral-400 text-neutral-500" };
}

/**
 * The petty cash voucher as the paper document it stands in for — company
 * lockup, voucher number and date, who was paid, the particulars, the amount in
 * words, and the three signatures a voucher is not valid without.
 *
 * Rendered identically on screen and on paper. The signature block used to be
 * `hidden print:grid`, so what you reviewed on screen was not the document you
 * were signing; anyone checking a voucher had to print it to see its real
 * shape. Fixed white background and neutral colours for the same reason — the
 * document must not change appearance with the app's theme.
 */
export default function PettyCashVoucherDocument({
  model,
  company,
}: {
  model: VoucherModel;
  company?: {
    company_name?: string | null;
    address?: string | null;
    phone?: string | null;
    tax_id?: string | null;
    logo_url?: string | null;
  } | null;
}) {
  const cur = model.currency || "LKR";
  const wordsUnit = cur === "LKR" ? "Rupees" : cur;
  const total = Number(model.totalAmount) || 0;
  const stamp = statusStamp(model.status, model.reversedAt);

  const meta: [string, string][] = [
    ["Voucher Date", model.date ? formatDocDate(model.date) : "—"],
    ["Fund", model.fundName || "—"],
  ];
  if (model.reference) meta.push(["Reference", model.reference]);
  if (model.approvedAt) meta.push(["Approved", formatDocDate(model.approvedAt)]);

  return (
    <div id="pcv-doc" className="bg-white text-neutral-900 w-full text-sm">
      <div className="h-[6px] bg-[#0b3b60]" />

      <div className="p-8">
        {/* Company lockup · document type, number and standing */}
        <div className="flex items-start justify-between gap-6 pb-5 border-b border-neutral-200">
          <div className="flex items-start gap-4">
            {company?.logo_url ? (
              <img src={company.logo_url} alt="" className="h-20 max-w-[150px] object-contain" />
            ) : (
              <div className="h-20 w-20 rounded-lg bg-neutral-100 flex items-center justify-center text-neutral-400 text-xs">
                Logo
              </div>
            )}
            <div>
              <h2 className="text-lg font-bold">{company?.company_name || "Your Company"}</h2>
              {company?.address && (
                <p className="text-neutral-500 whitespace-pre-line text-xs">{company.address}</p>
              )}
              {company?.phone && <p className="text-neutral-500 text-xs">{company.phone}</p>}
              {company?.tax_id && <p className="text-neutral-500 text-xs">TIN: {company.tax_id}</p>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <h1 className="text-xl font-bold tracking-[0.06em] text-[#0b3b60]">PETTY CASH VOUCHER</h1>
            <p className="text-neutral-900 font-mono font-semibold mt-1.5">{model.voucherNumber || "—"}</p>
            {stamp && (
              <span
                className={`mt-2 inline-block rounded border px-2 py-0.5 text-[10px] font-bold tracking-wider ${stamp.tone}`}
              >
                {stamp.label}
              </span>
            )}
          </div>
        </div>

        {/* Paid to · voucher meta */}
        <div className="grid grid-cols-2 gap-6 pt-6 pb-5 items-start">
          <div>
            <p className="text-[11px] uppercase tracking-[0.08em] text-neutral-400 mb-1.5">Paid to</p>
            <p className="text-base font-bold">{model.paidTo || "—"}</p>
          </div>
          <div className="space-y-1.5">
            {meta.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4">
                <span className="text-neutral-500">{label}</span>
                <span className="font-mono font-semibold tabular-nums text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* What this document exists to authorise */}
        <div className="flex items-center justify-between gap-4 rounded-lg bg-[#0b3b60] text-white px-6 py-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em]">Amount paid</span>
          <span className="text-2xl font-mono font-bold tabular-nums">{formatCurrency(total, cur)}</span>
        </div>

        {/* The line that makes a voucher hard to alter after signing */}
        <div className="mt-3 rounded-md bg-neutral-50 border border-neutral-200 px-4 py-2 text-xs">
          <span className="text-neutral-400">In words: </span>
          <span className="text-neutral-800 italic">{amountInWords(total, wordsUnit)}</span>
        </div>

        {/* Particulars */}
        <table className="w-full mt-7">
          <thead>
            <tr className="bg-[#0b3b60] text-white text-left text-[11px] tracking-wide">
              <th className="py-2.5 px-3 rounded-l font-bold w-10">#</th>
              <th className="py-2.5 px-3 font-bold">DATE</th>
              <th className="py-2.5 px-3 font-bold">PARTICULARS</th>
              <th className="py-2.5 px-3 font-bold">ACCOUNT</th>
              <th className="py-2.5 px-3 text-right rounded-r font-bold">AMOUNT ({cur})</th>
            </tr>
          </thead>
          <tbody>
            {model.lines.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 px-3 text-center text-neutral-400 border-b border-neutral-200">
                  No expense lines on this voucher.
                </td>
              </tr>
            ) : (
              model.lines.map((l, i) => (
                <tr key={l.id} className="border-b border-neutral-200 align-top">
                  <td className="py-2.5 px-3 text-neutral-400">{i + 1}</td>
                  <td className="py-2.5 px-3 whitespace-nowrap">{l.date ? formatDocDate(l.date) : "—"}</td>
                  <td className="py-2.5 px-3">{l.description || "—"}</td>
                  <td className="py-2.5 px-3 text-neutral-500 text-xs">
                    {l.accountCode ? `${l.accountCode} — ${l.accountName ?? ""}` : "—"}
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {formatCurrency(Number(l.amount) || 0, cur)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-3 px-3 text-right font-bold uppercase text-[11px] tracking-wide">
                Total
              </td>
              <td className="py-3 px-3 text-right font-mono font-bold tabular-nums border-t-2 border-neutral-900">
                {formatCurrency(total, cur)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* A voucher is not a voucher without these. Shown on screen too, so
            what is reviewed is what gets signed. */}
        <div className="grid grid-cols-3 gap-8 mt-14 text-xs">
          {[
            ["Prepared By", model.preparedBy],
            ["Authorised By", model.authorizedBy],
            ["Received By", null],
          ].map(([label, name]) => (
            <div key={label as string} className="text-center">
              <div className="h-10 flex items-end justify-center pb-1 text-neutral-700">
                {(name as string) || ""}
              </div>
              <div className="border-t border-neutral-900 pt-2 text-neutral-600">{label as string}</div>
            </div>
          ))}
        </div>

        {model.reversedAt && (
          <p className="mt-8 text-center text-[11px] text-red-600">
            Reversed on {formatDocDate(model.reversedAt)} — a correcting journal entry was posted and this
            voucher no longer affects the ledger.
          </p>
        )}
      </div>
    </div>
  );
}
