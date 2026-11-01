// Checks for analytics & consent: the <head> snippet (scripts/lib/analytics.js)
// and the tracking module in js/cart.js, run together in a small fake browser
// (node:vm, no DOM library), plus the built pages. Plain assert, no framework;
// runs inside `npm run build` so a regression fails the deploy.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');
const analytics = require('./lib/analytics');

const ROOT = path.join(__dirname, '..');
const CART_JS = fs.readFileSync(path.join(ROOT, 'js', 'cart.js'), 'utf8');

// ── a minimal fake browser ────────────────────────────────────
function storage(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}
function makeEnv(opts = {}) {
  const els = {}, winL = {}, docL = {};
  function el(tag) {
    const e = {
      tagName: tag, attrs: {}, children: [], style: {}, classList: { add() {}, remove() {} }, dataset: {},
      setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; },
      addEventListener(t, f) { (this._l = this._l || {})[t] = f; },
      appendChild(c) { this.children.push(c); return c; },
      remove() { if (this._id) delete els[this._id]; this.removed = true; },
      querySelector() { return { focus() { e.focused = true; } }; },
    };
    Object.defineProperty(e, 'id', { get() { return this._id; }, set(v) { this._id = v; els[v] = this; } });
    return e;
  }
  const document = {
    readyState: 'loading', body: el('body'), head: el('head'),
    createElement: el, getElementById: id => els[id] || null, querySelectorAll: () => [],
    addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); },
  };
  const window = {
    __SETTINGS__: opts.settings || {},     // js/settings.js has loaded (no consent override)
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
    removeEventListener() {},
    dispatchEvent(e) { (winL[e.type] || []).forEach(f => f(e)); return true; },
    requestIdleCallback: fn => setTimeout(fn, 0),
  };
  const session = opts.session || storage(), local = opts.local || storage();
  window.sessionStorage = session; window.localStorage = local;
  const fetchCalls = [];
  const fetch = url => {
    fetchCalls.push(url);
    if (opts.trace === 'fail') return Promise.reject(new Error('network'));
    return Promise.resolve({ ok: true, text: () => Promise.resolve('fl=1\nloc=' + (opts.trace || 'BD') + '\ntls=TLSv1.3\n') });
  };
  class CustomEvent { constructor(type, o) { this.type = type; this.detail = o && o.detail; } }
  const ctx = vm.createContext({
    window, document, localStorage: local, sessionStorage: session, fetch, CustomEvent,
    setTimeout, clearTimeout, console, requestAnimationFrame: fn => setTimeout(fn, 0),
  });
  if (opts.snippet !== false) {
    const html = analytics.headSnippet();
    vm.runInContext(html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>')), ctx);
  }
  vm.runInContext(CART_JS, ctx);
  return { ctx, window, document, els, winL, docL, session, local, fetchCalls, T: window.NawmeTrack, dl: window.dataLayer };
}
// Array.from: sandbox arrays belong to another realm (deepStrictEqual would differ).
const events = dl => Array.from(dl).filter(x => x && typeof x.event === 'string' && !x.event.startsWith('gtm.'));
const consentCalls = dl => Array.from(dl).filter(x => x && x[0] === 'consent').map(x => [x[1], x[2]]);
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ── 1. head snippet ─────────────────────────────────────────
  analytics.setPolicy({ grantedRegions: ['bd', 'xx1', ' gb '], version: 3 });
  assert.deepStrictEqual(analytics.getPolicy(), { grantedRegions: ['BD', 'GB'], version: 3 }, 'policy sanitised');
  analytics.setPolicy({ grantedRegions: ['BD'], version: 1 });
  const snip = analytics.headSnippet();
  assert.ok(zlib.gzipSync(snip).length <= 1536, 'head snippet ≤ 1.5 KB gzip');
  assert.ok(!/googletagmanager|<noscript/.test(snip), 'the snippet itself loads nothing');
  {
    const { dl } = makeEnv({ snippet: true, trace: 'BD' });
    const c = consentCalls(dl);
    assert.strictEqual(c[0][0], 'default'); assert.strictEqual(c[0][1].ad_storage, 'denied'); assert.strictEqual(c[0][1].region, undefined, 'global default is denied');
    assert.strictEqual(c[1][0], 'default'); assert.strictEqual(c[1][1].ad_storage, 'granted'); assert.deepStrictEqual([...c[1][1].region], ['BD'], 'region-specific grant');
    assert.strictEqual(c.length, 2, 'no update without a stored choice');
  }
  {
    const local = storage({ nawme_consent: JSON.stringify({ v: 1, granted: false }) });
    const c = consentCalls(makeEnv({ local }).dl);
    assert.deepStrictEqual([c[2][0], c[2][1].ad_storage, c[2][1].analytics_storage], ['update', 'denied', 'denied'], 'stored choice re-applied at once');
    const split = consentCalls(makeEnv({ local: storage({ nawme_consent: JSON.stringify({ v: 1, analytics: true, ads: false }) }) }).dl);
    assert.deepStrictEqual([split[2][1].analytics_storage, split[2][1].ad_storage], ['granted', 'denied'], 'per-category stored choice re-applied at once');
    const stale = consentCalls(makeEnv({ local: storage({ nawme_consent: JSON.stringify({ v: 0, granted: true }) }) }).dl);
    assert.strictEqual(stale.length, 2, 'a stale-version choice is not re-applied by the snippet');
  }

  // ── 2. ecommerce events ─────────────────────────────────────
  {
    const { T, dl, ctx } = makeEnv();
    vm.runInContext("addToCart('afnan-9pm', '5', '240', 'Afnan 9PM', 'Afnan', false, null, { silent: true })", ctx);
    const ev = events(dl);
    const add = ev.find(e => e.event === 'add_to_cart');
    assert.ok(add, 'addToCart pushes add_to_cart (silent adds included)');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(add.ecommerce)), { currency: 'BDT', value: 240, items: [{ item_id: 'afnan-9pm', item_name: 'Afnan 9PM', item_brand: 'Afnan', price: 240, quantity: 1, item_variant: '5ml' }] });
    const i = dl.indexOf(add);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(dl[i - 1])), { ecommerce: null }, 'ecommerce cleared before each push');
    assert.ok(add.event_id && typeof add.event_id === 'string', 'event_id for de-duplication');
    T.viewItem('x', 'X', 'B', 3, 150);
    assert.strictEqual(events(dl).filter(e => e.event === 'view_item').length, 1);
    const lines = [{ productId: 'a', name: 'A', brand: 'B', ml: 3, price: 150, qty: 2 }, { productId: 'b', name: 'B', brand: 'C', ml: 10, price: 500, qty: 1 }];
    const bc = T.beginCheckout(lines);
    assert.strictEqual(bc.ecommerce.value, 800, 'begin_checkout value = cart subtotal (price × qty)');
    assert.strictEqual(T.beginCheckout(lines), null, 'begin_checkout once per page view');
    T.search('  oud  '); T.search('   ');
    assert.deepStrictEqual(events(dl).filter(e => e.event === 'search').map(e => e.search_term), ['oud']);
    // quiz bridge
    vm.runInContext("window.dispatchEvent(new CustomEvent('nawme:track', { detail: { event: 'scent_match_complete', status: 'ok', count: 3 } }))", ctx);
    const q = events(dl).find(e => e.event === 'scent_match_complete');
    assert.ok(q && q.status === 'ok' && q.count === 3, 'quiz nawme:track bridged to dataLayer with its fields');
  }

  // ── 3. purchase only after a confirmed save ─────────────────
  {
    const { T, dl } = makeEnv();
    const snap = { channel: 'whatsapp', items: [{ productId: 'a', name: 'A', brand: 'B', ml: 3, price: 150, qty: 2 }], subtotal: 300, delivery: 70 };
    let resolveSave; const slow = new Promise(r => { resolveSave = r; });
    const tracked = T.trackOrder(slow, snap);
    await tick();
    assert.strictEqual(events(dl).filter(e => e.event === 'purchase').length, 0, 'nothing before the save confirms');
    resolveSave({ ok: true, order_id: 'ord-1' }); await tracked;
    const p = events(dl).filter(e => e.event === 'purchase');
    assert.strictEqual(p.length, 1, 'purchase once confirmed (even after the 4 s UI race)');
    assert.deepStrictEqual([p[0].ecommerce.transaction_id, p[0].ecommerce.value, p[0].ecommerce.shipping, p[0].ecommerce.currency], ['ord-1', 300, 70, 'BDT']);
    await T.trackOrder(Promise.resolve({ ok: true, order_id: 'ord-1' }), snap);
    assert.strictEqual(events(dl).filter(e => e.event === 'purchase').length, 1, 'same order id never reported twice');
    await T.trackOrder(Promise.resolve({ ok: false, error: 'orders insert: permission denied' }), snap);
    await T.trackOrder(Promise.resolve({ ok: false, error: 'timeout (>4s)' }), snap);
    await T.trackOrder(Promise.reject(new Error('boom')), snap);
    assert.strictEqual(events(dl).filter(e => e.event === 'purchase').length, 1, 'a failed / rejected save is never a purchase');
    assert.deepStrictEqual(events(dl).filter(e => e.event === 'order_save_failed').map(e => e.error_kind), ['server', 'timeout', 'exception']);
    const f = events(dl).find(e => e.event === 'order_save_failed');
    assert.ok(!('ecommerce' in f) && !JSON.stringify(f).match(/buyer|phone|address/), 'failure event carries no order or buyer data');
  }

  // ── 4. outbox: unloaded before GTM → replayed on the next page ──
  {
    const session = storage();
    const a = makeEnv({ session });
    a.T.addToCart('p', 3, 150, 'P', 'B', 1);
    a.winL.pagehide.forEach(f => f({}));
    assert.ok(session.getItem('nawme_outbox'), 'pending events saved on pagehide');
    const b = makeEnv({ session });
    const replayed = events(b.dl).filter(e => e.replayed);
    assert.strictEqual(replayed.length, 1, 'next page replays them');
    assert.strictEqual(replayed[0].event, 'add_to_cart');
    assert.strictEqual(session.getItem('nawme_outbox'), null, 'outbox cleared after replay');
    // once GTM has loaded, nothing is kept
    b.T.start(); await tick(60);
    const gtm = b.els['nawme-gtm'];
    assert.ok(gtm && /gtm\.js\?id=GTM-KKCJCDTZ/.test(gtm.src) && gtm.fetchPriority === 'low', 'GTM injected late, low priority');
    gtm.onload(); b.T.addToCart('q', 3, 150, 'Q', 'B', 1); b.winL.pagehide.forEach(f => f({}));
    assert.strictEqual(session.getItem('nawme_outbox'), null, 'no outbox once GTM loaded');
    await tick(20);
    assert.ok(events(b.dl).some(e => e.event === 'nawme_idle'), 'stage-2 nawme_idle pushed after GTM loads');
  }

  // ── 5. consent decisions (resolved before GTM loads) ─────────
  async function consentRun(o) {
    const env = makeEnv(o);
    env.T.start(); await tick(80);
    const c = consentCalls(env.dl);
    return { env, last: c[c.length - 1], banner: !!env.els['consent-bar'], gtm: !!env.els['nawme-gtm'] };
  }
  {
    const bd = await consentRun({ trace: 'BD' });
    assert.ok(!bd.banner && bd.last[0] === 'update' && bd.last[1].ad_storage === 'granted', 'BD: granted, no banner');
    assert.ok(bd.gtm, 'GTM loads after consent resolves');
    assert.strictEqual(bd.env.session.getItem('nawme_cc'), JSON.stringify('BD'), 'country cached for the session');
    const gb = await consentRun({ trace: 'GB' });
    assert.ok(gb.banner && gb.last[1].ad_storage === 'denied', 'GB: denied + banner');
    const fail = await consentRun({ trace: 'fail' });
    assert.ok(fail.banner && fail.last[1].ad_storage === 'denied', 'failed lookup → treated as non-BD');
    assert.strictEqual(fail.env.session.getItem('nawme_cc'), null, 'a failed lookup is not cached');
    // live admin policy: banner for Bangladesh too
    const strict = await consentRun({ trace: 'BD', settings: { consent: { grantedRegions: [], version: 1 } } });
    assert.ok(strict.banner && strict.last[1].ad_storage === 'denied', 'live policy without BD → BD gets the banner (no deploy)');
    // preferences: analytics only → analytics granted, ads denied
    const pref = await consentRun({ trace: 'GB' });
    pref.env.T.choose({ analytics: true, ads: false });
    const pc = consentCalls(pref.env.dl).pop()[1];
    assert.deepStrictEqual([pc.analytics_storage, pc.ad_storage, pc.ad_user_data, pc.ad_personalization], ['granted', 'denied', 'denied', 'denied'], 'per-category choice');
    assert.deepStrictEqual(JSON.parse(pref.env.local.getItem('nawme_consent')).ads, false);
    // accept all / reject optional
    gb.env.T.choose(true);
    const stored = JSON.parse(gb.env.local.getItem('nawme_consent'));
    assert.ok(stored.analytics === true && stored.ads === true && stored.v === 1 && !gb.env.els['consent-bar'], 'accept all stored, banner removed');
    assert.strictEqual(consentCalls(gb.env.dl).pop()[1].ad_storage, 'granted');
    assert.ok(events(gb.env.dl).some(e => e.event === 'consent_update' && e.consent_analytics === true && e.consent_ads === true));
    const again = await consentRun({ trace: 'GB', local: gb.env.local });
    assert.ok(!again.banner && again.last[1].ad_storage === 'granted', 'stored choice honoured on the next page');
    // version bump asks again; a BD opt-out survives it
    const bumped = await consentRun({ trace: 'GB', local: gb.env.local, settings: { consent: { grantedRegions: ['BD'], version: 2 } } });
    assert.ok(bumped.banner, '"Ask everyone again" (new version) shows the banner again');
    const optOut = storage({ nawme_consent: JSON.stringify({ v: 1, granted: false }) });
    const bdOut = await consentRun({ trace: 'BD', local: optOut, settings: { consent: { grantedRegions: ['BD'], version: 2 } } });
    assert.ok(!bdOut.banner && bdOut.last[1].ad_storage === 'denied', 'a BD opt-out survives a version bump');
  }

  // ── 6. checkout wiring (static) ─────────────────────────────
  {
    const cart = fs.readFileSync(path.join(ROOT, 'cart.html'), 'utf8');
    assert.strictEqual((cart.match(/NawmeTrack\.trackOrder\(save,/g) || []).length, 2, 'both checkout paths report via the save promise');
    assert.ok(!/NawmeTrack\.purchase\(/.test(cart), 'cart.html never reports a purchase directly');
    assert.ok(/NawmeTrack\.beginCheckout\(/.test(cart), 'begin_checkout wired');
  }

  // ── 7. built pages: exactly one snippet on every public page, none in admin ──
  const count = f => (fs.readFileSync(f, 'utf8').match(/<!--analytics:start-->/g) || []).length;
  const roots = ['index.html', 'shop.html', 'exclusive.html', 'recommend.html', 'cart.html', 'about.html', 'about-me.html', '404.html'];
  for (const f of roots) assert.strictEqual(count(path.join(ROOT, f)), 1, 'one analytics snippet in ' + f);
  assert.strictEqual(count(path.join(ROOT, 'admin', 'index.html')), 0, 'admin carries no analytics');
  const sitemap = fs.existsSync(path.join(ROOT, 'sitemap.xml')) ? fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8') : '';
  let pages = 0;
  for (const m of sitemap.matchAll(/<loc>https:\/\/nawmeessences\.com\/([^<]*)<\/loc>/g)) {
    const rel = m[1] === '' ? 'index.html' : m[1].endsWith('/') ? m[1] + 'index.html' : m[1];
    const fp = path.join(ROOT, rel);
    if (!fs.existsSync(fp)) continue;
    assert.strictEqual(count(fp), 1, 'one analytics snippet in ' + rel); pages++;
  }
  const head = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(head.indexOf('<!--analytics:start-->') < head.indexOf('</head>'), 'snippet is in <head>');
  assert.ok(!/googletagmanager\.com/.test(head), 'no GTM URL in the HTML (loaded only by js/cart.js)');

  console.log(`test-track: snippet, events, purchase, outbox and consent checks passed; ${pages} sitemap pages + ${roots.length} root pages carry one snippet`);
})().catch(e => { console.error(e); process.exit(1); });
