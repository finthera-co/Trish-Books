-- Link bill lines to a product record, mirroring invoice_items.product_id.
-- Lets a bill line inherit the product's expense account (product.expense_account_id)
-- the same way an invoice line already inherits income_account_id, so a product
-- always drives a real Dr/Cr account pair rather than requiring a manual pick.
ALTER TABLE public.supplier_bill_lines
  ADD COLUMN IF NOT EXISTS product_id uuid NULL REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_bill_lines_product_id
  ON public.supplier_bill_lines(product_id) WHERE product_id IS NOT NULL;
