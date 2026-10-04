-- Исправляет проверку формата номера в первой миграции кабинета.
-- Выполнить один раз после 20261004110000_add_customer_cabinet_sessions.sql.

BEGIN;

ALTER TABLE public.customer_auth_challenges
  DROP CONSTRAINT IF EXISTS customer_auth_challenges_phone_format,
  ADD CONSTRAINT customer_auth_challenges_phone_format
    CHECK (phone ~ '^[+]996[0-9]{9}$');

ALTER TABLE public.customer_cabinet_sessions
  DROP CONSTRAINT IF EXISTS customer_cabinet_sessions_phone_format,
  ADD CONSTRAINT customer_cabinet_sessions_phone_format
    CHECK (phone ~ '^[+]996[0-9]{9}$');

UPDATE public.rental_orders
SET customer_phone = CASE
  WHEN regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') ~ '^996[0-9]{9}$'
    THEN '+' || regexp_replace(customer_phone, '[^0-9]', '', 'g')
  WHEN regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g') ~ '^0[0-9]{9}$'
    THEN '+996' || substr(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 2)
  ELSE customer_phone
END
WHERE customer_phone IS NOT NULL;

COMMIT;
