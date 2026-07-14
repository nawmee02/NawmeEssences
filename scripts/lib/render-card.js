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

// p: { id, name, brand, sizes:[{ml,price}], tags:[], accords:[], inStock,
//      image_thumb, image_medium }
function renderCard(p, { isExclusive = false, priority = false } = {}) {
  const sizes = (p.sizes || []).slice().sort((a, b) => a.ml - b.ml);
  const minPrice = sizes.length ? Math.min(...sizes.map(s => s.price)) : 0;
  const oos = !p.inStock;
  const imgThumb = p.image_thumb;
  const imgMed = p.image_medium || imgThumb;
  // Above-the-fold cards load eagerly with high priority so the first row paints
  // fast; the rest stay lazy. Fade-in (onload → .loaded) replaces the emoji "pop".
  const loadAttrs = priority ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';

  const tags = (p.tags || [])
    .map(t => `<span class="tag tag-${esc(t)}">${esc(tagLabel(t))}</span>`).join('');
  const pills = sizes.map((s, i) =>
    `<button class="size-pill${i === 0 ? ' active' : ''}" data-ml="${s.ml}" data-price="${s.price}" onclick="selectSize('${esc(p.id)}', this)">${s.ml}ml</button>`
  ).join('');

  // data-* attributes power the client-side filter / sort / search — no re-render.
  const data = [
    `data-id="${esc(p.id)}"`,
    `data-name="${esc(String(p.name || '').toLowerCase())}"`,
    `data-brand="${esc(p.brand)}"`,
    `data-tags="${esc((p.tags || []).join(' '))}"`,
    `data-sizes="${esc(sizes.map(s => s.ml).join(' '))}"`,
    `data-accords="${esc((p.accords || []).join('|'))}"`,
    `data-instock="${oos ? 'false' : 'true'}"`,
    `data-price="${minPrice}"`,
  ].join(' ');

  return `
    <div class="product-card${oos ? ' out-of-stock' : ''}" ${data}>
      <a class="card-link" href="/product/${esc(p.id)}/">
        <div class="card-img">
          <img src="${esc(imgThumb)}" srcset="${esc(imgThumb)} 450w, ${esc(imgMed)} 800w" sizes="(max-width:640px) 46vw, 300px" alt="${esc(p.name)} ${esc(p.brand)} perfume decant" width="450" height="450" ${loadAttrs} decoding="async" onload="this.classList.add('loaded')" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
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
        <span class="card-price-live" id="price-${esc(p.id)}">৳${minPrice}</span>
        <button class="add-to-cart-btn"${oos ? ' disabled' : ''} onclick="handleAdd('${esc(p.id)}', ${isExclusive})">${oos ? 'Out of Stock' : 'Add to Cart'}</button>
      </div>
    </div>`;
}

module.exports = { renderCard, esc };
