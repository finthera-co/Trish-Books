import { Plus, Search, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useEmployees, useCreateEmployee } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useMyPermissions } from "@/hooks/usePermissions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import CompensationDialog from "@/components/employees/CompensationDialog";

const EMPTY_FORM = {
  first_name: "", last_name: "", nic_number: "", tin_number: "",
  date_of_birth: "", gender: "", civil_status: "", personal_phone: "", email: "",
  address_line1: "", address_line2: "", city: "", district: "", postal_code: "",
  designation: "", department: "", hire_date: new Date().toISOString().split("T")[0],
  employment_type: "salaried", pay_rate_type: "monthly", status: "active", manager_id: "",
  epf_number: "", is_epf_applicable: true, is_etf_applicable: true, is_paye_applicable: false,
  bank_name: "", bank_branch: "", bank_account_no: "", bank_account_name: "",
};

export default function Employees() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const set = (k: keyof typeof EMPTY_FORM, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const [selectedEmployee, setSelectedEmployee] = useState<any>(null);
  const [compOpen, setCompOpen] = useState(false);

  // Smart defaults: non-permanent staff default to no statutory deductions
  const onEmploymentTypeChange = (val: string) => {
    const nonStatutory = ["contract", "casual", "intern", "consultant"].includes(val);
    setForm((f) => ({ ...f, employment_type: val, is_epf_applicable: !nonStatutory, is_etf_applicable: !nonStatutory }));
  };

  const { data: employees, isLoading } = useEmployees();
  const createEmployee = useCreateEmployee();
  const { canEdit: canEditPayroll } = useMyPermissions();

  const filtered = employees?.filter((e) =>
    `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
    (e.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (e.department || "").toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = async () => {
    if (!form.first_name || !form.nic_number || !form.tin_number || !form.designation) {
      toast.error("First name, NIC, TIN, and Designation are required");
      return;
    }
    const payload: any = {};
    Object.entries(form).forEach(([k, v]) => {
      if (typeof v === "boolean") payload[k] = v;
      else if (v !== "" && v != null) payload[k] = v;
    });
    await createEmployee.mutateAsync(payload);
    setForm({ ...EMPTY_FORM });
    setOpen(false);
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
        {canEditPayroll("payroll") && <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />Add Employee</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Add Employee</DialogTitle></DialogHeader>
            <Tabs defaultValue="personal" className="pt-2">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="personal">Personal</TabsTrigger>
                <TabsTrigger value="address">Address</TabsTrigger>
                <TabsTrigger value="employment">Employment</TabsTrigger>
                <TabsTrigger value="statutory">Statutory & Bank</TabsTrigger>
              </TabsList>

              <TabsContent value="personal" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>First Name *</Label><Input value={form.first_name} onChange={(e) => set("first_name", e.target.value)} /></div>
                  <div><Label>Last Name</Label><Input value={form.last_name} onChange={(e) => set("last_name", e.target.value)} /></div>
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
                </div>
              </TabsContent>

              <TabsContent value="statutory" className="space-y-4 pt-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>TIN No *</Label><Input value={form.tin_number} onChange={(e) => set("tin_number", e.target.value)} /></div>
                  <div><Label>EPF No</Label><Input value={form.epf_number} onChange={(e) => set("epf_number", e.target.value)} /></div>
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

            <div className="flex justify-end gap-2 pt-4 border-t mt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createEmployee.isPending}>
                {createEmployee.isPending ? "Adding..." : "Add Employee"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Employees</p><p className="text-xl font-semibold text-foreground mt-1">{employees?.length || 0}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Departments</p><p className="text-xl font-semibold text-foreground mt-1">{departments.size}</p></div>
        <div className="stat-card"><p className="text-sm text-muted-foreground">Total Payroll</p><p className="text-xl font-semibold text-foreground mt-1">LKR {totalSalary.toLocaleString()}/mo</p></div>
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
            <thead><tr><th>Emp No</th><th>Name</th><th>Designation</th><th>Department</th><th>Hire Date</th><th className="text-right">Actions</th></tr></thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id}>
                  <td className="text-muted-foreground">{(emp as any).employee_number || "-"}</td>
                  <td className="font-medium text-foreground">{emp.first_name} {emp.last_name}</td>
                  <td className="text-muted-foreground">{(emp as any).designation || "-"}</td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {emp.department || "Unassigned"}
                    </span>
                  </td>
                  <td className="text-muted-foreground">{emp.hire_date || "-"}</td>
                  <td className="text-right">
                    <Button variant="outline" size="sm" onClick={() => openCompensation(emp)}>
                      <Wallet className="w-3.5 h-3.5" />Compensation
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <CompensationDialog employee={selectedEmployee} open={compOpen} onOpenChange={setCompOpen} />
    </div>
  );
}
