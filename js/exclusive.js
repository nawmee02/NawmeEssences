function renderCard(product, isExclusive = true) {
  const minPrice = Math.min(...product.sizes.map(s => s.price));
  const tags = product.tags.map(t => {
    const label = t === 'discontinued' ? 'Discontinued' : t === 'exclusive' ? 'Exclusive' : t;
    return `<span class="tag tag-${t}">${label}</span>`;
  }).join('');
  const sizePills = product.sizes.map((s, i) => `<button class="size-pill${i === 0 ? ' active' : ''}" data-ml="${s.ml}" data-price="${s.price}" onclick="selectSize('${product.id}', this)">${s.ml}ml</button>`).join('');
  return `
    <div class="product-card" data-id="${product.id}">
      <div class="card-img">
        <img src="images/products/${product.id}.jpg" alt="${product.name}" loading="lazy" onerror="this.style.display='none'">
        <div class="card-img-placeholder">🫧</div>
        <div class="tag-badges">${tags}</div>
      </div>
      <div class="card-body">
        <div class="card-brand">${product.brand}</div>
        <div class="card-name">${product.name}</div>
      </div>
      <div class="card-footer">
        <div class="size-pills" id="size-${product.id}">${sizePills}</div>
        <span class="card-price-live" id="price-${product.id}">৳${minPrice}</span>
        <button class="add-to-cart-btn" onclick="handleAdd('${product.id}', ${isExclusive})">Add to Cart</button>
      </div>
      ${buildDetailsPanel(product.id)}
    </div>`;
}

function handleAdd(id, isExclusive) {
  const allProds = [...exclusiveProducts, ...specialItems];
  const product = allProds.find(p => p.id === id);
  const activePill = document.querySelector('#size-' + id + ' .size-pill.active');
  const ml = activePill.dataset.ml;
  const price = activePill.dataset.price;
  addToCart(id, ml, price, product.name, product.brand, isExclusive);
}

// Render special items (YSL sample)
const specialGrid = document.getElementById('special-grid');
specialItems.forEach(p => { specialGrid.innerHTML += renderCard(p, true); });

// Render exclusive products
const exclusiveGrid = document.getElementById('exclusive-grid');
exclusiveProducts.forEach(p => { exclusiveGrid.innerHTML += renderCard(p, true); });
