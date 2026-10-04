-- Профиль клиента для личного кабинета. Один профиль на подтверждённый номер.

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_profiles (
  phone text PRIMARY KEY,
  full_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_profiles_phone_format CHECK (phone ~ '^[+]996[0-9]{9}$'),
  CONSTRAINT customer_profiles_full_name_len CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 5 AND 180)
);

INSERT INTO public.customer_profiles (phone, full_name)
SELECT DISTINCT ON (customer_phone) customer_phone, customer_name
FROM public.rental_orders
WHERE customer_phone ~ '^[+]996[0-9]{9}$'
  AND customer_name IS NOT NULL
  AND char_length(btrim(customer_name)) >= 5
ORDER BY customer_phone, updated_at DESC
ON CONFLICT (phone) DO NOTHING;

ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.customer_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.customer_profiles TO service_role;

CREATE TRIGGER customer_profiles_set_updated_at
  BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_rental_order_updated_at();

COMMENT ON TABLE public.customer_profiles IS
  'Имя клиента для личного кабинета. Доступ выдаётся только сервером после SMS-подтверждения номера.';

COMMIT;
