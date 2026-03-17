import { Calendar } from "lucide-react";
import { useFiscalPeriods } from "@/hooks/useFiscalPeriodBalances";

interface FiscalPeriodSelectorProps {
  value: string;
  onChange: (periodId: string) => void;
  className?: string;
}

export default function FiscalPeriodSelector({ value, onChange, className }: FiscalPeriodSelectorProps) {
  const { data: periods, isLoading } = useFiscalPeriods();

  if (isLoading || !periods?.length) return null;

  return (
    <div className={`flex items-center gap-2 ${className || ""}`}>
      <Calendar className="w-4 h-4 text-muted-foreground" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground"
      >
        <option value="">All periods</option>
        {periods.map((p: any) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.period_start} → {p.period_end})
            {p.status === "closed" ? " 🔒" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
