import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, CalendarDays, FileText, CalendarPlus, History, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import NotificationBell from "@/components/NotificationBell";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "My Dashboard", path: "/me", icon: LayoutDashboard, end: true },
  { label: "My Attendance", path: "/me/attendance", icon: CalendarDays },
  { label: "My Salary Slips", path: "/me/payslips", icon: FileText },
  { label: "Apply for Leave", path: "/me/leave/apply", icon: CalendarPlus },
  { label: "Leave History", path: "/me/leave", icon: History },
];

export default function EmployeeLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const { data: me } = useMyEmployee();

  const fullName = me ? [me.first_name, me.last_name].filter(Boolean).join(" ") : "Employee";
  const initials = (me?.first_name?.[0] ?? "") + (me?.last_name?.[0] ?? "");

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const isActive = (path: string, end?: boolean) =>
    end ? location.pathname === path : location.pathname === path || location.pathname.startsWith(path + "/");

  return (
    <div className="flex h-screen w-full overflow-hidden bg-muted/30">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-gradient-to-b from-indigo-700 to-indigo-800 text-white">
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-white/15">
          <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center font-bold">FT</div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Finthera</p>
            <p className="text-[11px] text-white/70">Employee Portal</p>
          </div>
        </div>

        {/* Profile */}
        <div className="px-5 py-5 flex items-center gap-3 border-b border-white/15">
          <Avatar className="w-11 h-11 ring-2 ring-white/40">
            <AvatarImage src={me?.photo_url ?? undefined} alt={fullName} />
            <AvatarFallback className="bg-white/20 text-white text-sm">{initials || "ME"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{fullName}</p>
            <p className="text-[11px] text-white/70 truncate">{me?.designation || me?.employee_number || "—"}</p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => {
            const active = isActive(item.path, item.end);
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors",
                  active ? "bg-white text-indigo-700 font-semibold shadow-sm" : "text-white/85 hover:bg-white/15",
                )}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="px-3 py-4 border-t border-white/15">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/85 hover:bg-white/15 transition-colors"
          >
            <LogOut className="w-[18px] h-[18px] shrink-0" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Desktop top bar */}
        <header className="hidden md:flex h-14 border-b border-border bg-card items-center justify-end px-5 shrink-0">
          <NotificationBell />
        </header>
        {/* Mobile top bar */}
        <header className="md:hidden h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
          <span className="font-semibold">Employee Portal</span>
          <div className="flex items-center gap-1">
            <NotificationBell />
            <button onClick={handleSignOut} className="text-muted-foreground"><LogOut className="w-5 h-5" /></button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
