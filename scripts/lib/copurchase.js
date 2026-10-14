// ============================================================
//  copurchase.js — "People who chose #1 also considered…" data for
//  the Find a Scent page (Phase 3). Display-only: the client never
//  scores with it.
//
//  Two halves:
//    • fetchCoPurchase(sb)  — reads real order lines with the SERVICE
//      key (orders has no SELECT policy, so the anon key sees nothing;
//      the build only calls this when CAN_WRITE). Never throws: any
//      error → one log line → null.
//    • buildCoPurchase(lines, items) — pure, deterministic. Turns
//      [{ orderId, fragranceId }] into a map id → [[idx, w], …] where
//      idx is the product's index in the recs/finder items array and
//      w = round(min(1, lift / 10), 2), lift = P(A∧B) / (P(A)·P(B))
//      over qualifying orders (status confirmed/dispatched/delivered,
//      ≥ 2 distinct catalogue products). Pairs need support ≥ 2
//      orders; at most 5 per product; order w desc, idx asc.
//
//  Privacy: only product ids per order are read — no buyer columns.
//  Minimums (30 qualifying orders, support 2) keep a single buyer's
//  basket from ever becoming a recommendation.
// ============================================================

const QUALIFYING_STATUS = ['confirmed', 'dispatched', 'delivered'];
const DEFAULT_DAYS = 180;
const MIN_ORDERS = 30;
const MIN_SUPPORT = 2;
const TOP = 5;
const LIFT_CAP = 10;        // lift ≥ 10 → w = 1
const PAGE = 1000;          // PostgREST default max rows per request
const ID_CHUNK = 100;       // order ids per order_items request (URL length)

const noop = () => {};

// Reads every row of a paged select. `make(from, to)` returns a fresh query
// builder with .range applied by us. Throws on a Supabase error (caught by
// the caller) so one failure aborts the whole fetch instead of truncating.
async function readAll(make) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message || String(error));
    if (!Array.isArray(data) || !data.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// → { orders: n, lines: [{ orderId, fragranceId }] } or null. Never throws.
async function fetchCoPurchase(sb, { days = DEFAULT_DAYS, log = noop } = {}) {
  if (!sb || typeof sb.from !== 'function') { log('co-purchase skipped: no Supabase client'); return null; }
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const orders = await readAll(() => sb.from('orders').select('id')
      .in('status', QUALIFYING_STATUS).gte('created_at', since)
      .order('created_at', { ascending: true }).order('id', { ascending: true }));
    const ids = orders.map(o => o.id).filter(Boolean);
    const lines = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const items = await readAll(() => sb.from('order_items').select('order_id, fragrance_id')
        .in('order_id', chunk).not('fragrance_id', 'is', null)
        .order('order_id', { ascending: true }).order('fragrance_id', { ascending: true }));
      for (const it of items) if (it.order_id && it.fragrance_id) lines.push({ orderId: it.order_id, fragranceId: it.fragrance_id });
    }
    log(`co-purchase: ${ids.length} qualifying orders / ${lines.length} order lines in the last ${days} days`);
    return { orders: ids.length, lines };
  } catch (e) {
    log(`co-purchase skipped: ${e && e.message ? e.message : e}`);
    return null;
  }
}

const round2 = x => Math.round(x * 100) / 100;

// Pure. `orderLines` = [{ orderId, fragranceId }] or the fetchCoPurchase()
// result ({ lines }) or null; `items` = recs/finder items in build order.
// Returns { id: [[idx, w], …] } (only products with ≥ 1 pair) or null.
function buildCoPurchase(orderLines, items, { minOrders = MIN_ORDERS, minSupport = MIN_SUPPORT, top = TOP, log = noop } = {}) {
  const lines = Array.isArray(orderLines) ? orderLines : (orderLines && Array.isArray(orderLines.lines) ? orderLines.lines : null);
  if (!lines) { log('co-purchase skipped: no order data'); return null; }
  if (!Array.isArray(items)) throw new Error('buildCoPurchase: items must be an array');

  const idxOf = new Map();
  items.forEach((it, i) => { if (it && it.id != null && !idxOf.has(String(it.id))) idxOf.set(String(it.id), i); });

  // order → set of catalogue indices (lines for products not in the catalogue are ignored)
  const baskets = new Map();
  for (const l of lines) {
    if (!l || l.orderId == null || l.fragranceId == null) continue;
    const idx = idxOf.get(String(l.fragranceId));
    if (idx === undefined) continue;
    const key = String(l.orderId);
    if (!baskets.has(key)) baskets.set(key, new Set());
    baskets.get(key).add(idx);
  }
  const qualifying = [...baskets.values()].filter(s => s.size >= 2);
  const N = qualifying.length;
  if (N < minOrders) { log(`co-purchase skipped: ${N} qualifying orders < ${minOrders}`); return null; }

  const single = new Map();           // idx → orders containing it
  const pair = new Map();             // "a|b" (a < b) → orders containing both
  for (const s of qualifying) {
    const idxs = [...s].sort((x, y) => x - y);
    for (const a of idxs) single.set(a, (single.get(a) || 0) + 1);
    for (let i = 0; i < idxs.length; i++) for (let j = i + 1; j < idxs.length; j++) {
      const k = idxs[i] + '|' + idxs[j];
      pair.set(k, (pair.get(k) || 0) + 1);
    }
  }

  const per = new Map();              // idx → [[idx, w]]
  for (const [k, nAB] of pair) {
    if (nAB < minSupport) continue;
    const [a, b] = k.split('|').map(Number);
    const lift = (nAB * N) / (single.get(a) * single.get(b));
    const w = round2(Math.min(1, lift / LIFT_CAP));
    if (w <= 0) continue;
    if (!per.has(a)) per.set(a, []);
    if (!per.has(b)) per.set(b, []);
    per.get(a).push([b, w]);
    per.get(b).push([a, w]);
  }

  const out = {};
  let products = 0;
  items.forEach((it, i) => {
    const list = per.get(i);
    if (!list || !list.length) return;
    list.sort((x, y) => (y[1] - x[1]) || (x[0] - y[0]));
    out[String(it.id)] = list.slice(0, top);
    products++;
  });
  if (!products) { log(`co-purchase skipped: ${N} qualifying orders but no pair reached support ${minSupport}`); return null; }
  log(`co-purchase: ${N} qualifying orders → pairs on ${products}/${items.length} products`);
  return out;
}

module.exports = { fetchCoPurchase, buildCoPurchase, QUALIFYING_STATUS, DEFAULT_DAYS, MIN_ORDERS, MIN_SUPPORT, TOP, LIFT_CAP };
