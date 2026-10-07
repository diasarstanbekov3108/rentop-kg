-- Позволяет отозвать QR в Rentop и безопасно создать новый счёт по той же заявке.
-- У Bakai сейчас нет API отмены QR: отозванный QR скрывается от клиента,
-- а поздний webhook не подтверждает аренду автоматически.

BEGIN;

ALTER TABLE public.rental_order_payments
  DROP CONSTRAINT IF EXISTS rental_order_payments_order_id_key;

ALTER TABLE public.rental_order_payments
  DROP CONSTRAINT IF EXISTS rental_order_payments_status_check;

ALTER TABLE public.rental_order_payments
  ADD CONSTRAINT rental_order_payments_status_check
  CHECK (status IN ('awaiting_payment', 'paid', 'expired', 'failed', 'revoked'));

CREATE INDEX IF NOT EXISTS rental_order_payments_order_created_idx
  ON public.rental_order_payments(order_id, created_at DESC);

COMMIT;
