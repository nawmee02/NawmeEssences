-- ============================================================
--  NawmeEssences — Blog. A blog_posts table authored from the
--  admin (Markdown + cover image), published as static SEO pages
--  by the build. Public-read (published only); admin-write.
--  Run in Supabase Dashboard → SQL Editor (re-runnable).
--  Depends on is_admin() + set_updated_at() from 004_admin.sql.
-- ============================================================

CREATE TABLE IF NOT EXISTS blog_posts (
  id               text PRIMARY KEY,          -- slug, e.g. "why-perfume-decants"
  title            text NOT NULL,
  excerpt          text,                      -- card blurb + meta-description fallback
  body_md          text NOT NULL DEFAULT '',  -- Markdown source
  cover            boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'draft',
  meta_title       text,
  meta_description text,
  published_at     timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  created_by       uuid,
  updated_by       uuid
);

DO $$ BEGIN
  ALTER TABLE blog_posts ADD CONSTRAINT blog_posts_status_chk
    CHECK (status IN ('draft','published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-bump updated_at (reuse the trigger fn from 004)
DROP TRIGGER IF EXISTS blog_posts_set_updated_at ON blog_posts;
CREATE TRIGGER blog_posts_set_updated_at
  BEFORE UPDATE ON blog_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────
--  RLS: public reads published; admins do everything
-- ─────────────────────────────────────────
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read blog_posts" ON blog_posts;
CREATE POLICY "public read blog_posts" ON blog_posts
  FOR SELECT USING (status = 'published' OR is_admin());

DROP POLICY IF EXISTS "admin write blog_posts" ON blog_posts;
CREATE POLICY "admin write blog_posts" ON blog_posts
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
