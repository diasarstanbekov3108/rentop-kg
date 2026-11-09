BEGIN;

-- The approved social benefit is 10%. It does not stack with the tariff
-- discount, but it must be a valid final order discount for short rentals.
ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_discount_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_discount_allowed CHECK (
    discount_percent IN (0, 10, 15, 30)
  );

COMMIT;
