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
--  RLS — follows the hardened pattern from 006_advisor_cleanup:
--  anon reads published rows WITHOUT calling is_admin() (anon has no
--  EXECUTE on it), while admins (authenticated) read drafts + write.
--  A combined `status='published' OR is_admin()` rule would raise
--  "permission denied for function is_admin" for anon.
-- ─────────────────────────────────────────
ALTER TABLE blog_posts ENABLE ROW LEVEL SECURITY;

-- Published posts readable by everyone (no function call).
DROP POLICY IF EXISTS "public read blog_posts" ON blog_posts;
DROP POLICY IF EXISTS "read published blog_posts" ON blog_posts;
CREATE POLICY "read published blog_posts" ON blog_posts
  FOR SELECT TO anon, authenticated
  USING (status = 'published');

-- Admins (authenticated) can also read drafts.
DROP POLICY IF EXISTS "admin read draft blog_posts" ON blog_posts;
CREATE POLICY "admin read draft blog_posts" ON blog_posts
  FOR SELECT TO authenticated
  USING (is_admin());

-- Admins (authenticated) do all writes.
DROP POLICY IF EXISTS "admin write blog_posts" ON blog_posts;
CREATE POLICY "admin write blog_posts" ON blog_posts
  FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());
