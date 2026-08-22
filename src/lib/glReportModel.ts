import type { GLAccountNode, GLTransactionRow } from "@/hooks/useGeneralLedger";
import { isPeriodBasedAccount } from "@/lib/accountTypes";

export type GLRowKind = "account-header" | "opening-balance" | "txn" | "account-total" | "grand-total";

export interface GLReportRow {
  kind: GLRowKind;
  depth: number;
  key: string;
  label?: string;
  nodeKey?: string;
  accountId?: string;
  txn?: GLTransactionRow;
  debit?: number;
  credit?: number;
  balance?: number;
  isLoadingTxns?: boolean;
}

export interface BuildGLOptions {
  includeZeroActivity?: boolean;
  includeOtherRows?: boolean;
  showAccountCodes?: boolean;
  collapsed?: ReadonlySet<string>;
  /**
   * Restrict the report to one account's subtree (its own postings, its
   * descendants and its "- Other" row). Used by the Trial Balance drill-through.
   */
  focusAccountId?: string | null;
  /**
   * Pre-formatted p_date_from label. When set, every leaf / "- Other" account
   * section starts with an explicit "Opening Balance" row (own_opening),
   * matching the Account Register and standard General Ledger practice.
   * Omitted for period-based (P&L) accounts, which never carry an opening
   * balance — see isPeriodBasedAccount.
   */
  openingBalanceDate?: string;
}

interface BuildGLResult {
  rows: GLReportRow[];
  grandOpening: number;
  grandDebit: number;
  grandCredit: number;
  grandBalance: number;
  imbalance: number;
}

/**
 * A node's own transactions live at its real account_id — this holds for both
 * true leaves and synthetic "- Other" pseudo-children, since rpc_gl_account_tree
 * sets the other-node's account_id to its parent's real id (the "- Other" row
 * IS that parent's own direct postings, just rendered as a pseudo-child).
 */
function ownTotal(node: GLAccountNode) {
  return { debit: node.own_debit, credit: node.own_credit, balance: node.own_opening + node.own_debit - node.own_credit };
}

function subtreeTotal(node: GLAccountNode) {
  return {
    debit: node.subtree_debit,
    credit: node.subtree_credit,
    balance: node.subtree_opening + node.subtree_debit - node.subtree_credit,
  };
}

/**
 * Subtree transaction counts, computed client-side by summing own_txn_count over
 * every real (non "- Other") node whose sort_path is prefixed by the target's.
 * The RPC doesn't return this rolled up (only subtree_debit/credit), and this
 * aggregation is monotonic — a node's subtree count can never be less than any
 * descendant's — so filtering each node independently against its own subtree
 * count/opening can never orphan an active descendant under a pruned ancestor.
 */
function computeSubtreeTxnCounts(realNodes: readonly GLAccountNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const n of realNodes) {
    let count = 0;
    for (const d of realNodes) {
      if (d.sort_path.startsWith(n.sort_path)) count += d.own_txn_count;
    }
    counts.set(n.node_key, count);
  }
  return counts;
}

function pruneZeroActivity(nodes: readonly GLAccountNode[]): GLAccountNode[] {
  const real = nodes.filter((n) => !n.is_other_node);
  const subtreeCounts = computeSubtreeTxnCounts(real);
  const keptRealKeys = new Set(
    real
      .filter((n) => !(subtreeCounts.get(n.node_key) === 0 && Math.abs(n.subtree_opening) < 0.005))
      .map((n) => n.node_key)
  );
  return nodes.filter((n) => {
    if (!n.is_other_node) return keptRealKeys.has(n.node_key);
    // Other-node survives iff its parent survived AND it isn't itself empty.
    const parentKey = n.account_id;
    if (!keptRealKeys.has(parentKey)) return false;
    return !(n.own_txn_count === 0 && Math.abs(n.own_opening) < 0.005);
  });
}

/**
 * Narrow the tree to one account's subtree. Matches on sort_path rather than
 * parent_account_id so descendants at any depth — and the account's own
 * "- Other" pseudo-child, which hangs off the same path — come along in one pass.
 */
function focusSubtree(nodes: readonly GLAccountNode[], accountId: string): readonly GLAccountNode[] {
  const target = nodes.find((n) => n.account_id === accountId && !n.is_other_node);
  if (!target) return [];
  const prefix = target.sort_path + "/";
  return nodes.filter((n) => n.sort_path === target.sort_path || n.sort_path.startsWith(prefix));
}

function applyDisplayFilters(
  nodes: readonly GLAccountNode[],
  options?: Pick<BuildGLOptions, "includeZeroActivity" | "includeOtherRows" | "focusAccountId">
): readonly GLAccountNode[] {
  let working: readonly GLAccountNode[] = nodes;
  if (options?.focusAccountId) working = focusSubtree(working, options.focusAccountId);
  if (options?.includeZeroActivity === false) working = pruneZeroActivity(working);
  if (options?.includeOtherRows === false) working = working.filter((n) => !n.is_other_node);
  return working;
}

/**
 * Roots of the *visible* forest — nodes with no surviving ancestor in the set.
 *
 * The grand total used to sum `depth === 1` nodes, which silently produced a
 * zero total whenever the top of the tree wasn't in scope (drilling into one
 * account, or an account-type filter that leaves only nested nodes). Deriving
 * the roots from the set actually being rendered means the grand total always
 * equals the sum of the top-level "Total …" rows on screen, whatever the filters.
 *
 * "- Other" nodes are excluded: their amounts are their parent's own postings,
 * already inside that parent's subtree_* figures.
 */
function visibleForestRoots(nodes: readonly GLAccountNode[]): GLAccountNode[] {
  const real = nodes.filter((n) => !n.is_other_node);
  return real.filter((n) => !real.some((p) => n.sort_path.startsWith(p.sort_path + "/")));
}

/**
 * Which leaf/"- Other" account ids would actually render given the current
 * filters and collapse state — i.e. what the caller needs to fetch transactions
 * for. Mirrors buildGeneralLedgerRows' own collapse-skip walk without needing
 * transactions in hand, so the component can fetch lazily per expanded account.
 */
export function getVisibleLeafAccountIds(
  nodes: readonly GLAccountNode[],
  options?: Pick<BuildGLOptions, "includeZeroActivity" | "includeOtherRows" | "collapsed" | "focusAccountId">
): string[] {
  const working = applyDisplayFilters(nodes, options);
  const collapsed = options?.collapsed ?? new Set<string>();

  const ids: string[] = [];
  let skipUntilPrefix: string | null = null;

  for (const node of working) {
    if (skipUntilPrefix) {
      if (node.sort_path.startsWith(skipUntilPrefix)) continue;
      skipUntilPrefix = null;
    }
    if (collapsed.has(node.node_key)) {
      if (node.has_children) skipUntilPrefix = node.sort_path + "/";
      continue;
    }
    if (!node.has_children) ids.push(node.account_id);
  }
  return ids;
}

export function buildGeneralLedgerRows(
  nodes: readonly GLAccountNode[],
  txnsByAccount: ReadonlyMap<string, readonly GLTransactionRow[]>,
  options?: BuildGLOptions
): BuildGLResult {
  const collapsed = options?.collapsed ?? new Set<string>();
  const working = applyDisplayFilters(nodes, options);

  const showAccountCodes = options?.showAccountCodes ?? false;
  const rows: GLReportRow[] = [];
  const stack: GLAccountNode[] = [];
  let skipUntilPrefix: string | null = null;

  const displayLabel = (node: GLAccountNode) =>
    showAccountCodes && node.account_code ? `${node.account_code} · ${node.label}` : node.label;

  const pushHeader = (node: GLAccountNode) => {
    rows.push({
      kind: "account-header",
      depth: node.depth,
      key: `header:${node.node_key}`,
      label: displayLabel(node),
      nodeKey: node.node_key,
      accountId: node.account_id,
      balance: node.subtree_opening,
    });
  };

  const pushTotal = (node: GLAccountNode, useSubtree: boolean) => {
    const t = useSubtree ? subtreeTotal(node) : ownTotal(node);
    rows.push({
      kind: "account-total",
      depth: node.depth,
      key: `total:${node.node_key}`,
      label: `Total ${displayLabel(node)}`,
      nodeKey: node.node_key,
      accountId: node.account_id,
      debit: t.debit,
      credit: t.credit,
      balance: t.balance,
    });
  };

  for (const node of working) {
    while (stack.length > 0 && !node.sort_path.startsWith(stack[stack.length - 1].sort_path + "/")) {
      const frame = stack.pop()!;
      pushTotal(frame, true);
    }

    if (skipUntilPrefix) {
      if (node.sort_path.startsWith(skipUntilPrefix)) continue;
      skipUntilPrefix = null;
    }

    pushHeader(node);

    const isCollapsed = collapsed.has(node.node_key);

    if (isCollapsed) {
      pushTotal(node, node.has_children);
      if (node.has_children) skipUntilPrefix = node.sort_path + "/";
      continue;
    }

    if (node.has_children) {
      stack.push(node);
      continue;
    }

    // Leaf or "- Other" node: opening balance, then its own transactions, then its own total.
    if (options?.openingBalanceDate && !isPeriodBasedAccount(node.account_type)) {
      rows.push({
        kind: "opening-balance",
        depth: node.depth,
        key: `opening:${node.node_key}`,
        nodeKey: node.node_key,
        accountId: node.account_id,
        label: `Opening Balance — ${options.openingBalanceDate}`,
        balance: node.own_opening,
      });
    }

    const txns = txnsByAccount.get(node.account_id);
    if (txns === undefined) {
      rows.push({ kind: "txn", depth: node.depth, key: `loading:${node.node_key}`, nodeKey: node.node_key, isLoadingTxns: true });
    } else {
      for (const txn of txns) {
        rows.push({ kind: "txn", depth: node.depth, key: `txn:${txn.line_id}`, nodeKey: node.node_key, accountId: node.account_id, txn });
      }
    }
    pushTotal(node, false);
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    pushTotal(frame, true);
  }

  const topNodes = visibleForestRoots(working);
  const grandOpening = topNodes.reduce((s, n) => s + n.subtree_opening, 0);
  const grandDebit = topNodes.reduce((s, n) => s + n.subtree_debit, 0);
  const grandCredit = topNodes.reduce((s, n) => s + n.subtree_credit, 0);
  // Closing, on the same opening + Dr - Cr basis every other total row uses.
  // This was hardcoded to 0 — which happens to be right only for a complete,
  // balanced ledger, and hid the real figure under every filter as well as any
  // genuine imbalance.
  const grandBalance = grandOpening + grandDebit - grandCredit;

  rows.push({
    kind: "grand-total",
    depth: 0,
    key: "grand",
    label: "TOTAL",
    debit: grandDebit,
    credit: grandCredit,
    balance: grandBalance,
  });

  return { rows, grandOpening, grandDebit, grandCredit, grandBalance, imbalance: grandDebit - grandCredit };
}

// Zero renders as an empty cell — QuickBooks leaves these blank, not "0.00", not "—".
export const fmtAmt = (n?: number | null): string =>
  !n ? "" : Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Negatives in parentheses.
export const fmtBal = (n?: number | null): string => {
  if (n == null) return "";
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < -0.005 ? `(${s})` : s;
};

export const GL_REPORT_CURRENCY = "LKR";
