import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Clock } from "lucide-react";

interface IdleWarningModalProps {
  open: boolean;
  countdown: number;
  onStayLoggedIn: () => void;
}

export default function IdleWarningModal({ open, countdown, onStayLoggedIn }: IdleWarningModalProps) {
  const progress = (countdown / 60) * 100;

  return (
    <AlertDialog open={open}>
      <AlertDialogContent className="max-w-sm text-center">
        <AlertDialogHeader className="items-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-warning/10">
            <Clock className="h-7 w-7 text-warning" />
          </div>
          <AlertDialogTitle className="text-xl">Are you still there?</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground">
            You'll be logged out in{" "}
            <span className="font-semibold text-foreground tabular-nums">{countdown}</span>{" "}
            seconds due to inactivity.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="mx-auto my-2 w-48">
          <div className="mb-2 text-2xl font-semibold tabular-nums text-foreground">{countdown}</div>
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-warning transition-all duration-1000 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction onClick={onStayLoggedIn} className="w-full sm:w-auto">
            Stay Logged In
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
