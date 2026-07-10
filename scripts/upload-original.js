// ============================================================
//  upload-original.js — reliable image upload (bypasses the
//  flaky Supabase dashboard TUS uploader).
//
//  Uploads a local image as product-images/{id}/original.<ext>
//  AND generates + uploads thumb/medium/large.webp, so the
//  product's image is fully ready in Storage in one command.
//
//  Usage:
//    npm run upload-original -- <product-id> <path-to-image>
//  e.g.
//    npm run upload-original -- arabiyat-prestige-bois-blanc ./bois-blanc.jpg
// ============================================================
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getSupabase, BUCKET } = require('./lib/catalog');

const SIZES = [
  { name: 'thumb',  width: 450,  quality: 80 },
  { name: 'medium', width: 800,  quality: 85 },
  { name: 'large',  width: 1600, quality: 90 },
];
const CACHE_CONTROL = '31536000'; // 1-year immutable; URLs versioned with ?v=

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.tiff': 'image/tiff' };

async function run(id, file) {
  if (!id || !file) {
    console.error('Usage: npm run upload-original -- <product-id> <path-to-image>');
    process.exit(1);
  }
  if (!/^[a-z0-9-]+$/.test(id)) {
    console.error(`Invalid id "${id}" — must be lowercase kebab-case (a-z, 0-9, -).`);
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const ext = path.extname(file).toLowerCase();
  if (!MIME[ext]) {
    console.error(`Unsupported image type "${ext}". Use jpg/png/webp/avif/tiff.`);
    process.exit(1);
  }

  const sb = getSupabase();
  const input = fs.readFileSync(file);

  // 1. Store the original (for future re-optimization)
  const origKey = `${id}/original${ext}`;
  const { error: origErr } = await sb.storage.from(BUCKET)
    .upload(origKey, input, { contentType: MIME[ext], upsert: true, cacheControl: CACHE_CONTROL });
  if (origErr) { console.error(`✗ original: ${origErr.message}`); process.exit(1); }
  console.log(`  ✓ ${origKey}`);

  // 2. Generate + upload the 3 optimized sizes
  for (const { name, width, quality } of SIZES) {
    const out = await sharp(input).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
    const { error } = await sb.storage.from(BUCKET)
      .upload(`${id}/${name}.webp`, out, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_CONTROL });
    if (error) { console.error(`✗ ${name}.webp: ${error.message}`); process.exit(1); }
    console.log(`  ✓ ${id}/${name}.webp`);
  }

  // 3. Verify the binary is actually retrievable (catches ghost uploads)
  const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(`${id}/thumb.webp`, 60);
  const ok = signed && (await fetch(signed.signedUrl)).status === 200;
  console.log(ok ? `\n✅ ${id} image uploaded & verified.` : `\n⚠️ uploaded but verification failed — check Storage.`);
  process.exit(ok ? 0 : 1);
}

run(process.argv[2], process.argv[3]).catch(e => { console.error('❌', e.message); process.exit(1); });
