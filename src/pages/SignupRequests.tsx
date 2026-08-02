import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import { Check, X, Mail, Phone, Building2, Copy, Inbox } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

type Status = "pending" | "approved" | "rejected";

interface SignupRequest {
  id: string;
  company_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  team_size: string | null;
  message: string | null;
  status: Status;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  tenant_id: string | null;
}

function useSignupRequests(status: Status) {
  return useQuery({
    queryKey: ["signup_requests", status],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("signup_requests")
        .select("*")
        .eq("status", status)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SignupRequest[];
    },
  });
}

export default function SignupRequests() {
  const [tab, setTab] = useState<Status>("pending");
  const { data: requests, isLoading } = useSignupRequests(tab);
  const qc = useQueryClient();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SignupRequest | null>(null);
  const [note, setNote] = useState("");
  // Shown only when the approval email couldn't be sent, so the reviewer can pass
  // the link on by hand rather than the applicant being left with nothing.
  const [manualLink, setManualLink] = useState<{ email: string; link: string } | null>(null);

  const review = async (req: SignupRequest, action: "approve" | "reject", reviewNote?: string) => {
    setBusyId(req.id);
    try {
      const { data, error } = await supabase.functions.invoke("review-signup-request", {
        body: {
          request_id: req.id,
          action,
          note: reviewNote ?? null,
          site_url: window.location.origin,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Review failed");

      if (action === "reject") {
        toast.success(`Request from ${req.company_name} rejected`);
      } else if (data.emailed) {
        toast.success(`${req.company_name} approved — sign-in link sent to ${req.email}`);
      } else {
        toast.warning("Account created, but the email could not be sent");
        if (data.action_link) setManualLink({ email: req.email, link: data.action_link });
      }

      qc.invalidateQueries({ queryKey: ["signup_requests"] });
      qc.invalidateQueries({ queryKey: ["tenants"] });
    } catch (e: any) {
      toast.error(e.message ?? "Review failed");
    }
    setBusyId(null);
  };

  const tabs: { key: Status; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Signup requests</h1>
          <p className="page-description">
            Review applications for new company accounts. Approving one provisions the
            company and emails the applicant a link to set their password.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted/50 text-muted-foreground hover:bg-accent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <span className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      ) : !requests?.length ? (
        <div className="stat-card text-center py-12">
          <Inbox className="w-8 h-8 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            {tab === "pending" ? "No requests waiting for review." : `No ${tab} requests.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {requests.map((r) => (
            <div key={r.id} className="stat-card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{r.company_name}</span>
                  </p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {r.first_name} {r.last_name}
                    {r.team_size ? ` · ${r.team_size} ${r.team_size === "1" ? "user" : "users"}` : ""}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {format(new Date(r.created_at), "d MMM yyyy")}
                </span>
              </div>

              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate text-foreground">{r.email}</span>
                </p>
                {r.phone && (
                  <p className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-foreground">{r.phone}</span>
                  </p>
                )}
              </div>

              {r.message && (
                <p className="text-sm text-muted-foreground bg-muted/40 rounded-lg p-3 leading-relaxed">
                  {r.message}
                </p>
              )}

              {r.status === "pending" ? (
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={busyId === r.id}
                    onClick={() => review(r, "approve")}
                  >
                    <Check className="w-3.5 h-3.5 mr-1" />
                    {busyId === r.id ? "Approving…" : "Approve & send access"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyId === r.id}
                    onClick={() => { setRejecting(r); setNote(""); }}
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    Reject
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground pt-1">
                  {r.status === "approved" ? "Approved" : "Rejected"}
                  {r.reviewed_at ? ` ${format(new Date(r.reviewed_at), "d MMM yyyy")}` : ""}
                  {r.review_note ? ` — ${r.review_note}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Reject, with an optional reason kept on the record. */}
      <Dialog open={!!rejecting} onOpenChange={(v) => { if (!v) setRejecting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this request</DialogTitle>
            <DialogDescription>
              No account is created and no email is sent. The reason is kept on the
              record for your reference.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Duplicate of an existing company account"
              className="w-full text-sm border border-input rounded-lg px-3 py-2 bg-background text-foreground min-h-[80px] focus:outline-none focus:ring-2 focus:ring-ring/20"
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRejecting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                onClick={() => {
                  const r = rejecting!;
                  setRejecting(null);
                  review(r, "reject", note.trim() || undefined);
                }}
              >
                Reject request
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fallback when the email failed — the account exists, so the link must not
          be lost when this dialog closes without being used. */}
      <Dialog open={!!manualLink} onOpenChange={(v) => { if (!v) setManualLink(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this link manually</DialogTitle>
            <DialogDescription>
              The account was created but the email could not be sent. Pass this
              set-password link to {manualLink?.email} yourself. It can be used once.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <p className="text-xs font-mono break-all bg-muted/50 rounded-lg p-3">
              {manualLink?.link}
            </p>
            <Button
              className="w-full"
              onClick={() => {
                navigator.clipboard.writeText(manualLink!.link);
                toast.success("Link copied");
              }}
            >
              <Copy className="w-3.5 h-3.5 mr-1" />
              Copy link
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
