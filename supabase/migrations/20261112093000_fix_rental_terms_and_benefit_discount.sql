-- Keep the database's protected calculation aligned with the website:
-- 15% starts at 7 days, 30% at 15 days, and an approved social benefit gives
-- 10% for shorter terms without stacking with a tariff discount.
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
  has_approved_benefit boolean := false;
  today_bishkek date := (timezone('Asia/Bishkek', now()))::date;
BEGIN
  IF TG_OP = 'INSERT' AND jwt_role IN ('anon', 'authenticated') THEN
    NEW.status := 'awaiting_payment';
    NEW.hold_expires_at := now() + interval '20 minutes';
    NEW.created_at := coalesce(NEW.created_at, now());
    NEW.locker_status := CASE WHEN NEW.delivery_type = 'arca_locker' THEN 'pending' ELSE 'none' END;
    NEW.locker_provider_reference := NULL;
    NEW.locker_id := NULL;
    NEW.locker_address := NULL;
  END IF;

  NEW.updated_at := now();
  NEW.customer_name := nullif(btrim(NEW.customer_name), '');
  NEW.customer_phone := nullif(btrim(NEW.customer_phone), '');
  expected_days := NEW.rental_end_date - NEW.rental_start_date;
  IF expected_days < 2 THEN
    RAISE EXCEPTION 'INVALID_RENTAL_TERMS: минимальный срок аренды — 2 дня' USING ERRCODE = 'P0001';
  END IF;
  IF jwt_role IN ('anon', 'authenticated') AND NEW.rental_start_date < today_bishkek THEN
    RAISE EXCEPTION 'PAST_DATE: нельзя выбрать прошедшую дату' USING ERRCODE = 'P0001';
  END IF;

  expected_discount := CASE WHEN expected_days >= 15 THEN 30 WHEN expected_days >= 7 THEN 15 ELSE 0 END;
  IF NEW.customer_phone IS NOT NULL AND to_regclass('public.customer_benefit_verifications') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.customer_benefit_verifications benefit
      WHERE benefit.phone = NEW.customer_phone
        AND benefit.status = 'approved'
        AND (benefit.expires_at IS NULL OR benefit.expires_at > now())
    ) INTO has_approved_benefit;
  END IF;
  IF has_approved_benefit THEN expected_discount := greatest(expected_discount, 10); END IF;

  SELECT c.column_name INTO rate_column
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'laptops'
    AND c.column_name IN ('daily_rate', 'dailyRate', 'dailyrate')
  ORDER BY CASE c.column_name WHEN 'daily_rate' THEN 0 WHEN 'dailyRate' THEN 1 ELSE 2 END
  LIMIT 1;
  IF rate_column IS NOT NULL THEN
    EXECUTE format('SELECT %I::text FROM public.laptops WHERE id = $1', rate_column) INTO raw_rate USING NEW.laptop_id;
    IF raw_rate IS NOT NULL AND btrim(raw_rate) <> '' THEN
      BEGIN catalog_rate := round(btrim(raw_rate)::numeric, 2); EXCEPTION WHEN invalid_text_representation THEN catalog_rate := NULL; END;
    END IF;
  END IF;
  IF catalog_rate IS NOT NULL AND round(NEW.daily_rate, 2) IS DISTINCT FROM catalog_rate THEN
    RAISE EXCEPTION 'INVALID_RENTAL_TERMS: ставка не совпадает с каталогом' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.rental_days IS DISTINCT FROM expected_days OR NEW.discount_percent IS DISTINCT FROM expected_discount THEN
    RAISE EXCEPTION 'INVALID_RENTAL_TERMS: срок или скидка рассчитаны неверно' USING ERRCODE = 'P0001';
  END IF;
  expected_total := round(NEW.rental_days * NEW.daily_rate * (100 - expected_discount) / 100.0, 0);
  IF round(NEW.total_amount, 0) IS DISTINCT FROM expected_total THEN
    RAISE EXCEPTION 'INVALID_RENTAL_TERMS: сумма не совпадает со сроком и скидкой' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IN ('confirmed', 'awaiting_pickup', 'issued', 'in_use')
    OR (NEW.status = 'awaiting_payment' AND NEW.hold_expires_at > now()) THEN
    PERFORM 1 FROM public.laptops WHERE id = NEW.laptop_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.rental_orders existing
      WHERE existing.laptop_id = NEW.laptop_id AND existing.id IS DISTINCT FROM NEW.id
        AND NEW.rental_start_date < existing.rental_end_date
        AND NEW.rental_end_date > existing.rental_start_date
        AND (existing.status IN ('confirmed', 'issued')
          OR (existing.status = 'awaiting_payment' AND existing.hold_expires_at IS NOT NULL AND existing.hold_expires_at > now()))
    ) THEN
      RAISE EXCEPTION 'LAPTOP_UNAVAILABLE: ноутбук занят на выбранные даты' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
