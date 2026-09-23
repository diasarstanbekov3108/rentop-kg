-- RENTOP.KG: доступность ноутбуков и временный резерв заявки.
-- Этот файл НЕ применяется автоматически.
-- Не вставляйте сюда service-role ключ и не подключайте его к фронтенду.
--
-- Как применить вручную:
-- 1. Откройте проект Supabase → SQL Editor.
-- 2. Вставьте этот файл целиком и выполните его один раз.
-- 3. Убедитесь, что появились public.rental_orders и public.laptop_availability.
-- 4. В Table Editor не отключайте RLS у rental_orders.
-- Повторный запуск остановится, если таблица уже есть.

BEGIN;

DO $$
DECLARE
  laptop_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod)
    INTO laptop_id_type
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'laptops'
    AND a.attname = 'id'
    AND a.attnum > 0
    AND NOT a.attisdropped;

  IF laptop_id_type IS NULL THEN
    RAISE EXCEPTION 'Не найдена public.laptops.id. Сначала нужна таблица каталога.';
  END IF;

  IF to_regclass('public.rental_orders') IS NOT NULL THEN
    RAISE EXCEPTION 'Таблица public.rental_orders уже существует. Повторно миграцию не применяйте.';
  END IF;

  EXECUTE format($sql$
    CREATE TABLE public.rental_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      laptop_id %s NOT NULL REFERENCES public.laptops (id) ON DELETE RESTRICT,
      customer_name text NOT NULL,
      customer_phone text NOT NULL,
      rental_start_date date NOT NULL,
      rental_end_date date NOT NULL,
      rental_days integer NOT NULL,
      daily_rate numeric(12, 2) NOT NULL,
      discount_percent integer NOT NULL,
      total_amount numeric(12, 2) NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      delivery_type text NOT NULL,
      locker_provider_reference text,
      locker_id text,
      locker_address text,
      locker_status text NOT NULL DEFAULT 'none',
      hold_expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT rental_orders_customer_name_len CHECK (char_length(btrim(customer_name)) BETWEEN 2 AND 120),
      CONSTRAINT rental_orders_customer_phone_len CHECK (char_length(btrim(customer_phone)) BETWEEN 6 AND 32),
      CONSTRAINT rental_orders_end_after_start CHECK (rental_end_date > rental_start_date),
      CONSTRAINT rental_orders_days_match CHECK (rental_days = (rental_end_date - rental_start_date)),
      CONSTRAINT rental_orders_days_positive CHECK (rental_days >= 1),
      CONSTRAINT rental_orders_daily_rate_nonnegative CHECK (daily_rate >= 0),
      CONSTRAINT rental_orders_total_nonnegative CHECK (total_amount >= 0),
      CONSTRAINT rental_orders_discount_allowed CHECK (discount_percent IN (0, 15, 30)),
      CONSTRAINT rental_orders_status_allowed CHECK (
        status IN (
          'draft',
          'awaiting_payment',
          'confirmed',
          'issued',
          'returned',
          'cancelled',
          'expired'
        )
      ),
      CONSTRAINT rental_orders_delivery_allowed CHECK (delivery_type IN ('pickup', 'delivery', 'arca_locker')),
      CONSTRAINT rental_orders_locker_status_allowed CHECK (
        locker_status IN ('none', 'pending', 'loaded', 'client_picked_up', 'return_pending', 'returned', 'failed')
      ),
      CONSTRAINT rental_orders_hold_for_payment CHECK (
        status <> 'awaiting_payment' OR hold_expires_at IS NOT NULL
      )
    )
  $sql$, laptop_id_type);
END $$;

COMMENT ON TABLE public.rental_orders IS
  'Заявки на аренду. Оплату сайт не принимает: awaiting_payment только резервирует ноутбук на 20 минут.';

COMMENT ON COLUMN public.rental_orders.rental_end_date IS
  'День возврата. В пересечение не входит: новый старт может совпадать с этой датой.';

COMMENT ON COLUMN public.rental_orders.hold_expires_at IS
  'Для awaiting_payment резерв блокирует даты только до этого момента.';

CREATE INDEX rental_orders_laptop_id_idx
  ON public.rental_orders (laptop_id);

CREATE INDEX rental_orders_status_idx
  ON public.rental_orders (status);

CREATE INDEX rental_orders_date_range_idx
  ON public.rental_orders (rental_start_date, rental_end_date);

CREATE OR REPLACE FUNCTION public.touch_rental_order_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER rental_orders_set_updated_at
  BEFORE UPDATE ON public.rental_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_rental_order_updated_at();

CREATE OR REPLACE FUNCTION public.enforce_rental_order_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_role text := coalesce(auth.role(), '');
  rate_column text;
  raw_rate text;
  catalog_rate numeric(12, 2);
  expected_discount integer;
  expected_days integer;
  expected_total numeric(12, 2);
  today_bishkek date := (timezone('Asia/Bishkek', now()))::date;
BEGIN
  IF TG_OP = 'INSERT' AND jwt_role IN ('anon', 'authenticated') THEN
    NEW.status := 'awaiting_payment';
    NEW.hold_expires_at := now() + interval '20 minutes';
    NEW.created_at := coalesce(NEW.created_at, now());
    -- Клиент может выбрать только способ получения. Статус ячейки меняет
    -- исключительно админка Rentop или серверная интеграция ARCHA POINT.
    NEW.locker_status := CASE
      WHEN NEW.delivery_type = 'arca_locker' THEN 'pending'
      ELSE 'none'
    END;
    NEW.locker_provider_reference := NULL;
    NEW.locker_id := NULL;
    NEW.locker_address := NULL;
  END IF;

  NEW.updated_at := now();
  NEW.customer_name := btrim(NEW.customer_name);
  NEW.customer_phone := btrim(NEW.customer_phone);

  expected_days := NEW.rental_end_date - NEW.rental_start_date;
  IF expected_days < 1 THEN
    RAISE EXCEPTION 'INVALID_RENTAL_TERMS: дата окончания должна быть позже даты начала'
      USING ERRCODE = 'P0001';
  END IF;

  IF jwt_role IN ('anon', 'authenticated') AND NEW.rental_start_date < today_bishkek THEN
    RAISE EXCEPTION 'PAST_DATE: нельзя выбрать прошедшую дату'
      USING ERRCODE = 'P0001';
  END IF;

  expected_discount := CASE
    WHEN expected_days BETWEEN 1 AND 3 THEN 0
    WHEN expected_days BETWEEN 4 AND 14 THEN 15
    ELSE 30
  END;

  SELECT c.column_name
    INTO rate_column
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'laptops'
    AND c.column_name IN ('daily_rate', 'dailyRate', 'dailyrate')
  ORDER BY CASE c.column_name
    WHEN 'daily_rate' THEN 0
    WHEN 'dailyRate' THEN 1
    ELSE 2
  END
  LIMIT 1;

  IF rate_column IS NOT NULL THEN
    EXECUTE format('SELECT %I::text FROM public.laptops WHERE id = $1', rate_column)
      INTO raw_rate
      USING NEW.laptop_id;

    IF raw_rate IS NOT NULL AND btrim(raw_rate) <> '' THEN
      BEGIN
        catalog_rate := round(btrim(raw_rate)::numeric, 2);
      EXCEPTION
        WHEN invalid_text_representation THEN
          catalog_rate := NULL;
      END;
    END IF;
  END IF;

  IF catalog_rate IS NOT NULL AND round(NEW.daily_rate, 2) IS DISTINCT FROM catalog_rate THEN
    RAISE EXCEPTION 'INVALID_RENTAL_TERMS: ставка не совпадает с каталогом'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.rental_days IS DISTINCT FROM expected_days
     OR NEW.discount_percent IS DISTINCT FROM expected_discount THEN
    RAISE EXCEPTION 'INVALID_RENTAL_TERMS: срок или скидка рассчитаны неверно'
      USING ERRCODE = 'P0001';
  END IF;

  expected_total := round(NEW.rental_days * NEW.daily_rate * (100 - expected_discount) / 100.0, 0);

  IF round(NEW.total_amount, 0) IS DISTINCT FROM expected_total THEN
    RAISE EXCEPTION 'INVALID_RENTAL_TERMS: сумма не совпадает со сроком и скидкой'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW.status IN ('confirmed', 'issued')
     OR (NEW.status = 'awaiting_payment' AND NEW.hold_expires_at > now()) THEN
    -- Сериализуем заявки по одному ноутбуку, чтобы два запроса не заняли одни даты.
    PERFORM 1
    FROM public.laptops
    WHERE id = NEW.laptop_id
    FOR UPDATE;

    IF EXISTS (
      SELECT 1
      FROM public.rental_orders existing
      WHERE existing.laptop_id = NEW.laptop_id
        AND existing.id IS DISTINCT FROM NEW.id
        AND NEW.rental_start_date < existing.rental_end_date
        AND NEW.rental_end_date > existing.rental_start_date
        AND (
          existing.status IN ('confirmed', 'issued')
          OR (
            existing.status = 'awaiting_payment'
            AND existing.hold_expires_at IS NOT NULL
            AND existing.hold_expires_at > now()
          )
        )
    ) THEN
      RAISE EXCEPTION 'LAPTOP_UNAVAILABLE: ноутбук занят на выбранные даты'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER rental_orders_enforce_rules
  BEFORE INSERT OR UPDATE ON public.rental_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_rental_order_rules();

-- Представление отдаёт только даты и статус. Имя и телефон клиента в него не входят.
CREATE VIEW public.laptop_availability
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  laptop_id,
  rental_start_date,
  rental_end_date,
  status,
  hold_expires_at
FROM public.rental_orders
WHERE status IN ('confirmed', 'issued')
   OR (
     status = 'awaiting_payment'
     AND hold_expires_at IS NOT NULL
     AND hold_expires_at > now()
   );

COMMENT ON VIEW public.laptop_availability IS
  'Активные блокирующие периоды без персональных данных. Просроченный резерв сюда не попадает.';

ALTER TABLE public.rental_orders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.rental_orders FROM PUBLIC, anon, authenticated;
GRANT INSERT ON TABLE public.rental_orders TO anon, authenticated;
GRANT SELECT (id) ON TABLE public.rental_orders TO anon, authenticated;

GRANT SELECT ON TABLE public.laptop_availability TO anon, authenticated;

CREATE POLICY rental_orders_public_insert
  ON public.rental_orders
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    status = 'awaiting_payment'
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at > now()
    AND hold_expires_at <= now() + interval '21 minutes'
    AND rental_end_date > rental_start_date
    AND rental_start_date >= (timezone('Asia/Bishkek', now()))::date
  );

-- id нужен сайту, чтобы показать номер заявки. Остальные колонки анониму не выдаются.
CREATE POLICY rental_orders_public_read_id
  ON public.rental_orders
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMIT;
