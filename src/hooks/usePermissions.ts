import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// QuickBooks-style permission modules
export const PERMISSION_MODULES = [
  { key: "dashboard", label: "Dashboard", icon: "LayoutDashboard" },
  { key: "sales", label: "Sales & Invoicing", icon: "Receipt" },
  { key: "expenses", label: "Expenses", icon: "CreditCard" },
  { key: "customers", label: "Customers", icon: "Users" },
  { key: "vendors", label: "Vendors", icon: "Truck" },
  { key: "accounts", label: "Chart of Accounts", icon: "BookOpen" },
  { key: "journals", label: "Journal Entries", icon: "FileText" },
  { key: "payroll", label: "Payroll", icon: "DollarSign" },
  { key: "inventory", label: "Inventory", icon: "Package" },
  { key: "reports", label: "Reports", icon: "BarChart3" },
  { key: "banking", label: "Banking", icon: "Building2" },
  { key: "settings", label: "Settings", icon: "Settings" },
] as const;

export type PermissionLevel = "full_access" | "create_edit" | "view_only" | "no_access";

export const PERMISSION_LEVELS: { value: PermissionLevel; label: string; description: string }[] = [
  { value: "full_access", label: "Full Access", description: "Create, edit, delete, and manage all data" },
  { value: "create_edit", label: "Create & Edit", description: "Create and edit but cannot delete" },
  { value: "view_only", label: "View Only", description: "Can see data but cannot make changes" },
  { value: "no_access", label: "No Access", description: "Module is hidden from this user" },
];

// Roles that get automatic full access (no per-module permissions needed)
const FULL_ACCESS_ROLES = ["Super Admin", "Primary Admin", "Company Admin"];
const VIEW_ONLY_ROLE = "Reports Only";
const MINIMAL_ROLE = "Time Tracking";

export interface UserPermission {
  id: string;
  user_id: string;
  module_name: string;
  permission_level: PermissionLevel;
}

export function useUserPermissions(userId?: string) {
  return useQuery({
    queryKey: ["user_permissions", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_permissions")
        .select("*")
        .eq("user_id", userId!);
      if (error) throw error;
      return data as UserPermission[];
    },
    enabled: !!userId,
  });
}

export function useUpsertPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, permissions }: { userId: string; permissions: { module_name: string; permission_level: PermissionLevel }[] }) => {
      // Delete existing then insert new
      await supabase.from("user_permissions").delete().eq("user_id", userId);
      if (permissions.length > 0) {
        const rows = permissions.map(p => ({
          user_id: userId,
          module_name: p.module_name,
          permission_level: p.permission_level,
        }));
        const { error } = await supabase.from("user_permissions").insert(rows);
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["user_permissions", vars.userId] });
      toast.success("Permissions updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Returns the effective permission level for the current user on a given module.
 * Admin roles automatically get full_access.
 */
export function useMyPermissions() {
  const { appUser } = useAuth();

  const { data: permissions } = useQuery({
    queryKey: ["user_permissions", appUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_permissions")
        .select("*")
        .eq("user_id", appUser!.id);
      if (error) throw error;
      return data as UserPermission[];
    },
    enabled: !!appUser?.id,
  });

  const getPermission = (moduleName: string): PermissionLevel => {
    if (!appUser) return "no_access";
    // Admin roles bypass
    if (FULL_ACCESS_ROLES.includes(appUser.role_name)) return "full_access";
    if (appUser.role_name === VIEW_ONLY_ROLE) return "view_only";
    if (appUser.role_name === MINIMAL_ROLE) {
      return moduleName === "time_tracking" ? "full_access" : "no_access";
    }
    // Standard User / Accountant — check user_permissions
    const perm = permissions?.find(p => p.module_name === moduleName);
    return (perm?.permission_level as PermissionLevel) || "no_access";
  };

  const canView = (moduleName: string) => getPermission(moduleName) !== "no_access";
  const canEdit = (moduleName: string) => ["full_access", "create_edit"].includes(getPermission(moduleName));
  const canDelete = (moduleName: string) => getPermission(moduleName) === "full_access";

  return { getPermission, canView, canEdit, canDelete, permissions };
}

/**
 * Get default permissions for a given role
 */
export function getDefaultPermissionsForRole(roleName: string): { module_name: string; permission_level: PermissionLevel }[] {
  if (FULL_ACCESS_ROLES.includes(roleName)) {
    return PERMISSION_MODULES.map(m => ({ module_name: m.key, permission_level: "full_access" as PermissionLevel }));
  }
  if (roleName === "Reports Only") {
    return PERMISSION_MODULES.map(m => ({
      module_name: m.key,
      permission_level: (m.key === "reports" || m.key === "dashboard") ? "view_only" : "no_access" as PermissionLevel,
    }));
  }
  if (roleName === "Time Tracking") {
    return PERMISSION_MODULES.map(m => ({
      module_name: m.key,
      permission_level: "no_access" as PermissionLevel,
    }));
  }
  if (roleName === "Accountant") {
    return PERMISSION_MODULES.map(m => ({
      module_name: m.key,
      permission_level: ["accounts", "journals", "reports", "banking", "dashboard"].includes(m.key)
        ? "full_access"
        : ["sales", "expenses"].includes(m.key) ? "view_only" : "no_access" as PermissionLevel,
    }));
  }
  // Standard User / Staff — start with no access, admin configures
  return PERMISSION_MODULES.map(m => ({
    module_name: m.key,
    permission_level: m.key === "dashboard" ? "view_only" : "no_access" as PermissionLevel,
  }));
}
