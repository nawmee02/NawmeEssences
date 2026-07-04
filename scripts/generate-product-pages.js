// ============================================================
//  generate-product-pages.js
//  Renders a static, SEO-optimised HTML page per product at
//  product/{id}/index.html, and regenerates sitemap.xml.
//
//  Data is loaded offline from js/products.js (no network).
//  Images use the deterministic Supabase Storage URLs with a
//  local /images/products/{id}.jpg fallback.
// ============================================================
const fs = require('fs');
const path = require('path');
const {
  ROOT, loadProducts, publicUrl, hasGeneratedImages,
} = require('./lib/catalog');

const SITE = 'https://nawmeessences.me';
const DEFAULT_OG = `${SITE}/images/products/rasasi-hawas-ice.jpg`;

// ─── HTML escaping ───────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function attr(s) { return esc(s); }

// ─── Occasion inference from accords ─────────────────────────
const OCCASION_RULES = {
  'Office':     ['Fresh', 'Aquatic', 'Citrus', 'Green', 'Aromatic', 'Marine', 'Tea', 'Powdery'],
  'Gym / Sport':['Fresh', 'Aquatic', 'Citrus', 'Marine', 'Green'],
  'Date Night': ['Sweet', 'Oriental', 'Gourmand', 'Vanilla', 'Leather', 'Oud', 'Honey', 'Boozy', 'Tobacco', 'Amber'],
  'Party':      ['Spicy', 'Oriental', 'Fruity', 'Gourmand', 'Smoky', 'Dark', 'Intense', 'Leather'],
  'Everyday':   ['Woody', 'Aromatic', 'Floral', 'Fruity', 'Powdery', 'Fresh'],
};
function occasionsFor(accords) {
  if (!accords || !accords.length) return ['Everyday'];
  const set = new Set();
  for (const [occ, triggers] of Object.entries(OCCASION_RULES)) {
    if (accords.some(a => triggers.includes(a))) set.add(occ);
  }
  if (!set.size) set.add('Everyday');
  return [...set].slice(0, 4);
}

// ─── Image helpers ───────────────────────────────────────────
// hasImage(id) decides whether optimized WebP exists (in Storage). The local
// products.js path uses on-disk generated files; the Supabase build passes a
// Set of ids that have images in Storage. Missing → local jpg / default og.
let hasImage = hasGeneratedImages;
function setImageChecker(fn) { hasImage = fn; }

function heroLarge(id)  { return hasImage(id) ? publicUrl(id, 'large')  : `${SITE}/images/products/${id}.jpg`; }
function heroMedium(id) { return hasImage(id) ? publicUrl(id, 'medium') : `${SITE}/images/products/${id}.jpg`; }
function ogImage(id)    { return hasImage(id) ? publicUrl(id, 'large')  : DEFAULT_OG; }

// ─── Copy builders ───────────────────────────────────────────
function sizeList(sizes) { return sizes.map(s => `${s.ml}ml`).join(', '); }
function minPrice(sizes) { return Math.min(...sizes.map(s => s.price)); }
function maxPrice(sizes) { return Math.max(...sizes.map(s => s.price)); }

function metaDescription(p, d) {
  const notes = d ? d.top.slice(0, 3).join(', ') : '';
  const fam = d ? `${d.family} ` : '';
  const notePart = notes ? ` with notes of ${notes}` : '';
  return `Buy ${p.name} decant in Bangladesh — an authentic ${fam}fragrance by ${p.brand}${notePart}. Available in ${sizeList(p.sizes)} from ৳${minPrice(p.sizes)}. Syringe-measured, 100% genuine.`;
}

function description(p, d) {
  // Prefer the human-written description from fragrance_details.description
  if (d && d.description && d.description.trim()) return d.description.trim();
  if (!d) {
    return `${p.name} by ${p.brand}, offered as an authentic syringe-measured decant in ${sizeList(p.sizes)} sizes — try it before committing to a full bottle.`;
  }
  return `${p.name} is a ${d.family} fragrance by ${p.brand}. It opens with ${d.top.join(', ')}, settles into a heart of ${d.heart.join(', ')}, and dries down to a base of ${d.base.join(', ')}. Offered as an authentic, syringe-measured decant in ${sizeList(p.sizes)} sizes so you can explore it before buying a full bottle.`;
}

// ─── Fragments ───────────────────────────────────────────────
function tagBadges(tags) {
  const label = t => ({ new: 'New', restocked: 'Restocked', limited: 'Limited', discontinued: 'Discontinued', exclusive: 'Exclusive' }[t] || t);
  return tags.map(t => `<span class="tag tag-${esc(t)}">${esc(label(t))}</span>`).join('');
}

function occasionChips(accords) {
  return occasionsFor(accords).map(o => `<span class="occasion-chip">${esc(o)}</span>`).join('');
}

function sizePills(p) {
  return p.sizes.map((s, i) =>
    `<button class="size-pill${i === 0 ? ' active' : ''}" data-ml="${s.ml}" data-price="${s.price}" onclick="selectSize('${attr(p.id)}', this)">${s.ml}ml</button>`
  ).join('');
}

function notesBlock(d) {
  if (!d) return '';
  const row = (lbl, arr) => `<div class="notes-row"><span class="notes-label">${lbl}</span><span class="notes-text">${esc(arr.join(', '))}</span></div>`;
  const pills = d.accords.map(a => `<span class="accord-pill">${esc(a)}</span>`).join('');
  return `
      <section class="pd-notes">
        <h2>Fragrance Notes</h2>
        <div class="notes-pyramid">
          ${row('Top', d.top)}
          ${row('Heart', d.heart)}
          ${row('Base', d.base)}
        </div>
        <div class="accords-row">${pills}</div>
        <p class="family-line">Olfactive family: <strong>${esc(d.family)}</strong></p>
      </section>`;
}

// Similarity is scent-driven: olfactive family + shared accords + shared
// notes decide "You May Also Like". Brand is only a tiny tiebreaker so a
// same-brand-but-different-scent product never outranks a true scent match.
function relatedProducts(p, all, detailsMap) {
  const pd = detailsMap[p.id];
  const pNotes = pd ? new Set([...pd.top, ...pd.heart, ...pd.base]) : new Set();

  const scored = all
    .filter(x => x.id !== p.id && x.collection === p.collection)
    .map(x => {
      const xd = detailsMap[x.id];
      let score = 0;
      if (pd && xd) {
        if (xd.family === pd.family) score += 5;                                   // same olfactive family
        score += xd.accords.filter(a => pd.accords.includes(a)).length * 3;        // shared accords
        score += [...xd.top, ...xd.heart, ...xd.base].filter(n => pNotes.has(n)).length; // shared notes
      }
      if (x.brand === p.brand) score += 1;                                          // minor tiebreaker
      return { x, score };
    })
    .filter(o => o.score > 0)
    .sort((a, b) => b.score - a.score || minPrice(a.x.sizes) - minPrice(b.x.sizes))
    .slice(0, 4)
    .map(o => o.x);

  if (!scored.length) return '';
  const cards = scored.map(r => `
        <a class="related-card" href="/product/${attr(r.id)}/">
          <div class="related-img">
            <img src="${attr(heroMedium(r.id))}" alt="${attr(r.name)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="card-img-placeholder">🫧</div>
          </div>
          <div class="related-brand">${esc(r.brand)}</div>
          <div class="related-name">${esc(r.name)}</div>
          <div class="related-price">from ৳${minPrice(r.sizes)}</div>
        </a>`).join('');
  return `
      <section class="pd-related">
        <h2>You May Also Like</h2>
        <div class="related-grid">${cards}</div>
      </section>`;
}

// ─── Shared header / footer ──────────────────────────────────
const GTM_HEAD = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-KKCJCDTZ');</script>`;

const HEADER = `<div class="announcement-bar">
  <div class="ticker-track">
    <span>🚚 Delivery ৳70 Dhaka · ৳90 Suburb · ৳120 Outside</span>
    <span>✅ 100% Authentic Decants</span>
    <span>📍 Pickup: Aftabnagar · Banasree · NSU</span>
    <span>💳 Min. advance = delivery charge</span>
    <span>🚚 Delivery ৳70 Dhaka · ৳90 Suburb · ৳120 Outside</span>
    <span>✅ 100% Authentic Decants</span>
    <span>📍 Pickup: Aftabnagar · Banasree · NSU</span>
    <span>💳 Min. advance = delivery charge</span>
  </div>
</div>
<header class="site-header">
  <nav class="nav-inner">
    <a href="/" class="logo">NawmeEssences</a>
    <div id="nav-menu">
      <a href="/" class="nav-link">Home</a>
      <a href="/shop.html" class="nav-link">Shop</a>
      <a href="/exclusive.html" class="nav-link exclusive-link">✦ Exclusive</a>
      <a href="/about.html" class="nav-link">Policies</a>
    </div>
    <div class="nav-actions">
      <a href="/cart.html" class="cart-btn">🛒 Cart <span class="cart-count" style="display:none">0</span></a>
      <button class="burger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>
    </div>
  </nav>
</header>`;

const FOOTER = `<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <a href="/" class="logo">NawmeEssences</a>
      <p>Premium fragrance decants from authentic personal collection. Serving fragrance lovers across Bangladesh.</p>
    </div>
    <div class="footer-col">
      <p class="footer-heading">Shop</p>
      <a href="/shop.html">All Fragrances</a>
      <a href="/exclusive.html">Exclusive Collection</a>
      <a href="/cart.html">My Cart</a>
    </div>
    <div class="footer-col">
      <p class="footer-heading">Info</p>
      <a href="/about.html">Delivery &amp; Pickup</a>
      <a href="/about.html#payment">Payment Policy</a>
      <a href="/about.html#contact">Contact Us</a>
      <a href="/about-me.html">About Me</a>
    </div>
  </div>
  <div class="footer-bottom">
    <span>© 2026 NawmeEssences. All rights reserved.</span>
    <span>Prices are fixed. Authentic decants only.</span>
  </div>
</footer>`;

const SCRIPTS = `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2" defer></script>
<script src="/js/products.js" defer></script>
<script src="/js/cart.js" defer></script>
<script src="/js/main.js" defer></script>
<script src="/js/supabase-config.js" defer></script>
<script src="/js/supabase.js" defer></script>
<script src="/js/api.js" defer></script>`;

// ─── Page template ───────────────────────────────────────────
function renderPage(p, all, detailsMap) {
  const d = detailsMap[p.id] || null;
  const url = `${SITE}/product/${p.id}/`;
  const isExclusive = p.collection !== 'regular';
  const parent = isExclusive
    ? { name: 'Exclusive Collection', url: `${SITE}/exclusive.html` }
    : { name: 'Shop', url: `${SITE}/shop.html` };
  const desc = description(p, d);
  const metaDesc = metaDescription(p, d);
  const title = `${p.name} — ${p.brand} Perfume Decant in Bangladesh | NawmeEssences`;
  const lo = minPrice(p.sizes), hi = maxPrice(p.sizes);
  const availability = p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock';

  const productLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    brand: { '@type': 'Brand', name: p.brand },
    image: [heroLarge(p.id), heroMedium(p.id)],
    description: metaDesc,
    sku: p.id,
    category: d ? d.family : 'Fragrance',
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: 'BDT',
      lowPrice: lo,
      highPrice: hi,
      offerCount: p.sizes.length,
      availability,
      url,
    },
  };
  const breadcrumbLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE}/` },
      { '@type': 'ListItem', position: 2, name: parent.name, item: parent.url },
      { '@type': 'ListItem', position: 3, name: p.name, item: url },
    ],
  };

  const oos = !p.inStock;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google Tag Manager -->
  ${GTM_HEAD}
  <!-- End Google Tag Manager -->
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${attr(metaDesc)}" />
  <link rel="canonical" href="${attr(url)}" />
  <link rel="icon" href="/favicon.png" type="image/png" />
  <!-- Open Graph -->
  <meta property="og:type" content="product" />
  <meta name="application-name" content="NawmeEssences" />
  <meta property="og:site_name" content="NawmeEssences" />
  <meta property="og:url" content="${attr(url)}" />
  <meta property="og:title" content="${attr(p.name + ' — ' + p.brand)}" />
  <meta property="og:description" content="${attr(metaDesc)}" />
  <meta property="og:image" content="${attr(ogImage(p.id))}" />
  <meta property="og:locale" content="en_US" />
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${attr(p.name + ' — ' + p.brand)}" />
  <meta name="twitter:description" content="${attr(metaDesc)}" />
  <meta name="twitter:image" content="${attr(ogImage(p.id))}" />
  <!-- Structured data -->
  <script type="application/ld+json">${JSON.stringify(productLd)}</script>
  <script type="application/ld+json">${JSON.stringify(breadcrumbLd)}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=optional" media="print" onload="this.media='all'" />
  <noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Inter:wght@400;500;600;700&display=optional" /></noscript>
  <link rel="stylesheet" href="/css/style.css" />
</head>
<body>
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-KKCJCDTZ" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->

${HEADER}

<main>
<nav class="breadcrumb" aria-label="Breadcrumb">
  <a href="/">Home</a> <span>›</span>
  <a href="${attr(parent.url.replace(SITE, ''))}">${esc(parent.name)}</a> <span>›</span>
  <span class="crumb-current">${esc(p.name)}</span>
</nav>

<div class="product-detail">
  <div class="pd-media">
    <div class="pd-image${oos ? ' out-of-stock' : ''}">
      <img id="pd-hero" src="${attr(heroLarge(p.id))}" alt="${attr(p.name + ' ' + p.brand + ' perfume decant')}"
           onclick="openLightbox()" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="card-img-placeholder pd-placeholder">🫧</div>
      <div class="tag-badges">${tagBadges(p.tags)}</div>
      ${oos ? '<div class="oos-badge" id="stock-badge"><span>Out of Stock</span></div>' : '<div class="oos-badge" id="stock-badge" style="display:none"><span>Out of Stock</span></div>'}
    </div>
  </div>

  <div class="pd-info">
    <div class="pd-brand">${esc(p.brand)}</div>
    <h1 class="pd-name">${esc(p.name)}</h1>
    <div class="pd-occasions">${occasionChips(d ? d.accords : [])}</div>

    <div class="pd-buy">
      <div class="pd-size-row">
        <span class="pd-size-label">Size</span>
        <div class="size-pills" id="size-${attr(p.id)}">${sizePills(p)}</div>
      </div>
      <div class="pd-price-row">
        <span class="pd-price" id="price-${attr(p.id)}">৳${lo}</span>
        <button class="add-to-cart-btn" id="add-btn"${oos ? ' disabled' : ''} onclick="handleAdd()">${oos ? 'Out of Stock' : 'Add to Cart'}</button>
      </div>
    </div>

    <p class="pd-desc">${esc(desc)}</p>
    ${notesBlock(d)}
  </div>
</div>

${relatedProducts(p, all, detailsMap)}
</main>

<!-- Lightbox -->
<div class="lightbox" id="lightbox" onclick="closeLightbox()">
  <span class="lightbox-close" aria-label="Close">&times;</span>
  <img src="${attr(heroLarge(p.id))}" alt="${attr(p.name)}" />
</div>

${FOOTER}

${SCRIPTS}
<script>
  const PRODUCT = { id: ${JSON.stringify(p.id)}, name: ${JSON.stringify(p.name)}, brand: ${JSON.stringify(p.brand)}, isExclusive: ${isExclusive} };

  function handleAdd() {
    const pill = document.querySelector('#size-' + PRODUCT.id + ' .size-pill.active');
    if (!pill) return;
    addToCart(PRODUCT.id, pill.dataset.ml, pill.dataset.price, PRODUCT.name, PRODUCT.brand, PRODUCT.isExclusive);
  }

  function openLightbox()  { document.getElementById('lightbox').classList.add('open'); }
  function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

  // Live hydrate stock + price from Supabase (in case it changed since build)
  window.addEventListener('load', async function () {
    if (typeof ProductAPI === 'undefined') return;
    try {
      const p = await ProductAPI.getProduct(PRODUCT.id);
      if (!p) return;
      const addBtn = document.getElementById('add-btn');
      const badge = document.getElementById('stock-badge');
      if (p.inStock === false) {
        addBtn.disabled = true; addBtn.textContent = 'Out of Stock';
        if (badge) badge.style.display = '';
      } else {
        addBtn.disabled = false;
        if (addBtn.textContent === 'Out of Stock') addBtn.textContent = 'Add to Cart';
        if (badge) badge.style.display = 'none';
      }
      if (p.sizes && p.sizes.length) {
        p.sizes.forEach(s => {
          const pill = document.querySelector('#size-' + PRODUCT.id + ' .size-pill[data-ml="' + s.ml + '"]');
          if (pill) pill.dataset.price = s.price;
        });
        const active = document.querySelector('#size-' + PRODUCT.id + ' .size-pill.active');
        if (active) document.getElementById('price-' + PRODUCT.id).textContent = '৳' + active.dataset.price;
      }
    } catch (e) { /* keep baked values */ }
  });
</script>
</body>
</html>
`;
}

// ─── Sitemap ─────────────────────────────────────────────────
function writeSitemap(all) {
  const core = [
    { loc: `${SITE}/`,              freq: 'weekly',  pri: '1.0' },
    { loc: `${SITE}/shop.html`,     freq: 'weekly',  pri: '0.9' },
    { loc: `${SITE}/exclusive.html`,freq: 'weekly',  pri: '0.8' },
    { loc: `${SITE}/about.html`,    freq: 'monthly', pri: '0.5' },
    { loc: `${SITE}/about-me.html`, freq: 'monthly', pri: '0.4' },
  ];
  const products = all.map(p => ({ loc: `${SITE}/product/${p.id}/`, freq: 'weekly', pri: '0.7' }));
  const urls = [...core, ...products].map(u =>
    `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.freq}</changefreq>\n    <priority>${u.pri}</priority>\n  </url>`
  ).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);
}

// ─── Generate from arbitrary data (local products.js OR Supabase) ─
// opts.hasImage: (id) => bool — whether optimized WebP exists (defaults to
// on-disk check). Lets the Supabase build pass a Set of ids present in Storage.
function generateFromData(allProducts, productDetails, opts = {}) {
  if (opts.hasImage) setImageChecker(opts.hasImage);
  const outRoot = path.join(ROOT, 'product');

  let written = 0;
  for (const p of allProducts) {
    const dir = path.join(outRoot, p.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), renderPage(p, allProducts, productDetails));
    written++;
  }
  writeSitemap(allProducts);

  console.log(`✓ generated ${written} product pages + sitemap.xml (${allProducts.length} urls + 5 core)`);
  return { ok: true, written };
}

// ─── Main (local products.js source) ─────────────────────────
function run() {
  const { allProducts, productDetails } = loadProducts();
  return generateFromData(allProducts, productDetails);
}

module.exports = { run, generateFromData };

if (require.main === module) {
  run();
}
