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

// opts.silent: skip the per-item toast + sound (a caller adding several lines
// at once — e.g. the homepage quiz's "Try all 3" — confirms once itself).
function addToCart(productId, ml, price, name, brand, isExclusive = false, sizes = null, opts = {}) {
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
  // Every add (cards, product page, Buy Now, quiz, finder, agents) passes here.
  if (typeof NawmeTrack !== 'undefined') NawmeTrack.addToCart(productId, Number(ml), Number(price), name, brand, 1);
  if (opts && opts.silent) return;
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

// ============================================================
//  Analytics & consent — GTM-KKCJCDTZ (GA4, Google Ads, Meta Pixel)
//  The <head> snippet (scripts/lib/analytics.js) already set up dataLayer,
//  the Consent Mode v2 defaults and any stored choice; it loads nothing.
//  This part:
//   • loads GTM late — on the first scroll, after a tap/key's own frame,
//     or ~5 s after load when idle — never on the critical path;
//   • resolves consent before GTM loads (Cloudflare country + the live
//     site_settings policy): granted regions get no banner, everyone else
//     is denied until they accept the banner;
//   • pushes GA4-shaped ecommerce events (window.NawmeTrack) and keeps
//     events from a page that unloads before GTM loaded in a session
//     outbox that the next page replays.
//  Admin never loads this file; pages without the snippet load no tags.
// ============================================================
const NawmeTrack = (() => {
  const w = window, d = document;
  const cfg = w.__nawmeTags || null;
  const dl = (w.dataLayer = w.dataLayer || []);
  const gtag = function () { (w.gtag || function () { dl.push(arguments); }).apply(null, arguments); };
  const store = s => ({
    get(k) { try { return JSON.parse(s().getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { s().setItem(k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { s().removeItem(k); } catch (e) {} },
  });
  const ss = store(() => w.sessionStorage), ls = store(() => w.localStorage);
  const FALLBACK_MS = 5000;        // no interaction: load tags this long after `load` (then idle)
  const CONSENT_WAIT_MS = 1500;    // cap on waiting for the country / live settings
  const state = { started: false, loaded: false, pending: [], checkout: false, cc: null, policy: null, choice: null, returnFocus: null };
  let seq = 0;

  // ── dataLayer ────────────────────────────────────────────────
  function push(event, params) {
    const payload = Object.assign({ event, event_id: Date.now().toString(36) + '-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8) }, params || {});
    if (payload.ecommerce) dl.push({ ecommerce: null });           // GA4: clear the previous ecommerce object
    dl.push(payload);
    if (!state.loaded) state.pending.push(payload);
    return payload;
  }
  function item(id, name, brand, ml, price, qty) {
    const it = { item_id: String(id), item_name: name || String(id), item_brand: brand || '', price: Number(price) || 0, quantity: Number(qty) || 1 };
    if (ml) it.item_variant = Number(ml) + 'ml';
    return it;
  }
  const itemsFrom = lines => (lines || []).map(l => item(l.productId, l.name, l.brand, l.ml, l.price, l.qty));
  const total = items => items.reduce((s, i) => s + i.price * i.quantity, 0);

  function viewItem(id, name, brand, ml, price) {
    const it = item(id, name, brand, ml, price, 1);
    return push('view_item', { ecommerce: { currency: 'BDT', value: it.price, items: [it] } });
  }
  function addToCart(id, ml, price, name, brand, qty) {
    const it = item(id, name, brand, ml, price, qty);
    return push('add_to_cart', { ecommerce: { currency: 'BDT', value: it.price * it.quantity, items: [it] } });
  }
  function beginCheckout(lines) {                                    // once per page view
    const items = itemsFrom(lines);
    if (state.checkout || !items.length) return null;
    state.checkout = true;
    return push('begin_checkout', { ecommerce: { currency: 'BDT', value: total(items), items } });
  }
  // A submitted form is not a purchase: report it only once Supabase confirms
  // the order row ({ok, order_id} from saveOrderToSupabase). This waits on the
  // save promise itself, not the checkout's 4 s UI race, so a slow save still
  // reports once confirmed and a failed one never does (order_save_failed
  // instead, GA4 only, no buyer data). snap = cart lines + totals at the click.
  function purchase(orderId, snap) {
    const done = ss.get('nawme_tx') || [];
    if (!orderId || done.indexOf(orderId) !== -1) return null;
    ss.set('nawme_tx', done.concat(orderId).slice(-20));
    const items = itemsFrom(snap.items);
    return push('purchase', {
      order_channel: snap.channel,
      ecommerce: { transaction_id: String(orderId), currency: 'BDT', value: Number(snap.subtotal) || total(items), shipping: Number(snap.delivery) || 0, items },
    });
  }
  function errorKind(res) {
    const e = String((res && res.error) || '');
    return /timeout/i.test(e) ? 'timeout' : /network|fetch|failed to/i.test(e) ? 'network' : e ? 'server' : 'unknown';
  }
  function trackOrder(savePromise, snap) {
    const failed = kind => { push('order_save_failed', { order_channel: snap.channel, error_kind: kind }); return null; };
    return Promise.resolve(savePromise).then(
      res => (res && res.ok && res.order_id ? purchase(res.order_id, snap) : failed(errorKind(res))),
      () => failed('exception'));
  }
  function search(term) {
    const t = String(term || '').trim().slice(0, 100);
    return t ? push('search', { search_term: t }) : null;
  }

  // Quiz events (js/quiz.js dispatches `nawme:track`) go to dataLayer as-is.
  w.addEventListener('nawme:track', e => {
    const detail = Object.assign({}, (e && e.detail) || {});
    const name = detail.event; delete detail.event;
    if (name) push(String(name), detail);
  });

  // ── outbox: events from a page that unloads before GTM loaded ──
  function flushOutbox() {
    const box = ss.get('nawme_outbox');
    if (!box || !box.length) return;
    ss.del('nawme_outbox');
    box.forEach(p => {
      if (p.ecommerce) dl.push({ ecommerce: null });
      const r = Object.assign({}, p, { replayed: true });
      dl.push(r);
      if (!state.loaded) state.pending.push(r);
    });
  }
  w.addEventListener('pagehide', () => {
    if (state.loaded || !state.pending.length) return;
    ss.set('nawme_outbox', (ss.get('nawme_outbox') || []).concat(state.pending).slice(-30));
    state.pending = [];
  });

  // ── consent ──────────────────────────────────────────────────
  // Live site_settings.consent wins over the baked policy, so an admin change
  // (e.g. a banner for Bangladesh too) applies on the next page view.
  function livePolicy() {
    const base = { grantedRegions: (cfg && cfg.regions) || [], version: (cfg && cfg.v) || 1 };
    const s = w.__SETTINGS__ && w.__SETTINGS__.consent;
    if (!s || !Array.isArray(s.grantedRegions)) return base;
    return {
      grantedRegions: s.grantedRegions.map(r => String(r).trim().toUpperCase()),
      version: Number.isInteger(s.version) && s.version > 0 ? s.version : base.version,
    };
  }
  const within = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms))]);
  const settingsReady = () => (w.__SETTINGS__ ? Promise.resolve() : new Promise(r => w.addEventListener('settings:loaded', () => r(), { once: true })));
  // Country from Cloudflare (same origin, ~200 B, edge-served). A failed lookup
  // counts as "not a granted region" (the cautious default) and is not cached.
  function country() {
    const c = ss.get('nawme_cc');
    if (c) return Promise.resolve(c);
    return fetch('/cdn-cgi/trace', { credentials: 'omit', cache: 'no-store' })
      .then(r => (r.ok ? r.text() : ''))
      .then(t => { const m = /^loc=([A-Z]{2})$/m.exec(t || ''); if (m) ss.set('nawme_cc', m[1]); return m ? m[1] : 'XX'; })
      .catch(() => 'XX');
  }
  // A choice is per category: analytics (analytics_storage) and ads (ad_storage,
  // ad_user_data, ad_personalization). Older {granted} entries read as both.
  const asChoice = k => ({
    analytics: k.analytics != null ? !!k.analytics : !!k.granted,
    ads: k.ads != null ? !!k.ads : !!k.granted,
  });
  const consentFor = c => {
    const ads = c.ads ? 'granted' : 'denied';
    return { ad_storage: ads, ad_user_data: ads, ad_personalization: ads, analytics_storage: c.analytics ? 'granted' : 'denied' };
  };
  // A stored choice counts while its version matches the policy. In a granted
  // region (no banner there to ask again) a choice survives a version bump, so
  // "Ask everyone again" can never silently re-grant someone who opted out.
  function storedChoice(policy, inGranted) {
    const k = ls.get('nawme_consent');
    return k && (k.v === policy.version || inGranted) ? asChoice(k) : null;
  }
  function resolveConsent() {
    return Promise.all([country(), within(settingsReady(), CONSENT_WAIT_MS)]).then(([cc]) => {
      const policy = livePolicy();
      const inGranted = policy.grantedRegions.indexOf(cc) !== -1;
      state.cc = cc; state.policy = policy;
      const chosen = storedChoice(policy, inGranted);
      if (chosen) { state.choice = chosen; gtag('consent', 'update', consentFor(chosen)); return; }
      state.choice = { analytics: inGranted, ads: inGranted };
      gtag('consent', 'update', consentFor(state.choice));
      if (!inGranted) showBanner(false);
    });
  }
  // c = {analytics, ads}; `true` / `false` mean all / none (kept for callers and tests).
  function choose(c) {
    const choice = typeof c === 'boolean' ? { analytics: c, ads: c } : { analytics: !!(c && c.analytics), ads: !!(c && c.ads) };
    const policy = state.policy || livePolicy();
    state.choice = choice;
    ls.set('nawme_consent', { v: policy.version, analytics: choice.analytics, ads: choice.ads, ts: Date.now() });
    gtag('consent', 'update', consentFor(choice));
    dl.push({ event: 'consent_update', consent_analytics: choice.analytics, consent_ads: choice.ads });
    const bar = d.getElementById('consent-bar');
    if (bar) bar.remove();
    if (state.returnFocus && state.returnFocus.focus) { try { state.returnFocus.focus(); } catch (e) {} }
    state.returnFocus = null;
  }
  const COOKIE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 3a9 9 0 1 0 9 9 3 3 0 0 1-3.6-3.3A3 3 0 0 1 14 5.4 3 3 0 0 1 12 3z"/>'
    + '<circle cx="8.5" cy="10.5" r=".9" fill="currentColor"/><circle cx="10.5" cy="15.5" r=".9" fill="currentColor"/><circle cx="15.5" cy="14.5" r=".9" fill="currentColor"/></svg>';
  const OPT = (cat, title, text) => '<label class="consent-opt"><span class="consent-opt-text"><strong>' + title + '</strong><small>' + text + '</small></span>'
    + '<input type="checkbox" class="consent-switch"' + (cat ? ' data-cat="' + cat + '"' : ' checked disabled') + ' aria-label="' + title + '"></label>';
  function showBanner(focus) {
    let bar = d.getElementById('consent-bar');
    if (!bar) {
      bar = d.createElement('div');
      bar.id = 'consent-bar';
      bar.className = 'consent-bar';
      bar.setAttribute('role', 'dialog');
      bar.setAttribute('aria-labelledby', 'consent-title');
      bar.setAttribute('aria-describedby', 'consent-desc');
      bar.innerHTML = '<div class="consent-card">'
        + '<div class="consent-head"><span class="consent-icon">' + COOKIE_ICON + '</span>'
        + '<h2 class="consent-title" id="consent-title">Your privacy matters</h2>'
        + '<button type="button" class="consent-prefs-btn" data-consent="prefs" aria-expanded="false" aria-controls="consent-prefs">Cookie preferences</button></div>'
        + '<p class="consent-desc" id="consent-desc">We use cookies to understand how visitors use NawmeEssences and improve your shopping experience. You can choose which optional cookies to allow.</p>'
        + '<p class="consent-small">Read our <a href="/about.html#privacy">Privacy Policy</a> to learn more.</p>'
        + '<div class="consent-prefs" id="consent-prefs" hidden>'
        + OPT('', 'Essential', 'Your cart, theme and these choices. Always on.')
        + OPT('analytics', 'Analytics', 'Helps us see which pages and products are useful.')
        + OPT('ads', 'Advertising', 'Measures our ads and shows you relevant offers.')
        + '</div>'
        + '<div class="consent-actions">'
        + '<button type="button" class="consent-btn consent-btn--ghost" data-consent="reject">Reject optional</button>'
        + '<button type="button" class="consent-btn consent-btn--primary" data-consent="accept">Accept all</button>'
        + '<button type="button" class="consent-btn consent-btn--primary" data-consent="save" hidden>Save preferences</button>'
        + '</div></div>';
      bar.addEventListener('click', e => {
        const b = e.target.closest('[data-consent]');
        if (!b) return;
        const act = b.getAttribute('data-consent');
        if (act === 'accept') choose(true);
        else if (act === 'reject') choose(false);
        else if (act === 'save') choose({ analytics: bar.querySelector('[data-cat="analytics"]').checked, ads: bar.querySelector('[data-cat="ads"]').checked });
        else if (act === 'prefs') {
          const panel = bar.querySelector('.consent-prefs'), open = panel.hidden;
          panel.hidden = !open;
          b.setAttribute('aria-expanded', String(open));
          bar.querySelector('[data-consent="accept"]').hidden = open;
          bar.querySelector('[data-consent="save"]').hidden = !open;
          if (open) { const cur = state.choice || { analytics: false, ads: false }; bar.querySelector('[data-cat="analytics"]').checked = !!cur.analytics; bar.querySelector('[data-cat="ads"]').checked = !!cur.ads; }
        }
      });
      bar.addEventListener('keydown', e => { if (e.key === 'Escape' && state.returnFocus) { bar.remove(); state.returnFocus.focus(); state.returnFocus = null; } });
      d.body.appendChild(bar);
    }
    if (focus) { const b = bar.querySelector('.consent-btn'); if (b) b.focus(); }
  }
  // Footer "Cookie Settings" (data-cookie-settings) reopens the choice; without
  // JS the link simply goes to the privacy section.
  d.addEventListener('click', e => {
    const a = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (!a) return;
    e.preventDefault();
    if (!state.policy) state.policy = livePolicy();
    state.returnFocus = a;
    showBanner(true);
  });

  // ── deferred tag loader ──────────────────────────────────────
  const idle = (fn, timeout) => (w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: timeout || 2000 }) : setTimeout(fn, 1));
  // Run after the current interaction has painted, so a tap's own response is
  // never delayed by tag code.
  function afterFrame(fn) {
    if (w.scheduler && typeof w.scheduler.postTask === 'function') { w.scheduler.postTask(fn, { priority: 'background' }).catch(() => {}); return; }
    requestAnimationFrame(() => setTimeout(fn, 0));
  }
  function injectGtm() {
    if (!cfg || state.loaded || d.getElementById('nawme-gtm')) return;
    dl.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const j = d.createElement('script');
    j.id = 'nawme-gtm';
    j.async = true;
    j.fetchPriority = 'low';
    j.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(cfg.gtm);
    // GTM processes the whole dataLayer (queued events included) as it starts,
    // so the outbox is no longer needed once it has loaded. Stage-2 tags (Meta)
    // wait for nawme_idle so their scripts parse in a separate idle period.
    j.onload = () => { state.loaded = true; state.pending = []; idle(() => dl.push({ event: 'nawme_idle' }), 3000); };
    d.head.appendChild(j);
  }
  function start() {
    if (state.started || !cfg) return;
    state.started = true;
    w.removeEventListener('scroll', onScroll);
    w.removeEventListener('pointerdown', onTap);
    w.removeEventListener('keydown', onTap);
    within(resolveConsent(), CONSENT_WAIT_MS + 500).catch(() => {}).then(injectGtm);
  }
  // gtm.js evaluates as one ~250–300 ms task on a mid-range phone (it can't be
  // split), so it is started in an idle period after the trigger rather than at
  // once — keeping that task away from the taps that usually follow.
  const onScroll = () => idle(start, 2500);     // scrolling is not an INP interaction
  const onTap = () => afterFrame(() => idle(start, 2500));
  if (cfg) {
    flushOutbox();
    w.addEventListener('scroll', onScroll, { passive: true });
    w.addEventListener('pointerdown', onTap, { passive: true });
    w.addEventListener('keydown', onTap);
    const fallback = () => setTimeout(() => idle(start, 2000), FALLBACK_MS);
    if (d.readyState === 'complete') fallback(); else w.addEventListener('load', fallback, { once: true });
  }

  return { push, item, viewItem, addToCart, beginCheckout, purchase, trackOrder, search, start, showBanner, choose, _state: state };
})();
window.NawmeTrack = NawmeTrack;
