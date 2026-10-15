-- ============================================================
--  Starter values for fragrance_details.inspired_by (migration 018).
--  "Alternative to" references the finder treats as VERIFIED matches
--  ("Verified alternative to Dior Sauvage"). Each pair below is widely
--  documented in Fragrantica's "reminds me of" votes and reviews; edit
--  freely in the admin dashboard afterwards (the field is per product).
--
--  Run in the Supabase SQL Editor AFTER 018. Safe to re-run: it merges
--  (case-insensitive) into whatever is already stored.
-- ============================================================

CREATE OR REPLACE FUNCTION pg_temp.add_inspired(p_id text, p_names text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE fragrance_details d
     SET inspired_by = (
       SELECT COALESCE(array_agg(n ORDER BY ord), '{}'::text[])
         FROM (
           SELECT DISTINCT ON (lower(n)) n, ord
             FROM unnest(d.inspired_by || p_names) WITH ORDINALITY AS t(n, ord)
            WHERE length(trim(n)) BETWEEN 1 AND 80
            ORDER BY lower(n), ord
         ) x
        WHERE ord <= 10)
   WHERE d.fragrance_id = p_id;
  IF NOT FOUND THEN RAISE NOTICE 'no fragrance_details row for %', p_id; END IF;
END $$;

SELECT pg_temp.add_inspired('afnan-modest-une',   ARRAY['Dior Sauvage']);                       -- Fragrantica: Modest Une ≈ Sauvage (EDT/EDP DNA)
SELECT pg_temp.add_inspired('armaf-cdni-iconic',  ARRAY['Bleu de Chanel']);                     -- Fragrantica: Iconic ≈ Bleu de Chanel EDP
SELECT pg_temp.add_inspired('armaf-cdni-edp',     ARRAY['Creed Aventus']);                      -- Club de Nuit Intense Man ≈ Aventus
SELECT pg_temp.add_inspired('armaf-cdni-extrait', ARRAY['Creed Aventus']);
SELECT pg_temp.add_inspired('afnan-9pm',          ARRAY['Jean Paul Gaultier Ultra Male']);      -- 9PM ≈ Ultra Male
SELECT pg_temp.add_inspired('rasasi-hawas',       ARRAY['Paco Rabanne Invictus Aqua']);         -- Hawas for Him ≈ Invictus Aqua
-- Owner-stated 2026-10-15 (not on Fragrantica): both Sanaya bottles are sold as alternatives to
-- Louis Vuitton Imagination; Sanaya 40 is the Extrait (40% oil) of Sanaya (EDP). Fresh, citrusy,
-- somewhat soapy; casual / everyday / summer / office.
SELECT pg_temp.add_inspired('junaid-perfumes-sanaya',   ARRAY['Louis Vuitton Imagination']);
SELECT pg_temp.add_inspired('junaid-perfumes-sanaya40', ARRAY['Louis Vuitton Imagination']);

-- Check:
SELECT fragrance_id, inspired_by FROM fragrance_details WHERE cardinality(inspired_by) > 0 ORDER BY fragrance_id;
