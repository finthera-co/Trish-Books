import { WifiOff, Loader2 } from "lucide-react";

interface NetworkStatusOverlayProps {
  isOffline: boolean;
  isSlow: boolean;
}

export default function NetworkStatusOverlay({ isOffline, isSlow }: NetworkStatusOverlayProps) {
  if (!isOffline && !isSlow) return null;

  if (isOffline) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background/95 backdrop-blur-sm">
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-destructive/10">
            <WifiOff className="h-10 w-10 text-destructive" />
          </div>
          <h2 className="text-2xl font-semibold text-foreground">No Internet Connection</h2>
          <p className="max-w-xs text-sm text-muted-foreground">
            Please check your network connection. The app will automatically reconnect when you're back online.
          </p>
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Waiting for connection…
          </div>
        </div>
      </div>
    );
  }

  // Slow connection banner
  return (
    <div className="fixed top-0 left-0 right-0 z-[99] flex items-center justify-center gap-2 bg-warning/90 px-4 py-2 text-warning-foreground text-sm font-medium shadow-md">
      <Loader2 className="h-4 w-4 animate-spin" />
      Connection is slow…
    </div>
  );
}
