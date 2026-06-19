// Pure builders for filing-ready statutory payroll output.
// Each takes payroll_run_items joined to employees and returns {headers, rows}
// for exportToCsv. Totals footer rows are appended so figures reconcile.

type Cell = string | number | null | undefined;
export interface StatutoryTable { headers: string[]; rows: Cell[][] }

const n2 = (v: any) => (Number(v) || 0).toFixed(2);
const name = (e: any) => `${e?.first_name ?? ""} ${e?.last_name ?? ""}`.trim();
// EPF/ETF base = earned basic (full basic minus no-pay deduction) + allowances — matches EPF_BASE.
const epfBaseOf = (it: any) => Number(it.basic_salary || 0) - Number(it.attendance_deduction || 0) + Number(it.allowances || 0);

/** EPF/ETF contribution return — one row per employee, totals footer. */
export function buildEpfEtfReturn(items: any[]): StatutoryTable {
  const headers = ["EPF No", "NIC", "Employee", "EPF Base", "Employee EPF (8%)", "Employer EPF (12%)", "ETF (3%)", "Total Contribution"];
  let tBase = 0, tEe = 0, tEr = 0, tEtf = 0, tTot = 0;
  const rows: Cell[][] = items.map((it) => {
    const e = it.employees || {};
    const base = epfBaseOf(it);
    const ee = Number(it.employee_epf || 0), er = Number(it.employer_epf || 0), etf = Number(it.employer_etf || 0);
    const tot = ee + er + etf;
    tBase += base; tEe += ee; tEr += er; tEtf += etf; tTot += tot;
    return [e.epf_number || "", e.nic_number || "", name(e), base.toFixed(2), ee.toFixed(2), er.toFixed(2), etf.toFixed(2), tot.toFixed(2)];
  });
  rows.push(["", "", "TOTAL", n2(tBase), n2(tEe), n2(tEr), n2(tEtf), n2(tTot)]);
  return { headers, rows };
}

/** PAYE / APIT schedule — only employees with PAYE deducted, totals footer. */
export function buildPayeSchedule(items: any[]): StatutoryTable {
  const headers = ["NIC", "Employee", "Gross Remuneration", "PAYE Base", "PAYE Deducted"];
  let tGross = 0, tPaye = 0;
  const rows: Cell[][] = items
    .filter((it) => Number(it.employee_paye || 0) > 0)
    .map((it) => {
      const e = it.employees || {};
      const gross = Number(it.gross_pay || 0);
      const paye = Number(it.employee_paye || 0);
      tGross += gross; tPaye += paye;
      // PAYE base = gross remuneration (no EPF relief) — see assumptions.
      return [e.nic_number || "", name(e), gross.toFixed(2), gross.toFixed(2), paye.toFixed(2)];
    });
  rows.push(["", "TOTAL", n2(tGross), n2(tGross), n2(tPaye)]);
  return { headers, rows };
}

/** Bank salary disbursement — bank-transfer employees only. Generic CSV (bank formats vary). */
export function buildBankDisbursement(items: any[]): StatutoryTable {
  const headers = ["Bank", "Branch", "Account No", "Account Holder", "Net Pay"];
  let tNet = 0;
  const rows: Cell[][] = items
    .filter((it) => (it.payment_method || "bank_transfer") === "bank_transfer")
    .map((it) => {
      const e = it.employees || {};
      const net = Number(it.net_pay || 0);
      tNet += net;
      return [e.bank_name || "", e.bank_branch || "", e.bank_account_no || "", e.bank_account_name || name(e), net.toFixed(2)];
    });
  rows.push(["", "", "", "TOTAL", n2(tNet)]);
  return { headers, rows };
}
