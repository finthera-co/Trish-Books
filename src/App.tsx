import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/components/theme-provider";
import TenantThemeSync from "@/hooks/useTenantTheme";
import ProtectedRoute from "@/components/ProtectedRoute";
import TenantRoute from "@/components/TenantRoute";
import SuperAdminRoute from "@/components/SuperAdminRoute";
import EmployeeRoute from "@/components/EmployeeRoute";
import EmployeeLayout from "./components/layout/EmployeeLayout";
import EmployeeDashboard from "./pages/employee/EmployeeDashboard";
import MyAttendance from "./pages/employee/MyAttendance";
import FieldCheckIn from "./pages/employee/FieldCheckIn";
import MySalarySlips from "./pages/employee/MySalarySlips";
import ApplyLeave from "./pages/employee/ApplyLeave";
import LeaveHistory from "./pages/employee/LeaveHistory";
import MyProfile from "./pages/employee/MyProfile";
import MyNotifications from "./pages/employee/MyNotifications";
import AppLayout from "./components/layout/AppLayout";
import ModuleLayout from "./components/layout/ModuleLayout";
import { MODULE_CONFIGS } from "./config/modules";
import ModuleDashboard from "./pages/ModuleDashboard";

// Pages
import Home from "./pages/Home";
import Notifications from "./pages/Notifications";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Onboarding from "./pages/Onboarding";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import JournalEntries from "./pages/JournalEntries";
import JournalEntryView from "./pages/JournalEntryView";
import JournalEntryEdit from "./pages/JournalEntryEdit";
import Ledger from "./pages/Ledger";
import OpeningBalances from "./pages/OpeningBalances";
import CloseOBE from "./pages/CloseOBE";
import TrialBalance from "./pages/TrialBalance";
import FiscalPeriods from "./pages/FiscalPeriods";
import BankReconciliation from "./pages/BankReconciliation";
import BankStatementImport from "./pages/BankStatementImport";
import SuspenseClearing from "./pages/SuspenseClearing";
import BankImportRules from "./pages/BankImportRules";
import PaymentVouchers from "./pages/PaymentVouchers";
import PettyCash from "./pages/PettyCash";
import PettyCashVoucherForm from "./pages/PettyCashVoucherForm";
import PettyCashVoucherDetail from "./pages/PettyCashVoucherDetail";
import PettyCashReplenishments from "./pages/PettyCashReplenishments";
import PettyCashLedger from "./pages/PettyCashLedger";
import PettyCashCounts from "./pages/PettyCashCounts";
import PettyCashCount from "./pages/PettyCashCount";
import Invoices from "./pages/Invoices";
import CreateInvoice from "./pages/CreateInvoice";
import InvoiceTemplates from "./pages/InvoiceTemplates";
import InvoiceTemplateDesigner from "./pages/InvoiceTemplateDesigner";
import RecurringInvoices from "./pages/RecurringInvoices";
import Quotes from "./pages/Quotes";
import ForeignExchange from "./pages/ForeignExchange";
import ProductsTaxes from "./pages/ProductsTaxes";
import TaxCenter from "./pages/TaxCenter";
import TaxSettings from "./pages/TaxSettings";
import Expenses from "./pages/Expenses";
import Payroll from "./pages/Payroll";
import PayrollGLMapping from "./pages/PayrollGLMapping";
import PayrollLiabilities from "./pages/PayrollLiabilities";
import Gratuity from "./pages/Gratuity";
import Loans from "./pages/Loans";
import RecurringPay from "./pages/RecurringPay";
import Employees from "./pages/Employees";
import AttendanceRegister from "./pages/AttendanceRegister";
import FieldVisits from "./pages/FieldVisits";
import WorkforceDashboard from "./pages/WorkforceDashboard";
import AttendanceImport from "./pages/AttendanceImport";
import BiometricLinking from "./pages/BiometricLinking";
import Leave from "./pages/Leave";
import Reports from "./pages/Reports";
import Budgets from "./pages/Budgets";
import BudgetVsActual from "./pages/BudgetVsActual";
import DataExports from "./pages/DataExports";
import AssetRegister from "./pages/AssetRegister";
import AssetForm from "./pages/AssetForm";
import AssetDetail from "./pages/AssetDetail";
import DepreciationRun from "./pages/DepreciationRun";
import AssetCategories from "./pages/AssetCategories";
import SettingsPage from "./pages/SettingsPage";
import AccountMapping from "./pages/AccountMapping";
import PostingProfiles from "./pages/PostingProfiles";
import UsersPage from "./pages/UsersPage";
import Tenants from "./pages/Tenants";
import Subscriptions from "./pages/Subscriptions";
import AuditLogs from "./pages/AuditLogs";
import ResetPassword from "./pages/ResetPassword";
import AnomalyDashboard from "./pages/AnomalyDashboard";

import ForecastDashboard from "./pages/ForecastDashboard";
import AccountReport from "./pages/AccountReport";
import GLVerification from "./pages/GLVerification";
import CustomersPage from "./pages/CustomersPage";
import CustomerDetail from "./pages/CustomerDetail";
import CustomerStatement from "./pages/CustomerStatement";
import InvoiceApprovals from "./pages/InvoiceApprovals";
import Receipts from "./pages/Receipts";
import DiscountCalculator from "./pages/DiscountCalculator";
import InvoiceSerialRegister from "./pages/InvoiceSerialRegister";
import Deposits from "./pages/Deposits";
import ReceivePayment from "./pages/ReceivePayment";
import CreditNotePage from "./pages/CreditNotePage";
import ARAgingReport from "./pages/ARAgingReport";
import APAgingReport from "./pages/APAgingReport";
import VendorsPage from "./pages/VendorsPage";
import VendorDetail from "./pages/VendorDetail";
import BillsPage from "./pages/BillsPage";
import PayBillsPage from "./pages/PayBillsPage";
import InventoryPage from "./pages/InventoryPage";
import Procurement from "./pages/Procurement";
import BankAccountsPage from "./pages/BankAccountsPage";

// Super Admin pages
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import SystemAnalytics from "./pages/SystemAnalytics";
import ErrorLogs from "./pages/ErrorLogs";
import SuperAdminUsers from "./pages/SuperAdminUsers";
import ErrorBoundary from "@/components/ErrorBoundary";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
    <AuthProvider>
      <TenantThemeSync />
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ErrorBoundary>
          <Routes>
            {/* Public homepage — always the first page, session or not */}
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/onboarding" element={<Onboarding />} />

              {/* ═══════════════════════════════════════════════════
                  EMPLOYEE SELF-SERVICE PORTAL — own dashboard only
                  ═══════════════════════════════════════════════════ */}
              <Route element={<EmployeeRoute />}>
                <Route element={<EmployeeLayout />}>
                  <Route path="/me" element={<EmployeeDashboard />} />
                  <Route path="/me/attendance" element={<MyAttendance />} />
                  <Route path="/me/field" element={<FieldCheckIn />} />
                  <Route path="/me/payslips" element={<MySalarySlips />} />
                  <Route path="/me/leave/apply" element={<ApplyLeave />} />
                  <Route path="/me/leave" element={<LeaveHistory />} />
                  <Route path="/me/profile" element={<MyProfile />} />
                  <Route path="/me/notifications" element={<MyNotifications />} />
                </Route>
              </Route>

              <Route element={<AppLayout />}>
                {/* Home — renders different dashboard based on role */}
                <Route path="/home" element={<Home />} />

                {/* Notifications feed (all alerts) — available to any signed-in user */}
                <Route path="/notifications" element={<Notifications />} />

                {/* ═══════════════════════════════════════════════════
                    SUPER ADMIN ONLY — Control Plane
                    ═══════════════════════════════════════════════════ */}
                <Route element={<SuperAdminRoute />}>
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.superadmin} />}>
                    <Route path="/admin" element={<ModuleDashboard config={MODULE_CONFIGS.superadmin} />} />
                    <Route path="/admin/tenants" element={<Tenants />} />
                    <Route path="/admin/company-admins" element={<UsersPage />} />
                    <Route path="/admin/users" element={<SuperAdminUsers />} />
                    <Route path="/admin/analytics" element={<SystemAnalytics />} />
                    <Route path="/admin/audit-logs" element={<AuditLogs />} />
                    <Route path="/admin/error-logs" element={<ErrorLogs />} />
                    <Route path="/admin/subscriptions" element={<Subscriptions />} />
                  </Route>
                </Route>

                {/* ═══════════════════════════════════════════════════
                    TENANT USERS ONLY — Business Modules
                    ═══════════════════════════════════════════════════ */}
                <Route element={<TenantRoute />}>
                  {/* Accounting module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.accounting} />}>
                    <Route path="/accounting" element={<ModuleDashboard config={MODULE_CONFIGS.accounting} />} />
                    <Route path="/accounting/accounts" element={<ChartOfAccounts />} />
                    <Route path="/accounting/accounts/:id/report" element={<AccountReport />} />
                    <Route path="/accounting/journals" element={<JournalEntries />} />
                    <Route path="/accounting/journals/:id" element={<JournalEntryView />} />
                    <Route path="/accounting/journals/:id/edit" element={<JournalEntryEdit />} />
                    <Route path="/accounting/ledger" element={<Ledger />} />
                    <Route path="/accounting/trial-balance" element={<TrialBalance />} />
                    <Route path="/accounting/fiscal-periods" element={<FiscalPeriods />} />
                    <Route path="/accounting/opening-balances" element={<OpeningBalances />} />
                    <Route path="/accounting/close-obe" element={<CloseOBE />} />
                    <Route path="/accounting/gl-verify" element={<GLVerification />} />
                    <Route path="/accounting/receive-payment" element={<ReceivePayment />} />
                    <Route path="/accounting/credit-notes" element={<CreditNotePage />} />
                    <Route path="/accounting/foreign-exchange" element={<ForeignExchange />} />
                    <Route path="/accounting/ar-aging" element={<ARAgingReport />} />
                    <Route path="/accounting/vendors" element={<VendorsPage />} />
                    <Route path="/accounting/vendors/:id" element={<VendorDetail />} />
                    <Route path="/accounting/bills" element={<BillsPage />} />
                    <Route path="/accounting/pay-bills" element={<PayBillsPage />} />
                    <Route path="/accounting/ap-aging" element={<APAgingReport />} />
                    <Route path="/accounting/inventory" element={<InventoryPage />} />
                    <Route path="/accounting/procurement" element={<Procurement />} />
                    <Route path="/accounting/bank-accounts" element={<BankAccountsPage />} />
                  </Route>

                  {/* Banking module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.banking} />}>
                    <Route path="/banking" element={<ModuleDashboard config={MODULE_CONFIGS.banking} />} />
                    <Route path="/banking/reconciliation" element={<BankReconciliation />} />
                    <Route path="/banking/statement-import" element={<BankStatementImport />} />
                    <Route path="/banking/suspense-clearing" element={<SuspenseClearing />} />
                    <Route path="/banking/import-rules" element={<BankImportRules />} />
                    <Route path="/banking/payment-vouchers" element={<PaymentVouchers />} />
                    <Route path="/banking/petty-cash" element={<PettyCash />} />
                    <Route path="/banking/petty-cash/voucher/new" element={<PettyCashVoucherForm />} />
                    <Route path="/banking/petty-cash/voucher/:id" element={<PettyCashVoucherDetail />} />
                  <Route path="/banking/petty-cash/replenishments" element={<PettyCashReplenishments />} />
                  <Route path="/banking/petty-cash/counts" element={<PettyCashCounts />} />
                  <Route path="/banking/petty-cash/counts/new" element={<PettyCashCount />} />
                  <Route path="/banking/petty-cash/counts/:id" element={<PettyCashCount />} />
                  <Route path="/banking/petty-cash/:id/ledger" element={<PettyCashLedger />} />
                  </Route>

                  {/* Sales module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.sales} />}>
                    <Route path="/sales" element={<ModuleDashboard config={MODULE_CONFIGS.sales} />} />
                    <Route path="/sales/invoices" element={<Invoices />} />
                    <Route path="/sales/invoices/new" element={<CreateInvoice />} />
                    <Route path="/sales/invoice-templates" element={<InvoiceTemplates />} />
                    <Route path="/sales/invoices/designer" element={<InvoiceTemplateDesigner />} />
                    <Route path="/sales/approvals" element={<InvoiceApprovals />} />
                    <Route path="/sales/receipts" element={<Receipts />} />
                    <Route path="/sales/discount-calculator" element={<DiscountCalculator />} />
                    <Route path="/sales/number-register" element={<InvoiceSerialRegister />} />
                    <Route path="/sales/deposits" element={<Deposits />} />
                    <Route path="/sales/invoices/:id/edit" element={<CreateInvoice />} />
                    <Route path="/sales/recurring-invoices" element={<RecurringInvoices />} />
                    <Route path="/sales/quotes" element={<Quotes />} />
                    <Route path="/sales/customers" element={<CustomersPage />} />
                    <Route path="/sales/customers/:id" element={<CustomerDetail />} />
                    <Route path="/sales/customers/:id/statement" element={<CustomerStatement />} />
                    <Route path="/sales/notifications" element={<Notifications />} />
                    <Route path="/sales/products-taxes" element={<ProductsTaxes />} />
                  </Route>

                  {/* Expenses module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.expenses} />}>
                    <Route path="/expenses" element={<ModuleDashboard config={MODULE_CONFIGS.expenses} />} />
                    <Route path="/expenses/tracker" element={<Expenses />} />
                  </Route>

                  {/* Payroll module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.payroll} />}>
                    <Route path="/payroll" element={<ModuleDashboard config={MODULE_CONFIGS.payroll} />} />
                    <Route path="/payroll/dashboard" element={<WorkforceDashboard />} />
                    <Route path="/payroll/runs" element={<Payroll />} />
                    <Route path="/payroll/employees" element={<Employees />} />
                    <Route path="/payroll/attendance" element={<AttendanceRegister />} />
                    <Route path="/payroll/field-visits" element={<FieldVisits />} />
                    <Route path="/payroll/attendance-import" element={<AttendanceImport />} />
                    <Route path="/payroll/biometric-linking" element={<BiometricLinking />} />
                    <Route path="/payroll/leave" element={<Leave />} />
                    <Route path="/payroll/liabilities" element={<PayrollLiabilities />} />
                    <Route path="/payroll/gratuity" element={<Gratuity />} />
                    <Route path="/payroll/loans" element={<Loans />} />
                    <Route path="/payroll/recurring" element={<RecurringPay />} />
                  </Route>

                  {/* Reports module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.reports} />}>
                    <Route path="/reports" element={<ModuleDashboard config={MODULE_CONFIGS.reports} />} />
                    <Route path="/reports/financial" element={<Reports />} />
                    <Route path="/reports/budgets" element={<Budgets />} />
                    <Route path="/reports/budget-vs-actual" element={<BudgetVsActual />} />
                    <Route path="/reports/exports" element={<DataExports />} />
                    <Route path="/reports/anomalies" element={<AnomalyDashboard />} />
                    <Route path="/reports/forecasting" element={<ForecastDashboard />} />
                    <Route path="/tax" element={<TaxCenter />} />
                  </Route>

                  {/* Fixed Assets module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.assets} />}>
                    <Route path="/assets" element={<ModuleDashboard config={MODULE_CONFIGS.assets} />} />
                    <Route path="/assets/register" element={<AssetRegister />} />
                    <Route path="/assets/new" element={<AssetForm />} />
                    <Route path="/assets/categories" element={<AssetCategories />} />
                    <Route path="/assets/:id/edit" element={<AssetForm />} />
                    <Route path="/assets/:id" element={<AssetDetail />} />
                    <Route path="/assets/depreciation" element={<DepreciationRun />} />
                  </Route>

                  {/* Tenant Admin/Settings */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.tenantAdmin} />}>
                    <Route path="/settings" element={<ModuleDashboard config={MODULE_CONFIGS.tenantAdmin} />} />
                    <Route path="/settings/general" element={<SettingsPage />} />
                    <Route path="/settings/users" element={<UsersPage />} />
                    <Route path="/settings/account-mapping" element={<AccountMapping />} />
                    <Route path="/settings/posting-profiles" element={<PostingProfiles />} />
                    <Route path="/settings/payroll-gl-mapping" element={<PayrollGLMapping />} />
                    <Route path="/settings/tax" element={<TaxSettings />} />
                  </Route>
                </Route>
              </Route>
            </Route>
            {/* Any unknown URL falls back to the public homepage */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </ErrorBoundary>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
