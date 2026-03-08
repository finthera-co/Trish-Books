import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-description">Manage your account and preferences</p>
        </div>
      </div>

      <div className="grid gap-6 max-w-2xl">
        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Company Information</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground">Company Name</label>
              <input type="text" defaultValue="Acme Corporation" className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-card text-foreground" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Email</label>
              <input type="email" defaultValue="admin@acme.com" className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-card text-foreground" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Country</label>
              <input type="text" defaultValue="United States" className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-card text-foreground" />
            </div>
            <Button>Save Changes</Button>
          </div>
        </div>

        <div className="stat-card">
          <h3 className="text-sm font-medium text-foreground mb-4">Notifications</h3>
          <div className="space-y-3">
            {["Invoice due reminders", "Payment confirmations", "Expense approvals"].map((n) => (
              <label key={n} className="flex items-center justify-between">
                <span className="text-sm">{n}</span>
                <input type="checkbox" defaultChecked className="rounded border-input" />
              </label>
            ))}
          </div>
        </div>

        <div className="stat-card border-destructive/20">
          <h3 className="text-sm font-medium text-destructive mb-2">Danger Zone</h3>
          <p className="text-sm text-muted-foreground mb-4">Permanently delete your account and all data.</p>
          <Button variant="destructive" size="sm">Delete Account</Button>
        </div>
      </div>
    </div>
  );
}
