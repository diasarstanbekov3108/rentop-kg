BEGIN;

-- ARCHA POINT is included in the published rental tariff. Office models must
-- not be offered below 650 som/day. GREATEST makes this part safe to rerun.
UPDATE public.laptops
SET daily_rate = GREATEST(COALESCE(daily_rate, 0), 650)
WHERE category = 'rent'
  AND lower(coalesce(title, '')) ~ '(thinkpad|latitude|probook|elitebook|vostro|office|офис)';

-- One-time approved increases for the current gaming catalogue (+100 som/day).
-- Each condition contains the former price, so a second run cannot add +100 again.
UPDATE public.laptops
SET daily_rate = CASE
  WHEN lower(coalesce(title, '')) LIKE '%dell g15%' AND daily_rate = 1800 THEN 1900
  WHEN lower(coalesce(title, '')) LIKE '%razer blade 15%' AND daily_rate = 1500 THEN 1600
  WHEN lower(coalesce(title, '')) LIKE '%msi katana gf76%' AND daily_rate = 1100 THEN 1200
  WHEN lower(coalesce(title, '')) LIKE '%msi gf63 thin 10sc%' AND daily_rate = 1200 THEN 1300
  ELSE daily_rate
END
WHERE category = 'rent'
  AND (
    (lower(coalesce(title, '')) LIKE '%dell g15%' AND daily_rate = 1800)
    OR (lower(coalesce(title, '')) LIKE '%razer blade 15%' AND daily_rate = 1500)
    OR (lower(coalesce(title, '')) LIKE '%msi katana gf76%' AND daily_rate = 1100)
    OR (lower(coalesce(title, '')) LIKE '%msi gf63 thin 10sc%' AND daily_rate = 1200)
  );

COMMIT;
