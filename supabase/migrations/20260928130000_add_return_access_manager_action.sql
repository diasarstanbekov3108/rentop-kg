-- Rentop KG: резервная ручная передача нового PIN/QR для возврата через ARCHA POINT.

BEGIN;

ALTER TABLE public.rental_order_admin_actions
  DROP CONSTRAINT IF EXISTS rental_order_admin_actions_allowed;

ALTER TABLE public.rental_order_admin_actions
  ADD CONSTRAINT rental_order_admin_actions_allowed CHECK (
    action IN ('deposit', 'pickup_pin', 'customer_message', 'return_pin')
  );

COMMIT;
