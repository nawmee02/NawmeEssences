-- ============================================================
--  Catalogue corrections found while evaluating the homepage
--  Quick Scent Match (2026-10-29). In each case the quiz followed
--  the stored data correctly, but the data misdescribes the scent,
--  so it was picked for the wrong card (or missed for the right one).
--  These fields also feed the shop filters, the product pages and
--  "You May Also Like", which improve the same way.
--
--  Run in the Supabase SQL Editor. Safe to re-run: every helper
--  checks the current value first and only changes what it names.
--  Review each line; the OPTIONAL block is commented out on purpose.
--
--  Before REMOVING a family or accord label: the chat finder's phrases point at catalogue
--  labels, and its build test fails if a label disappears from every product (that is what
--  happened when item 1 first dropped Milestone's "Musk", the only Musk family in stock).
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.set_family(p_id text, p_family text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fragrance_details SET family = p_family WHERE fragrance_id = p_id;
  IF NOT FOUND THEN RAISE NOTICE 'no fragrance_details row for %', p_id; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.add_accord(p_id text, p_accord text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fragrance_details SET accords = accords || to_jsonb(p_accord)
   WHERE fragrance_id = p_id
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(accords) a WHERE lower(a) = lower(p_accord));
  IF NOT FOUND THEN RAISE NOTICE '% unchanged (missing row, or it already has %)', p_id, p_accord; END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.drop_accord(p_id text, p_accord text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fragrance_details
     SET accords = COALESCE((SELECT jsonb_agg(a ORDER BY o) FROM jsonb_array_elements_text(accords) WITH ORDINALITY t(a, o)
                             WHERE lower(a) <> lower(p_accord)), '[]'::jsonb)
   WHERE fragrance_id = p_id;
  IF NOT FOUND THEN RAISE NOTICE 'no fragrance_details row for %', p_id; END IF;
END $$;

-- Empty occasions mean "inferred from the accords" — appending to an empty list would
-- replace that inference with a single occasion, so it is skipped with a notice instead.
CREATE OR REPLACE FUNCTION pg_temp.add_occasion(p_id text, p_occ text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fragrance_details SET occasions = occasions || to_jsonb(p_occ)
   WHERE fragrance_id = p_id AND jsonb_array_length(occasions) > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(occasions) x WHERE lower(x) = lower(p_occ));
  IF NOT FOUND THEN RAISE NOTICE '% unchanged (occasions empty = inferred, or % already listed): set the full list in the admin', p_id, p_occ; END IF;
END $$;

-- Only fills an empty concentration; never overwrites a value read from a bottle.
CREATE OR REPLACE FUNCTION pg_temp.fill_concentration(p_id text, p_k text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fragrance_details SET concentration = p_k WHERE fragrance_id = p_id AND concentration IS NULL;
  IF NOT FOUND THEN RAISE NOTICE '% unchanged (missing row, or concentration already set)', p_id; END IF;
END $$;

-- 1. Filed as Woody + Floral + Musk (Fragrantica's olfactory group), but its accords are
--    marine-led (Marine, Aromatic, Woody, Powdery, Musky, Fruity) with no floral accord, so it
--    was offered for "Floral & Musky" and described as floral. Filed by its accords instead;
--    Musk stays (Musky is its #5 accord, and it is the only Musk family the finder relies on).
SELECT pg_temp.set_family('armaf-cdni-milestone', 'Aquatic / Woody / Musk');

-- 2. Vanilla #1 and Sweet #2, tagged Party / Date Night, yet filed Oriental + Fougère, so the
--    "Sweet & Gourmand" card missed them. The shop files its other vanilla-led orientals
--    (Amore Caffe, Hawas Elixir, 9PM, Born in Roma Intense) as Oriental + Vanilla.
SELECT pg_temp.set_family('armani-stronger-intensely', 'Oriental / Vanilla');
SELECT pg_temp.set_family('jpg-le-male-elixir',        'Oriental / Vanilla');

-- 3. Spicy is its #1 accord, but its only family is Woody, so one lead accord lost to
--    scents with spice far down their list.
SELECT pg_temp.set_family('lattafa-dynasty', 'Woody / Spicy');

-- 4. Aquatic family and a Calone note, but no marine/aquatic accord, so a strong
--    "clean, subtle" match was ranked below sweeter scents.
SELECT pg_temp.add_accord('rayhaan-azul', 'Marine');

-- 5. Missing concentrations (both are sold as Eau de Parfum).
SELECT pg_temp.fill_concentration('rasasi-hawas',          'EDP');
SELECT pg_temp.fill_concentration('mancera-french-riviera', 'EDP');

-- ── OPTIONAL: judgement calls. Check against the bottle / Fragrantica, then uncomment.
-- 6. Nautica Voyage lists Floral #3 and Powdery #5 ahead of Aquatic #7, so it surfaced for
--    "Floral & Musky". Lotus and mimosa are genuine notes, so this is defensible as it stands.
-- SELECT pg_temp.drop_accord('nautica-voyage', 'Powdery');
-- 7. Milestone is a fresh marine scent a lot of people wear to work; listing Office lets it
--    match office answers (occasions must already be set explicitly for this to apply).
-- SELECT pg_temp.add_occasion('armaf-cdni-milestone', 'Office');

-- 8. Rayhaan Lion lists only four accords (Spicy, Sweet, Aromatic, Woody), so each one weighs
--    more than on a fully described scent and it over-ranks for "Woody + Spicy". Its own notes
--    (lavender, mint, clary sage, pear, cinnamon, cumin, vanilla, amber) suggest the missing ones
--    below; confirm against the bottle / Fragrantica before uncommenting.
-- SELECT pg_temp.add_accord('rayhaan-lion', 'Lavender');
-- SELECT pg_temp.add_accord('rayhaan-lion', 'Fresh Spicy');
-- SELECT pg_temp.add_accord('rayhaan-lion', 'Fruity');
-- SELECT pg_temp.add_accord('rayhaan-lion', 'Vanilla');

-- Checked, no change needed:
--   • essential-parfums-bois-imp-rial lists an Oud accord (from akigalawood's oud-like facet) but
--     no oud/agarwood note. The quiz now calls a scent "oud" only with that note, so it no longer
--     says "Woody & oud" for it — the stored data can stay as the source has it.
--   • mancera-instant-crush already lists Rose (#10) and Musky (#7); its rose/jasmine character
--     is in the data, just ranked low by the source.

-- Not scriptable here (needs the product's real data, not a guess):
--   • rayhaan-lion has no concentration.
--   • rasasi-hawas-malibu: Sweet is its top accord but its only family is Aromatic.
--   • 46 of 87 buyable products still have no concentration (the ongoing fill from the bottles).

-- Check:
SELECT fragrance_id, family, accords, occasions, concentration
  FROM fragrance_details
 WHERE fragrance_id IN ('armaf-cdni-milestone', 'armani-stronger-intensely', 'jpg-le-male-elixir',
                        'lattafa-dynasty', 'rayhaan-azul', 'rasasi-hawas', 'mancera-french-riviera', 'nautica-voyage')
 ORDER BY fragrance_id;
