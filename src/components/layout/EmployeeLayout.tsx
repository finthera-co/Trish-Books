import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { LayoutDashboard, CalendarDays, MapPin, FileText, CalendarPlus, History, LogOut, User, ChevronRight, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMyEmployee } from "@/hooks/useMyEmployee";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StoredAvatarImage } from "@/components/StoredAvatarImage";
import NotificationBell from "@/components/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "My Dashboard", path: "/me", icon: LayoutDashboard, end: true },
  { label: "My Attendance", path: "/me/attendance", icon: CalendarDays },
  { label: "Field Check-in", path: "/me/field", icon: MapPin },
  { label: "My Salary Slips", path: "/me/payslips", icon: FileText },
  { label: "Apply for Leave", path: "/me/leave/apply", icon: CalendarPlus },
  { label: "Leave History", path: "/me/leave", icon: History },
  { label: "My Profile", path: "/me/profile", icon: User },
];

// A compact set of destinations for the mobile bottom tab bar.
const BOTTOM_NAV = [
  { label: "Home", path: "/me", icon: LayoutDashboard, end: true },
  { label: "Attendance", path: "/me/attendance", icon: CalendarDays },
  { label: "Field", path: "/me/field", icon: MapPin },
  { label: "Leave", path: "/me/leave", icon: CalendarPlus },
  { label: "Profile", path: "/me/profile", icon: User },
];

export default function EmployeeLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, isEmployee } = useAuth();
  const { data: me } = useMyEmployee();
  useNotificationsRealtime(); // one realtime subscription for the whole portal (bell renders twice)

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

        {/* Profile — tap to open My Profile */}
        <button
          onClick={() => navigate("/me/profile")}
          className="px-5 py-5 flex items-center gap-3 border-b border-white/15 text-left hover:bg-white/10 transition-colors group"
        >
          <Avatar className="w-11 h-11 ring-2 ring-white/40">
            <StoredAvatarImage path={me?.photo_url} alt={fullName} />
            <AvatarFallback className="bg-white/20 text-white text-sm">{initials || "ME"}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold truncate">{fullName}</p>
            <p className="text-[11px] text-white/70 truncate">{me?.designation || me?.employee_number || "—"}</p>
          </div>
          <ChevronRight className="w-4 h-4 text-white/50 group-hover:text-white/90 shrink-0 transition-colors" />
        </button>

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

        <div className="px-3 py-4 border-t border-white/15 space-y-1">
          {/* Non-Employee roles arrive from the main app — give them a way back */}
          {!isEmployee && (
            <button
              onClick={() => navigate("/home")}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/85 hover:bg-white/15 transition-colors"
            >
              <ArrowLeft className="w-[18px] h-[18px] shrink-0" />
              <span>Back to Main App</span>
            </button>
          )}
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
        <header className="hidden md:flex h-14 border-b border-border bg-card items-center justify-end gap-1.5 px-5 shrink-0">
          <ThemeToggle />
          <NotificationBell seeAllLink="/me/notifications" />
        </header>
        {/* Mobile top bar */}
        <header className="md:hidden h-14 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center gap-2">
            {!isEmployee && (
              <button onClick={() => navigate("/home")} className="text-muted-foreground" aria-label="Back to main app">
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <span className="font-semibold">Employee Portal</span>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell seeAllLink="/me/notifications" />
            <button onClick={handleSignOut} className="text-muted-foreground"><LogOut className="w-5 h-5" /></button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto pb-20 md:pb-0">
          <Outlet />
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)]">
          <div className="grid grid-cols-5">
            {BOTTOM_NAV.map((item) => {
              const active = isActive(item.path, item.end);
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                    active ? "text-indigo-600 dark:text-indigo-400" : "text-muted-foreground",
                  )}
                >
                  <item.icon className={cn("w-5 h-5", active && "scale-110 transition-transform")} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
