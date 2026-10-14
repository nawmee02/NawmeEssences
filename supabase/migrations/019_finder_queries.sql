-- ============================================================
--  NawmeEssences — anonymous log of what visitors TYPE into
--  "Find a Scent" (recommend.html), so the finder's parser can be
--  improved from real questions (plan: Phase 1c).
--
--  Privacy by design:
--    • only the typed sentence (≤ 200 chars) + how many products it
--      matched + a timestamp; no IP, no session id, no product ids,
--      no cookies, nothing for chip-only sessions;
--    • the public (anon) key may INSERT only — it can never read the
--      table back; signed-in admins (is_admin()) can read it in the
--      dashboard;
--    • 180-day retention: a pg_cron job if the extension is enabled on
--      the project, and the nightly site build deletes the same rows
--      with the service key as a belt-and-braces fallback.
--
--  Run in the Supabase SQL Editor after 018.
-- ============================================================

CREATE TABLE IF NOT EXISTS finder_queries (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  q           text        NOT NULL CHECK (length(q) BETWEEN 1 AND 200),
  matched     smallint    NOT NULL DEFAULT 0 CHECK (matched BETWEEN 0 AND 99),
  created_at  timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE finder_queries IS 'Anonymous typed questions from Find a Scent (no identifiers). 180-day retention.';

CREATE INDEX IF NOT EXISTS idx_finder_queries_created ON finder_queries (created_at);

ALTER TABLE finder_queries ENABLE ROW LEVEL SECURITY;

-- Postgres has no CREATE POLICY IF NOT EXISTS: drop + create keeps the migration re-runnable.
DROP POLICY IF EXISTS "finder_queries anon insert" ON finder_queries;
CREATE POLICY "finder_queries anon insert" ON finder_queries
  FOR INSERT TO anon, authenticated
  WITH CHECK (length(q) BETWEEN 1 AND 200 AND matched BETWEEN 0 AND 99);

DROP POLICY IF EXISTS "finder_queries admin read" ON finder_queries;
CREATE POLICY "finder_queries admin read" ON finder_queries
  FOR SELECT TO authenticated
  USING (is_admin());

-- No UPDATE / DELETE policies: rows are immutable for every API role; the
-- service role (nightly build) bypasses RLS for the retention delete.
GRANT INSERT ON finder_queries TO anon, authenticated;
GRANT SELECT ON finder_queries TO authenticated;

-- Retention: daily at 03:15 UTC when pg_cron is available (Database → Extensions).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'finder_queries_retention';
    PERFORM cron.schedule('finder_queries_retention', '15 3 * * *',
      $job$ DELETE FROM finder_queries WHERE created_at < now() - interval '180 days' $job$);
  ELSE
    RAISE NOTICE 'pg_cron not enabled: the nightly site build enforces the 180-day retention instead.';
  END IF;
END $$;
