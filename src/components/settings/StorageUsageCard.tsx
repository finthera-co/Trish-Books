import { HardDrive } from "lucide-react";
import { useStorageQuota, formatBytes } from "@/hooks/useStorageQuota";

/** Tenant storage usage against plan quota, for the settings page. */
export function StorageUsageCard() {
  const { usedBytes, capBytes, pct, planName, isLoading } = useStorageQuota();

  const barColor = pct >= 1 ? "bg-destructive" : pct >= 0.8 ? "bg-accent-foreground" : "bg-primary";
  const widthPct = Math.min(pct * 100, 100);

  return (
    <div className="stat-card">
      <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
        <HardDrive className="w-4 h-4" /> Storage
      </h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-sm text-foreground">
              {formatBytes(usedBytes)} of {formatBytes(capBytes)} used
            </p>
            {planName && <p className="text-xs text-muted-foreground">{planName} plan</p>}
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${widthPct}%` }}
            />
          </div>
          {pct >= 0.8 && (
            <p className="text-xs text-destructive">
              {pct >= 1
                ? "Storage full — uploads may fail until you free up space or upgrade your plan."
                : "Running low on storage. Consider freeing up space or upgrading your plan."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
