BEGIN;

-- A final return video is valid only after ARCHA POINT (or a manager) has
-- allocated a return cell and delivered a fresh access code to the customer.
ALTER TABLE public.rental_order_bot_sessions
  ADD COLUMN IF NOT EXISTS return_access_prepared_at timestamptz;

COMMIT;
