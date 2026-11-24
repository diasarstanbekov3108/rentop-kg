BEGIN;

-- A manager may suggest an available alternative before any invoice is
-- created. The client explicitly accepts it in the cabinet; availability is
-- checked once more at that moment so an expired suggestion never steals a
-- device from another booking.
ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS prepayment_replacement_offer_laptop_id bigint REFERENCES public.laptops(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS prepayment_replacement_offer_reason text,
  ADD COLUMN IF NOT EXISTS prepayment_replacement_offer_total_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS prepayment_replacement_offer_created_at timestamptz;

COMMENT ON COLUMN public.rental_orders.prepayment_replacement_offer_laptop_id IS
  'Manager-proposed laptop replacement awaiting explicit customer consent before payment.';

COMMIT;
