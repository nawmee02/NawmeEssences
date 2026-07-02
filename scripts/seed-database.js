// ============================================================
//  seed-database.js — Insert/update catalog records in Supabase.
//  Image URLs are derived from the upload manifest so the DB
//  never references an image that isn't actually in Storage.
// ============================================================
const {
  getSupabase, brandSlug, publicUrl, loadProducts,
  loadManifest, isUploaded,
} = require('./lib/catalog');

async function seedBrands(sb, allProducts) {
  const rows = [...new Set(allProducts.map(p => p.brand))].sort()
    .map(name => ({ slug: brandSlug(name), name }));

  const { error } = await sb.from('brands').upsert(rows, { onConflict: 'slug' });
  if (error) throw new Error('brands: ' + error.message);

  const { data, error: readErr } = await sb.from('brands').select('id, slug');
  if (readErr) throw new Error('brands read: ' + readErr.message);

  console.log(`  ✓ ${rows.length} brands`);
  return Object.fromEntries(data.map(b => [b.slug, b.id]));
}

async function seedFragrances(sb, allProducts, brandMap, bestsellerSet, manifest) {
  const rows = allProducts.map((p, i) => {
    const up = (size) => isUploaded(p.id, size, manifest) ? publicUrl(p.id, size) : null;
    return {
      id:            p.id,
      name:          p.name,
      brand_id:      brandMap[brandSlug(p.brand)] ?? null,
      collection:    p.collection,
      in_stock:      p.inStock,
      is_bestseller: bestsellerSet.has(p.id),
      sort_order:    i,
      image_thumb:   up('thumb'),
      image_medium:  up('medium'),
      image_large:   up('large'),
    };
  });

  const { error } = await sb.from('fragrances').upsert(rows, { onConflict: 'id' });
  if (error) throw new Error('fragrances: ' + error.message);
  console.log(`  ✓ ${rows.length} fragrances`);
}

async function seedSizes(sb, allProducts) {
  const ids = allProducts.map(p => p.id);
  await sb.from('fragrance_sizes').delete().in('fragrance_id', ids);

  const rows = allProducts.flatMap(p =>
    p.sizes.map(s => ({ fragrance_id: p.id, ml: s.ml, price: s.price }))
  );
  const { error } = await sb.from('fragrance_sizes').insert(rows);
  if (error) throw new Error('fragrance_sizes: ' + error.message);
  console.log(`  ✓ ${rows.length} size entries`);
}

async function seedTags(sb, allProducts) {
  const ids = allProducts.map(p => p.id);
  await sb.from('fragrance_tags').delete().in('fragrance_id', ids);

  const rows = allProducts.flatMap(p =>
    p.tags.map(t => ({ fragrance_id: p.id, tag: t }))
  );
  if (!rows.length) { console.log('  ✓ 0 tags'); return; }

  const { error } = await sb.from('fragrance_tags').insert(rows);
  if (error) throw new Error('fragrance_tags: ' + error.message);
  console.log(`  ✓ ${rows.length} tag entries`);
}

async function seedDetails(sb, productDetails) {
  const rows = Object.entries(productDetails).map(([id, d]) => ({
    fragrance_id: id,
    top_notes:    d.top,
    heart_notes:  d.heart,
    base_notes:   d.base,
    accords:      d.accords,
    family:       d.family,
  }));

  const { error } = await sb.from('fragrance_details').upsert(rows, { onConflict: 'fragrance_id' });
  if (error) throw new Error('fragrance_details: ' + error.message);
  console.log(`  ✓ ${rows.length} detail entries`);
}

async function run() {
  const sb = getSupabase();
  const { allProducts, productDetails, bestsellerSet,
          regularProducts, exclusiveProducts, specialItems } = loadProducts();
  const manifest = loadManifest();

  console.log(`🌱 Seeding ${allProducts.length} products `
    + `(${regularProducts.length} regular, ${exclusiveProducts.length} exclusive, ${specialItems.length} special)`);

  const brandMap = await seedBrands(sb, allProducts);
  await seedFragrances(sb, allProducts, brandMap, bestsellerSet, manifest);
  await seedSizes(sb, allProducts);
  await seedTags(sb, allProducts);
  await seedDetails(sb, productDetails);

  return { ok: true };
}

module.exports = { run };

if (require.main === module) {
  run().then(() => { console.log('\n✅ Database seeded.'); })
    .catch(e => { console.error('\n❌ seed-database failed:', e.message); process.exit(1); });
}
