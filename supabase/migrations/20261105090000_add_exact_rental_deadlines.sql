-- Точный срок аренды начинается в момент подтверждения первого платежа.
-- Календарные даты остаются для проверки доступности ноутбука.

BEGIN;

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS rental_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS rental_ends_at timestamptz;

CREATE INDEX IF NOT EXISTS rental_orders_exact_deadline_idx
  ON public.rental_orders (status, rental_ends_at)
  WHERE rental_ends_at IS NOT NULL;

COMMENT ON COLUMN public.rental_orders.rental_started_at IS
  'Фактическое начало аренды: момент подтверждения первого платежа.';
COMMENT ON COLUMN public.rental_orders.rental_ends_at IS
  'Точный момент окончания аренды, рассчитанный от подтверждения оплаты.';

COMMIT;
