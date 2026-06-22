import { format, parseISO, differenceInMonths } from "date-fns";
import { Mail, Briefcase, Building2, CalendarDays, BadgeCheck, Hash, Clock } from "lucide-react";
import { useMyEmployee, useTenantBranding } from "@/hooks/useMyEmployee";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";

function tenure(hire?: string | null) {
  if (!hire) return "—";
  const months = differenceInMonths(new Date(), parseISO(hire));
  if (months < 1) return "Less than a month";
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr${y > 1 ? "s" : ""}` : null, m ? `${m} mo` : null].filter(Boolean).join(" ") || "—";
}

function Row({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-muted-foreground" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-foreground break-words">{value || "—"}</p>
      </div>
    </div>
  );
}

export default function MyProfile() {
  const { data: me, isLoading } = useMyEmployee();
  const { data: tenant } = useTenantBranding();

  const fullName = me ? [me.first_name, me.middle_name, me.last_name].filter(Boolean).join(" ") : "";
  const initials = (me?.first_name?.[0] ?? "") + (me?.last_name?.[0] ?? "");
  const isActive = (me?.status ?? "active").toLowerCase() === "active";

  return (
    <div className="px-4 sm:px-6 py-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="text-sm text-muted-foreground">Your personal and employment details</p>
      </div>

      {/* Hero card */}
      <div className="rounded-3xl bg-gradient-to-br from-indigo-700 to-indigo-800 text-white p-6 sm:p-8 shadow-lg">
        {isLoading ? (
          <div className="flex items-center gap-5">
            <Skeleton className="w-20 h-20 rounded-full bg-white/20" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-44 bg-white/20" />
              <Skeleton className="h-4 w-28 bg-white/20" />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-5">
            <Avatar className="w-20 h-20 ring-4 ring-white/30">
              <AvatarImage src={me?.photo_url ?? undefined} alt={fullName} />
              <AvatarFallback className="bg-white/20 text-white text-xl">{initials || "ME"}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-bold truncate">{fullName || "Employee"}</h2>
              <p className="text-sm text-white/85 truncate">{me?.designation || "—"}</p>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium">
                <span className={`w-2 h-2 rounded-full ${isActive ? "bg-emerald-400" : "bg-amber-400"}`} />
                {isActive ? "Active" : (me?.status ?? "—")}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Details */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Contact</h3>
          <div className="divide-y divide-border/70">
            <Row icon={Mail} label="Email" value={me?.email} />
            <Row icon={Hash} label="Employee No." value={me?.employee_number} />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Employment</h3>
          <div className="divide-y divide-border/70">
            <Row icon={Briefcase} label="Designation" value={me?.designation} />
            <Row icon={Building2} label="Department" value={me?.department} />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Service</h3>
          <div className="divide-y divide-border/70">
            <Row icon={CalendarDays} label="Date Joined" value={me?.hire_date ? format(parseISO(me.hire_date), "d MMMM yyyy") : null} />
            <Row icon={Clock} label="Tenure" value={tenure(me?.hire_date)} />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card shadow-sm p-5">
          <h3 className="text-sm font-semibold text-foreground mb-1">Company</h3>
          <div className="divide-y divide-border/70">
            <Row icon={Building2} label="Organisation" value={tenant?.company_name} />
            <Row icon={BadgeCheck} label="Reg. No." value={tenant?.registration_number} />
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Something out of date? Reach out to your HR / admin to have it updated.
      </p>
    </div>
  );
}
