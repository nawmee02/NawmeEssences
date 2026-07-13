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

  // ─── List shape (shop / index): only what cards render ───────
  function _normList(row) {
    const v = ver(row.updated_at);
    return {
      id:            row.id,
      name:          row.name,
      brand:         row.brands?.name ?? '',
      collection:    row.collection,
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

  async function _load() {
    if (_cache) return _cache;
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('fragrances')
      .select(`
        id, name, collection, in_stock, is_bestseller, updated_at,
        brands ( name ),
        fragrance_sizes ( ml, price ),
        fragrance_tags ( tag )
      `)
      .eq('status', 'published')
      .order('sort_order');
    if (error) throw error;
    _cache = data.map(_normList);
    return _cache;
  }

  // ─── Detail shape (product page): full image set + notes ─────
  async function getProduct(id) {
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('fragrances')
      .select(`
        id, name, collection, in_stock, updated_at,
        brands ( name ),
        fragrance_sizes ( ml, price ),
        fragrance_tags ( tag ),
        fragrance_details ( top_notes, heart_notes, base_notes, accords, family, description )
      `)
      .eq('id', id)
      .maybeSingle();
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

  // Sync the server-rendered .product-card nodes with live stock (called after
  // load by shop/home/exclusive). Only touches cards whose stock changed since
  // the build, so the DOM barely mutates. Returns true if anything changed.
  async function hydrateCards() {
    let products;
    try { products = await _load(); } catch { return false; }
    const byId = {};
    products.forEach(p => { byId[p.id] = p; });
    let changed = false;
    document.querySelectorAll('.product-card[data-id]').forEach(card => {
      const p = byId[card.dataset.id];
      if (!p) return;
      const oos = !p.inStock;
      if ((card.dataset.instock === 'true') !== oos) return;   // already correct
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
      changed = true;
    });
    return changed;
  }

  return {
    hydrateCards,
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
