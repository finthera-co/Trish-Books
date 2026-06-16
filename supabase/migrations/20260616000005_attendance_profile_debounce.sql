ALTER TABLE public.attendance_device_profiles
  ADD COLUMN IF NOT EXISTS debounce_seconds int NOT NULL DEFAULT 60;
