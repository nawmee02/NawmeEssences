// ============================================================
//  sync-catalog.js — One command to sync the whole catalog.
//
//    validate (local)  →  optimize  →  upload (changed)  →
//    seed database  →  generate pages  →  validate (remote)
//
//  Fails fast: if any step reports an error, the pipeline stops
//  and exits non-zero so problems never reach production.
//
//  Usage:
//    npm run sync-catalog            full pipeline
//    npm run sync-catalog -- --force re-upload every image
// ============================================================
const validate = require('./validate-catalog');
const optimize = require('./optimize-images');
const upload   = require('./upload-images');
const seed     = require('./seed-database');
const pages    = require('./generate-product-pages');

function banner(n, total, label) {
  console.log(`\n━━━ [${n}/${total}] ${label} ${'━'.repeat(Math.max(0, 40 - label.length))}`);
}

async function main() {
  const force = process.argv.includes('--force');
  const total = 6;
  const t0 = Date.now();

  banner(1, total, 'Validate (pre-flight)');
  const v1 = await validate.run({ remote: false });
  if (!v1.ok) { console.error('\n⛔ Validation failed — fix the errors above before syncing.'); process.exit(1); }

  banner(2, total, 'Optimize images');
  const opt = await optimize.run();
  if (!opt.ok) { console.error('\n⛔ Image optimization had errors.'); process.exit(1); }

  banner(3, total, 'Upload changed images');
  const up = await upload.run({ force });
  if (!up.ok) { console.error('\n⛔ Image upload had errors.'); process.exit(1); }

  banner(4, total, 'Seed database');
  await seed.run();

  banner(5, total, 'Generate product pages');
  const pg = pages.run();
  if (!pg.ok) { console.error('\n⛔ Product page generation failed.'); process.exit(1); }

  banner(6, total, 'Validate (remote)');
  const v2 = await validate.run({ remote: true });
  if (!v2.ok) { console.error('\n⛔ Post-seed validation failed — DB/Storage are out of sync.'); process.exit(1); }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✅ Catalog synced in ${secs}s — `
    + `${opt.generated} optimized, ${up.uploaded} uploaded, ${pg.written} pages, database up to date.`);
}

main().catch(e => {
  console.error('\n❌ sync-catalog failed:', e.message);
  process.exit(1);
});
