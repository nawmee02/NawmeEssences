// Cards are server-rendered into #shop-grid at build time. This script no longer
// builds cards — it filters/sorts the existing nodes in place (so product content
// is crawlable + paints without JS) and hydrates live stock after load.

let _cards = [];  // product-card nodes in their original (build) order

// The filter dropdowns in #filters-sidebar (single choice each; options baked by
// the build) plus the quick-pick toggles (.qp). The sidebar on desktop, a
// bottom sheet on phones.
const FILTER_IDS = ['f-brand', 'f-type', 'f-family', 'f-accord', 'f-note', 'f-occasion', 'f-size'];

// Price range (3ml price = the card's data-price). min/max: the shop's bounds,
// set in initPrice(); lo/hi: the chosen range. Active only when narrowed.
const PRICE_STEP = 10;
const price = { min: 0, max: 0, lo: 0, hi: 0 };
const priceActive = () => price.max > 0 && (price.lo > price.min || price.hi < price.max);

function initPrice() {
  const prices = _cards.filter(c => !('searchOnly' in c.dataset)).map(c => Number(c.dataset.price)).filter(n => n > 0);
  if (!prices.length) return;
  price.min = Math.floor(Math.min(...prices) / PRICE_STEP) * PRICE_STEP;
  price.max = Math.ceil(Math.max(...prices) / PRICE_STEP) * PRICE_STEP;
  ['price-lo', 'price-hi', 'price-min', 'price-max'].forEach(id => {
    const el = document.getElementById(id);
    if (el) Object.assign(el, { min: price.min, max: price.max, step: PRICE_STEP });
  });
  setPrice(price.min, price.max);
}

// Clamp, keep lo ≤ hi, and sync the boxes, the handles and the gold fill.
function setPrice(lo, hi) {
  const clamp = v => Math.min(price.max, Math.max(price.min, Number.isFinite(v) ? v : price.min));
  lo = clamp(lo); hi = clamp(Number.isFinite(hi) ? hi : price.max);
  if (lo > hi) [lo, hi] = [hi, lo];
  Object.assign(price, { lo, hi });
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('price-lo', lo); set('price-hi', hi); set('price-min', lo); set('price-max', hi);
  const span = price.max - price.min || 1;
  const fill = document.getElementById('price-fill');
  if (fill) { fill.style.left = `${(lo - price.min) / span * 100}%`; fill.style.right = `${(price.max - hi) / span * 100}%`; }
  // When the handles meet near the top, keep the low one grabbable.
  const loEl = document.getElementById('price-lo');
  if (loEl) loEl.style.zIndex = lo >= price.max - PRICE_STEP ? 3 : '';
}

// Note / Vibe options and the cards' data-notekeys / data-vibes share the
// build's merged keys (scripts/lib/note-canon.js: "Madagascar Vanilla" = vanilla).
const listOf = v => (v ? v.split('|') : []);

function quickPicks() {
  return [...document.querySelectorAll('.qp[aria-pressed="true"]')].map(b => b.dataset.qp);
}

function handleAdd(id, isExclusive) {
  const card = document.querySelector('.product-card[data-id="' + id + '"]');
  const pill = document.querySelector('#size-' + id + ' .size-pill.active');
  if (!card || !pill) return;
  const name = card.querySelector('.card-name').textContent.trim();
  const sizes = [...document.querySelectorAll('#size-' + id + ' .size-pill')].map(b => ({ ml: Number(b.dataset.ml), price: Number(b.dataset.price) }));
  addToCart(id, pill.dataset.ml, pill.dataset.price, name, card.dataset.brand, isExclusive, sizes);
}

function filterValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function getActiveFilters() {
  return {
    search: document.getElementById('search-input').value.trim().toLowerCase(),
    // Same word-by-word name/brand/note/accord rule as the header overlay
    // (search.js loads before this file on shop.html); plain substring if it didn't load.
    match: typeof searchMatcher === 'function'
      ? searchMatcher(document.getElementById('search-input').value)
      : (name, brand) => (name + ' ' + brand.toLowerCase()).includes(document.getElementById('search-input').value.trim().toLowerCase()),
    brand: filterValue('f-brand'),
    type: filterValue('f-type'),
    family: filterValue('f-family'),
    accord: filterValue('f-accord'),
    note: filterValue('f-note'),
    occasion: filterValue('f-occasion'),
    price: priceActive() ? [price.lo, price.hi] : null,
    size: Number(filterValue('f-size')) || 0,
    picks: quickPicks(),
    sort: document.getElementById('sort-select').value,
    // Any filter on (search aside) — reveals the exclusive-page products too.
    any: FILTER_IDS.some(filterValue) || priceActive() || quickPicks().length > 0,
  };
}

// Returns 0/false when the card is filtered out, else its search rank
// (searchMatcher in js/search.js: 4 name/brand … 1 accord — or 1 with no search).
function cardMatches(card, f) {
  const d = card.dataset;
  // Exclusive-page products sit in the grid hidden; a search or any filter
  // reveals them (so a note only exclusives have still finds them).
  if ('searchOnly' in d && !f.search && !f.any) return false;
  const rank = f.search ? f.match(d.name, d.brand, listOf(d.notekeys), listOf(d.vibes)) : 1;
  if (!rank) return false;
  if (f.brand && d.brand !== f.brand) return false;
  if (f.type && d.type !== f.type) return false;
  if (f.family && !listOf(d.family).includes(f.family)) return false;
  if (f.accord && !listOf(d.vibes).includes(f.accord)) return false;
  if (f.note && !listOf(d.notekeys).includes(f.note)) return false;
  if (f.occasion && !listOf(d.occasions).includes(f.occasion)) return false;
  if (f.price && (+d.price < f.price[0] || +d.price > f.price[1])) return false;
  if (f.size && !d.sizes.split(' ').map(Number).includes(f.size)) return false;
  for (const pick of f.picks) {
    if (pick === 'instock' && d.instock !== 'true') return false;
    if (pick === 'new' && !(d.tags || '').split(' ').includes('new')) return false;
    if (pick === 'sale' && !(Number(d.sale) > 0)) return false;
    if ((pick === 'summer' || pick === 'winter') && !listOf(d.occasions).includes(pick)) return false;
  }
  return rank;
}

// Active filters as removable chips (search + each set dropdown). Must match
// the inline ?q= pre-render in shop.html for the search chip.
let _chipActions = [];
function renderActiveFilters() {
  const box = document.getElementById('active-filters');
  if (!box) return;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const chips = [];
  const input = document.getElementById('search-input');
  if (input.value.trim()) chips.push([`“${input.value.trim()}”`, () => { input.value = ''; }]);
  if (priceActive()) chips.push([`৳${price.lo} – ৳${price.hi}`, () => setPrice(price.min, price.max)]);
  document.querySelectorAll('.qp[aria-pressed="true"]').forEach(b =>
    chips.push([b.textContent.trim(), () => b.setAttribute('aria-pressed', 'false')]));
  FILTER_IDS.forEach(id => {
    const sel = document.getElementById(id);
    if (sel && sel.value) chips.push([sel.options[sel.selectedIndex].text.replace(/\s*\(\d+\)$/, ''), () => { sel.value = ''; }]);
  });
  _chipActions = chips.map(c => c[1]);
  box.hidden = !chips.length;
  box.innerHTML = chips.map(([label], i) =>
    `<button type="button" class="af-chip" data-i="${i}" aria-label="Remove filter ${esc(label)}">${esc(label)} <span aria-hidden="true">✕</span></button>`).join('') +
    (chips.length ? '<button type="button" class="af-clear">Clear all</button>' : '');
}

function applyFilters() {
  const f = getActiveFilters();
  const grid = document.getElementById('shop-grid');
  let visible = 0;
  const rank = new Map();

  _cards.forEach(card => {
    const r = cardMatches(card, f);
    card.hidden = !r;
    if (r) { visible++; rank.set(card, r); }
  });

  // Reorder DOM nodes for sort ('default' restores original build order; while
  // searching it puts name matches first, then note, then accord matches —
  // the sort is stable, so each group keeps build order).
  let order = _cards;
  if (f.search && f.sort === 'default') order = _cards.slice().sort((a, b) => (rank.get(b) || 0) - (rank.get(a) || 0));
  else if (f.sort === 'price-asc')  order = _cards.slice().sort((a, b) => (+a.dataset.price) - (+b.dataset.price));
  else if (f.sort === 'price-desc') order = _cards.slice().sort((a, b) => (+b.dataset.price) - (+a.dataset.price));
  else if (f.sort === 'name-asc')   order = _cards.slice().sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
  order.forEach(c => grid.appendChild(c));

  document.getElementById('no-results').style.display = visible === 0 ? 'block' : 'none';
  const label = `${visible} fragrance${visible !== 1 ? 's' : ''}`;
  document.getElementById('result-count').textContent = `${label} found`;

  // Phone sheet: live count on its footer button; the toggle shows how many
  // filters are on (search included — it lives inside the sheet).
  const apply = document.getElementById('filters-apply');
  if (apply) apply.textContent = `Show ${label}`;
  const active = FILTER_IDS.filter(filterValue).length + f.picks.length + (f.price ? 1 : 0) + (f.search ? 1 : 0);
  const reset = document.getElementById('price-reset');
  if (reset) reset.hidden = !f.price;
  document.querySelectorAll('#filter-toggle-btn, #filter-toggle-btn2').forEach(btn => {
    const badge = btn.querySelector('.fb-count');
    if (badge) { badge.textContent = active || ''; badge.hidden = !active; }
    else btn.textContent = '☰ Filters' + (active ? ` (${active})` : '');
  });
  FILTER_IDS.forEach(id => { const s = document.getElementById(id); if (s) s.classList.toggle('ff-on', !!s.value); });
  renderActiveFilters();
}

function clearFilters() {
  document.getElementById('search-input').value = '';
  FILTER_IDS.forEach(id => { const s = document.getElementById(id); if (s) s.value = ''; });
  document.querySelectorAll('.qp').forEach(b => b.setAttribute('aria-pressed', 'false'));
  setPrice(price.min, price.max);
  document.getElementById('sort-select').value = 'default';
  applyFilters();
}

function debounce(fn, wait) {
  let t = null;
  return function (...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}
const debouncedApplyFilters = debounce(applyFilters, 200);

// Mobile filter sheet: toggleSidebar() flips it, toggleSidebar(false) closes.
// The page behind it doesn't scroll while it's open.
function toggleSidebar(open) {
  const sidebar = document.getElementById('filters-sidebar');
  if (!sidebar) return;
  open = sidebar.classList.toggle('sidebar-open', open === undefined ? !sidebar.classList.contains('sidebar-open') : open);
  document.body.classList.toggle('filters-open', open);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.getElementById('filters-sidebar')?.classList.contains('sidebar-open')) toggleSidebar(false);
});

function init() {
  _cards = [...document.querySelectorAll('#shop-grid .product-card')];
  initPrice();

  // Honor ?q= from the header search / SEO SearchAction.
  const q = new URLSearchParams(location.search).get('q');
  if (q) document.getElementById('search-input').value = q;

  applyFilters();
  // Refresh live stock on the server-rendered cards, then re-filter. Scheduled
  // after paint because this is what pulls in supabase-js — it must not compete
  // with the LCP image. requestIdleCallback is an enhancement only, with a
  // timeout so reconciliation can't be starved on a busy browser.
  const hydrate = () => {
    if (typeof ProductAPI !== 'undefined') ProductAPI.hydrateCards().then(c => { if (c) applyFilters(); });
  };
  window.addEventListener('load', () => {
    if ('requestIdleCallback' in window) requestIdleCallback(hydrate, { timeout: 1500 });
    else setTimeout(hydrate, 0);
  });
}

// Listeners (elements exist in the static HTML)
document.getElementById('search-input').addEventListener('input', debouncedApplyFilters);
document.getElementById('sort-select').addEventListener('change', applyFilters);
FILTER_IDS.forEach(id => document.getElementById(id)?.addEventListener('change', applyFilters));
// Price: handles filter live while dragging; the boxes apply on change (blur /
// Enter), so typing "1" on the way to "1200" doesn't jump the grid.
document.getElementById('price-lo')?.addEventListener('input', e => {
  setPrice(Math.min(Number(e.target.value), price.hi), price.hi); applyFilters();
});
document.getElementById('price-hi')?.addEventListener('input', e => {
  setPrice(price.lo, Math.max(Number(e.target.value), price.lo)); applyFilters();
});
['price-min', 'price-max'].forEach(id => document.getElementById(id)?.addEventListener('change', () => {
  setPrice(Number(document.getElementById('price-min').value), Number(document.getElementById('price-max').value));
  applyFilters();
}));
document.getElementById('price-reset')?.addEventListener('click', () => { setPrice(price.min, price.max); applyFilters(); });

// Quick picks toggle; within a data-group (Summer/Winter) only one stays on.
document.querySelector('.quick-picks')?.addEventListener('click', e => {
  const btn = e.target.closest('.qp');
  if (!btn) return;
  const on = btn.getAttribute('aria-pressed') !== 'true';
  if (on && btn.dataset.group) {
    document.querySelectorAll(`.qp[data-group="${btn.dataset.group}"]`).forEach(b => b.setAttribute('aria-pressed', 'false'));
  }
  btn.setAttribute('aria-pressed', String(on));
  applyFilters();
});
document.getElementById('active-filters')?.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.classList.contains('af-clear')) return clearFilters();
  const act = _chipActions[Number(btn.dataset.i)];
  if (act) { act(); applyFilters(); }
});

init();
