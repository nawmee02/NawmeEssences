const CART_KEY = "nawme_cart";

// ── UI sound (ultra-light Web Audio; no files, one shared context) ──────────
// A single lazily-created AudioContext (made on the first click — a user
// gesture, which browser autoplay policy requires) reused for every blip, so
// rapid clicks never exhaust the browser's context limit. Muted via the admin
// setting, mirrored to localStorage.sfx by js/settings.js (default on).
const Sfx = (() => {
  let ctx;
  const on = () => { try { return localStorage.getItem('sfx') !== '0'; } catch (e) { return true; } };
  function tone(freq, dur, vol, delay = 0) {
    if (!on()) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = ctx || new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      // Non-zero gain anchor right before the ramp so the exponential fade is
      // smooth on mobile (it misbehaves ramping from/through 0 or unanchored).
      g.gain.setValueAtTime(vol, t);
      g.gain.setValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + dur);
      // Disconnect after playback so the routing graph stays clean under rapid
      // clicks and the one-shot (non-reusable) nodes get garbage-collected.
      setTimeout(() => { try { osc.disconnect(); g.disconnect(); } catch (e) {} },
        (dur + delay) * 1000 + 100);
    } catch (e) { /* never break the UI */ }
  }
  return {
    tick() { tone(700, 0.05, 0.05); },                              // size switch
    add()  { tone(587, 0.06, 0.09); tone(880, 0.07, 0.09, 0.05); }, // add to cart
  };
})();
window.Sfx = Sfx;

function getCart() {
  return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(productId, ml, price, name, brand, isExclusive = false, sizes = null) {
  const cart = getCart();
  const key = `${productId}_${ml}`;
  const existing = cart.find(i => i.key === key);
  if (existing) {
    existing.qty += 1;
    // Backfill sizes on a pre-existing (or legacy) line so its size toggle works.
    if (sizes && !existing.sizes) existing.sizes = sizes;
  } else {
    // sizes: the product's full size list [{ml, price}] (effective prices), captured
    // so the cart can offer an in-place size switch without a network call.
    cart.push({ key, productId, ml: Number(ml), price: Number(price), name, brand, qty: 1, isExclusive, sizes: sizes || null });
  }
  saveCart(cart);
  showToast(`${name} (${ml}ml) added to cart!`);
  Sfx.add();
}

function removeFromCart(key) {
  const cart = getCart().filter(i => i.key !== key);
  saveCart(cart);
}

function updateQty(key, qty) {
  const cart = getCart();
  const item = cart.find(i => i.key === key);
  if (item) {
    item.qty = Number(qty);
    if (item.qty <= 0) return removeFromCart(key);
  }
  saveCart(cart);
}

function getCartTotal() {
  return getCart().reduce((sum, i) => sum + i.price * i.qty, 0);
}

function getCartCount() {
  return getCart().reduce((sum, i) => sum + i.qty, 0);
}

function hasExclusiveItem() {
  return getCart().some(i => i.isExclusive);
}

// Sum of exclusive items' line totals. Mandatory advance when the cart has
// exclusive items = this + delivery (not full-order advance).
function exclusiveSubtotal() {
  return getCart().filter(i => i.isExclusive).reduce((s, i) => s + i.price * i.qty, 0);
}

function updateCartBadge() {
  const count = getCartCount();
  document.querySelectorAll(".cart-count").forEach(el => {
    el.textContent = count;
    el.style.display = count > 0 ? "inline-flex" : "none";
  });
}

function buildWhatsAppMessage(deliveryZone, buyerName, buyerPhone, buyerAddress) {
  const cart = getCart();
  const deliveryCharge = deliveryZone === "dhaka" ? 70 : deliveryZone === "suburb" ? 90 : 120;
  const zoneLabel = deliveryZone === "dhaka" ? "Within Dhaka" : deliveryZone === "suburb" ? "Dhaka Suburb" : "Outside Dhaka";
  const subtotal = getCartTotal();
  const total = subtotal + deliveryCharge;

  let hasExclusive = hasExclusiveItem();
  let advanceNote = "";
  if (hasExclusive) {
    const exTotal = exclusiveSubtotal();
    advanceNote = `Advance required: \u09F3${exTotal + deliveryCharge} (exclusive items \u09F3${exTotal} + delivery \u09F3${deliveryCharge})`;
  } else if (total > 2000) {
    advanceNote = `30% advance required: \u09F3${Math.ceil(total * 0.3)}`;
  } else {
    advanceNote = `Min. advance (delivery charge): \u09F3${deliveryCharge}`;
  }

  let lines = ["Hi! I want to order from NawmeEssences:", ""];
  cart.forEach((item, i) => {
    lines.push(`${i + 1}. ${item.name} - ${item.ml}ml x${item.qty} \u2014 \u09F3${item.price * item.qty}`);
  });
  lines.push("");
  lines.push(`Subtotal: \u09F3${subtotal}`);
  lines.push(`Delivery (${zoneLabel}): \u09F3${deliveryCharge}`);
  lines.push(`Total: \u09F3${total}`);
  lines.push(advanceNote);
  lines.push("", "Buyer Details:");
  lines.push(`Name: ${buyerName || ""}`);
  lines.push(`Phone: ${buyerPhone || ""}`);
  if (buyerAddress) lines.push(`Address: ${buyerAddress}`);
  else lines.push(`Address: `);
  return lines.join("\n");
}

function showToast(message) {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 2800);
}

// -------------------------------
// Last-order session helpers
// -------------------------------
function saveLastOrderToSession(orderObj) {
  try {
    sessionStorage.setItem('nawme_last_order', JSON.stringify(orderObj));
  } catch (e) {
    // ignore sessionStorage errors
  }
}

function getLastOrderFromSession() {
  try {
    const raw = sessionStorage.getItem('nawme_last_order');
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}
