import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDrive, ArrowUpDown } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatBytes } from "@/hooks/useStorageQuota";

interface TenantStorageRow {
  tenant_id: string;
  total_bytes: number;
  last_reconciled_at: string | null;
  company_name: string;
  status: string;
  plan_name: string | null;
  cap_bytes: number;
  pct: number;
}

type SortKey = "company_name" | "plan_name" | "total_bytes" | "pct";

function useAllTenantStorage() {
  return useQuery({
    queryKey: ["all_tenant_storage_usage"],
    queryFn: async (): Promise<TenantStorageRow[]> => {
      const { data, error } = await supabase
        .from("tenants")
        .select(
          "id, company_name, status, subscription_plans(name, features_json), tenant_storage_usage(total_bytes, last_reconciled_at)"
        )
        .is("deleted_at", null);
      if (error) throw error;

      return (data ?? []).map((t: any) => {
        const usage = Array.isArray(t.tenant_storage_usage) ? t.tenant_storage_usage[0] : t.tenant_storage_usage;
        const capBytes = t.subscription_plans?.features_json?.storage_bytes || 2 * 1024 * 1024 * 1024;
        const totalBytes = usage?.total_bytes || 0;
        return {
          tenant_id: t.id,
          total_bytes: totalBytes,
          last_reconciled_at: usage?.last_reconciled_at || null,
          company_name: t.company_name,
          status: t.status,
          plan_name: t.subscription_plans?.name || null,
          cap_bytes: capBytes,
          pct: capBytes > 0 ? totalBytes / capBytes : 0,
        };
      });
    },
  });
}

export default function StorageMonitoring() {
  const { data: rows, isLoading } = useAllTenantStorage();
  const [sortKey, setSortKey] = useState<SortKey>("pct");
  const [sortDesc, setSortDesc] = useState(true);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  const sorted = [...(rows ?? [])].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    const cmp = typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number);
    return sortDesc ? -cmp : cmp;
  });

  const totalBytesAll = (rows ?? []).reduce((sum, r) => sum + r.total_bytes, 0);
  const warningCount = (rows ?? []).filter((r) => r.pct >= 0.8 && r.pct < 1).length;
  const fullCount = (rows ?? []).filter((r) => r.pct >= 1).length;
  const unscannedCount = (rows ?? []).filter((r) => !r.last_reconciled_at).length;

  const SortHeader = ({ label, sortField }: { label: string; sortField: SortKey }) => (
    <th>
      <button
        className="inline-flex items-center gap-1 text-left font-medium hover:text-foreground"
        onClick={() => toggleSort(sortField)}
      >
        {label} <ArrowUpDown className="w-3 h-3" />
      </button>
    </th>
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Storage Monitoring</h1>
          <p className="page-description">Track storage usage against plan quotas across all tenants</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Total Used (All Tenants)</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{formatBytes(totalBytesAll)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Running Low (&ge;80%)</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{warningCount}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Full (&ge;100%)</p>
          <p className="text-2xl font-bold text-destructive tabular-nums">{fullCount}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-medium text-muted-foreground">Not Yet Scanned</p>
          <p className="text-2xl font-bold text-foreground tabular-nums">{unscannedCount}</p>
        </div>
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-2 mb-4">
          <HardDrive className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Tenants</span>
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : sorted.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No tenants found</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <SortHeader label="Company" sortField="company_name" />
                <SortHeader label="Plan" sortField="plan_name" />
                <SortHeader label="Used" sortField="total_bytes" />
                <th>Cap</th>
                <SortHeader label="Usage" sortField="pct" />
                <th>Last Scanned</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const barColor =
                  row.pct >= 1 ? "bg-destructive" : row.pct >= 0.8 ? "bg-accent-foreground" : "bg-primary";
                return (
                  <tr key={row.tenant_id}>
                    <td className="font-medium text-foreground">{row.company_name}</td>
                    <td>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                        {row.plan_name || "None"}
                      </span>
                    </td>
                    <td className="tabular-nums">{formatBytes(row.total_bytes)}</td>
                    <td className="tabular-nums text-muted-foreground">{formatBytes(row.cap_bytes)}</td>
                    <td>
                      <div className="flex items-center gap-2 min-w-[8rem]">
                        <div className="h-1.5 flex-1 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor}`}
                            style={{ width: `${Math.min(row.pct * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {Math.round(row.pct * 100)}%
                        </span>
                      </div>
                    </td>
                    <td className="text-muted-foreground text-xs">
                      {row.last_reconciled_at ? new Date(row.last_reconciled_at).toLocaleString() : "Not yet scanned"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
