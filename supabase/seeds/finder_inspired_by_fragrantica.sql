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

SELECT pg_temp.add_inspired('afnan-9pm', ARRAY['JEAN PAUL GAULTIER Ultra Male', 'ZARA Gourmand Leather']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('afnan-modest-une', ARRAY['DIOR Sauvage', 'DIOR Sauvage Eau de Parfum']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('afnan-supremacy-collectors', ARRAY['CREED Absolu Aventus 2023', 'CREED Absolu Aventus']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('afnan-supremacy-not-only-intense', ARRAY['NISHANE Hacivat', 'CREED Aventus']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('afnan-turathi-brown', ARRAY['YVES SAINT LAURENT Tuxedo', 'ROCHAS Moustache Eau de Parfum']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('al-haramain-amber-oud-aqua-dubai', ARRAY['LOUIS VUITTON Imagination']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('al-haramain-amber-oud-dubai-night', ARRAY['MONTALE Arabians Tonka', 'RIIFFS PERFUMES Momento']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('al-haramain-amber-oud-gold', ARRAY['XERJOFF Erba Pura', 'TIZIANA TERENZI Kirkè']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('arabiyat-prestige-bois-blanc', ARRAY['ESSENTIAL PARFUMS Bois Impérial']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('armaf-cdni-edp', ARRAY['CREED Aventus', 'MONTBLANC Explorer']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('armaf-cdni-extrait', ARRAY['CREED Aventus']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('armaf-cdni-iconic', ARRAY['CHANEL Bleu de Chanel Eau de Parfum', 'CHANEL Bleu de Chanel']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('armaf-cdni-milestone', ARRAY['CREED Millésime Impérial', 'SEAN JOHN Unforgivable']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('bentley-silverlake', ARRAY['GIORGIO ARMANI Acqua di Gio Essenza', 'GIORGIO ARMANI Acqua di Gio']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('french-avenue-aether', ARRAY['PARFUMS DE MARLY Greenley']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('french-avenue-atlantis', ARRAY['ROOM 1015 Wavechild']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('french-avenue-liquid-brun', ARRAY['PARFUMS DE MARLY Althaïr']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('french-avenue-magnetiq', ARRAY['YVES SAINT LAURENT MYSLF Eau de Parfum', 'PRADA Luna Rossa Ocean']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('french-avenue-platine-blanc', ARRAY['XERJOFF Torino21']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('french-avenue-vulcan-black-friday', ARRAY['XERJOFF Deified Tony Iommi Parfum', 'XERJOFF Deified Tony Iommi Signed Edition']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('french-avenue-vulcan-feu', ARRAY['STÉPHANE HUMBERT LUCAS 777 God of Fire']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('french-avenue-vulcan-sable', ARRAY['STÉPHANE HUMBERT LUCAS 777 Sand Dance']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('lattafa-angham', ARRAY['BURBERRY Goddess', 'RARE BEAUTY Rare']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('lattafa-dynasty', ARRAY['CLIVE CHRISTIAN L Red Tea Vetiver', 'DOLCE&GABBANA Velvet Infusion']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('lattafa-khamrah-qahwa', ARRAY['RIIFFS PERFUMES Golden Elixir Reserve']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-fattan', ARRAY['HERMÈS Terre d''Hermès', 'HERMÈS Terre d''Hermes Parfum']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-hawas', ARRAY['RABANNE Invictus', 'RABANNE Invictus Aqua']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-hawas-black', ARRAY['NISHANE Hacivat']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-hawas-elixir', ARRAY['JEAN PAUL GAULTIER Le Male Elixir']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-hawas-ice', ARRAY['RABANNE Invictus Aqua (2018)', 'RABANNE Invictus']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-hawas-kobra', ARRAY['LOUIS VUITTON Imagination', 'BUJAIRAMI Hectic']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-hawas-malibu', ARRAY['JEAN PAUL GAULTIER Le Beau Le Parfum']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-hawas-thunder', ARRAY['YVES SAINT LAURENT MYSLF L’Absolu']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-hawas-tropical', ARRAY['JEAN PAUL GAULTIER Le Beau Paradise Garden']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rasasi-shuhrah-elixir', ARRAY['BVLGARI Tygar', 'SOSPIRO PERFUMES Vibrato']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rayhaan-aquatica', ARRAY['CREED Virgin Island Water 2007', 'CREED Virgin Island Water']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rayhaan-azul', ARRAY['DIOR Dior Homme Cologne 2022', 'DIOR Dior Homme Cologne 2013']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rayhaan-italia', ARRAY['XERJOFF XJ 1861 Naxos']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rayhaan-lion', ARRAY['JEAN PAUL GAULTIER Ultra Male']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rayhaan-nocturno-elixir', ARRAY['CHANEL Bleu de Chanel L''Exclusif', 'CHANEL Bleu de Chanel Parfum']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('rayhaan-terra', ARRAY['AMOUAGE Outlands']);  -- Fragrantica votes
SELECT pg_temp.add_inspired('riiffs-fareed', ARRAY['YVES SAINT LAURENT La Nuit de l''Homme']);  -- Fragrantica votes

-- Check:
SELECT fragrance_id, inspired_by FROM fragrance_details WHERE cardinality(inspired_by) > 0 ORDER BY fragrance_id;
