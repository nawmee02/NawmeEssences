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
const sharp = require('sharp');
const { getSupabase, BUCKET } = require('./lib/catalog');
const { generateFromData } = require('./generate-product-pages');

const SIZES = [
  { name: 'thumb',  width: 300,  quality: 80 },
  { name: 'medium', width: 800,  quality: 85 },
  { name: 'large',  width: 1600, quality: 90 },
];

// ─── Fetch catalog from Supabase ─────────────────────────────
async function fetchCatalog(sb) {
  const { data: frags, error } = await sb
    .from('fragrances')
    .select(`
      id, name, collection, in_stock, is_bestseller,
      brands ( name ),
      fragrance_sizes ( ml, price ),
      fragrance_tags ( tag )
    `)
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
async function optimizeImages(sb, allProducts) {
  const imageSet = new Set();
  let optimized = 0, skipped = 0, missing = 0, errors = 0;

  for (const p of allProducts) {
    const { data: files, error } = await sb.storage.from(BUCKET).list(p.id, { limit: 100 });
    if (error) { console.error(`  ✗ list ${p.id}: ${error.message}`); errors++; continue; }

    const names = (files || []).map(f => f.name);
    if (names.includes('thumb.webp')) { imageSet.add(p.id); skipped++; continue; }

    const original = names.find(n => /^original\.(jpe?g|png|webp|avif|tiff)$/i.test(n));
    if (!original) { missing++; continue; }

    try {
      const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(`${p.id}/${original}`);
      if (dlErr) throw new Error(dlErr.message);
      const input = Buffer.from(await blob.arrayBuffer());

      for (const { name, width, quality } of SIZES) {
        const out = await sharp(input).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
        const { error: upErr } = await sb.storage.from(BUCKET)
          .upload(`${p.id}/${name}.webp`, out, { contentType: 'image/webp', upsert: true });
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

// ─── Main ────────────────────────────────────────────────────
async function run() {
  const sb = getSupabase();

  console.log('📥 Fetching catalog from Supabase...');
  const { allProducts, productDetails } = await fetchCatalog(sb);
  console.log(`   ${allProducts.length} products`);

  console.log('\n🖼️  Optimizing images...');
  const { imageSet, errors } = await optimizeImages(sb, allProducts);

  console.log('\n📄 Generating pages...');
  const gen = generateFromData(allProducts, productDetails, { hasImage: id => imageSet.has(id) });

  return { ok: errors === 0 && gen.ok, written: gen.written, imageErrors: errors };
}

module.exports = { run };

if (require.main === module) {
  run()
    .then(r => { console.log(`\n${r.ok ? '✅' : '⚠️'} build complete — ${r.written} pages`); process.exit(r.ok ? 0 : 1); })
    .catch(e => { console.error('\n❌ build-from-supabase failed:', e.message); process.exit(1); });
}
