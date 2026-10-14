-- ============================================================
--  NawmeEssences — "Alternative to" references for Find a Scent.
--  fragrance_details.inspired_by lists the famous fragrances a decant
--  is commonly bought as an alternative to ("Creed Aventus"). The
--  finder (recommend.html) treats a match as a VERIFIED reference —
--  it outranks scent-profile similarity — and says "Verified
--  alternative to …". The names are never shown on product pages.
--
--  1. Column: text[] of trimmed names, at most 10, each ≤ 80 chars.
--  2. upsert_product: persist p_details->'inspired_by' (jsonb array of
--     strings). Signature unchanged — CREATE OR REPLACE only; the
--     admin dashboard sends the key, older clients simply omit it.
--
--  Run in the Supabase SQL Editor after 017.
-- ============================================================

ALTER TABLE fragrance_details ADD COLUMN IF NOT EXISTS inspired_by text[] NOT NULL DEFAULT '{}';

DO $$ BEGIN
  ALTER TABLE fragrance_details ADD CONSTRAINT fragrance_details_inspired_by_chk
    CHECK (cardinality(inspired_by) <= 10
           AND NOT EXISTS (SELECT 1 FROM unnest(inspired_by) n WHERE length(trim(n)) < 1 OR length(n) > 80));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN fragrance_details.inspired_by IS 'Famous fragrances this decant is sold as an alternative to (Find a Scent "verified alternative"). Not shown publicly.';

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
  v_faq        jsonb;
  v_inspired   text[];
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

  -- FAQ: keep only well-formed {q, a} objects with non-empty text.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('q', trim(e->>'q'), 'a', trim(e->>'a'))), '[]'::jsonb)
    INTO v_faq
    FROM jsonb_array_elements(COALESCE(p_details->'faq', '[]'::jsonb)) e
   WHERE jsonb_typeof(e) = 'object' AND trim(COALESCE(e->>'q','')) <> '' AND trim(COALESCE(e->>'a','')) <> '';

  -- inspired_by: trimmed, non-empty, de-duplicated (case-insensitive), ≤ 80 chars, at most 10.
  SELECT COALESCE(array_agg(n ORDER BY ord), '{}'::text[]) INTO v_inspired
    FROM (
      SELECT DISTINCT ON (lower(trim(e))) left(trim(e), 80) AS n, ord
        FROM jsonb_array_elements_text(
               CASE WHEN jsonb_typeof(p_details->'inspired_by') = 'array' THEN p_details->'inspired_by' ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS t(e, ord)
       WHERE trim(e) <> ''
       ORDER BY lower(trim(e)), ord
    ) d
   WHERE ord <= 10;

  -- Upsert details (occasions + gender + launch_year + concentration + faq + inspired_by)
  INSERT INTO fragrance_details (fragrance_id, top_notes, heart_notes, base_notes,
                                 accords, family, description, occasions, gender, launch_year,
                                 concentration, faq, inspired_by)
  VALUES (p_id,
    COALESCE(p_details->'top','[]'::jsonb), COALESCE(p_details->'heart','[]'::jsonb),
    COALESCE(p_details->'base','[]'::jsonb), COALESCE(p_details->'accords','[]'::jsonb),
    COALESCE(p_details->>'family',''), COALESCE(p_details->>'description',''),
    COALESCE(p_details->'occasions','[]'::jsonb),
    NULLIF(p_details->>'gender',''),
    NULLIF(p_details->>'launch_year','')::int,
    NULLIF(p_details->>'concentration',''),
    v_faq,
    v_inspired)
  ON CONFLICT (fragrance_id) DO UPDATE SET
    top_notes = EXCLUDED.top_notes, heart_notes = EXCLUDED.heart_notes, base_notes = EXCLUDED.base_notes,
    accords = EXCLUDED.accords, family = EXCLUDED.family, description = EXCLUDED.description,
    occasions = EXCLUDED.occasions, gender = EXCLUDED.gender, launch_year = EXCLUDED.launch_year,
    concentration = EXCLUDED.concentration, faq = EXCLUDED.faq, inspired_by = EXCLUDED.inspired_by;

  SELECT updated_at INTO v_result FROM fragrances WHERE id = p_id;
  RETURN v_result;
END $$;
