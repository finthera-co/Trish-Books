import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Search, Filter } from "lucide-react";

import { toast } from "sonner";
import { formatDateTimeSeconds } from "@/lib/format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function ErrorLogs() {
  const { isSuperAdmin, appUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [resolvedFilter, setResolvedFilter] = useState("unresolved");

  const { data: errors, isLoading } = useQuery({
    queryKey: ["system_error_logs", severityFilter, resolvedFilter],
    queryFn: async () => {
      let query = supabase
        .from("system_error_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

      if (severityFilter !== "all") query = query.eq("severity", severityFilter);
      if (resolvedFilter === "unresolved") query = query.eq("resolved", false);
      else if (resolvedFilter === "resolved") query = query.eq("resolved", true);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const resolveError = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("system_error_logs")
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolved_by: appUser?.id,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["system_error_logs"] });
      toast.success("Error marked as resolved");
    },
  });

  if (!isSuperAdmin) {
    return <div className="text-center py-12"><p className="text-muted-foreground">Access denied.</p></div>;
  }

  const filtered = errors?.filter(e =>
    e.message.toLowerCase().includes(search.toLowerCase()) ||
    e.module.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const severityColors: Record<string, string> = {
    critical: "bg-destructive/10 text-destructive",
    warning: "bg-[hsl(var(--warning))]/10 text-[hsl(var(--warning))]",
    info: "bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]",
  };

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Error Logs</h1>
          <p className="page-description">System error monitoring and resolution</p>
        </div>
      </div>

      {/* Filters */}
      <div className="stat-card">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search errors..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severity</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="info">Info</SelectItem>
            </SelectContent>
          </Select>
          <Select value={resolvedFilter} onValueChange={setResolvedFilter}>
            <SelectTrigger className="w-[130px] h-9 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unresolved">Unresolved</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Error list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="stat-card text-center py-16">
          <CheckCircle className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground font-medium">No errors found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(err => (
            <div key={err.id} className="stat-card">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${severityColors[err.severity] || severityColors.info}`}>
                      {err.severity}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">{err.module}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateTimeSeconds(err.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground font-medium">{err.message}</p>
                  {err.stack_trace && (
                    <details className="mt-2">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                        Stack trace
                      </summary>
                      <pre className="text-xs text-muted-foreground mt-1 p-2 bg-muted rounded-md overflow-x-auto max-h-32">
                        {err.stack_trace}
                      </pre>
                    </details>
                  )}
                </div>
                {!err.resolved && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resolveError.mutate(err.id)}
                    disabled={resolveError.isPending}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" /> Resolve
                  </Button>
                )}
                {err.resolved && (
                  <span className="text-xs text-primary font-medium flex items-center gap-1 shrink-0">
                    <CheckCircle className="w-3.5 h-3.5" /> Resolved
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
