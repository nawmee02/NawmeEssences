-- ============================================================
--  NawmeEssences — Custom product description
--  Run in Supabase Dashboard → SQL Editor
--
--  Adds an editable description used for the product page's
--  ".pd-desc" text. When left blank, the build falls back to an
--  auto-generated description built from the fragrance notes.
-- ============================================================
ALTER TABLE fragrance_details ADD COLUMN IF NOT EXISTS description text;
