// ============================================================
//  build-from-supabase.js
//  The CI build entry point. Reads the catalog from Supabase
//  (the single source of truth), optimizes any newly-uploaded
//  raw images, then generates the static product pages + sitemap.
//
//  Image flow: upload the raw photo (in Studio) to
//    product-images/{id}/original.jpg
//  This script turns it into thumb/medium/large.webp in the same
//  folder. Products that already have thumb.webp are skipped.
//
//  Requires SUPABASE_SERVICE_ROLE_KEY (Storage writes). Catalog
//  reads would work with the anon key, but the service role is
//  needed to upload the optimized images.
// ============================================================
// sharp is lazy-loaded only when an image actually needs optimizing — its
// native binary isn't required (and won't crash the build) when every image
// is already done or Storage writes are disabled.
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, BUCKET } = require('./lib/catalog');
const { generateFromData } = require('./generate-product-pages');

const SIZES = [
  { name: 'thumb',  width: 450,  quality: 80 },
  { name: 'medium', width: 800,  quality: 85 },
  { name: 'large',  width: 1600, quality: 90 },
];
// 1-year immutable cache so Cloudflare (which already fronts Supabase Storage)
// serves images from the edge instead of revalidating every request. Image URLs
// are versioned with ?v=<updated_at>, so replacements still bust the cache.
const CACHE_CONTROL = '31536000';

// The catalog is public-read, so reads work with the anon key even if the
// service_role secret is absent. Writing optimized images to Storage needs the
// service_role key — when it's missing we still read + generate pages (and just
// skip image optimization) so the deploy never gets blocked.
const PUBLIC_ANON = 'sb_publishable_olO3EcqKY0ssnfh2qzKB7g_2-zxc2Or';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const CAN_WRITE   = Boolean(SERVICE_KEY);
const sb = createClient(SUPABASE_URL, SERVICE_KEY || process.env.SUPABASE_ANON_KEY || PUBLIC_ANON);

// ─── Fetch catalog from Supabase ─────────────────────────────
async function fetchCatalog() {
  const { data: frags, error } = await sb
    .from('fragrances')
    .select(`
      id, name, collection, in_stock, is_bestseller, updated_at,
      brands ( name ),
      fragrance_sizes ( ml, price ),
      fragrance_tags ( tag )
    `)
    .eq('status', 'published')
    .order('sort_order');
  if (error) throw new Error('fragrances: ' + error.message);

  // Details fetched with * so a missing `description` column (migration 003
  // not yet run) degrades gracefully instead of erroring.
  const { data: details, error: dErr } = await sb.from('fragrance_details').select('*');
  if (dErr) throw new Error('fragrance_details: ' + dErr.message);

  const allProducts = frags.map(f => ({
    id:            f.id,
    name:          f.name,
    brand:         f.brands?.name ?? '',
    collection:    f.collection,
    inStock:       f.in_stock,
    is_bestseller: f.is_bestseller,
    updatedAt:     f.updated_at,
    sizes:         (f.fragrance_sizes || []).map(s => ({ ml: s.ml, price: s.price })).sort((a, b) => a.ml - b.ml),
    tags:          (f.fragrance_tags || []).map(t => t.tag),
  }));

  const productDetails = {};
  for (const d of details) {
    productDetails[d.fragrance_id] = {
      top:         d.top_notes || [],
      heart:       d.heart_notes || [],
      base:        d.base_notes || [],
      accords:     d.accords || [],
      family:      d.family || '',
      description: d.description || '',
    };
  }

  return { allProducts, productDetails };
}

// ─── Optimize newly-uploaded originals → 3 WebP sizes ────────
async function optimizeImages(allProducts) {
  const imageSet = new Set();
  let optimized = 0, skipped = 0, missing = 0, errors = 0;

  for (const p of allProducts) {
    const { data: files, error } = await sb.storage.from(BUCKET).list(p.id, { limit: 100 });
    if (error) { console.error(`  ✗ list ${p.id}: ${error.message}`); errors++; continue; }

    const names = (files || []).map(f => f.name);
    if (names.includes('thumb.webp')) { imageSet.add(p.id); skipped++; continue; }

    const original = names.find(n => /^original\.(jpe?g|png|webp|avif|tiff)$/i.test(n));
    if (!original) { missing++; continue; }

    // Optimizing requires Storage write access (service_role). Without it we
    // leave the product image-less (page uses placeholder) rather than failing.
    if (!CAN_WRITE) { missing++; continue; }

    try {
      const sharp = require('sharp'); // lazy — only load when optimizing
      const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(`${p.id}/${original}`);
      if (dlErr) throw new Error(dlErr.message);
      const input = Buffer.from(await blob.arrayBuffer());

      for (const { name, width, quality } of SIZES) {
        const out = await sharp(input).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
        const { error: upErr } = await sb.storage.from(BUCKET)
          .upload(`${p.id}/${name}.webp`, out, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_CONTROL });
        if (upErr) throw new Error(`${name}: ${upErr.message}`);
      }
      imageSet.add(p.id);
      optimized++;
      console.log(`  optimized  ${p.id}`);
    } catch (e) {
      console.error(`  ✗ ${p.id}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n📸 images — optimized ${optimized}, already-done ${skipped}, no-image ${missing}, errors ${errors}`);
  return { imageSet, errors };
}

// ─── Validate the published catalog (fail the build, not the site) ──
// Reuses the already-fetched catalog + the imageSet optimizeImages() built
// (products that have thumb.webp). A red build beats a live broken card.
function validateCatalog(allProducts, imageSet) {
  const errors = [];
  const warnings = [];
  let bestsellers = 0;

  for (const p of allProducts) {
    if (p.is_bestseller) bestsellers++;

    if (!p.sizes || p.sizes.length === 0) {
      errors.push(`${p.id}: no sizes`);
    } else {
      for (const s of p.sizes) {
        if (!(s.price > 0)) errors.push(`${p.id}: price not > 0 — ${JSON.stringify(s)}`);
        if (!(s.ml > 0))    errors.push(`${p.id}: ml not > 0 — ${JSON.stringify(s)}`);
      }
    }

    // A published product with no thumb.webp renders a placeholder hero (the
    // SEO-4 / B-2 bug). Hard error when we could have generated it (service
    // role present); otherwise just warn, since optimization was disabled.
    if (!imageSet.has(p.id)) {
      const msg = `${p.id}: no thumb.webp in Storage — upload original.* or set status='draft'`;
      (CAN_WRITE ? errors : warnings).push(msg);
    }
  }

  if (bestsellers > 8) warnings.push(`${bestsellers} bestsellers flagged (home shows ~8)`);

  warnings.forEach(w => console.log(`  ⚠️  ${w}`));
  if (errors.length) {
    errors.forEach(e => console.log(`  ❌ ${e}`));
    throw new Error(`catalog validation failed — ${errors.length} error(s)`);
  }
  console.log(`✓ catalog valid — ${allProducts.length} published products`);
}

// ─── Main ────────────────────────────────────────────────────
async function run() {
  console.log(`🔑 Storage writes: ${CAN_WRITE ? 'enabled (service_role)' : 'DISABLED — no SUPABASE_SERVICE_ROLE_KEY; images will not be optimized'}`);

  console.log('📥 Fetching catalog from Supabase...');
  const { allProducts, productDetails } = await fetchCatalog();
  console.log(`   ${allProducts.length} products`);

  console.log('\n🖼️  Optimizing images...');
  const { imageSet, errors } = await optimizeImages(allProducts);

  console.log('\n🔎 Validating catalog...');
  validateCatalog(allProducts, imageSet);

  console.log('\n📄 Generating pages...');
  const gen = generateFromData(allProducts, productDetails, { hasImage: id => imageSet.has(id) });

  // Image errors never block the deploy — the page just uses a placeholder.
  if (errors) console.log(`\n⚠️  ${errors} image error(s) — those products fall back to placeholders.`);
  return { ok: gen.ok, written: gen.written, imageErrors: errors };
}

module.exports = { run };

if (require.main === module) {
  run()
    .then(r => { console.log(`\n✅ build complete — ${r.written} pages`); process.exit(r.ok ? 0 : 1); })
    .catch(e => { console.error('\n❌ build-from-supabase failed:', e.message); process.exit(1); });
}
