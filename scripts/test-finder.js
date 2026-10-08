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
const { buildFinder, writeFinder, tokenize, STOP_WORDS, MAX_GZIP, MAX_KW, MIN_DF } = require('./lib/finder');
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
  q = P('not too sweet');
  assert.ok(q.features['a:Sweet'] < 0, 'negation flips sweet: ' + q.features['a:Sweet']);
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

  // ── claims: every template string and every lexicon string ──
  const strings = (v, out) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach(x => strings(x, out)); else if (v && typeof v === 'object') Object.keys(v).forEach(k => strings(v[k], out)); return out; };
  for (const s of strings(F.T, [])) assert.ok(!BANNED.test(s), 'template makes a longevity/projection claim: ' + s);
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
  assert.strictEqual(dr, 'Vanilla, tonka bean & sweet · from ৳100', 'de-duplicated reason: ' + dr);
  const danchor = { kind: 'catalog', id: 'v', name: 'V' };
  assert.ok(!/vanilla.*vanilla/i.test(F.reasons({ item: dm.byId.get('v') }, Q({ anchor: danchor }), dm, danchor)), 'anchor mode de-duplicated too');
  // no-effect texts: nothing parsed, nothing unknown (the UI answers with T.nothingNew)
  q = P('different brands', { lastBrands: [] }); assert.strictEqual(q.parts.length, 0); assert.deepStrictEqual(q.unknown, []);
  assert.ok(/nothing new/i.test(F.T.nothingNew) && /\{n\}/.test(F.T.status), 'no-op reply and sr status templates present');
  if (lexicon) assert.strictEqual(P('bhai fresh kichu dekhan').gender, null, '"bhai"/"vai" are address words, not a gender');

  console.log('test-finder: engine checks passed' + (lexicon ? '' : ' (stand-in lexicon)'));
}
