import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import GlobalTopNav from "./GlobalTopNav";
import { useAuth } from "@/contexts/AuthContext";
import { useIdleTimer } from "@/hooks/useIdleTimer";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import IdleWarningModal from "@/components/IdleWarningModal";
import NetworkStatusOverlay from "@/components/NetworkStatusOverlay";

export default function AppLayout() {
  const { user, signOut } = useAuth();
  const { isIdle, countdown, resetIdle } = useIdleTimer(!!user);
  const { isOffline, isSlow } = useNetworkStatus();

  // Auto-logout when countdown hits 0
  useEffect(() => {
    if (isIdle && countdown === 0) {
      signOut();
    }
  }, [isIdle, countdown, signOut]);

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden">
      <NetworkStatusOverlay isOffline={isOffline} isSlow={isSlow} />
      <GlobalTopNav />
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${isSlow && !isOffline ? "mt-10" : ""}`}>
        <Outlet />
      </div>
      <IdleWarningModal open={isIdle && countdown > 0} countdown={countdown} onStayLoggedIn={resetIdle} />
    </div>
  );
}
