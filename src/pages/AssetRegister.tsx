import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFixedAssets } from "@/hooks/useFixedAssets";
import { formatCurrency } from "@/lib/currency";

export default function AssetRegister() {
  const { data: assets, isLoading } = useFixedAssets();
  const navigate = useNavigate();

  const totalCost = assets?.reduce((s, a) => s + (a.cost || 0), 0) ?? 0;
  const totalNBV = assets?.reduce((s, a) => s + (a.net_book_value ?? a.cost - (a.accumulated_depreciation ?? 0)), 0) ?? 0;
  const activeCount = assets?.filter(a => a.status === "active").length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Fixed Asset Register</h1>
          <p className="text-sm text-muted-foreground">Track and manage company assets</p>
        </div>
        <Button onClick={() => navigate("/assets/new")}>
          <Plus className="w-4 h-4 mr-2" /> Add Asset
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Assets</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{assets?.length ?? 0}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Cost</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totalCost)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Net Book Value</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{formatCurrency(totalNBV)}</p></CardContent>
        </Card>
      </div>

      {/* Asset Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Accum. Depreciation</TableHead>
                <TableHead className="text-right">Net Book Value</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : !assets?.length ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No assets found. Click "Add Asset" to get started.</TableCell></TableRow>
              ) : (
                assets.map((asset) => {
                  const nbv = asset.net_book_value ?? (asset.cost - (asset.accumulated_depreciation ?? 0));
                  return (
                    <TableRow key={asset.id} className="cursor-pointer" onClick={() => navigate(`/assets/${asset.id}`)}>
                      <TableCell className="font-medium">{asset.asset_name}</TableCell>
                      <TableCell className="text-right">{formatCurrency(asset.cost)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(asset.accumulated_depreciation)}</TableCell>
                      <TableCell className="text-right">{formatCurrency(nbv)}</TableCell>
                      <TableCell>
                        <Badge variant={asset.status === "active" ? "default" : "secondary"}>
                          {asset.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); navigate(`/assets/${asset.id}`); }}>
                          <Eye className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
