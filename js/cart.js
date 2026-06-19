const CART_KEY = "nawme_cart";

function getCart() {
  return JSON.parse(localStorage.getItem(CART_KEY) || "[]");
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function addToCart(productId, ml, price, name, brand, isExclusive = false) {
  const cart = getCart();
  const key = `${productId}_${ml}`;
  const existing = cart.find(i => i.key === key);
  if (existing) {
    existing.qty += 1;
  } else {
    cart.push({ key, productId, ml: Number(ml), price: Number(price), name, brand, qty: 1, isExclusive });
  }
  saveCart(cart);
  showToast(`${name} (${ml}ml) added to cart!`);
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
    advanceNote = `Full advance required (includes exclusive items): \u09F3${total}`;
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
