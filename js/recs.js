// ============================================================
//  recs.js — quiet client-side recommendations (tier 1).
//
//  No model, no server: the build writes data/recs.json (one compact
//  feature record per product, scripts/lib/recs.js) and this file
//  scores it against the visitor's OWN signals, which never leave the
//  browser (localStorage "nawme_signals": product views, add-to-cart,
//  size choices; capped, expiring, no personal data).
//
//  Performance contract:
//    • a visitor with no signals triggers no fetch and no DOM change;
//    • all rendering happens after `load` + requestIdleCallback;
//    • a rail is revealed only when its slot is at/below the viewport
//      bottom, so nothing visible moves (CLS stays 0);
//    • cards are rendered by the SAME renderer the build uses
//      (js/render-card.js), so hydration/add-to-cart contracts hold.
//
//  The pure parts (prepareData, buildProfile, rank, browsedCount) are also
//  exported for Node so scripts/test-recs.js can test them.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    root.NawmeRecs = api;
    api._init(document.currentScript);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── tuning ─────────────────────────────────────────────────
  const WEIGHTS = { f: 2, a: 2, n: 1, o: 1, g: 1.5, k: 0.5, b: 1 };   // feature families
  const EVENT_W = { v: 1, c: 3, s: 0.5 };                                // view / cart / size
  const HALF_LIFE_DAYS = 14;
  const MAX_EVENTS = 30, EXPIRY_DAYS = 90, REVIEW_DEDUPE_MS = 30 * 60e3;
  const MIN_COS = 0.15, BRAND_CAP = 2, RAIL_SIZE = 4;
  // The homepage "Recommended" rail appears only once a visitor has browsed this
  // many distinct products; "You May Also Like" is quietly personalised sooner.
  const HOME_MIN_PRODUCTS = 10, RELATED_MIN_PRODUCTS = 3;
  // Variety: picks are a weighted shuffle of the top POOL_SIZE candidates; on a
  // product page similarity to THAT product carries ANCHOR_SHARE of the score;
  // products shown in the last SHOWN_DAYS are pushed down by SHOWN_PENALTY.
  const POOL_SIZE = 10, ANCHOR_SHARE = 0.65, SHOWN_PENALTY = 0.18, SHOWN_DAYS = 7, SHOWN_MAX = 48;
  const SHOWN_KEY = 'nawme_shown';
  const KEY = 'nawme_signals';
  const DAY = 864e5;

  const effectivePrice = (price, sp) => (sp > 0 ? Math.round(price * (100 - sp) / 100) : price);

  // ── data → model ───────────────────────────────────────────
  function vectorize(it) {
    const v = new Map();
    const add = (k, w) => v.set(k, (v.get(k) || 0) + w);
    (it.f || []).forEach(i => add('f' + i, WEIGHTS.f));
    (it.a || []).forEach(i => add('a' + i, WEIGHTS.a));
    (it.n || []).forEach(i => add('n' + i, WEIGHTS.n));
    (it.o || []).forEach(i => add('o' + i, WEIGHTS.o));
    if (it.g) add('g' + it.g, WEIGHTS.g);
    if (it.k >= 0) add('k' + it.k, WEIGHTS.k);
    if (it.b >= 0) add('b' + it.b, WEIGHTS.b);
    let n = 0; v.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1;
    v.forEach((w, k) => v.set(k, w / n));
    return v;
  }
  function prepareData(data) {
    if (!data || data.v !== 1 || !Array.isArray(data.items)) return null;
    const byId = new Map();
    const items = data.items.map((it, idx) => { const m = Object.assign({}, it, { idx, vec: vectorize(it) }); byId.set(it.id, m); return m; });
    return { vocab: data.vocab || {}, items, byId };
  }

  // ── signals (localStorage) ─────────────────────────────────
  function readSignals() {
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return [];
      const d = JSON.parse(raw); if (!d || d.v !== 1 || !Array.isArray(d.e)) return [];
      const cutoff = Date.now() - EXPIRY_DAYS * DAY;
      return d.e.filter(e => e && typeof e.id === 'string' && e.ts > cutoff);
    } catch (e) { return []; }
  }
  function writeSignals(list) { try { localStorage.setItem(KEY, JSON.stringify({ v: 1, e: list.slice(-MAX_EVENTS) })); } catch (e) {} }
  function record(t, id, ml) {
    if (!id || !EVENT_W[t]) return;
    let list = readSignals();
    const now = Date.now();
    // A size chip can be tapped many times; keep one event per product so chip
    // toggling never floods the window and evicts real views.
    if (t === 's') list = list.filter(x => !(x.t === 's' && x.id === id));
    if (t === 'v') {
      const recent = list.find(x => x.t === 'v' && x.id === id && now - x.ts < REVIEW_DEDUPE_MS);
      if (recent) { recent.ts = now; writeSignals(list); return; }
    }
    const ev = { t, id, ts: now };
    if (ml) ev.ml = Number(ml);
    list.push(ev);
    writeSignals(list);
  }

  // Every product the visitor has ever opened (ids only, long-lived, capped).
  // Owner rule: once visited, never recommended again — independent of the
  // 30-event / 90-day signal window above.
  const VISITED_KEY = 'nawme_visited', VISITED_MAX = 400;
  function readVisited() {
    try { const d = JSON.parse(localStorage.getItem(VISITED_KEY) || 'null'); return d && d.v === 1 && Array.isArray(d.ids) ? d.ids.filter(x => typeof x === 'string') : []; } catch (e) { return []; }
  }
  function markVisited(id) {
    try { const ids = readVisited().filter(x => x !== id); ids.push(id); localStorage.setItem(VISITED_KEY, JSON.stringify({ v: 1, ids: ids.slice(-VISITED_MAX) })); } catch (e) {}
  }

  // Recently shown recommendations (so the next page rotates in new ones).
  // Map id → weight 1 (shown just now) … 0 (SHOWN_DAYS old).
  function readShown() {
    const m = new Map();
    try {
      const d = JSON.parse(localStorage.getItem(SHOWN_KEY) || 'null'); if (!d || d.v !== 1 || !Array.isArray(d.e)) return m;
      const now = Date.now();
      d.e.forEach(e => { if (e && e.id && e.ts) { const age = (now - e.ts) / DAY; if (age < SHOWN_DAYS) m.set(e.id, Math.max(m.get(e.id) || 0, 1 - age / SHOWN_DAYS)); } });
    } catch (e) {}
    return m;
  }
  function markShown(ids) {
    try {
      const d = JSON.parse(localStorage.getItem(SHOWN_KEY) || 'null');
      const list = (d && d.v === 1 && Array.isArray(d.e) ? d.e : []).filter(e => e && e.id && Date.now() - e.ts < SHOWN_DAYS * DAY && !ids.includes(e.id));
      const now = Date.now();
      ids.forEach(id => list.push({ id, ts: now }));
      localStorage.setItem(SHOWN_KEY, JSON.stringify({ v: 1, e: list.slice(-SHOWN_MAX) }));
    } catch (e) {}
  }

  // ── scoring ────────────────────────────────────────────────
  function priceOf(item, ml) {
    if (ml) { const s = (item.s || []).find(x => x[0] === Number(ml)); if (s) return effectivePrice(s[1], item.sp); }
    return item.p;
  }
  function buildProfile(model, signals) {
    const vec = new Map(), ids = new Set();
    let weight = 0, logSum = 0;
    const now = Date.now();
    for (const ev of signals || []) {
      const item = model.byId.get(ev.id); if (!item) continue;
      ids.add(ev.id);
      const w = (EVENT_W[ev.t] || 0) * Math.pow(0.5, Math.max(0, now - ev.ts) / DAY / HALF_LIFE_DAYS);
      if (!w) continue;
      weight += w; logSum += w * Math.log(priceOf(item, ev.ml));
      item.vec.forEach((x, k) => vec.set(k, (vec.get(k) || 0) + w * x));
    }
    let n = 0; vec.forEach(x => { n += x * x; }); n = Math.sqrt(n) || 1;
    vec.forEach((x, k) => vec.set(k, x / n));
    return { vec, weight, logP: weight ? logSum / weight : 0, ids };
  }
  function cosine(a, b) {
    let s = 0; const small = a.size < b.size ? a : b, big = small === a ? b : a;
    small.forEach((x, k) => { const y = big.get(k); if (y) s += x * y; });
    return s;
  }
  // All in-stock items in the collection, scored and sorted (score, then lower price, then build order).
  //   opts.anchor      — an item: similarity to it is blended in (ANCHOR_SHARE) so a
  //                      product page's picks stay "like this one" instead of
  //                      "like everything you browsed" (which made every page
  //                      surface the same few hub perfumes)
  //   opts.shown       — Map id → age-weight (0..1) of products shown recently;
  //                      they are pushed down so fresh products rotate in
  function scoreAll(model, prof, opts) {
    const ex = new Set(opts.exclude || []);
    if (opts.excludeSignals !== false) prof.ids.forEach(id => ex.add(id));
    (opts.visited || []).forEach(id => ex.add(id));
    const anchorVec = opts.anchor ? opts.anchor.vec : null;
    const shown = opts.shown || null;
    const out = [];
    for (const it of model.items) {
      if (!it.i || ex.has(it.id)) continue;
      if (opts.collection && it.c !== opts.collection) continue;
      const cosP = prof.weight ? cosine(prof.vec, it.vec) : 0;
      const cos = anchorVec ? ANCHOR_SHARE * cosine(anchorVec, it.vec) + (1 - ANCHOR_SHARE) * cosP : cosP;
      const pricePen = prof.weight ? 0.10 * Math.min(1, Math.abs(Math.log(it.p) - prof.logP) / Math.log(3)) : 0;
      const shownPen = shown && shown.has(it.id) ? SHOWN_PENALTY * shown.get(it.id) : 0;
      out.push({ id: it.id, item: it, cos, score: cos + 0.05 * it.bs - pricePen - shownPen });
    }
    out.sort((x, y) => (y.score - x.score) || (x.item.p - y.item.p) || (x.item.idx - y.item.idx));
    return out;
  }
  // Weighted shuffle: the best candidate is the likeliest first pick, but not a
  // certainty, so the same four do not come back page after page.
  function weightedSample(cands, n, rnd) {
    const pool = cands.slice(), out = [];
    while (pool.length && out.length < n) {
      const weights = pool.map((c, i) => pool.length - i);      // rank-based: 8,7,6,…
      let r = rnd() * weights.reduce((a, b) => a + b, 0), k = 0;
      while (k < pool.length - 1 && (r -= weights[k]) > 0) k++;
      out.push(pool.splice(k, 1)[0]);
    }
    return out;
  }
  // Top picks for a rail: cosine threshold, max BRAND_CAP per brand, then a
  // weighted shuffle of the top POOL_SIZE into `limit` cards.
  function rank(model, signals, opts) {
    opts = opts || {};
    if (!model) return [];
    const prof = buildProfile(model, signals || []);
    if (!prof.weight && !opts.anchor) return [];
    const minCos = opts.minCos == null ? MIN_COS : opts.minCos;
    const cap = opts.brandCap == null ? BRAND_CAP : opts.brandCap;
    const limit = opts.limit || RAIL_SIZE;
    const poolSize = opts.pool == null ? POOL_SIZE : opts.pool;
    const pool = [], perBrand = new Map();
    for (const r of scoreAll(model, prof, opts)) {
      if (r.cos <= minCos) continue;
      const b = r.item.b;
      if (cap && (perBrand.get(b) || 0) >= cap) continue;
      pool.push(r); perBrand.set(b, (perBrand.get(b) || 0) + 1);
      if (pool.length >= Math.max(limit, poolSize)) break;
    }
    if (pool.length < limit) return pool;
    const rnd = opts.rnd || Math.random;
    return opts.shuffle === false ? pool.slice(0, limit) : weightedSample(pool, limit, rnd);
  }
  // ── browser integration ────────────────────────────────────
  const state = { url: '', model: null, pending: null, imgBase: '' };
  // The product page declares `const PRODUCT` in an inline script: a global
  // lexical binding, NOT a window property — so look it up by name.
  const pid = () => { try { return (typeof PRODUCT !== 'undefined' && PRODUCT && PRODUCT.id) || ''; } catch (e) { return ''; } };
  function imgUrl(item, size) {
    const base = state.imgBase || (typeof IMAGE_BASE === 'string' ? IMAGE_BASE : 'https://cdn.nawmeessences.com');
    return base + '/storage/v1/object/public/product-images/' + encodeURIComponent(item.id) + '/' + size + '.webp?v=' + item.v;
  }
  function toCard(item, vocab) {
    return {
      id: item.id, name: item.nm, brand: vocab.b[item.b] || '',
      sizes: item.s.map(x => ({ ml: x[0], price: x[1] })), tags: item.t || [],
      accords: (item.a || []).map(i => vocab.a[i]).filter(Boolean),
      inStock: !!item.i, sale_percent: item.sp,
      image_thumb: imgUrl(item, 'thumb'), image_small: imgUrl(item, 'small'),
    };
  }
  function prepare() {
    if (state.model) return Promise.resolve(state.model);
    if (state.pending) return state.pending;
    if (!state.url || typeof fetch !== 'function') return Promise.resolve(null);
    state.pending = fetch(state.url, { credentials: 'omit' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { state.model = prepareData(d); return state.model; })
      .catch(() => null)
      .then(m => { state.pending = null; return m; });
    return state.pending;
  }
  const ready = () => !!state.model;
  const afterIdle = fn => {
    const go = () => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 0));
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  };
  // A rail may appear only when its slot is at/below the viewport bottom.
  const belowFold = el => {
    let prev = el.previousElementSibling;
    while (prev && prev.hidden) prev = prev.previousElementSibling;
    return !prev || prev.getBoundingClientRect().bottom >= window.innerHeight;
  };
  const idsOnPage = () => {
    const ids = [];
    document.querySelectorAll('.product-card[data-id]').forEach(c => ids.push(c.dataset.id));
    document.querySelectorAll('.related-card[href]').forEach(a => { const m = a.getAttribute('href').match(/\/product\/([^/]+)\//); if (m) ids.push(m[1]); });
    if (pid()) ids.push(PRODUCT.id);
    return ids;
  };

  // "Browsed" = opened (view) or carted; size-chip taps tilt the profile but
  // do not count towards the two thresholds.
  const browsedCount = signals => new Set(signals.filter(e => e.t !== 's').map(e => e.id)).size;

  function homeRail() {
    const section = document.getElementById('recs-section'), grid = document.getElementById('recs-grid');
    if (!section || !grid || !window.RenderCard) return;
    const signals = readSignals(); if (browsedCount(signals) < HOME_MIN_PRODUCTS) return;
    prepare().then(model => {
      if (!model) return;
      const picks = rank(model, signals, { collection: 'r', exclude: idsOnPage(), visited: readVisited(), limit: RAIL_SIZE, shown: readShown() });
      if (picks.length < RAIL_SIZE || !belowFold(section)) return;
      grid.innerHTML = picks.map(r => RenderCard.renderCard(toCard(r.item, model.vocab), { isExclusive: false, priority: false })).join('');
      markShown(picks.map(r => r.id));
      section.hidden = false;
      const divider = document.getElementById('recs-divider'); if (divider) divider.hidden = false;
      if (window.ProductAPI && typeof ProductAPI.hydrateCards === 'function') { try { ProductAPI.hydrateCards(); } catch (e) {} }
    });
  }

  // "You May Also Like" on the product page: the baked four stay for first-time
  // visitors (and for crawlers). Once a visitor has browsed a few products, the
  // same grid is quietly refilled with picks anchored on THIS product (strong
  // weight) and tilted by what they looked at. Same heading, same markup, same
  // card count, so nothing moves and nothing announces itself.
  function personaliseRelated() {
    const section = document.querySelector('.pd-related'), grid = section && section.querySelector('.related-grid');
    if (!section || !grid || !pid()) return;
    const others = readSignals().filter(e => e.id !== pid());
    if (browsedCount(others) < RELATED_MIN_PRODUCTS) return;
    prepare().then(model => {
      if (!model) return;
      const me = model.byId.get(pid()); if (!me) return;
      // Anchored on THIS product (ANCHOR_SHARE of the score), tilted by the
      // visitor's profile, with recently shown products rotated out.
      const picks = rank(model, others, { collection: me.c, exclude: [me.id], visited: readVisited(), anchor: me, shown: readShown(), limit: RAIL_SIZE, brandCap: 2 });
      if (picks.length < RAIL_SIZE || !belowFold(section)) return;
      markShown(picks.map(r => r.id));
      const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      grid.innerHTML = picks.map(r => {
        const it = r.item, brand = model.vocab.b[it.b] || '';
        return '<a class="related-card" href="/product/' + esc(it.id) + '/">' +
          '<div class="related-img"><img src="' + esc(imgUrl(it, 'thumb')) + '" srcset="' + esc(imgUrl(it, 'small')) + ' 360w, ' + esc(imgUrl(it, 'thumb')) + ' 450w" sizes="(max-width:900px) 46vw, 220px" alt="' + esc(it.nm) + '" loading="lazy" decoding="async" onload="this.classList.add(\'loaded\')" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div class="card-img-placeholder">🫧</div></div>' +
          '<div class="related-brand">' + esc(brand) + '</div><div class="related-name">' + esc(it.nm) + '</div>' +
          '<div class="related-price">from ৳' + it.p + '</div></a>';
      }).join('');
    });
  }

  function _init(scriptEl) {
    try {
      state.url = (scriptEl && scriptEl.dataset && scriptEl.dataset.recs) || '';
      if (pid()) { record('v', PRODUCT.id); markVisited(PRODUCT.id); }
      // One delegated, capture-phase listener: fires for every real tap on a
      // buy button or size chip (buttons are disabled when out of stock).
      document.addEventListener('click', e => {
        const btn = e.target && e.target.closest ? e.target.closest('.add-to-cart-btn, .buy-now-btn, .size-pill') : null;
        if (!btn || btn.disabled) return;
        const card = btn.closest('.product-card');
        const id = (card && card.dataset.id) || (pid());
        if (!id) return;
        if (btn.classList.contains('size-pill')) { record('s', id, btn.dataset.ml); return; }
        const wrap = document.getElementById('size-' + id), active = wrap && wrap.querySelector('.size-pill.active');
        record('c', id, active ? active.dataset.ml : undefined);
      }, true);
      afterIdle(() => { homeRail(); personaliseRelated(); });
    } catch (e) { /* recommendations are optional */ }
  }

  return { WEIGHTS, EVENT_W, HOME_MIN_PRODUCTS, RELATED_MIN_PRODUCTS, POOL_SIZE, prepareData, buildProfile, rank, browsedCount, readSignals, readShown, markShown, readVisited, markVisited, record, prepare, ready, _init };
});
