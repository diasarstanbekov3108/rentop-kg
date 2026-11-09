BEGIN;

-- A pending replacement reserves a second physical laptop. Check both
-- directions: a replacement cannot take a laptop already held by another
-- order, and a fresh reservation cannot take a laptop held for replacement.
CREATE OR REPLACE FUNCTION public.enforce_pending_replacement_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.replacement_pending_laptop_id IS NOT NULL
     AND NEW.replacement_exchange_status = 'awaiting_exchange' THEN
    IF EXISTS (
      SELECT 1
      FROM public.rental_orders existing
      WHERE existing.id IS DISTINCT FROM NEW.id
        AND existing.laptop_id = NEW.replacement_pending_laptop_id
        AND NEW.rental_start_date < existing.rental_end_date
        AND NEW.rental_end_date > existing.rental_start_date
        AND (
          existing.status IN (
            'confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading',
            'awaiting_pickup', 'issued', 'in_use', 'return_requested',
            'awaiting_return_reservation', 'awaiting_return_dropoff',
            'awaiting_return_collection', 'returned', 'incident'
          )
          OR (existing.status = 'awaiting_payment'
              AND existing.hold_expires_at IS NOT NULL
              AND existing.hold_expires_at > now())
        )
    ) THEN
      RAISE EXCEPTION 'LAPTOP_UNAVAILABLE: ноутбук уже занят или временно удерживается другой заявкой'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF NEW.status IN (
       'confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading',
       'awaiting_pickup', 'issued', 'in_use', 'return_requested',
       'awaiting_return_reservation', 'awaiting_return_dropoff',
       'awaiting_return_collection', 'returned', 'incident'
     )
     OR (NEW.status = 'awaiting_payment'
         AND NEW.hold_expires_at IS NOT NULL
         AND NEW.hold_expires_at > now()) THEN
    IF EXISTS (
      SELECT 1
      FROM public.rental_orders existing
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
  BEFORE INSERT OR UPDATE OF laptop_id, replacement_pending_laptop_id,
    rental_start_date, rental_end_date, status, hold_expires_at,
    replacement_exchange_status
  ON public.rental_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pending_replacement_availability();

COMMIT;
