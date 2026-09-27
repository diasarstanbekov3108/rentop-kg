-- Rentop KG: раздельная проверка видео возврата и сообщение клиенту через бота.

BEGIN;

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
      'awaiting_extension_receipt', 'awaiting_support_message',
      'awaiting_return_precheck', 'awaiting_return_approval',
      'awaiting_return_dropoff', 'awaiting_return_retrieval',
      'awaiting_early_return_reason'
    )
  );

ALTER TABLE public.rental_order_admin_actions
  DROP CONSTRAINT IF EXISTS rental_order_admin_actions_allowed;

ALTER TABLE public.rental_order_admin_actions
  ADD CONSTRAINT rental_order_admin_actions_allowed CHECK (
    action IN ('deposit', 'pickup_pin', 'customer_message')
  );

COMMIT;
