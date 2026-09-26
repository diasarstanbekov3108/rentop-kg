-- Tracks open and resolved Rentop / ARCHA POINT support cases separately from the rental status.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rental_order_support_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('rentop', 'archa')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  opened_by text,
  resolved_at timestamptz,
  resolved_by text,
  UNIQUE (order_id, kind)
);

CREATE INDEX IF NOT EXISTS rental_support_cases_open_idx
  ON public.rental_order_support_cases (status, opened_at DESC);

ALTER TABLE public.rental_order_support_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_order_support_cases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rental_order_support_cases TO service_role;

COMMENT ON TABLE public.rental_order_support_cases IS
  'Operational support cases for Rentop and ARCHA POINT; no documents or message contents are stored.';

COMMIT;
