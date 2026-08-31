-- ============================================================
--  NawmeEssences — editable occasions per fragrance
--  Run in Supabase Dashboard → SQL Editor (re-runnable).
--  Depends on 009_sale_and_meta.sql (current upsert_product).
--
--  Adds an admin-editable occasion list used for the product
--  page's ".pd-occasions" chips. When left empty, the build
--  falls back to inferring occasions from the accords — same
--  override-or-auto pattern as fragrance_details.description.
-- ============================================================

-- ─────────────────────────────────────────
--  1. New column on fragrance_details
-- ─────────────────────────────────────────
ALTER TABLE fragrance_details
  ADD COLUMN IF NOT EXISTS occasions jsonb NOT NULL DEFAULT '[]';

-- ─────────────────────────────────────────
--  2. Teach upsert_product about it.
--     p_details is already jsonb, so the SIGNATURE IS UNCHANGED —
--     CREATE OR REPLACE is enough, no DROP FUNCTION needed.
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
  p_meta_description    text        DEFAULT NULL
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

  -- Fragrance upsert (sale_percent + meta overrides)
  INSERT INTO fragrances (id, name, brand_id, collection, in_stock, is_bestseller, status,
                          sale_percent, meta_title, meta_description, created_by, updated_by)
  VALUES (p_id, p_name, v_brand_id, p_collection, p_in_stock, p_is_bestseller, p_status,
          COALESCE(p_sale_percent, 0), NULLIF(p_meta_title, ''), NULLIF(p_meta_description, ''),
          auth.uid(), auth.uid())
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, brand_id = EXCLUDED.brand_id, collection = EXCLUDED.collection,
    in_stock = EXCLUDED.in_stock, is_bestseller = EXCLUDED.is_bestseller,
    status = EXCLUDED.status, sale_percent = EXCLUDED.sale_percent,
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

  -- Upsert details (now including occasions)
  INSERT INTO fragrance_details (fragrance_id, top_notes, heart_notes, base_notes,
                                 accords, family, description, occasions)
  VALUES (p_id,
    COALESCE(p_details->'top','[]'::jsonb), COALESCE(p_details->'heart','[]'::jsonb),
    COALESCE(p_details->'base','[]'::jsonb), COALESCE(p_details->'accords','[]'::jsonb),
    COALESCE(p_details->>'family',''), COALESCE(p_details->>'description',''),
    COALESCE(p_details->'occasions','[]'::jsonb))
  ON CONFLICT (fragrance_id) DO UPDATE SET
    top_notes = EXCLUDED.top_notes, heart_notes = EXCLUDED.heart_notes, base_notes = EXCLUDED.base_notes,
    accords = EXCLUDED.accords, family = EXCLUDED.family, description = EXCLUDED.description,
    occasions = EXCLUDED.occasions;

  SELECT updated_at INTO v_result FROM fragrances WHERE id = p_id;
  RETURN v_result;
END $$;
