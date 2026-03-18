
-- Receipt attachments column on vouchers
ALTER TABLE public.petty_cash_vouchers ADD COLUMN IF NOT EXISTS receipt_urls TEXT[] DEFAULT '{}';

-- Cash flow classification on journal entries
ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS cash_flow_category TEXT DEFAULT NULL;

-- Reversal tracking on vouchers
ALTER TABLE public.petty_cash_vouchers ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.petty_cash_vouchers ADD COLUMN IF NOT EXISTS reversal_voucher_id UUID REFERENCES public.petty_cash_vouchers(id) DEFAULT NULL;

-- Create storage bucket for petty cash receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('petty-cash-receipts', 'petty-cash-receipts', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for petty cash receipts
CREATE POLICY "Auth users can upload pc receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'petty-cash-receipts');

CREATE POLICY "Auth users can view pc receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'petty-cash-receipts');

CREATE POLICY "Auth users can delete pc receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'petty-cash-receipts');
