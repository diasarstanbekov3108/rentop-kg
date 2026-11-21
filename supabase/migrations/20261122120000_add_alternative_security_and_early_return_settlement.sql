-- Individual alternative security for a rental when a manager waives/reduces
-- a cash deposit. It is intentionally a manual review flow, not a customer
-- entitlement. Emergency contacts are contacts only, never guarantors.

BEGIN;

ALTER TABLE public.rental_orders
  ADD COLUMN IF NOT EXISTS alternative_security_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS alternative_security_requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alternative_security_note text,
  ADD COLUMN IF NOT EXISTS alternative_security_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS alternative_security_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS alternative_security_decided_by text,
  ADD COLUMN IF NOT EXISTS emergency_contact_name text,
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text,
  ADD COLUMN IF NOT EXISTS emergency_contact_consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS operation_city text,
  ADD COLUMN IF NOT EXISTS representative_name text,
  ADD COLUMN IF NOT EXISTS representative_phone text,
  ADD COLUMN IF NOT EXISTS early_return_settlement_type text,
  ADD COLUMN IF NOT EXISTS early_return_settlement_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS early_return_settlement_note text,
  ADD COLUMN IF NOT EXISTS early_return_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS early_return_settled_by text;

ALTER TABLE public.rental_orders
  DROP CONSTRAINT IF EXISTS rental_orders_alternative_security_status_allowed,
  DROP CONSTRAINT IF EXISTS rental_orders_emergency_contact_phone_format,
  DROP CONSTRAINT IF EXISTS rental_orders_early_return_settlement_type_allowed;

ALTER TABLE public.rental_orders
  ADD CONSTRAINT rental_orders_alternative_security_status_allowed CHECK (
    alternative_security_status IN ('not_requested', 'requested', 'submitted', 'approved', 'rejected')
  ),
  ADD CONSTRAINT rental_orders_emergency_contact_phone_format CHECK (
    emergency_contact_phone IS NULL OR emergency_contact_phone ~ '^[+]996[0-9]{9}$'
  ),
  ADD CONSTRAINT rental_orders_early_return_settlement_type_allowed CHECK (
    early_return_settlement_type IS NULL OR early_return_settlement_type IN ('freeze_days', 'partial_refund', 'no_compensation')
  );

ALTER TABLE public.rental_order_documents
  DROP CONSTRAINT IF EXISTS rental_order_documents_kind_allowed;
ALTER TABLE public.rental_order_documents
  ADD CONSTRAINT rental_order_documents_kind_allowed CHECK (
    kind IN (
      'identity', 'identity_front', 'identity_back', 'selfie', 'supporting',
      'issue_video', 'return_video', 'benefit_proof',
      'alternative_security_video', 'alternative_security_address',
      'alternative_security_work', 'alternative_security_study'
    )
  );

CREATE INDEX IF NOT EXISTS rental_orders_alternative_security_idx
  ON public.rental_orders (alternative_security_status, updated_at DESC);

COMMENT ON COLUMN public.rental_orders.emergency_contact_phone IS
  'Контакт близкого родственника для экстренной связи. Не является поручителем и не создаёт финансовой ответственности.';
COMMENT ON COLUMN public.rental_orders.alternative_security_requirements IS
  'Список доказательств, запрошенных менеджером при индивидуальном решении о снижении/отмене залога.';

COMMIT;
