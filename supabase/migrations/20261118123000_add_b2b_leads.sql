BEGIN;

CREATE TABLE IF NOT EXISTS public.b2b_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL CHECK (char_length(btrim(company_name)) BETWEEN 2 AND 160),
  contact_name text NOT NULL CHECK (char_length(btrim(contact_name)) BETWEEN 2 AND 160),
  phone text NOT NULL CHECK (phone ~ '^\\+996[0-9]{9}$'),
  email text,
  quantity integer NOT NULL CHECK (quantity BETWEEN 3 AND 500),
  term_months integer CHECK (term_months IN (1, 3, 6, 12)),
  device_profile text NOT NULL CHECK (device_profile IN ('office', 'development', 'design', 'mixed', 'other')),
  delivery_preference text NOT NULL CHECK (delivery_preference IN ('delivery', 'pickup', 'undecided')),
  comment text,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'proposal_sent', 'contract', 'closed', 'lost')),
  manager_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS b2b_leads_status_created_idx ON public.b2b_leads (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_b2b_lead_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS b2b_leads_touch_updated_at ON public.b2b_leads;
CREATE TRIGGER b2b_leads_touch_updated_at
  BEFORE UPDATE ON public.b2b_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_b2b_lead_updated_at();

ALTER TABLE public.b2b_leads ENABLE ROW LEVEL SECURITY;

COMMIT;
