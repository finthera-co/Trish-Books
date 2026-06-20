-- Company branding shown on invoices: business registration number + logo.
-- Entered once per tenant (Settings → Company Information) and rendered on every
-- invoice — the BR number centered at the foot, the logo in the header.
alter table public.tenants
  add column if not exists registration_number text,
  add column if not exists logo_url text;

comment on column public.tenants.registration_number is
  'Business registration no. (e.g. "PV 12345678") printed centered at the foot of each invoice.';
comment on column public.tenants.logo_url is
  'Public URL (invoice-assets bucket) of the company logo shown in the invoice header.';
