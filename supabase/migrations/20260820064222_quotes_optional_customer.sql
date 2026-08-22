-- Quotes / estimates can be created without picking a customer (e.g. a rough
-- ballpark quote before a lead is on file). Conversion to an invoice still
-- requires a customer, since invoices.customer_id stays NOT NULL.
ALTER TABLE public.quotes ALTER COLUMN customer_id DROP NOT NULL;
