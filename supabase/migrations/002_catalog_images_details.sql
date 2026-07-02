-- ============================================================
--  NawmeEssences — Catalog Images + Details
--  Run in Supabase Dashboard → SQL Editor after 001_initial_schema.sql
-- ============================================================

-- ─────────────────────────────────────────
--  1. Add image URL columns to fragrances
-- ─────────────────────────────────────────
ALTER TABLE fragrances ADD COLUMN IF NOT EXISTS image_thumb  text;
ALTER TABLE fragrances ADD COLUMN IF NOT EXISTS image_medium text;
ALTER TABLE fragrances ADD COLUMN IF NOT EXISTS image_large  text;

-- ─────────────────────────────────────────
--  2. Fragrance details (notes + accords)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fragrance_details (
  fragrance_id  text PRIMARY KEY REFERENCES fragrances(id) ON DELETE CASCADE,
  top_notes     jsonb NOT NULL DEFAULT '[]',
  heart_notes   jsonb NOT NULL DEFAULT '[]',
  base_notes    jsonb NOT NULL DEFAULT '[]',
  accords       jsonb NOT NULL DEFAULT '[]',
  family        text  NOT NULL DEFAULT ''
);

ALTER TABLE fragrance_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read fragrance_details" ON fragrance_details;
CREATE POLICY "public read fragrance_details"
  ON fragrance_details FOR SELECT USING (true);
