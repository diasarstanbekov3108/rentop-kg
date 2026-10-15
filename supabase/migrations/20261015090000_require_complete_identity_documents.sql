-- Run after 20261014050000_add_archa_operational_workflow.sql.
-- New website applications require both sides of the identity document,
-- a selfie, and an official supporting document before manager review.

BEGIN;

ALTER TABLE public.rental_order_documents
  DROP CONSTRAINT IF EXISTS rental_order_documents_kind_allowed;
ALTER TABLE public.rental_order_documents
  ADD CONSTRAINT rental_order_documents_kind_allowed CHECK (
    kind IN ('identity', 'identity_front', 'identity_back', 'selfie', 'supporting', 'issue_video', 'return_video')
  );

COMMIT;
