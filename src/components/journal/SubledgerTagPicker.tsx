import { Info } from "lucide-react";

export interface TagOption {
  id: string;
  name: string;
}

interface Props {
  /** Which sub-ledger the line's control account belongs to. */
  entity: "customer" | "vendor";
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  options: TagOption[];
  disabled?: boolean;
}

const LABEL: Record<Props["entity"], string> = {
  customer: "Customer",
  vendor: "Vendor",
};

const LEDGER: Record<Props["entity"], string> = {
  customer: "AR aging",
  vendor: "AP aging",
};

/**
 * Attaches a journal line that hits a control account to the sub-ledger entity
 * it belongs to, writing journal_lines.customer_id / vendor_id.
 *
 * Deliberately optional. A manual double entry against Trade Debtors is normal
 * accounting — opening balances, contras, reclassifications — and a tenant that
 * has not onboarded its customers yet must still be able to post one. Untagged
 * lines post exactly as before; tagged ones stay attributable, so the aging can
 * be reconciled back to the control account line by line.
 */
export default function SubledgerTagPicker({ entity, value, onChange, options, disabled }: Props) {
  const label = LABEL[entity];

  return (
    <div className="flex items-center gap-2 pl-1">
      <span className="text-[11px] text-muted-foreground shrink-0">{label}</span>
      <select
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value || null)}
        aria-label={`${label} for this control account line`}
        className="text-xs border border-input rounded-md px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 focus:border-primary transition-colors disabled:opacity-50 max-w-[16rem]"
      >
        <option value="">
          {options.length === 0 ? `No ${entity}s on file` : `Not tagged (optional)`}
        </option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      {!value && options.length > 0 && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Info className="w-3 h-3 shrink-0" />
          Untagged lines move the control account without moving the {LEDGER[entity]}.
        </span>
      )}
    </div>
  );
}
