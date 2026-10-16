-- Отдельные QR Bakai для продления. Первоначальная аренда и залог не должны
-- смешиваться с доплатой за дополнительные дни.

BEGIN;

ALTER TABLE public.rental_order_payments
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'rental',
  ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES public.rental_order_customer_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS proposed_return_date date;

ALTER TABLE public.rental_order_payments
  DROP CONSTRAINT IF EXISTS rental_order_payments_purpose_allowed;
ALTER TABLE public.rental_order_payments
  ADD CONSTRAINT rental_order_payments_purpose_allowed
  CHECK (purpose IN ('rental', 'extension'));

CREATE INDEX IF NOT EXISTS rental_order_payments_request_created_idx
  ON public.rental_order_payments(request_id, created_at DESC);

COMMENT ON COLUMN public.rental_order_payments.purpose IS
  'rental — первоначальная аренда/залог; extension — отдельная доплата за продление.';

COMMIT;
