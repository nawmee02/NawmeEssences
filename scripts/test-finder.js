// Unit checks for the "Find a Scent" build side (scripts/lib/finder.js,
// scripts/lib/asset-version.js, the sitemap entry) and, once present, the
// client engine (js/finder.js). Plain assert, no framework; runs inside
// `npm run build` after test-recs so a regression fails the deploy.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { buildRecs } = require('./lib/recs');
const { buildFinder, writeFinder, withoutCoPurchase, tokenize, STOP_WORDS, MAX_GZIP, MAX_KW, MIN_DF } = require('./lib/finder');
const { fetchCoPurchase, buildCoPurchase, QUALIFYING_STATUS, MIN_ORDERS, MIN_SUPPORT, TOP, LIFT_CAP } = require('./lib/copurchase');
const { buildAssetMap, versionHtml } = require('./lib/asset-version');

const ROOT = path.join(__dirname, '..');
const warn = m => console.warn('test-finder: WARNING — ' + m);

// Longevity / projection wording the finder must never emit while the
// catalogue has no such data. Shared with the engine section below (D):
// run every reply template (`T`) and every lexicon string through it.
const BANNED = /lasts? longer|long[\s-]?lasting|\b\d+\s*hours?\b|\bbeast\b|\bperformance\b|\bprojection\b|\bsillage\b/i;

// ── synthetic catalogue (same as scripts/test-recs.js, plus descriptions) ──
const products = [
  { id: 'a', name: 'Alpha', brand: 'Rasasi', collection: 'regular', inStock: true, is_bestseller: true, updatedAt: '2026-10-07T16:38:54.05535+00:00', salePercent: 0, sizes: [{ ml: 5, price: 250 }, { ml: 3, price: 170 }], tags: ['new'] },
  { id: 'b', name: 'Bravo', brand: 'Rasasi', collection: 'regular', inStock: true, is_bestseller: false, updatedAt: '2026-10-01T00:00:00+00:00', salePercent: 10, sizes: [{ ml: 3, price: 200 }], tags: [] },
  { id: 'c', name: 'Charlie', brand: 'Lattafa', collection: 'exclusive', inStock: false, is_bestseller: false, updatedAt: '2026-09-01T00:00:00+00:00', salePercent: 0, sizes: [{ ml: 3, price: 600 }], tags: ['discontinued'] },
  { id: 'd', name: 'Delta', brand: 'Afnan', collection: 'regular', inStock: true, is_bestseller: false, updatedAt: '2026-08-01T00:00:00+00:00', salePercent: 0, sizes: [], tags: [] },
  { id: 'e', name: 'Dior Sauvage EDP', brand: 'Dior', collection: 'regular', inStock: true, is_bestseller: true, updatedAt: '2026-07-01T00:00:00+00:00', salePercent: 0, sizes: [{ ml: 3, price: 300 }, { ml: 5, price: 480 }], tags: [] },
];
const details = {
  a: { family: 'Oriental / Spicy', accords: ['Woody', 'Musky.'], top: ['Bergamot'], heart: ['Patchouli.'], base: ['Ambroxan.'], occasions: ['Office', 'Everyday'], gender: 'men', concentration: 'EDP', inspiredBy: ['Creed Aventus', 'creed aventus.'],
    description: 'Buy authentic Rasasi Alpha decants in Bangladesh. Alpha is a mature, classy fragrance for men by [Rasasi](/brands/rasasi/) with a woody clubbing character. Mature mature compliment magnet; bergamot opens it.' },
  b: { family: 'Oriental Spicy', accords: ['Musky', 'woody'], top: ['Patchouli'], heart: [], base: ['Elemi resin'], occasions: [], gender: '', concentration: '', longevity: 4, projection: '3',
    description: 'A unisex fragrance launched in 2020. Compliment magnet with a clubbing vibe, soapy and classy. Mature woody dry-down. See [Alpha](/product/a/).' },
  c: { family: 'Fruity/Woody', accords: ['Fruity'], top: ['Granny Smith apple'], heart: ['Elemi Resin'], base: [], occasions: ['Party'], gender: 'unisex', concentration: 'Extrait', inspiredBy: ['Xerjoff Naxos'],
    description: 'Fruity, playful and youthful; a clubbing scent with a soapy finish, a magnet for attention. Rarewordzzz appears once only.' },
  d: { family: 'Aquatic', accords: [], top: [], heart: [], base: [], occasions: [], gender: '', concentration: '', description: 'Sizeless product — must be dropped by recs.' },
  e: { family: 'Aromatic Fougère', accords: ['Fresh Spicy', 'Citrus', 'Aromatic'], top: ['Bergamot', 'Pepper'], heart: ['Lavender'], base: ['Ambroxan'], occasions: ['Office', 'Everyday', 'Summer'], gender: 'men', concentration: 'EDP',
    description: 'Buy authentic Dior Sauvage EDP decants in Bangladesh. Sauvage is a fresh spicy fragrance for men with pepper and bergamot. Classy and youthful, a compliment magnet for office days.' },
};
const derive = {
  occasionsOf: d => (d.occasions && d.occasions.length ? d.occasions : ['Everyday']),
  concentrationOf: (d, name, text) => d.concentration || (/\bEDT\b/.test(name) ? 'EDT' : ''),
  genderOf: (d, text) => ({ men: 'Men', women: 'Women', unisex: 'Unisex' }[String(d.gender || '').toLowerCase()] || (/unisex/i.test(text) ? 'Unisex' : '')),
  imageVersion: u => Math.floor(new Date(u).getTime() / 1000),
};

// ── builder ────────────────────────────────────────────────────
const recs = buildRecs(products, details, derive);
const recsJson = JSON.stringify(recs);
const logs = [];
const data = buildFinder(recs, details, { log: m => logs.push(m) });

assert.strictEqual(JSON.stringify(recs), recsJson, 'buildFinder does not mutate the recs data');
assert.strictEqual(data.v, 1);
assert.strictEqual(data.src, recs.src, 'src copied from recs');
for (const k of ['b', 'f', 'a', 'n', 'o', 'k']) assert.deepStrictEqual(data.vocab[k], recs.vocab[k], `vocab.${k} identical to recs (same indices)`);
assert.deepStrictEqual(data.items.map(i => i.id), recs.items.map(i => i.id), 'same items, same order');
data.items.forEach((it, i) => {
  const { kw, ref, lg, pj, ...rest } = it;
  assert.deepStrictEqual(rest, recs.items[i], `item ${it.id}: every recs field unchanged`);
  assert.ok(Array.isArray(kw) && kw.length <= MAX_KW, 'kw is an array of ≤ 12 indices');
  assert.ok(kw.every(x => Number.isInteger(x) && x >= 0 && x < data.vocab.w.length), 'kw indices point into vocab.w');
  assert.ok(ref.every(x => Number.isInteger(x) && x >= 0 && x < data.vocab.r.length), 'ref indices point into vocab.r');
});

// Tokeniser: lower-case, ≥ 4 letters, markdown link targets and URLs dropped.
assert.deepStrictEqual(tokenize('Buy [Hugo Boss](/brands/hugo-boss/) at https://nawmeessences.com/x now, Dry-down!'), ['hugo', 'boss', 'down']);
assert.ok(['perfume', 'fragrance', 'decant', 'decants', 'bangladesh', 'authentic', 'buy', 'order', 'delivery', 'nawmeessences', 'scent', 'notes', 'note', 'bottle', 'original', 'price', 'sizes', 'size', 'ml'].every(w => STOP_WORDS.has(w)), 'spec stop-words present');

// Keyword extraction.
const W = data.vocab.w;
const kwOf = id => data.items.find(i => i.id === id).kw.map(i => W[i]);
const A = kwOf('a'), B = kwOf('b'), C = kwOf('c'), E = kwOf('e');
assert.ok(A.includes('mature') && A.includes('clubbing') && A.includes('classy'), 'description words shared by ≥ 2 products become keywords');
assert.ok(!A.includes('alpha') && !A.includes('rasasi'), 'own name / brand tokens dropped');
assert.ok(!E.includes('dior') && !E.includes('sauvage'), 'own name / brand tokens dropped (multi-word name)');
assert.ok(!A.includes('woody') && !A.includes('bergamot') && !E.includes('pepper') && !E.includes('lavender'), 'tokens that are already a/n/f/o features are not keywords');
assert.ok(!A.includes('authentic') && !A.includes('decants') && !A.includes('bangladesh') && !A.includes('brands'), 'stop-words and link-path words dropped');
assert.ok(!C.includes('rarewordzzz'), `a token in < ${MIN_DF} descriptions never enters vocab.w`);
assert.ok(!W.includes('rarewordzzz'));
assert.ok(!A.includes('fragrance') && !E.includes('men'), 'nothing shorter than 4 letters, no stop-words');
assert.ok(!W.includes('magnet'), 'a token present in EVERY description (idf 0) is not a keyword');
assert.ok(W.includes('compliment'), 'a token in 3 of 4 descriptions is a keyword');
assert.strictEqual(A[0], 'mature', 'ranked by tf·idf: "mature" (tf 3) outranks the single-occurrence words');
// Ties by first occurrence: in A, "classy" (pos before "clubbing") both tf 1 with equal df → classy first.
assert.ok(A.indexOf('classy') < A.indexOf('clubbing'), 'equal score → earlier first occurrence wins');
assert.ok(B.includes('soapy') && C.includes('soapy'), 'shared keywords get the same vocab index');
assert.strictEqual(data.items[1].kw[B.indexOf('soapy')], data.items[2].kw[C.indexOf('soapy')]);
// vocab.w is in first-seen order (item order, then rank order inside the item).
assert.deepStrictEqual(W.slice(0, A.length), A, 'vocab.w starts with the first item\'s keywords in rank order');
assert.ok(new Set(W).size === W.length, 'vocab.w has no duplicates');
// ≤ 12 cap.
const word = i => 'kw' + 'abcdefghijklmnopqrstuvwxyz'[i % 26] + 'abcdefghijklmnopqrstuvwxyz'[Math.floor(i / 26)] + 'zz';
const many = { ...details, a: { ...details.a, description: Array.from({ length: 30 }, (_, i) => `${word(i)} `.repeat(3)).join(' ') }, b: { ...details.b, description: Array.from({ length: 30 }, (_, i) => word(i)).join(' ') } };
assert.strictEqual(buildFinder(recs, many).items[0].kw.length, MAX_KW, 'at most 12 keywords per product');

// Refs (inspired_by): normalised, case-insensitively de-duplicated, first-seen order; absent → [].
assert.deepStrictEqual(data.vocab.r, ['Creed Aventus', 'Xerjoff Naxos'], 'vocab.r: trailing punctuation stripped, case-folded duplicates merged');
assert.deepStrictEqual(data.items[0].ref, [0], 'duplicate names collapse to one index');
assert.deepStrictEqual(data.items[1].ref, [], 'no inspired_by → []');
assert.deepStrictEqual(data.items[2].ref, [1]);
const noRefs = buildFinder(recs, Object.fromEntries(Object.entries(details).map(([k, v]) => [k, { ...v, inspiredBy: undefined }])));
assert.deepStrictEqual(noRefs.vocab.r, [], 'column absent → vocab.r is an empty array');
assert.ok(noRefs.items.every(i => Array.isArray(i.ref) && i.ref.length === 0));

// Future fields: lg / pj only when numeric.
assert.strictEqual(data.items[0].lg, undefined); assert.strictEqual(data.items[0].pj, undefined);
assert.strictEqual(data.items[1].lg, 4); assert.strictEqual(data.items[1].pj, 3, 'numeric strings are accepted');
assert.ok(!('lg' in data.items[2]) && !('pj' in data.items[2]), 'keys omitted, not null');
assert.ok(logs.some(m => /longevity set on 1\/4/.test(m) && /projection set on 1\/4/.test(m)), 'coverage logged: ' + logs.join(' | '));

// Missing / empty descriptions and unknown ids are tolerated.
const bare = buildFinder(recs, {});
assert.ok(bare.items.every(i => i.kw.length === 0 && i.ref.length === 0) && bare.vocab.w.length === 0);
assert.throws(() => buildFinder({ v: 2, items: [] }, {}), /buildRecs/);

// Deterministic: the same input twice gives the same bytes, and shuffled
// productDetails key order changes nothing (output follows recs item order).
assert.strictEqual(JSON.stringify(buildFinder(recs, details)), JSON.stringify(data));
const reversed = Object.fromEntries(Object.entries(details).reverse());
assert.strictEqual(JSON.stringify(buildFinder(recs, reversed)), JSON.stringify(data));

// Writer: minified file, round-trips, reports sizes.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finder-'));
const stats = writeFinder(tmp, data);
const written = fs.readFileSync(path.join(tmp, 'data', 'finder.json'), 'utf8');
assert.strictEqual(written, JSON.stringify(data), 'minified JSON, no whitespace');
assert.strictEqual(stats.raw, written.length); assert.strictEqual(stats.items, data.items.length);
assert.strictEqual(stats.gz, zlib.gzipSync(written).length);
assert.ok(stats.gz <= MAX_GZIP);

// Size guard: 20 KB gzip.
assert.strictEqual(MAX_GZIP, 20 * 1024);
const big = { ...data, items: Array.from({ length: 5000 }, (_, i) => ({ ...data.items[0], id: 'p' + i, nm: 'Product number ' + i + ' ' + Math.random() })) };
assert.ok(zlib.gzipSync(JSON.stringify(big)).length > MAX_GZIP);
assert.throws(() => writeFinder(tmp, big), /over the/);
assert.strictEqual(fs.readFileSync(path.join(tmp, 'data', 'finder.json'), 'utf8'), written, 'a rejected write leaves the previous file intact');

// ── co-purchase (scripts/lib/copurchase.js) ─────────────────────
// recs.items order: a=0, b=1, c=2, e=3 (d has no sizes and is dropped by recs).
assert.deepStrictEqual(recs.items.map(i => i.id), ['a', 'b', 'c', 'e']);
assert.strictEqual(MIN_ORDERS, 30); assert.strictEqual(MIN_SUPPORT, 2); assert.strictEqual(TOP, 5); assert.strictEqual(LIFT_CAP, 10);
assert.deepStrictEqual(QUALIFYING_STATUS, ['confirmed', 'dispatched', 'delivered']);
let orderSeq = 0;
const basket = (ids, times = 1) => {
  const out = [];
  for (let t = 0; t < times; t++) { const orderId = 'o' + (++orderSeq); for (const fragranceId of ids) out.push({ orderId, fragranceId }); }
  return out;
};
// 33 qualifying orders: 20×{a,e}, 8×{a,b}, 4×{b,c,e}, 1×{a,c}; plus noise that must not count.
const synthetic = [
  ...basket(['a', 'e'], 19), ...basket(['a', 'ghost', 'e']),   // a product missing from the catalogue is ignored (still {a,e})
  ...basket(['a', 'b'], 7), ...basket(['a', 'b', 'b']),         // duplicate lines count once
  ...basket(['b', 'c', 'e'], 4), ...basket(['a', 'c']),         // a–c support 1 → never a pair
  ...basket(['a'], 5), ...basket(['e', 'ghost'], 3), ...basket(['ghost', 'phantom']),   // < 2 catalogue products → not qualifying
  { orderId: 'bad', fragranceId: null }, { orderId: null, fragranceId: 'a' }, null,    // junk lines tolerated
];
const cpLogs = [];
const cpMap = buildCoPurchase(synthetic, recs.items, { log: m => cpLogs.push(m) });
// N = 33; singles a 29, b 12, c 5, e 24; pairs a–e 20, a–b 8, b–c 4, b–e 4, c–e 4.
// lift = nAB·N / (nA·nB): a–e 0.948, a–b 0.759, b–c 2.2, b–e 0.458, c–e 1.1 → w = round2(lift / 10).
assert.deepStrictEqual(cpMap, {
  a: [[3, 0.09], [1, 0.08]],
  b: [[2, 0.22], [0, 0.08], [3, 0.05]],
  c: [[1, 0.22], [3, 0.11]],
  e: [[2, 0.11], [0, 0.09], [1, 0.05]],
}, 'lift-scored pairs, support ≥ 2, ordered w desc then idx asc');
assert.ok(cpLogs.some(m => /co-purchase: 33 qualifying orders → pairs on 4\/4 products/.test(m)), cpLogs.join(' | '));
// Deterministic: line order does not matter.
assert.strictEqual(JSON.stringify(buildCoPurchase(synthetic.slice().reverse(), recs.items)), JSON.stringify(cpMap));
// Accepts the fetchCoPurchase() wrapper shape and null.
assert.strictEqual(JSON.stringify(buildCoPurchase({ orders: 40, lines: synthetic }, recs.items)), JSON.stringify(cpMap));
const nullLogs = [];
assert.strictEqual(buildCoPurchase(null, recs.items, { log: m => nullLogs.push(m) }), null, 'no order data → null');
assert.strictEqual(buildCoPurchase(undefined, recs.items), null);
assert.strictEqual(buildCoPurchase({ orders: 0 }, recs.items), null);
assert.ok(nullLogs.some(m => /co-purchase skipped: no order data/.test(m)));
// < 30 qualifying orders → null with the exact log line.
orderSeq = 0;
const few = [...basket(['a', 'e'], 29), ...basket(['a'], 50)];
const fewLogs = [];
assert.strictEqual(buildCoPurchase(few, recs.items, { log: m => fewLogs.push(m) }), null, '29 qualifying orders → skipped');
assert.ok(fewLogs.some(m => m === 'co-purchase skipped: 29 qualifying orders < 30'), fewLogs.join(' | '));
assert.ok(buildCoPurchase([...few, ...basket(['a', 'e'])], recs.items) !== null, '30 qualifying orders → built');
// Nothing reaches support 2 → null (not an empty map).
orderSeq = 0;
const fake = Array.from({ length: 8 }, (_, i) => ({ id: 'q' + i }));
const thin = [];
for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) thin.push(...basket(['q' + i, 'q' + j]));   // 28 distinct pairs, support 1 each
assert.strictEqual(buildCoPurchase([...thin, ...basket(['q0', 'q1', 'q2'])], fake, { minOrders: 1, minSupport: 3 }), null);
// Lift cap: lift ≥ 10 → w = 1; top 5 kept, ties broken by idx.
orderSeq = 0;
const capped = buildCoPurchase([...basket(['a', 'b'], 2), ...basket(['c', 'e'], 20)], recs.items, { minOrders: 1 });
assert.deepStrictEqual(capped.a, [[1, 1]], 'lift 22 → w capped at 1');
assert.deepStrictEqual(capped.c, [[3, 0.11]]);
orderSeq = 0;
const star = buildCoPurchase(Array.from({ length: 6 }, (_, k) => basket(['q0', 'q' + (k + 1)], 2)).flat(), fake, { minOrders: 1 });
assert.deepStrictEqual(star.q0, [[1, 0.1], [2, 0.1], [3, 0.1], [4, 0.1], [5, 0.1]], 'at most 5 pairs per product, equal w → lower idx first');
assert.deepStrictEqual(star.q6, [[0, 0.1]], 'the sixth partner still lists q0 from its own side');
assert.strictEqual(star.q7, undefined, 'products without pairs are absent from the map');
assert.throws(() => buildCoPurchase([], 'nope'), /items must be an array/);

// buildFinder(opts.coPurchase): cp written only where pairs exist, idx = index in items.
const withCp = buildFinder(recs, details, { coPurchase: cpMap, log: m => cpLogs.push(m) });
assert.deepStrictEqual(withCp.items.map(i => i.cp), [cpMap.a, cpMap.b, cpMap.c, cpMap.e]);
withCp.items.forEach((it, i) => {
  const { kw, ref, lg, pj, cp, ...rest } = it;
  assert.deepStrictEqual(rest, recs.items[i], 'every recs field unchanged with cp');
  for (const [idx, w] of cp) { assert.ok(Number.isInteger(idx) && idx >= 0 && idx < withCp.items.length && idx !== i, 'cp idx points at another item'); assert.ok(w > 0 && w <= 1, 'w ∈ (0, 1]'); }
});
assert.ok(cpLogs.some(m => m === 'co-purchase pairs on 4/4 products'), cpLogs.join(' | '));
assert.strictEqual(JSON.stringify(buildFinder(recs, details, { coPurchase: cpMap })), JSON.stringify(withCp), 'deterministic with cp');
assert.deepStrictEqual(withoutCoPurchase(withCp), data, 'cp is the only difference from the plain build');

// ── Fragrantica "reminds me of" → sim (catalogue pairs) + cref (famous references) ──
{
  const reminds = { v: 1, items: {
    a: { page: '/perfume/Rasasi/Alpha-1.html', reminds: [
      { h: '/perfume/Dior/Dior-Sauvage-EDP-5.html', label: 'DIOR Sauvage Eau de Parfum', up: 300, down: 30 },   // our product e → catalogue pair
      { h: '/perfume/Creed/Aventus-9.html', label: 'CREED Aventus', up: 100, down: 10 },                      // famous reference → cref
      { h: '/perfume/Lattafa/Asad-7.html', label: 'LATTAFA PERFUMES Asad', up: 500, down: 10 },               // clone house → never a reference
      { h: '/perfume/Zara/Thing-3.html', label: 'ZARA Thing', up: 3, down: 0 },                               // too few votes
      { h: '/perfume/Chanel/Bleu-2.html', label: 'CHANEL Bleu de Chanel', up: 40, down: 30 } ] },             // ratio < 2 → no cref, but the pair rule is for catalogue pages only
    e: { page: '/perfume/Dior/Dior-Sauvage-EDP-5.html', reminds: [] },
  } };
  const withSim = buildFinder(recs, details, { reminds });
  const idx = id => withSim.items.findIndex(it => it.id === id);
  const a = withSim.items[idx('a')], e = withSim.items[idx('e')];
  assert.deepStrictEqual(a.sim, [[idx('e'), a.sim[0][1]]], 'a → e catalogue pair from the vote');
  assert.ok(a.sim[0][1] > 0.5 && a.sim[0][1] <= 1, 'pair weight from votes: ' + a.sim[0][1]);
  assert.deepStrictEqual(e.sim, [[idx('a'), a.sim[0][1]]], 'the pair is symmetric');
  assert.ok(a.cref && a.cref.length === 1 && withSim.vocab.r[a.cref[0][0]].toLowerCase() === 'creed aventus', 'only the famous, well-voted reference becomes cref (shares the inspired_by name, case-insensitively): ' + JSON.stringify(a.cref) + ' ' + withSim.vocab.r[a.cref[0][0]]);
  assert.ok(!withSim.items.some(it => it.id !== 'a' && it.cref), 'no other cref');
  assert.strictEqual(JSON.stringify(buildFinder(recs, details, { reminds })), JSON.stringify(withSim), 'deterministic with reminds');
  const noSim = buildFinder(recs, details, { reminds: false });
  assert.ok(!noSim.items.some(it => it.sim || it.cref) && noSim.vocab.r.length === data.vocab.r.length, 'reminds:false → no community fields');
}
assert.ok(!('cp' in buildFinder(recs, details, { coPurchase: null }).items[0]), 'coPurchase null → cp omitted');
assert.ok(!('cp' in data.items[0]), 'coPurchase absent → cp omitted');
assert.strictEqual(JSON.stringify(buildFinder(recs, details, { coPurchase: null })), JSON.stringify(data));
const partial = buildFinder(recs, details, { coPurchase: { b: [[0, 0.5]], zz: [[0, 1]], c: [], e: 'junk' } });
assert.deepStrictEqual(partial.items.map(i => i.cp), [undefined, [[0, 0.5]], undefined, undefined], 'only items with a non-empty valid list get cp; unknown ids ignored');
const malformed = buildFinder(recs, details, { coPurchase: { a: [[0, 0.5], [9, 0.5], [-1, 0.5], [1, 0], [1, 'x'], [2], 'junk', [3, '0.25']] } });
assert.deepStrictEqual(malformed.items[0].cp, [[3, 0.25]], 'self / out-of-range / non-positive / malformed entries dropped, numeric strings accepted');
// Writer: cp inside the budget is kept and reported.
const stats2 = writeFinder(tmp, withCp, {});
assert.strictEqual(fs.readFileSync(path.join(tmp, 'data', 'finder.json'), 'utf8'), JSON.stringify(withCp));
assert.deepStrictEqual({ cp: stats2.cp, dropped: stats2.cpDropped, items: stats2.items }, { cp: 4, dropped: false, items: 4 });
assert.ok(stats2.gz <= MAX_GZIP);
// Writer fallback: when cp alone pushes the file over 20 KB gzip, cp is dropped (logged), not the build.
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const baseItems = Array.from({ length: 1500 }, (_, i) => ({ ...data.items[0], id: 'p' + i }));
const under = { ...data, items: baseItems };
assert.ok(zlib.gzipSync(JSON.stringify(under)).length <= MAX_GZIP, 'base fixture must fit the budget');
const over = { ...data, items: baseItems.map((it, i) => ({ ...it, cp: Array.from({ length: 5 }, () => [Math.floor(rnd() * 1500), Math.round(rnd() * 100) / 100]).filter(e => e[0] !== i && e[1] > 0) })) };
assert.ok(zlib.gzipSync(JSON.stringify(over)).length > MAX_GZIP, 'fixture with random cp must exceed the budget');
const dropLogs = [];
const stats3 = writeFinder(tmp, over, { log: m => dropLogs.push(m) });
assert.strictEqual(stats3.cpDropped, true); assert.strictEqual(stats3.cp, 0); assert.ok(stats3.gz <= MAX_GZIP);
assert.strictEqual(fs.readFileSync(path.join(tmp, 'data', 'finder.json'), 'utf8'), JSON.stringify(withoutCoPurchase(over)), 'written without cp');
assert.ok(dropLogs.length === 1 && /over the .* budget, cp dropped/.test(dropLogs[0]), dropLogs.join(' | '));
assert.ok(!JSON.parse(fs.readFileSync(path.join(tmp, 'data', 'finder.json'), 'utf8')).items.some(i => 'cp' in i));
assert.throws(() => writeFinder(tmp, { ...big, items: big.items.map(it => ({ ...it, cp: [[1, 0.5]] })) }, {}), /over the/, 'still throws when the file is over budget without cp');
assert.strictEqual(JSON.stringify(over).includes('"cp"'), true, 'the caller\'s data is not mutated by the fallback');

// fetchCoPurchase against a fake Supabase client: status + date filters, paging, chunked order_items, errors → null.
const fakeSb = (tables, failOn) => ({
  from(name) {
    const filters = [];
    const q = {
      select() { return q; },
      in(col, vals) { filters.push(r => vals.includes(r[col])); return q; },
      gte(col, v) { filters.push(r => r[col] >= v); return q; },
      not(col, op, v) { assert.strictEqual(op, 'is'); assert.strictEqual(v, null); filters.push(r => r[col] != null); return q; },
      order() { return q; },
      range(from, to) {
        if (failOn === name) return Promise.resolve({ data: null, error: { message: 'relation "' + name + '" does not exist', code: '42P01' } });
        const rows = (tables[name] || []).filter(r => filters.every(f => f(r)));
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
    };
    return q;
  },
});
const recent = new Date(Date.now() - 10 * 86400000).toISOString(), ancient = new Date(Date.now() - 400 * 86400000).toISOString();
const ordersTbl = [], itemsTbl = [];
for (let i = 0; i < 1250; i++) { ordersTbl.push({ id: 'ok' + i, status: QUALIFYING_STATUS[i % 3], created_at: recent }); itemsTbl.push({ order_id: 'ok' + i, fragrance_id: 'a' }, { order_id: 'ok' + i, fragrance_id: 'e' }); }
ordersTbl.push({ id: 'pend', status: 'pending', created_at: recent }, { id: 'canc', status: 'cancelled', created_at: recent }, { id: 'old', status: 'delivered', created_at: ancient });
itemsTbl.push({ order_id: 'pend', fragrance_id: 'b' }, { order_id: 'canc', fragrance_id: 'b' }, { order_id: 'old', fragrance_id: 'b' }, { order_id: 'ok0', fragrance_id: null });
(async () => {
  const fLogs = [];
  const got = await fetchCoPurchase(fakeSb({ orders: ordersTbl, order_items: itemsTbl }), { log: m => fLogs.push(m) });
  assert.strictEqual(got.orders, 1250, 'pending / cancelled / older than 180 days excluded; paging past 1000 rows works');
  assert.strictEqual(got.lines.length, 2500, 'order_items fetched in id chunks; null fragrance_id dropped');
  assert.ok(got.lines.every(l => l.orderId.startsWith('ok') && (l.fragranceId === 'a' || l.fragranceId === 'e')));
  assert.ok(fLogs.some(m => /co-purchase: 1250 qualifying orders \/ 2500 order lines in the last 180 days/.test(m)), fLogs.join(' | '));
  const built = buildCoPurchase(got, recs.items);
  assert.deepStrictEqual(built, { a: [[3, 0.1]], e: [[0, 0.1]] }, 'end-to-end: lift 1 → w 0.1');
  const eLogs = [];
  assert.strictEqual(await fetchCoPurchase(fakeSb({ orders: ordersTbl, order_items: itemsTbl }, 'order_items'), { log: m => eLogs.push(m) }), null, 'any error → null');
  assert.ok(eLogs.length === 1 && /co-purchase skipped: relation "order_items" does not exist/.test(eLogs[0]), eLogs.join(' | '));
  assert.strictEqual(await fetchCoPurchase(fakeSb({}, 'orders')), null);
  assert.strictEqual(await fetchCoPurchase(null), null, 'no client → null, no throw');
  const empty = await fetchCoPurchase(fakeSb({}));
  assert.deepStrictEqual(empty, { orders: 0, lines: [] }, 'anon key / no orders → empty set (buildCoPurchase then skips)');
  assert.strictEqual(buildCoPurchase(empty, recs.items), null);
  console.log('test-finder: co-purchase fetch checks passed');
})().catch(e => { console.error(e); process.exit(1); });

// ── asset versioning (scripts/lib/asset-version.js) ────────────
const aroot = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-'));
for (const [f, body] of Object.entries({ 'css/style.css': 'body{}', 'css/finder.css': '.finder{}', 'js/main.js': '1', 'js/finder.js': '2', 'data/recs.json': '{"v":1}', 'data/finder.json': '{"v":1,"w":[]}', 'data/finder-emb.bin': 'bin', 'data/notes.txt': 'x', 'js/readme.md': 'x' })) {
  fs.mkdirSync(path.join(aroot, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(aroot, f), body);
}
const amap = buildAssetMap(aroot);
const sha8 = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
assert.deepStrictEqual(Object.keys(amap).sort(), ['css/finder.css', 'css/style.css', 'data/finder-emb.bin', 'data/finder.json', 'data/recs.json', 'js/finder.js', 'js/main.js'], 'css/*.css, js/*.js, data/*.json|bin hashed; other files ignored');
assert.strictEqual(amap['css/style.css'], sha8('body{}'), 'hash = first 8 hex of sha1 (unchanged scheme)');
assert.strictEqual(amap['data/recs.json'], sha8('{"v":1}'));
const htmlIn = [
  '<link rel="stylesheet" href="css/style.css" />',
  '<link rel="stylesheet" href="/css/style.css?v=old12345" />',
  '<link rel="stylesheet" href="css/finder.css" />',
  '<script src="js/main.js" defer></script>',
  '<script src="js/recs.js" defer data-recs="data/recs.json"></script>',
  '<script src="/js/finder.js" defer data-finder="/data/finder.json?v=stale" data-emb="data/finder-emb.bin"></script>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter" />',
  '<a href="css/missing.css">x</a>',
  '<img src="assets/images/x.webp" />',
].join('\n');
const htmlOut = versionHtml(htmlIn, amap);
assert.ok(htmlOut.includes(`href="css/style.css?v=${amap['css/style.css']}"`), 'css/style.css stamped as before');
assert.ok(htmlOut.includes(`href="/css/style.css?v=${amap['css/style.css']}"`), 'leading slash kept, stale ?v= replaced');
assert.ok(htmlOut.includes(`href="css/finder.css?v=${amap['css/finder.css']}"`), 'css/finder.css stamped');
assert.ok(htmlOut.includes(`src="js/main.js?v=${amap['js/main.js']}"`), 'js stamped as before');
assert.ok(htmlOut.includes(`data-recs="data/recs.json?v=${amap['data/recs.json']}"`), 'data-recs stamped as before');
assert.ok(htmlOut.includes(`data-finder="/data/finder.json?v=${amap['data/finder.json']}"`), 'data-finder stamped');
assert.ok(htmlOut.includes(`data-emb="data/finder-emb.bin?v=${amap['data/finder-emb.bin']}"`), 'data/*.bin stamped');
assert.ok(htmlOut.includes('src="js/recs.js"'), 'an asset missing from the map is left untouched');
assert.ok(htmlOut.includes('href="css/missing.css"'), 'unknown css left untouched');
assert.ok(htmlOut.includes('https://fonts.googleapis.com/css2?family=Inter"') && htmlOut.includes('src="assets/images/x.webp"'), 'external / non-asset URLs untouched');
assert.strictEqual(versionHtml(htmlOut, amap), htmlOut, 'idempotent');
// The real repo map still carries the three historical keys.
const realMap = buildAssetMap(ROOT);
for (const k of ['css/style.css', 'js/recs.js', 'js/main.js', 'js/render-card.js']) assert.ok(/^[0-9a-f]{8}$/.test(realMap[k] || ''), `${k} hashed`);
assert.ok(Object.keys(realMap).every(k => /^(css\/[^/]+\.css|js\/[^/]+\.js|data\/[^/]+\.(json|bin))$/.test(k)));

// ── build plumbing (string checks of the build sources) ─────────
const genSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'generate-product-pages.js'), 'utf8');
assert.ok(/loc: `\$\{SITE\}\/recommend\.html`,\s*freq: 'weekly',\s*pri: '0\.6',\s*lastmod: catalogMod/.test(genSrc), 'recommend.html is in the sitemap core array');
const buildSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'build-from-supabase.js'), 'utf8');
assert.ok(/writeFinder\(ROOT, buildFinder\(recsData, productDetails/.test(buildSrc), 'build writes data/finder.json');
assert.strictEqual((buildSrc.match(/'recommend\.html'/g) || []).length, 5, 'recommend.html is in all five root-page lists');
assert.ok(buildSrc.indexOf('writeRecs(ROOT, recsData)') < buildSrc.indexOf('writeFinder(ROOT'), 'finder written after recs');
// Phase 3 / 1c hooks: co-purchase and the finder_queries retention run only with the service key, inside try/catch.
assert.ok(/require\('\.\/lib\/copurchase'\)/.test(buildSrc), 'build requires scripts/lib/copurchase.js');
assert.ok(/if \(CAN_WRITE\) \{\s*try \{ coPurchase = buildCoPurchase\(await fetchCoPurchase\(sb/.test(buildSrc), 'co-purchase fetched only when CAN_WRITE, inside try/catch');
assert.ok(/buildFinder\(recsData, productDetails, \{ log: [^\n]*?, coPurchase \}\)/.test(buildSrc), 'coPurchase passed to buildFinder');
assert.ok(buildSrc.indexOf('fetchCoPurchase(sb') < buildSrc.indexOf('writeFinder(ROOT'), 'co-purchase built before writeFinder');
assert.ok(/if \(CAN_WRITE\) await pruneFinderQueries\(\)/.test(buildSrc), 'finder_queries retention only with the service key');
assert.ok(/async function pruneFinderQueries\(\) \{\s*try \{[\s\S]*?from\('finder_queries'\)\.delete\(\{ count: 'exact' \}\)\.lt\('created_at', cutoff\)[\s\S]*?\} catch/.test(buildSrc), 'retention delete inside try/catch');
assert.ok(buildSrc.includes("'   finder_queries not found (migration 019 not run)'"), 'missing table is logged, not fatal');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
assert.ok(/test-recs\.js && node scripts\/test-finder\.js$/.test(pkg.scripts.build), 'npm run build runs test-finder after test-recs');
assert.strictEqual(pkg.scripts['test:finder'], 'node scripts/test-finder.js');

// ── untouchable files: js/recs.js and scripts/lib/recs.js match HEAD ──
// (the finder must never be "helped" from the tier-1 engine; skipped with a
// warning when git is unavailable or there is no HEAD yet)
for (const rel of ['js/recs.js', 'scripts/lib/recs.js']) {
  let head = null;
  try { head = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { warn(`git unavailable — skipped the ${rel} sha1 check`); }
  if (head) {
    const sha = b => crypto.createHash('sha1').update(b).digest('hex');
    assert.strictEqual(sha(fs.readFileSync(path.join(ROOT, rel))), sha(head), `${rel} must be byte-identical to HEAD (not to be modified for the finder)`);
  }
}

console.log('test-finder: builder checks passed');

// ── engine ──────────────────────────────────────────────────────
// Implementer D fills this block. Contract reminders (finder-spec.md):
//   • require('../js/finder.js') exports normalize, parse, mergeQuery, vectorize,
//     queryVector, buildProfile, rank, reasons, readSignals, T (templates);
//   • vectorize parity: for every item of `data`, compare key-for-key to
//     require('../js/recs.js').prepareData(recs).items[i].vec (plus the finder's
//     own `w<idx>` keys at weight 0.5 before normalisation);
//   • parser cases: "fresh for office under 500", "like savage but cheaper"
//     (catalog anchor → Dior Sauvage EDP, id 'e', cheaper true), "not too sweet",
//     "for my wife" (gender unisex), "alternative to aventus" (ref anchor),
//     "office e use korar jonno fresh kichu", unknown words → unknown[];
//   • rank: gender 'unisex' never returns g=1; opts.exclude honoured; relational
//     cheaper; brand cap 2; in-stock + collection filters;
//   • claims: every string in T and every string in js/finder-lexicon.js must
//     not match BANNED (defined above).
let engine = null;
try { engine = require('../js/finder.js'); } catch (e) { /* step 4 adds it */ }
if (engine) {
  const F = engine;
  const client = require('../js/recs.js');

  // The real lexicon when present; otherwise a stand-in with the spec's shape so
  // the engine checks still run (the claims test then covers only `T`).
  let lexicon = null;
  try { lexicon = require('../js/finder-lexicon.js'); } catch (e) { warn('js/finder-lexicon.js missing — engine tests use a stand-in lexicon'); }
  const STAND_IN = {
    v: 1,
    entries: [
      { m: ['fresh', 'clean', 'crisp', 'fresh kichu'], f: ['Fresh'], a: ['Fresh', 'Citrus', 'Aromatic'] },
      { m: ['sweet', 'mishti', 'dessert'], a: ['Sweet', 'Vanilla'], n: ['Vanilla'] },
      { m: ['office', 'work', 'university', 'class'], o: ['Office', 'Everyday'] },
      { m: ['woody'], a: ['Woody'], f: ['Woody'] }, { m: ['musky', 'musk'], a: ['Musky'] },
      { m: ['winter', 'thanda'], o: ['Winter'], a: ['Amber'] },
    ],
    refs: [{ m: ['aventus', 'creed aventus'], name: 'Creed Aventus', a: ['Fruity', 'Smoky', 'Musky', 'Woody'], n: ['Pineapple', 'Birch', 'Musk', 'Bergamot'], f: ['Chypre', 'Fruity'] }],
    moods: [{ label: 'Confident', m: ['confident', 'bold'], a: ['Woody', 'Amber'] }],
    chips: { occasion: [{ label: 'Office / University', o: ['Office', 'Everyday'] }], vibe: [{ label: 'Fresh & clean', a: ['Fresh', 'Citrus'] }, { label: 'Surprise me', surprise: true }], budget: [{ label: 'Under ৳300', price: { max: 300 } }, { label: 'Any' }], who: [{ label: 'Me', g: 'men' }, { label: 'A gift', g: 'unisex', gift: true }] },
    negations: ['not', 'no', "don't", 'dont', 'without', 'hate', 'avoid', 'never', 'nothing', 'na', 'noy', 'chai na'],
    intensifiers: { very: 1.3, too: 1.3, really: 1.3, 'a bit': 0.5, slightly: 0.5 },
    genderWords: { women: ['for her', 'her', 'wife', 'girlfriend', 'women', 'meye', 'bou'], men: ['for him', 'him', 'husband', 'men', 'man', 'chele'] },
    strength: { stronger: ['strong', 'stronger', 'powerful', 'heavy', 'intense', 'shokto'], softer: ['soft', 'softer', 'subtle', 'light', 'halka', 'office safe'] },
    exclusiveWords: ['rare', 'vintage', 'discontinued', 'exclusive', 'collector'],
  };
  const L = lexicon || STAND_IN;
  const model = F.prepareData(data);
  assert.ok(model && model.items.length === data.items.length && model.byId.get('e'), 'prepareData accepts finder.json');

  // ── vectorize parity with js/recs.js (same keys, same values) ──
  const rm = client.prepareData(recs);
  for (const k of ['f', 'a', 'n', 'o', 'g', 'k', 'b']) assert.strictEqual(F.WEIGHTS[k], client.WEIGHTS[k], `weight ${k} identical to recs.js`);
  assert.strictEqual(F.WEIGHTS.w, 0.5, 'finder-only keyword weight');
  assert.deepStrictEqual(F.EVENT_W, client.EVENT_W, 'event weights identical to recs.js');
  recs.items.forEach((it, i) => {
    const fv = F.vectorize(it), rv = rm.items[i].vec;
    assert.deepStrictEqual([...fv.keys()].sort(), [...rv.keys()].sort(), `item ${it.id}: same vector keys as recs.js`);
    rv.forEach((v, k) => assert.ok(Math.abs(fv.get(k) - v) < 1e-12, `item ${it.id}: key ${k} identical`));
  });
  data.items.forEach((it, i) => {
    const fv = F.vectorize(it), rv = rm.items[i].vec;
    const nonW = [...fv.keys()].filter(k => k[0] !== 'w');
    assert.deepStrictEqual(nonW.sort(), [...rv.keys()].sort(), `item ${it.id}: kw only adds w<idx> keys`);
    if (it.kw.length) {
      const ratio = fv.get(nonW[0]) / rv.get(nonW[0]);
      nonW.forEach(k => assert.ok(Math.abs(fv.get(k) / rv.get(k) - ratio) < 1e-9, 'recs keys keep their proportions'));
      it.kw.forEach(w => assert.ok(fv.has('w' + w), 'every kw index is a w key'));
      assert.ok(Math.abs(fv.get('w' + it.kw[0]) / fv.get('n' + it.n[0]) - 0.5) < 1e-9, 'w weight 0.5 relative to n weight 1');
    }
  });

  // ── normalize ──
  assert.strictEqual(F.normalize("Don't want ৳1,000 — Sweet!"), 'dont want ৳ 1000 sweet ,');
  assert.strictEqual(F.normalize('500tk <600 5ml'), '500 tk under 600 5 ml');

  // ── parser (deterministic, structured-query contract) ──
  const P = (t, ctx) => F.parse(t, L, model, ctx);
  const CONTRACT = ['anchor', 'features', 'maxPrice', 'minPrice', 'cheaper', 'gender', 'strength', 'collection', 'exclude', 'unknown'];
  let q = P('fresh for office under 500');
  CONTRACT.forEach(k => assert.ok(k in q, `query has ${k}`));
  assert.ok(q.features['o:Office'] > 0, 'office → o:Office');
  assert.ok(q.features['a:Fresh'] > 0 || q.features['f:Fresh'] > 0, 'fresh → Fresh');
  assert.strictEqual(q.maxPrice, 500); assert.strictEqual(q.minPrice, null); assert.strictEqual(q.cheaper, false); assert.strictEqual(q.anchor, null);
  assert.deepStrictEqual(q.unknown, [], 'stop-words are not unknown');
  assert.strictEqual(JSON.stringify(P('fresh for office under 500')), JSON.stringify(q), 'parse is deterministic');
  q = P('like savage but cheaper');
  assert.ok(q.anchor && q.anchor.kind === 'catalog' && q.anchor.id === 'e' && q.anchor.name === 'Dior Sauvage EDP', 'typo "savage" resolves to the catalogue product: ' + JSON.stringify(q.anchor));
  assert.strictEqual(q.cheaper, true);
  assert.ok(P('like Dior Sauvage').anchor.id === 'e' && P('sauvage type').anchor.id === 'e' && P('sauvage cheaper').anchor.id === 'e', 'exact, postfix "type" and bare famous name resolve');
  q = P('not sweet');
  assert.ok(q.features['a:Sweet'] < 0, 'negation flips sweet: ' + q.features['a:Sweet']);
  q = P('not too sweet');
  assert.ok(q.features['a:Sweet'] > 0 && q.features['a:Sweet'] <= 0.6, '"not too sweet" is a mild wish, not a rejection: ' + q.features['a:Sweet']);
  assert.ok(F.typoFix('frsh', L, model) === 'fresh' && F.typoFix('ofice', L, model) === 'office', 'typo fallback');
  assert.ok(P('frsh ofice').features['o:Office'] > 0, 'typos are parsed');
  assert.ok(P('no vanilla for office').features['o:Office'] > 0 && P('no vanilla for office').features['a:Vanilla'] < 0, '"no X for Y" negates only X');
  assert.deepStrictEqual(P('different from Dior Sauvage EDP').exclude, ['id:e'], '"different from X" excludes the product');
  assert.ok(P('dont want anything sweet').features['a:Sweet'] < 0, '"dont want X" within 3 tokens');
  q = P('dont want anything sweet, fresh please');
  assert.ok(q.features['a:Sweet'] < 0 && (q.features['a:Fresh'] > 0 || q.features['f:Fresh'] > 0), 'a comma ends the negation window');
  assert.ok(P('mishti chai na').features['a:Sweet'] < 0, 'Banglish suffix negation');
  q = P('for my wife');
  assert.strictEqual(q.gender, 'unisex', '"for her" words → unisex, never any'); assert.strictEqual(q.note, 'unisex');
  assert.strictEqual(P('for him').gender, 'men'); assert.strictEqual(P('unisex').gender, 'unisex'); assert.strictEqual(P('unisex').note, null);
  q = P('alternative to aventus');
  assert.ok(q.anchor && q.anchor.kind === 'ref' && /aventus/i.test(q.anchor.name), 'reference lexicon anchor: ' + JSON.stringify(q.anchor));
  assert.strictEqual(P('aventos').anchor && P('aventos').anchor.kind, 'ref', 'typo → ref (Levenshtein ≤ 2)');
  q = P('office e use korar jonno fresh kichu');
  assert.ok(q.features['o:Office'] > 0 && (q.features['a:Fresh'] > 0 || q.features['f:Fresh'] > 0), 'Banglish sentence → Office + Fresh');
  assert.deepStrictEqual(q.unknown, [], 'Banglish function words are not unknown');
  q = P('something zorblax and quibbish');
  assert.ok(q.unknown.includes('zorblax') && q.unknown.includes('quibbish'), 'unknown words reported: ' + q.unknown);
  assert.strictEqual(Object.keys(q.features).length, 0); assert.strictEqual(q.anchor, null); assert.strictEqual(q.unknownAnchor, undefined, 'a bare unknown word is not an anchor');
  q = P('like xyzzyblorp');
  assert.strictEqual(q.anchor, null); assert.strictEqual(q.unknownAnchor, 'xyzzyblorp', 'unknown name after a trigger');
  assert.strictEqual(P('i like fresh scents').unknownAnchor, undefined, 'a lexicon word after "like" is a feature, not a name');
  // prices
  q = P('300 to 600'); assert.strictEqual(q.minPrice, 300); assert.strictEqual(q.maxPrice, 600);
  q = P('between 300 and 600 taka'); assert.strictEqual(q.minPrice, 300); assert.strictEqual(q.maxPrice, 600);
  assert.strictEqual(P('under ৳1,000').maxPrice, 1000); assert.strictEqual(P('500 taka').maxPrice, 500); assert.strictEqual(P('max 450').maxPrice, 450);
  assert.strictEqual(P('cheap').maxPrice, F.CHEAP_DEFAULT); assert.strictEqual(P('dam kom').maxPrice, 300); assert.strictEqual(P('budget 700').maxPrice, 700);
  assert.strictEqual(P('over 400').minPrice, 400); assert.strictEqual(P('5ml').maxPrice, null, 'a size is not a price');
  assert.strictEqual(P('cheaper').cheaper, true); assert.strictEqual(P('cheaper', { refPrice: 420 }).refPrice, 420);
  // brands, exclusions, strength, collection
  assert.deepStrictEqual(P('not lattafa').exclude, ['brand:Lattafa']); assert.deepStrictEqual(P('no rasasi please').exclude, ['brand:Rasasi']);
  assert.strictEqual(P('something from rasasi').features['b:Rasasi'], 1, 'a brand mention prefers that brand');
  assert.deepStrictEqual(P('different brands', { lastBrands: ['Rasasi', 'Dior'] }).exclude, ['brand:Rasasi', 'brand:Dior']);
  assert.strictEqual(P('rare vintage').collection, 'exclusive'); assert.strictEqual(P('fresh').collection, null);
  assert.strictEqual(P('strong').strength, 'stronger'); assert.strictEqual(P('halka').strength, 'softer'); assert.strictEqual(P('not strong').strength, 'softer');
  assert.ok(P('very fresh').features['a:Fresh'] > P('fresh').features['a:Fresh'], 'intensifier scales the weight');
  assert.ok(P('a bit fresh').features['a:Fresh'] < P('fresh').features['a:Fresh']);
  // parts (constraint tokens) carry a label and a re-parseable text
  q = P('fresh for office under 500');
  assert.ok(Array.isArray(q.parts) && q.parts.length === 3 && q.parts.every(p => p.label && p.text), 'one part per constraint');
  const re = P(q.parts.map(p => p.text).join(', '));
  assert.strictEqual(re.maxPrice, 500); assert.ok(re.features['o:Office'] > 0 && (re.features['a:Fresh'] > 0 || re.features['f:Fresh'] > 0), 'share text re-parses to the same constraints');
  // follow-ups merge with the previous query via ctx.prev
  q = P('sweet', { prev: P('fresh for office under 500') });
  assert.ok(q.maxPrice === 500 && q.features['o:Office'] > 0 && q.features['a:Sweet'] > 0, 'ctx.prev merges');

  // ── mergeQuery / fromChip ──
  let m = F.mergeQuery({ features: { 'a:Sweet': 1, 'a:Fresh': 0.5 }, maxPrice: 600, exclude: ['brand:Dior'], anchor: { kind: 'ref', name: 'X' } }, { features: { 'a:Sweet': -0.5, 'a:Fresh': 0.5 }, exclude: ['brand:Dior', 'id:a'] });
  assert.strictEqual(m.features['a:Sweet'], -0.5, 'opposite sign replaces'); assert.strictEqual(m.features['a:Fresh'], 1, 'same sign adds');
  assert.strictEqual(m.maxPrice, 600); assert.deepStrictEqual(m.exclude, ['brand:Dior', 'id:a']); assert.strictEqual(m.anchor.name, 'X', 'anchor kept when next has none');
  assert.strictEqual(F.mergeQuery({ cheaper: true, refPrice: 400 }, { maxPrice: 300 }).cheaper, false, 'an absolute price replaces a relational one');
  const c1 = F.fromChip({ label: 'Office / University', o: ['Office', 'Everyday'] }, F.emptyQuery(), model);
  assert.strictEqual(c1.features['o:Office'], 1); assert.ok(c1.features['o:Everyday'] > 0); assert.strictEqual(c1.parts.length, 1);
  const c2 = F.fromChip({ label: 'Under ৳300', price: { max: 300 } }, c1, model);
  assert.strictEqual(c2.maxPrice, 300); assert.strictEqual(c2.features['o:Office'], 1, 'chips merge');
  const c3 = F.fromChip({ label: 'A gift', g: 'unisex', gift: true }, c2, model);
  assert.strictEqual(c3.gender, 'unisex'); assert.strictEqual(c3.note, 'unisex');
  assert.strictEqual(F.fromChip({ label: 'Any' }, c3, model).parts.length, 0, 'a chip without effect adds no part');
  assert.ok(F.surprisePart(3, STAND_IN, model) && Object.keys(F.surprisePart(3, STAND_IN, model).features).length, 'surprise is deterministic by seed');
  assert.strictEqual(JSON.stringify(F.surprisePart(3, STAND_IN, model)), JSON.stringify(F.surprisePart(3, STAND_IN, model)));

  // ── rank: filters, duplicate exclusion, relational cheaper, brand cap ──
  const Q = o => Object.assign(F.emptyQuery(), o);
  const ids = r => r.map(x => x.id);
  // catalogue: a (Rasasi, men, ৳170, bestseller) · b (Rasasi, unisex, ৳180) · c (Lattafa, exclusive, OUT OF STOCK) · e (Dior, men, ৳300, bestseller)
  assert.deepStrictEqual(ids(F.rank(model, Q({ gender: 'unisex' }), { limit: 10 })), ['b'], 'unisex never returns g=1');
  assert.ok(F.rank(model, Q({ gender: 'unisex' }), { limit: 10 }).every(r => r.item.g === 3));
  assert.deepStrictEqual(ids(F.rank(model, Q({ gender: 'men' }), { limit: 10 })).sort(), ['a', 'b', 'e'], 'men → g 1 or 3');
  assert.ok(!ids(F.rank(model, Q(), { limit: 10 })).includes('c'), 'out of stock / exclusive never shown by default');
  assert.deepStrictEqual(F.rank(model, Q({ collection: 'exclusive' }), { limit: 10 }), [], 'exclusive only when asked (and c is out of stock)');
  assert.deepStrictEqual(ids(F.rank(model, Q(), { limit: 10, exclude: new Set(['a']) })), ['e', 'b'], 'opts.exclude (Set) honoured');
  assert.deepStrictEqual(ids(F.rank(model, Q(), { limit: 10, exclude: ['a', 'e'] })), ['b'], 'opts.exclude (array) honoured');
  assert.deepStrictEqual(ids(F.rank(model, Q({ exclude: ['brand:Rasasi'] }), { limit: 10 })), ['e'], 'brand exclusion');
  assert.deepStrictEqual(ids(F.rank(model, Q({ maxPrice: 175 }), { limit: 10 })), ['a']); assert.deepStrictEqual(ids(F.rank(model, Q({ minPrice: 175 }), { limit: 10 })).sort(), ['b', 'e']);
  let ch = F.rank(model, Q({ cheaper: true, refPrice: 200 }), { limit: 10 });
  assert.ok(ch.length === 2 && ch.every(r => r.item.p < 200), 'relational cheaper: p < reference');
  assert.deepStrictEqual(ids(F.rank(model, Q({ cheaper: true }), { limit: 10, referencePrice: 175 })), ['a'], 'opts.referencePrice drives cheaper');
  assert.deepStrictEqual(ids(F.rank(model, Q({ features: { 'a:Citrus': 1 } }), { limit: 10 })), ['e'], 'cosine threshold drops items with no match');
  assert.deepStrictEqual(ids(F.rank(model, Q(), { limit: 10 })), ['a', 'e', 'b'], 'no features: bestsellers then price');
  assert.strictEqual(ids(F.rank(model, Q({ strength: 'softer' }), { limit: 10 }))[0], 'e', 'softer bonus (Citrus accord) outranks the cheaper bestseller');
  assert.strictEqual(ids(F.rank(model, Q({ strength: 'stronger' }), { limit: 10 }))[0], 'a', 'stronger bonus (Woody accord)');
  assert.deepStrictEqual(ids(F.rank(model, Q({ anchor: { kind: 'catalog', id: 'a', name: 'Alpha' } }), { limit: 10 })), ['b', 'e'], 'anchor excluded, closest first');
  assert.ok(F.rank(model, Q(), { limit: 10 })[0].matched !== undefined && F.rank(model, Q({ features: { 'a:Citrus': 1 } }), { limit: 10 })[0].matched.length === 1, 'matched keys reported');
  const ref = { kind: 'ref', name: 'Creed Aventus', ref: STAND_IN.refs[0] };
  assert.ok(ids(F.rank(model, Q({ anchor: ref }), { limit: 10 })).length >= 1, 'ref anchor ranks by its feature profile');
  // brand cap: 3 Rasasi items in stock → at most 2 per answer
  const capData = { v: 1, vocab: data.vocab, items: data.items.concat([{ ...data.items[0], id: 'a2', nm: 'Alpha Two', bs: 0 }, { ...data.items[0], id: 'a3', nm: 'Alpha Three', bs: 0 }]) };
  const capModel = F.prepareData(capData);
  const capped = F.rank(capModel, Q(), { limit: 10 });
  assert.strictEqual(capped.filter(r => r.item.b === data.items[0].b).length, 2, 'brand cap 2 per answer');
  assert.strictEqual(F.rank(capModel, Q(), { limit: 10, brandCap: 0 }).length, 5, 'cap can be lifted');
  assert.strictEqual(F.rank(capModel, Q(), {}).length, F.ANSWER_SIZE, 'default limit = 3 cards');
  // relaxation ladder says what it dropped
  let ans = F.answer(model, Q({ gender: 'unisex', maxPrice: 100 }), { limit: 3 });
  assert.deepStrictEqual(ids(ans.picks), ['b']); assert.deepStrictEqual(ans.relaxed, ['price'], 'price band relaxed first (before gender)');
  ans = F.answer(model, Q({ cheaper: true, refPrice: 100 }), { limit: 3 });
  assert.ok(ans.relaxed.includes('cheaper') && ans.picks.length, 'cheaper relaxed when nothing is cheaper');
  assert.deepStrictEqual(F.answer(model, Q(), { limit: 3, exclude: ['a', 'b', 'e'] }).picks, [], 'everything already rendered → empty');
  assert.deepStrictEqual(F.answer(model, Q({ features: { 'a:Citrus': 1 } }), { limit: 3, exclude: ['e'] }).relaxed, ['threshold'], 'threshold relaxed last');

  // ── profile (read-only copy of the recs rules) ──
  const now = Date.now();
  const prof = F.buildProfile([{ t: 'v', id: 'a', ts: now }], model);
  assert.ok(Math.abs(prof.weight - 1) < 1e-6, 'a fresh view weighs 1 (decay measured from Date.now())'); assert.ok(Math.abs(prof.logP - Math.log(170)) < 1e-9);
  assert.ok(Math.abs(F.buildProfile(model, [{ t: 'c', id: 'a', ts: now }]).weight - 3) < 1e-6, 'either argument order; a cart event weighs 3');
  assert.ok(F.buildProfile([{ t: 'c', id: 'a', ts: now - 60 * 864e5 }], model).weight < 3, 'decay applied');
  assert.deepStrictEqual(F.readSignals(), [], 'no localStorage → no signals');
  assert.ok(F.rank(model, Q(), { limit: 10, signals: [{ t: 'v', id: 'a', ts: now }] }).length === 3, 'signals tilt, never exclude');

  // ── reasons: three modes, nothing invented ──
  const cand = r => F.rank(model, r, { limit: 10 });
  const normal = F.reasons(cand(P('woody musky office'))[0], P('woody musky office'), model, null);
  assert.ok(/^[A-Z]/.test(normal) && /woody|musky/i.test(normal) && /Office/.test(normal) && /from ৳170$/.test(normal), 'normal mode: ' + normal);
  assert.ok(!/Woody.*Woody/.test(normal) && !/Verified/.test(normal));
  const aRef = F.reasons({ item: model.byId.get('a') }, Q({ anchor: ref }), model, ref);
  assert.ok(/^Verified alternative to Creed Aventus/.test(aRef) && /from ৳170$/.test(aRef), 'verified mode when item.ref names the anchor: ' + aRef);
  const eRef = F.reasons({ item: model.byId.get('e') }, Q({ anchor: ref }), model, ref);
  assert.ok(/closest match to Creed Aventus/.test(eRef) && !/Verified/.test(eRef), 'similarity mode never says verified: ' + eRef);
  const cat = { kind: 'catalog', id: 'e', name: 'Dior Sauvage EDP' };
  const aCat = F.reasons({ item: model.byId.get('a') }, Q({ anchor: cat }), model, cat);
  assert.ok(/^Bergamot & ambroxan · closest match to Dior Sauvage EDP · from ৳170$/.test(aCat), 'anchor mode lists the shared notes: ' + aCat);

  // ── Phase 1b: verified inspired_by reference outranks similarity ──
  {
    const q = F.parse('alternative to aventus', L, model, {});
    assert.ok(q.anchor && q.anchor.kind === 'ref', 'aventus resolves to a reference anchor');
    const r = F.answer(model, q, { limit: 3 });
    assert.ok(r.picks.length && r.picks[0].id === 'a' && r.picks[0].verified === true, 'the inspired_by product is first and flagged verified');
    assert.ok(/^Verified alternative to Creed Aventus/.test(F.reasons(r.picks[0], q, model, q.anchor)), 'verified wording');
    assert.ok(!r.picks.slice(1).some(p => p.verified), 'other picks are not verified');
  }
  // ── character axes: vibe words score the overall profile, follow-ups are relational ──
  {
    const e = model.byId.get('e'), a = model.byId.get('a');
    assert.ok(F.axisScore(e, 'fresh', model) > 0.3 && F.axisScore(a, 'fresh', model) <= 0, 'Sauvage leans fresh, the woody musky one does not');
    assert.ok(F.queryAxes(F.parse('fresh', L, model, {})).fresh > 0, '"fresh" engages the fresh axis');
    assert.ok(F.queryAxes(F.parse('not sweet', L, model, {})).sweet < 0, '"not sweet" pushes the sweet axis negative');
    assert.ok(F.axisScore(a, 'strong', model) > F.axisScore(e, 'strong', model), 'the woody oriental leans stronger than the fresh citrus one');
    assert.ok(!('strong' in F.queryAxes({ strength: 'stronger', features: {} })), 'strength is not double-counted as an axis (strengthBonus owns it)');
    const q = F.parse('office', L, model, {});
    const all = F.rank(model, q, { limit: 10 }).map(p => p.id);
    const fresherOnly = F.rank(model, q, { limit: 10, axisMin: { axis: 'fresh', min: 0.1 } }).map(p => p.id);
    assert.ok(all.includes('a') && !fresherOnly.includes('a') && fresherOnly.includes('e'), 'axisMin keeps only fragrances that lean fresh overall');
    const relaxed = F.answer(model, q, { limit: 3, axisMin: { axis: 'fresh', min: 2 } });
    assert.ok(relaxed.relaxed[0] === 'axis' && relaxed.picks.length, 'an impossible axis bar is relaxed first and said so');
    for (const k of ['fresh', 'sweet', 'strong']) assert.ok(F.T.axisTitle[k] && F.T.noAxis[k], 'axis templates present for ' + k);
  }
  // ── Phase 2: on-device fragments → the structured query (validate + merge rule) ──
  {
    const frag = F.validateFragment({ features: { 'a:citrus': 0.8, 'a:Nope': 1, 'x:Citrus': 1, 'o:office': 2, 'f:Aromatic': -0.5 }, strength: 'softer', gender: 'any', exclude_brands: ['Rasasi', 'Unknown Brand', 'brand:Dior'], unknown: ['uncle-like'] }, model);
    assert.ok(frag && frag.features['a:Citrus'] === 0.8 && frag.features['o:Office'] === 1 && frag.features['f:Aromatic'] === -0.5, 'labels canonicalised, weights clamped');
    assert.ok(!('a:Nope' in frag.features) && !Object.keys(frag.features).some(k => /^x:/.test(k)), 'unknown labels / prefixes dropped');
    assert.ok(frag.strength === 'softer' && frag.gender === null && frag.exclude.join() === 'brand:Rasasi,brand:Dior' && frag.unknown[0] === 'uncle-like', 'strength kept, bad gender dropped, brands canonicalised');
    assert.strictEqual(F.validateFragment({ features: {}, strength: 'none' }, model), null, 'an empty fragment is null');
    const parsed = F.parse('fresh under 500 not citrus', L, model, {});
    const part = F.mergeNLU(parsed, F.validateFragment({ features: { 'a:Citrus': 1, 'a:Woody': 0.6, 'o:Office': 0.5 }, strength: 'stronger', gender: 'men' }, model), model);
    assert.ok(part && part.ai === true && !('a:Citrus' in part.features) && part.features['a:Woody'] === 0.6 && part.features['o:Office'] === 0.5, 'merge: the parser keeps its own (negated) feature, the model adds new ones');
    assert.ok(part.strength === 'stronger' && part.gender === 'men' && part.maxPrice == null, 'merge: strength/gender added, prices never come from a model');
    const merged = F.mergeQuery(parsed, part);
    assert.ok(merged.maxPrice === 500 && merged.features['a:Citrus'] < 0, 'merged query keeps the parser price and sign');
    assert.strictEqual(F.mergeNLU(parsed, F.validateFragment({ features: { 'a:Citrus': 1 } }, model), model), null, 'nothing new → no part');
    assert.ok(F.needsNLU('something expensive but not loud for office', F.parse('something expensive but not loud for office', L, model, {})) === (F.parse('something expensive but not loud for office', L, model, {}).unknown.length >= 2 || !F.parse('something expensive but not loud for office', L, model, {}).parts.length), 'escalation follows the unknown-words rule');
    assert.ok(!F.needsNLU('fresh office', F.parse('fresh office', L, model, {})), 'short understood sentences never escalate');
    assert.ok(/JSON/.test(F.aiSystemPrompt(model)) && F.NLU_SCHEMA.required[0] === 'features', 'prompt + schema present');
    for (const s of ['aiRead', 'aiOffer', 'aiConsent', 'aiLoading', 'aiLoadFailed']) assert.ok(F.T[s], 'template ' + s);
  }
  // ── profile similarity + community (Fragrantica) boosts ──
  {
    const a = model.byId.get('a'), e = model.byId.get('e'), b = model.byId.get('b');
    assert.ok(Math.abs(F.profileSim(e, e, model) - 1) < 1e-9 && Math.abs(F.profileSim(a, b, model) - F.profileSim(b, a, model)) < 1e-9, 'profileSim is 1 on itself and symmetric');
    assert.ok(F.profileSim(a, b, model) > F.profileSim(a, e, model), 'the two woody musky ones are closer than woody vs fresh citrus');
    // community pair: a says "reminds me of e" → "more like e" lifts a above its vector rank
    const simData = JSON.parse(JSON.stringify(data)); const ia = simData.items.findIndex(it => it.id === 'a'), ie = simData.items.findIndex(it => it.id === 'e');
    simData.items[ie].sim = [[ia, 0.9]]; simData.items[ia].sim = [[ie, 0.9]];
    simData.vocab.r = ['DIOR Sauvage Eau de Parfum']; simData.items[ia].cref = [[0, 0.8]];
    const sm = F.prepareData(simData);
    const qa = Object.assign(F.emptyQuery(), { anchor: { kind: 'catalog', id: 'e', name: 'Dior Sauvage EDP' } });
    const withVotes = F.rank(sm, qa, { limit: 3 }), without = F.rank(sm, qa, { limit: 3, noCommunity: true });
    assert.ok(withVotes[0].id === 'a' && withVotes[0].community === true, 'voted partner first: ' + withVotes.map(p => p.id));
    assert.ok(without.every(p => !p.community), 'noCommunity disables the boost');
    const qr = F.parse('like sauvage', L, sm, {});
    if (qr.anchor && qr.anchor.kind === 'ref') {
      const r = F.rank(sm, qr, { limit: 3 });
      assert.ok(r[0].id === 'a' && r[0].community, 'a product voters compare to the typed reference ranks first');
      assert.ok(/often compared to .* by Fragrantica users/.test(F.reasons(r[0], qr, sm, qr.anchor)), 'community wording in the reason');
    }
  }

  // ── Phase 3: "also considered" (display only) + Phase 1c log row ──
  {
    const idx = id => model.items.findIndex(it => it.id === id);
    const pick = { item: Object.assign({}, model.byId.get('a'), { cp: [[idx('e'), 0.9], [idx('a'), 1], [idx('c'), 0.8], [idx('b'), 0.5]] }) };
    const also = F.alsoConsidered(pick, model, ['b'], 3);
    assert.deepStrictEqual(also.map(x => x.id), ['e'], 'skips itself, out-of-stock and excluded ids');
    assert.deepStrictEqual(F.alsoConsidered({ item: model.byId.get('b') }, model, [], 3), [], 'no cp → nothing');
    assert.deepStrictEqual(F.queryLogBody('  ' + 'x'.repeat(300) + '  ', 150), { q: 'x'.repeat(200), matched: 99 }, 'log row: trimmed, capped');
    assert.ok(F.T.also && !/for you|history|browsed/i.test(F.T.also), 'also-row template is neutral');
  }

  // ── claims: every template string and every lexicon string ──
  const strings = (v, out) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.keys(v).forEach(k => strings(v[k], out)); return out; };
  // The glossary DEFINES the words (longevity, projection, sillage, beast mode), so it is scanned for claim
  // forms only (hours, "lasts longer", "long lasting"); every other template must not even use the words.
  const CLAIM = /lasts? longer|long[\s-]?lasting|\b\d+\s*hours?\b/i;
  for (const s of strings(Object.assign({}, F.T, { gloss: null }), [])) assert.ok(!BANNED.test(s), 'template makes a longevity/projection claim: ' + s);
  for (const s of strings(F.T.gloss || {}, [])) assert.ok(!CLAIM.test(s), 'glossary makes a wear-time claim: ' + s);
  assert.ok(F.T.gloss && Object.keys(F.T.gloss).length >= 15, 'glossary definitions present');
  assert.ok(strings(F.T, []).some(s => /Leans stronger: higher concentration and a heavier profile\./.test(s)), 'the one permitted strength wording is present');
  // Lexicon: every string a visitor can SEE (labels, reference names, feature labels)
  // must be claim-free. Match phrases (`m`, negations, strength words …) are what
  // the visitor TYPES — "long lasting" must be understood, never said.
  const visible = L => { const out = []; const feat = e => ['f', 'a', 'n', 'o', 'k'].forEach(p => (Array.isArray(e[p]) ? e[p] : []).forEach(x => out.push(String(x)))); (L.entries || []).forEach(feat); (L.moods || []).forEach(e => { out.push(String(e.label)); feat(e); }); (L.refs || []).forEach(r => { out.push(String(r.name)); feat(r); }); Object.keys(L.chips || {}).forEach(k => (L.chips[k] || []).forEach(c => { out.push(String(c.label)); feat(c); })); return out; };
  if (lexicon) for (const s of visible(lexicon)) assert.ok(!BANNED.test(s), 'visible lexicon string makes a banned claim: ' + s);
  if (lexicon) assert.ok(visible(lexicon).length > 300, 'lexicon visible strings scanned: ' + visible(lexicon).length);
  if (lexicon) {
    assert.ok(Array.isArray(lexicon.entries) && lexicon.entries.length >= 100, 'lexicon has ≥ 100 entries');
    assert.ok(Array.isArray(lexicon.refs) && lexicon.refs.length >= 40, 'lexicon has ≥ 40 reference fragrances');
    assert.ok(lexicon.chips && ['occasion', 'vibe', 'budget', 'who'].every(k => Array.isArray(lexicon.chips[k]) && lexicon.chips[k].length), 'lexicon chips present');
  }
  // toCard mirrors recs.js toCard (ids/sizes/accords/images)
  const card = F.toCard(model.byId.get('e'), model);
  assert.deepStrictEqual(Object.keys(card).sort(), ['accords', 'brand', 'id', 'image_small', 'image_thumb', 'inStock', 'name', 'sale_percent', 'sizes', 'tags']);
  assert.ok(/^https:\/\/cdn\.nawmeessences\.com\/storage\/v1\/object\/public\/product-images\/e\/thumb\.webp\?v=\d+$/.test(card.image_thumb), card.image_thumb);
  assert.deepStrictEqual(card.sizes, [{ ml: 3, price: 300 }, { ml: 5, price: 480 }]);

  // ── review fixes (2026-10-08) ──
  // Names made of "generic" words resolve as catalogue anchors (Le Male, Dior Homme …), a year
  // inside a name is not a price, a leading generic word is never reported as an unknown name.
  const bIdx = data.vocab.b.indexOf('Dior'), jpg = data.vocab.b.length;
  const nameData = { v: 1, vocab: { ...data.vocab, b: data.vocab.b.concat(['Jean Paul Gaultier']) }, items: data.items.concat([
    { ...data.items[0], id: 'lm', nm: 'JPG Le Male', b: jpg, bs: 0 }, { ...data.items[0], id: 'lmx', nm: 'JPG Le Male Elixir', b: jpg, bs: 0 },
    { ...data.items[0], id: 'dhi', nm: 'Dior Homme Intense', b: bIdx, bs: 0 }, { ...data.items[0], id: 'dhs', nm: 'Dior Homme Sport 2017', b: bIdx, bs: 0 }]) };
  const nm = F.prepareData(nameData);
  const PN = t => F.parse(t, L, nm);
  assert.strictEqual(PN('like le male').anchor && PN('like le male').anchor.id, 'lm', 'brand + generic words resolve to the stocked product (shortest full match wins)');
  assert.strictEqual(PN('like dior homme intense').anchor.id, 'dhi'); assert.strictEqual(PN('like dior homme').anchor.id, 'dhi', 'contiguous run of ≥ 2 name tokens is enough');
  assert.ok(!PN('like dior homme intense').features['b:Dior'], 'the brand inside a resolved name is not a separate brand feature');
  q = PN('dior homme sport 2017');
  assert.strictEqual(q.anchor && q.anchor.id, 'dhs', 'bare name with a year: ' + JSON.stringify(q.anchor)); assert.strictEqual(q.maxPrice, null, 'the year is part of the name, not a price');
  q = PN('like le beau');
  assert.strictEqual(q.anchor, null); assert.strictEqual(q.unknownAnchor, 'beau', 'a leading generic word ("le") is skipped, never the unknown name');
  assert.ok(!PN('like pour homme').anchor, 'generic words alone never anchor');
  assert.strictEqual(PN('like dior sauvage').anchor.id, 'e', 'brand + name still resolves in the catalogue');
  // prices: reversed band, decimal k
  q = P('800 to 500'); assert.strictEqual(q.minPrice, 500); assert.strictEqual(q.maxPrice, 800); assert.strictEqual(q.parts.length, 1, 'reversed band → one band part');
  assert.strictEqual(P('1.5k').maxPrice, 1500); assert.strictEqual(P('under 2.5k').maxPrice, 2500);
  // negation window: "but" ends it; a brand / strength word takes the negation
  q = P('not sweet but fresh'); assert.ok(q.features['a:Sweet'] < 0 && (q.features['a:Fresh'] > 0 || q.features['f:Fresh'] > 0), '"but" closes the negation window');
  q = P('not rasasi strong'); assert.deepStrictEqual(q.exclude, ['brand:Rasasi']); assert.strictEqual(q.strength, 'stronger', 'the brand takes the negation; "strong" stays positive');
  assert.ok(P('not sweet winter').features['o:Winter'] < 0, 'plain feature words inside the window are still all negated');
  // Banglish suffix negations
  for (const t of ['sweet chaina', 'sweet nei', 'sweet nope', 'sweet lagbe na']) assert.ok(P(t).features['a:Sweet'] < 0, t + ' → negative Sweet');
  // one typed word → one token; strength / gender words never pull description keywords
  assert.strictEqual(P('unisex').parts.length, 1, '"unisex" gives one part (lexicon entry OR built-in, not both)');
  assert.ok(!Object.keys(P('strong').features).some(k => k.startsWith('w:')) && P('strong').parts.length === 1, '"strong" is a strength only');
  assert.strictEqual(P('for my wife').parts[0].label, 'Unisex (gift)', 'gender token uses the spec label'); assert.ok(/wife/.test(P('for my wife').parts[0].text), '… while the share text keeps the phrase');
  assert.strictEqual(P('for him').parts[0].label, 'For men');
  // explicit brand request lifts the brand cap; purely negative queries keep the ranking
  assert.strictEqual(F.rank(capModel, Q({ features: { 'b:Rasasi': 1 } }), { limit: 10 }).filter(r => r.item.b === data.items[0].b).length, 4, 'requested brand exempt from the cap');
  assert.strictEqual(F.rank(capModel, Q({ features: { 'b:Rasasi': 1, 'a:Citrus': 1 } }), { limit: 10 }).filter(r => r.item.b !== data.items[0].b).length, 1, 'other brands still capped');
  ans = F.answer(model, Q({ features: { 'a:Citrus': -1 } }), { limit: 3 });
  assert.deepStrictEqual(ans.relaxed, [], 'a negative-only query does not trip the similarity threshold');
  assert.strictEqual(ans.picks.length, 3); assert.strictEqual(ans.picks[ans.picks.length - 1].id, 'e', 'the negated item is pushed last');
  assert.deepStrictEqual(ids(F.rank(model, Q({ features: { 'a:Citrus': 1 } }), { limit: 10 })), ['e'], 'positive queries still use the threshold');
  // reason lines never repeat a label that is both a note and an accord
  const dm = F.prepareData({ v: 1, vocab: { b: ['X'], f: [], a: ['Vanilla', 'Sweet'], n: ['Vanilla', 'Tonka Bean'], o: [], k: [], w: [], r: [] }, items: [{ id: 'v', nm: 'V', b: 0, f: [], a: [0, 1], n: [0, 1], o: [], g: 3, k: -1, s: [[3, 100]], sp: 0, p: 100, i: 1, bs: 0, t: [], v: 1, c: 'r', kw: [], ref: [] }] });
  const dq = Q({ features: { 'n:Vanilla': 1, 'a:Vanilla': 1, 'a:Sweet': 1, 'n:Tonka Bean': 1 } });
  const dr = F.reasons(F.rank(dm, dq, { limit: 1 })[0], dq, dm, null);
  assert.strictEqual(dr, 'Vanilla, sweet & tonka bean · from ৳100', 'de-duplicated reason (accords first, then notes): ' + dr);
  const danchor = { kind: 'catalog', id: 'v', name: 'V' };
  assert.ok(!/vanilla.*vanilla/i.test(F.reasons({ item: dm.byId.get('v') }, Q({ anchor: danchor }), dm, danchor)), 'anchor mode de-duplicated too');
  // no-effect texts: nothing parsed, nothing unknown (the UI answers with T.nothingNew)
  q = P('different brands', { lastBrands: [] }); assert.strictEqual(q.parts.length, 0); assert.deepStrictEqual(q.unknown, []);
  assert.ok(/nothing new/i.test(F.T.nothingNew) && /\{n\}/.test(F.T.status), 'no-op reply and sr status templates present');
  if (lexicon) assert.strictEqual(P('bhai fresh kichu dekhan').gender, null, '"bhai"/"vai" are address words, not a gender');

  // ── skills 1–3 (2026-10-15): product facts · conversation · shop questions ──
  // Intents and shop questions use the closure rule: the whole message must be covered by
  // known phrases plus filler words; any scent word left over means "search for that".
  if (lexicon) {
    const I = t => F.intentOf(t, L), FQ = t => F.faqOf(t, L);
    assert.strictEqual(I('hello'), 'greet'); assert.strictEqual(I('thank you'), 'thanks'); assert.strictEqual(I('bye'), 'bye'); assert.strictEqual(I('ok'), 'ack');
    assert.strictEqual(I('recommend me something'), 'guide'); assert.strictEqual(I('help me choose'), 'guide'); assert.strictEqual(I('i dont know what i want'), 'guide');
    assert.strictEqual(I('recommend something fresh'), null, 'a scent word left over → a search, not an intent');
    assert.strictEqual(I('what can you do'), 'help'); assert.strictEqual(I('random'), 'random'); assert.strictEqual(I('start over'), 'reset');
    assert.strictEqual(I('why did you recommend this'), 'why'); assert.strictEqual(I('same as last time'), 'memory'); assert.strictEqual(I('are you a bot'), 'bot');
    assert.strictEqual(I('can you speak bangla'), 'lang'); assert.strictEqual(I("what's new"), 'new'); assert.strictEqual(I('hi, help me choose'), 'guide', 'greeting + ask → the ask wins');
    assert.strictEqual(I('evening'), null, 'an occasion word is never small talk'); assert.strictEqual(I('how do i order'), null); assert.strictEqual(I('fresh for office'), null);
    assert.strictEqual(FQ('do you deliver outside dhaka'), 'delivery'); assert.strictEqual(FQ('how much is delivery'), 'delivery'); assert.strictEqual(FQ('can i pay with bkash'), 'payment');
    assert.strictEqual(FQ('cash on delivery'), 'payment', 'tie → the earlier key (payment rules)'); assert.strictEqual(FQ('what sizes do you sell'), 'sizes'); assert.strictEqual(FQ('3ml vs 5ml'), 'sizes');
    assert.strictEqual(FQ('which size should i start with'), 'sizes'); assert.strictEqual(FQ('halal perfume'), 'type'); assert.strictEqual(FQ('alcohol free'), 'type'); assert.strictEqual(FQ('oil based attar'), 'type');
    assert.strictEqual(FQ('is it original'), 'authentic'); assert.strictEqual(FQ('how do i order'), 'order'); assert.strictEqual(FQ('what is a decant'), 'decant'); assert.strictEqual(FQ("what's on sale"), 'offers');
    assert.strictEqual(FQ('do you ship to india'), 'abroad'); assert.strictEqual(FQ('where are you located'), 'pickup'); assert.strictEqual(FQ('whatsapp number'), 'contact'); assert.strictEqual(FQ('return policy'), 'returns');
    assert.strictEqual(FQ('edp under 500'), null, 'a number that is not a size is never covered'); assert.strictEqual(FQ('perfume for cold weather in sylhet'), null, 'a place name inside a scent request stays a search');
    assert.strictEqual(FQ('fresh for office'), null); assert.strictEqual(FQ('do you have asad'), null, 'a product question is not a shop question');
    // frames around a product name
    const MF = t => F.matchFrame(t);
    assert.deepStrictEqual([MF('what does hawas ice smell like').kind, MF('what does hawas ice smell like').name], ['smell', 'hawas ice']);
    assert.deepStrictEqual([MF('how much is 5ml of 9pm').kind, MF('how much is 5ml of 9pm').name, MF('how much is 5ml of 9pm').ml], ['price', '9pm', 5]);
    assert.deepStrictEqual([MF('do you have anything from parfums de marly').kind, MF('do you have anything from parfums de marly').name], ['have', 'parfums de marly']);
    assert.deepStrictEqual([MF('is sanaya unisex').kind, MF('is sanaya unisex').name], ['gender', 'sanaya']);
    assert.ok(MF('what are the top notes of 9pm').kind === 'notes' && MF('what are the top notes of 9pm').pyramid, 'top notes → notes frame + pyramid flag');
    assert.deepStrictEqual([MF('cheapest size of khamrah qahwa').kind, MF('cheapest size of khamrah qahwa').name], ['price', 'khamrah qahwa']);
    assert.deepStrictEqual([MF('30ml price').kind, MF('30ml price').name, MF('30ml price').ml], ['price', '', 30], 'size-only price question (answered for the current bottle)');
    assert.deepStrictEqual([MF('tell me about lattafa angham').kind, MF('tell me about lattafa angham').name], ['about', 'lattafa angham']);
    assert.deepStrictEqual([MF('is club de nuit intense man strong').kind, MF('is club de nuit intense man strong').name], ['strength', 'club de nuit intense man']);
    assert.deepStrictEqual([MF('i want to order 9pm').kind, MF('i want to order 9pm').name], ['buy', '9pm']);
    assert.strictEqual(MF('fresh for office'), null); assert.strictEqual(MF('like sauvage but cheaper'), null);
    assert.strictEqual(F.cleanName('anything from the lattafa perfume'), 'lattafa');
    // what the name refers to (synthetic catalogue: "Dior Sauvage EDP" is stocked)
    const RF = t => F.resolveFact(t, model, L);
    assert.strictEqual(RF('dior sauvage').kind, 'catalog'); assert.strictEqual(RF('dior sauvage').item.id, 'e');
    assert.strictEqual(RF('fresh'), null, 'a vibe word is a search, not a fact question'); assert.strictEqual(RF('mens perfume'), null);
    assert.strictEqual(RF('rasasi').kind, 'brand'); assert.strictEqual(RF('rasasi').name, 'Rasasi');
    assert.strictEqual(RF('parfums de marly').kind, 'nobrand'); assert.strictEqual(RF('parfums de marly').name, 'Parfums de Marly');
    assert.strictEqual(RF('aventus').kind, 'ref', 'a famous name we do not stock → reference'); assert.strictEqual(RF('zzqqxx').kind, 'unknown');
    // fact lines: every kind, every stocked item, claims-free; sizes and sale handled
    const E = model.byId.get('e'), A = model.byId.get('a'), B = model.byId.get('b');
    for (const it of [E, A, B]) for (const kind of ['smell', 'notes', 'about', 'family', 'gender', 'strength', 'price', 'have', 'buy']) {
      const x = F.factLines(kind, it, model, { ml: 5, pyramid: true });
      assert.ok(typeof x.text === 'string' && x.text.length > 10 && Array.isArray(x.notes), kind + ' lines for ' + it.id);
      for (const s of [x.text].concat(x.notes)) assert.ok(!BANNED.test(s), 'fact line makes a banned claim: ' + s);
    }
    assert.strictEqual(F.factLines('price', E, model, { ml: 5 }).text, 'Dior Sauvage EDP in 5 ml is ৳480.');
    assert.strictEqual(F.factLines('price', E, model, { ml: 10 }).text, "Dior Sauvage EDP isn't sold in 10 ml.");
    assert.strictEqual(F.factLines('price', E, model, {}).text, 'Dior Sauvage EDP starts at ৳300 for 3 ml.');
    assert.ok(/On sale — 10% off/.test(F.factLines('price', B, model, {}).notes.join(' | ')), 'sale note when sale_percent > 0');
    assert.ok(/Sizes: 3 ml ৳180/.test(F.factLines('price', B, model, {}).notes.join(' | ')), 'size prices show the sale price');
    assert.strictEqual(F.factLines('gender', E, model, {}).text, 'Dior Sauvage EDP is listed for men.');
    assert.ok(/don't track wear time/.test(F.factLines('strength', E, model, {}).text) && /Eau de Parfum/.test(F.factLines('strength', E, model, {}).text), 'strength answer is honest + names the concentration');
    assert.ok(/^Notes: bergamot, pepper/.test(F.factLines('notes', E, model, { pyramid: true }).notes[0]) && F.factLines('notes', E, model, { pyramid: true }).notes.indexOf(F.T.factPyramid) === 1, 'notes + pyramid pointer');
    assert.ok(/Listed for Office, Everyday, Summer · For men · EDP\./.test(F.factLines('about', E, model, {}).notes.join(' | ')), 'listed line: ' + F.factLines('about', E, model, {}).notes.join(' | '));
    // shop answers: baked fallbacks match the site settings defaults (lib/settings.js), every key answers
    const SD = require('./lib/settings').DEFAULTS.delivery;
    assert.deepStrictEqual(F.FAQ_RATES, { dhaka: SD.dhaka, suburb: SD.suburb, outside: SD.outside }, 'finder delivery fallback = settings defaults');
    assert.deepStrictEqual(F.FAQ_POINTS, SD.pickupPoints, 'finder pickup fallback = settings defaults');
    for (const f of lexicon.faq) { const a = F.faqLines(f.key, model); assert.ok(a && a.text && Array.isArray(a.notes) && a.link && a.link.href, 'faq answer for ' + f.key); for (const s of [a.text].concat(a.notes)) assert.ok(!BANNED.test(s), 'faq line makes a banned claim: ' + s); }
    assert.ok(/৳70 inside Dhaka, ৳90 in the Dhaka suburbs and ৳120/.test(F.faqLines('delivery', model).text), 'delivery amounts in the answer');
    assert.ok(/from ৳170 for 3 ml/.test(F.faqLines('sizes', model).notes[0]), 'sizes answer quotes the cheapest in-stock regular decant');
    assert.ok(/decants only/.test(F.faqLines('type', model).text) && !/full bottles/.test(F.faqLines('type', model).text), 'product-type answer: decants only, no claim about full bottles');
    assert.strictEqual(lexicon.brandAliases.armani, 'Giorgio Armani'); assert.ok(Object.keys(lexicon.intents).length >= 10 && lexicon.faq.length >= 10, 'intent / faq blocks present');

    // ── bugs round (2026-10-15): negation wins, self-wearer, Bangla script, glossary, comparisons, gaps ──
    let bq = P('i hate sweet perfumes, everything is too sweet these days');
    assert.ok(bq.features['a:Sweet'] < 0 && !bq.parts.some(p => p.features && p.features['a:Sweet'] > 0), 'a rejected feature is not also wished for: ' + JSON.stringify(bq.parts.map(p => p.label)));
    bq = P('winter but no vanilla'); assert.ok(bq.features['a:Amber'] > 0 && bq.features['a:Vanilla'] < 0, 'the wish keeps its other features, only the rejected one is removed');
    assert.ok(P('sweet but not too sweet').features['a:Sweet'] > 0, 'a mild "not too sweet" is still a wish');
    bq = P('i want a perfume that my wife will love on me'); assert.strictEqual(bq.gender, null, '"on me": the wearer is the visitor, a woman in the sentence does not switch to unisex'); assert.ok(bq.features['o:Date Night'] > 0);
    assert.strictEqual(P('something for my wife').gender, 'unisex', 'without a self-wearer phrase the women note still applies');
    assert.strictEqual(F.normalize('৫০০ টাকার মধ্যে'), '500 টাকার মধ্যে', 'Bengali numerals become digits'); assert.strictEqual(P('৫০০ টাকার মধ্যে').maxPrice, 500, 'Bangla "within 500 taka"');
    bq = P('অফিসের জন্য ফ্রেশ কিছু'); assert.ok(bq.features['o:Office'] > 0 && (bq.features['a:Fresh'] > 0 || bq.features['f:Fresh'] > 0), 'Bangla office + fresh: ' + JSON.stringify(bq.features));
    assert.ok(P('মিষ্টি পারফিউম চাই').features['a:Sweet'] > 0 && P('মিষ্টি পারফিউম চাই').unknown.length === 0, 'Bangla sweet, filler words ignored');
    assert.strictEqual(P('শীতের জন্য কড়া পারফিউম').strength, 'stronger'); assert.strictEqual(P('মেয়েদের জন্য গিফট').gender, 'unisex');
    assert.ok(P('smells like money').features['a:Amber'] > 0 || P('smells like money').features['a:Woody'] > 0, '"smells like money" is a vibe, not an unknown name: ' + JSON.stringify(P('smells like money').unknownAnchor));
    assert.ok(P('something i can wear to sleep').strength === 'softer' && P('something i can wear to sleep').features['a:Musky'] > 0, 'bedtime entry');
    assert.ok(P('something nobody else wears').parts.length === 1 && !P('something nobody else wears').unknown.length, 'uncommon-scent entry');
    bq = P('perfume for dark skin'); assert.ok(bq.parts.length === 1 && bq.parts[0].note === 'skin' && !bq.features['a:Smoky'], 'skin type → honest note, never "dark" scents: ' + JSON.stringify(bq.parts[0]));
    assert.strictEqual(F.intentOf('the one in the gold bottle', L), 'bottle'); assert.strictEqual(F.intentOf('the blue one', L), null);
    assert.deepStrictEqual(F.glossOf('what is the difference between edp and edt', L), ['edp', 'edt']); assert.deepStrictEqual(F.glossOf('what does extrait mean', L), ['extrait']);
    assert.deepStrictEqual(F.glossOf('edp vs edt', L), ['edp', 'edt']); assert.strictEqual(F.glossOf('edp', L), null, 'a bare term is a search'); assert.strictEqual(F.glossOf('edp under 500', L), null);
    for (const g of lexicon.glossary) assert.ok(F.T.gloss[g.key], 'definition for glossary key ' + g.key);
    const PC = t => F.parseCompare(t);
    assert.deepStrictEqual(PC('which one lasts longer, 9pm or asad').names, ['9pm', 'asad']); assert.ok(/lasts longer/.test(PC('which one lasts longer, 9pm or asad').pre));
    assert.deepStrictEqual([PC('which is better for summer: hawas ice or sanaya').names, PC('which is better for summer: hawas ice or sanaya').crit], [['hawas ice', 'sanaya'], 'summer']);
    assert.deepStrictEqual(PC('difference between hawas and hawas ice').names, ['hawas', 'hawas ice']);
    assert.deepStrictEqual(PC('rank lattafa khamrah qahwa, angham and asad').names, ['lattafa khamrah qahwa', 'angham', 'asad']);
    assert.deepStrictEqual([PC('compare khamrah qahwa and angham for office').names, PC('compare khamrah qahwa and angham for office').crit], [['khamrah qahwa', 'angham'], 'office']);
    assert.deepStrictEqual(PC('sanaya vs sanaya 40').names, ['sanaya', 'sanaya 40']); assert.strictEqual(PC('fresh for office'), null);
    // verdict lines on the synthetic catalogue: Dior Sauvage (Office/Everyday/Summer, EDP) vs Alpha (Office/Everyday, EDP)
    const vd = F.compareVerdict([model.byId.get('e'), model.byId.get('a')], 'summer', 'which is better', model);
    assert.ok(vd.some(l => /Dior Sauvage EDP listed for Summer; Alpha not\./.test(l)), 'occasion verdict: ' + vd.join(' | '));
    assert.ok(F.compareVerdict([model.byId.get('e'), model.byId.get('a')], 'office', '', model).some(l => l === 'Both are listed for Office.'), 'both listed');
    const vw = F.compareVerdict([model.byId.get('e'), model.byId.get('a')], null, 'which one lasts longer', model);
    assert.ok(vw.length === 1 && /^We don't track wear time/.test(vw[0]) && !BANNED.test(vw[0]), 'wear question → honest strength line: ' + vw.join(' | '));
    for (const s of vd.concat(vw)) assert.ok(!BANNED.test(s));
    // bare names prefer the base bottle over its flankers ('hawas' → Hawas for Him, not Hawas Ice / Hawas Elixir),
    // while articles and gender words in a name stay free ('le male' → JPG Le Male, not Le Male Le Parfum)
    const rb = data.vocab.b.indexOf('Rasasi'), jb = data.vocab.b.length;
    const flankData = { v: 1, vocab: { ...data.vocab, b: data.vocab.b.concat(['Jean Paul Gaultier']) }, items: data.items.concat([
      { ...data.items[0], id: 'hi', nm: 'Rasasi Hawas Ice', b: rb, bs: 1 }, { ...data.items[0], id: 'hh', nm: 'Rasasi Hawas for Him', b: rb, bs: 0 }, { ...data.items[0], id: 'hx', nm: 'Rasasi Hawas Elixir', b: rb, bs: 1 },
      { ...data.items[0], id: 'lm', nm: 'JPG Le Male', b: jb, bs: 0 }, { ...data.items[0], id: 'lmp', nm: 'JPG Le Male Le Parfum', b: jb, bs: 1 }, { ...data.items[0], id: 'lmx', nm: 'JPG Le Male Elixir', b: jb, bs: 1 }]) };
    const fm = F.prepareData(flankData), FR = t => F.resolveFact(t, fm, L);
    assert.strictEqual(FR('hawas').item.id, 'hh', 'bare hawas → Hawas for Him'); assert.strictEqual(FR('hawas ice').item.id, 'hi'); assert.strictEqual(FR('hawas elixir').item.id, 'hx');
    assert.strictEqual(FR('le male').item.id, 'lm', 'bare le male → JPG Le Male'); assert.strictEqual(FR('le male elixir').item.id, 'lmx'); assert.strictEqual(FR('le male le parfum').item.id, 'lmp');
    assert.deepStrictEqual(F.parseCompare('difference between hawas and hawas ice').names, ['hawas', 'hawas ice']);
  }

  console.log('test-finder: engine checks passed' + (lexicon ? '' : ' (stand-in lexicon)'));
}

// ── NLU (Phase 2 Layer B: scripts/lib/embed.js, scripts/lib/finder-exemplars.js, js/finder-nlu.js) ──
// Pure checks only — no model is loaded here. The optional package is reported,
// never required (CI without it simply ships no Layer B).
(async () => {
  const embedLib = require('./lib/embed');
  const { exemplars } = require('./lib/finder-exemplars');
  const NLU = require('../js/finder-nlu.js');
  let pkg = true; try { require.resolve('@huggingface/transformers'); } catch (e) { pkg = false; warn('@huggingface/transformers not installed — the NLU checks below run without a model (as designed)'); }

  // 1. constants in sync across build, browser module and the CI cache key
  assert.strictEqual(NLU.MODEL_ID, embedLib.MODEL_ID, 'browser and build use the same model');
  assert.strictEqual(NLU.DTYPE, embedLib.DTYPE); assert.strictEqual(NLU.DIM, embedLib.DIM);
  assert.ok(typeof NLU.ENABLED === 'boolean' && NLU.THRESHOLD > 0 && NLU.THRESHOLD < 1 && NLU.TOP >= 1);
  assert.ok(/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\//.test(NLU.LIB_URL) && /^https:\/\//.test(NLU.MODEL_HOST), 'library and model hosts are single https constants');
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy.yml'), 'utf8');
  assert.ok(yml.includes(`key: finder-model-${embedLib.MODEL_ID.replace('/', '--')}-${embedLib.DTYPE}`), 'deploy.yml cache key = model id + dtype');
  assert.ok(/actions\/cache@v4/.test(yml) && yml.includes('path: ~/.cache/transformers-js'), 'deploy.yml caches the transformers.js model dir');
  assert.ok(embedLib.MODEL_CACHE_DIR.replace(/\\/g, '/').endsWith('/.cache/transformers-js') || process.env.FINDER_MODEL_CACHE, 'MODEL_CACHE_DIR matches the cached path');
  const nluSrc = fs.readFileSync(path.join(ROOT, 'js', 'finder-nlu.js'), 'utf8');
  assert.ok(nluSrc.includes("getElementById('finder-nlu-loader')") && /data-emb\b/.test(nluSrc) && /data-embbin/.test(nluSrc), 'carrier-tag contract documented in the module');
  assert.ok(!/^import\s/m.test(nluSrc) && !/^export\s/m.test(nluSrc), 'plain script (dynamic import only)');
  assert.ok(buildSrc.includes("require('./lib/embed').embedStep(ROOT, productDetails") && buildSrc.includes("process.env.FINDER_EMBED !== '0'"), 'build calls the embed step after writeFinder, guarded by FINDER_EMBED');
  assert.ok(buildSrc.indexOf('writeFinder(ROOT') < buildSrc.indexOf('embedStep(ROOT'), 'embed step runs after finder.json is written');
  const pkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkgJson.scripts.embed, 'node scripts/lib/embed.js'); assert.strictEqual(pkgJson.scripts['eval:finder'], 'node scripts/eval-finder-nlu.js');
  assert.ok(pkgJson.optionalDependencies && pkgJson.optionalDependencies['@huggingface/transformers'], 'transformers.js is an optional dependency');

  // 2. exemplar fragments: allowed fields, prefixed keys with labels that exist in the
  //    catalogue vocab (case-insensitive, like the lexicon check), values in [-1, 1], no claims
  const ALLOWED = new Set(['features', 'strength', 'gender', 'collection', 'exclude']);
  let realVocab = null; try { realVocab = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'finder.json'), 'utf8')).vocab; } catch (e) { warn('data/finder.json missing — exemplar labels not checked against the catalogue vocab'); }
  const lk = realVocab && Object.fromEntries(['f', 'a', 'n', 'o', 'k', 'b'].map(p => [p, new Set((realVocab[p] || []).map(s => String(s).toLowerCase()))]));
  assert.ok(exemplars.length >= 150 && exemplars.length <= 400, `${exemplars.length} exemplars (expected ~200)`);
  const seenText = new Set();
  let withNeg = 0, withStrength = 0, withGender = 0;
  for (const e of exemplars) {
    assert.ok(typeof e.text === 'string' && e.text.trim().length >= 4 && e.text.length <= 120, 'exemplar text: ' + e.text);
    assert.ok(!seenText.has(e.text), 'duplicate exemplar: ' + e.text); seenText.add(e.text);
    assert.ok(e.frag && typeof e.frag === 'object', 'fragment object: ' + e.text);
    for (const k of Object.keys(e.frag)) assert.ok(ALLOWED.has(k), `fragment field "${k}" not allowed (${e.text})`);
    const f = e.frag.features || {};
    assert.ok(Object.keys(f).length || e.frag.strength || e.frag.gender || e.frag.collection, 'fragment has an effect: ' + e.text);
    for (const k of Object.keys(f)) {
      const m = /^([fanokb]):(.+)$/.exec(k); assert.ok(m, `feature key "${k}" (${e.text})`);
      const v = f[k]; assert.ok(typeof v === 'number' && v >= -1 && v <= 1 && v !== 0, `feature value ${k}=${v} (${e.text})`);
      if (lk) assert.ok(lk[m[1]].has(m[2].toLowerCase()), `label not in the catalogue vocab: ${k} (${e.text})`);
      if (v < 0) withNeg++;
    }
    if (e.frag.strength) { assert.ok(['stronger', 'softer'].includes(e.frag.strength)); withStrength++; }
    if (e.frag.gender) { assert.ok(['men', 'unisex'].includes(e.frag.gender)); withGender++; }
    if (e.frag.collection) assert.strictEqual(e.frag.collection, 'exclusive');
    if (e.frag.exclude) { assert.ok(Array.isArray(e.frag.exclude)); e.frag.exclude.forEach(x => assert.ok(/^brand:.+/.test(x), 'exclude entries are brand:<Name>')); }
    assert.ok(!/price|maxPrice|minPrice|৳|\btk\b/i.test(JSON.stringify(e.frag)), 'no prices in fragments (the parser owns numbers): ' + e.text);
    assert.ok(!BANNED.test(JSON.stringify(e)), 'banned claim in exemplar: ' + e.text);
  }
  assert.ok(withNeg >= 10 && withStrength >= 10 && withGender >= 3, `coverage: ${withNeg} negative weights, ${withStrength} strength, ${withGender} gender fragments`);

  // 3. semantic card (deterministic text from recs item + details + vocab)
  const card = embedLib.semanticCard(data.items.find(i => i.id === 'a'), details.a, data.vocab);
  assert.ok(card.startsWith('Alpha · Rasasi · ') && card.includes('Woody') && card.includes('Bergamot') && card.includes('Office') && card.includes('for men') && card.includes('EDP'), card);
  assert.ok(!card.includes('](') && !card.includes('/brands/') && card.includes('by Rasasi with'), 'markdown links reduced to their text');
  assert.strictEqual(embedLib.semanticCard(data.items[0], undefined, data.vocab), embedLib.semanticCard(data.items[0], {}, data.vocab), 'missing details tolerated');
  const longCard = embedLib.semanticCard(data.items[0], { description: 'word '.repeat(1000) }, data.vocab);
  assert.ok(longCard.length <= embedLib.semanticCard(data.items[0], {}, data.vocab).length + embedLib.CARD_DESC_CHARS + 3, 'description capped at 600 chars');

  // 4. quantisation, packing, PCA projection and the browser-side match (synthetic rows, no model)
  const rnd = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296 - 0.5; };   // mulberry32
  const r = rnd(7); const mkRow = () => embedLib.l2(Float32Array.from({ length: embedLib.DIM }, r));
  const prodRows = Array.from({ length: 5 }, mkRow), exRows = Array.from({ length: 8 }, mkRow), ex8 = exemplars.slice(0, 8);
  const full = embedLib.pack({ productRows: prodRows, exemplarRows: exRows, exemplars: ex8, src: 'test', dims: 0, key: 'k' });
  assert.strictEqual(full.bin.length, 13 * embedLib.DIM, 'bin = rows × dim int8'); assert.strictEqual(full.json.rows, 13); assert.strictEqual(full.json.products, 5); assert.strictEqual(full.json.scales.length, 13); assert.ok(!full.json.pca);
  assert.strictEqual(full.json.model, embedLib.MODEL_ID); assert.strictEqual(full.json.dtype, embedLib.DTYPE); assert.strictEqual(full.json.exemplars.length, 8); assert.deepStrictEqual(Object.keys(full.json.exemplars[0]), ['text', 'frag']);
  const q = embedLib.quantRow(exRows[0]); let dot = 0, n2 = 0; for (let i = 0; i < q.q.length; i++) { dot += q.q[i] * q.scale * exRows[0][i]; n2 += (q.q[i] * q.scale) ** 2; }
  assert.ok(Math.abs(dot / Math.sqrt(n2) - 1) < 1e-3, 'int8 row ≈ float row');
  assert.deepStrictEqual(Array.from(NLU._quantRow(exRows[1])), Array.from(embedLib.quantRow(exRows[1]).q), 'browser and build quantise identically');
  const red = embedLib.pack({ productRows: prodRows, exemplarRows: exRows, exemplars: ex8, src: 'test', dims: 8, key: 'k', pcaIters: 20 });
  assert.strictEqual(red.json.dim, 8); assert.ok(red.json.pca && red.json.pca.offset === 13 * 8 && red.json.pca.mean.length === embedLib.DIM && red.json.pca.dim === embedLib.DIM);
  assert.strictEqual(red.bin.length, 13 * 8 + embedLib.DIM * 8, 'projection matrix appended after the rows'); assert.ok(red.json.pca.variance > 0 && red.json.pca.variance <= 1);
  assert.deepStrictEqual(embedLib.pack({ productRows: prodRows, exemplarRows: exRows, exemplars: ex8, src: 'test', dims: 8, key: 'k', pcaIters: 20 }).bin, red.bin, 'PCA packing is deterministic');
  NLU._expect(embedLib.MODEL_ID, embedLib.DTYPE);
  const i8 = b => new Int8Array(b.buffer, b.byteOffset, b.length);
  NLU._setIndex(full.json, i8(full.bin));
  let m = NLU._match(exRows[2]); assert.strictEqual(m.exemplars[0].text, ex8[2].text); assert.ok(m.confidence > 0.99 && m.confidence <= 1.0001, 'own row → cosine ≈ 1: ' + m.confidence);
  NLU._setIndex(red.json, i8(red.bin));
  const pr = NLU._project(exRows[2]); assert.strictEqual(pr.length, 8); let nn = 0; pr.forEach(x => { nn += x * x; }); assert.ok(Math.abs(nn - 1) < 1e-4, 'projected query is unit length');
  m = NLU._match(exRows[2]); assert.strictEqual(m.exemplars[0].text, ex8[2].text, 'PCA index still finds its own row first');
  const jsonOnly = embedLib.packTexts({ exemplars: ex8, src: 'test' });
  assert.strictEqual(jsonOnly.bin, null); assert.strictEqual(jsonOnly.json.rows, 0); assert.strictEqual(jsonOnly.json.products, 0); assert.ok(/^[0-9a-f]{16}$/.test(jsonOnly.json.key));
  assert.strictEqual(embedLib.packTexts({ exemplars: ex8, src: 'other' }).json.key, jsonOnly.json.key, 'key depends on model + dtype + texts only');
  assert.notStrictEqual(embedLib.packTexts({ exemplars: ex8, src: 'test', modelId: 'x/y' }).json.key, jsonOnly.json.key);
  NLU._setIndex(jsonOnly.json, null); assert.throws(() => NLU._scores(exRows[0]), /no vectors yet/, 'json-only index needs the on-device rows first');
  assert.throws(() => NLU._setIndex(Object.assign({}, full.json, { model: 'other/model' }), i8(full.bin)), /index built with/, 'model mismatch refused');
  assert.throws(() => NLU._setIndex(full.json, i8(full.bin).subarray(0, 100)), /bin too short/);
  // merge rule: top-3 above the threshold, weights relative to the best, clamped to [-1, 1], best-first scalar fields, exclude union
  const base = mkRow(); const near = embedLib.l2(Float32Array.from(base, (x, i) => x + (i % 7 ? 0 : 0.01)));
  const two = embedLib.pack({ productRows: [], exemplarRows: [base, near, mkRow()], exemplars: [
    { text: 'a', frag: { features: { 'a:Sweet': 0.8, 'a:Fresh': -0.5 }, strength: 'softer' } },
    { text: 'b', frag: { features: { 'a:Sweet': 0.8, 'o:Office': 1 }, gender: 'men', exclude: ['brand:Armaf'] } },
    { text: 'c', frag: { features: { 'a:Oud': 1 } } }], src: 't', dims: 0, key: 'k' });
  NLU._setIndex(two.json, i8(two.bin));
  m = NLU._match(base);
  assert.deepStrictEqual(m.exemplars.map(e => e.text), ['a', 'b'], 'unrelated row is below the threshold: ' + JSON.stringify(m.exemplars));
  assert.strictEqual(m.features['a:Sweet'], 1, 'agreeing features add up and clamp to 1'); assert.ok(m.features['a:Fresh'] < 0 && m.features['o:Office'] > 0.9, JSON.stringify(m.features));
  assert.strictEqual(m.strength, 'softer'); assert.strictEqual(m.gender, 'men'); assert.deepStrictEqual(m.exclude, ['brand:Armaf']); assert.ok(!m.collection);
  assert.ok(Object.values(m.features).every(v => v >= -1 && v <= 1) && m.confidence > 0.99);
  const none = NLU._match(embedLib.l2(Float32Array.from(base, x => -x)));
  assert.deepStrictEqual(none.features, {}); assert.strictEqual(none.exemplars.length, 0); assert.ok(none.confidence < NLU.THRESHOLD, 'nothing above the threshold → empty fragment, confidence reported');
  // load() through the on-device path with an injected embedder (what the eval and the browser do)
  NLU._state.ready = false; NLU._state.loading = null;
  const fakeEmbed = async texts => texts.map((t, i) => (i % 2 ? near : base));
  await NLU.load({ embed: fakeEmbed, index: { json: embedLib.packTexts({ exemplars: [{ text: 'p', frag: { features: { 'a:Oud': 1 } } }, { text: 'q', frag: { features: { 'a:Rose': 1 } } }], src: 't' }).json, bin: null } });
  assert.ok(NLU.ready() && NLU._state.index.rows.length === 2 * embedLib.DIM, 'exemplar rows built on load from the injected embedder');
  const u = await NLU.understand('anything');
  assert.ok(u.exemplars.length === 2 && u.features['a:Oud'] === 1 && u.features['a:Rose'] > 0.9, JSON.stringify(u));

  // 5. write / hard size guard / removal (temp dir) and the build hook's behaviour
  const eroot = fs.mkdtempSync(path.join(os.tmpdir(), 'emb-')); fs.mkdirSync(path.join(eroot, 'data'));
  const embJson = path.join(eroot, 'data', 'finder-emb.json'), embBin = path.join(eroot, 'data', 'finder-emb.bin');
  const s1 = embedLib.writeEmbeddings(eroot, jsonOnly);
  assert.ok(fs.existsSync(embJson) && !fs.existsSync(embBin) && s1.gzTotal <= embedLib.MAX_GZIP && s1.binRaw === 0);
  embedLib.writeEmbeddings(eroot, full); assert.ok(fs.existsSync(embBin), 'vectors mode writes the bin'); assert.deepStrictEqual(fs.readFileSync(embBin), full.bin);
  embedLib.writeEmbeddings(eroot, jsonOnly); assert.ok(!fs.existsSync(embBin), 'json-only mode removes a stale bin');
  const huge = embedLib.pack({ productRows: Array.from({ length: 200 }, mkRow), exemplarRows: Array.from({ length: 200 }, mkRow), exemplars: Array.from({ length: 200 }, (_, i) => ({ text: 'x' + i, frag: { features: { 'a:Oud': 1 } } })), src: 't', dims: 0, key: 'k' });
  assert.ok(embedLib.sizes(huge).gzTotal > embedLib.MAX_GZIP, 'synthetic 400 × 384 int8 index is over budget'); assert.throws(() => embedLib.writeEmbeddings(eroot, huge), /over budget/);
  assert.strictEqual(fs.readFileSync(embJson, 'utf8'), JSON.stringify(jsonOnly.json), 'a rejected write leaves the previous file intact');
  assert.strictEqual(embedLib.removeEmbeddings(eroot), 1); assert.strictEqual(embedLib.removeEmbeddings(eroot), 0);
  // embedStep: FINDER_EMBED=0 → null + stale files removed; json-only default needs no model; vectors with a failing embedder → null, nothing left behind
  const prevEnv = process.env.FINDER_EMBED, logs2 = [], log2 = m => logs2.push(m);
  fs.writeFileSync(embJson, '{}'); process.env.FINDER_EMBED = '0';
  assert.strictEqual(await embedLib.embedStep(eroot, {}, { log: log2 }), null); assert.ok(!fs.existsSync(embJson) && /FINDER_EMBED=0/.test(logs2[0]));
  delete process.env.FINDER_EMBED;
  assert.strictEqual(await embedLib.embedStep(eroot, {}, { log: log2 }), null, 'missing data/finder.json → null, no throw'); assert.ok(/skipped/.test(logs2[logs2.length - 1]));
  fs.writeFileSync(path.join(eroot, 'data', 'finder.json'), JSON.stringify(data));
  const s2 = await embedLib.embedStep(eroot, details, { log: log2 });
  assert.ok(s2 && s2.gzTotal <= embedLib.MAX_GZIP && fs.existsSync(embJson) && !fs.existsSync(embBin), 'default (json-only) step writes the index without a model');
  const shipped = JSON.parse(fs.readFileSync(embJson, 'utf8'));
  assert.strictEqual(shipped.exemplars.length, exemplars.length); assert.strictEqual(shipped.rows, 0); assert.strictEqual(shipped.model, embedLib.MODEL_ID); assert.strictEqual(shipped.src, data.src);
  assert.strictEqual(await embedLib.embedStep(eroot, details, { log: log2, vectors: true, noCache: true, embed: async () => { throw new Error('no network'); } }), null, 'vectors mode with a failing embedder → null');
  assert.ok(!fs.existsSync(embJson) && !fs.existsSync(embBin), 'stale index removed after a failure'); assert.ok(/no network/.test(logs2.join('\n')));
  const s3 = await embedLib.embedStep(eroot, details, { log: log2, vectors: true, noCache: true, dims: 0, exemplars: ex8, embed: async texts => texts.map(mkRow) });
  assert.ok(s3 && fs.existsSync(embBin) && fs.statSync(embBin).size === (data.items.length + 8) * embedLib.DIM, 'vectors mode with a small catalogue: rows = products + exemplars: ' + logs2[logs2.length - 1]);
  assert.strictEqual(JSON.parse(fs.readFileSync(embJson, 'utf8')).rows, data.items.length + 8);
  assert.strictEqual(await embedLib.embedStep(eroot, details, { log: log2, vectors: true, noCache: true, dims: 0, embed: async texts => texts.map(mkRow) }), null, 'all 243 exemplars at 384-d do not fit the budget → null (why json-only is the default)');
  assert.ok(/over budget/.test(logs2[logs2.length - 2] + logs2[logs2.length - 1]), logs2.slice(-2).join(' | '));
  if (prevEnv != null) process.env.FINDER_EMBED = prevEnv; else delete process.env.FINDER_EMBED;

  // 6. the real shipped index, when the build has produced one: hard 40 KB gzip test + consistency
  const realJson = path.join(ROOT, 'data', 'finder-emb.json'), realBin = path.join(ROOT, 'data', 'finder-emb.bin');
  if (fs.existsSync(realJson)) {
    const j = JSON.parse(fs.readFileSync(realJson, 'utf8'));
    let gzTotal = zlib.gzipSync(fs.readFileSync(realJson), { level: 9 }).length;
    assert.strictEqual(j.v, 1); assert.strictEqual(j.model, embedLib.MODEL_ID); assert.strictEqual(j.dtype, embedLib.DTYPE); assert.strictEqual(j.exemplars.length, exemplars.length);
    if (j.rows > 0) {
      assert.ok(fs.existsSync(realBin), 'rows > 0 → bin present');
      const bin = fs.readFileSync(realBin); gzTotal += zlib.gzipSync(bin, { level: 9 }).length;
      assert.strictEqual(bin.length, j.rows * j.dim + (j.pca ? j.pca.dim * j.dim : 0), 'bin bytes = rows × dim (+ projection)');
      assert.strictEqual(j.scales.length, j.rows); assert.strictEqual(j.rows, j.products + j.exemplars.length);
    } else assert.ok(!fs.existsSync(realBin), 'json-only index ships no bin');
    assert.ok(gzTotal <= embedLib.MAX_GZIP, `data/finder-emb.* is ${(gzTotal / 1024).toFixed(1)} KB gzip > ${embedLib.MAX_GZIP / 1024} KB`);
    console.log(`test-finder: data/finder-emb.json ${j.rows ? '+ .bin ' : ''}= ${(gzTotal / 1024).toFixed(1)} KB gzip (${j.exemplars.length} exemplars${j.rows ? `, ${j.rows} rows × ${j.dim}` : ', json-only'})`);
  } else warn('data/finder-emb.json not built — shipped-size check skipped');

  // 7. asset versioning stamps the carrier tag's data-emb / data-embbin
  const emap = { 'js/finder-nlu.js': 'aaaaaaaa', 'data/finder-emb.json': 'bbbbbbbb', 'data/finder-emb.bin': 'cccccccc' };
  const tag = '<script type="text/plain" id="finder-nlu-loader" src="js/finder-nlu.js" data-emb="data/finder-emb.json" data-embbin="/data/finder-emb.bin?v=stale" data-model-mb="24"></script>';
  const stamped = versionHtml(tag, emap);
  assert.ok(stamped.includes('src="js/finder-nlu.js?v=aaaaaaaa"') && stamped.includes('data-emb="data/finder-emb.json?v=bbbbbbbb"') && stamped.includes('data-embbin="/data/finder-emb.bin?v=cccccccc"') && stamped.includes('data-model-mb="24"'), stamped);
  assert.strictEqual(versionHtml(tag, { 'js/finder-nlu.js': 'aaaaaaaa' }), tag.replace('src="js/finder-nlu.js"', 'src="js/finder-nlu.js?v=aaaaaaaa"'), 'data files missing from the map are left alone');

  console.log('test-finder: NLU checks passed' + (pkg ? '' : ' (package absent)'));
})().catch(e => { console.error(e); process.exit(1); });
