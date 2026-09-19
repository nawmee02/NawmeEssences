-- ============================================================
--  NawmeEssences — Customer reviews & recommendations.
--  A reviews table curated from the admin (Facebook recommendations,
--  WhatsApp/Messenger feedback shared with permission, Google/website
--  reviews), published as static HTML by the build: 3 admin-chosen
--  cards on the homepage + the /reviews/ page.
--  Public-read (published only); admin-write.
--  Run in Supabase Dashboard → SQL Editor (re-runnable).
--  Depends on is_admin() + set_updated_at() from 004_admin.sql.
--
--  Terminology: a Facebook "recommends" entry has NO star rating
--  (rating IS NULL) and is a *recommendation*; star-rated entries
--  are *reviews*. The site never synthesises stars for the former.
--  `verified` is a separate owner-set flag (purchase confirmed) —
--  never implied by the source.
--  `status = 'pending'` is reserved for a future customer-submitted
--  form; nothing writes it yet and no anon INSERT policy exists.
-- ============================================================

CREATE TABLE IF NOT EXISTS reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,                     -- as shown (owner anonymises by hand if asked)
  body          text NOT NULL,
  rating        int,                               -- 1..5, or NULL for a Facebook recommendation
  source        text NOT NULL DEFAULT 'facebook',
  source_url    text,                              -- original post permalink → "View on Facebook →"
  product_name  text,                              -- free text, no FK
  reviewed_at   date,
  lang          text NOT NULL DEFAULT 'en',        -- 'en' | 'bn' → lang attr + Bengali font stack
  photo         boolean NOT NULL DEFAULT false,    -- presence flag; files at product-images/reviews/{id}/{thumb,medium}.webp
  verified      boolean NOT NULL DEFAULT false,    -- owner confirmed this person ordered
  home_slot     int,                               -- 1..3 = exact homepage position, NULL = not on homepage
  status        text NOT NULL DEFAULT 'draft',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  created_by    uuid,
  updated_by    uuid
);

DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_rating_chk
    CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_source_chk
    CHECK (source IN ('facebook','whatsapp','messenger','instagram','google','website','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_status_chk
    CHECK (status IN ('draft','published','pending'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_home_slot_chk
    CHECK (home_slot IS NULL OR home_slot BETWEEN 1 AND 3);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_lang_chk
    CHECK (lang IN ('en','bn'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- One review per homepage slot. Partial so NULL (not on homepage) is unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_home_slot_uniq
  ON reviews (home_slot) WHERE home_slot IS NOT NULL;

-- One row per original post. Partial (NULLs allowed) — this is what makes
-- the seed's ON CONFLICT (source_url) DO NOTHING valid and re-runnable.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_source_url_uniq
  ON reviews (source_url) WHERE source_url IS NOT NULL;

-- Auto-bump updated_at (reuse the trigger fn from 004)
DROP TRIGGER IF EXISTS reviews_set_updated_at ON reviews;
CREATE TRIGGER reviews_set_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────
--  RLS — same hardened pattern as 010_blog: anon reads published rows
--  WITHOUT calling is_admin() (anon has no EXECUTE on it); admins
--  (authenticated) read drafts + write.
-- ─────────────────────────────────────────
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "read published reviews" ON reviews;
CREATE POLICY "read published reviews" ON reviews
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

DROP POLICY IF EXISTS "admin read all reviews" ON reviews;
CREATE POLICY "admin read all reviews" ON reviews
  FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS "admin write reviews" ON reviews;
CREATE POLICY "admin write reviews" ON reviews
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Storage: review photos live under product-images/reviews/{id}/ — the
-- bucket-wide admin policy from 006 already covers the prefix, so no new
-- storage policy is needed (same trick as blog/ covers and brands/ logos).
