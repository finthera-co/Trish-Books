import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useNavStore } from "@/stores/useNavStore";

const GROUPS: { heading: string; shortcuts: { keys: string[]; description: string }[] }[] = [
  {
    heading: "Navigation",
    shortcuts: [
      { keys: ["⌘", "K"], description: "Focus search" },
      { keys: ["G", "H"], description: "Go to Home" },
      { keys: ["G", "A"], description: "Go to Accounting" },
      { keys: ["G", "S"], description: "Go to Sales" },
      { keys: ["G", "B"], description: "Go to Banking" },
      { keys: ["G", "R"], description: "Go to Reports" },
      { keys: ["G", "P"], description: "Go to Payroll" },
    ],
  },
  {
    heading: "Actions",
    shortcuts: [
      { keys: ["N"], description: "Open + Create menu" },
      { keys: ["⌘", "D"], description: "Bookmark / unbookmark this page" },
      { keys: ["⌘", "B"], description: "Toggle sidebar pinned" },
      { keys: ["?"], description: "Open this dialog" },
    ],
  },
];

export default function KeyboardShortcutsDialog() {
  const open = useNavStore((s) => s.shortcutsDialogOpen);
  const setOpen = useNavStore((s) => s.setShortcutsDialogOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Speed through Trish Books without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {GROUPS.map((group) => (
            <div key={group.heading}>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {group.heading}
              </p>
              <div className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.description} className="flex items-center justify-between gap-4">
                    <span className="text-sm text-foreground">{s.description}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="min-w-[1.5rem] text-center px-1.5 py-0.5 rounded-md border border-border bg-muted text-[11px] font-mono font-semibold text-foreground"
                        >
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
