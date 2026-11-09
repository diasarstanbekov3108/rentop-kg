BEGIN;

-- For a courier selected by the client or self-delivery, Rentop must first
-- provide the receiving address and handoff instructions. Keep that separate
-- from the customer's pickup address used by Rentop's own courier.
ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS return_destination_address text,
  ADD COLUMN IF NOT EXISTS return_destination_note text;

ALTER TABLE public.rental_order_customer_requests
  ADD COLUMN IF NOT EXISTS return_destination_address text,
  ADD COLUMN IF NOT EXISTS return_destination_note text;

COMMIT;
