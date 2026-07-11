// Cards are server-rendered into #shop-grid at build time. This script no longer
// builds cards — it filters/sorts the existing nodes in place (so product content
// is crawlable + paints without JS) and hydrates live stock after load.

let _cards = [];  // product-card nodes in their original (build) order

function handleAdd(id, isExclusive) {
  const card = document.querySelector('.product-card[data-id="' + id + '"]');
  const pill = document.querySelector('#size-' + id + ' .size-pill.active');
  if (!card || !pill) return;
  const name = card.querySelector('.card-name').textContent.trim();
  addToCart(id, pill.dataset.ml, pill.dataset.price, name, card.dataset.brand, isExclusive);
}

function getActiveFilters() {
  return {
    search: document.getElementById('search-input').value.trim().toLowerCase(),
    brands: [...document.querySelectorAll('.brand-filter:checked')].map(c => c.value),
    sizes: [...document.querySelectorAll('.size-filter:checked')].map(c => Number(c.value)),
    tags: [...document.querySelectorAll('.tag-filter:checked')].map(c => c.value),
    accords: [...document.querySelectorAll('.accord-filter:checked')].map(c => c.value),
    inStockOnly: document.getElementById('instock-filter').checked,
    sort: document.getElementById('sort-select').value,
  };
}

function cardMatches(card, f) {
  const d = card.dataset;
  if (f.search && !d.name.includes(f.search) && !d.brand.toLowerCase().includes(f.search)) return false;
  if (f.brands.length && !f.brands.includes(d.brand)) return false;
  if (f.sizes.length) {
    const ml = d.sizes.split(' ').map(Number);
    if (!f.sizes.every(s => ml.includes(s))) return false;
  }
  if (f.tags.length) {
    const tags = d.tags ? d.tags.split(' ') : [];
    if (!f.tags.some(t => tags.includes(t))) return false;
  }
  if (f.accords.length) {
    const accords = d.accords ? d.accords.split('|') : [];
    if (!f.accords.some(a => accords.includes(a))) return false;
  }
  if (f.inStockOnly && d.instock !== 'true') return false;
  return true;
}

function applyFilters() {
  const f = getActiveFilters();
  const grid = document.getElementById('shop-grid');
  let visible = 0;

  _cards.forEach(card => {
    const show = cardMatches(card, f);
    card.hidden = !show;
    if (show) visible++;
  });

  // Reorder DOM nodes for sort ('default' restores original build order).
  let order = _cards;
  if (f.sort === 'price-asc')  order = _cards.slice().sort((a, b) => (+a.dataset.price) - (+b.dataset.price));
  else if (f.sort === 'price-desc') order = _cards.slice().sort((a, b) => (+b.dataset.price) - (+a.dataset.price));
  else if (f.sort === 'name-asc')   order = _cards.slice().sort((a, b) => a.dataset.name.localeCompare(b.dataset.name));
  order.forEach(c => grid.appendChild(c));

  document.getElementById('no-results').style.display = visible === 0 ? 'block' : 'none';
  document.getElementById('result-count').textContent = `${visible} fragrance${visible !== 1 ? 's' : ''} found`;
}

function clearFilters() {
  document.getElementById('search-input').value = '';
  document.querySelectorAll('.brand-filter, .size-filter, .tag-filter, .accord-filter').forEach(c => c.checked = false);
  document.getElementById('instock-filter').checked = false;
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

// Mobile sidebar toggle
function toggleSidebar() {
  const sidebar = document.getElementById('filters-sidebar');
  if (!sidebar) return;
  const open = sidebar.classList.toggle('sidebar-open');
  document.querySelectorAll('#filter-toggle-btn, #filter-toggle-btn2').forEach(btn => {
    if (btn) btn.textContent = open ? '✕ Close Filters' : '☰ Filters';
  });
}

function init() {
  _cards = [...document.querySelectorAll('#shop-grid .product-card')];

  // Build brand + accord filter checkboxes from the rendered cards' data-* attributes.
  const brands = [...new Set(_cards.map(c => c.dataset.brand))].filter(Boolean).sort();
  const brandFilters = document.getElementById('brand-filters');
  if (brandFilters) brands.forEach(b => {
    brandFilters.innerHTML += `<label><input type="checkbox" value="${b}" class="brand-filter" /> ${b}</label>`;
  });

  const accords = [...new Set(_cards.flatMap(c => c.dataset.accords ? c.dataset.accords.split('|') : []))].filter(Boolean).sort();
  const accordFilters = document.getElementById('accord-filters');
  if (accordFilters) accords.forEach(a => {
    accordFilters.innerHTML += `<label><input type="checkbox" value="${a}" class="accord-filter" /> ${a}</label>`;
  });

  // Honor ?q= from the header search / SEO SearchAction.
  const q = new URLSearchParams(location.search).get('q');
  if (q) document.getElementById('search-input').value = q;

  applyFilters();
  // Deferred: refresh live stock on the server-rendered cards, then re-filter.
  if (typeof ProductAPI !== 'undefined') ProductAPI.hydrateCards().then(c => { if (c) applyFilters(); });
}

// Listeners (elements exist in the static HTML; checkbox changes bubble to the containers)
document.getElementById('search-input').addEventListener('input', debouncedApplyFilters);
document.querySelectorAll('.size-filter, .tag-filter').forEach(c => c.addEventListener('change', applyFilters));
document.getElementById('instock-filter').addEventListener('change', applyFilters);
document.getElementById('sort-select').addEventListener('change', applyFilters);
document.getElementById('brand-filters').addEventListener('change', applyFilters);
document.getElementById('accord-filters').addEventListener('change', applyFilters);

init();
