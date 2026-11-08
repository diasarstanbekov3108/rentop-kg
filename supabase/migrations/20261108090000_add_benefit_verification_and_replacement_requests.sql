-- Льготные статусы и замена модели при продлении.
-- Скидка льготной категории: 10%, не суммируется с тарифной; итоговая скидка не выше 30%.

BEGIN;

ALTER TABLE public.rental_order_documents
  DROP CONSTRAINT IF EXISTS rental_order_documents_kind_allowed;
ALTER TABLE public.rental_order_documents
  ADD CONSTRAINT rental_order_documents_kind_allowed CHECK (
    kind IN ('identity', 'identity_front', 'identity_back', 'selfie', 'supporting', 'issue_video', 'return_video', 'benefit_proof')
  );

CREATE TABLE IF NOT EXISTS public.customer_benefit_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  benefit_type text NOT NULL CHECK (benefit_type IN ('student', 'pensioner', 'disability')),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'approved', 'rejected', 'expired')),
  document_id uuid REFERENCES public.rental_order_documents(id) ON DELETE SET NULL,
  reviewer_note text,
  approved_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_benefit_phone_format CHECK (phone ~ '^[+]996[0-9]{9}$')
);
CREATE INDEX IF NOT EXISTS customer_benefit_verifications_phone_idx ON public.customer_benefit_verifications(phone, created_at DESC);
ALTER TABLE public.customer_benefit_verifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.customer_benefit_verifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.customer_benefit_verifications TO service_role;
CREATE TRIGGER customer_benefit_verifications_set_updated_at BEFORE UPDATE ON public.customer_benefit_verifications FOR EACH ROW EXECUTE FUNCTION public.touch_rental_order_updated_at();

ALTER TABLE public.rental_order_customer_requests
  ADD COLUMN IF NOT EXISTS replacement_laptop_id bigint REFERENCES public.laptops(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS replacement_difference numeric(12,2),
  ADD COLUMN IF NOT EXISTS replacement_note text;
ALTER TABLE public.rental_order_customer_requests
  DROP CONSTRAINT IF EXISTS rental_customer_requests_kind_allowed;
ALTER TABLE public.rental_order_customer_requests
  ADD CONSTRAINT rental_customer_requests_kind_allowed CHECK (kind IN ('extension', 'early_return', 'replacement'));

COMMIT;
