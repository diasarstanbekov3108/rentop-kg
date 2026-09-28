-- Rentop KG: каждая проверяемая заявка получает отдельную тему рабочей Telegram-группы.

BEGIN;

ALTER TABLE public.rental_order_bot_sessions
  ADD COLUMN IF NOT EXISTS manager_thread_id bigint,
  ADD COLUMN IF NOT EXISTS manager_thread_closed_at timestamptz;

CREATE INDEX IF NOT EXISTS rental_order_bot_sessions_manager_thread_idx
  ON public.rental_order_bot_sessions (manager_thread_id);

COMMIT;
