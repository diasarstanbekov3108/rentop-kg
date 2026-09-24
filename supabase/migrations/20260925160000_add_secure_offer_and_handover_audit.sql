-- Rentop KG: журнал ПЭП, приёмка и возврат для Telegram MVP.
-- Выполнить один раз в Supabase SQL Editor после базовой миграции rental_orders.
-- Не хранит изображения документов, селфи, чеки или OTP в открытом виде.

BEGIN;

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_version text,
  ADD COLUMN IF NOT EXISTS offer_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_otp_hash text,
  ADD COLUMN IF NOT EXISTS offer_otp_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_otp_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS offer_otp_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS received_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS received_comment text,
  ADD COLUMN IF NOT EXISTS received_media_telegram_message_id bigint,
  ADD COLUMN IF NOT EXISTS return_location_id text,
  ADD COLUMN IF NOT EXISTS return_box_id text;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_offer_otp_attempts_allowed,
  DROP CONSTRAINT IF EXISTS rental_orders_received_status_allowed;

ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_offer_otp_attempts_allowed
    CHECK (offer_otp_attempts BETWEEN 0 AND 5),
  ADD CONSTRAINT rental_orders_received_status_allowed
    CHECK (received_status IN ('pending', 'confirmed_ok', 'issue_reported'));

COMMENT ON COLUMN public.rental_orders.offer_otp_hash IS
  'Односторонний HMAC/хеш OTP. Сам код в базе не хранится.';
COMMENT ON COLUMN public.rental_orders.received_media_telegram_message_id IS
  'ID сообщения в закрытом Telegram-чате Rentop; публичная ссылка на медиа не хранится.';

CREATE TABLE IF NOT EXISTS public.rental_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_type text NOT NULL,
  actor_telegram_id bigint,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rental_order_events_order_created_idx
  ON public.rental_order_events(order_id, created_at);

COMMENT ON TABLE public.rental_order_events IS
  'Append-only журнал действий по заказу: согласие с офертой, OTP, решение менеджера, выдача, приёмка и возврат.';

ALTER TABLE public.rental_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_order_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.rental_order_events TO service_role;

COMMIT;
