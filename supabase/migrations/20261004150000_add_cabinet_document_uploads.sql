-- Закрытые документы клиента, загруженные из личного кабинета.
-- Файлы хранятся в private bucket; публичные URL не создаются.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rental-documents',
  'rental-documents',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.rental_order_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.rental_orders(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  status text NOT NULL DEFAULT 'pending_review',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewer_note text,
  CONSTRAINT rental_order_documents_kind_allowed CHECK (kind IN ('identity', 'selfie', 'supporting')),
  CONSTRAINT rental_order_documents_content_type_allowed CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
  CONSTRAINT rental_order_documents_size_allowed CHECK (byte_size BETWEEN 1 AND 8388608),
  CONSTRAINT rental_order_documents_status_allowed CHECK (status IN ('pending_review', 'accepted', 'rejected'))
);

CREATE INDEX IF NOT EXISTS rental_order_documents_order_uploaded_idx
  ON public.rental_order_documents(order_id, uploaded_at DESC);

ALTER TABLE public.rental_order_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.rental_order_documents FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.rental_order_documents TO service_role;

COMMENT ON TABLE public.rental_order_documents IS
  'Метаданные документов заявки. Файлы лежат в закрытом Supabase Storage bucket rental-documents.';

COMMIT;
