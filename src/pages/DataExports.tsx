import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw, FileArchive, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { formatDateTime } from "@/lib/format";

export default function DataExports() {
  const queryClient = useQueryClient();

  const { data: exports, isLoading } = useQuery({
    queryKey: ["export_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("export_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  const triggerExport = useMutation({
    mutationFn: async () => {
      return await invokeEdgeFunction("weekly-csv-export");
    },
    onSuccess: () => {
      toast.success("Export completed successfully");
      queryClient.invalidateQueries({ queryKey: ["export_logs"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleDownload = async (filePath: string, tableName: string) => {
    const fullPath = `${filePath}/${tableName}.csv`;
    const { data, error } = await supabase.storage
      .from("csv-exports")
      .download(fullPath);
    if (error) {
      toast.error("Failed to download file");
      return;
    }
    const url = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tableName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Data Exports</h1>
          <p className="page-description">
            Weekly automated CSV exports of all financial data. Exports run every Sunday at midnight.
          </p>
        </div>
        <Button
          onClick={() => triggerExport.mutate()}
          disabled={triggerExport.isPending}
        >
          <RefreshCw className={`w-4 h-4 ${triggerExport.isPending ? "animate-spin" : ""}`} />
          {triggerExport.isPending ? "Exporting..." : "Export Now"}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : !exports?.length ? (
        <div className="stat-card text-center py-16">
          <FileArchive className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">No exports yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Click "Export Now" to generate your first export, or wait for the weekly automatic export.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {exports.map((exp) => (
            <div key={exp.id} className="stat-card">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpanded(expanded === exp.id ? null : exp.id)}
              >
                <div className="flex items-center gap-3">
                  <FileArchive className="w-5 h-5 text-primary" />
                  <div>
                    <p className="font-medium text-foreground">{exp.file_name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <Calendar className="w-3 h-3" />
                      {formatDateTime(exp.created_at)}
                      <span className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">
                        {exp.export_type}
                      </span>
                      <span>{(exp.tables_included as string[])?.length || 0} tables</span>
                    </div>
                  </div>
                </div>
                <ChevronIcon expanded={expanded === exp.id} />
              </div>
              {expanded === exp.id && (
                <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {(exp.tables_included as string[])?.map((table) => (
                    <Button
                      key={table}
                      variant="outline"
                      size="sm"
                      className="justify-start"
                      onClick={() => handleDownload(exp.file_path, table)}
                    >
                      <Download className="w-3 h-3 mr-1.5" />
                      {table}.csv
                    </Button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}
