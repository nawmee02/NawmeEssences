-- ============================================================
--  NawmeEssences — gender + launch year as real product attributes.
--  Until now the product page parsed "for men" / "Launched in 2023"
--  out of the description text for the Fragrance Snapshot. This
--  makes them first-class columns on fragrance_details, backfills
--  them from the existing descriptions, and teaches upsert_product
--  to save them from the admin form (p_details jsonb → columns).
--
--  Run in Supabase Dashboard → SQL Editor (re-runnable).
--  Depends on 014_sale_until.sql (current upsert_product signature).
-- ============================================================

-- ─────────────────────────────────────────
--  1. New columns
-- ─────────────────────────────────────────
ALTER TABLE fragrance_details ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE fragrance_details ADD COLUMN IF NOT EXISTS launch_year int;
DO $$ BEGIN
  ALTER TABLE fragrance_details ADD CONSTRAINT fragrance_details_gender_chk
    CHECK (gender IS NULL OR gender IN ('men', 'women', 'unisex'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE fragrance_details ADD CONSTRAINT fragrance_details_launch_year_chk
    CHECK (launch_year IS NULL OR launch_year BETWEEN 1900 AND 2100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────
--  2. One-time backfill from the description text (same rules the
--     generator used). Only fills rows that are still NULL, so values
--     edited by hand in the admin are never overwritten.
-- ─────────────────────────────────────────
UPDATE fragrance_details
SET    launch_year = substring(lower(description) from '\m(?:launched|released|introduced|debuted)(?: in)? ((?:19|20)\d{2})\M')::int
WHERE  launch_year IS NULL
  AND  description ~* '\m(?:launched|released|introduced|debuted)(?: in)? (?:19|20)\d{2}\M';

UPDATE fragrance_details
SET    gender = CASE
         WHEN description ~* '\m(?:unisex|for (?:both )?men and women|for women and men)\M' THEN 'unisex'
         WHEN description ~* '\mfor women\M' THEN 'women'
         WHEN description ~* '\mfor men\M'   THEN 'men'
       END
WHERE  gender IS NULL
  AND  description ~* '\m(?:unisex|for (?:both )?men and women|for women and men|for women|for men)\M';

-- ─────────────────────────────────────────
--  3. upsert_product: persist the two fields from p_details.
--     Signature unchanged (p_details is jsonb) — CREATE OR REPLACE only.
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_product(
  p_id                  text,
  p_name                text,
  p_brand_name          text,
  p_collection          text,
  p_in_stock            boolean,
  p_is_bestseller       boolean,
  p_status              text,
  p_sizes               jsonb,
  p_tags                jsonb,
  p_details             jsonb,
  p_expected_updated_at timestamptz DEFAULT NULL,
  p_sale_percent        int         DEFAULT 0,
  p_meta_title          text        DEFAULT NULL,
  p_meta_description    text        DEFAULT NULL,
  p_sale_until          date        DEFAULT NULL
) RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  v_brand_id   uuid;
  v_brand_slug text := regexp_replace(lower(p_brand_name), '[^a-z0-9]+', '-', 'g');
  v_current    timestamptz;
  v_result     timestamptz;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not authorized'; END IF;

  -- Optimistic lock: if editing, the caller's loaded timestamp must match.
  SELECT updated_at INTO v_current FROM fragrances WHERE id = p_id;
  IF FOUND AND p_expected_updated_at IS NOT NULL AND v_current <> p_expected_updated_at THEN
    RAISE EXCEPTION 'stale';
  END IF;

  -- Brand upsert
  v_brand_slug := trim(both '-' from v_brand_slug);
  INSERT INTO brands (slug, name) VALUES (v_brand_slug, p_brand_name)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id INTO v_brand_id;
  IF v_brand_id IS NULL THEN
    SELECT id INTO v_brand_id FROM brands WHERE slug = v_brand_slug;
  END IF;

  -- Fragrance upsert (sale_percent + sale_until + meta overrides)
  INSERT INTO fragrances (id, name, brand_id, collection, in_stock, is_bestseller, status,
                          sale_percent, sale_until, meta_title, meta_description, created_by, updated_by)
  VALUES (p_id, p_name, v_brand_id, p_collection, p_in_stock, p_is_bestseller, p_status,
          COALESCE(p_sale_percent, 0), p_sale_until, NULLIF(p_meta_title, ''), NULLIF(p_meta_description, ''),
          auth.uid(), auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, brand_id = EXCLUDED.brand_id, collection = EXCLUDED.collection,
    in_stock = EXCLUDED.in_stock, is_bestseller = EXCLUDED.is_bestseller,
    status = EXCLUDED.status, sale_percent = EXCLUDED.sale_percent, sale_until = EXCLUDED.sale_until,
    meta_title = EXCLUDED.meta_title, meta_description = EXCLUDED.meta_description,
    updated_by = auth.uid();

  -- Replace sizes
  DELETE FROM fragrance_sizes WHERE fragrance_id = p_id;
  INSERT INTO fragrance_sizes (fragrance_id, ml, price)
    SELECT p_id, (e->>'ml')::int, (e->>'price')::int FROM jsonb_array_elements(p_sizes) e;

  -- Replace tags
  DELETE FROM fragrance_tags WHERE fragrance_id = p_id;
  INSERT INTO fragrance_tags (fragrance_id, tag)
    SELECT p_id, jsonb_array_elements_text(p_tags);

  -- Upsert details (occasions + gender + launch_year)
  INSERT INTO fragrance_details (fragrance_id, top_notes, heart_notes, base_notes,
                                 accords, family, description, occasions, gender, launch_year)
  VALUES (p_id,
    COALESCE(p_details->'top','[]'::jsonb), COALESCE(p_details->'heart','[]'::jsonb),
    COALESCE(p_details->'base','[]'::jsonb), COALESCE(p_details->'accords','[]'::jsonb),
    COALESCE(p_details->>'family',''), COALESCE(p_details->>'description',''),
    COALESCE(p_details->'occasions','[]'::jsonb),
    NULLIF(p_details->>'gender',''),
    NULLIF(p_details->>'launch_year','')::int)
  ON CONFLICT (fragrance_id) DO UPDATE SET
    top_notes = EXCLUDED.top_notes, heart_notes = EXCLUDED.heart_notes, base_notes = EXCLUDED.base_notes,
    accords = EXCLUDED.accords, family = EXCLUDED.family, description = EXCLUDED.description,
    occasions = EXCLUDED.occasions, gender = EXCLUDED.gender, launch_year = EXCLUDED.launch_year;

  SELECT updated_at INTO v_result FROM fragrances WHERE id = p_id;
  RETURN v_result;
END $$;
