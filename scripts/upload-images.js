// ============================================================
//  upload-images.js — Upload only new/changed WebP variants to
//  Supabase Storage. Uses a content-hash manifest so unchanged
//  files are skipped (mirrors optimize-images' mtime skip).
// ============================================================
const fs = require('fs');
const {
  getSupabase, BUCKET, listGeneratedFiles,
  sha256, loadManifest, saveManifest,
} = require('./lib/catalog');

async function run({ force = false } = {}) {
  const sb = getSupabase();
  const files = listGeneratedFiles();

  if (files.length === 0) {
    console.log('No generated images found — run optimize-images first.');
    return { ok: true, uploaded: 0, skipped: 0, errors: 0 };
  }

  const manifest = loadManifest();
  let uploaded = 0, skipped = 0, errors = 0;

  for (const f of files) {
    const hash = sha256(f.path);
    if (!force && manifest[f.storagePath] === hash) { skipped++; continue; }

    const buffer = fs.readFileSync(f.path);
    const { error } = await sb.storage
      .from(BUCKET)
      .upload(f.storagePath, buffer, { contentType: 'image/webp', upsert: true, cacheControl: '31536000' });

    if (error) {
      console.error(`  ✗ ${f.storagePath}: ${error.message}`);
      errors++;
    } else {
      manifest[f.storagePath] = hash;
      uploaded++;
    }
  }

  saveManifest(manifest);
  console.log(`\n✓ uploaded ${uploaded}   skipped ${skipped}   errors ${errors}   total ${files.length}`);
  return { ok: errors === 0, uploaded, skipped, errors };
}

module.exports = { run };

if (require.main === module) {
  const force = process.argv.includes('--force');
  run({ force }).then(r => process.exit(r.ok ? 0 : 1)).catch(e => {
    console.error('❌ upload-images failed:', e.message);
    process.exit(1);
  });
}
