// A reproducibility label, not a security control — a small synchronous hash
// is the right tool here, not crypto.subtle (which would make the whole path
// async for no real benefit). Two people holding two printouts can tell in one
// glance whether they're looking at the same report.
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Canonical-order JSON hash over an arbitrary params object (tenant, range, options, totals). */
export function computeFingerprint(params: Record<string, unknown>): string {
  const keys = Object.keys(params).sort();
  const canonical = JSON.stringify(params, keys);
  return djb2(canonical);
}
