BEGIN;

-- A draft is not a working request until the customer submits documents.
-- The archive marker is deliberately reversible: document upload clears it.
ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS draft_archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS draft_archived_by text,
  ADD COLUMN IF NOT EXISTS reservation_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS reservation_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS reservation_balance_due_at timestamptz;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_reservation_amount_nonnegative;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_reservation_amount_nonnegative
  CHECK (reservation_amount IS NULL OR reservation_amount >= 0);

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_status_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_status_allowed CHECK (
    status IN (
      'draft', 'pending_review', 'awaiting_payment', 'payment_review', 'reserved', 'confirmed',
      'awaiting_archa_reservation', 'awaiting_locker_loading', 'awaiting_pickup', 'issued', 'in_use',
      'return_requested', 'awaiting_return_reservation', 'awaiting_return_dropoff',
      'awaiting_return_collection', 'returned', 'completed', 'rejected', 'cancelled', 'expired', 'incident'
    )
  );

ALTER TABLE public.rental_order_payments
  DROP CONSTRAINT IF EXISTS rental_order_payments_purpose_allowed;
ALTER TABLE public.rental_order_payments
  ADD CONSTRAINT rental_order_payments_purpose_allowed
  CHECK (purpose IN ('rental', 'extension', 'reservation', 'balance'));

CREATE INDEX IF NOT EXISTS rental_orders_draft_archived_idx
  ON public.rental_orders(draft_archived_at DESC)
  WHERE status = 'draft';

-- A paid reservation is an actual availability block, unlike a temporary
-- payment hold. It remains visible in the public calendar until the rental
-- is cancelled or completed.
CREATE OR REPLACE VIEW public.laptop_availability
WITH (security_barrier = true, security_invoker = false) AS
SELECT laptop_id, rental_start_date, rental_end_date, status, hold_expires_at
FROM public.rental_orders
WHERE status IN (
  'reserved', 'confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading', 'awaiting_pickup',
  'issued', 'in_use', 'return_requested', 'awaiting_return_reservation',
  'awaiting_return_dropoff', 'awaiting_return_collection', 'returned', 'incident'
)
   OR (status = 'awaiting_payment' AND hold_expires_at IS NOT NULL AND hold_expires_at > now())
UNION ALL
SELECT replacement_pending_laptop_id, rental_start_date, rental_end_date, 'replacement_pending'::text, NULL::timestamptz
FROM public.rental_orders
WHERE replacement_pending_laptop_id IS NOT NULL
  AND replacement_exchange_status = 'awaiting_exchange';

COMMIT;
