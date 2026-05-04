function renderCard(product, isExclusive = true) {
  const minPrice = Math.min(...product.sizes.map(s => s.price));
  const tags = product.tags.map(t => {
    const label = t === 'discontinued' ? 'Discontinued' : t === 'exclusive' ? 'Exclusive' : t;
    return `<span class="tag tag-${t}">${label}</span>`;
  }).join('');
  const sizeOptions = product.sizes.map(s => `<option value="${s.ml}" data-price="${s.price}">${s.ml}ml — ৳${s.price}</option>`).join('');
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
        <div class="card-from">from <strong>৳${minPrice}</strong></div>
      </div>
      <div class="card-footer">
        <select class="size-select" id="size-${product.id}">${sizeOptions}</select>
        <button class="add-to-cart-btn" onclick="handleAdd('${product.id}', ${isExclusive})">Add to Cart</button>
      </div>
      ${buildDetailsPanel(product.id)}
    </div>`;
}

function handleAdd(id, isExclusive) {
  const allProds = [...exclusiveProducts, ...specialItems];
  const product = allProds.find(p => p.id === id);
  const sel = document.getElementById('size-' + id);
  const ml = sel.value;
  const price = sel.options[sel.selectedIndex].dataset.price;
  addToCart(id, ml, price, product.name, product.brand, isExclusive);
}

// Render special items (YSL sample)
const specialGrid = document.getElementById('special-grid');
specialItems.forEach(p => { specialGrid.innerHTML += renderCard(p, true); });

// Render exclusive products
const exclusiveGrid = document.getElementById('exclusive-grid');
exclusiveProducts.forEach(p => { exclusiveGrid.innerHTML += renderCard(p, true); });
