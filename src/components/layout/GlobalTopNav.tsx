import { useNavigate } from "react-router-dom";
import { Plus, LogOut } from "lucide-react";
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

export default function GlobalTopNav() {
  const { appUser, isSuperAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  useNotificationsRealtime(); // live notification toasts + bell refresh

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-5 shrink-0 shadow-sm">
      {/* Left: Logo + Search */}
      <div className="flex items-center gap-5">
        <button onClick={() => navigate("/home")} className="flex items-center gap-2.5 shrink-0 group">
          <BrandMark className="w-8 h-8 shrink-0 rounded-lg shadow-sm transition-transform duration-200 group-hover:scale-105" />
          <span className="text-sm font-bold text-foreground hidden sm:inline tracking-tight">Trish Books</span>
        </button>

        <GlobalSearchBar />
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1.5">
        {/* + Create — only for tenant users, NOT Super Admin */}
        {!isSuperAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9 text-xs gap-1.5 rounded-lg shadow-sm">
                <Plus className="w-4 h-4" /> Create
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => navigate("/accounting/journals")}>Journal Entry</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/sales/invoices")}>Invoice</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/expenses/tracker")}>Expense</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/banking/payment-vouchers")}>Payment Voucher</DropdownMenuItem>
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
          <DropdownMenuContent align="end" className="w-48">
            {!isSuperAdmin && (
              <DropdownMenuItem onClick={() => navigate("/settings/general")}>Settings</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
              <LogOut className="w-3.5 h-3.5 mr-2" /> Sign Out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
