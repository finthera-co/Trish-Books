import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import TenantRoute from "@/components/TenantRoute";
import SuperAdminRoute from "@/components/SuperAdminRoute";
import AppLayout from "./components/layout/AppLayout";
import ModuleLayout from "./components/layout/ModuleLayout";
import { MODULE_CONFIGS } from "./config/modules";
import ModuleDashboard from "./pages/ModuleDashboard";

// Pages
import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
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
import PaymentVouchers from "./pages/PaymentVouchers";
import PettyCash from "./pages/PettyCash";
import PettyCashVoucherForm from "./pages/PettyCashVoucherForm";
import PettyCashVoucherDetail from "./pages/PettyCashVoucherDetail";
import PettyCashReplenishments from "./pages/PettyCashReplenishments";
import PettyCashLedger from "./pages/PettyCashLedger";
import Invoices from "./pages/Invoices";
import CreateInvoice from "./pages/CreateInvoice";
import InvoiceTemplates from "./pages/InvoiceTemplates";
import InvoiceTemplateDesigner from "./pages/InvoiceTemplateDesigner";
import ProductsTaxes from "./pages/ProductsTaxes";
import Expenses from "./pages/Expenses";
import Payroll from "./pages/Payroll";
import PayrollGLMapping from "./pages/PayrollGLMapping";
import Employees from "./pages/Employees";
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
import UsersPage from "./pages/UsersPage";
import Tenants from "./pages/Tenants";
import Subscriptions from "./pages/Subscriptions";
import AuditLogs from "./pages/AuditLogs";
import NotFound from "./pages/NotFound";
import AnomalyDashboard from "./pages/AnomalyDashboard";

import ForecastDashboard from "./pages/ForecastDashboard";
import AccountReport from "./pages/AccountReport";
import GLVerification from "./pages/GLVerification";
import CustomersPage from "./pages/CustomersPage";
import CustomerDetail from "./pages/CustomerDetail";
import ReceivePayment from "./pages/ReceivePayment";
import CreditNotePage from "./pages/CreditNotePage";
import ARAgingReport from "./pages/ARAgingReport";
import VendorsPage from "./pages/VendorsPage";
import InventoryPage from "./pages/InventoryPage";
import Procurement from "./pages/Procurement";
import BankAccountsPage from "./pages/BankAccountsPage";

// Super Admin pages
import SuperAdminDashboard from "./pages/SuperAdminDashboard";
import SystemAnalytics from "./pages/SystemAnalytics";
import ErrorLogs from "./pages/ErrorLogs";
import SuperAdminUsers from "./pages/SuperAdminUsers";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                {/* Home — renders different dashboard based on role */}
                <Route path="/" element={<Home />} />

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
                    <Route path="/accounting/customers" element={<CustomersPage />} />
                    <Route path="/accounting/customers/:id" element={<CustomerDetail />} />
                    <Route path="/accounting/receive-payment" element={<ReceivePayment />} />
                    <Route path="/accounting/credit-notes" element={<CreditNotePage />} />
                    <Route path="/accounting/ar-aging" element={<ARAgingReport />} />
                    <Route path="/accounting/vendors" element={<VendorsPage />} />
                    <Route path="/accounting/inventory" element={<InventoryPage />} />
                    <Route path="/accounting/bank-accounts" element={<BankAccountsPage />} />
                  </Route>

                  {/* Banking module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.banking} />}>
                    <Route path="/banking" element={<ModuleDashboard config={MODULE_CONFIGS.banking} />} />
                    <Route path="/banking/reconciliation" element={<BankReconciliation />} />
                    <Route path="/banking/payment-vouchers" element={<PaymentVouchers />} />
                    <Route path="/banking/petty-cash" element={<PettyCash />} />
                    <Route path="/banking/petty-cash/voucher/new" element={<PettyCashVoucherForm />} />
                    <Route path="/banking/petty-cash/voucher/:id" element={<PettyCashVoucherDetail />} />
                  <Route path="/banking/petty-cash/replenishments" element={<PettyCashReplenishments />} />
                  <Route path="/banking/petty-cash/:id/ledger" element={<PettyCashLedger />} />
                  </Route>

                  {/* Sales module */}
                  <Route element={<ModuleLayout config={MODULE_CONFIGS.sales} />}>
                    <Route path="/sales" element={<ModuleDashboard config={MODULE_CONFIGS.sales} />} />
                    <Route path="/sales/invoices" element={<Invoices />} />
                    <Route path="/sales/invoices/new" element={<CreateInvoice />} />
                    <Route path="/sales/invoices/templates" element={<InvoiceTemplates />} />
                    <Route path="/sales/invoices/designer" element={<InvoiceTemplateDesigner />} />
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
                    <Route path="/payroll/runs" element={<Payroll />} />
                    <Route path="/payroll/employees" element={<Employees />} />
                    <Route path="/payroll/gl-mapping" element={<PayrollGLMapping />} />
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
                  </Route>
                </Route>
              </Route>
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
