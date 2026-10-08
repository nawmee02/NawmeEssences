// Unit checks for the recommendation data builder (scripts/lib/recs.js) and,
// once present, the client scorer (js/recs.js). Plain assert, no framework;
// runs inside `npm run build` so a regression fails the deploy.
const assert = require('assert');
const zlib = require('zlib');
const { buildRecs, writeRecs, norm, familyTokens, MAX_GZIP } = require('./lib/recs');
const { renderCard } = require('./lib/render-card');

// ── synthetic catalogue ─────────────────────────────────────────
const products = [
  { id: 'a', name: 'Alpha', brand: 'Rasasi', collection: 'regular', inStock: true, is_bestseller: true, updatedAt: '2026-10-07T16:38:54.05535+00:00', salePercent: 0, sizes: [{ ml: 5, price: 250 }, { ml: 3, price: 170 }], tags: ['new'] },
  { id: 'b', name: 'Bravo', brand: 'Rasasi', collection: 'regular', inStock: true, is_bestseller: false, updatedAt: '2026-10-01T00:00:00+00:00', salePercent: 10, sizes: [{ ml: 3, price: 200 }], tags: [] },
  { id: 'c', name: 'Charlie', brand: 'Lattafa', collection: 'exclusive', inStock: false, is_bestseller: false, updatedAt: '2026-09-01T00:00:00+00:00', salePercent: 0, sizes: [{ ml: 3, price: 600 }], tags: ['discontinued'] },
  { id: 'd', name: 'Delta', brand: 'Afnan', collection: 'regular', inStock: true, is_bestseller: false, updatedAt: '2026-08-01T00:00:00+00:00', salePercent: 0, sizes: [], tags: [] },
];
const details = {
  a: { family: 'Oriental / Spicy', accords: ['Woody', 'Musky.'], top: ['Bergamot'], heart: ['Patchouli.'], base: ['Ambroxan.'], occasions: ['Office', 'Everyday'], gender: 'men', concentration: 'EDP', description: '' },
  b: { family: 'Oriental Spicy', accords: ['Musky', 'woody'], top: ['Patchouli'], heart: [], base: ['Elemi resin'], occasions: [], gender: '', concentration: '', description: 'A unisex fragrance launched in 2020.' },
  c: { family: 'Fruity/Woody', accords: ['Fruity'], top: ['Granny Smith apple'], heart: ['Elemi Resin'], base: [], occasions: ['Party'], gender: 'unisex', concentration: 'Extrait', description: '' },
  d: { family: 'Aquatic', accords: [], top: [], heart: [], base: [], occasions: [], gender: '', concentration: '', description: '' },
};
const derive = {
  occasionsOf: d => (d.occasions && d.occasions.length ? d.occasions : ['Everyday']),
  concentrationOf: (d, name, text) => d.concentration || (/\bEDT\b/.test(name) ? 'EDT' : ''),
  genderOf: (d, text) => ({ men: 'Men', women: 'Women', unisex: 'Unisex' }[String(d.gender || '').toLowerCase()] || (/unisex/i.test(text) ? 'Unisex' : '')),
  imageVersion: u => Math.floor(new Date(u).getTime() / 1000),
};

// ── builder ────────────────────────────────────────────────────
assert.strictEqual(norm(' Musky. '), 'Musky');
assert.deepStrictEqual(familyTokens('Oriental / Spicy'), ['Oriental', 'Spicy']);
assert.deepStrictEqual(familyTokens('Fruity/Woody'), ['Fruity', 'Woody']);

const data = buildRecs(products, details, derive);
assert.strictEqual(data.v, 1);
assert.strictEqual(data.src, '2026-10-07T16:38:54+00:00', 'src = max updatedAt at second precision');
assert.deepStrictEqual(data.items.map(i => i.id), ['a', 'b', 'c'], 'build order kept; sizeless product dropped');
assert.deepStrictEqual(data.vocab.a, ['Woody', 'Musky', 'Fruity'], 'accords normalised and case-folded ("Musky." / "woody"), first-seen order');
assert.deepStrictEqual(data.vocab.f, ['Oriental', 'Spicy', 'Fruity', 'Woody'], 'family tokenised');
assert.deepStrictEqual(data.vocab.n, ['Bergamot', 'Patchouli', 'Ambroxan', 'Elemi resin', 'Granny Smith apple'], 'notes de-duplicated across punctuation and case');
const [A, B, C] = data.items;
assert.deepStrictEqual(A.f, [0, 1]); assert.deepStrictEqual(B.f, [0, 1]); assert.deepStrictEqual(C.f, [2, 3]);
assert.deepStrictEqual(A.a, [0, 1]); assert.deepStrictEqual(B.a, [1, 0]);
assert.strictEqual(A.g, 1); assert.strictEqual(B.g, 3, 'gender parsed from the description'); assert.strictEqual(C.g, 3);
assert.strictEqual(data.vocab.k[A.k], 'EDP'); assert.strictEqual(B.k, -1);
assert.deepStrictEqual(A.s, [[3, 170], [5, 250]], 'sizes sorted by ml');
assert.strictEqual(B.p, 180, 'min effective price applies the sale');
assert.strictEqual(C.i, 0); assert.strictEqual(A.bs, 1); assert.strictEqual(A.c, 'r'); assert.strictEqual(C.c, 'e');
assert.deepStrictEqual(B.o, [data.vocab.o.indexOf('Everyday')], 'occasions come from the shared derive helper');

// p must equal what renderCard puts in data-price for the same product.
for (const p of products.filter(x => x.sizes.length)) {
  const html = renderCard({ ...p, sale_percent: p.salePercent, accords: [], image_thumb: 'x', image_small: 'x' });
  const dp = Number(html.match(/data-price="(\d+)"/)[1]);
  assert.strictEqual(data.items.find(i => i.id === p.id).p, dp, `p matches renderCard data-price for ${p.id}`);
}

// Deterministic: the same input twice gives the same bytes.
assert.strictEqual(JSON.stringify(buildRecs(products, details, derive)), JSON.stringify(data));

// Size guard.
const big = { ...data, items: Array.from({ length: 4000 }, (_, i) => ({ ...A, id: 'p' + i, nm: 'Product number ' + i + ' ' + Math.random() })) };
assert.ok(zlib.gzipSync(JSON.stringify(big)).length > MAX_GZIP);
assert.throws(() => writeRecs(require('os').tmpdir(), big), /over the/);

// ── client scorer (js/recs.js, UMD) — skipped until it exists ─────
let scorer = null;
try { scorer = require('../js/recs.js'); } catch (e) { /* step 3 adds it */ }
if (scorer && scorer.rank) {
  const now = Date.now();
  const model = scorer.prepareData(data);
  // No signals → nothing.
  assert.deepStrictEqual(scorer.rank(model, [], { collection: 'r', exclude: [], limit: 4 }), []);
  // A viewed + B carted (both Oriental/Spicy, Rasasi): the only remaining regular in-stock item is… none (C is exclusive + OOS),
  // so build a profile and check the exclusion + collection rules on the full set.
  const sig = [{ t: 'v', id: 'a', ts: now }, { t: 'c', id: 'b', ts: now, ml: 3 }];
  const all = scorer.rank(model, sig, { collection: null, exclude: [], limit: 10, minCos: 0 });
  assert.ok(all.every(r => r.id !== 'a' && r.id !== 'b'), 'signal items are excluded');
  assert.ok(all.every(r => r.id !== 'c'), 'out-of-stock items are excluded');
  // Decay: a 60-day-old cart signal weighs less than a fresh view.
  const prof1 = scorer.buildProfile(model, [{ t: 'c', id: 'a', ts: now - 60 * 864e5 }]);
  const prof2 = scorer.buildProfile(model, [{ t: 'v', id: 'a', ts: now }]);
  assert.ok(prof1.weight < prof2.weight, 'decay applied');
  // Price band uses the chosen size's price for events with an ml.
  const pb = scorer.buildProfile(model, [{ t: 's', id: 'a', ts: now, ml: 5 }]);
  assert.ok(Math.abs(pb.logP - Math.log(250)) < 1e-9, 'size event uses that size price');
  const pv = scorer.buildProfile(model, [{ t: 'v', id: 'a', ts: now }]);
  assert.ok(Math.abs(pv.logP - Math.log(170)) < 1e-9, 'plain view uses the minimum price');
  console.log('test-recs: scorer checks passed');
}

console.log('test-recs: builder checks passed');
