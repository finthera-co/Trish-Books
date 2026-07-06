import { Plus, Search, Wallet, Upload, KeyRound, Users, Building2, Pencil, Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/KpiCard";
import { useState, useMemo, useRef, type ReactNode } from "react";
import { findBiometricConflict } from "@/lib/attendanceMapping";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { useEmployees, useCreateEmployee, useProvisionEmployee, useUpdateEmployee, useDeleteEmployee } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useMyPermissions } from "@/hooks/usePermissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import CompensationDialog from "@/components/employees/CompensationDialog";
import { useAuth } from "@/contexts/AuthContext";
import { StoredAvatarImage } from "@/components/StoredAvatarImage";

const EMPTY_FORM = {
  full_name: "",
  first_name: "", middle_name: "", last_name: "", nic_number: "", tin_number: "",
  date_of_birth: "", gender: "", civil_status: "", personal_phone: "", email: "",
  address_line1: "", address_line2: "", city: "", district: "", postal_code: "",
  designation: "", department: "", hire_date: new Date().toISOString().split("T")[0],
  termination_date: "",
  employment_type: "salaried", pay_rate_type: "monthly", status: "active", manager_id: "",
  epf_number: "", is_epf_applicable: true, is_etf_applicable: true, is_paye_applicable: false, bik_monthly_value: 0,
  bank_name: "", bank_branch: "", bank_account_no: "", bank_account_name: "",
  biometric_id: "", photo_url: "",
  create_login: true, login_password: "",
};

/** Split a typed full name into first / middle / last as a convenience (all stay editable). */
function splitFullName(full: string) {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "", middle_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], middle_name: "", last_name: "" };
  if (parts.length === 2) return { first_name: parts[0], middle_name: "", last_name: parts[1] };
  return { first_name: parts[0], middle_name: parts.slice(1, -1).join(" "), last_name: parts[parts.length - 1] };
}

/** Map an existing employee record onto the editable form shape. */
function formFromEmployee(emp: any) {
  const form: any = { ...EMPTY_FORM, create_login: false, login_password: "" };
  Object.keys(EMPTY_FORM).forEach((k) => {
    if (k in emp && emp[k] != null) form[k] = emp[k];
  });
  form.full_name = [emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(" ");
  return form;
}

/** Title-case a stored enum-ish value like "civil_status" → "Civil Status". */
function pretty(v?: string | null) {
  if (v == null || v === "") return "—";
  return String(v).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One label/value row in the read-only details view. */
function DetailField({ label, value }: { label: string; value?: ReactNode }) {
  const empty = value == null || value === "" || value === "—";
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm ${empty ? "text-muted-foreground" : "text-foreground"}`}>{empty ? "—" : value}</dd>
    </div>
  );
}

export default function Employees() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const set = (k: keyof typeof EMPTY_FORM, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [compOpen, setCompOpen] = useState(false);
  const [viewEmployee, setViewEmployee] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [reauthEmail, setReauthEmail] = useState("");
  const [reauthPassword, setReauthPassword] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { appUser } = useAuth();

  // Smart defaults: non-permanent staff default to no statutory deductions
  const onEmploymentTypeChange = (val: string) => {
    const nonStatutory = ["contract", "casual", "intern", "consultant"].includes(val);
    setForm((f) => ({ ...f, employment_type: val, is_epf_applicable: !nonStatutory, is_etf_applicable: !nonStatutory }));
  };

  // Typing the full name auto-fills the split fields (still editable below).
  const onFullNameChange = (val: string) => {
    setForm((f) => ({ ...f, full_name: val, ...splitFullName(val) }));
  };

  const onPickPhoto = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file"); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be under 5 MB"); return; }
    setUploadingPhoto(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      // Tenant-prefixed path so storage RLS can scope reads/writes to the tenant.
      const path = `${appUser!.tenant_id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("employee-photos").upload(path, file, { upsert: true });
      if (error) throw error;
      // Private bucket: store the object path; it is signed on render.
      set("photo_url", path);
    } catch (e: any) {
      toast.error("Photo upload failed: " + (e?.message ?? "unknown error"));
    } finally {
      setUploadingPhoto(false);
    }
  };

  const { data: employees, isLoading } = useEmployees();
  const createEmployee = useCreateEmployee();
  const provisionEmployee = useProvisionEmployee();
  const updateEmployee = useUpdateEmployee();
  const deleteEmployee = useDeleteEmployee();
  const { canEdit: canEditPayroll } = useMyPermissions();

  const filtered = employees?.filter((e) =>
    `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
    (e.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (e.department || "").toLowerCase().includes(search.toLowerCase())
  ) || [];

  const isFormDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(EMPTY_FORM), [form]);
  useUnsavedChangesWarning(open && isFormDirty);

  const handleSave = async () => {
    if (!form.first_name || !form.nic_number || !form.tin_number || !form.designation) {
      toast.error("First name, NIC, TIN, and Designation are required");
      return;
    }
    const bioConflict = findBiometricConflict(
      (employees ?? []).filter((e) => e.id !== editingId),
      form.biometric_id,
    );
    if (bioConflict) {
      toast.error(`Device ID already linked to ${bioConflict.name}`);
      return;
    }

    // Build the employee payload (drop UI-only keys; keep booleans even if false).
    const { full_name, create_login, login_password, ...fields } = form;
    const payload: any = {};
    Object.entries(fields).forEach(([k, v]) => {
      if (typeof v === "boolean") payload[k] = v;
      else if (v !== "" && v != null) payload[k] = v;
    });

    if (editingId) {
      await updateEmployee.mutateAsync({ id: editingId, ...payload });
    } else if (create_login) {
      if (!form.email) { toast.error("Email is required to create a login account"); return; }
      if (!form.login_password || form.login_password.length < 8) {
        toast.error("Set a temporary password of at least 8 characters");
        return;
      }
      await provisionEmployee.mutateAsync({ ...payload, password: login_password });
    } else {
      await createEmployee.mutateAsync(payload);
    }
    closeDialog();
  };

  const isSaving = createEmployee.isPending || provisionEmployee.isPending || updateEmployee.isPending;

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setOpen(true);
  };

  const openEdit = (emp: any) => {
    setEditingId(emp.id);
    setForm(formFromEmployee(emp));
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const openDelete = (emp: any) => {
    setDeleteTarget(emp);
    setReauthEmail(appUser?.email ?? "");
    setReauthPassword("");
  };

  const closeDelete = () => {
    setDeleteTarget(null);
    setReauthEmail("");
    setReauthPassword("");
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    if (!reauthEmail || !reauthPassword) {
      toast.error("Enter your admin email and password to confirm");
      return;
    }
    if (reauthEmail.trim().toLowerCase() !== (appUser?.email ?? "").toLowerCase()) {
      toast.error("Use your own admin account credentials");
      return;
    }

    setVerifying(true);
    try {
      // Re-authenticate the current admin before allowing a destructive delete.
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: reauthEmail.trim(),
        password: reauthPassword,
      });
      if (authError) {
        toast.error("Incorrect password — deletion cancelled");
        return;
      }
      await deleteEmployee.mutateAsync({
        id: deleteTarget.id,
        name: `${deleteTarget.first_name} ${deleteTarget.last_name}`,
      });
      closeDelete();
    } finally {
      setVerifying(false);
    }
  };

  const openCompensation = (emp: any) => {
    setSelectedEmployee(emp);
    setCompOpen(true);
  };

  const totalSalary = employees?.reduce((s, e) => s + Number(e.salary || 0), 0) || 0;
  const departments = new Set(employees?.map(e => e.department).filter(Boolean));

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Employees</h1>
          <p className="page-description">Manage employee records and departments</p>
        </div>
        {canEditPayroll("payroll") && <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeDialog())}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}><Plus className="w-4 h-4" />Add Employee</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>{editingId ? "Edit Employee" : "Add Employee"}</DialogTitle></DialogHeader>
            <Tabs defaultValue="personal" className="pt-2">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="personal">Personal</TabsTrigger>
                <TabsTrigger value="address">Address</TabsTrigger>
                <TabsTrigger value="employment">Employment</TabsTrigger>
                <TabsTrigger value="statutory">Statutory & Bank</TabsTrigger>
              </TabsList>

              <TabsContent value="personal" className="space-y-4 pt-4">
                {/* Photo + full name */}
                <div className="flex items-center gap-4">
                  <Avatar className="w-20 h-20 rounded-2xl ring-1 ring-border">
                    <StoredAvatarImage path={form.photo_url} className="object-cover" />
                    <AvatarFallback className="rounded-2xl bg-muted text-muted-foreground">
                      {(form.first_name?.[0] ?? "") + (form.last_name?.[0] ?? "") || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <input ref={fileRef} type="file" accept="image/*" className="hidden"
                      onChange={(e) => onPickPhoto(e.target.files?.[0] ?? null)} />
                    <Button type="button" variant="outline" size="sm" disabled={uploadingPhoto}
                      onClick={() => fileRef.current?.click()}>
                      <Upload className="w-3.5 h-3.5" />{uploadingPhoto ? "Uploading…" : form.photo_url ? "Change photo" : "Upload photo"}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-1">Square image recommended (max 5 MB).</p>
                  </div>
                </div>
                <div>
                  <Label>Full Name</Label>
                  <Input value={form.full_name} onChange={(e) => onFullNameChange(e.target.value)} placeholder="e.g. Nimal Perera Bandara" />
                  <p className="text-xs text-muted-foreground mt-1">We'll split this into the fields below — edit any of them if needed.</p>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div><Label>First Name *</Label><Input value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></div>
                  <div><Label>Middle Name</Label><Input value={form.middle_name} onChange={(e) => set("middle_name", e.target.value)} /></div>
                  <div><Label>Last Name</Label><Input value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>NIC No *</Label><Input value={form.nic_number} onChange={(e) => set("nic_number", e.target.value)} /></div>
                  <div><Label>Date of Birth</Label><Input type="date" value={form.date_of_birth} onChange={(e) => set("date_of_birth", e.target.value)} /></div>
                  <div><Label>Gender</Label>
                    <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Civil Status</Label>
                    <Select value={form.civil_status} onValueChange={(v) => set("civil_status", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="single">Single</SelectItem>
                        <SelectItem value="married">Married</SelectItem>
                        <SelectItem value="divorced">Divorced</SelectItem>
                        <SelectItem value="widowed">Widowed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Personal Phone</Label><Input value={form.personal_phone} onChange={(e) => set("personal_phone", e.target.value)} /></div>
                  <div><Label>Email</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></div>
                </div>
              </TabsContent>

              <TabsContent value="address" className="space-y-4 pt-4">
                <div><Label>Address Line 1</Label><Input value={form.address_line1} onChange={(e) => set("address_line1", e.target.value)} /></div>
                <div><Label>Address Line 2</Label><Input value={form.address_line2} onChange={(e) => set("address_line2", e.target.value)} /></div>
                <div className="grid grid-cols-3 gap-4">
                  <div><Label>City</Label><Input value={form.city} onChange={(e) => set("city", e.target.value)} /></div>
                  <div><Label>District</Label><Input value={form.district} onChange={(e) => set("district", e.target.value)} /></div>
                  <div><Label>Postal Code</Label><Input value={form.postal_code} onChange={(e) => set("postal_code", e.target.value)} /></div>
                </div>
              </TabsContent>

              <TabsContent value="employment" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Designation *</Label><Input value={form.designation} onChange={(e) => set("designation", e.target.value)} /></div>
                  <div><Label>Department</Label><Input value={form.department} onChange={(e) => set("department", e.target.value)} /></div>
                  <div><Label>Hire Date</Label><Input type="date" value={form.hire_date} onChange={(e) => set("hire_date", e.target.value)} /></div>
                  <div><Label>Termination Date</Label><Input type="date" value={form.termination_date} onChange={(e) => set("termination_date", e.target.value)} /><p className="text-[11px] text-muted-foreground mt-1">Set on exit — pay is pro-rated to this day.</p></div>
                  <div><Label>Employment Type</Label>
                    <Select value={form.employment_type} onValueChange={onEmploymentTypeChange}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="salaried">Salaried (Permanent)</SelectItem>
                        <SelectItem value="contract">Contract</SelectItem>
                        <SelectItem value="casual">Casual</SelectItem>
                        <SelectItem value="intern">Intern</SelectItem>
                        <SelectItem value="consultant">Consultant</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Pay Rate Type</Label>
                    <Select value={form.pay_rate_type} onValueChange={(v) => set("pay_rate_type", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly (salaried)</SelectItem>
                        <SelectItem value="hourly">Hourly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Status</Label>
                    <Select value={form.status} onValueChange={(v) => set("status", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="onboarding">Onboarding</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2"><Label>Reports To</Label>
                    <Select value={form.manager_id} onValueChange={(v) => set("manager_id", v)}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        {employees?.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.first_name} {m.last_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label>Biometric / Device ID</Label>
                    <Input
                      value={form.biometric_id}
                      onChange={(e) => set("biometric_id", e.target.value)}
                      placeholder="AC-No as enrolled on the fingerprint scanner (optional)"
                    />
                    {(() => {
                      const conflict = findBiometricConflict(employees ?? [], form.biometric_id);
                      return conflict ? (
                        <p className="text-xs text-destructive mt-1">
                          Device ID already linked to {conflict.employee_number ? conflict.employee_number + " — " : ""}{conflict.name}.
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">
                          The ID this employee is enrolled under on the attendance device. Leave blank if not yet
                          enrolled — you can link it later when importing attendance.
                        </p>
                      );
                    })()}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="statutory" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>TIN No *</Label><Input value={form.tin_number} onChange={(e) => set("tin_number", e.target.value)} /></div>
                  <div><Label>EPF No</Label><Input value={form.epf_number} onChange={(e) => set("epf_number", e.target.value)} /></div>
                  <div><Label>Non-cash benefit / month (BIK)</Label><Input type="number" min="0" value={form.bik_monthly_value} onChange={(e) => set("bik_monthly_value", e.target.value)} /><p className="text-[11px] text-muted-foreground mt-1">Taxable for PAYE only — vehicle, housing, etc.</p></div>
                </div>
                <div className="flex gap-6 py-1">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_epf_applicable} onChange={(e) => set("is_epf_applicable", e.target.checked)} /> EPF applicable</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_etf_applicable} onChange={(e) => set("is_etf_applicable", e.target.checked)} /> ETF applicable</label>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_paye_applicable} onChange={(e) => set("is_paye_applicable", e.target.checked)} /> PAYE applicable</label>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Bank</Label><Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></div>
                  <div><Label>Branch</Label><Input value={form.bank_branch} onChange={(e) => set("bank_branch", e.target.value)} /></div>
                  <div><Label>Account No</Label><Input value={form.bank_account_no} onChange={(e) => set("bank_account_no", e.target.value)} /></div>
                  <div><Label>Account Name</Label><Input value={form.bank_account_name} onChange={(e) => set("bank_account_name", e.target.value)} /></div>
                </div>
              </TabsContent>
            </Tabs>

            {/* Self-service login — only offered when creating a new record */}
            {!editingId && (
              <div className="mt-3 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={form.create_login} onChange={(e) => set("create_login", e.target.checked)} />
                  <KeyRound className="w-4 h-4 text-primary" /> Create a self-service login for this employee
                </label>
                {form.create_login ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div><Label>Login Email *</Label><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="employee@company.com" /></div>
                    <div><Label>Temporary Password *</Label><Input type="text" value={form.login_password} onChange={(e) => set("login_password", e.target.value)} placeholder="At least 8 characters" /></div>
                    <p className="col-span-2 text-xs text-muted-foreground">
                      The employee signs in with this email and temporary password to reach their own dashboard (attendance, payslips, leave).
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No login will be created — this is an HR record only. You can add access later.</p>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4 border-t mt-2">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : editingId ? "Save Changes" : "Add Employee"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KpiCard label="Total Employees" value={employees?.length || 0} icon={Users} tone="info" />
        <KpiCard label="Departments" value={departments.size} icon={Building2} tone="violet" />
        <KpiCard label="Total Payroll" value={`LKR ${totalSalary.toLocaleString()}`} sublabel="per month" icon={Wallet} tone="success" />
      </div>

      <div className="stat-card">
        <div className="flex items-center gap-3 mb-4">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>

        {isLoading ? (
          <p className="text-center py-8 text-muted-foreground">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-8 text-muted-foreground">No employees found. Add your first employee to get started.</p>
        ) : (
          <table className="data-table">
            <thead><tr><th>Emp No</th><th>Name</th><th>Designation</th><th>Department</th><th>Access</th><th>Hire Date</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id}>
                  <td className="text-muted-foreground">{(emp as any).employee_number || "-"}</td>
                  <td className="font-medium text-foreground">
                    <button
                      type="button"
                      onClick={() => setViewEmployee(emp)}
                      className="flex items-center gap-2.5 text-left hover:text-primary transition-colors"
                      title="View full details"
                    >
                      <Avatar className="w-8 h-8">
                        <StoredAvatarImage path={(emp as any).photo_url} className="object-cover" />
                        <AvatarFallback className="text-xs bg-muted">{(emp.first_name?.[0] ?? "") + (emp.last_name?.[0] ?? "")}</AvatarFallback>
                      </Avatar>
                      <span className="hover:underline">{emp.first_name} {emp.last_name}</span>
                    </button>
                  </td>
                  <td className="text-muted-foreground">{(emp as any).designation || "-"}</td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {emp.department || "Unassigned"}
                    </span>
                  </td>
                  <td>
                    {(emp as any).user_id ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                        <KeyRound className="w-3 h-3" /> Login
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="text-muted-foreground">{emp.hire_date || "-"}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => openCompensation(emp)}>
                        <Wallet className="w-3.5 h-3.5" />Compensation
                      </Button>
                      {canEditPayroll("payroll") && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => openEdit(emp)} title="Edit employee">
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="outline" size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => openDelete(emp)}
                            title="Delete employee"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CompensationDialog employee={selectedEmployee} open={compOpen} onOpenChange={setCompOpen} />

      {/* Read-only employee details */}
      <Dialog open={!!viewEmployee} onOpenChange={(o) => !o && setViewEmployee(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          {viewEmployee && (() => {
            const emp: any = viewEmployee;
            const manager = employees?.find((m) => m.id === emp.manager_id);
            const flags = [
              emp.is_epf_applicable && "EPF",
              emp.is_etf_applicable && "ETF",
              emp.is_paye_applicable && "PAYE",
            ].filter(Boolean);
            return (
              <>
                <DialogHeader>
                  <DialogTitle>Employee Details</DialogTitle>
                </DialogHeader>

                <div className="flex items-center gap-4 pt-1">
                  <Avatar className="w-20 h-20 rounded-2xl ring-1 ring-border">
                    <StoredAvatarImage path={emp.photo_url} className="object-cover" />
                    <AvatarFallback className="rounded-2xl bg-muted text-muted-foreground text-lg">
                      {(emp.first_name?.[0] ?? "") + (emp.last_name?.[0] ?? "") || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-foreground truncate">
                      {[emp.first_name, emp.middle_name, emp.last_name].filter(Boolean).join(" ")}
                    </p>
                    <p className="text-sm text-muted-foreground">{emp.designation || "—"}{emp.department ? ` · ${emp.department}` : ""}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      {emp.employee_number && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                          {emp.employee_number}
                        </span>
                      )}
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                        {pretty(emp.status)}
                      </span>
                      {emp.user_id && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          <KeyRound className="w-3 h-3" /> Login
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-5 pt-4">
                  <section>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Personal</h3>
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                      <DetailField label="NIC No" value={emp.nic_number} />
                      <DetailField label="Date of Birth" value={emp.date_of_birth} />
                      <DetailField label="Gender" value={pretty(emp.gender)} />
                      <DetailField label="Civil Status" value={pretty(emp.civil_status)} />
                      <DetailField label="Personal Phone" value={emp.personal_phone} />
                      <DetailField label="Email" value={emp.email} />
                    </dl>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Address</h3>
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                      <DetailField label="Address Line 1" value={emp.address_line1} />
                      <DetailField label="Address Line 2" value={emp.address_line2} />
                      <DetailField label="City" value={emp.city} />
                      <DetailField label="District" value={emp.district} />
                      <DetailField label="Postal Code" value={emp.postal_code} />
                    </dl>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Employment</h3>
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                      <DetailField label="Designation" value={emp.designation} />
                      <DetailField label="Department" value={emp.department} />
                      <DetailField label="Hire Date" value={emp.hire_date} />
                      <DetailField label="Employment Type" value={pretty(emp.employment_type)} />
                      <DetailField label="Pay Rate Type" value={pretty(emp.pay_rate_type)} />
                      <DetailField label="Status" value={pretty(emp.status)} />
                      <DetailField label="Reports To" value={manager ? `${manager.first_name} ${manager.last_name}` : "—"} />
                      <DetailField label="Biometric / Device ID" value={emp.biometric_id} />
                    </dl>
                  </section>

                  <section>
                    <h3 className="text-sm font-semibold text-foreground mb-2">Statutory & Bank</h3>
                    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
                      <DetailField label="TIN No" value={emp.tin_number} />
                      <DetailField label="EPF No" value={emp.epf_number} />
                      <DetailField label="Applicable" value={flags.length ? flags.join(", ") : "None"} />
                      <DetailField label="Bank" value={emp.bank_name} />
                      <DetailField label="Branch" value={emp.bank_branch} />
                      <DetailField label="Account No" value={emp.bank_account_no} />
                      <DetailField label="Account Name" value={emp.bank_account_name} />
                    </dl>
                  </section>
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t mt-2">
                  <Button variant="outline" onClick={() => { setViewEmployee(null); openCompensation(emp); }}>
                    <Wallet className="w-3.5 h-3.5" />Compensation
                  </Button>
                  {canEditPayroll("payroll") && (
                    <Button onClick={() => { setViewEmployee(null); openEdit(emp); }}>
                      <Pencil className="w-3.5 h-3.5" />Edit
                    </Button>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && closeDelete()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Delete this employee?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  You're about to permanently delete{" "}
                  <span className="font-medium text-foreground">
                    {deleteTarget?.first_name} {deleteTarget?.last_name}
                  </span>
                  {deleteTarget?.employee_number ? ` (${deleteTarget.employee_number})` : ""}. This cannot be undone.
                </p>
                {deleteTarget?.user_id && (
                  <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                    This employee has a self-service login. Deleting the record will remove their HR profile —
                    consider setting their status to Inactive instead.
                  </p>
                )}
                <p className="text-muted-foreground">
                  Employees with payroll history can't be deleted; set them to Inactive instead.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Re-authenticate the admin before this destructive action */}
          <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" /> Confirm with your admin credentials
            </p>
            <div className="space-y-3">
              <div>
                <Label>Admin Email</Label>
                <Input
                  type="email"
                  value={reauthEmail}
                  onChange={(e) => setReauthEmail(e.target.value)}
                  autoComplete="username"
                  placeholder="you@company.com"
                />
              </div>
              <div>
                <Label>Password</Label>
                <Input
                  type="password"
                  value={reauthPassword}
                  onChange={(e) => setReauthPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Your account password"
                  onKeyDown={(e) => { if (e.key === "Enter") confirmDelete(); }}
                />
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); confirmDelete(); }}
              disabled={verifying || deleteEmployee.isPending || !reauthEmail || !reauthPassword}
            >
              {verifying ? "Verifying..." : deleteEmployee.isPending ? "Deleting..." : "Delete Employee"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
