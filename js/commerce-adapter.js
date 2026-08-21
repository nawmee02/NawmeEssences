// ============================================================
//  commerce-adapter.js — a thin façade over the site's existing
//  commerce globals (ProductAPI, cart.js, window.__SETTINGS__).
//  js/webmcp.js talks ONLY to this adapter, so if the site later
//  moves to ES modules / a server API, the WebMCP tools don't
//  change. Normalizes shapes and validates against live state.
//  Loaded on every customer page; no-op-safe where a dependency
//  (e.g. ProductAPI on cart.html) is absent.
// ============================================================
(function () {
  const SITE = location.origin;
  const hasAPI = () => typeof ProductAPI !== 'undefined';
  const eff = (price, sp) =>
    (hasAPI() && ProductAPI.effectivePrice) ? ProductAPI.effectivePrice(price, sp)
      : (sp > 0 ? Math.round(price * (100 - sp) / 100) : price);

  // Normalize a ProductAPI list/detail row to the public tool shape.
  function shape(p) {
    const sp = Number(p.salePercent) || 0;
    const sizes = (p.sizes || []).map(s => ({ ml: s.ml, price: eff(s.price, sp), original: s.price }));
    const price = sizes.length ? Math.min(...sizes.map(s => s.price)) : null;
    return {
      id: p.id, name: p.name, brand: p.brand,
      price, sizes,
      inStock: !!p.inStock,
      isExclusive: p.collection !== 'regular',
      salePercent: sp,
      url: `${SITE}/product/${p.id}/`,
    };
  }

  async function allProducts() { return hasAPI() ? await ProductAPI.getAll() : []; }

  const A = {};

  // ── Discovery (read-only) ──────────────────────────────────
  A.listBrands = async () => (hasAPI() ? await ProductAPI.getBrands() : []);

  A.searchProducts = async (query, limit = 10) => {
    const all = await allProducts();
    const q = String(query || '').toLowerCase().trim();
    if (!q) return all.slice(0, limit).map(shape);
    const terms = q.split(/\s+/);
    return all
      .map(p => {
        const name = (p.name || '').toLowerCase(), brand = (p.brand || '').toLowerCase();
        let s = 0;
        for (const t of terms) {
          if (name.startsWith(t)) s += 3; else if (name.includes(t)) s += 2;
          if (brand.includes(t)) s += 1;
          if ((p.tags || []).some(x => String(x).toLowerCase().includes(t))) s += 1;
        }
        return { p, s };
      })
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map(x => shape(x.p));
  };

  A.filterProducts = async ({ brand, size, maxPrice, inStock, sort } = {}) => {
    let out = (await allProducts()).map(shape);
    if (brand) out = out.filter(p => p.brand.toLowerCase() === String(brand).toLowerCase());
    if (size != null && size !== '') {
      const ml = Number(String(size).replace(/ml$/i, ''));
      out = out.filter(p => p.sizes.some(s => s.ml === ml));
    }
    if (maxPrice != null) out = out.filter(p => p.price != null && p.price <= Number(maxPrice));
    if (inStock) out = out.filter(p => p.inStock);
    const cmp = {
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      'name-asc': (a, b) => a.name.localeCompare(b.name),
    };
    if (cmp[sort]) out.sort(cmp[sort]);
    return out;
  };

  A.getProduct = async (id) => {
    if (!hasAPI()) return null;
    const p = await ProductAPI.getProduct(id);
    if (!p) return null;
    const base = shape(p);
    base.tags = p.tags || [];
    base.family = (p.details && p.details.family) || '';
    base.notes = p.details
      ? { top: p.details.top || [], heart: p.details.heart || [], base: p.details.base || [] } : null;
    base.accords = (p.details && p.details.accords) || [];
    base.description = (p.details && p.details.description) || '';
    return base;
  };

  A.getPageContext = () => {
    const m = location.pathname.match(/\/product\/([^/]+)\//);
    const pill = document.querySelector('.size-pill.active');
    return {
      page: location.pathname,
      currentProductId: m ? m[1] : null,
      selectedSize: pill && pill.dataset.ml ? pill.dataset.ml + 'ml' : null,
      cartCount: typeof getCartCount === 'function' ? getCartCount() : null,
      cartTotal: typeof getCartTotal === 'function' ? getCartTotal() : null,
      availableBrands: [...document.querySelectorAll('.brand-filter')].map(el => el.value).filter(Boolean),
    };
  };

  // ── Cart (write, validated) ────────────────────────────────
  A.viewCart = () => {
    const cart = typeof getCart === 'function' ? getCart() : [];
    return {
      items: cart.map(i => ({
        productId: i.productId, name: i.name, brand: i.brand,
        size: i.ml + 'ml', price: i.price, qty: i.qty,
      })),
      count: typeof getCartCount === 'function' ? getCartCount() : cart.reduce((n, i) => n + i.qty, 0),
      total: typeof getCartTotal === 'function' ? getCartTotal() : cart.reduce((s, i) => s + i.price * i.qty, 0),
    };
  };

  function mlOf(size) { return Number(String(size).replace(/ml$/i, '')); }

  A.addToCart = async ({ productId, size, quantity = 1 } = {}) => {
    if (typeof addToCart !== 'function') throw new Error('cart unavailable on this page');
    const p = await A.getProduct(productId);
    if (!p) throw new Error('Unknown product: ' + productId);
    if (!p.inStock) throw new Error('Out of stock: ' + productId);
    const ml = mlOf(size);
    const s = p.sizes.find(x => x.ml === ml);
    if (!s) throw new Error(`Size ${size} not available for ${productId}`);
    const sizesArg = p.sizes.map(x => ({ ml: x.ml, price: x.price }));
    addToCart(productId, ml, s.price, p.name, p.brand, p.isExclusive, sizesArg);
    const qty = Math.max(1, Number(quantity) || 1);
    if (qty > 1 && typeof updateQty === 'function') updateQty(`${productId}_${ml}`, qty);
    return A.viewCart();
  };

  A.updateCartItem = ({ productId, size, quantity } = {}) => {
    if (typeof updateQty !== 'function') throw new Error('cart unavailable');
    updateQty(`${productId}_${mlOf(size)}`, Math.max(1, Number(quantity) || 1));
    return A.viewCart();
  };

  A.removeFromCart = ({ productId, size } = {}) => {
    if (typeof removeFromCart !== 'function') throw new Error('cart unavailable');
    removeFromCart(`${productId}_${mlOf(size)}`);
    return A.viewCart();
  };

  // ── Checkout (human-confirmed) ─────────────────────────────
  A.getCheckoutInfo = () => {
    const s = window.__SETTINGS__ || {};
    const d = s.delivery || { dhaka: 70, suburb: 90, outside: 120 };
    const cart = A.viewCart();
    return {
      zones: [
        { id: 'dhaka', label: 'Within Dhaka', charge: d.dhaka },
        { id: 'suburb', label: 'Dhaka Suburb', charge: d.suburb },
        { id: 'outside', label: 'Outside Dhaka', charge: d.outside },
      ],
      subtotal: cart.total,
      advanceRule: 'Exclusive items require full advance; orders over ৳2000 require 30% advance; otherwise the advance is the delivery charge.',
      channels: ['whatsapp', 'messenger'],
    };
  };

  // Returns a machine-readable confirmation object. NEVER auto-submits — the
  // human opens the deep link and sends the message themselves.
  A.prepareOrder = ({ name, phone, address, zone, channel = 'whatsapp' } = {}) => {
    const cart = A.viewCart();
    if (!cart.items.length) return { status: 'empty_cart', requiresUserAction: true };
    const orderSummary = cart.items.map(i => `${i.qty}× ${i.name} (${i.size}) — ৳${i.price * i.qty}`).join('\n');
    let deepLink = null;
    try {
      if (channel === 'whatsapp' && typeof buildWhatsAppMessage === 'function' && typeof waNumber === 'function') {
        deepLink = `https://wa.me/${waNumber()}?text=${encodeURIComponent(buildWhatsAppMessage(zone, name, phone, address))}`;
      } else if (channel === 'messenger') {
        deepLink = 'https://m.me/509978488868598';
      }
    } catch (e) { /* deep-link builder unavailable on this page */ }
    return {
      status: 'ready_for_user_confirmation',
      channel,
      orderSummary,
      total: cart.total,
      deepLink,
      requiresUserAction: true,
    };
  };

  window.CommerceAdapter = A;
})();
