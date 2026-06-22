import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell, CheckCheck, Check, AlertTriangle, Info, DollarSign, FileCheck,
  Search, ChevronRight, Inbox, Clock,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format, isToday, isYesterday, parseISO, differenceInDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  link: string | null;
  created_at: string;
}

const typeMeta: Record<string, { label: string; icon: typeof Bell; chip: string; dot: string }> = {
  warning:  { label: "Reminders", icon: AlertTriangle, chip: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  financial:{ label: "Financial", icon: DollarSign,    chip: "bg-primary/10 text-primary",         dot: "bg-primary" },
  approval: { label: "Approvals", icon: FileCheck,     chip: "bg-accent text-accent-foreground",   dot: "bg-amber-500" },
  system:   { label: "System",    icon: Info,          chip: "bg-muted text-muted-foreground",     dot: "bg-muted-foreground" },
};
const metaFor = (t: string) => typeMeta[t] ?? typeMeta.system;

function bucket(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMMM yyyy");
}

// Filter is either a read-state pseudo-filter or a concrete notification type.
type Filter = "all" | "unread" | "warning" | "approval" | "financial" | "system";

export default function Notifications() {
  const { appUser } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const { data: notifications = [], isLoading, isFetching } = useQuery<Notification[]>({
    queryKey: ["notifications"],
    enabled: !!appUser,
    refetchInterval: 60000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data as any[]) || [];
    },
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // Headline metrics shown as stat cards.
  const stats = useMemo(() => ({
    total: notifications.length,
    unread: unreadCount,
    actionable: notifications.filter((n) => n.type === "warning" && !n.is_read).length,
    thisWeek: notifications.filter((n) => differenceInDays(new Date(), parseISO(n.created_at)) < 7).length,
  }), [notifications, unreadCount]);

  // Per-filter counts for the toolbar pills.
  const counts = useMemo(() => ({
    all: notifications.length,
    unread: unreadCount,
    warning: notifications.filter((n) => n.type === "warning").length,
    approval: notifications.filter((n) => n.type === "approval").length,
    financial: notifications.filter((n) => n.type === "financial").length,
    system: notifications.filter((n) => n.type === "system").length,
  }), [notifications, unreadCount]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return notifications.filter((n) => {
      const passFilter =
        filter === "all" ? true :
        filter === "unread" ? !n.is_read :
        n.type === filter;
      const passSearch = !q || n.title.toLowerCase().includes(q) || n.message.toLowerCase().includes(q);
      return passFilter && passSearch;
    });
  }, [notifications, filter, search]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ is_read: true } as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const ids = notifications.filter((n) => !n.is_read).map((n) => n.id);
      if (!ids.length) return;
      const { error } = await supabase.from("notifications").update({ is_read: true } as any).in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  // Group notifications under date headers, preserving newest-first order.
  const groups = useMemo(() => {
    const out: { label: string; items: Notification[] }[] = [];
    for (const n of visible) {
      const label = bucket(n.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(n);
      else out.push({ label, items: [n] });
    }
    return out;
  }, [visible]);

  const onClick = (n: Notification) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "warning", label: "Reminders" },
    { key: "approval", label: "Approvals" },
    { key: "financial", label: "Financial" },
    { key: "system", label: "System" },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bell className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Notifications</h1>
            <p className="text-sm text-muted-foreground">
              Invoice reminders, approvals and system alerts
              {isFetching && !isLoading ? " · syncing…" : ""}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
            <CheckCheck className="h-4 w-4" /> Mark all read
          </Button>
        )}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: "Total", value: stats.total, hint: "all time", icon: Inbox,
            card: "border-indigo-200 bg-gradient-to-br from-indigo-50 to-indigo-100/50 dark:border-indigo-900/60 dark:from-indigo-950/50 dark:to-indigo-900/20",
            iconBg: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
            label_: "text-indigo-700/80 dark:text-indigo-300/80", value_: "text-indigo-700 dark:text-indigo-300" },
          { label: "Unread", value: stats.unread, hint: "need a look", icon: Bell,
            card: "border-blue-200 bg-gradient-to-br from-blue-50 to-blue-100/50 dark:border-blue-900/60 dark:from-blue-950/50 dark:to-blue-900/20",
            iconBg: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
            label_: "text-blue-700/80 dark:text-blue-300/80", value_: "text-blue-700 dark:text-blue-300" },
          { label: "Action needed", value: stats.actionable, hint: "due / overdue", icon: AlertTriangle,
            card: "border-rose-200 bg-gradient-to-br from-rose-50 to-rose-100/50 dark:border-rose-900/60 dark:from-rose-950/50 dark:to-rose-900/20",
            iconBg: "bg-rose-500/15 text-rose-600 dark:text-rose-400",
            label_: "text-rose-700/80 dark:text-rose-300/80", value_: "text-rose-700 dark:text-rose-300" },
          { label: "This week", value: stats.thisWeek, hint: "last 7 days", icon: Clock,
            card: "border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:border-emerald-900/60 dark:from-emerald-950/50 dark:to-emerald-900/20",
            iconBg: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
            label_: "text-emerald-700/80 dark:text-emerald-300/80", value_: "text-emerald-700 dark:text-emerald-300" },
        ].map((s) => {
          const Icon = s.icon;
          return (
            <div
              key={s.label}
              className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm transition-shadow hover:shadow-md ${s.card}`}
            >
              <div className="flex items-start justify-between">
                <p className={`text-xs font-semibold uppercase tracking-wide ${s.label_}`}>{s.label}</p>
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${s.iconBg}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <p className={`mt-3 text-4xl font-bold tabular-nums leading-none ${s.value_}`}>{s.value}</p>
              <p className={`mt-2 text-[11px] ${s.label_} opacity-70`}>{s.hint}</p>
            </div>
          );
        })}
      </div>

      {/* Toolbar: category pills + search */}
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {pills.map((p) => {
              const active = filter === p.key;
              const c = counts[p.key as keyof typeof counts];
              return (
                <button
                  key={p.key}
                  onClick={() => setFilter(p.key)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {p.label}
                  <span className={`tabular-nums rounded-full px-1.5 text-[10px] ${active ? "bg-primary-foreground/20" : "bg-muted"}`}>
                    {c}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 sm:max-w-xs">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search notifications…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-transparent py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm divide-y divide-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3 p-4">
              <Skeleton className="h-10 w-10 shrink-0 rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card py-20 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Inbox className="h-6 w-6 text-muted-foreground/50" />
          </div>
          <p className="text-sm font-medium text-foreground">
            {search ? "No matches" : filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {search ? "Try a different search term." : "Invoice reminders, approvals and alerts will show up here."}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mb-2 flex items-center gap-2 px-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                <span className="text-[11px] text-muted-foreground/60">· {g.items.length}</span>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm divide-y divide-border">
                {g.items.map((n) => {
                  const meta = metaFor(n.type);
                  const Icon = meta.icon;
                  return (
                    <div
                      key={n.id}
                      onClick={() => onClick(n)}
                      className={`group relative flex cursor-pointer gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40 ${
                        !n.is_read ? "bg-primary/[0.025]" : ""
                      }`}
                    >
                      {/* Unread accent bar */}
                      {!n.is_read && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}

                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meta.chip}`}>
                        <Icon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <p className={`text-sm leading-tight ${!n.is_read ? "font-semibold text-foreground" : "text-foreground"}`}>
                              {n.title}
                            </p>
                            <span className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium sm:inline ${meta.chip}`}>
                              {meta.label}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {!n.is_read && <span className="h-2 w-2 rounded-full bg-primary" />}
                          </div>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                        <div className="mt-1.5 flex items-center gap-3">
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(parseISO(n.created_at), { addSuffix: true })}
                          </span>
                          {n.link && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                              Open <ChevronRight className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Hover action: mark read */}
                      {!n.is_read && (
                        <button
                          onClick={(e) => { e.stopPropagation(); markRead.mutate(n.id); }}
                          title="Mark as read"
                          className="absolute right-3 top-3 hidden h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:text-foreground group-hover:flex"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
