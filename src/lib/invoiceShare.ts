import { getInvoiceVectorPdfFile } from "@/lib/invoicePdf";
import { formatCurrency } from "@/lib/currency";

export interface ShareInvoiceArgs {
  invoiceId: string;
  tenantId: string;
  invoiceNumber: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  total: number;
  amountPaid: number;
  balanceDue: number;
  companyName?: string | null;
}

/** Sri Lanka. wa.me has no notion of a "local" number, so one has to be assumed. */
const DEFAULT_DIAL_CODE = "94";

/**
 * Put a phone number into the form wa.me expects: country code first, digits
 * only, no `+`.
 *
 * Customers get entered the way they're written locally — "077 123 4567" — and
 * simply stripping punctuation leaves `0771234567`, which wa.me reads as a
 * different country's number and opens the wrong chat (or none). A leading 0 is
 * the local trunk prefix and has to be swapped for the dial code.
 */
export function normalizePhone(phone?: string | null, dialCode = DEFAULT_DIAL_CODE): string {
  const raw = (phone || "").trim();
  if (!raw) return "";
  // A written +94… or 0094… is already international; keep it as given.
  if (raw.startsWith("+")) return raw.replace(/\D/g, "");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) return digits.slice(2);
  // Local trunk form (0XX…) → country code. SL mobiles are 0 + 9 digits.
  if (digits.startsWith("0")) return dialCode + digits.slice(1);
  // Already carries the dial code and is long enough to be a full number.
  if (digits.startsWith(dialCode) && digits.length > 9) return digits;
  // Anything else is ambiguous — a bare local number with no trunk prefix is
  // the common case, so assume the home country rather than sending nowhere.
  return digits.length <= 9 ? dialCode + digits : digits;
}

function buildSubject(a: ShareInvoiceArgs): string {
  return `Invoice ${a.invoiceNumber}${a.companyName ? ` from ${a.companyName}` : ""}`;
}

function buildMessage(a: ShareInvoiceArgs): string {
  const lines = [
    `Hi ${a.customerName || "there"},`,
    "",
    `Please find invoice ${a.invoiceNumber} attached.`,
    `Total: ${formatCurrency(a.total)}`,
    `Paid: ${formatCurrency(a.amountPaid)}`,
    `Balance due: ${formatCurrency(a.balanceDue)}`,
    "",
    `Thank you${a.companyName ? `,\n${a.companyName}` : "."}`,
  ];
  return lines.join("\n");
}

/**
 * Try to share the PDF directly through the native share sheet (mobile WhatsApp,
 * Gmail, etc. all appear here). Returns true if the share sheet handled it.
 */
async function tryNativeFileShare(file: File, a: ShareInvoiceArgs): Promise<boolean> {
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData & { files?: File[] }) => boolean;
  };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  const payload = { files: [file], title: buildSubject(a), text: buildMessage(a) };
  if (!nav.canShare(payload)) return false;
  try {
    await nav.share(payload);
    return true;
  } catch (e: any) {
    // User cancelled the share sheet — treat as handled so we don't double-open links.
    if (e?.name === "AbortError") return true;
    return false;
  }
}

/** Download the PDF so the user can attach it after the compose window opens. */
function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type ShareOutcome = "shared" | "linked";

/**
 * Share the invoice over WhatsApp. On mobile this opens the native share sheet
 * with the PDF attached; on desktop it opens WhatsApp Web with a prefilled
 * message and downloads the PDF so it can be attached manually.
 */
export async function shareInvoiceViaWhatsApp(a: ShareInvoiceArgs): Promise<ShareOutcome> {
  const file = await getInvoiceVectorPdfFile(a.invoiceId, a.tenantId);
  if (await tryNativeFileShare(file, a)) return "shared";

  const phone = normalizePhone(a.customerPhone);
  const text = encodeURIComponent(buildMessage(a));
  const url = phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
  downloadFile(file);
  window.open(url, "_blank", "noopener,noreferrer");
  return "linked";
}

/**
 * Share the invoice over Gmail. On mobile this opens the native share sheet
 * with the PDF attached; on desktop it opens the Gmail compose window with a
 * prefilled recipient/subject/body and downloads the PDF so it can be attached.
 */
export async function shareInvoiceViaGmail(a: ShareInvoiceArgs): Promise<ShareOutcome> {
  const file = await getInvoiceVectorPdfFile(a.invoiceId, a.tenantId);
  if (await tryNativeFileShare(file, a)) return "shared";

  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: a.customerEmail || "",
    su: buildSubject(a),
    body: buildMessage(a),
  });
  downloadFile(file);
  window.open(`https://mail.google.com/mail/?${params.toString()}`, "_blank", "noopener,noreferrer");
  return "linked";
}
