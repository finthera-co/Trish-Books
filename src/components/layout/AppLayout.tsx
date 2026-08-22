import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import GlobalTopNav from "./GlobalTopNav";
import NavRail from "./NavRail";
import AppsSidebar from "./AppsSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { listVerifiedTotpFactors } from "@/hooks/useMfa";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import IdleWarningModal from "@/components/IdleWarningModal";
import NetworkStatusOverlay from "@/components/NetworkStatusOverlay";
import FullScreenLoader from "@/components/FullScreenLoader";
import KeyboardShortcutsDialog from "@/components/KeyboardShortcutsDialog";
import { useGlobalKeyboard } from "@/hooks/useGlobalKeyboard";
import { useAppStore, useHideSidebar, useIsSwitching, useTenantId } from "@/stores/useAppStore";
import { useNavStore, moduleIdForPath } from "@/stores/useNavStore";
import { MODULE_CONFIGS } from "@/config/modules";
import { useQueryClient } from "@tanstack/react-query";

export default function AppLayout() {
  const { user, appUser, signOut, isCompanyAdmin, isSuperAdmin } = useAuth();
  const navigate = useNavigate();
  const { isIdle, countdown, resetIdle } = useIdleTimer(!!user);
  const { isOffline, isSlow } = useNetworkStatus();
  const isSwitching = useIsSwitching();
  const tenantId = useTenantId();
  const setTenantId = useAppStore((s) => s.setTenantId);
  const queryClient = useQueryClient();
  const location = useLocation();
  const activeModule = useNavStore((s) => s.activeModule);
  const setActiveModule = useNavStore((s) => s.setActiveModule);
  const sidebarPinned = useNavStore((s) => s.sidebarPinned);
  const hideSidebar = useHideSidebar();
  const [sidebarHovered, setSidebarHovered] = useState(false);

  useGlobalKeyboard();

  // Derive the active module from the URL on every navigation — covers
  // NavRail clicks, deep links, refreshes and back/forward.
  useEffect(() => {
    setActiveModule(moduleIdForPath(location.pathname));
  }, [location.pathname, setActiveModule]);

  const moduleConfig = activeModule ? MODULE_CONFIGS[activeModule] : null;

  // Keep global tenant store in sync with the authenticated user's tenant.
  // Passing queryClient triggers blocking prefetch of CRITICAL_QUERIES so
  // the first render after login is fully hydrated (zero flicker).
  useEffect(() => {
    setTenantId(appUser?.tenant_id ?? null, queryClient);
  }, [appUser?.tenant_id, setTenantId, queryClient]);

  // Block render until the tenant's critical data is hydrated.
  // Without this gate, child pages would render against an empty cache.
  const needsHydration = !!appUser?.tenant_id && tenantId !== appUser.tenant_id;

  // Auto-logout when countdown hits 0. Automatic, so an unposted journal entry
  // is still waiting when the user signs back in.
  useEffect(() => {
    if (isIdle && countdown === 0) {
      signOut({ automatic: true });
    }
  }, [isIdle, countdown, signOut]);

  // Once per session, nudge admins who haven't enabled two-factor auth.
  useEffect(() => {
    if (!user || !(isCompanyAdmin || isSuperAdmin)) return;
    if (sessionStorage.getItem("mfa-nudge-shown")) return;
    let active = true;
    listVerifiedTotpFactors()
      .then((factors) => {
        if (!active || factors.length > 0) return;
        sessionStorage.setItem("mfa-nudge-shown", "1");
        toast("Protect your admin account", {
          description: "Enable two-factor authentication for stronger security.",
          duration: 10000,
          action: { label: "Enable", onClick: () => navigate("/settings/general") },
        });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user, isCompanyAdmin, isSuperAdmin, navigate]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <NetworkStatusOverlay isOffline={isOffline} isSlow={isSlow} />
      <GlobalTopNav />
      <div className={`flex-1 flex flex-row min-w-0 overflow-hidden ${isSlow && !isOffline ? "mt-10" : ""}`}>
        <NavRail />
        {moduleConfig && !hideSidebar && (
          sidebarPinned ? (
            <AppsSidebar config={moduleConfig} />
          ) : (
            <div
              className="relative w-3 shrink-0"
              onMouseEnter={() => setSidebarHovered(true)}
              onMouseLeave={() => setSidebarHovered(false)}
            >
              {sidebarHovered && (
                <div className="absolute inset-y-0 left-0 z-40 shadow-xl">
                  <AppsSidebar config={moduleConfig} />
                </div>
              )}
            </div>
          )
        )}
        <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-background">
          <Outlet />
        </main>
      </div>
      <IdleWarningModal open={isIdle && countdown > 0} countdown={countdown} onStayLoggedIn={resetIdle} />
      <KeyboardShortcutsDialog />
      {(isSwitching || needsHydration) && <FullScreenLoader />}
    </div>
  );
}
