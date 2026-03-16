import { Outlet, useNavigate } from "react-router-dom";
import AppSidebar from "./AppSidebar";
import { Search, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import NotificationBell from "@/components/NotificationBell";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export default function AppLayout() {
  const { appUser, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <header className="h-14 border-b bg-card flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="mr-1" />
              <div className="flex items-center gap-2 flex-1 max-w-sm">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search transactions, accounts..."
                  className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <NotificationBell />
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-medium text-primary-foreground">
                  {appUser ? `${appUser.first_name[0]}${appUser.last_name[0]}` : "?"}
                </div>
                <div className="text-sm hidden sm:block">
                  <p className="font-medium text-foreground leading-tight">
                    {appUser ? `${appUser.first_name} ${appUser.last_name}` : "Loading..."}
                  </p>
                  <p className="text-xs text-muted-foreground">{appUser?.role_name || ""}</p>
                </div>
              </div>
              <button onClick={handleSignOut} className="p-2 rounded-md hover:bg-accent" title="Sign out">
                <LogOut className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </header>

          {/* Content */}
          <main className="flex-1 p-6 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
