-- Rentop.KG: единый управляемый каталог.
-- Миграция сохраняет существующие записи и добавляет только недостающие поля.
-- Фото временно указывают на нейтральную заглушку сайта; менеджер сможет
-- заменить ссылку на реальную фотографию в панели каталога.

BEGIN;

ALTER TABLE public.laptops
  ADD COLUMN IF NOT EXISTS daily_rate numeric(12, 2),
  ADD COLUMN IF NOT EXISTS price_text text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS laptops_catalog_visible_sort_idx
  ON public.laptops (is_visible, category, sort_order, id);

-- Изображения каталога публичны: это только фотографии техники, без
-- документов клиентов. Загружаются исключительно по подписанной ссылке,
-- которую выдаёт авторизованная панель менеджера.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('catalog-images', 'catalog-images', true, 8388608, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Существующие фотографии и подписи остаются рабочими, если проект ранее
-- использовал legacy-колонки image / priceText.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='laptops' AND column_name='image') THEN
    EXECUTE 'UPDATE public.laptops SET image_url = coalesce(nullif(image_url, ''''), nullif(image::text, '''')) WHERE image_url IS NULL OR btrim(image_url) = ''''';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='laptops' AND column_name='priceText') THEN
    EXECUTE 'UPDATE public.laptops SET price_text = coalesce(nullif(price_text, ''''), nullif("priceText"::text, '''')) WHERE price_text IS NULL OR btrim(price_text) = ''''';
  END IF;
END $$;

-- Не перезаписываем старые модели с тем же названием: это не нарушит уже
-- созданные заявки и позволит обновлять ассортимент безопасно.
INSERT INTO public.laptops (title, category, badge, cpu, ram, storage, daily_rate, price_text, image_url, description, is_visible, sort_order)
SELECT v.title, 'rent', 'АРЕНДА', v.cpu, v.ram, v.storage, v.daily_rate,
       concat('От ', v.daily_rate::text, ' сом / день'),
       '/assets/catalog-placeholder.svg', v.description, true, v.sort_order
FROM (VALUES
  ('Razer Blade 15', 'Intel Core i7 8th Gen', '8 GB RAM', '256 GB SSD · GTX 1070 8 GB', 1500::numeric, 10, 'Премиум-гейминг, 3D-моделирование, VFX и тяжёлый монтаж.'),
  ('Lenovo i3 10th Gen · MX150', 'Intel Core i3 10th Gen', '8 GB RAM', '256 GB SSD · NVIDIA MX150', 1200::numeric, 20, 'Монтаж, графика, учёба и требовательные офисные задачи.'),
  ('HP Laptop 14 · Intel Core i3-1215U', 'Intel Core i3-1215U', '8 GB RAM', '256 GB SSD · Intel UHD', 900::numeric, 30, 'Для TOEFL, IELTS, Duolingo, CSCA и других онлайн-экзаменов.'),
  ('HP Laptop 14 · Intel N150', 'Intel N150, 4 cores', '8 GB RAM', '128 GB SSD', 800::numeric, 40, 'Для TOEFL, IELTS, Duolingo, CSCA и работы с документами.'),
  ('ASUS X555L', 'Intel Core i3-5200U', '4 GB RAM', '256 GB SSD · GeForce GT 920M', 650::numeric, 50, 'Офис, учёба, браузер и базовые программы.'),
  ('Lenovo Touch · i3-3110M', 'Intel Core i3-3110M', '8 GB RAM', '128 GB SSD · HD 770', 650::numeric, 60, 'Шустрый сенсорный ноутбук для учёбы, офиса и браузера.'),
  ('HP Pavilion 15', 'Intel Celeron N3060', '4 GB RAM', '128 GB SSD', 650::numeric, 70, 'Бюджетный вариант для простых офисных задач и документов.'),
  ('Apple MacBook Pro 13 (2013)', 'Intel Core i5', '4 GB RAM', '128 GB SSD · Intel Iris', 650::numeric, 80, 'Компактный MacBook для текстов, браузера и учёбы.'),
  ('Haier 14.1 IPS', 'Intel Pentium N4200', '8 GB RAM', '128 GB SSD · IPS 14.1', 500::numeric, 90, 'Доступный ноутбук для документов, браузера и учёбы.'),
  ('Lenovo Pentium · 6 GB', 'Intel Pentium', '6 GB RAM', '256 GB SSD', 500::numeric, 100, 'Доступный вариант для офисных программ и интернета.'),
  ('Lenovo Celeron · 8 GB', 'Intel Celeron, 2 cores', '8 GB RAM', '256 GB SSD', 500::numeric, 110, 'Для документов, браузера и нетребовательных задач.'),
  ('ASUS Pentium · 1 TB', 'Intel Pentium, 4 cores', '4 GB RAM', '1 TB HDD', 500::numeric, 120, 'Старый, но рабочий ноутбук для базовых задач и документов.')
) AS v(title, cpu, ram, storage, daily_rate, sort_order, description)
WHERE NOT EXISTS (SELECT 1 FROM public.laptops existing WHERE lower(existing.title) = lower(v.title));

UPDATE public.laptops
SET price_text = CASE
  WHEN category = 'rent' AND daily_rate > 0 THEN concat('От ', daily_rate::text, ' сом / день')
  ELSE price_text
END
WHERE (price_text IS NULL OR btrim(price_text) = '') AND category = 'rent';

COMMIT;
