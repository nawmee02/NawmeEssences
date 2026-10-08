// ============================================================
//  recs.js — builds data/recs.json, the compact feature file the
//  browser scores for "Recommended for you" (js/recs.js).
//
//  Every field is a copy of what the build already bakes into the
//  product cards and the Fragrance Snapshot: nothing is invented.
//  The output is DETERMINISTIC (no build date, build order kept,
//  vocab in first-seen order) so its content hash — and therefore
//  the returning visitor's cached copy — only changes when the
//  catalogue data changes. Size is guarded: the writer throws if
//  the gzipped file would exceed MAX_GZIP bytes.
// ============================================================
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_GZIP = 15 * 1024;
const FORMAT = 1;

// Vocab tokens are trimmed, lose trailing punctuation ("Musky." → "Musky") and
// are de-duplicated case-insensitively ("Elemi resin" ~ "Elemi Resin"), keeping
// the first-seen spelling for display.
const norm = s => String(s == null ? '' : s).trim().replace(/[.;,]+$/, '').replace(/\s+/g, ' ');
const key = s => norm(s).toLowerCase();
const familyTokens = f => norm(f).split(/[\s/&,+]+/).map(norm).filter(Boolean);

function vocab() {
  const list = [], idx = new Map();
  return {
    list,
    add(v) {
      const k = key(v);
      if (!k) return -1;
      if (!idx.has(k)) { idx.set(k, list.length); list.push(norm(v)); }
      return idx.get(k);
    },
    addAll(arr) {
      const out = [];
      for (const v of (Array.isArray(arr) ? arr : [])) { const i = this.add(v); if (i >= 0 && !out.includes(i)) out.push(i); }
      return out;
    },
  };
}

const GENDER_CODE = { Men: 1, Women: 2, Unisex: 3 };
const COLLECTION_CODE = { regular: 'r', exclusive: 'e', special: 's' };
const effectivePrice = (price, sp) => (sp > 0 ? Math.round(price * (100 - sp) / 100) : price);

// derive = { occasionsOf(d), concentrationOf(d, name, text), genderOf(d, text), imageVersion(updatedAt) }
function buildRecs(allProducts, productDetails, derive) {
  const V = { b: vocab(), f: vocab(), a: vocab(), n: vocab(), o: vocab(), k: vocab() };
  let src = '';
  const items = [];
  for (const p of allProducts) {
    const d = productDetails[p.id] || {};
    const text = String(d.description || '');
    const sizes = (p.sizes || []).slice().sort((a, b) => a.ml - b.ml);
    if (!sizes.length) continue;
    const sp = Number(p.salePercent) || 0;
    const notes = [...(d.top || []), ...(d.heart || []), ...(d.base || [])];
    const conc = derive.concentrationOf ? derive.concentrationOf(d, p.name, text) : (d.concentration || '');
    const gender = derive.genderOf ? derive.genderOf(d, text) : '';
    if (p.updatedAt && String(p.updatedAt) > src) src = String(p.updatedAt);
    items.push({
      id: p.id,
      nm: p.name,
      b: V.b.add(p.brand),
      c: COLLECTION_CODE[p.collection] || 'r',
      f: V.f.addAll(familyTokens(d.family)),
      a: V.a.addAll(d.accords),
      n: V.n.addAll(notes),
      o: V.o.addAll(derive.occasionsOf ? derive.occasionsOf(d) : (d.occasions || [])),
      g: GENDER_CODE[gender] || 0,
      k: conc ? V.k.add(conc) : -1,
      s: sizes.map(s => [s.ml, s.price]),
      sp,
      p: effectivePrice(Math.min(...sizes.map(s => s.price)), sp),
      i: p.inStock === false ? 0 : 1,
      bs: p.is_bestseller ? 1 : 0,
      t: (p.tags || []).slice(),
      v: derive.imageVersion ? derive.imageVersion(p.updatedAt) : 0,
    });
  }
  return {
    v: FORMAT,
    src: src.replace(/\.\d+(?=[+Z])/, ''),   // seconds precision is plenty; keeps the file stable
    vocab: { b: V.b.list, f: V.f.list, a: V.a.list, n: V.n.list, o: V.o.list, k: V.k.list },
    items,
  };
}

function writeRecs(ROOT, data) {
  const json = JSON.stringify(data);
  const gz = zlib.gzipSync(json).length;
  if (gz > MAX_GZIP) throw new Error(`data/recs.json is ${gz} B gzipped — over the ${MAX_GZIP} B budget`);
  const dir = path.join(ROOT, 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'recs.json'), json);
  return { raw: json.length, gz, items: data.items.length };
}

module.exports = { buildRecs, writeRecs, norm, familyTokens, MAX_GZIP, FORMAT };
