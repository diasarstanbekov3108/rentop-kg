-- Эта миграция выполняется после 20260923120000_create_rental_orders.sql.
-- Переименовывает технический канал оплаты в корректный SIMBANK.

BEGIN;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_payment_channel_allowed;

UPDATE public.rental_orders
SET payment_channel = 'simbank'
WHERE payment_channel = 'synbank';

ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_payment_channel_allowed
  CHECK (payment_channel IS NULL OR payment_channel IN ('mbank', 'simbank'));

COMMIT;
