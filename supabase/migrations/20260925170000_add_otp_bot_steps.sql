-- Rentop KG: этапы Telegram для подтверждённого контакта, типа документа и ПЭП.
-- Выполнить после 20260925160000_add_secure_offer_and_handover_audit.sql.

BEGIN;

ALTER TABLE public.rental_order_bot_sessions
  ADD COLUMN IF NOT EXISTS document_type text;

ALTER TABLE public.rental_order_bot_sessions
  DROP CONSTRAINT IF EXISTS rental_order_bot_sessions_step_allowed;

ALTER TABLE public.rental_order_bot_sessions
  ADD CONSTRAINT rental_order_bot_sessions_step_allowed CHECK (
    step IN (
      'awaiting_name', 'awaiting_phone', 'awaiting_phone_contact',
      'awaiting_document_type', 'awaiting_id', 'awaiting_selfie',
      'awaiting_supporting_document', 'awaiting_offer_acceptance',
      'awaiting_offer_otp', 'under_review', 'awaiting_payment_method',
      'awaiting_receipt', 'payment_review', 'awaiting_pickup',
      'awaiting_receipt_confirmation', 'awaiting_issue_evidence',
      'awaiting_return_video', 'completed'
    )
  );

COMMIT;
