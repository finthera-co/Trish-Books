import { useNavigate } from "react-router-dom";
import { Search, Plus, Building2, LogOut, ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import NotificationBell from "@/components/NotificationBell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function GlobalTopNav() {
  const { appUser, isSuperAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-5 shrink-0 shadow-sm">
      {/* Left: Logo + Search */}
      <div className="flex items-center gap-5">
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5 shrink-0 group">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm transition-transform duration-200 group-hover:scale-105">
            <span className="text-xs font-bold text-primary-foreground">FT</span>
          </div>
          <span className="text-sm font-bold text-foreground hidden sm:inline tracking-tight">Finthera</span>
        </button>

        <div className="hidden sm:flex items-center gap-2 bg-muted/60 border border-border rounded-lg px-3.5 py-2 w-72 transition-all duration-200 focus-within:border-primary/40 focus-within:shadow-sm focus-within:bg-card">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search anything here..."
            className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
          />
        </div>
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

        <NotificationBell />

        {/* Company Switcher — only for tenant users */}
        {!isSuperAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="hidden md:flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted text-xs text-muted-foreground transition-all duration-200">
                <Building2 className="w-4 h-4" />
                <span className="max-w-[100px] truncate">{appUser?.tenant_id ? "My Company" : "—"}</span>
                <ChevronDown className="w-3 h-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem>My Company</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

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
