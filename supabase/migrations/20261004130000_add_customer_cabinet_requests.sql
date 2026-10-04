-- Действия клиента из личного кабинета: продление и досрочный возврат.
-- Выполнить один раз после миграций личного кабинета.

BEGIN;

CREATE TABLE IF NOT EXISTS public.rental_order_customer_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  customer_message text,
  requested_days integer,
  estimated_amount numeric(12, 2),
  proposed_return_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT rental_customer_requests_kind_allowed CHECK (kind IN ('extension', 'early_return')),
  CONSTRAINT rental_customer_requests_status_allowed CHECK (status IN ('open', 'in_progress', 'resolved', 'cancelled')),
  CONSTRAINT rental_customer_requests_extension_fields CHECK (
    kind <> 'extension' OR (requested_days BETWEEN 1 AND 30 AND estimated_amount >= 0 AND proposed_return_date IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS rental_customer_requests_order_created_idx
  ON public.rental_order_customer_requests(order_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS rental_customer_requests_one_open_extension
  ON public.rental_order_customer_requests(order_id)
  WHERE kind = 'extension' AND status IN ('open', 'in_progress');

ALTER TABLE public.rental_order_customer_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_order_customer_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rental_order_customer_requests TO service_role;

CREATE TRIGGER rental_customer_requests_set_updated_at
  BEFORE UPDATE ON public.rental_order_customer_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_rental_order_updated_at();

COMMENT ON TABLE public.rental_order_customer_requests IS
  'Запросы клиента из личного кабинета. Решение и изменение срока выполняет менеджер.';

COMMIT;
