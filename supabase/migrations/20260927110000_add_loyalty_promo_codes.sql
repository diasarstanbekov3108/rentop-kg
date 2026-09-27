-- Rentop KG: одноразовые персональные промокоды лояльности.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rental_promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{6,40}$'),
  discount_percent integer NOT NULL CHECK (discount_percent IN (5, 10, 15)),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'redeemed', 'expired', 'revoked')),
  issued_from_order_id uuid REFERENCES public.rental_orders(id) ON DELETE SET NULL,
  recipient_telegram_user_id bigint NOT NULL,
  recipient_phone text,
  expires_at timestamptz NOT NULL,
  redeemed_order_id uuid UNIQUE REFERENCES public.rental_orders(id) ON DELETE SET NULL,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS rental_promo_codes_recipient_idx
  ON public.rental_promo_codes (recipient_telegram_user_id, status, expires_at DESC);

ALTER TABLE public.rental_promo_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_promo_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rental_promo_codes TO service_role;

COMMENT ON TABLE public.rental_promo_codes IS
  'Персональные одноразовые промокоды Rentop. Залог ими не уменьшается.';

COMMIT;
