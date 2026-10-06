-- ============================================================
--  NawmeEssences — concentration becomes free text.
--  016 limited fragrance_details.concentration to eight fixed
--  codes, but real bottles carry many more labels (EDP Intense,
--  Parfum Extreme, Eau Fraîche, Absolu …). Drop the CHECK and
--  keep a sanity limit only: trimmed, non-empty, at most 60 chars.
--  The site expands the common abbreviations itself (EDP → Eau de
--  Parfum) wherever the value is shown; anything else is shown as
--  typed. upsert_product is unchanged (it already stores the raw
--  text), so this migration touches the table only.
--
--  Run in the Supabase SQL Editor after 016.
-- ============================================================

ALTER TABLE fragrance_details DROP CONSTRAINT IF EXISTS fragrance_details_concentration_chk;

DO $$ BEGIN
  ALTER TABLE fragrance_details ADD CONSTRAINT fragrance_details_concentration_chk
    CHECK (concentration IS NULL OR (length(trim(concentration)) BETWEEN 1 AND 60));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
