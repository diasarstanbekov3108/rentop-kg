-- Выполнить после всех предыдущих миграций.
-- Структурированные данные для досье: адрес указывает клиент, реквизиты ID
-- сверяет сотрудник по загруженному документу. Старые заявки не меняются.

BEGIN;

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS residence_address text,
  ADD COLUMN IF NOT EXISTS supporting_document_type text,
  ADD COLUMN IF NOT EXISTS identity_document_number text,
  ADD COLUMN IF NOT EXISTS identity_document_issuer text,
  ADD COLUMN IF NOT EXISTS identity_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS identity_verified_by text;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_residence_address_len,
  DROP CONSTRAINT IF EXISTS rental_orders_supporting_document_type_len,
  DROP CONSTRAINT IF EXISTS rental_orders_identity_document_number_len,
  DROP CONSTRAINT IF EXISTS rental_orders_identity_document_issuer_len;

ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_residence_address_len CHECK (residence_address IS NULL OR char_length(btrim(residence_address)) BETWEEN 8 AND 500),
  ADD CONSTRAINT rental_orders_supporting_document_type_len CHECK (supporting_document_type IS NULL OR char_length(btrim(supporting_document_type)) BETWEEN 3 AND 120),
  ADD CONSTRAINT rental_orders_identity_document_number_len CHECK (identity_document_number IS NULL OR char_length(btrim(identity_document_number)) BETWEEN 3 AND 80),
  ADD CONSTRAINT rental_orders_identity_document_issuer_len CHECK (identity_document_issuer IS NULL OR char_length(btrim(identity_document_issuer)) BETWEEN 3 AND 240);

COMMENT ON COLUMN public.rental_orders.residence_address IS 'Адрес проживания, введённый клиентом при заявке.';
COMMENT ON COLUMN public.rental_orders.supporting_document_type IS 'Тип обязательного подтверждающего документа: проживание, работа, учёба или иной официальный документ.';
COMMENT ON COLUMN public.rental_orders.identity_document_number IS 'Реквизит удостоверяющего документа, вручную сверенный менеджером по закрытому файлу.';

COMMIT;
