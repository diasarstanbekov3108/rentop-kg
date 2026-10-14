-- Утверждённый операционный процесс RENTOP.KG × ARCHA POINT.
-- Выполнить один раз в Supabase SQL Editor после предыдущих миграций.
-- Коды закладки видит только менеджер; клиентские коды не передаются в группу ARCHA POINT.

BEGIN;

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS customer_note text,
  ADD COLUMN IF NOT EXISTS archa_handoff_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS locker_loading_code text,
  ADD COLUMN IF NOT EXISTS locker_loading_reference text,
  ADD COLUMN IF NOT EXISTS locker_loaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_access_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_method text,
  ADD COLUMN IF NOT EXISTS return_locker_address text,
  ADD COLUMN IF NOT EXISTS return_access_code text,
  ADD COLUMN IF NOT EXISTS return_access_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS rental_purpose text,
  ADD COLUMN IF NOT EXISTS manager_note text,
  ADD COLUMN IF NOT EXISTS return_condition_note text;

-- Evidence for the SMS confirmation of the offer is kept separately from the
-- raw SMS code: only its one-way HMAC is stored in offer_otp_hash.
ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS offer_consent_ip text,
  ADD COLUMN IF NOT EXISTS offer_consent_user_agent text;

-- Asset identifiers belong to the physical laptop, not a particular rental.
-- Fill these fields in the Supabase laptops table before real issue.
ALTER TABLE public.laptops
  ADD COLUMN IF NOT EXISTS serial_number text,
  ADD COLUMN IF NOT EXISTS inventory_code text;

CREATE UNIQUE INDEX IF NOT EXISTS laptops_serial_number_unique
  ON public.laptops (serial_number)
  WHERE serial_number IS NOT NULL AND btrim(serial_number) <> '';
CREATE UNIQUE INDEX IF NOT EXISTS laptops_inventory_code_unique
  ON public.laptops (inventory_code)
  WHERE inventory_code IS NOT NULL AND btrim(inventory_code) <> '';

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_status_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_status_allowed CHECK (
    status IN (
      'draft', 'pending_review', 'awaiting_payment', 'payment_review', 'confirmed',
      'awaiting_archa_reservation', 'awaiting_locker_loading', 'awaiting_pickup',
      'issued', 'in_use', 'return_requested', 'awaiting_return_reservation',
      'awaiting_return_dropoff', 'returned', 'completed', 'rejected', 'cancelled', 'expired', 'incident'
    )
  );

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_locker_status_allowed;
ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_locker_status_allowed CHECK (
    locker_status IN (
      'none', 'pending', 'reservation_requested', 'reserved', 'loaded', 'access_sent',
      'client_picked_up', 'return_pending', 'return_reserved', 'return_access_sent',
      'returned', 'failed'
    )
  );

ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_customer_note_len CHECK (customer_note IS NULL OR char_length(btrim(customer_note)) <= 1000),
  ADD CONSTRAINT rental_orders_rental_purpose_len CHECK (rental_purpose IS NULL OR char_length(btrim(rental_purpose)) <= 600),
  ADD CONSTRAINT rental_orders_manager_note_len CHECK (manager_note IS NULL OR char_length(btrim(manager_note)) <= 2000),
  ADD CONSTRAINT rental_orders_return_condition_note_len CHECK (return_condition_note IS NULL OR char_length(btrim(return_condition_note)) <= 2000),
  ADD CONSTRAINT rental_orders_return_method_allowed CHECK (return_method IS NULL OR return_method IN ('arca_locker', 'courier', 'warehouse'));

-- A website-only customer may not have a Telegram account, therefore a loyalty
-- code can be tied to the verified phone instead of a Telegram user ID.
ALTER TABLE public.rental_promo_codes
  ALTER COLUMN recipient_telegram_user_id DROP NOT NULL;
ALTER TABLE public.rental_promo_codes
  DROP CONSTRAINT IF EXISTS rental_promo_codes_recipient_required;
ALTER TABLE public.rental_promo_codes
  ADD CONSTRAINT rental_promo_codes_recipient_required CHECK (
    recipient_telegram_user_id IS NOT NULL OR recipient_phone IS NOT NULL
  );
CREATE INDEX IF NOT EXISTS rental_promo_codes_phone_idx
  ON public.rental_promo_codes (recipient_phone, status, expires_at DESC)
  WHERE recipient_phone IS NOT NULL;

ALTER TABLE public.rental_order_customer_requests
  ADD COLUMN IF NOT EXISTS return_method text,
  ADD COLUMN IF NOT EXISTS return_locker_address text;

ALTER TABLE public.rental_order_customer_requests
  DROP CONSTRAINT IF EXISTS rental_customer_requests_kind_allowed;
ALTER TABLE public.rental_order_customer_requests
  ADD CONSTRAINT rental_customer_requests_kind_allowed CHECK (kind IN ('extension', 'early_return'));
ALTER TABLE public.rental_order_customer_requests
  ADD CONSTRAINT rental_customer_requests_return_method_allowed CHECK (
    return_method IS NULL OR return_method IN ('arca_locker', 'courier', 'warehouse')
  );

ALTER TABLE public.rental_order_support_cases
  DROP CONSTRAINT IF EXISTS rental_order_support_cases_kind_check;
ALTER TABLE public.rental_order_support_cases
  ADD CONSTRAINT rental_order_support_cases_kind_check CHECK (
    kind IN ('rentop', 'archa', 'archa_code_missing', 'archa_locker_issue', 'rental_issue')
  );

ALTER TABLE public.rental_order_documents
  DROP CONSTRAINT IF EXISTS rental_order_documents_kind_allowed;
ALTER TABLE public.rental_order_documents
  ADD CONSTRAINT rental_order_documents_kind_allowed CHECK (kind IN ('identity', 'selfie', 'supporting', 'issue_video', 'return_video'));
ALTER TABLE public.rental_order_documents
  DROP CONSTRAINT IF EXISTS rental_order_documents_content_type_allowed;
ALTER TABLE public.rental_order_documents
  ADD CONSTRAINT rental_order_documents_content_type_allowed CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'video/quicktime'));
ALTER TABLE public.rental_order_documents
  DROP CONSTRAINT IF EXISTS rental_order_documents_size_allowed;
ALTER TABLE public.rental_order_documents
  ADD CONSTRAINT rental_order_documents_size_allowed CHECK (byte_size BETWEEN 1 AND 52428800);

UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf', 'video/mp4', 'video/quicktime']
WHERE id = 'rental-documents';

CREATE TABLE IF NOT EXISTS public.rental_order_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  review text,
  suggestion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_order_feedback_content CHECK (
    nullif(btrim(coalesce(review, '')), '') IS NOT NULL
    OR nullif(btrim(coalesce(suggestion, '')), '') IS NOT NULL
  )
);

ALTER TABLE public.rental_order_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_order_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.rental_order_feedback TO service_role;

CREATE INDEX IF NOT EXISTS rental_orders_archa_workflow_idx
  ON public.rental_orders(status, locker_status, updated_at DESC);

-- Every operational stage that has reserved or issued a physical laptop must
-- block the same dates in the public availability calendar. Otherwise a
-- laptop could be shown as free while it is waiting in an ARCHA POINT cell or
-- while an incident is being resolved.
CREATE OR REPLACE VIEW public.laptop_availability
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  laptop_id,
  rental_start_date,
  rental_end_date,
  status,
  hold_expires_at
FROM public.rental_orders
WHERE status IN (
  'confirmed', 'awaiting_archa_reservation', 'awaiting_locker_loading',
  'awaiting_pickup', 'issued', 'in_use', 'return_requested',
  'awaiting_return_reservation', 'awaiting_return_dropoff', 'returned', 'incident'
)
OR (
  status = 'awaiting_payment'
  AND hold_expires_at IS NOT NULL
  AND hold_expires_at > now()
);

COMMENT ON COLUMN public.rental_orders.locker_loading_code IS
  'Служебный код ARCHA POINT для закладки устройства. Не передавать клиенту.';
COMMENT ON COLUMN public.rental_orders.pickup_pin IS
  'Код доступа клиента. Используется только в аварийном ручном сценарии, когда ARCHA POINT не отправил SMS.';
COMMENT ON COLUMN public.laptops.serial_number IS
  'Заводской серийный номер физического ноутбука. Заполняется один раз и не передаётся клиенту.';
COMMENT ON COLUMN public.laptops.inventory_code IS
  'Внутренний инвентарный идентификатор Rentop для маркировки и досье по выдаче.';

COMMIT;
