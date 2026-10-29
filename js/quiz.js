// quiz.js — homepage Quick Scent Match (not the chat finder). Answers become an
// anchor in recs' key space, NawmeRecs.rank() gives a taste pool, and this file
// re-ranks it for occasion and strength. Loaded on intent by js/main.js.
// UMD: window.NawmeQuiz / module.exports (scripts/test-quiz.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NawmeQuiz = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Answers → catalogue labels (resolved against data/recs.json vocab) ──
  // a = defining accords, a2 = supporting accords (half weight). Labels the
  // vocab lacks are dropped, never invented.
  const TILES = {
    fresh:   { label: 'Fresh & Citrus',   short: 'Fresh',    hint: 'lemon, bergamot',  f: ['Citrus', 'Fresh', 'Green'], a: ['Citrus', 'Fresh'], a2: ['Green', 'Ozonic'] },
    woody:   { label: 'Woody & Oud',      short: 'Woody',    hint: 'cedar, oud',       f: ['Woody'], a: ['Woody', 'Oud'], a2: ['Earthy', 'Mossy', 'Smoky', 'Patchouli'] },
    sweet:   { label: 'Sweet & Gourmand', short: 'Sweet',    hint: 'vanilla, caramel', f: ['Gourmand', 'Vanilla'], a: ['Sweet', 'Vanilla'], a2: ['Caramel', 'Cacao', 'Chocolate', 'Honey', 'Coffee', 'Almond', 'Nutty', 'Coconut', 'Lactonic', 'Gourmand'] },
    spicy:   { label: 'Spicy & Warm',     short: 'Spicy',    hint: 'cardamom, amber',  f: ['Spicy', 'Oriental'], a: ['Warm Spicy', 'Spicy'], a2: ['Cinnamon', 'Amber', 'Balsamic', 'Tobacco', 'Soft Spicy'] },
    aquatic: { label: 'Aquatic & Clean',  short: 'Aquatic',  hint: 'sea breeze',       f: ['Aquatic'], a: ['Aquatic', 'Marine'], a2: ['Salty', 'Mineral'] },
    floral:  { label: 'Floral & Musky',   short: 'Floral',   hint: 'rose, soft musk',  f: ['Floral', 'Musk'], a: ['Floral', 'White Floral', 'Musky'], a2: ['Rose', 'Iris', 'Violet', 'Powdery'] },
  };
  const EXPLORE = 'explore';
  const OCCASIONS = {
    everyday: { label: 'Everyday',                    phrase: 'everyday wear',   o: ['Everyday'] },
    office:   { label: 'Office & Professional',       phrase: 'the office',      o: ['Office', 'Formal'] },
    casual:   { label: 'Casual Outings',              phrase: 'casual outings',  o: ['Casual', 'Holiday'] },
    dates:    { label: 'Dates & Evenings',            phrase: 'evenings',        o: ['Date Night', 'Evening'] },
    parties:  { label: 'Parties & Special Occasions', phrase: 'special nights',  o: ['Party', 'Festivals', 'Wedding'] },
    allround: { label: 'All-Rounder',                 phrase: '',                o: [] },
  };
  const STRENGTH = {
    subtle:   { label: 'Subtle',   desc: 'Close to the skin',                 target: 0.2 },
    balanced: { label: 'Balanced', desc: 'Noticeable, never overpowering',    target: 0.5 },
    strong:   { label: 'Strong',   desc: 'Bold and attention-grabbing',       target: 0.85 },
    any:      { label: 'No preference', desc: 'Show me the best fit',          target: null },
  };
  const WHO = {
    him:    { label: 'Him',    desc: 'Men’s & unisex' },
    her:    { label: 'Her',    desc: 'Unisex scents' },
    anyone: { label: 'Anyone', desc: 'The whole collection' },
  };
  // Light vs rich accords for the strength lean (verified accords only; used
  // for ranking, never shown as a claim). Concentration nudges when known.
  const LIGHT = ['Citrus', 'Fresh', 'Aquatic', 'Marine', 'Green', 'Ozonic', 'Fresh Spicy', 'Salty', 'Mineral'];
  const RICH = ['Amber', 'Oud', 'Leather', 'Warm Spicy', 'Vanilla', 'Tobacco', 'Smoky', 'Balsamic', 'Animalic', 'Patchouli', 'Boozy', 'Whiskey', 'Rum', 'Cinnamon'];
  const STRONG_K = ['Extrait', 'Parfum', 'Elixir', 'EDP Intense'], LIGHT_K = ['EDT'];
  const CONC_NAME = { EDP: 'Eau de Parfum', EDT: 'Eau de Toilette', Extrait: 'Extrait de Parfum', Parfum: 'Parfum', 'EDP Intense': 'Eau de Parfum Intense', Elixir: 'Elixir' };
  // Two-part cards name the half the item actually has (a musk-only match is not "Floral").
  // Neither half present → the matching accord's own name ("Powdery"), never an unbacked word.
  const SUB = { floral: { f: ['Floral'], a: ['Floral', 'White Floral', 'Rose', 'Iris', 'Violet'], alt: 'Musky', altF: ['Musk'], altA: ['Musky'] },
    spicy: { f: ['Spicy'], a: ['Spicy', 'Warm Spicy', 'Cinnamon', 'Soft Spicy'], alt: 'Warm', altF: ['Oriental'], altA: ['Amber', 'Balsamic', 'Tobacco'] } };
  // A concentration is named only when it backs the strength that was asked for.
  const SUPPORTS = { subtle: ['EDT'], balanced: ['EDP'], strong: ['EDP Intense', 'Extrait', 'Parfum', 'Elixir'] };
  // Explore: a card's near neighbour is not "something new" either.
  const NEAR = { aquatic: ['fresh'], fresh: ['aquatic'] };
  const BOLD = { Oud: 'an oud edge', Smoky: 'a smoky edge', Leather: 'a leathery edge', Animalic: 'an animalic edge', Tobacco: 'a tobacco edge' };

  // Weights, taste shape, pool and floor were validated on the real catalogue — reasons in scripts/test-quiz.js.
  const W = { taste: 0.55, occasion: 0.30, strength: 0.15 };
  // Taste: each later accord counts a little less (decay per rank, down to floor), so a lead accord
  // outweighs a ninth one; cover = penalty share for chosen cards an item doesn't match at all;
  // oud = "Woody & Oud" shows an oud scent when one fits closely enough (OUD_GAP).
  const TASTE = { decay: 0.05, floor: 0.3, cover: 0.15, oud: true };
  const POOL = 24, POOL_WIDE = 48, POOL_BRAND_CAP = 6, MIN_COS = 0.02, MIN_TASTE = 0.35, BRAND_CAP = 2, MAX_PICKS = 3;
  const WEAK_COS = 0.12;      // best taste similarity below this → "closest we have"
  const LIGHT_I = 0.35;       // explore alone: at most one pick leaning lighter than this
  const OUD_GAP = 0.8;        // an oud replaces the last pick only when it scores ≥ 80 % of it

  // ── helpers ──────────────────────────────────────────────────
  const norm = s => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').replace(/[.;,]+$/, '').toLowerCase();
  const effectivePrice = (price, sp) => (sp > 0 ? Math.round(price * (100 - sp) / 100) : price);
  function indexer(list) { const m = new Map(); (list || []).forEach((x, i) => { const k = norm(x); if (!m.has(k)) m.set(k, i); }); return k => (m.has(norm(k)) ? m.get(norm(k)) : -1); }
  function ids(find, labels) { return (labels || []).map(find).filter(i => i >= 0); }
  const price3 = item => { const s = (item.s || []).find(x => x[0] === 3); return s ? effectivePrice(s[1], item.sp) : null; };

  // Oud = an Oud accord in the top five, backed by an oud/agarwood note when notes are listed
  // (an oud-like accord from akigalawood alone is not oud to a shopper who asked for it).
  function isOud(item, model) {
    const cx = context(model);
    if (cx.oudIdx < 0 || !(item.a || []).slice(0, 5).includes(cx.oudIdx)) return false;
    return !(item.n || []).length || item.n.some(i => cx.oudNotes.has(i));
  }
  // Lookup tables built once per model.
  function context(model) {
    if (model._quiz) return model._quiz;
    const V = model.vocab || {};
    const fa = indexer(V.a), ff = indexer(V.f), fo = indexer(V.o), fk = indexer(V.k);
    const tiles = {};
    Object.keys(TILES).forEach(k => { const t = TILES[k]; tiles[k] = { f: ids(ff, t.f), a: ids(fa, t.a), a2: ids(fa, t.a2) }; });
    const occ = {};
    Object.keys(OCCASIONS).forEach(k => { occ[k] = ids(fo, OCCASIONS[k].o); });
    const bold = new Map(); Object.keys(BOLD).forEach(l => { const i = fa(l); if (i >= 0) bold.set(i, BOLD[l]); });
    const sub = {}; Object.keys(SUB).forEach(k => { const x = SUB[k];
      sub[k] = { f: new Set(ids(ff, x.f)), a: new Set(ids(fa, x.a)), alt: x.alt, altF: new Set(ids(ff, x.altF)), altA: new Set(ids(fa, x.altA)) }; });
    model._quiz = { V, tiles, occ, light: new Set(ids(fa, LIGHT)), rich: new Set(ids(fa, RICH)),
      strongK: new Set(ids(fk, STRONG_K)), lightK: new Set(ids(fk, LIGHT_K)), bold, sub, oudIdx: fa('Oud'),
      oudNotes: new Set((V.n || []).map((x, i) => (String(x).toLowerCase().split(/[^a-z]+/).some(w => w === 'oud' || w === 'agarwood') ? i : -1)).filter(i => i >= 0)) };
    return model._quiz;
  }

  // In-stock regular products a shopper can buy as a 3 ml try.
  const buyable = model => model.items.filter(it => it.i && it.c === 'r' && price3(it) != null);

  // ── Budget bands: tie-safe, exact (a price never spans two bands) ──
  // Cuts at 25/50/75 % of the cumulative count, always between two distinct
  // prices; a band smaller than max(5, n/8) merges into its neighbour; ≤ 3
  // distinct prices → one band per price. Membership = [min, max] inclusive.
  function bands(prices) {
    const sorted = (prices || []).filter(p => p > 0).sort((a, b) => a - b);
    const n = sorted.length;
    if (!n) return [];
    const distinct = [...new Set(sorted)];
    if (distinct.length <= 3) return distinct.map(p => ({ min: p, max: p }));
    const countUpTo = p => sorted.filter(x => x <= p).length;
    const cuts = [];
    [0.25, 0.5, 0.75].forEach(t => {
      let k = distinct.findIndex(p => countUpTo(p) >= t * n);
      k = Math.min(Math.max(k, 0), distinct.length - 2);
      if (!cuts.includes(distinct[k])) cuts.push(distinct[k]);
    });
    const out = []; let lo = distinct[0];
    cuts.sort((a, b) => a - b).forEach(c => { out.push({ min: lo, max: c }); lo = distinct.find(p => p > c); });
    out.push({ min: lo, max: distinct[distinct.length - 1] });
    const size = b => sorted.filter(x => x >= b.min && x <= b.max).length;
    const minSize = Math.max(5, Math.ceil(n / 8));
    for (let i = 0; i < out.length && out.length > 1; i++) {
      if (size(out[i]) >= minSize) continue;
      if (i === out.length - 1) out[i - 1].max = out[i].max; else out[i + 1].min = out[i].min;
      out.splice(i, 1); i = -1;
    }
    return out;
  }
  const BAND_NAMES = [['Lowest prices'], ['Lowest prices', 'Premium'], ['Lowest prices', 'Mid-range', 'Premium'], ['Lowest prices', 'Budget-friendly', 'Mid-range', 'Premium']];
  function bandOptions(model) {
    const b = bands(buyable(model).map(price3));
    const names = BAND_NAMES[Math.min(b.length, 4) - 1] || [];
    return b.map((x, i) => ({ key: 'b' + i, min: x.min, max: x.max, label: names[i] || ('Range ' + (i + 1)),
      range: x.min === x.max ? '৳' + x.min : '৳' + x.min + '–৳' + x.max }));
  }

  // ── Explicit filters (hard) → ids to exclude from recs' ranking ──
  function excluded(model, ans, bandList) {
    const ex = [];
    const band = ans.budget ? (bandList || []).find(b => b.key === ans.budget) : null;
    for (const it of model.items) {
      if (!it.i || it.c !== 'r') { ex.push(it.id); continue; }
      const p = price3(it);
      if (p == null) { ex.push(it.id); continue; }
      if (ans.who === 'her' && it.g !== 3) { ex.push(it.id); continue; }   // Him/Anyone: men + unisex
      if (band && (p < band.min || p > band.max)) { ex.push(it.id); continue; }
    }
    return ex;
  }

  // ── Anchor vector in recs' key space ('f'+idx, 'a'+idx), L2-normalised ──
  function buildAnchor(model, tileKeys, weights) {
    const cx = context(model), Wt = weights || { f: 2, a: 2 };
    const v = new Map(); const add = (k, w) => v.set(k, (v.get(k) || 0) + w);
    (tileKeys || []).filter(k => cx.tiles[k]).forEach(k => {
      const t = cx.tiles[k];
      t.f.forEach(i => add('f' + i, Wt.f));
      t.a.forEach(i => add('a' + i, Wt.a));
      t.a2.forEach(i => add('a' + i, Wt.a * 0.5));
    });
    let n = 0; v.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1;
    v.forEach((w, k) => v.set(k, w / n));
    return v;
  }

  // Strength lean in [0, 1], or null when unknown (no classified accord in the
  // top five and no known concentration) — unknown is never penalised.
  function intensity(item, model) {
    const cx = context(model);
    let s = 0, seen = false;
    (item.a || []).slice(0, 5).forEach((a, r) => {
      const w = 1 - r * 0.15;
      if (cx.rich.has(a)) { s += w; seen = true; }
      if (cx.light.has(a)) { s -= w; seen = true; }
    });
    const knownK = item.k >= 0 && (cx.strongK.has(item.k) || cx.lightK.has(item.k));
    if (!seen && !knownK) return null;
    let I = 0.5 + s / 4;
    if (cx.strongK.has(item.k)) I += 0.2;
    if (cx.lightK.has(item.k)) I -= 0.2;
    return Math.max(0, Math.min(1, I));
  }

  // 1 = lists a chosen occasion, 0 = lists occasions but none chosen,
  // null = unknown (no occasions on the item) or no occasion asked.
  function occasionFit(item, ans, model) {
    const want = [];
    (ans.occ || []).forEach(k => (context(model).occ[k] || []).forEach(i => want.push(i)));
    if (!want.length) return null;
    if (!(item.o || []).length) return null;
    return want.some(i => item.o.includes(i)) ? 1 : 0;
  }
  function strengthFit(item, ans, model) {
    const t = STRENGTH[ans.strength] && STRENGTH[ans.strength].target;
    if (t == null) return null;
    const I = intensity(item, model);
    return I == null ? null : 1 - Math.abs(I - t);
  }

  // Scent similarity on the family/accord dimensions only. recs' cosine uses the
  // whole vector (notes, occasions, concentration…), so a product with richer
  // metadata scored LOWER on taste than an identical sparse one — the quiz asks
  // about scent, so it compares scent. Falls back to recs' cosine without a vec.
  function scentVec(item, model, T) {
    const cx = context(model), key = T.decay + '|' + T.floor;
    const cache = cx.sv || (cx.sv = new Map()); if (!cache.has(key)) cache.set(key, new Map());
    const c = cache.get(key); if (c.has(item.id)) return c.get(item.id);
    const v = new Map();
    (item.f || []).forEach(i => v.set('f' + i, 2));
    (item.a || []).forEach((i, r) => v.set('a' + i, 2 * Math.max(T.floor, 1 - T.decay * r)));
    let n = 0; v.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1;
    v.forEach((w, k) => v.set(k, w / n));
    c.set(item.id, v); return v;
  }
  function tasteSim(vec, item, model, T) {
    if (!vec || !item.vec) return null;
    let dot = 0; scentVec(item, model, T).forEach((x, k) => { const y = vec.get(k); if (y) dot += x * y; });
    return dot;
  }
  // Share of the chosen cards an item matches (family, or any card accord in its top five).
  function coverage(item, tiles, model) {
    const cx = context(model), top5 = new Set((item.a || []).slice(0, 5)), fams = new Set(item.f || []);
    const ks = (tiles || []).filter(k => cx.tiles[k]); if (ks.length < 2) return 1;
    return ks.filter(k => { const t = cx.tiles[k]; return t.f.some(i => fams.has(i)) || t.a.concat(t.a2).some(i => top5.has(i)); }).length / ks.length;
  }

  // Taste pool → per-item renormalised score. Unknown signals drop out of that
  // item's weights (neither rewarded nor penalised); skipped questions drop out
  // for everyone.
  function rerank(pool, ans, model, vec, cfg) {
    const T = cfg || TASTE, Wt = T.w || W;
    const sims = pool.map(r => { const s = tasteSim(vec, r.item, model, T); return (s == null ? r.cos : s) * (T.cover ? 1 - T.cover * (1 - coverage(r.item, ans.tiles, model)) : 1); });
    const top = Math.max(0, ...sims) || 1;
    return pool.map((r, i) => {
      const taste = top > 0 ? sims[i] / top : 0;
      const of = occasionFit(r.item, ans, model), sf = strengthFit(r.item, ans, model);
      let s = Wt.taste * taste, w = Wt.taste;
      if (of != null) { s += Wt.occasion * of; w += Wt.occasion; }
      if (sf != null) { s += Wt.strength * sf; w += Wt.strength; }
      return { id: r.id, item: r.item, cos: r.cos, taste, occasionFit: of, strengthFit: sf, score: s / w };
    }).sort((a, b) => (Math.abs(b.score - a.score) > 1e-9 ? b.score - a.score : 0) || (b.item.bs - a.item.bs) || (price3(a.item) - price3(b.item)) || (a.item.idx - b.item.idx));
  }

  // One per fragrance line: same house, and one name (concentration words dropped) starts the
  // other, so Le Male and Le Male Le Parfum never take two of three sample slots.
  const CONC_WORDS = new Set(['edp', 'edt', 'eau', 'de', 'toilette', 'parfum', 'extrait', 'intense']);   // not "elixir": often a scent's own name
  const lineKey = item => {
    if (item._line) return item._line;
    const w = norm(item.nm).split(' ').filter(x => !CONC_WORDS.has(x));
    if (w.length > 1 && w[w.length - 1] === 'le') w.pop();           // "Le Male Le Parfum" → "le male"
    return (item._line = w.join(' '));
  };
  const sameLine = (a, b) => { if (a.b !== b.b) return false; const x = lineKey(a), y = lineKey(b); return x === y || x.startsWith(y + ' ') || y.startsWith(x + ' '); };
  // taken: rows already shown (they count towards the caps).
  function capBrands(list, n, cap, taken) {
    const out = [], per = new Map(), shown = (taken || []).slice(), seen = new Set(shown.map(r => r.id));
    shown.forEach(r => per.set(r.item.b, (per.get(r.item.b) || 0) + 1));
    for (const r of list) {
      if (seen.has(r.id)) continue;
      if ((per.get(r.item.b) || 0) >= cap) continue;
      if (shown.some(x => sameLine(x.item, r.item))) continue;
      out.push(r); shown.push(r); seen.add(r.id); per.set(r.item.b, (per.get(r.item.b) || 0) + 1);
      if (out.length >= n) break;
    }
    return out;
  }

  // Outside the chosen scents (for the Explore slot): no shared family and none
  // of the chosen cards' defining accords in the item's top five.
  function outsideChosen(model, tiles) {
    const cx = context(model), fam = new Set(), acc = new Set();
    (tiles || []).forEach(k => { const t = cx.tiles[k]; if (t) { t.f.forEach(i => fam.add(i)); t.a.forEach(i => acc.add(i)); }
      (NEAR[k] || []).forEach(n => cx.tiles[n].f.forEach(i => fam.add(i))); });
    return it => !(it.f || []).some(f => fam.has(f)) && !(it.a || []).slice(0, 5).some(a => acc.has(a));
  }
  // Deterministic "outside your usual" order: bestsellers (unisex first), then occasion fit, then price.
  function exploreOrder(items, ans, model) {
    return items.map(it => ({ id: it.id, item: it, cos: 0, taste: 0, occasionFit: occasionFit(it, ans, model), strengthFit: strengthFit(it, ans, model), score: 0 }))
      .sort((a, b) => (b.item.bs - a.item.bs) || ((b.item.g === 3) - (a.item.g === 3)) || ((b.occasionFit || 0) - (a.occasionFit || 0)) || (price3(a.item) - price3(b.item)) || (a.item.idx - b.item.idx));
  }

  // ── Main entry: answers → { status, picks[], note } ──
  // rank = NawmeRecs.rank (injected for tests). status: 'ok' | 'weak' | 'none'.
  function match(model, ans, rank, opts) {
    opts = opts || {};
    const bandList = opts.bands || bandOptions(model);
    const exclude = excluded(model, ans, bandList);
    const allowed = new Set(model.items.filter(it => !exclude.includes(it.id)).map(it => it.id));
    const tiles = (ans.tiles || []).filter(k => TILES[k]);
    const explore = (ans.tiles || []).includes(EXPLORE);
    if (!allowed.size) return { status: 'none', picks: [] };

    let picks = [], scored = [], weak = false;
    if (tiles.length) {
      const T = opts.taste || TASTE;
      const vec = buildAnchor(model, tiles, opts.weights);
      const run = size => rank(model, [], { anchor: { vec }, exclude, collection: 'r', limit: size, pool: size, brandCap: POOL_BRAND_CAP, minCos: MIN_COS, shuffle: false });
      const want = explore ? MAX_PICKS - 1 : MAX_PICKS;
      const strongEnough = list => list.filter(r => r.taste >= MIN_TASTE);
      let pool = run(T.pool || POOL);
      scored = strongEnough(rerank(pool, ans, model, vec, T));
      let base = capBrands(scored, want, BRAND_CAP);
      if (base.length < want) {                                            // widen once, then show fewer
        pool = run(T.poolWide || POOL_WIDE); scored = strongEnough(rerank(pool, ans, model, vec, T));
        base = capBrands(scored, want, BRAND_CAP);
      }
      if (T.oud && tiles.includes('woody')) {                             // "Woody & Oud": show an oud when one fits
        const hasOud = r => isOud(r.item, model);
        if (base.length === want && !base.some(hasOud)) {                 // look past the short pool; only a close-enough oud
          const wide = strongEnough(rerank(run(T.poolWide || POOL_WIDE), ans, model, vec, T)).filter(r => hasOud(r) && coverage(r.item, tiles, model) === 1);
          const o = capBrands(wide, 1, BRAND_CAP, base.slice(0, want - 1))[0];
          if (o && o.score >= OUD_GAP * base[want - 1].score) base = base.slice(0, want - 1).concat(o).sort((x, y) => y.score - x.score);
        }
      }
      picks = base;
      weak = !pool.length || pool[0].cos < WEAK_COS;
    }
    if (explore) {
      const isOutside = outsideChosen(model, tiles);
      const taken = new Set(picks.map(p => p.id));
      const pool = model.items.filter(it => allowed.has(it.id) && !taken.has(it.id));
      if (tiles.length) {
        const outside = exploreOrder(pool.filter(isOutside), ans, model);
        const add = capBrands(outside, 1, BRAND_CAP, picks);
        add.forEach(r => { r.explore = true; picks.push(r); });
      } else {
        // Explore alone: three bestsellers from three different families, at most one of them light.
        const usedFam = new Set(), perBrand = new Map(); let light = false;
        for (const r of exploreOrder(pool, ans, model)) {
          const f0 = (r.item.f || [])[0];
          if (f0 != null && usedFam.has(f0)) continue;
          if ((perBrand.get(r.item.b) || 0) >= BRAND_CAP) continue;
          if (picks.some(p => sameLine(p.item, r.item))) continue;
          const I = intensity(r.item, model), isLight = I != null && I < LIGHT_I;
          if (isLight && light) continue;
          if (isLight) light = true;
          r.explore = true; picks.push(r);
          if (f0 != null) usedFam.add(f0);
          perBrand.set(r.item.b, (perBrand.get(r.item.b) || 0) + 1);
          if (picks.length >= MAX_PICKS) break;
        }
      }
    }
    if (!picks.length) return { status: 'none', picks: [] };
    picks = picks.slice(0, MAX_PICKS).map((r, i) => {
      const label = r.explore ? 'Worth Exploring' : i === 0 ? 'Best Match' : 'Alternative Pick';
      return Object.assign({}, r, { label,
        why: whyLine(r.item, ans, model, r), caution: cautionFor(r.item, tiles, model) });
    });
    return { status: weak && tiles.length ? 'weak' : 'ok', picks };
  }

  // ── Explanations: only attributes the item actually has ──
  function whyLine(item, ans, model, r) {
    const cx = context(model), parts = [];
    const acc = item.a || [], top3 = acc.slice(0, 3), top5 = new Set(acc.slice(0, 5)), fams = new Set(item.f || []);
    const cards = (ans.tiles || []).filter(k => cx.tiles[k]);
    const matched = cards.filter(k => { const t = cx.tiles[k]; return t.f.some(i => fams.has(i)) || t.a.some(i => top5.has(i)) || t.a2.some(i => top5.has(i)); });
    // Name firm matches (family, or a defining accord in the top three); else the single closest card.
    const firm = matched.filter(k => { const t = cx.tiles[k]; return t.f.some(i => fams.has(i)) || t.a.some(i => top3.includes(i)); });
    const word = k => {
      const s = cx.sub[k], t5 = acc.slice(0, 5), hasF = set => (item.f || []).some(i => set.has(i)), hasA = set => t5.some(i => set.has(i));
      if (k === 'woody' && isOud(item, model)) return 'Woody & oud';
      if (!s || hasF(s.f) || hasA(s.a)) return TILES[k].short;
      if (hasF(s.altF) || hasA(s.altA)) return s.alt;
      const t = cx.tiles[k], own = t5.find(i => t.a.includes(i) || t.a2.includes(i));
      return own != null && cx.V.a[own] ? cx.V.a[own] : TILES[k].short;
    };
    const named = (firm.length ? firm : matched.slice(0, 1)).slice(0, 2).map(word);
    if (named.length) {
      // One accord of its own that sets it apart (not part of the chosen cards, not a heads-up accord).
      const asked = new Set(); cards.forEach(k => { const t = cx.tiles[k]; t.a.concat(t.a2).forEach(i => asked.add(i)); });
      const own = top3.find(i => !asked.has(i) && !cx.bold.has(i) && cx.V.a[i]);
      parts.push(named.join(' + ') + (own != null ? ' with ' + cx.V.a[own].toLowerCase() + ' notes' : ''));
    } else if (r && r.explore) {
      const f2 = (item.f || []).map(i => cx.V.f[i]).filter(Boolean).slice(0, 2).map(x => x.toLowerCase());
      if (f2.length) parts.push((/^[aeiou]/i.test(f2[0]) ? 'an ' : 'a ') + f2.join(' & ') + ' scent to try');
    }
    const occs = Object.keys(OCCASIONS).filter(k => OCCASIONS[k].phrase);
    const listed = k => (cx.occ[k] || []).some(i => (item.o || []).includes(i));
    const occHit = (ans.occ || []).find(k => OCCASIONS[k].phrase && listed(k));
    if (occHit) parts.push('good for ' + OCCASIONS[occHit].phrase);
    else if ((ans.occ || []).some(k => OCCASIONS[k].phrase)) {          // asked, not listed: say what it is for instead
      const alt = occs.find(listed);
      if (alt) parts.push('better for ' + OCCASIONS[alt].phrase);
    }
    const kName = item.k >= 0 && cx.V.k[item.k];
    if (kName && (SUPPORTS[ans.strength] || []).includes(kName)) parts.push(CONC_NAME[kName] || kName);
    return parts.join(' · ');
  }
  function cautionFor(item, tiles, model) {
    const cx = context(model);
    const asked = new Set(); (tiles || []).forEach(k => { const t = cx.tiles[k]; if (t) t.a.concat(t.a2).forEach(i => asked.add(i)); });
    const hit = (item.a || []).slice(0, 3).find(a => cx.bold.has(a) && !asked.has(a));
    return hit != null ? 'Heads-up: it has ' + cx.bold.get(hit) + '.' : '';
  }

  // ── "Try all 3": live-verified lines only (no stale fallback) ──
  // live: Map id → ProductAPI product ({ inStock, sizes:[{ml,price}], salePercent, name, brand }).
  function bundleLines(picks, live, effPrice) {
    const eff = effPrice || effectivePrice;
    const lines = [], dropped = [];
    if (!live) return { ok: false, lines, dropped: picks.map(p => p.id), total: 0 };
    for (const p of picks) {
      const prod = live.get(p.id);
      const s3 = prod && (prod.sizes || []).find(s => Number(s.ml) === 3);
      if (!prod || !prod.inStock || !s3) { dropped.push(p.id); continue; }
      lines.push({ id: p.id, ml: 3, price: eff(Number(s3.price), Number(prod.salePercent) || 0),
        name: prod.name || p.item.nm, brand: prod.brand || '', sizes: (prod.sizes || []).map(s => ({ ml: Number(s.ml), price: eff(Number(s.price), Number(prod.salePercent) || 0) })) });
    }
    return { ok: lines.length > 0, lines, dropped, total: lines.reduce((t, l) => t + l.price, 0) };
  }
  // Each line's cart quantity must have risen by exactly one.
  function cartAdded(before, after, lines) {
    const qty = (cart, key) => { const l = (cart || []).find(i => i.key === key); return l ? Number(l.qty) || 0 : 0; };
    const failed = lines.filter(l => qty(after, l.id + '_' + l.ml) !== qty(before, l.id + '_' + l.ml) + 1).map(l => l.id);
    return { ok: failed.length === 0, failed };
  }

  // ════════════════════════════════════════════════════════════
  //  UI (browser only)
  // ════════════════════════════════════════════════════════════
  const STEPS = [
    { key: 'who', title: 'Who will wear it?', accent: 'wear', type: 'single', options: () => Object.keys(WHO).map(k => ({ key: k, label: WHO[k].label, desc: WHO[k].desc })) },
    { key: 'tiles', title: 'What kind of scents do you enjoy?', accent: 'scents', hint: 'Pick up to three', type: 'multi', max: 3,
      options: () => Object.keys(TILES).map(k => ({ key: k, label: TILES[k].label, desc: TILES[k].hint, swatch: k })).concat([{ key: EXPLORE, label: 'Explore Something New', desc: 'surprise me', swatch: EXPLORE }]) },
    { key: 'occ', title: 'When do you want to wear it?', accent: 'When', hint: 'Pick any that fit', type: 'multi', max: 6,
      options: () => Object.keys(OCCASIONS).map(k => ({ key: k, label: OCCASIONS[k].label })) },
    { key: 'strength', title: 'How strong do you like it?', accent: 'strong', type: 'single', options: () => Object.keys(STRENGTH).map(k => ({ key: k, label: STRENGTH[k].label, desc: STRENGTH[k].desc, meter: k })) },
    { key: 'budget', title: 'Your budget for a 3 ml decant', accent: 'budget', type: 'single', needsModel: true,
      options: st => (st.bands || []).map(b => ({ key: b.key, label: b.label, desc: b.range })).concat([{ key: 'any', label: 'No preference', desc: 'Any price' }]) },
  ];
  // Serif title with one gold word, as on the homepage teaser.
  const titleHtml = (t, w) => (w ? esc(t).replace(w, '<span>' + w + '</span>') : esc(t));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const st = { open: false, step: 0, ans: { who: null, tiles: [], occ: [], strength: null, budget: null }, model: null, bands: null,
    loading: null, error: false, results: null, live: null, liveState: 'idle', bundleDone: false, trigger: null, relaxed: [] };
  let el = null;

  function track(event, detail) {
    try { window.dispatchEvent(new CustomEvent('nawme:track', { detail: Object.assign({ event }, detail || {}) })); } catch (e) {}
  }
  function announce(text) { const l = el && el.querySelector('.qz-live'); if (l) { l.textContent = ''; setTimeout(() => { l.textContent = text; }, 30); } }

  function loadModel() {
    if (st.model) return Promise.resolve(st.model);
    if (st.loading) return st.loading;
    const R = window.NawmeRecs;
    st.error = false;
    st.loading = (R && R.prepare ? R.prepare() : Promise.resolve(null)).then(m => {
      st.loading = null;
      if (!m) { st.error = true; return null; }
      st.model = m; st.bands = bandOptions(m);
      return m;
    });
    return st.loading;
  }

  function stepValid(i) {
    const s = STEPS[i], v = st.ans[s.key];
    if (s.type === 'multi') return s.key === 'occ' ? true : v.length > 0;
    return !!v;
  }

  function renderStep() {
    const s = STEPS[st.step];
    const body = el.querySelector('.qz-body');
    el.querySelector('.qz-progress-bar').style.width = ((st.step + 1) / (STEPS.length + 1) * 100) + '%';   // full only on results
    el.querySelector('.qz-count').textContent = 'Step ' + (st.step + 1) + ' of ' + STEPS.length;
    let html = '<h2 class="qz-q" id="qz-title" tabindex="-1">' + titleHtml(s.title, s.accent) + '</h2>';
    if (s.hint) html += '<p class="qz-hint">' + esc(s.hint) + '</p>';
    if (st.ans.who === 'her' && s.key === 'tiles') html += '<p class="qz-note">We focus on unisex scents for her.</p>';
    if (s.needsModel && !st.model) {
      html += st.error ? errorHtml() : '<div class="qz-skel" aria-hidden="true"><span></span><span></span><span></span><span></span></div><p class="qz-hint">Loading our collection…</p>';
      body.innerHTML = html; footer(); if (!st.error) loadModel().then(() => { if (st.open && STEPS[st.step] === s) renderStep(); });
      return;
    }
    const opts = s.options(st);
    const multi = s.type === 'multi';
    html += '<div class="qz-options qz-' + s.key + '" role="' + (multi ? 'group' : 'radiogroup') + '" aria-labelledby="qz-title">';
    opts.forEach(o => {
      const on = multi ? st.ans[s.key].includes(o.key) : st.ans[s.key] === o.key;
      html += '<button type="button" class="qz-opt' + (o.swatch ? ' qz-tile qz-sw-' + o.swatch : '') + (o.meter ? ' qz-meter qz-m-' + o.meter : '') + '" data-key="' + esc(o.key) + '" '
        + (multi ? 'aria-pressed="' + on + '"' : 'role="radio" aria-checked="' + on + '"') + '>'
        + (o.swatch ? '<span class="qz-sw" aria-hidden="true"></span>' : '')
        + (o.meter ? '<span class="qz-bars" aria-hidden="true"><i></i><i></i><i></i></span>' : '')
        + '<span class="qz-opt-x"><span class="qz-opt-t">' + esc(o.label) + '</span>' + (o.desc ? '<span class="qz-opt-d">' + esc(o.desc) + '</span>' : '') + '</span></button>';
    });
    html += '</div>';
    body.innerHTML = html;
    footer();
    const t = el.querySelector('#qz-title'); if (t) t.focus({ preventScroll: true });
    announce('Step ' + (st.step + 1) + ' of ' + STEPS.length + ': ' + s.title);
  }
  function errorHtml() { return '<div class="qz-msg"><p>We couldn’t load our collection just now.</p><button type="button" class="qz-btn qz-retry">Try again</button></div>'; }

  function footer() {
    const back = el.querySelector('.qz-back'), next = el.querySelector('.qz-next');
    el.querySelector('.qz-foot').hidden = false;
    back.hidden = st.step === 0;
    const last = st.step === STEPS.length - 1;
    next.textContent = last ? 'Show My Matches' : 'Next';
    next.disabled = !stepValid(st.step) || (STEPS[st.step].needsModel && !st.model);
  }

  function choose(key) {
    const s = STEPS[st.step];
    if (s.type === 'multi') {
      const list = st.ans[s.key];
      const i = list.indexOf(key);
      if (i >= 0) list.splice(i, 1);
      else {
        if (s.key === 'occ' && key === 'allround') list.length = 0;
        if (s.key === 'occ' && key !== 'allround') { const a = list.indexOf('allround'); if (a >= 0) list.splice(a, 1); }
        if (list.length >= s.max) { announce('You can pick up to ' + s.max); return; }
        list.push(key);
      }
      el.querySelectorAll('.qz-opt').forEach(b => b.setAttribute('aria-pressed', String(list.includes(b.dataset.key))));
      if (s.max < 6) announce(list.length + ' of ' + s.max + ' selected');
    } else {
      st.ans[s.key] = key;
      el.querySelectorAll('.qz-opt').forEach(b => b.setAttribute('aria-checked', String(b.dataset.key === key)));
    }
    footer();
  }

  function go(delta) {
    if (delta > 0) {
      if (!stepValid(st.step)) return;
      track('scent_match_step_complete', { step: STEPS[st.step].key, value: [].concat(st.ans[STEPS[st.step].key]).join(',') });
      if (st.step === STEPS.length - 1) return showResults();
    }
    st.step = Math.max(0, Math.min(STEPS.length - 1, st.step + delta));
    if (st.step >= 1) loadModel();
    renderStep();
  }

  function answers() {
    const a = st.ans;
    return { who: a.who, tiles: a.tiles.slice(), occ: a.occ.filter(k => k !== 'allround'),
      strength: st.relaxed.includes('strength') ? 'any' : a.strength,
      budget: st.relaxed.includes('budget') || a.budget === 'any' ? null : a.budget };
  }

  function showResults() {
    if (!st.model) { loadModel().then(m => m && showResults()); return; }
    const R = window.NawmeRecs;
    const res = match(st.model, answers(), R.rank, { bands: st.bands });
    st.results = res; st.bundleDone = false; st.live = null; st.liveState = 'checking';
    track('scent_match_complete', { status: res.status, count: res.picks.length });
    renderResults();
    verifyLive();
  }

  function summary() {
    const a = st.ans, parts = [];
    if (a.who) parts.push(WHO[a.who].label);
    a.tiles.forEach(k => parts.push(k === EXPLORE ? 'Explore' : TILES[k].label));
    a.occ.filter(k => k !== 'allround').forEach(k => parts.push(OCCASIONS[k].label));
    if (a.strength && a.strength !== 'any' && !st.relaxed.includes('strength')) parts.push(STRENGTH[a.strength].label);
    const band = (st.bands || []).find(b => b.key === a.budget);
    if (band && !st.relaxed.includes('budget')) parts.push(band.range);
    return parts.join(' · ');
  }

  function liveSizes(p) {
    const prod = st.live && st.live.get(p.id);
    if (prod) return (prod.sizes || []).map(s => ({ ml: Number(s.ml), price: effectivePrice(Number(s.price), Number(prod.salePercent) || 0) }));
    return (p.item.s || []).map(s => ({ ml: s[0], price: effectivePrice(s[1], p.item.sp) }));
  }
  function imgUrl(item) {
    const base = (typeof IMAGE_BASE === 'string' && IMAGE_BASE) || 'https://cdn.nawmeessences.com';
    return base + '/storage/v1/object/public/product-images/' + encodeURIComponent(item.id) + '/thumb.webp?v=' + item.v;
  }

  function cardHtml(p, i) {
    const brand = st.model.vocab.b[p.item.b] || '';
    const prod = st.live && st.live.get(p.id);
    const oos = prod ? !prod.inStock : false;
    const sizes = liveSizes(p);
    const first = sizes.find(s => s.ml === 3) || sizes[0];
    const chips = sizes.map(s => '<button type="button" class="qz-size' + (s === first ? ' on' : '') + '" data-ml="' + s.ml + '" data-price="' + s.price + '" aria-pressed="' + (s === first) + '">' + s.ml + 'ml</button>').join('');
    return '<article class="qz-card' + (oos ? ' qz-oos' : '') + '" data-id="' + esc(p.id) + '" data-i="' + i + '">'
      + '<a class="qz-img" href="/product/' + encodeURIComponent(p.id) + '/" data-result="' + i + '" tabindex="-1" aria-hidden="true"><img src="' + esc(imgUrl(p.item)) + '" alt="" width="96" height="96" loading="lazy" decoding="async" onerror="this.style.visibility=\'hidden\'"></a>'
      + '<div class="qz-info"><span class="qz-label qz-l' + (p.label === 'Best Match' ? '1' : p.label === 'Alternative Pick' ? '2' : '3') + '">' + esc(p.label) + '</span>'
      + '<span class="qz-brand">' + esc(brand) + '</span>'
      + '<a class="qz-name" href="/product/' + encodeURIComponent(p.id) + '/" data-result="' + i + '">' + esc(p.item.nm) + '</a>'
      + (p.why ? '<p class="qz-why">' + esc(p.why) + '</p>' : '')
      + (p.caution ? '<p class="qz-caution">' + esc(p.caution) + '</p>' : '')
      + '<div class="qz-sizes" role="group" aria-label="Size">' + chips + '</div>'
      + '<div class="qz-buy"><span class="qz-price">৳' + (first ? first.price : '') + '</span>'
      + '<button type="button" class="qz-add"' + (oos ? ' disabled' : '') + '>' + (oos ? 'Out of stock' : 'Add to cart') + '</button>'
      + '<a class="qz-view" href="/product/' + encodeURIComponent(p.id) + '/" data-result="' + i + '">View fragrance</a></div></div></article>';
  }

  function bundleHtml() {
    const res = st.results;
    if (!res || res.picks.length < 2) return '';
    if (st.liveState === 'checking') return '<button type="button" class="qz-bundle" disabled>Checking live prices…</button>';
    if (st.liveState === 'failed') return '<button type="button" class="qz-bundle" disabled>Try all as 3 ml</button><p class="qz-hint qz-center">Couldn’t confirm live prices — please add items one by one.</p>';
    const b = bundleLines(res.picks, st.live, productAPI() && productAPI().effectivePrice);
    if (b.lines.length < 2) return '';
    const word = b.lines.length === 3 ? 'all 3' : 'both';
    if (st.bundleDone) return '<button type="button" class="qz-bundle" disabled>Added ✓</button>';
    return '<button type="button" class="qz-bundle" data-total="' + b.total + '">Try ' + word + ' · 3 ml each · ৳' + b.total + '</button>';
  }

  function renderResults() {
    const res = st.results, body = el.querySelector('.qz-body');
    el.querySelector('.qz-foot').hidden = true;
    el.querySelector('.qz-progress-bar').style.width = '100%';
    el.querySelector('.qz-count').textContent = 'Your matches';
    let html = '<h2 class="qz-q" id="qz-title" tabindex="-1">' + (res.status === 'none' ? titleHtml('No close match yet', 'match') : res.status === 'weak' ? titleHtml('The closest we have', 'closest') : titleHtml('Your matches', 'matches')) + '</h2>';
    html += '<p class="qz-summary">' + esc(summary()) + '</p>';
    if (res.status === 'none') {
      html += '<div class="qz-msg"><p>Nothing in stock fits all of these choices right now.</p>' + broadenHtml() + '</div>';
    } else {
      if (res.status === 'weak') html += '<p class="qz-note">These share only a little with what you picked — worth trying a 3 ml first.</p>';
      if (st.relaxed.length) html += '<p class="qz-note">Showing results with ' + st.relaxed.map(r => (r === 'budget' ? 'any budget' : 'any strength')).join(' and ') + '.</p>';
      html += '<div class="qz-results">' + res.picks.map(cardHtml).join('') + '</div>';
      html += '<div class="qz-bundle-wrap">' + bundleHtml() + '</div>';
      if (res.picks.length < 3) html += broadenHtml(true);
    }
    html += '<div class="qz-again"><button type="button" class="qz-link qz-edit">Edit answers</button><button type="button" class="qz-link qz-restart">Start over</button></div>';
    body.innerHTML = html;
    const t = el.querySelector('#qz-title'); if (t) t.focus({ preventScroll: true });
    body.scrollTop = 0;
    announce(res.status === 'none' ? 'No matches found' : res.picks.length + (res.picks.length === 1 ? ' match' : ' matches') + ' found');
  }
  function broadenHtml(quiet) {
    const can = (!st.relaxed.includes('strength') && st.ans.strength && st.ans.strength !== 'any') ? 'strength'
      : (!st.relaxed.includes('budget') && st.ans.budget && st.ans.budget !== 'any') ? 'budget' : null;
    return can ? '<button type="button" class="' + (quiet ? 'qz-link' : 'qz-btn') + ' qz-broaden" data-drop="' + can + '">Broaden my choices</button>' : '';
  }

  // js/api.js declares `const ProductAPI` at top level — a global binding, not a
  // window property — so it is reached by name, guarded for pages without it.
  const productAPI = () => (typeof ProductAPI !== 'undefined' ? ProductAPI : null);

  // Live stock + prices for the picks: ProductAPI.getAll() (rejects on failure).
  // The bundle only ever uses these; if they can't be confirmed it's disabled.
  function verifyLive() {
    const api = productAPI();
    const picks = st.results && st.results.picks || [];
    if (!picks.length) { st.liveState = 'idle'; return; }
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000));
    Promise.race([api && api.getAll ? api.getAll() : Promise.reject(new Error('no api')), timeout]).then(list => {
      const m = new Map(); (list || []).forEach(p => m.set(p.id, p));
      st.live = m; st.liveState = 'ok';
    }).catch(() => { st.live = null; st.liveState = 'failed'; }).then(() => {
      if (!st.open || !st.results) return;
      el.querySelectorAll('.qz-card').forEach(card => {             // refresh sizes/prices/stock in place
        const p = picks[Number(card.dataset.i)]; if (!p || !st.live) return;
        card.outerHTML = cardHtml(p, Number(card.dataset.i));
      });
      const w = el.querySelector('.qz-bundle-wrap'); if (w) w.innerHTML = bundleHtml();
      if (productAPI() && productAPI().hydrateCards) productAPI().hydrateCards();
    });
  }

  function addBundle(btn) {
    if (st.bundleDone || btn.disabled || st.liveState !== 'ok' || typeof addToCart !== 'function') return;
    const b = bundleLines(st.results.picks, st.live, productAPI() && productAPI().effectivePrice);
    if (b.lines.length < 2) return;
    btn.disabled = true; btn.textContent = 'Adding…';
    const before = JSON.parse(JSON.stringify(typeof getCart === 'function' ? getCart() : []));
    b.lines.forEach(l => addToCart(l.id, l.ml, l.price, l.name, l.brand, false, l.sizes, { silent: true }));
    const check = cartAdded(before, typeof getCart === 'function' ? getCart() : [], b.lines);
    if (check.ok) {
      st.bundleDone = true; btn.textContent = 'Added ✓';
      if (typeof showToast === 'function') showToast(b.lines.length + ' decants (3 ml each) added to cart!');
      if (window.Sfx && Sfx.add) Sfx.add();
      if (typeof updateCartBadge === 'function') updateCartBadge();
      announce(b.lines.length + ' decants added to cart');
    } else {
      btn.textContent = 'Some items couldn’t be added'; announce('Some items could not be added');
    }
  }

  function addOne(card) {
    const p = st.results.picks[Number(card.dataset.i)];
    const on = card.querySelector('.qz-size.on'); if (!p || !on || typeof addToCart !== 'function') return;
    addToCart(p.id, Number(on.dataset.ml), Number(on.dataset.price), p.item.nm, st.model.vocab.b[p.item.b] || '', false, liveSizes(p));
  }

  // ── open / close, history, focus ──
  function build() {
    el = document.getElementById('quiz');
    if (!el || el.dataset.ready) return el;
    el.dataset.ready = '1';
    el.innerHTML = '<div class="qz-backdrop" data-close></div><div class="qz-panel">'
      + '<div class="qz-head"><span class="qz-count">Step 1 of 5</span><button type="button" class="qz-close" aria-label="Close the scent quiz">&times;</button>'
      + '<div class="qz-progress" aria-hidden="true"><span class="qz-progress-bar"></span></div></div>'
      + '<div class="qz-body"></div>'
      + '<div class="qz-foot"><button type="button" class="qz-back">Back</button><button type="button" class="qz-next">Next</button></div>'
      + '<p class="qz-live" aria-live="polite"></p></div>';
    el.addEventListener('click', onClick);
    el.addEventListener('keydown', onKey);
    return el;
  }
  function onClick(e) {
    const t = e.target.closest('button, a, [data-close]'); if (!t) return;
    if (t.matches('[data-close], .qz-close')) return requestClose();
    if (t.classList.contains('qz-opt')) return choose(t.dataset.key);
    if (t.classList.contains('qz-next')) return go(1);
    if (t.classList.contains('qz-back')) return go(-1);
    if (t.classList.contains('qz-retry')) { st.error = false; st.loading = null; renderStep(); return; }
    if (t.classList.contains('qz-size')) {
      const card = t.closest('.qz-card'); card.querySelectorAll('.qz-size').forEach(b => { b.classList.toggle('on', b === t); b.setAttribute('aria-pressed', String(b === t)); });
      card.querySelector('.qz-price').textContent = '৳' + t.dataset.price; return;
    }
    if (t.classList.contains('qz-add')) return addOne(t.closest('.qz-card'));
    if (t.classList.contains('qz-bundle')) return addBundle(t);
    if (t.classList.contains('qz-broaden')) { st.relaxed.push(t.dataset.drop); return showResults(); }
    if (t.classList.contains('qz-edit')) { st.relaxed = []; st.step = STEPS.length - 1; return renderStep(); }
    if (t.classList.contains('qz-restart')) {
      track('scent_match_restart');
      st.ans = { who: null, tiles: [], occ: [], strength: null, budget: null }; st.relaxed = []; st.results = null; st.step = 0; return renderStep();
    }
    if (t.dataset.result != null) {
      track('scent_match_result_click', { position: Number(t.dataset.result) + 1, label: st.results.picks[Number(t.dataset.result)].label });
      // Leave via our own history entry first, so Back from the product lands
      // on the homepage once (no extra "dead" Back press). New-tab clicks pass.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1 || !(history.state && history.state.nawmeQuiz)) return;
      e.preventDefault();
      pendingNav = t.href;
      history.back();
      setTimeout(() => { if (pendingNav) { const u = pendingNav; pendingNav = null; location.assign(u); } }, 500);
    }
  }
  let pendingNav = null;
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); requestClose(); return; }
    if (e.key !== 'Tab') return;
    const f = [...el.querySelectorAll('button:not([disabled]):not([hidden]), a[href]:not([tabindex="-1"]), [tabindex="0"]')].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  const outside = () => ['.site-header', 'main', '.site-footer', '.announcement-bar'].map(s => document.querySelector(s)).filter(Boolean);

  function open(trigger) {
    if (!build() || st.open) return;
    st.open = true; st.trigger = trigger || document.activeElement;
    el.hidden = false; document.body.classList.add('quiz-open');
    outside().forEach(n => n.setAttribute('inert', ''));
    try { history.pushState({ nawmeQuiz: 1 }, ''); } catch (e) {}
    track('scent_match_open');
    if (st.results) renderResults(); else renderStep();
    loadModel();
  }
  function close() {
    if (!st.open) return;
    st.open = false; el.hidden = true; document.body.classList.remove('quiz-open');
    outside().forEach(n => n.removeAttribute('inert'));
    const t = st.trigger; if (t && t.focus) t.focus({ preventScroll: true });
  }
  // ✕ / Esc / backdrop: step back over our own history entry only, so closing
  // can never navigate away from the homepage.
  function requestClose() {
    if (history.state && history.state.nawmeQuiz) history.back(); else close();
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => {
      if (st.open) close();
      if (pendingNav) { const u = pendingNav; pendingNav = null; location.assign(u); }
    });
    window.addEventListener('pageshow', () => {
      if (history.state && history.state.nawmeQuiz && !st.open) { try { history.replaceState(null, ''); } catch (e) {} }
    });
  }

  return { TILES, OCCASIONS, STRENGTH, WHO, EXPLORE, W, TASTE, OUD_GAP, coverage, sameLine, isOud, POOL, POOL_WIDE, POOL_BRAND_CAP, MIN_COS, MIN_TASTE, BRAND_CAP, WEAK_COS,
    bands, bandOptions, excluded, buildAnchor, intensity, occasionFit, strengthFit, rerank, match, whyLine, cautionFor,
    bundleLines, cartAdded, price3, open, close, _state: st };
});
