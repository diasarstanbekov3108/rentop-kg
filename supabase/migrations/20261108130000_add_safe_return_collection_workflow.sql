BEGIN;

-- A return cannot be completed from a video alone. Non-locker returns wait
-- for the manager to confirm the physical handover first.
ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_status_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_status_allowed CHECK (
    status IN (
      'draft', 'pending_review', 'awaiting_payment', 'payment_review', 'confirmed',
      'awaiting_archa_reservation', 'awaiting_locker_loading', 'awaiting_pickup',
      'issued', 'in_use', 'return_requested', 'awaiting_return_reservation',
      'awaiting_return_dropoff', 'awaiting_return_collection', 'returned', 'completed',
      'rejected', 'cancelled', 'expired', 'incident'
    )
  );

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS return_collection_address text,
  ADD COLUMN IF NOT EXISTS return_contact_name text,
  ADD COLUMN IF NOT EXISTS return_contact_phone text,
  ADD COLUMN IF NOT EXISTS return_preferred_time text,
  ADD COLUMN IF NOT EXISTS return_delivery_payer text;

-- Preserve existing test/legacy returns before restricting the allowed values.
-- A previous UI used `courier` and `warehouse`; map them to the new explicit
-- customer-facing methods rather than rejecting the migration.
UPDATE public.rental_orders
SET return_method = CASE return_method
  WHEN 'courier' THEN 'rentop_courier'
  WHEN 'warehouse' THEN 'self_delivery'
  ELSE return_method
END
WHERE return_method IN ('courier', 'warehouse');

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_return_method_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_return_method_allowed CHECK (
    return_method IS NULL OR return_method IN ('arca_locker', 'rentop_courier', 'customer_courier', 'self_delivery')
  );
ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_return_delivery_payer_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_return_delivery_payer_allowed CHECK (
    return_delivery_payer IS NULL OR return_delivery_payer IN ('customer', 'rentop')
  );

ALTER TABLE public.rental_order_customer_requests
  ADD COLUMN IF NOT EXISTS return_collection_address text,
  ADD COLUMN IF NOT EXISTS return_contact_name text,
  ADD COLUMN IF NOT EXISTS return_contact_phone text,
  ADD COLUMN IF NOT EXISTS return_preferred_time text,
  ADD COLUMN IF NOT EXISTS return_delivery_payer text;

UPDATE public.rental_order_customer_requests
SET return_method = CASE return_method
  WHEN 'courier' THEN 'rentop_courier'
  WHEN 'warehouse' THEN 'self_delivery'
  ELSE return_method
END
WHERE return_method IN ('courier', 'warehouse');
ALTER TABLE public.rental_order_customer_requests
  DROP CONSTRAINT IF EXISTS rental_customer_requests_return_method_allowed;
ALTER TABLE public.rental_order_customer_requests
  ADD CONSTRAINT rental_customer_requests_return_method_allowed CHECK (
    return_method IS NULL OR return_method IN ('arca_locker', 'rentop_courier', 'customer_courier', 'self_delivery')
  );

COMMIT;
