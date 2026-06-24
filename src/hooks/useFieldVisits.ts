import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface FieldVisit {
  id: string;
  tenant_id: string;
  employee_id: string;
  visit_date: string;
  check_in_at: string;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_accuracy: number | null;
  check_out_at: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  check_out_accuracy: number | null;
  client_name: string | null;
  notes: string | null;
  attendance_status: string | null; // 'present' | 'absent' — status stamped at check-in
  employees?: { first_name: string; last_name: string; employee_number: string | null; department: string | null };
}

export interface FieldAttendanceSettings {
  tenant_id: string;
  late_cutoff_enabled: boolean;
  late_cutoff_time: string; // 'HH:MM:SS'
  updated_at?: string;
}

export interface GeoFix {
  lat?: number;
  lng?: number;
  accuracy?: number;
}

/** The caller's currently open (not-yet-checked-out) field visit, if any. */
export function useMyOpenVisit(employeeId?: string) {
  return useQuery({
    queryKey: ["field_visits", "open", employeeId],
    enabled: !!employeeId,
    refetchInterval: 60000,
    queryFn: async (): Promise<FieldVisit | null> => {
      const { data, error } = await supabase
        .from("field_visits")
        .select("*")
        .eq("employee_id", employeeId!)
        .is("check_out_at", null)
        .order("check_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as FieldVisit | null;
    },
  });
}

/** The caller's recent field visits (own, RLS-scoped). */
export function useMyFieldVisits(employeeId?: string, limit = 30) {
  return useQuery({
    queryKey: ["field_visits", "mine", employeeId, limit],
    enabled: !!employeeId,
    queryFn: async (): Promise<FieldVisit[]> => {
      const { data, error } = await supabase
        .from("field_visits")
        .select("*")
        .eq("employee_id", employeeId!)
        .order("check_in_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as FieldVisit[];
    },
  });
}

/** All tenant field visits for a single day (admin/staff view). */
export function useTenantFieldVisits(day?: string) {
  return useQuery({
    queryKey: ["field_visits", "tenant", day ?? "all"],
    queryFn: async (): Promise<FieldVisit[]> => {
      let q = supabase
        .from("field_visits")
        .select("*, employees(first_name, last_name, employee_number, department)")
        .order("check_in_at", { ascending: false });
      if (day) q = q.eq("visit_date", day);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as FieldVisit[];
    },
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["field_visits"] });
  qc.invalidateQueries({ queryKey: ["attendance_records"] });
}

export function useFieldCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: GeoFix & { client_name?: string; notes?: string }) => {
      const { data, error } = await supabase.rpc("field_check_in", {
        p_lat: v.lat ?? null,
        p_lng: v.lng ?? null,
        p_accuracy: v.accuracy ?? null,
        p_client_name: v.client_name ?? null,
        p_notes: v.notes ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(qc); toast.success("Checked in"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useFieldCheckOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: GeoFix & { visit_id: string }) => {
      const { data, error } = await supabase.rpc("field_check_out", {
        p_visit_id: v.visit_id,
        p_lat: v.lat ?? null,
        p_lng: v.lng ?? null,
        p_accuracy: v.accuracy ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { invalidate(qc); toast.success("Checked out"); },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Tenant field-attendance policy (morning late cutoff). Null until first saved. */
export function useFieldAttendanceSettings() {
  const { appUser } = useAuth();
  return useQuery({
    queryKey: ["field_attendance_settings", appUser?.tenant_id],
    enabled: !!appUser?.tenant_id,
    queryFn: async (): Promise<FieldAttendanceSettings | null> => {
      const { data, error } = await supabase
        .from("field_attendance_settings")
        .select("*")
        .eq("tenant_id", appUser!.tenant_id)
        .maybeSingle();
      if (error) throw error;
      return (data as FieldAttendanceSettings) ?? null;
    },
  });
}

export function useSaveFieldAttendanceSettings() {
  const qc = useQueryClient();
  const { appUser } = useAuth();
  return useMutation({
    mutationFn: async (input: { late_cutoff_enabled: boolean; late_cutoff_time: string }) => {
      const tenant = appUser?.tenant_id;
      if (!tenant) throw new Error("No tenant");
      const { error } = await supabase.from("field_attendance_settings").upsert(
        {
          tenant_id: tenant,
          late_cutoff_enabled: input.late_cutoff_enabled,
          late_cutoff_time: input.late_cutoff_time,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["field_attendance_settings"] });
      toast.success("Field attendance policy saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/** Promise wrapper around the browser geolocation API. */
export function getCurrentLocation(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Location is not supported on this device"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED
        ? "Location permission denied — enable it to check in"
        : "Could not get your location")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  });
}

/** Google Maps link for a coordinate pair. */
export function mapLink(lat?: number | null, lng?: number | null): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat},${lng}`;
}
