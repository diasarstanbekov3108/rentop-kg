-- Метки «Подходит для» в карточках каталога.
-- Это не влияет на заявки и может безопасно выполняться после предыдущей
-- миграции управления каталогом.

BEGIN;

ALTER TABLE public.laptops
  ADD COLUMN IF NOT EXISTS use_cases text;

UPDATE public.laptops
SET use_cases = CASE
  WHEN lower(title) LIKE '%i3-1215u%' THEN 'TOEFL, IELTS, Duolingo, CSCA, Онлайн-экзамены'
  WHEN lower(title) LIKE '%n150%' THEN 'TOEFL, IELTS, Duolingo, CSCA, Онлайн-экзамены'
  WHEN lower(title) LIKE '%razer blade%' THEN 'Игры, Blender, 3D, Монтаж, VFX'
  WHEN lower(title) LIKE '%mx150%' THEN 'Монтаж, Графика, Учёба, Офис'
  WHEN lower(title) LIKE '%x555l%' THEN 'Word, Excel, Учёба, Офис'
  WHEN lower(title) LIKE '%touch%' THEN 'Word, Excel, Учёба, Офис'
  WHEN lower(title) LIKE '%pavilion%' THEN 'Word, Excel, Браузер, Учёба'
  WHEN lower(title) LIKE '%haier%' THEN 'Word, Excel, Браузер, Учёба'
  WHEN lower(title) LIKE '%pentium%' OR lower(title) LIKE '%celer%on%' THEN 'Word, Excel, Браузер, Офис'
  WHEN lower(title) LIKE '%macbook pro 13 (2013)%' THEN 'Word, Браузер, Учёба, Офис'
  ELSE use_cases
END
WHERE use_cases IS NULL OR btrim(use_cases) = '';

COMMIT;
