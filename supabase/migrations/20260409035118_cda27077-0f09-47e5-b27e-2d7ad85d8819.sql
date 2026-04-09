
ALTER TABLE public.invoices 
ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES public.invoice_templates(id),
ADD COLUMN IF NOT EXISTS subtotal numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS tax_amount numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS notes text,
ADD COLUMN IF NOT EXISTS terms text;
