// ============================================================
//  render-card.js — the single source of truth for a product
//  card's HTML. The build (scripts/build-from-supabase.js) uses it
//  to server-render the shop / home / exclusive grids into the
//  static HTML, so product content is crawlable and paints without
//  JS. The browser then filters + hydrates those nodes in place
//  (it no longer builds cards), which is why this is the only
//  card renderer in the codebase.
// ============================================================

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TAG_LABEL = {
  new: 'New', restocked: 'Restocked', limited: 'Limited',
  discontinued: 'Discontinued', exclusive: 'Exclusive',
};
const tagLabel = t => TAG_LABEL[t] || (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

// Effective (sale) price. sp = percent off (0 = no sale). Must stay identical
// to the client copy in js/api.js so baked + hydrated prices agree.
function effectivePrice(price, sp) {
  return sp > 0 ? Math.round(price * (100 - sp) / 100) : price;
}

// Price-cell markup: struck original + sale price when on sale, else plain.
function priceCell(orig, eff) {
  return eff < orig ? `<s class="price-was">৳${orig}</s> ৳${eff}` : `৳${eff}`;
}

// p: { id, name, brand, sizes:[{ml,price}], tags:[], accords:[], inStock,
//      image_thumb, image_medium, sale_percent }
function renderCard(p, { isExclusive = false, priority = false } = {}) {
  const sizes = (p.sizes || []).slice().sort((a, b) => a.ml - b.ml);
  const sp = Number(p.sale_percent) || 0;
  const minPrice = sizes.length ? Math.min(...sizes.map(s => s.price)) : 0;
  const minEff = effectivePrice(minPrice, sp);
  const oos = !p.inStock;
  // Cards render at ~190px (2-col mobile) to ~285px (desktop), so the 450px
  // thumb is the right file everywhere and we serve it via plain src — no
  // srcset. A srcset listing `medium 800w` made high-DPR phones download the
  // 800px file (46vw × 2.6 DPR ≈ 500px needed > 450), ~3x the bytes for no
  // visible gain. Descriptors would also be wrong: some thumbs are <450px.
  const imgThumb = p.image_thumb;
  // Above-the-fold cards load eagerly with high priority so the first row paints
  // fast; the rest stay lazy. Fade-in (onload → .loaded) replaces the emoji "pop".
  const loadAttrs = priority ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';

  // Sale badge sits alongside the tag badges; data-price on each pill is the
  // effective (sale) price so add-to-cart charges it, data-original drives the
  // strikethrough. They're equal when there's no sale.
  const saleBadge = sp > 0 ? `<span class="tag tag-sale">−${sp}%</span>` : '';
  const tags = saleBadge + (p.tags || [])
    .map(t => `<span class="tag tag-${esc(t)}">${esc(tagLabel(t))}</span>`).join('');
  const pills = sizes.map((s, i) => {
    const eff = effectivePrice(s.price, sp);
    return `<button class="size-pill${i === 0 ? ' active' : ''}" data-ml="${s.ml}" data-price="${eff}" data-original="${s.price}" onclick="selectSize('${esc(p.id)}', this)">${s.ml}ml</button>`;
  }).join('');

  // data-* attributes power the client-side filter / sort / search — no re-render.
  const data = [
    `data-id="${esc(p.id)}"`,
    `data-name="${esc(String(p.name || '').toLowerCase())}"`,
    `data-brand="${esc(p.brand)}"`,
    `data-tags="${esc((p.tags || []).join(' '))}"`,
    `data-sizes="${esc(sizes.map(s => s.ml).join(' '))}"`,
    `data-accords="${esc((p.accords || []).join('|'))}"`,
    `data-instock="${oos ? 'false' : 'true'}"`,
    `data-price="${minEff}"`,
    `data-sale="${sp}"`,
  ].join(' ');

  return `
    <div class="product-card${oos ? ' out-of-stock' : ''}" ${data}>
      <a class="card-link" href="/product/${esc(p.id)}/">
        <div class="card-img">
          <img src="${esc(imgThumb)}" alt="${esc(p.name)} ${esc(p.brand)} perfume decant" width="450" height="450" ${loadAttrs} decoding="async" onload="this.classList.add('loaded')" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <div class="card-img-placeholder">🫧</div>
          <div class="tag-badges">${tags}</div>
          ${oos ? '<div class="oos-badge"><span>Out of Stock</span></div>' : ''}
        </div>
        <div class="card-body">
          <div class="card-brand">${esc(p.brand)}</div>
          <h3 class="card-name">${esc(p.name)}</h3>
        </div>
      </a>
      <div class="card-footer">
        <div class="size-pills" id="size-${esc(p.id)}">${pills}</div>
        <span class="card-price-live" id="price-${esc(p.id)}">${priceCell(minPrice, minEff)}</span>
        <button class="add-to-cart-btn"${oos ? ' disabled' : ''} onclick="handleAdd('${esc(p.id)}', ${isExclusive})">${oos ? 'Out of Stock' : 'Add to Cart'}</button>
      </div>
    </div>`;
}

module.exports = { renderCard, esc, effectivePrice, priceCell };
