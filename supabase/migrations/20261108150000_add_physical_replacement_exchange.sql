BEGIN;

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS replacement_pending_laptop_id bigint REFERENCES public.laptops(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS replacement_exchange_method text,
  ADD COLUMN IF NOT EXISTS replacement_exchange_status text,
  ADD COLUMN IF NOT EXISTS replacement_incident_reason text;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_replacement_exchange_method_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_replacement_exchange_method_allowed CHECK (
    replacement_exchange_method IS NULL OR replacement_exchange_method IN ('arca_locker', 'rentop_courier', 'customer_courier', 'self_delivery')
  );
ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_replacement_exchange_status_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_replacement_exchange_status_allowed CHECK (
    replacement_exchange_status IS NULL OR replacement_exchange_status IN ('awaiting_exchange', 'completed', 'cancelled')
  );

CREATE OR REPLACE VIEW public.laptop_availability
WITH (security_barrier = true, security_invoker = false) AS
SELECT laptop_id, rental_start_date, rental_end_date, status, hold_expires_at
FROM public.rental_orders
WHERE status IN (
  'confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading', 'awaiting_pickup',
  'issued', 'in_use', 'return_requested', 'awaiting_return_reservation',
  'awaiting_return_dropoff', 'awaiting_return_collection', 'returned', 'incident'
)
   OR (status = 'awaiting_payment' AND hold_expires_at IS NOT NULL AND hold_expires_at > now())
UNION ALL
SELECT replacement_pending_laptop_id, rental_start_date, rental_end_date, 'replacement_pending'::text, NULL::timestamptz
FROM public.rental_orders
WHERE replacement_pending_laptop_id IS NOT NULL
  AND replacement_exchange_status = 'awaiting_exchange';

CREATE OR REPLACE FUNCTION public.enforce_pending_replacement_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading', 'awaiting_pickup', 'issued', 'in_use', 'incident')
     OR (NEW.status = 'awaiting_payment' AND NEW.hold_expires_at IS NOT NULL AND NEW.hold_expires_at > now()) THEN
    IF EXISTS (
      SELECT 1 FROM public.rental_orders existing
      WHERE existing.id IS DISTINCT FROM NEW.id
        AND existing.replacement_pending_laptop_id = NEW.laptop_id
        AND existing.replacement_exchange_status = 'awaiting_exchange'
        AND NEW.rental_start_date < existing.rental_end_date
        AND NEW.rental_end_date > existing.rental_start_date
    ) THEN
      RAISE EXCEPTION 'LAPTOP_UNAVAILABLE: ноутбук зарезервирован для согласованной замены'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rental_orders_block_pending_replacement ON public.rental_orders;
CREATE TRIGGER rental_orders_block_pending_replacement
  BEFORE INSERT OR UPDATE OF laptop_id, rental_start_date, rental_end_date, status, hold_expires_at
  ON public.rental_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pending_replacement_availability();

COMMIT;
