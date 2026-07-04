let _exclusiveProducts = [];
let _specialItems = [];

function renderCard(product, isExclusive = true) {
  const minPrice = Math.min(...product.sizes.map(s => s.price));
  const tags = product.tags.map(t => {
    const label = t === 'discontinued' ? 'Discontinued' : t === 'exclusive' ? 'Exclusive' : t;
    return `<span class="tag tag-${t}">${label}</span>`;
  }).join('');
  const sizePills = product.sizes.map((s, i) => `<button class="size-pill${i === 0 ? ' active' : ''}" data-ml="${s.ml}" data-price="${s.price}" onclick="selectSize('${product.id}', this)">${s.ml}ml</button>`).join('');
  const imgSrc = product.image_thumb || `images/products/${product.id}.jpg`;
  return `
    <div class="product-card" data-id="${product.id}">
      <a class="card-link" href="/product/${product.id}/">
        <div class="card-img">
          <img src="${imgSrc}" alt="${product.name}" loading="lazy" onerror="this.style.display='none'">
          <div class="card-img-placeholder">🫧</div>
          <div class="tag-badges">${tags}</div>
        </div>
        <div class="card-body">
          <div class="card-brand">${product.brand}</div>
          <div class="card-name">${product.name}</div>
        </div>
      </a>
      <div class="card-footer">
        <div class="size-pills" id="size-${product.id}">${sizePills}</div>
        <span class="card-price-live" id="price-${product.id}">৳${minPrice}</span>
        <button class="add-to-cart-btn" onclick="handleAdd('${product.id}', ${isExclusive})">Add to Cart</button>
      </div>
    </div>`;
}

function handleAdd(id, isExclusive) {
  const allProds = [..._exclusiveProducts, ..._specialItems].length
    ? [..._exclusiveProducts, ..._specialItems]
    : [...exclusiveProducts, ...specialItems];
  const product = allProds.find(p => p.id === id);
  const activePill = document.querySelector('#size-' + id + ' .size-pill.active');
  const ml = activePill.dataset.ml;
  const price = activePill.dataset.price;
  addToCart(id, ml, price, product.name, product.brand, isExclusive);
}

async function init() {
  try {
    _exclusiveProducts = await ProductAPI.getExclusive();
    _specialItems      = await ProductAPI.getSpecial();
  } catch (e) {
    console.warn('[api] Supabase fetch failed, falling back to local data:', e.message);
    _exclusiveProducts = exclusiveProducts;
    _specialItems      = specialItems;
  }

  const specialGrid   = document.getElementById('special-grid');
  const exclusiveGrid = document.getElementById('exclusive-grid');

  if (specialGrid)   _specialItems.forEach(p => { specialGrid.innerHTML += renderCard(p, true); });
  if (exclusiveGrid) _exclusiveProducts.forEach(p => { exclusiveGrid.innerHTML += renderCard(p, true); });
}

init();
