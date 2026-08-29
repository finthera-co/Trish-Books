import { useLocation, useNavigate } from "react-router-dom";
import { Minus } from "lucide-react";
import { useWindowsStore } from "@/stores/useWindowsStore";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Minimizes the current page into the dock and frees up the main view. */
export default function MinimizeButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const minimize = useWindowsStore((s) => s.minimize);

  const handleMinimize = () => {
    minimize(location.pathname + location.search);
    navigate("/home");
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleMinimize}
          aria-label="Minimize this page"
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors duration-200"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Minimize</TooltipContent>
    </Tooltip>
  );
}
