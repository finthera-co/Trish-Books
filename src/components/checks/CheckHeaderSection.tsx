import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import AccountSelector from "@/components/shared/AccountSelector";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";

const PAYMENT_ACCOUNT_TYPES = ["Asset"];

interface Vendor { id: string; name: string; address?: string | null }
interface Customer { id: string; name: string; address?: string | null }
interface Location { id: string; name: string }

interface Props {
  disabled: boolean;
  payeeType: "vendor" | "customer";
  onPayeeTypeChange: (t: "vendor" | "customer") => void;
  payeeId: string;
  onPayeeIdChange: (v: string) => void;
  payeeVendorId: string;
  onPayeeVendorIdChange: (v: string) => void;
  vendors: Vendor[];
  customers: Customer[];
  paymentAccountId: string;
  onPaymentAccountIdChange: (v: string) => void;
  bankBalance: number;
  mailingAddress: string;
  onMailingAddressChange: (v: string) => void;
  paymentDate: Date;
  onPaymentDateChange: (d: Date) => void;
  chequeNumber: string;
  onChequeNumberChange: (v: string) => void;
  printLater: boolean;
  onPrintLaterChange: (v: boolean) => void;
  locationTrackingEnabled: boolean;
  locationLabel: string;
  locationId: string;
  onLocationIdChange: (v: string) => void;
  locations: Location[];
  permitNumber: string;
  onPermitNumberChange: (v: string) => void;
  errors: Record<string, string>;
}

export default function CheckHeaderSection({
  disabled,
  payeeType, onPayeeTypeChange,
  payeeId, onPayeeIdChange,
  payeeVendorId, onPayeeVendorIdChange,
  vendors, customers,
  paymentAccountId, onPaymentAccountIdChange, bankBalance,
  mailingAddress, onMailingAddressChange,
  paymentDate, onPaymentDateChange,
  chequeNumber, onChequeNumberChange,
  printLater, onPrintLaterChange,
  locationTrackingEnabled, locationLabel, locationId, onLocationIdChange, locations,
  permitNumber, onPermitNumberChange,
  errors,
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const payeeOptions = useMemo(
    () => (payeeType === "vendor" ? vendors : customers),
    [payeeType, vendors, customers]
  );
  const payeeValue = payeeType === "vendor" ? payeeVendorId : payeeId;
  const setPayeeValue = (v: string) => {
    if (payeeType === "vendor") onPayeeVendorIdChange(v);
    else onPayeeIdChange(v);
  };

  return (
    <div className="rounded-lg border bg-card">
      {/* Row 1: Payee + Bank Account (always visible) */}
      <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-10">
        <div>
          <Label>Payee</Label>
          <div className="flex gap-2 mt-1.5">
            <Select value={payeeType} onValueChange={(v) => onPayeeTypeChange(v as "vendor" | "customer")} disabled={disabled}>
              <SelectTrigger className="w-[110px] shrink-0"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="vendor">Vendor</SelectItem>
                <SelectItem value="customer">Customer</SelectItem>
              </SelectContent>
            </Select>
            <Select value={payeeValue} onValueChange={setPayeeValue} disabled={disabled}>
              <SelectTrigger><SelectValue placeholder="Select payee" /></SelectTrigger>
              <SelectContent>
                {payeeOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>Bank Account</Label>
          <div className="flex items-center gap-3 mt-1.5">
            <div className="flex-1">
              <AccountSelector
                value={paymentAccountId}
                onChange={onPaymentAccountIdChange}
                types={PAYMENT_ACCOUNT_TYPES}
                placeholder="Search cash / bank account…"
                disabled={disabled}
              />
            </div>
            {paymentAccountId && (
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                Balance {formatCurrency(bankBalance)}
              </span>
            )}
          </div>
          {errors.paymentAccount && <p className="text-xs text-destructive mt-1.5">{errors.paymentAccount}</p>}
        </div>
      </div>

      {/* Row 2: collapsible — address / date / check no / print later / location / permit */}
      {!collapsed && (
        <div className="px-8 pb-8 grid grid-cols-1 md:grid-cols-2 gap-10 border-t pt-8">
          <div>
            <Label>Mailing address</Label>
            <Textarea
              value={mailingAddress}
              onChange={(e) => onMailingAddressChange(e.target.value)}
              rows={6}
              className="resize-none mt-1.5 text-base"
              placeholder="Auto-filled from payee"
              disabled={disabled}
            />
          </div>
          <div className="space-y-6">
            <div>
              <Label>Payment date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    disabled={disabled}
                    className={cn("w-full justify-start text-left font-normal mt-1.5", !paymentDate && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {paymentDate ? formatDate(paymentDate) : "Pick date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={paymentDate} onSelect={(d) => d && onPaymentDateChange(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
              {errors.paymentDate && <p className="text-xs text-destructive mt-1.5">{errors.paymentDate}</p>}
            </div>

            <div>
              <Label>Check no.</Label>
              {printLater ? (
                <Input value="To print" disabled className="mt-1 text-muted-foreground font-mono" />
              ) : (
                <Input
                  value={chequeNumber}
                  onChange={(e) => onChequeNumberChange(e.target.value)}
                  placeholder="(auto-generated)"
                  className="mt-1 font-mono"
                  disabled={disabled}
                />
              )}
              <div className="flex items-center gap-2 mt-2">
                <Checkbox id="print-later" checked={printLater} onCheckedChange={(v) => onPrintLaterChange(!!v)} disabled={disabled} />
                <Label htmlFor="print-later" className="cursor-pointer font-normal">Print later</Label>
              </div>
            </div>

            {locationTrackingEnabled && (
              <div>
                <Label>{locationLabel}</Label>
                <Select value={locationId || "__none__"} onValueChange={(v) => onLocationIdChange(v === "__none__" ? "" : v)} disabled={disabled}>
                  <SelectTrigger className="mt-1.5"><SelectValue placeholder="Not set" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not set</SelectItem>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Permit no.</Label>
              <Input
                value={permitNumber}
                onChange={(e) => onPermitNumberChange(e.target.value)}
                className="mt-1.5"
                disabled={disabled}
              />
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-center border-t py-1">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
