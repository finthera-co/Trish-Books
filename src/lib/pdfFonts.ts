import type { jsPDF } from "jspdf";

/**
 * Embedded Unicode fonts for jsPDF documents.
 *
 * The base-14 fonts (Helvetica/Times/Courier) jsPDF ships with are not
 * embedded (emb: no in `pdffonts`) and use WinAnsi encoding, which cannot
 * represent Sinhala or Tamil at all — a customer name in either script
 * renders as blank or garbage, not just wrong-looking. Noto Sans covers
 * Latin/Cyrillic/Greek; Sinhala and Tamil are separate font families and are
 * lazy-loaded only when the document actually contains those code points, so
 * a plain-English invoice doesn't pay for ~300KB of scripts it never uses.
 * JetBrains Mono is loaded unconditionally for tabular figures (dates,
 * amounts, invoice numbers) in the Steel Statement invoice design.
 */

const SINHALA_RANGE = /[඀-෿]/;
const TAMIL_RANGE = /[஀-௿]/;

export const NOTO_SANS = "NotoSans";
export const NOTO_SANS_SINHALA = "NotoSansSinhala";
export const NOTO_SANS_TAMIL = "NotoSansTamil";
export const JETBRAINS_MONO = "JetBrainsMono";

// Base64 caches — one fetch per font per browser session, regardless of how
// many invoices get downloaded.
let regularB64: string | null = null;
let boldB64: string | null = null;
let sinhalaB64: string | null = null;
let tamilB64: string | null = null;
let monoRegularB64: string | null = null;
let monoBoldB64: string | null = null;

async function fetchBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch font ${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // String.fromCharCode(...bytes) blows the call stack on a ~650KB font —
  // build the binary string in chunks instead.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** True if `text` contains any Sinhala or Tamil code points. */
export function needsSinhala(text: string): boolean {
  return SINHALA_RANGE.test(text);
}
export function needsTamil(text: string): boolean {
  return TAMIL_RANGE.test(text);
}

/**
 * Pick the font family that can actually render `text`. Sinhala/Tamil only
 * ship a Regular weight, so bold requests on those scripts fall back to
 * Regular rather than drawing nothing.
 */
export function fontFamilyFor(text: string): string {
  if (needsSinhala(text)) return NOTO_SANS_SINHALA;
  if (needsTamil(text)) return NOTO_SANS_TAMIL;
  return NOTO_SANS;
}

/**
 * Register NotoSans Regular/Bold on `doc`, plus NotoSansSinhala/Tamil when
 * `documentText` (the full text the document is about to render) contains
 * those scripts. Must be awaited before any doc.text() call.
 */
export async function registerPdfFonts(doc: jsPDF, documentText: string): Promise<void> {
  if (!regularB64) regularB64 = await fetchBase64("/fonts/NotoSans-Regular.ttf");
  if (!boldB64) boldB64 = await fetchBase64("/fonts/NotoSans-Bold.ttf");
  doc.addFileToVFS("NotoSans-Regular.ttf", regularB64);
  doc.addFont("NotoSans-Regular.ttf", NOTO_SANS, "normal");
  doc.addFileToVFS("NotoSans-Bold.ttf", boldB64);
  doc.addFont("NotoSans-Bold.ttf", NOTO_SANS, "bold");
  // jsPDF has no dedicated italic in this family — reuse Regular so the
  // footer's setFont(NOTO_SANS, "italic") call doesn't silently no-op.
  doc.addFont("NotoSans-Regular.ttf", NOTO_SANS, "italic");

  if (needsSinhala(documentText)) {
    if (!sinhalaB64) sinhalaB64 = await fetchBase64("/fonts/NotoSansSinhala-Regular.ttf");
    doc.addFileToVFS("NotoSansSinhala-Regular.ttf", sinhalaB64);
    doc.addFont("NotoSansSinhala-Regular.ttf", NOTO_SANS_SINHALA, "normal");
  }
  if (needsTamil(documentText)) {
    if (!tamilB64) tamilB64 = await fetchBase64("/fonts/NotoSansTamil-Regular.ttf");
    doc.addFileToVFS("NotoSansTamil-Regular.ttf", tamilB64);
    doc.addFont("NotoSansTamil-Regular.ttf", NOTO_SANS_TAMIL, "normal");
  }

  // Tabular figures (dates, amounts, invoice numbers) — always plain ASCII,
  // so no script-lazy-loading needed here.
  if (!monoRegularB64) monoRegularB64 = await fetchBase64("/fonts/JetBrainsMono-Regular.ttf");
  if (!monoBoldB64) monoBoldB64 = await fetchBase64("/fonts/JetBrainsMono-Bold.ttf");
  doc.addFileToVFS("JetBrainsMono-Regular.ttf", monoRegularB64);
  doc.addFont("JetBrainsMono-Regular.ttf", JETBRAINS_MONO, "normal");
  doc.addFileToVFS("JetBrainsMono-Bold.ttf", monoBoldB64);
  doc.addFont("JetBrainsMono-Bold.ttf", JETBRAINS_MONO, "bold");

  doc.setFont(NOTO_SANS, "normal");
}
