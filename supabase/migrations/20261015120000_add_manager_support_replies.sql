-- Run after the existing support-case migrations.
-- Replies are shown to the verified customer in the Rentop cabinet.

BEGIN;

ALTER TABLE public.rental_order_support_cases
  ADD COLUMN IF NOT EXISTS manager_reply text,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_by text;

ALTER TABLE public.rental_order_support_cases
  DROP CONSTRAINT IF EXISTS rental_order_support_cases_manager_reply_len;
ALTER TABLE public.rental_order_support_cases
  ADD CONSTRAINT rental_order_support_cases_manager_reply_len CHECK (
    manager_reply IS NULL OR char_length(btrim(manager_reply)) BETWEEN 3 AND 1500
  );

COMMIT;
