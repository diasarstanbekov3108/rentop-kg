-- Счета QR-оплаты Bakai. Выполнить один раз в Supabase SQL Editor до включения оплаты.
-- Денежные реквизиты и банковские токены в эту миграцию не попадают.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rental_order_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'bakai',
  operation_id text NOT NULL UNIQUE,
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  currency_id integer NOT NULL DEFAULT 417 CHECK (currency_id = 417),
  comment text NOT NULL,
  qr_image text,
  qr_image_with_frame text,
  qr_link text,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (status IN ('awaiting_payment', 'paid', 'expired', 'failed')),
  expires_at timestamptz NOT NULL,
  bank_elqr_id text UNIQUE,
  bank_transaction_id text,
  bank_payload jsonb,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rental_order_payments_status_idx
  ON public.rental_order_payments(status, expires_at);

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_payment_channel_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_payment_channel_allowed
  CHECK (
    payment_channel IS NULL
    OR char_length(btrim(payment_channel)) BETWEEN 1 AND 64
  );

ALTER TABLE public.rental_order_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_order_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rental_order_payments TO service_role;

CREATE TRIGGER rental_order_payments_set_updated_at
  BEFORE UPDATE ON public.rental_order_payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_rental_order_updated_at();

COMMENT ON TABLE public.rental_order_payments IS
  'Счета аренды через Bakai QR. Доступ к ним выдаётся только серверной части Rentop.';

COMMIT;
