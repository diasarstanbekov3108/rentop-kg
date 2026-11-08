BEGIN;

-- Первичная заявка на доставку: эти данные собираются до проверки
-- документов, чтобы менеджер мог сразу согласовать маршрут и время.
ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS delivery_address text,
  ADD COLUMN IF NOT EXISTS delivery_contact_name text,
  ADD COLUMN IF NOT EXISTS delivery_contact_phone text,
  ADD COLUMN IF NOT EXISTS delivery_preferred_time text,
  ADD COLUMN IF NOT EXISTS benefit_requested_type text;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_benefit_requested_type_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_benefit_requested_type_allowed CHECK (
    benefit_requested_type IS NULL OR benefit_requested_type IN ('student', 'pensioner', 'disability')
  );

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_delivery_address_len;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_delivery_address_len CHECK (
    delivery_address IS NULL OR char_length(btrim(delivery_address)) BETWEEN 8 AND 500
  );

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_delivery_time_len;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_delivery_time_len CHECK (
    delivery_preferred_time IS NULL OR char_length(btrim(delivery_preferred_time)) BETWEEN 3 AND 300
  );

COMMIT;
