import { useState } from "react";
import { Zap, Plus, Edit2, Trash2, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  usePostingProfiles, useCreatePostingProfile, useUpdatePostingProfile,
  useDeletePostingProfile, useResolvePostingProfile,
  MODULES, MODULE_LABELS, TRANSACTION_TYPE_LABELS, ACCOUNT_ROLE_LABELS,
  type PostingProfile, type Module,
} from "@/hooks/usePostingProfiles";
import PostingProfileForm from "@/components/posting-profiles/PostingProfileForm";

const MODULE_COLORS: Record<Module, string> = {
  AR:           "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400",
  AP:           "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/30 dark:text-purple-400",
  FIXED_ASSETS: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/30 dark:text-green-400",
  BANK:         "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/30 dark:text-cyan-400",
};

function scopeLabel(scope: Record<string, string> | null): string {
  if (!scope) return "All (org-wide)";
  if (scope.customer_id) return "Customer-specific";
  if (scope.vendor_id) return "Vendor-specific";
  return JSON.stringify(scope);
}

export default function PostingProfiles() {
  const [activeModule, setActiveModule] = useState<Module>("AR");
  const [formOpen, setFormOpen]         = useState(false);
  const [editProfile, setEditProfile]   = useState<PostingProfile | null>(null);

  const { data: profiles, isLoading } = usePostingProfiles(activeModule);
  const create  = useCreatePostingProfile();
  const update  = useUpdatePostingProfile();
  const remove  = useDeletePostingProfile();
  const resolve = useResolvePostingProfile();

  const handleCreate = async (
    profile: Omit<PostingProfile, "id" | "accounts" | "created_at" | "updated_at">
  ) => {
    await create.mutateAsync(profile as any);
  };

  const handleUpdate = async (
    profile: Omit<PostingProfile, "id" | "accounts" | "created_at" | "updated_at">
  ) => {
    if (!editProfile) return;
    await update.mutateAsync({ id: editProfile.id, ...profile } as any);
    setEditProfile(null);
  };

  const handleTestResolve = async (p: PostingProfile) => {
    const result = await resolve.mutateAsync({
      module:           p.module,
      transaction_type: p.transaction_type,
      entity_scope:     p.entity_scope ?? undefined,
    });
    const resolved = Object.keys(result);
    const msg = resolved.length
      ? `Resolved ${resolved.length} role(s): ${resolved.join(", ")}`
      : "No profiles matched";
    // eslint-disable-next-line no-alert
    alert(msg);
  };

  const grouped = (profiles ?? []).reduce<Record<string, PostingProfile[]>>((acc, p) => {
    const key = p.transaction_type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  return (
    <TooltipProvider delayDuration={200}>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground tracking-tight">
                Posting Profiles
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Configure which GL accounts each sub-ledger module writes to when posting transactions
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => { setEditProfile(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> Add Profile
          </Button>
        </div>

        {/* How it works callout */}
        <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          <ShieldCheck className="w-4 h-4 inline mr-1.5 text-primary" />
          <strong className="text-foreground">Resolution order:</strong> Entity-specific profiles (customer/vendor) win over org-wide defaults.
          Within the same scope, lower priority number wins. The engine falls back to{" "}
          <span className="font-medium text-foreground">Account Mapping</span> defaults if no profile matches.
        </div>

        {/* Module tabs */}
        <div className="flex gap-1 border-b border-border">
          {MODULES.map((m) => (
            <button
              key={m}
              onClick={() => setActiveModule(m)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors -mb-px ${
                activeModule === m
                  ? "border-primary text-primary bg-background"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {MODULE_LABELS[m]}
            </button>
          ))}
        </div>

        {/* Profile table */}
        {isLoading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (profiles ?? []).length === 0 ? (
          <div className="py-20 flex flex-col items-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <Zap className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">No posting profiles for {MODULE_LABELS[activeModule]}</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-[360px]">
                Without profiles, the system falls back to the global Account Mapping settings.
                Add profiles to route different transaction types to specific GL accounts.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => { setEditProfile(null); setFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1.5" /> Add First Profile
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([txnType, txnProfiles]) => (
                <div key={txnType} className="rounded-lg border border-border/60 overflow-hidden shadow-sm">
                  {/* Transaction type header */}
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border/60">
                    <span className="text-xs font-mono text-muted-foreground">{txnType}</span>
                    <span className="text-sm font-semibold text-foreground">
                      {TRANSACTION_TYPE_LABELS[txnType] ?? txnType}
                    </span>
                    <Badge variant="outline" className="ml-auto text-xs">
                      {txnProfiles.length} profile{txnProfiles.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>

                  {/* Profiles table */}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/40 bg-muted/20">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide w-[200px]">Account Role</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">GL Account</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Scope</th>
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Effective</th>
                        <th className="text-center px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Pri</th>
                        <th className="text-center px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Active</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/30">
                      {txnProfiles
                        .sort((a, b) => a.priority - b.priority)
                        .map((p) => (
                          <tr key={p.id} className={`hover:bg-muted/10 ${!p.is_active ? "opacity-50" : ""}`}>
                            <td className="px-4 py-2.5">
                              <div>
                                <span className="font-mono text-xs text-muted-foreground">{p.account_role}</span>
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {ACCOUNT_ROLE_LABELS[p.account_role as any]?.split("(")[0].trim()}
                                </p>
                              </div>
                            </td>
                            <td className="px-4 py-2.5">
                              {p.accounts ? (
                                <div>
                                  <span className="font-mono text-xs text-muted-foreground">{p.accounts.account_code}</span>
                                  <span className="ml-2 text-sm font-medium text-foreground">{p.accounts.account_name}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground text-xs">{p.gl_account_id}</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge
                                variant="outline"
                                className={`text-[10px] ${p.entity_scope ? MODULE_COLORS[activeModule] : ""}`}
                              >
                                {scopeLabel(p.entity_scope)}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-muted-foreground">
                              {p.effective_from}
                              {p.effective_to && <> → {p.effective_to}</>}
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              <span className="text-xs font-mono text-muted-foreground">{p.priority}</span>
                            </td>
                            <td className="px-4 py-2.5 text-center">
                              {p.is_active
                                ? <CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" />
                                : <XCircle className="w-4 h-4 text-muted-foreground mx-auto" />}
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-0.5">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost" size="icon"
                                      className="h-7 w-7"
                                      onClick={() => { setEditProfile(p); setFormOpen(true); }}
                                    >
                                      <Edit2 className="w-3.5 h-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Edit</TooltipContent>
                                </Tooltip>

                                <AlertDialog>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant="ghost" size="icon"
                                          className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </Button>
                                      </AlertDialogTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent>Delete</TooltipContent>
                                  </Tooltip>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Delete Profile?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This removes the posting rule for <strong>{ACCOUNT_ROLE_LABELS[p.account_role as any]}</strong> on{" "}
                                        <strong>{TRANSACTION_TYPE_LABELS[p.transaction_type]}</strong>.
                                        The system will fall back to the global Account Mapping default.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => remove.mutate(p.id)}
                                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Form dialog */}
      <PostingProfileForm
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditProfile(null); }}
        onSubmit={editProfile ? handleUpdate : handleCreate}
        editProfile={editProfile}
        isPending={create.isPending || update.isPending}
        defaultModule={activeModule}
      />
    </TooltipProvider>
  );
}
