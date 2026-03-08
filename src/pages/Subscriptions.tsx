import { CreditCard, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

const plans = [
  {
    name: "Starter",
    price: "$15",
    period: "/month",
    users: "Up to 3 users",
    features: ["Chart of Accounts", "Journal Entries", "Basic Reports", "Email Support"],
    current: false,
  },
  {
    name: "Business",
    price: "$35",
    period: "/month",
    users: "Up to 10 users",
    features: ["Everything in Starter", "Invoicing", "Expense Management", "Budgeting", "Audit Logs", "Priority Support"],
    current: true,
  },
];

const paymentHistory = [
  { date: "2026-03-01", plan: "Business", amount: 35, method: "Visa ****4242", status: "Paid" },
  { date: "2026-02-01", plan: "Business", amount: 35, method: "Visa ****4242", status: "Paid" },
  { date: "2026-01-01", plan: "Business", amount: 35, method: "Visa ****4242", status: "Paid" },
];

export default function Subscriptions() {
  return (
    <div className="space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">Subscription & Billing</h1>
          <p className="page-description">Manage your plan and payment history</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {plans.map((plan) => (
          <div key={plan.name} className={`stat-card ${plan.current ? "ring-2 ring-primary" : ""}`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
              {plan.current && (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                  Current Plan
                </span>
              )}
            </div>
            <div className="mb-4">
              <span className="text-3xl font-bold text-foreground">{plan.price}</span>
              <span className="text-muted-foreground">{plan.period}</span>
              <p className="text-sm text-muted-foreground mt-1">{plan.users}</p>
            </div>
            <ul className="space-y-2 mb-6">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm">
                  <Check className="w-4 h-4 text-success" />
                  {f}
                </li>
              ))}
            </ul>
            <Button variant={plan.current ? "outline" : "default"} className="w-full">
              {plan.current ? "Current Plan" : "Upgrade"}
            </Button>
          </div>
        ))}
      </div>

      <div className="stat-card">
        <h3 className="text-sm font-medium text-foreground mb-4">Payment History</h3>
        <table className="data-table">
          <thead><tr><th>Date</th><th>Plan</th><th>Method</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {paymentHistory.map((p, i) => (
              <tr key={i}>
                <td className="text-muted-foreground">{p.date}</td>
                <td>{p.plan}</td>
                <td className="text-muted-foreground">{p.method}</td>
                <td><span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success">{p.status}</span></td>
                <td className="text-right font-medium text-foreground">${p.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
