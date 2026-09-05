// The Special + Exclusive grids are server-rendered at build time. This script
// only wires add-to-cart (reading the DOM) and hydrates live stock after load.

function handleAdd(id, isExclusive) {
  const card = document.querySelector('.product-card[data-id="' + id + '"]');
  const pill = document.querySelector('#size-' + id + ' .size-pill.active');
  if (!card || !pill) return;
  const name = card.querySelector('.card-name').textContent.trim();
  const sizes = [...document.querySelectorAll('#size-' + id + ' .size-pill')].map(b => ({ ml: Number(b.dataset.ml), price: Number(b.dataset.price) }));
  addToCart(id, pill.dataset.ml, pill.dataset.price, name, card.dataset.brand, isExclusive, sizes);
}

// Scheduled after paint — this is what pulls in supabase-js, so it must not
// compete with the LCP image. requestIdleCallback is an enhancement only, with
// a timeout so reconciliation can't be starved on a busy browser.
window.addEventListener('load', () => {
  const hydrate = () => { if (typeof ProductAPI !== 'undefined') ProductAPI.hydrateCards(); };
  if ('requestIdleCallback' in window) requestIdleCallback(hydrate, { timeout: 1500 });
  else setTimeout(hydrate, 0);
});
