-- Rentop KG: отдельные этапы продления и описания обращения.

BEGIN;

ALTER TABLE public.rental_order_bot_sessions
  ADD COLUMN IF NOT EXISTS extension_days integer,
  ADD COLUMN IF NOT EXISTS extension_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS support_kind_pending text;

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
      'awaiting_return_video', 'awaiting_feedback', 'in_use', 'completed',
      'awaiting_extension_days', 'awaiting_extension_bank',
      'awaiting_extension_receipt', 'awaiting_support_message'
    )
  );

ALTER TABLE public.rental_order_support_cases
  ADD COLUMN IF NOT EXISTS customer_message text;

COMMIT;
