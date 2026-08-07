const ProductAPI = (() => {
  let _cache = null;

  // Image URLs are derived deterministically from the product id, so a product
  // added in Supabase Studio needs no image_* columns — just the WebP files in
  // Storage at product-images/{id}/{size}.webp.
  function imgUrl(id, size, v) {
    const base = `${IMAGE_BASE}/storage/v1/object/public/product-images/${id}/${size}.webp`;
    return v ? `${base}?v=${v}` : base;
  }

  // Cache-busting version token from a row's updated_at (admin "save" bumps it).
  // Images upload with a 1-year immutable cache; ?v changes only when the row does.
  function ver(updated_at) {
    const t = updated_at ? Date.parse(updated_at) : NaN;
    return Number.isFinite(t) ? Math.floor(t / 1000) : '';
  }

  // Effective (sale) price — must match effectivePrice() in scripts/lib/render-card.js.
  function effectivePrice(price, sp) {
    return sp > 0 ? Math.round(price * (100 - sp) / 100) : price;
  }

  // ─── List shape (shop / index): only what cards render ───────
  function _normList(row) {
    const v = ver(row.updated_at);
    return {
      id:            row.id,
      name:          row.name,
      brand:         row.brands?.name ?? '',
      collection:    row.collection,
      salePercent:   row.sale_percent || 0,
      sizes:         (row.fragrance_sizes || [])
                       .map(s => ({ ml: s.ml, price: s.price }))
                       .sort((a, b) => a.ml - b.ml),
      tags:          (row.fragrance_tags || []).map(t => t.tag),
      inStock:       row.in_stock,
      is_bestseller: row.is_bestseller,
      image_thumb:   imgUrl(row.id, 'thumb', v),
      image_medium:  imgUrl(row.id, 'medium', v),
    };
  }

  // sale_percent lands with migration 009; fall back to the legacy select if it
  // isn't there yet, so stock hydration keeps working pre-migration.
  const LIST_REL = 'brands ( name ), fragrance_sizes ( ml, price ), fragrance_tags ( tag )';
  const LIST_BASE = 'id, name, collection, in_stock, is_bestseller, updated_at';

  async function _load() {
    if (_cache) return _cache;
    const sb = getSupabaseClient();
    const q = cols => sb.from('fragrances').select(`${cols}, ${LIST_REL}`).eq('status', 'published').order('sort_order');
    let { data, error } = await q(`${LIST_BASE}, sale_percent`);
    if (error) ({ data, error } = await q(LIST_BASE));
    if (error) throw error;
    _cache = data.map(_normList);
    return _cache;
  }

  // ─── Detail shape (product page): full image set + notes ─────
  async function getProduct(id) {
    const sb = getSupabaseClient();
    const rel = 'brands ( name ), fragrance_sizes ( ml, price ), fragrance_tags ( tag ), fragrance_details ( top_notes, heart_notes, base_notes, accords, family, description )';
    const base = 'id, name, collection, in_stock, updated_at';
    const q = cols => sb.from('fragrances').select(`${cols}, ${rel}`).eq('id', id).maybeSingle();
    let { data, error } = await q(`${base}, sale_percent`);
    if (error) ({ data, error } = await q(base));
    if (error) throw error;
    if (!data) return null;   // drafted / deleted id → caller keeps the baked page

    const v = ver(data.updated_at);
    const d = (data.fragrance_details && data.fragrance_details[0]) || null;
    return {
      id:           data.id,
      name:         data.name,
      brand:        data.brands?.name ?? '',
      collection:   data.collection,
      inStock:      data.in_stock,
      salePercent:  data.sale_percent || 0,
      sizes:        (data.fragrance_sizes || [])
                      .map(s => ({ ml: s.ml, price: s.price }))
                      .sort((a, b) => a.ml - b.ml),
      tags:         (data.fragrance_tags || []).map(t => t.tag),
      image_thumb:  imgUrl(data.id, 'thumb', v),
      image_medium: imgUrl(data.id, 'medium', v),
      image_large:  imgUrl(data.id, 'large', v),
      details: d && {
        top:     d.top_notes,
        heart:   d.heart_notes,
        base:    d.base_notes,
        accords: d.accords,
        family:  d.family,
        description: d.description || '',
      },
    };
  }

  // Re-price a card (or the PDP) for a live sale percent: update each pill's
  // data-price (effective) + data-original, refresh the visible price via the
  // active pill, keep the card's sort price in sync, and add/remove the badge.
  function applySaleToCard(root, p, sp) {
    if ('sale' in root.dataset || root.classList.contains('product-card')) root.dataset.sale = sp;
    const origByMl = {};
    (p.sizes || []).forEach(s => { origByMl[s.ml] = s.price; });
    const wrap = document.getElementById('size-' + p.id);
    if (wrap) wrap.querySelectorAll('.size-pill').forEach(pill => {
      const ml = Number(pill.dataset.ml);
      const orig = origByMl[ml] != null ? origByMl[ml] : (Number(pill.dataset.original) || Number(pill.dataset.price));
      pill.dataset.original = orig;
      pill.dataset.price = effectivePrice(orig, sp);
    });
    const active = wrap && wrap.querySelector('.size-pill.active');
    if (active && typeof selectSize === 'function') selectSize(p.id, active);
    if ((p.sizes || []).length && root.classList.contains('product-card')) {
      root.dataset.price = effectivePrice(Math.min(...p.sizes.map(s => s.price)), sp);
    }
    const badges = root.querySelector('.tag-badges');
    let sb = badges && badges.querySelector('.tag-sale');
    if (sp > 0 && badges) {
      if (!sb) { sb = document.createElement('span'); sb.className = 'tag tag-sale'; badges.insertBefore(sb, badges.firstChild); }
      sb.textContent = '−' + sp + '%';
    } else if (sb) { sb.remove(); }
  }

  // Sync the server-rendered .product-card nodes with live stock + sale (called
  // after load by shop/home/exclusive). Only touches cards whose stock or sale
  // changed since the build, so the DOM barely mutates. Returns true if changed.
  async function hydrateCards() {
    let products;
    try { products = await _load(); } catch { return false; }
    const byId = {};
    products.forEach(p => { byId[p.id] = p; });
    // Only STOCK changes are returned — shop.js re-runs applyFilters() on a truthy
    // return (the in-stock filter depends on stock). A sale changes only the price
    // display, which no filter reads, so it must NOT trigger applyFilters (that
    // reflows the sidebar → a needless layout shift on every sale-active visit).
    let stockChanged = false;
    document.querySelectorAll('.product-card[data-id]').forEach(card => {
      const p = byId[card.dataset.id];
      if (!p) return;

      // ── Stock (only touch cards whose stock actually changed) ──
      const oos = !p.inStock;
      const cardOos = card.dataset.instock === 'false';
      if (cardOos !== oos) {
        card.dataset.instock = oos ? 'false' : 'true';
        card.classList.toggle('out-of-stock', oos);
        const imgWrap = card.querySelector('.card-img');
        let badge = card.querySelector('.oos-badge');
        if (oos && !badge && imgWrap) {
          badge = document.createElement('div');
          badge.className = 'oos-badge';
          badge.innerHTML = '<span>Out of Stock</span>';
          imgWrap.appendChild(badge);
        } else if (!oos && badge) {
          badge.remove();
        }
        const btn = card.querySelector('.add-to-cart-btn');
        if (btn) { btn.disabled = oos; btn.textContent = oos ? 'Out of Stock' : 'Add to Cart'; }
        stockChanged = true;
      }

      // ── Sale (applied to the DOM, but does not trigger applyFilters) ──
      const liveSp = p.salePercent || 0;
      if (liveSp !== (Number(card.dataset.sale) || 0)) {
        applySaleToCard(card, p, liveSp);
      }
    });
    return stockChanged;
  }

  return {
    hydrateCards,
    applySaleToCard,
    effectivePrice,
    async getAll()         { return _load(); },
    async getRegular()     { return (await _load()).filter(p => p.collection === 'regular'); },
    async getExclusive()   { return (await _load()).filter(p => p.collection === 'exclusive'); },
    async getSpecial()     { return (await _load()).filter(p => p.collection === 'special'); },
    async getBestsellers() { return (await _load()).filter(p => p.is_bestseller); },
    async getBrands() {
      const d = await _load();
      return [...new Set(d.filter(p => p.collection !== 'special').map(p => p.brand))].sort();
    },
    getProduct,
    invalidate() { _cache = null; },
  };
})();
