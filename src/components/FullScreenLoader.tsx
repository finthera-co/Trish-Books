import { Loader2 } from "lucide-react";

interface FullScreenLoaderProps {
  message?: string;
}

/** Full-screen blocking loader shown while the active tenant is being switched. */
export default function FullScreenLoader({ message = "Switching company…" }: FullScreenLoaderProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="text-sm font-medium text-foreground">{message}</span>
      </div>
    </div>
  );
}
