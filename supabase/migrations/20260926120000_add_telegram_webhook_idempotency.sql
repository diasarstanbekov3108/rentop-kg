-- Prevents Telegram retries from performing the same payment, approval or
-- manager action twice. Run once in Supabase SQL Editor before Production.

BEGIN;

CREATE TABLE IF NOT EXISTS public.telegram_webhook_updates (
  update_id bigint PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_webhook_updates_received_at_idx
  ON public.telegram_webhook_updates (received_at);

ALTER TABLE public.telegram_webhook_updates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.telegram_webhook_updates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.telegram_webhook_updates TO service_role;

COMMENT ON TABLE public.telegram_webhook_updates IS
  'Anti-replay ledger for Telegram update_id values. No customer content is stored.';

COMMIT;
