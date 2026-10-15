// ============================================================
//  finder.js — builds data/finder.json, the feature file behind the
//  "Find a Scent" page (recommend.html, js/finder.js).
//
//  It is the recs file (scripts/lib/recs.js) plus what the chat needs
//  on top:
//    • kw  — up to 12 description keywords per product (TF-IDF over
//            the catalogue, stop-words and the product's own name/brand
//            removed, tokens that are already a feature removed), so
//            words from the owner's own copy ("mature", "clubbing",
//            "compliment") can match without inventing anything;
//    • ref — normalised `inspired_by` names (vocab.r) when the column
//            exists, so an owner-entered "alternative to X" is a
//            VERIFIED match and outranks lexicon similarity;
//    • lg / pj — longevity / projection, ONLY copied when the
//            (future) columns carry a number. Nothing is claimed
//            from them until they exist.
//    • cp  — co-purchase pairs [[idx, w], …] (scripts/lib/copurchase.js;
//            idx = index in `items`, w ∈ (0, 1]) for "People who chose
//            #1 also considered…". Display-only, never scored; present
//            only when the build had the service key and enough orders.
//
//  vocab.b/f/a/n/o/k are copied verbatim from the recs data, so every
//  index is identical to data/recs.json and the finder's vectors line
//  up key-for-key with js/recs.js. Items keep every recs field.
//
//  DETERMINISTIC: same input → same bytes (no dates, build order kept,
//  vocab.w / vocab.r in first-seen order, float ties broken by first
//  occurrence). Size-guarded: writeFinder throws above MAX_GZIP.
// ============================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { norm } = require('./recs');

const MAX_GZIP = 20 * 1024;
const FORMAT = 1;
const MAX_KW = 12;          // keywords per product
const MIN_DF = 2;           // a keyword must appear in ≥ 2 descriptions to be useful
const TOKEN_RE = /[a-z]{4,}/g;

// Stop-words: common English function words (only ≥ 4-letter ones can ever be
// tokenised, the rest are kept for readability) plus shop/marketing words that
// every description carries and that never describe a scent.
const STOP_WORDS = new Set([
  // common English
  'about', 'above', 'after', 'again', 'against', 'also', 'always', 'among', 'another', 'anyone', 'anything', 'around',
  'away', 'back', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'bring', 'brings', 'came', 'cannot',
  'come', 'comes', 'could', 'does', 'doing', 'done', 'down', 'during', 'each', 'either', 'else', 'enough', 'even',
  'ever', 'every', 'everyone', 'everything', 'feel', 'feels', 'felt', 'from', 'gets', 'getting', 'give', 'gives',
  'goes', 'going', 'gone', 'have', 'having', 'here', 'however', 'into', 'itself', 'just', 'keep', 'keeps', 'kept',
  'know', 'known', 'last', 'later', 'least', 'less', 'like', 'likely', 'little', 'look', 'looks', 'made', 'make',
  'makes', 'making', 'many', 'more', 'most', 'much', 'must', 'need', 'needs', 'neither', 'never', 'next', 'none',
  'nothing', 'often', 'once', 'only', 'onto', 'other', 'others', 'over', 'perhaps', 'quite', 'rather', 'really',
  'same', 'seem', 'seems', 'several', 'shall', 'should', 'since', 'some', 'something', 'sometimes', 'still', 'such',
  'take', 'takes', 'taking', 'than', 'that', 'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'things',
  'this', 'those', 'though', 'through', 'thus', 'time', 'times', 'toward', 'towards', 'under', 'until', 'upon', 'used',
  'using', 'very', 'want', 'wants', 'well', 'went', 'were', 'what', 'when', 'where', 'whether', 'which', 'while',
  'whole', 'whom', 'whose', 'will', 'with', 'within', 'without', 'would', 'your', 'yours', 'yourself',
  // shop / marketing words present in every description (spec list)
  'perfume', 'fragrance', 'decant', 'decants', 'bangladesh', 'authentic', 'buy', 'order', 'delivery', 'nawmeessences',
  'scent', 'notes', 'note', 'bottle', 'original', 'price', 'sizes', 'size', 'ml',
  // plurals / variants of the above and web tokens left by markdown links
  'perfumes', 'fragrances', 'scents', 'bottles', 'prices', 'orders', 'ordering', 'nawme', 'essences', 'dhaka',
  'brand', 'brands', 'product', 'products', 'http', 'https', 'html', 'shop', 'online', 'available',
  // gender words (feature g already covers them) and the description template's
  // own verbs/nouns ("opens with…, the heart develops…, creating a … impression")
  'unisex', 'women', 'woman', 'female', 'male', 'mens', 'gender',
  'opens', 'opening', 'heart', 'develops', 'develop', 'impression', 'character', 'creating', 'creates', 'created',
  'create', 'adds', 'adding', 'gives', 'giving', 'offering', 'offers', 'offer', 'presents', 'present', 'built',
  'buying', 'worth', 'exploring', 'looking', 'interesting', 'year', 'years', 'apart', 'alongside', 'alternative',
  'alternatives', 'version', 'versions', 'flanker', 'launched', 'launch', 'released', 'release', 'house', 'line',
  'lineup', 'range', 'option', 'options', 'choice', 'choices', 'ideal', 'great', 'good', 'best', 'better', 'nice',
  'overall', 'especially', 'particularly', 'slightly', 'subtly', 'somewhat', 'quite', 'truly', 'simply', 'mainly',
  'becomes', 'become', 'remains', 'remain', 'stays', 'stay', 'settles', 'settle', 'turns', 'turn', 'moves', 'move',
  'follows', 'follow', 'leads', 'lead', 'leaving', 'leaves', 'leave', 'ends', 'end', 'begins', 'begin', 'starts',
  'start', 'works', 'finish', 'finishes', 'found', 'find', 'known', 'named', 'called',
]);

// Lower-case, drop markdown link targets ("[Hugo Boss](/brands/hugo-boss/)" → "[hugo boss]")
// and bare URLs so path words never become keywords, then tokenise.
function tokenize(text) {
  const t = String(text == null ? '' : text).toLowerCase()
    .replace(/\]\([^)]*\)/g, ']')
    .replace(/https?:\/\/\S+/g, ' ');
  return t.match(TOKEN_RE) || [];
}

// Every word (≥ 4 letters) of a product's own name + brand: never a keyword for that product.
function ownWords(item, vocab) {
  const brand = item.b >= 0 && vocab.b ? vocab.b[item.b] : '';
  return new Set(tokenize(`${item.nm || ''} ${brand || ''}`));
}

// Lower-cased full labels of vocab a/n/f/o/k: those are features already
// (k — "Parfum", "Extrait" — would otherwise top many lists, as every
// description names its concentration).
function featureWords(vocab) {
  const set = new Set();
  for (const k of ['a', 'n', 'f', 'o', 'k']) for (const label of (vocab[k] || [])) set.add(String(label).toLowerCase());
  return set;
}

// Per-product candidate tokens with counts and first position, after the
// global filters (stop-words, feature labels) and the per-product one (own words).
function candidates(tokens, own, features) {
  const seen = new Map();   // token → { tf, first }
  tokens.forEach((tok, pos) => {
    if (STOP_WORDS.has(tok) || features.has(tok) || own.has(tok)) return;
    const c = seen.get(tok);
    if (c) c.tf++; else seen.set(tok, { tf: 1, first: pos });
  });
  return seen;
}

// kw per item: top MAX_KW tokens by tf·idf (desc), ties by first occurrence (asc).
function extractKeywords(items, vocab, productDetails, opts) {
  const maxKw = opts.maxKeywords || MAX_KW;
  const features = featureWords(vocab);
  const N = items.length;
  const per = items.map(it => {
    const d = productDetails[it.id] || {};
    return candidates(tokenize(d.description), ownWords(it, vocab), features);
  });
  const df = new Map();
  for (const cand of per) for (const tok of cand.keys()) df.set(tok, (df.get(tok) || 0) + 1);
  return per.map(cand => {
    const scored = [];
    for (const [tok, c] of cand) {
      const n = df.get(tok);
      if (n < MIN_DF || n >= N) continue;            // too rare to match anything / in every description
      scored.push({ tok, score: c.tf * Math.log(N / n), first: c.first });
    }
    scored.sort((x, y) => (y.score - x.score) || (x.first - y.first));
    return scored.slice(0, maxKw).map(s => s.tok);
  });
}

// First-seen vocab with case-insensitive de-duplication (same contract as recs.js vocab()).
function vocabList() {
  const list = [], idx = new Map();
  return {
    list,
    add(v) {
      const k = norm(v).toLowerCase();
      if (!k) return -1;
      if (!idx.has(k)) { idx.set(k, list.length); list.push(norm(v)); }
      return idx.get(k);
    },
  };
}

const numberOrNull = v => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));

// opts.coPurchase = buildCoPurchase() output (id → [[idx, w], …], idx = index in
// recsData.items). Copies only well-formed pairs that point at another item;
// returns [] when nothing survives (the caller then omits `cp`).
function coPurchaseOf(coPurchase, id, self, n) {
  const list = coPurchase && Object.prototype.hasOwnProperty.call(coPurchase, id) ? coPurchase[id] : null;
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const e of list) {
    if (!Array.isArray(e) || e.length < 2) continue;
    const idx = e[0], w = Number(e[1]);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n || idx === self || !Number.isFinite(w) || w <= 0) continue;
    out.push([idx, w]);
  }
  return out;
}

// Fragrantica "This perfume reminds me of" votes (scripts/reference/fragrantica-reminds.json, crawled
// by the owner's tooling): a community similarity signal. Two fields come out of it:
//   sim:  [[idx, w], …]  other CATALOGUE products voters compare this one to (both directions)
//   cref: [[rIdx, w], …] famous references voters compare it to (names in vocab.r, like inspired_by)
// w ∈ (0, 1] from the vote count and the up/down ratio; counts are never shipped.
const REMINDS_PATH = path.join(__dirname, '..', 'reference', 'fragrantica-reminds.json');   // not under a data/ dir: .gitignore ignores those
const CLONE_HOUSE_RE = /^(armaf|lattafa|afnan|rasasi|maison alhambra|french avenue|ajmal|la rive|sapil|arabiyat|al haramain|rayhaan|fragrance world|riiffs|gulf orchid|junaid|paris corner|zimaya|bharara|ard al zaafaran|swiss arabian|milestone|rave|emper|dumont|khadlaj|kindi|atralia|maison asrar|rue broca|le falcon|toskovat|mykonos|nuancielo|in the box|michael malul|zara|bath & body|rare beauty|o botic|aromatix|imrasasi|alhambra|cuba|milton lloyd|alrehab|al rehab|nusuk|my perfumes|dorall|jo milano|adyan|anfar|asdaaf|naseem|ahmed al maghribi|bentley|nautica)\b/i;
function loadReminds(opts) {
  if (opts.reminds === false) return null;
  if (opts.reminds && typeof opts.reminds === 'object') return opts.reminds;
  try { if (fs.existsSync(REMINDS_PATH)) return JSON.parse(fs.readFileSync(REMINDS_PATH, 'utf8')); } catch (e) { /* optional */ }
  return null;
}
const voteWeight = (up, down) => { const u = Number(up) || 0, d = Number(down) || 0; if (u < 5) return 0; return Math.round(Math.min(1, Math.log1p(u) / Math.log1p(400)) * (u / (u + d)) * 100) / 100; };
function communityOf(reminds, items) {
  const out = { sim: new Map(), cref: new Map() };
  if (!reminds || !reminds.items) return out;
  const idxById = new Map(items.map((it, i) => [it.id, i]));
  const idByPage = new Map(); Object.keys(reminds.items).forEach(id => { const p = reminds.items[id] && reminds.items[id].page; if (p && idxById.has(id)) idByPage.set(p, id); });
  const addSim = (a, b, w) => { if (!out.sim.has(a)) out.sim.set(a, new Map()); const m = out.sim.get(a); m.set(b, Math.max(m.get(b) || 0, w)); };
  Object.keys(reminds.items).forEach(id => {
    if (!idxById.has(id)) return;
    const list = Array.isArray(reminds.items[id].reminds) ? reminds.items[id].reminds : [];
    const crefs = [];
    list.forEach(q => {
      const w = voteWeight(q.up, q.down); if (!w) return;
      const other = idByPage.get(q.h);
      if (other && other !== id) { addSim(id, other, w); addSim(other, id, w); return; }
      const label = String(q.label || '').trim(); const ratio = (Number(q.up) || 0) / Math.max(1, Number(q.down) || 0);
      if (!other && label && (Number(q.up) || 0) >= 30 && ratio >= 2 && !CLONE_HOUSE_RE.test(label)) crefs.push([label, w]);
    });
    if (crefs.length) out.cref.set(id, crefs.sort((x, y) => y[1] - x[1]).slice(0, 3));
  });
  return out;
}

// recsData = buildRecs(...) output; productDetails[id] = { description, inspiredBy?, longevity?, projection?, … }
// opts.log(message) receives the coverage lines (default: silent); opts.maxKeywords for tests;
// opts.coPurchase (optional, see coPurchaseOf) adds `cp: [[idx, w], …]` to the items that have pairs.
function buildFinder(recsData, productDetails, opts = {}) {
  if (!recsData || recsData.v !== 1 || !Array.isArray(recsData.items)) throw new Error('buildFinder: expected buildRecs() output');
  const details = productDetails || {};
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const vocab = recsData.vocab || {};
  const kwPerItem = extractKeywords(recsData.items, vocab, details, opts);
  const W = vocabList(), R = vocabList();
  const coPurchase = opts.coPurchase && typeof opts.coPurchase === 'object' ? opts.coPurchase : null;
  const n = recsData.items.length;
  const community = communityOf(loadReminds(opts), recsData.items);
  const idxById = new Map(recsData.items.map((it, i) => [it.id, i]));
  let withRef = 0, withLg = 0, withPj = 0, withKw = 0, withCp = 0, withSim = 0, withCref = 0;
  const items = recsData.items.map((it, i) => {
    const d = details[it.id] || {};
    const kw = kwPerItem[i].map(t => W.add(t));
    const refs = Array.isArray(d.inspiredBy) ? d.inspiredBy : [];
    const ref = [];
    for (const name of refs) { const r = R.add(name); if (r >= 0 && !ref.includes(r)) ref.push(r); }
    const out = Object.assign({}, it, { kw, ref });
    const simMap = community.sim.get(it.id);
    if (simMap && simMap.size) { out.sim = [...simMap.entries()].map(([id, w]) => [idxById.get(id), w]).filter(p => p[0] != null).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 6); withSim++; }
    const crefs = community.cref.get(it.id);
    if (crefs && crefs.length) { out.cref = crefs.map(([name, w]) => [R.add(name), w]).filter(p => p[0] >= 0); withCref++; }
    const lg = numberOrNull(d.longevity), pj = numberOrNull(d.projection);
    if (lg !== null) { out.lg = lg; withLg++; }
    if (pj !== null) { out.pj = pj; withPj++; }
    const cp = coPurchaseOf(coPurchase, it.id, i, n);
    if (cp.length) { out.cp = cp; withCp++; }
    if (ref.length) withRef++;
    if (kw.length) withKw++;
    return out;
  });
  log(`keywords on ${withKw}/${n} products (${W.list.length} tokens); inspired_by on ${withRef}/${n} (${R.list.length} names); longevity set on ${withLg}/${n}; projection set on ${withPj}/${n}`);
  if (coPurchase) log(`co-purchase pairs on ${withCp}/${n} products`);
  if (withSim || withCref) log(`fragrantica reminds-of: catalogue pairs on ${withSim}/${n} products, famous references on ${withCref}/${n}`);
  return {
    v: FORMAT,
    src: recsData.src,
    vocab: {
      b: (vocab.b || []).slice(), f: (vocab.f || []).slice(), a: (vocab.a || []).slice(),
      n: (vocab.n || []).slice(), o: (vocab.o || []).slice(), k: (vocab.k || []).slice(),
      w: W.list, r: R.list,
    },
    items,
  };
}

// Same data without any `cp` (co-purchase is optional display data, so it is
// the first thing to go when the file is over budget).
function withoutCoPurchase(data) {
  return Object.assign({}, data, { items: data.items.map(it => { const { cp, ...rest } = it; return rest; }) });
}

// Writes data/finder.json; throws above MAX_GZIP. If `cp` pairs are what push
// the file over, they are dropped (logged via opts.log) and the write goes
// ahead — co-purchase data must never fail a build. Result: { raw, gz, items,
// cp: number of items carrying cp, cpDropped: true when the fallback ran }.
function writeFinder(ROOT, data, opts = {}) {
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  let out = data;
  let json = JSON.stringify(out);
  let gz = zlib.gzipSync(json).length;
  let cpDropped = false;
  if (gz > MAX_GZIP && out.items.some(it => it.cp)) {
    out = withoutCoPurchase(out);
    json = JSON.stringify(out);
    const gz2 = zlib.gzipSync(json).length;
    log(`data/finder.json would be ${gz} B gzipped with co-purchase pairs — over the ${MAX_GZIP} B budget, cp dropped (${gz2} B without)`);
    gz = gz2;
    cpDropped = true;
  }
  if (gz > MAX_GZIP) throw new Error(`data/finder.json is ${gz} B gzipped — over the ${MAX_GZIP} B budget`);
  const dir = path.join(ROOT, 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'finder.json'), json);
  return { raw: json.length, gz, items: out.items.length, cp: out.items.filter(it => it.cp).length, cpDropped };
}

module.exports = { buildFinder, writeFinder, withoutCoPurchase, tokenize, extractKeywords, STOP_WORDS, MAX_GZIP, MAX_KW, MIN_DF, FORMAT };
