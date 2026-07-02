const ProductAPI = (() => {
  let _cache = null;

  // ─── List shape (shop / index): only what cards render ───────
  function _normList(row) {
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
      image_thumb:   row.image_thumb,
    };
  }

  async function _load() {
    if (_cache) return _cache;
    const sb = getSupabaseClient();
    const { data, error } = await sb
      .from('fragrances')
      .select(`
        id, name, collection, in_stock, is_bestseller, image_thumb,
        brands ( name ),
        fragrance_sizes ( ml, price ),
        fragrance_tags ( tag )
      `)
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
        id, name, collection, in_stock,
        image_thumb, image_medium, image_large,
        brands ( name ),
        fragrance_sizes ( ml, price ),
        fragrance_tags ( tag ),
        fragrance_details ( top_notes, heart_notes, base_notes, accords, family )
      `)
      .eq('id', id)
      .single();
    if (error) throw error;

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
      image_thumb:  data.image_thumb,
      image_medium: data.image_medium,
      image_large:  data.image_large,
      details: d && {
        top:     d.top_notes,
        heart:   d.heart_notes,
        base:    d.base_notes,
        accords: d.accords,
        family:  d.family,
      },
    };
  }

  return {
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
