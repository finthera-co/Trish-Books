import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Tenants from "./pages/Tenants";
import UsersPage from "./pages/UsersPage";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import JournalEntries from "./pages/JournalEntries";
import Ledger from "./pages/Ledger";
import Invoices from "./pages/Invoices";
import Expenses from "./pages/Expenses";
import PettyCash from "./pages/PettyCash";
import Budgets from "./pages/Budgets";
import Reports from "./pages/Reports";
import AuditLogs from "./pages/AuditLogs";
import Subscriptions from "./pages/Subscriptions";
import SettingsPage from "./pages/SettingsPage";
import Employees from "./pages/Employees";
import ProductsTaxes from "./pages/ProductsTaxes";
import Payroll from "./pages/Payroll";
import TrialBalance from "./pages/TrialBalance";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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
                <Route path="/" element={<Index />} />
                <Route path="/tenants" element={<Tenants />} />
                <Route path="/users" element={<UsersPage />} />
                <Route path="/employees" element={<Employees />} />
                <Route path="/accounts" element={<ChartOfAccounts />} />
                <Route path="/journals" element={<JournalEntries />} />
                <Route path="/ledger" element={<Ledger />} />
                <Route path="/trial-balance" element={<TrialBalance />} />
                <Route path="/invoices" element={<Invoices />} />
                <Route path="/products-taxes" element={<ProductsTaxes />} />
                <Route path="/expenses" element={<Expenses />} />
                <Route path="/petty-cash" element={<PettyCash />} />
                <Route path="/budgets" element={<Budgets />} />
                <Route path="/payroll" element={<Payroll />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/audit-logs" element={<AuditLogs />} />
                <Route path="/subscriptions" element={<Subscriptions />} />
                <Route path="/settings" element={<SettingsPage />} />
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
