-- Records the minimal data categories prepared for ARCHA POINT handoff.
-- Values of passport documents, selfies, payment receipts and OTP codes are never stored here.

BEGIN;

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS archa_data_shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS archa_data_shared_fields jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.rental_orders.archa_data_shared_at IS
  'When Rentop prepared the minimum required handoff for ARCHA POINT.';
COMMENT ON COLUMN public.rental_orders.archa_data_shared_fields IS
  'Names of shared field categories only; does not duplicate their values.';

COMMIT;
