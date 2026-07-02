// ============================================================
//  validate-catalog.js — Catch common mistakes before deploy.
//
//  Local checks (default, no network):
//    • duplicate product IDs
//    • missing/blank brand
//    • invalid price (non-positive / non-integer)
//    • missing or empty sizes
//    • generated image folder with no matching product (orphan)
//    • product with a partial image set (thumb missing but others present)
//    • product without any generated image (warning)
//
//  Remote checks (--remote, queries Supabase):
//    • DB fragrance references an image not present in Storage
// ============================================================
const fs = require('fs');
const path = require('path');
const {
  GENERATED_DIR, SIZES, getSupabase, BUCKET,
  loadProducts, generatedFilePath,
} = require('./lib/catalog');

function localChecks() {
  const { allProducts } = loadProducts();
  const errors = [];
  const warnings = [];
  const productIds = new Set();

  // Per-product data checks
  for (const p of allProducts) {
    if (productIds.has(p.id)) errors.push(`Duplicate product ID: "${p.id}"`);
    productIds.add(p.id);

    if (!p.brand || !p.brand.trim()) errors.push(`${p.id}: missing brand`);
    if (!Array.isArray(p.sizes) || p.sizes.length === 0) {
      errors.push(`${p.id}: no sizes defined`);
    } else {
      for (const s of p.sizes) {
        if (!Number.isInteger(s.price) || s.price <= 0) {
          errors.push(`${p.id}: invalid price ${JSON.stringify(s)}`);
        }
        if (!Number.isInteger(s.ml) || s.ml <= 0) {
          errors.push(`${p.id}: invalid ml ${JSON.stringify(s)}`);
        }
      }
    }

    // Image completeness
    const present = SIZES.filter(size => fs.existsSync(generatedFilePath(p.id, size)));
    if (present.length === 0) {
      warnings.push(`${p.id}: no generated image (will use placeholder)`);
    } else if (present.length < SIZES.length) {
      const missing = SIZES.filter(s => !present.includes(s));
      errors.push(`${p.id}: partial image set — missing ${missing.join(', ')}`);
    }
  }

  // Orphan image folders (folder with no matching product)
  if (fs.existsSync(GENERATED_DIR)) {
    for (const folder of fs.readdirSync(GENERATED_DIR)) {
      const full = path.join(GENERATED_DIR, folder);
      if (fs.statSync(full).isDirectory() && !productIds.has(folder)) {
        errors.push(`Orphan image folder: "${folder}" has no matching product`);
      }
    }
  }

  return { errors, warnings, productCount: allProducts.length };
}

async function remoteChecks() {
  const sb = getSupabase();
  const errors = [];

  const { data: frags, error } = await sb
    .from('fragrances')
    .select('id, image_thumb, image_medium, image_large');
  if (error) throw new Error('fragrances read: ' + error.message);

  // Build the set of object paths actually in the bucket (one list per folder).
  for (const f of frags) {
    const referencesImages = f.image_thumb || f.image_medium || f.image_large;
    if (!referencesImages) continue;

    const { data: objects, error: listErr } = await sb.storage.from(BUCKET).list(f.id);
    if (listErr) { errors.push(`${f.id}: storage list failed — ${listErr.message}`); continue; }

    const present = new Set((objects || []).map(o => o.name));
    for (const size of SIZES) {
      if (f[`image_${size}`] && !present.has(`${size}.webp`)) {
        errors.push(`${f.id}: DB references ${size}.webp but it's missing from Storage`);
      }
    }
  }

  return { errors };
}

async function run({ remote = false } = {}) {
  console.log('🔍 Validating catalog...');
  const local = localChecks();

  let remoteErrors = [];
  if (remote) {
    const r = await remoteChecks();
    remoteErrors = r.errors;
  }

  const errors = [...local.errors, ...remoteErrors];
  const { warnings } = local;

  warnings.forEach(w => console.log(`  ⚠️  ${w}`));
  errors.forEach(e => console.log(`  ❌ ${e}`));

  if (errors.length === 0) {
    console.log(`\n✓ ${local.productCount} products valid`
      + (warnings.length ? `  (${warnings.length} warning${warnings.length !== 1 ? 's' : ''})` : '')
      + (remote ? '  [remote checked]' : ''));
  } else {
    console.log(`\n✗ ${errors.length} error${errors.length !== 1 ? 's' : ''}, `
      + `${warnings.length} warning${warnings.length !== 1 ? 's' : ''}`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { run };

if (require.main === module) {
  const remote = process.argv.includes('--remote');
  run({ remote }).then(r => process.exit(r.ok ? 0 : 1)).catch(e => {
    console.error('❌ validate-catalog failed:', e.message);
    process.exit(1);
  });
}
