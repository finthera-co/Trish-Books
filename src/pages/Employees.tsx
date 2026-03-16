import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useEmployees, useCreateEmployee } from "@/hooks/useData";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useMyPermissions } from "@/hooks/usePermissions";

export default function Employees() {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");
  const [salary, setSalary] = useState(0);
  const [hireDate, setHireDate] = useState(new Date().toISOString().split("T")[0]);

  const { data: employees, isLoading } = useEmployees();
  const createEmployee = useCreateEmployee();

  const filtered = employees?.filter((e) =>
    `${e.first_name} ${e.last_name}`.toLowerCase().includes(search.toLowerCase()) ||
    (e.email || "").toLowerCase().includes(search.toLowerCase()) ||
    (e.department || "").toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = async () => {
    await createEmployee.mutateAsync({
      first_name: firstName,
      last_name: lastName,
      email: email || undefined,
      department: department || undefined,
      salary: salary || undefined,
      hire_date: hireDate || undefined,
    });
    setOpen(false);
    setFirstName("");
    setLastName("");
    setEmail("");
    setDepartment("");
    setSalary(0);
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4" />Add Employee</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Employee</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">First Name</label>
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" required />
                </div>
                <div>
                  <label className="text-sm font-medium">Last Name</label>
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" required />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Department</label>
                  <input type="text" value={department} onChange={(e) => setDepartment(e.target.value)}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" placeholder="Finance" />
                </div>
                <div>
                  <label className="text-sm font-medium">Salary</label>
                  <input type="number" value={salary || ""} onChange={(e) => setSalary(Number(e.target.value))}
                    className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Hire Date</label>
                <input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)}
                  className="mt-1 w-full text-sm border rounded-md px-3 py-2 bg-background text-foreground" />
              </div>
              <Button onClick={handleCreate} disabled={!firstName || !lastName || createEmployee.isPending} className="w-full">
                {createEmployee.isPending ? "Adding..." : "Add Employee"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
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
            <thead><tr><th>Name</th><th>Email</th><th>Department</th><th>Hire Date</th><th className="text-right">Salary</th></tr></thead>
            <tbody>
              {filtered.map((emp) => (
                <tr key={emp.id}>
                  <td className="font-medium text-foreground">{emp.first_name} {emp.last_name}</td>
                  <td className="text-muted-foreground">{emp.email || "-"}</td>
                  <td>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                      {emp.department || "Unassigned"}
                    </span>
                  </td>
                  <td className="text-muted-foreground">{emp.hire_date || "-"}</td>
                  <td className="text-right font-medium text-foreground">{emp.salary ? `LKR ${Number(emp.salary).toLocaleString()}` : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
