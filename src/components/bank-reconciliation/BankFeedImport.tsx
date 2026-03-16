import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Upload, FileSpreadsheet } from "lucide-react";
import { useImportBankFeed } from "@/hooks/useBankFeeds";

interface Props {
  reconciliationId: string;
  bankAccountId: string;
}

const DATE_FORMATS = [
  { label: "YYYY-MM-DD", value: "iso" },
  { label: "MM/DD/YYYY", value: "us" },
  { label: "DD/MM/YYYY", value: "eu" },
];

function parseDate(raw: string, format: string): string {
  const clean = raw.trim();
  if (format === "iso") return clean;
  const parts = clean.split(/[\/\-\.]/);
  if (parts.length < 3) return clean;
  if (format === "us") return `${parts[2]}-${parts[0].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
  if (format === "eu") return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  return clean;
}

function parseCSV(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.map((line) => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === "," && !inQuotes) { result.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    result.push(current.trim());
    return result;
  });
}

export default function BankFeedImport({ reconciliationId, bankAccountId }: Props) {
  const [open, setOpen] = useState(false);
  const [dateFormat, setDateFormat] = useState("iso");
  const [preview, setPreview] = useState<string[][] | null>(null);
  const [colMap, setColMap] = useState<{ date: number; desc: number; amount: number; ref: number; balance: number }>({
    date: 0, desc: 1, amount: 2, ref: 3, balance: 4,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const importFeed = useImportBankFeed();

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      setPreview(rows);
      // Auto-detect columns from header
      if (rows.length > 0) {
        const header = rows[0].map((h) => h.toLowerCase());
        const map = { ...colMap };
        header.forEach((h, i) => {
          if (h.includes("date")) map.date = i;
          if (h.includes("desc") || h.includes("narr") || h.includes("particular")) map.desc = i;
          if (h.includes("amount") || h.includes("debit") || h.includes("credit")) map.amount = i;
          if (h.includes("ref") || h.includes("cheque") || h.includes("check")) map.ref = i;
          if (h.includes("balance") || h.includes("bal")) map.balance = i;
        });
        setColMap(map);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!preview || preview.length < 2) return;
    const dataRows = preview.slice(1); // skip header
    const transactions = dataRows
      .filter((row) => row[colMap.date] && row[colMap.amount])
      .map((row) => ({
        transaction_date: parseDate(row[colMap.date] || "", dateFormat),
        description: row[colMap.desc] || "",
        amount: parseFloat((row[colMap.amount] || "0").replace(/[^0-9.\-]/g, "")) || 0,
        reference_number: row[colMap.ref] || undefined,
        bank_balance: row[colMap.balance] ? parseFloat(row[colMap.balance].replace(/[^0-9.\-]/g, "")) : undefined,
      }))
      .filter((t) => t.amount !== 0);

    await importFeed.mutateAsync({ reconciliationId, bankAccountId, transactions });
    setOpen(false);
    setPreview(null);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="w-3 h-3 mr-1" /> Import Bank Statement
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Import Bank Statement (CSV)
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Label>CSV File</Label>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt"
                onChange={handleFile}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 mt-1"
              />
            </div>
            <div>
              <Label>Date Format</Label>
              <Select value={dateFormat} onValueChange={setDateFormat}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DATE_FORMATS.map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {preview && preview.length > 0 && (
            <>
              <div className="grid grid-cols-5 gap-2">
                {["Date", "Description", "Amount", "Reference", "Balance"].map((label, idx) => (
                  <div key={label}>
                    <Label className="text-xs">{label} Column</Label>
                    <Select
                      value={String(Object.values(colMap)[idx])}
                      onValueChange={(v) => {
                        const keys = ["date", "desc", "amount", "ref", "balance"] as const;
                        setColMap((prev) => ({ ...prev, [keys[idx]]: parseInt(v) }));
                      }}
                    >
                      <SelectTrigger className="text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {preview[0].map((h, i) => (
                          <SelectItem key={i} value={String(i)}>{h || `Column ${i + 1}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              <div className="border rounded-md overflow-auto max-h-48">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted">
                      {preview[0].map((h, i) => (
                        <th key={i} className="px-2 py-1 text-left font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.slice(1, 6).map((row, ri) => (
                      <tr key={ri} className="border-t">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-2 py-1">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs text-muted-foreground">
                Showing first 5 of {preview.length - 1} data rows
              </p>

              <Button
                onClick={handleImport}
                disabled={importFeed.isPending}
                className="w-full"
              >
                {importFeed.isPending ? "Importing..." : `Import ${preview.length - 1} Transactions`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
