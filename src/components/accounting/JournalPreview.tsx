import { Badge } from "@/components/ui/badge";

export interface JournalPreviewLine {
  side: "Dr" | "Cr";
  role: string;
  accountName?: string | null;
  note?: string;
  amount?: number;
  isMissing?: boolean;
}

export interface JournalPreviewProps {
  lines: JournalPreviewLine[];
  title?: string;
  description?: string;
  className?: string;
}

export default function JournalPreview({ lines, title, description, className }: JournalPreviewProps) {
  const showAmount = lines.some((l) => l.amount !== undefined);

  return (
    <div className={className}>
      {title && <p className="text-xs font-medium text-foreground mb-0.5">{title}</p>}
      {description && <p className="text-xs text-muted-foreground mb-2">{description}</p>}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="pb-1.5 text-left text-xs font-medium text-muted-foreground w-9" />
            <th className="pb-1.5 text-left text-xs font-medium text-muted-foreground pr-3">Account Role</th>
            <th className="pb-1.5 text-left text-xs font-medium text-muted-foreground">Mapped To</th>
            {showAmount && (
              <th className="pb-1.5 text-right text-xs font-medium text-muted-foreground pl-3">Amount</th>
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} className={i % 2 === 1 ? "bg-muted/20" : undefined}>
              <td className="py-1.5 pr-2">
                {line.side === "Dr" ? (
                  <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs font-mono w-7 justify-center">Dr</Badge>
                ) : (
                  <Badge className="bg-green-100 text-green-700 border-green-200 text-xs font-mono w-7 justify-center">Cr</Badge>
                )}
              </td>
              <td className="py-1.5 pr-3 text-xs text-muted-foreground whitespace-nowrap">{line.role}</td>
              <td className="py-1.5">
                {line.isMissing ? (
                  <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs">Not mapped</Badge>
                ) : line.accountName ? (
                  <span className="text-sm text-foreground">{line.accountName}</span>
                ) : line.note ? (
                  <span className="text-xs text-muted-foreground italic">{line.note}</span>
                ) : (
                  <Badge variant="outline" className="text-yellow-600 border-yellow-400 text-xs">Not mapped</Badge>
                )}
              </td>
              {showAmount && (
                <td className="py-1.5 pl-3 text-right text-sm tabular-nums">
                  {line.amount !== undefined
                    ? line.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    : null}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
