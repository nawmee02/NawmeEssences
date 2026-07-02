let _shopProducts = [];

function renderCard(product, isExclusive = false) {
  const minPrice = Math.min(...product.sizes.map(s => s.price));
  const tags = product.tags.map(t => {
    const label = t === 'new' ? 'New' : t === 'restocked' ? 'Restocked' : t === 'limited' ? 'Limited' : t === 'discontinued' ? 'Discontinued' : t;
    return `<span class="tag tag-${t}">${label}</span>`;
  }).join('');
  const sizePills = product.sizes.map((s, i) => `<button class="size-pill${i === 0 ? ' active' : ''}" data-ml="${s.ml}" data-price="${s.price}" onclick="selectSize('${product.id}', this)">${s.ml}ml</button>`).join('');
  const oosOverlay = !product.inStock ? `<div class="oos-badge"><span>Out of Stock</span></div>` : '';
  const imgSrc = product.image_thumb || `images/products/${product.id}.jpg`;
  return `
    <div class="product-card${!product.inStock ? ' out-of-stock' : ''}" data-id="${product.id}">
      <div class="card-img">
        <img src="${imgSrc}" alt="${product.name}" loading="lazy" onerror="this.style.display='none'">
        <div class="card-img-placeholder">🫧</div>
        <div class="tag-badges">${tags}</div>
        ${oosOverlay}
      </div>
      <div class="card-body">
        <div class="card-brand">${product.brand}</div>
        <div class="card-name">${product.name}</div>
      </div>
      <div class="card-footer">
        <div class="size-pills" id="size-${product.id}">${sizePills}</div>
        <span class="card-price-live" id="price-${product.id}">৳${minPrice}</span>
        <button class="add-to-cart-btn" ${!product.inStock ? 'disabled' : ''} onclick="handleAdd('${product.id}', ${isExclusive})">
          ${product.inStock ? 'Add to Cart' : 'Out of Stock'}
        </button>
      </div>
      ${buildDetailsPanel(product.id)}
    </div>`;
}

function handleAdd(id, isExclusive) {
  const allProds = _shopProducts.length
    ? _shopProducts
    : [...regularProducts, ...exclusiveProducts, ...specialItems];
  const product = allProds.find(p => p.id === id);
  const activePill = document.querySelector('#size-' + id + ' .size-pill.active');
  const ml = activePill.dataset.ml;
  const price = activePill.dataset.price;
  addToCart(id, ml, price, product.name, product.brand, isExclusive);
}

function getActiveFilters() {
  const search = document.getElementById('search-input').value.trim().toLowerCase();
  const brands = [...document.querySelectorAll('.brand-filter:checked')].map(c => c.value);
  const sizes = [...document.querySelectorAll('.size-filter:checked')].map(c => Number(c.value));
  const tags = [...document.querySelectorAll('.tag-filter:checked')].map(c => c.value);
  const accords = [...document.querySelectorAll('.accord-filter:checked')].map(c => c.value);
  const inStockOnly = document.getElementById('instock-filter').checked;
  const sort = document.getElementById('sort-select').value;
  return { search, brands, sizes, tags, accords, inStockOnly, sort };
}

function applyFilters() {
  const { search, brands, sizes, tags, accords, inStockOnly, sort } = getActiveFilters();
  const grid = document.getElementById('shop-grid');
  const noResults = document.getElementById('no-results');
  const countEl = document.getElementById('result-count');

  let filtered = _shopProducts.filter(p => {
    if (search && !p.name.toLowerCase().includes(search) && !p.brand.toLowerCase().includes(search)) return false;
    if (brands.length && !brands.includes(p.brand)) return false;
    if (sizes.length && !sizes.every(ml => p.sizes.some(s => s.ml === ml))) return false;
    if (tags.length && !tags.some(t => p.tags.includes(t))) return false;
    if (accords.length) {
      const pd = productDetails[p.id];
      if (!pd || !accords.some(a => pd.accords.includes(a))) return false;
    }
    if (inStockOnly && !p.inStock) return false;
    return true;
  });

  if (sort === 'price-asc') filtered.sort((a, b) => Math.min(...a.sizes.map(s => s.price)) - Math.min(...b.sizes.map(s => s.price)));
  else if (sort === 'price-desc') filtered.sort((a, b) => Math.min(...b.sizes.map(s => s.price)) - Math.min(...a.sizes.map(s => s.price)));
  else if (sort === 'name-asc') filtered.sort((a, b) => a.name.localeCompare(b.name));

  grid.innerHTML = filtered.map(p => renderCard(p, false)).join('');
  noResults.style.display = filtered.length === 0 ? 'block' : 'none';
  countEl.textContent = `${filtered.length} fragrance${filtered.length !== 1 ? 's' : ''} found`;
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
  return function(...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

const debouncedApplyFilters = debounce(applyFilters, 200);

// Attach listeners
document.getElementById('search-input').addEventListener('input', debouncedApplyFilters);
document.querySelectorAll('.size-filter, .tag-filter').forEach(c => c.addEventListener('change', applyFilters));
document.getElementById('instock-filter').addEventListener('change', applyFilters);
document.getElementById('sort-select').addEventListener('change', applyFilters);
document.getElementById('brand-filters').addEventListener('change', applyFilters);
document.getElementById('accord-filters').addEventListener('change', applyFilters);

// Mobile sidebar toggle
function toggleSidebar() {
  const sidebar = document.getElementById('filters-sidebar');
  if (!sidebar) return;
  const open = sidebar.classList.toggle('sidebar-open');
  document.querySelectorAll('#filter-toggle-btn, #filter-toggle-btn2').forEach(btn => {
    if (btn) btn.textContent = open ? '✕ Close Filters' : '☰ Filters';
  });
}

async function init() {
  const grid = document.getElementById('shop-grid');
  grid.innerHTML = '<p style="padding:2rem;text-align:center;color:#888;">Loading fragrances…</p>';

  try {
    _shopProducts = await ProductAPI.getRegular();
  } catch (e) {
    console.warn('[api] Supabase fetch failed, falling back to local data:', e.message);
    _shopProducts = regularProducts;
  }

  // Build brand filters
  const shopBrands = [...new Set(_shopProducts.map(p => p.brand))].sort();
  const brandFilters = document.getElementById('brand-filters');
  if (brandFilters) {
    shopBrands.forEach(brand => {
      brandFilters.innerHTML += `<label><input type="checkbox" value="${brand}" class="brand-filter" /> ${brand}</label>`;
    });
  }

  // Build accord filters
  const accordFilters = document.getElementById('accord-filters');
  if (accordFilters) {
    const allAccords = [...new Set(
      _shopProducts.flatMap(p => (productDetails[p.id] && productDetails[p.id].accords) || [])
    )].sort();
    allAccords.forEach(accord => {
      accordFilters.innerHTML += `<label><input type="checkbox" value="${accord}" class="accord-filter" /> ${accord}</label>`;
    });
  }

  applyFilters();
}

init();
