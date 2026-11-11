-- Support categories for common delivery and booking questions in the cabinet.
ALTER TABLE public.rental_order_support_cases
  DROP CONSTRAINT IF EXISTS rental_order_support_cases_kind_check;

ALTER TABLE public.rental_order_support_cases
  ADD CONSTRAINT rental_order_support_cases_kind_check CHECK (
    kind IN (
      'rentop', 'archa', 'archa_code_missing', 'archa_locker_issue', 'rental_issue',
      'delivery_status', 'delivery_change', 'address_change', 'order_cancel'
    )
  );
