import { useNavigate } from "react-router-dom";
import { Search, Plus, Bell, Building2, LogOut, ChevronDown } from "lucide-react";
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
  const { appUser, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <header className="h-12 border-b border-border bg-card flex items-center justify-between px-4 shrink-0">
      {/* Left: Logo + Search */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate("/")} className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <span className="text-xs font-bold text-primary-foreground">AB</span>
          </div>
          <span className="text-sm font-semibold text-foreground hidden sm:inline">AccuBooks</span>
        </button>

        <div className="hidden sm:flex items-center gap-2 bg-background border border-border rounded-md px-3 py-1.5 w-64">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search..."
            className="bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none w-full"
          />
        </div>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-2">
        {/* + Create */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 text-xs gap-1">
              <Plus className="w-3.5 h-3.5" /> Create
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navigate("/accounting/journals")}>Journal Entry</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/sales/invoices")}>Invoice</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/expenses/tracker")}>Expense</DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/banking/payment-vouchers")}>Payment Voucher</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <NotificationBell />

        {/* Company Switcher */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-accent text-xs text-muted-foreground transition-colors">
              <Building2 className="w-3.5 h-3.5" />
              <span className="max-w-[100px] truncate">{appUser?.tenant_id ? "My Company" : "—"}</span>
              <ChevronDown className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem>My Company</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-md hover:bg-accent px-1.5 py-1 transition-colors">
              <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center text-[10px] font-semibold text-primary-foreground">
                {appUser ? `${appUser.first_name[0]}${appUser.last_name[0]}` : "?"}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-xs font-medium text-foreground leading-tight">
                  {appUser ? `${appUser.first_name} ${appUser.last_name}` : "..."}
                </p>
                <p className="text-[10px] text-muted-foreground">{appUser?.role_name || ""}</p>
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => navigate("/admin/settings")}>Settings</DropdownMenuItem>
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
