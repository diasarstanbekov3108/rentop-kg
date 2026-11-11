-- Explicit delivery dispatch state: the client can see whether a Rentop
-- courier or a third-party courier is on the way. The rental itself still starts
-- only after the customer confirms physical receipt.
ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS delivery_dispatch_mode text,
  ADD COLUMN IF NOT EXISTS delivery_dispatched_at timestamptz;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_delivery_dispatch_mode_allowed;

ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_delivery_dispatch_mode_allowed CHECK (
    delivery_dispatch_mode IS NULL OR delivery_dispatch_mode IN ('rentop_courier', 'third_party_courier')
  );
