-- Rentop KG: безопасный вход в личный кабинет по подтверждённому номеру.
-- Выполнить один раз в Supabase SQL Editor после базовых миграций.
-- Одноразовые коды и токены сессий хранятся только как HMAC-хеши.

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_auth_challenges_phone_format CHECK (phone ~ '^\\+996[0-9]{9}$'),
  CONSTRAINT customer_auth_challenges_attempts_allowed CHECK (attempts BETWEEN 0 AND 5)
);

CREATE INDEX IF NOT EXISTS customer_auth_challenges_phone_created_idx
  ON public.customer_auth_challenges(phone, created_at DESC);

CREATE TABLE IF NOT EXISTS public.customer_cabinet_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  user_agent text,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_cabinet_sessions_phone_format CHECK (phone ~ '^\\+996[0-9]{9}$')
);

CREATE INDEX IF NOT EXISTS customer_cabinet_sessions_token_idx
  ON public.customer_cabinet_sessions(token_hash)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS rental_orders_customer_phone_idx
  ON public.rental_orders(customer_phone);

ALTER TABLE public.customer_auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_cabinet_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_auth_challenges FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.customer_cabinet_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_auth_challenges TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.customer_cabinet_sessions TO service_role;

COMMENT ON TABLE public.customer_auth_challenges IS
  'Краткоживущие OTP-вызовы для входа в личный кабинет. Код хранится только в виде HMAC.';
COMMENT ON TABLE public.customer_cabinet_sessions IS
  'Сессии личного кабинета. Браузер получает случайный токен в httpOnly cookie; в БД хранится HMAC.';

COMMIT;
