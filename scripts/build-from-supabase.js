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
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, BUCKET, ROOT, publicUrl, imageVersion } = require('./lib/catalog');
const { renderCard, esc } = require('./lib/render-card');
const { generateFromData } = require('./generate-product-pages');
const { fetchSettings, DEFAULTS } = require('./lib/settings');
const { fetchPosts } = require('./lib/blog');

const SIZES = [
  { name: 'small',  width: 360,  quality: 80 },
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
  // The sale_percent / meta_* columns arrive with migration 009. Select them
  // when present, but fall back to the legacy column set if the migration
  // hasn't run yet, so the build never breaks on deploy-before-migrate.
  const base = 'id, name, collection, in_stock, is_bestseller, updated_at';
  const rel = 'brands ( name ), fragrance_sizes ( ml, price ), fragrance_tags ( tag )';
  const fetchFrags = cols =>
    sb.from('fragrances').select(`${cols}, ${rel}`).eq('status', 'published').order('sort_order');

  let { data: frags, error } = await fetchFrags(`${base}, sale_percent, meta_title, meta_description`);
  if (error) {
    console.warn('  ⚠️  sale/meta columns not found — run migration 009. Building without them.');
    ({ data: frags, error } = await fetchFrags(base));
  }
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
    sale_percent:  f.sale_percent || 0,
    salePercent:   f.sale_percent || 0,
    metaTitle:     f.meta_title || '',
    metaDescription: f.meta_description || '',
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

// ─── Generate any MISSING WebP variant from the best available source ────────
// Generates only the sizes a product is missing (so adding a new size like
// `small` backfills existing products without re-encoding the ones they have).
// Source preference: original.* → large → medium → thumb (all downscales).
async function optimizeImages(allProducts) {
  const imageSet = new Set();
  let optimized = 0, skipped = 0, missing = 0, errors = 0;

  for (const p of allProducts) {
    const { data: files, error } = await sb.storage.from(BUCKET).list(p.id, { limit: 100 });
    if (error) { console.error(`  ✗ list ${p.id}: ${error.message}`); errors++; continue; }

    const names = new Set((files || []).map(f => f.name));
    const hasThumb = names.has('thumb.webp');   // the card's src — product is usable with it
    const missingSizes = SIZES.filter(s => !names.has(`${s.name}.webp`));

    if (missingSizes.length === 0) { imageSet.add(p.id); skipped++; continue; }

    const source = [...names].find(n => /^original\.(jpe?g|png|webp|avif|tiff)$/i.test(n))
      || ['large.webp', 'medium.webp', 'thumb.webp'].find(n => names.has(n));

    // Can't backfill without a source image or write access. A product that still
    // has its thumb is fine (cards use it); only truly image-less ones count.
    if (!source || !CAN_WRITE) {
      if (hasThumb) { imageSet.add(p.id); skipped++; } else { missing++; }
      continue;
    }

    try {
      const sharp = require('sharp'); // lazy — only load when generating
      const { data: blob, error: dlErr } = await sb.storage.from(BUCKET).download(`${p.id}/${source}`);
      if (dlErr) throw new Error(dlErr.message);
      const input = Buffer.from(await blob.arrayBuffer());

      for (const { name, width, quality } of missingSizes) {
        const out = await sharp(input).resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
        const { error: upErr } = await sb.storage.from(BUCKET)
          .upload(`${p.id}/${name}.webp`, out, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_CONTROL });
        if (upErr) throw new Error(`${name}: ${upErr.message}`);
      }
      imageSet.add(p.id);
      optimized++;
      console.log(`  generated  ${p.id} (${missingSizes.map(s => s.name).join(', ')})`);
    } catch (e) {
      console.error(`  ✗ ${p.id}: ${e.message}`);
      errors++;
    }
  }

  console.log(`\n📸 images — generated ${optimized}, already-done ${skipped}, no-image ${missing}, errors ${errors}`);
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

// ─── Inject server-rendered grids into the static HTML ──────────
// Renders the shop / home / exclusive cards from the same catalog the
// build already fetched, so product content is in the HTML (crawlable +
// paints without JS). The browser then filters/hydrates these nodes.
// Content is replaced between re-runnable <!--GRID:name:start/end--> markers.
function injectGrids(allProducts, productDetails) {
  const card = (p, isExclusive, priority = false) => renderCard({
    ...p,
    accords: (productDetails[p.id] && productDetails[p.id].accords) || [],
    image_small:  publicUrl(p.id, 'small',  imageVersion(p.updatedAt)),
    image_thumb:  publicUrl(p.id, 'thumb',  imageVersion(p.updatedAt)),
    image_medium: publicUrl(p.id, 'medium', imageVersion(p.updatedAt)),
  }, { isExclusive, priority });

  // prioritizeFirstRow: eager + high fetchpriority on the first 4 cards so the
  // top row of an above-the-fold grid paints immediately; the rest stay lazy.
  const cards = (list, isExclusive, prioritizeFirstRow = false) =>
    list.map((p, i) => card(p, isExclusive, prioritizeFirstRow && i < 4)).join('\n');

  const grids = {
    bestsellers: cards(allProducts.filter(p => p.is_bestseller).slice(0, 8), false, true),
    new:         cards(allProducts.filter(p => (p.tags || []).includes('new')), false, false),
    shop:        cards(allProducts.filter(p => p.collection === 'regular'), false, true),
    special:     cards(allProducts.filter(p => p.collection === 'special'), true, true),
    exclusive:   cards(allProducts.filter(p => p.collection === 'exclusive'), true, false),
  };

  const pages = {
    'index.html':     ['bestsellers', 'new'],
    'shop.html':      ['shop'],
    'exclusive.html': ['special', 'exclusive'],
  };

  let total = 0;
  for (const [file, names] of Object.entries(pages)) {
    const fp = path.join(ROOT, file);
    let html = fs.readFileSync(fp, 'utf8');
    for (const name of names) {
      const re = new RegExp(`(<!--GRID:${name}:start-->)[\\s\\S]*?(<!--GRID:${name}:end-->)`);
      if (!re.test(html)) throw new Error(`marker GRID:${name} not found in ${file}`);
      html = html.replace(re, `$1\n${grids[name]}\n      $2`);
      total += (grids[name].match(/class="product-card/g) || []).length;
    }
    fs.writeFileSync(fp, html);
    console.log(`  injected → ${file}`);
  }
  console.log(`🧩 grids — ${total} cards injected`);
}

// ─── Bake the shop's brand + accord filter checkboxes ──────────
// shop.js used to build these from the cards on load, which grew the sidebar
// after first paint (a ~0.06 CLS from filter-group/filter-clear shifting).
// Baking them into the static HTML means they're there before JS runs. shop.js
// now only builds them if the containers are still empty (older cached HTML).
function injectShopFilters(allProducts, productDetails) {
  const regular = allProducts.filter(p => p.collection === 'regular');
  const brands = [...new Set(regular.map(p => p.brand))].filter(Boolean).sort();
  const accords = [...new Set(regular.flatMap(p => (productDetails[p.id] && productDetails[p.id].accords) || []))].filter(Boolean).sort();
  const label = (v, cls) => `<label><input type="checkbox" value="${esc(v)}" class="${cls}" /> ${esc(v)}</label>`;

  const blocks = {
    brands: brands.map(b => label(b, 'brand-filter')).join(''),
    accords: accords.map(a => label(a, 'accord-filter')).join(''),
  };

  const fp = path.join(ROOT, 'shop.html');
  let html = fs.readFileSync(fp, 'utf8');
  for (const [name, content] of Object.entries(blocks)) {
    const re = new RegExp(`(<!--FILTERS:${name}:start-->)[\\s\\S]*?(<!--FILTERS:${name}:end-->)`);
    if (!re.test(html)) throw new Error(`marker FILTERS:${name} not found in shop.html`);
    html = html.replace(re, `$1${content}$2`);
  }
  fs.writeFileSync(fp, html);
  console.log(`  injected → shop.html (${brands.length} brand + ${accords.length} accord filters)`);
}

// ─── Bake the home-page brand marquee from the live catalog ────
// The strip was a hardcoded 12-brand list that drifted from the catalog (it
// showed 12 of 30+ brands). Derive it from every brand that has a product,
// ordered by product count (biggest first), and emit the sequence twice so the
// -50% `ticker` animation loops seamlessly for any number of brands.
function injectBrandStrip(allProducts) {
  const counts = new Map();
  for (const p of allProducts) {
    const b = (p.brand || '').trim();
    if (b) counts.set(b, (counts.get(b) || 0) + 1);
  }
  const brands = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
  const seq = brands
    .map(b => `<span class="brand-name">${esc(b)}</span><span class="brand-sep">◆</span>`)
    .join('\n    ');
  const content = `\n    ${seq}\n    <!-- duplicate for seamless loop -->\n    ${seq}\n  `;

  const fp = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(fp, 'utf8');
  const re = /(<!--BRANDS:start-->)[\s\S]*?(<!--BRANDS:end-->)/;
  if (!re.test(html)) throw new Error('marker BRANDS not found in index.html');
  html = html.replace(re, `$1${content}$2`);
  fs.writeFileSync(fp, html);
  console.log(`  injected → index.html (${brands.length} brands in marquee)`);
}

// ─── Bake site settings into the SEO-critical home-page HTML ────
// Only index.html is baked (its hero/title/description are the indexed copy).
// The announcement ticker and generated pages update via js/settings.js
// hydration, so they aren't baked here. Every injected block keeps its
// data-setting* hooks so live hydration still refreshes it after load.
function injectSettings(settings) {
  const s = settings;
  const anns = Array.isArray(s.announcements) ? s.announcements : [];
  const stats = Array.isArray(s.stats) ? s.stats : [];
  const hs = s.homeSections || {};
  // An empty array means "not configured" — fall back to the defaults so a
  // rebuild never wipes the How-to-Order / FAQ sections to nothing.
  const howto = (Array.isArray(hs.howToOrder) && hs.howToOrder.length) ? hs.howToOrder : DEFAULTS.homeSections.howToOrder;
  const faq = (Array.isArray(hs.faq) && hs.faq.length) ? hs.faq : DEFAULTS.homeSections.faq;

  const blocks = {
    meta:
      `<title>${esc(s.meta.homeTitle)}</title>\n` +
      `  <meta name="description" content="${esc(s.meta.homeDescription)}" />`,
    announcement:
      `<div class="ticker-track" data-setting-list="announcements">\n` +
      [...anns, ...anns].map(a => `    <span>${esc(a)}</span>`).join('\n') +
      `\n  </div>`,
    // Eyebrow renders on two centered lines: the label, then the "· … ·"
    // tagline. We break before the first middot, so "Your Signature Scent ·
    // Starts Here ·" becomes "Your Signature Scent" / "· Starts Here ·".
    // (No data-setting hook: it's baked from settings each build; a text-node
    // hydration would drop the <br> and flatten it back to one line.)
    hero:
      `<p class="hero-eyebrow">${esc(s.hero.eyebrow).replace(/\s*·/, '<br>·')}</p>\n` +
      `  <h1 data-setting="hero.title">${esc(s.hero.title)}</h1>\n` +
      `  <p data-setting="hero.subtitle">${esc(s.hero.subtitle)}</p>`,
    stats:
      `<div class="stats-inner">\n` +
      stats.map((st, i) =>
        `    <div class="stat-item" data-stat-index="${i}">\n` +
        `      <div class="stat-number" data-target="${esc(String(st.target))}" data-suffix="${esc(st.suffix || '')}">${esc(String(st.target) + (st.suffix || ''))}</div>\n` +
        `      <div class="stat-label">${esc(st.label)}</div>\n` +
        `    </div>`).join('\n') +
      `\n  </div>`,
    howto:
      `<div class="how-steps" data-setting-howto>\n` +
      howto.map((step, i) =>
        `    <div class="how-step">\n` +
        `      <span class="how-step-num">${i + 1}</span>\n` +
        `      <h3 class="how-step-title">${esc(step.title)}</h3>\n` +
        `      <p class="how-step-text">${esc(step.text)}</p>\n` +
        `    </div>`).join('\n') +
      `\n  </div>`,
    faq:
      `<div class="faq-list" data-setting-faq>\n` +
      faq.map(item =>
        `    <details class="faq-item">\n` +
        `      <summary class="faq-q">${esc(item.q)}</summary>\n` +
        `      <div class="faq-a"><p>${esc(item.a)}</p></div>\n` +
        `    </details>`).join('\n') +
      `\n  </div>`,
  };

  const fp = path.join(ROOT, 'index.html');
  let html = fs.readFileSync(fp, 'utf8');
  for (const [name, content] of Object.entries(blocks)) {
    const re = new RegExp(`(<!--SET:${name}:start-->)[\\s\\S]*?(<!--SET:${name}:end-->)`);
    if (!re.test(html)) throw new Error(`marker SET:${name} not found in index.html`);
    html = html.replace(re, `$1\n  ${content}\n  $2`);
  }

  // Trust-bar "Fragrances" line follows the admin's Fragrances stat so the
  // count updates from the dashboard instead of needing a manual code edit.
  const fragStat = stats.find(st => /fragrance/i.test(st.label || ''));
  if (fragStat) {
    const fragText = `${fragStat.target}${fragStat.suffix || ''} Fragrances`;
    html = html.replace(/(<span data-setting-fragrances>)[^<]*(<\/span>)/g, `$1${esc(fragText)}$2`);
  }

  fs.writeFileSync(fp, html);
  console.log('  injected → index.html (settings)');
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

  console.log('\n🧩 Injecting static grids...');
  injectGrids(allProducts, productDetails);
  injectBrandStrip(allProducts);

  console.log('\n⚙️  Injecting site settings...');
  const settings = await fetchSettings(sb);
  injectSettings(settings);
  injectShopFilters(allProducts, productDetails);

  console.log('\n📝 Fetching blog posts...');
  const posts = await fetchPosts(sb);
  console.log(`   ${posts.length} published posts`);

  console.log('\n📄 Generating pages...');
  const gen = generateFromData(allProducts, productDetails, { hasImage: id => imageSet.has(id), posts });

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
