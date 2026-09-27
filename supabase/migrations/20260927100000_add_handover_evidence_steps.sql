-- Rentop KG: этапы видеофиксации при выдаче и возврате.
-- Выполнить после 20260925170000_add_otp_bot_steps.sql.

BEGIN;

ALTER TABLE public.rental_order_bot_sessions
  ADD COLUMN IF NOT EXISTS pickup_video_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_video_received_at timestamptz;

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
      'awaiting_return_video', 'awaiting_feedback', 'in_use', 'completed'
    )
  );

COMMENT ON COLUMN public.rental_order_bot_sessions.pickup_video_received_at IS
  'Время получения в Telegram видео осмотра ноутбука при выдаче.';
COMMENT ON COLUMN public.rental_order_bot_sessions.return_video_received_at IS
  'Время получения в Telegram видео возврата ноутбука.';

COMMIT;
