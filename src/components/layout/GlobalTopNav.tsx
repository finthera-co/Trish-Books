import { useNavigate } from "react-router-dom";
import { Plus, LogOut, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNotificationsRealtime } from "@/hooks/useNotificationsRealtime";
import NotificationBell from "@/components/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import GlobalSearchBar from "@/components/layout/GlobalSearchBar";
import BrandMark from "@/components/BrandMark";
import { useNavStore } from "@/stores/useNavStore";
import { formatDateWithWeekday, formatTime } from "@/lib/format";

export default function GlobalTopNav() {
  const { user, appUser, isSuperAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const createMenuOpen = useNavStore((s) => s.createMenuOpen);
  const setCreateMenuOpen = useNavStore((s) => s.setCreateMenuOpen);
  useNotificationsRealtime(); // live notification toasts + bell refresh

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center gap-4 px-5 shrink-0 shadow-sm">
      {/* Logo */}
      <button onClick={() => navigate("/home")} className="flex items-center gap-2.5 shrink-0 group">
        <BrandMark className="w-10 h-10 shrink-0 rounded-xl shadow-sm transition-transform duration-200 group-hover:scale-105" />
        <span className="text-sm font-bold text-foreground hidden sm:inline tracking-tight">Trish Books</span>
      </button>

      {/* Search */}
      <div className="flex-1 flex justify-center min-w-0">
        <GlobalSearchBar />
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Date + last login */}
        <div className="hidden lg:flex flex-col items-end leading-tight mr-1.5 pr-2 border-r border-border">
          <span className="text-xs font-medium text-foreground">{formatDateWithWeekday(new Date())}</span>
          {user?.last_sign_in_at && (
            <span className="text-[10px] text-muted-foreground">Last login {formatTime(user.last_sign_in_at)}</span>
          )}
        </div>

        {/* + Create — only for tenant users, NOT Super Admin */}
        {!isSuperAdmin && (
          <DropdownMenu open={createMenuOpen} onOpenChange={setCreateMenuOpen}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9 text-xs gap-1.5 rounded-lg shadow-sm">
                <Plus className="w-4 h-4" /> Create
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => navigate("/accounting/journals")}>Journal entry</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/sales/invoices/new")}>Invoice</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/expenses/tracker")}>Expense</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/banking/write-checks")}>Payment voucher</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/accounting/bills/new")}>Bill</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/accounting/credit-notes")}>Credit note</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/sales/customers")}>Customer</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/accounting/vendors")}>Vendor</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate("/payroll/runs")}>Payroll run</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <ThemeToggle />

        <NotificationBell seeAllLink="/notifications" />

        {/* User */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2.5 rounded-lg hover:bg-muted px-2 py-1.5 transition-all duration-200">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-[hsl(280,65%,60%)] flex items-center justify-center text-[11px] font-bold text-primary-foreground shadow-sm">
                {appUser ? `${appUser.first_name[0]}${appUser.last_name[0]}` : "?"}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-xs font-semibold text-foreground leading-tight">
                  {appUser ? `${appUser.first_name} ${appUser.last_name}` : "..."}
                </p>
                <p className="text-[10px] text-muted-foreground">{appUser?.role_name || ""}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-2 py-1.5">
              <p className="text-xs font-semibold text-foreground leading-tight truncate">
                {appUser ? `${appUser.first_name} ${appUser.last_name}` : "..."}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">{appUser?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/profile")}>
              <User className="w-3.5 h-3.5 mr-2" /> My profile
            </DropdownMenuItem>
            {!isSuperAdmin && (
              <DropdownMenuItem onClick={() => navigate("/settings/general")}>Settings</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut className="w-3.5 h-3.5 mr-2" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
