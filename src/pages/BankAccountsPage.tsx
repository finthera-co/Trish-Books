import { useMemo } from "react";
import { Landmark, CreditCard } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency } from "@/lib/currency";
import { useAccounts } from "@/hooks/useData";

export default function BankAccountsPage() {
  const { data: accounts, isLoading } = useAccounts();

  const bankAccounts = useMemo(() =>
    (accounts || []).filter((a: any) =>
      a.account_subtype?.toLowerCase().includes("bank") ||
      (a.account_subtype?.toLowerCase().includes("checking")) ||
      (a.account_subtype?.toLowerCase().includes("savings")) ||
      (a.account_type === "Asset" && a.account_name?.toLowerCase().includes("bank"))
    ), [accounts]);

  const creditCards = useMemo(() =>
    (accounts || []).filter((a: any) =>
      a.account_subtype?.toLowerCase().includes("credit card") ||
      (a.account_type === "Liability" && a.account_name?.toLowerCase().includes("credit card"))
    ), [accounts]);

  const totalBank = bankAccounts.reduce((s: number, a: any) => s + Number(a.opening_balance || 0), 0);
  const totalCC = creditCards.reduce((s: number, a: any) => s + Number(a.opening_balance || 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Landmark className="w-6 h-6 text-primary" /> Bank & Credit Cards
        </h1>
        <p className="text-sm text-muted-foreground">Manage bank accounts and credit cards from the Chart of Accounts</p>
      </div>

      <Tabs defaultValue="bank">
        <TabsList>
          <TabsTrigger value="bank" className="gap-2"><Landmark className="w-4 h-4" /> Bank Accounts</TabsTrigger>
          <TabsTrigger value="cc" className="gap-2"><CreditCard className="w-4 h-4" /> Credit Cards</TabsTrigger>
        </TabsList>

        <TabsContent value="bank" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Bank Accounts</p><p className="text-2xl font-bold text-foreground">{bankAccounts.length}</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Balance</p><p className="text-2xl font-bold text-primary">{formatCurrency(totalBank)}</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Bank Accounts</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <p className="text-muted-foreground text-sm">Loading...</p> : bankAccounts.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">No bank accounts found. Create them in the Chart of Accounts with a "Bank" subtype.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Account Name</TableHead>
                      <TableHead>Subtype</TableHead>
                      <TableHead className="text-right">Opening Balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bankAccounts.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-muted-foreground">{a.account_code}</TableCell>
                        <TableCell className="font-medium">{a.account_name}</TableCell>
                        <TableCell className="text-muted-foreground">{a.account_subtype || "—"}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(a.opening_balance || 0)}</TableCell>
                        <TableCell><Badge variant={a.is_active ? "default" : "secondary"}>{a.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cc" className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Credit Cards</p><p className="text-2xl font-bold text-foreground">{creditCards.length}</p></CardContent></Card>
            <Card><CardContent className="pt-4"><p className="text-sm text-muted-foreground">Total Balance</p><p className="text-2xl font-bold text-destructive">{formatCurrency(totalCC)}</p></CardContent></Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Credit Cards</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <p className="text-muted-foreground text-sm">Loading...</p> : creditCards.length === 0 ? (
                <p className="text-muted-foreground text-sm text-center py-8">No credit card accounts found. Create them in the Chart of Accounts with a "Credit Card" subtype.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Account Name</TableHead>
                      <TableHead className="text-right">Opening Balance</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {creditCards.map((a: any) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-mono text-muted-foreground">{a.account_code}</TableCell>
                        <TableCell className="font-medium">{a.account_name}</TableCell>
                        <TableCell className="text-right font-mono">{formatCurrency(a.opening_balance || 0)}</TableCell>
                        <TableCell><Badge variant={a.is_active ? "default" : "secondary"}>{a.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
