-- Rentop KG: сохраняем ссылки на сообщения клиента, чтобы пересылать документы
-- менеджеру единым пакетом только после завершения анкеты.

BEGIN;

ALTER TABLE public.rental_order_bot_sessions
  ADD COLUMN IF NOT EXISTS id_document_first_message_id bigint,
  ADD COLUMN IF NOT EXISTS id_document_second_message_id bigint,
  ADD COLUMN IF NOT EXISTS selfie_message_id bigint,
  ADD COLUMN IF NOT EXISTS supporting_document_message_id bigint;

COMMIT;
