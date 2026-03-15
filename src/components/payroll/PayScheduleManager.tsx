import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { usePaySchedules, useCreatePaySchedule } from "@/hooks/usePayroll";
import { Plus, Calendar } from "lucide-react";

export default function PayScheduleManager() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState("monthly");
  const [description, setDescription] = useState("");

  const { data: schedules } = usePaySchedules();
  const createSchedule = useCreatePaySchedule();

  const handleCreate = async () => {
    await createSchedule.mutateAsync({ name, frequency, description: description || undefined });
    setOpen(false);
    setName("");
    setFrequency("monthly");
    setDescription("");
  };

  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Calendar className="w-4 h-4" />
          Pay Schedules
        </h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm"><Plus className="w-3 h-3" /> Add</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create Pay Schedule</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-4">
              <div>
                <label className="text-sm font-medium text-foreground">Name *</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground"
                  placeholder="e.g. Monthly Salaried" />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Frequency</label>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground">
                  <option value="weekly">Weekly</option>
                  <option value="bi-weekly">Bi-Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Description</label>
                <input type="text" value={description} onChange={(e) => setDescription(e.target.value)}
                  className="mt-1 w-full text-sm border border-input rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
              <Button onClick={handleCreate} disabled={!name || createSchedule.isPending} className="w-full">
                {createSchedule.isPending ? "Creating..." : "Create Schedule"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {!schedules?.length ? (
        <p className="text-sm text-muted-foreground">No pay schedules. Create one to organize payroll runs.</p>
      ) : (
        <div className="space-y-2">
          {schedules.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.frequency}{s.description ? ` — ${s.description}` : ""}</p>
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground capitalize">
                {s.frequency}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
