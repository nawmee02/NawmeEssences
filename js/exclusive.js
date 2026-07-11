// The Special + Exclusive grids are server-rendered at build time. This script
// only wires add-to-cart (reading the DOM) and hydrates live stock after load.

function handleAdd(id, isExclusive) {
  const card = document.querySelector('.product-card[data-id="' + id + '"]');
  const pill = document.querySelector('#size-' + id + ' .size-pill.active');
  if (!card || !pill) return;
  const name = card.querySelector('.card-name').textContent.trim();
  addToCart(id, pill.dataset.ml, pill.dataset.price, name, card.dataset.brand, isExclusive);
}

if (typeof ProductAPI !== 'undefined') ProductAPI.hydrateCards();
