-- A customer may rent two or three laptops for one period and one delivery.
-- Each device stays a separate rental row (availability, serial number and
-- return inspection remain device-specific), while order_group_id binds those
-- rows into one customer-facing order and one manager workflow.
BEGIN;

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS order_group_id uuid;

CREATE INDEX IF NOT EXISTS rental_orders_order_group_id_idx
  ON public.rental_orders (order_group_id, created_at DESC)
  WHERE order_group_id IS NOT NULL;

COMMENT ON COLUMN public.rental_orders.order_group_id IS
  'Shared identifier for a multi-laptop customer order (2–3 devices, common dates and delivery).';

COMMIT;
