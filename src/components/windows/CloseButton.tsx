import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Closes the current page outright — no dock entry, just navigate away.
 * Since the live page's window (if any) is never minimized while you're
 * viewing it, WindowedOutlet's own navigate-away cleanup already discards it
 * the moment we leave — no store interaction needed here.
 */
export default function CloseButton() {
  const navigate = useNavigate();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => navigate("/home")}
          aria-label="Close this page"
          className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors duration-200"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Close</TooltipContent>
    </Tooltip>
  );
}
