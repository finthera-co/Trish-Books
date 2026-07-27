/**
 * Bank Statement Categorization Engine — public surface.
 * Pure, deterministic, no I/O. See types.ts for the design principle.
 */

export * from "./types.ts";
export { normalizeText, parseAmountCell, roundAmount } from "./normalize.ts";
export {
  DEFAULT_CANONICAL_VARIANTS,
  buildCanonicalMap,
  canonicalize,
  defaultCanonicalEntries,
} from "./canonicalize.ts";
export { classifyLine } from "./resolve.ts";
export { deriveAccountName, deriveNameFromLabel, deriveAccountKey } from "./derive.ts";
export {
  checkBalanceContinuity,
  computeControlTotals,
  findDuplicates,
  round2,
  validateBatch,
} from "./validate.ts";
export {
  findColumnMap,
  isBroughtForwardText,
  parseDateCell,
  parseSheetMatrix,
  parseSheetPeriod,
  type ColumnMap,
  type SheetParseResult,
} from "./parser.ts";

import { canonicalize } from "./canonicalize.ts";
import { classifyLine } from "./resolve.ts";
import type { ParsedLine, ResolutionContext, ResolvedLine } from "./types.ts";

/** Resolve every line of a batch. Excluded (B/F) rows get a null resolution. */
export function resolveBatch(lines: ParsedLine[], ctx: ResolutionContext): ResolvedLine[] {
  return lines.map((line) => {
    if (line.isExcluded) {
      return { line, resolution: null, canonicalCategory: null };
    }
    const canonEntry = canonicalize(line.rawAccountType, ctx.canonicalMap);
    return {
      line,
      resolution: classifyLine(line, ctx),
      canonicalCategory: canonEntry?.canonicalCategory ?? null,
    };
  });
}
