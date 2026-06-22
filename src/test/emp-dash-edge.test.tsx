import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Realistic fresh-employee + edge data: open visit present, holidays present,
// no payslips. PayStub is rendered for real (not mocked) to catch null derefs.
const openVisit = { id: "v1", client_name: "Acme", check_in_at: "2024-06-01T09:00:00Z" };
const holidays = [
  { id: "h1", holiday_date: "2026-06-25", name: "Poson Poya" },
  { id: "h2", holiday_date: null, name: "Bad date holiday" },

];

vi.mock("@/hooks/useMyEmployee", () => ({
  useMyEmployee: () => ({ data: { id: "e1", first_name: "Nimal", designation: "Accountant" } }),
  useMyPayslips: () => ({ data: [], isLoading: false }),
  useTenantBranding: () => ({ data: { company_name: "Acme", logo_url: null } }),
}));
vi.mock("@/hooks/useLeave", () => ({
  useLeaveBalances: () => ({ data: [] }),
  useLeaveRequests: () => ({ data: [] }),
  useLeaveTypes: () => ({ data: [] }),
}));
vi.mock("@/hooks/useAttendance", () => ({
  useAttendanceRecords: () => ({ data: [] }),
  useHolidays: () => ({ data: holidays }),
}));
vi.mock("@/hooks/useFieldVisits", () => ({ useMyOpenVisit: () => ({ data: openVisit }) }));

import EmployeeDashboard from "@/pages/employee/EmployeeDashboard";

describe("EmployeeDashboard edge data", () => {
  it("mounts with open visit + holidays + no payslips", () => {
    expect(() => render(<MemoryRouter><EmployeeDashboard /></MemoryRouter>)).not.toThrow();
  });
});
