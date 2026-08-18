import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDate } from "@/lib/format";

interface DatePickerProps {
  /** ISO date string, "yyyy-MM-dd" (or empty for no selection). */
  value?: string;
  /** Receives an ISO "yyyy-MM-dd" string (empty when cleared). */
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** Optional bound — disables days before/after these ISO dates. */
  fromDate?: string;
  toDate?: string;
}

const toISO = (d: Date) => format(d, "yyyy-MM-dd");
const fromISO = (s?: string) => {
  if (!s) return undefined;
  const d = parse(s, "yyyy-MM-dd", new Date());
  return isValid(d) ? d : undefined;
};

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  className,
  disabled,
  fromDate,
  toDate,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = fromISO(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-start gap-2 px-3 font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <CalendarIcon className="h-4 w-4 shrink-0 opacity-60" />
          {selected ? formatDate(selected) : <span>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(d) => {
            onChange(d ? toISO(d) : "");
            setOpen(false);
          }}
          fromDate={fromISO(fromDate)}
          toDate={fromISO(toDate)}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}
