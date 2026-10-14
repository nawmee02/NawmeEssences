// ============================================================
//  embed.js — builds data/finder-emb.json (+ optionally data/finder-emb.bin),
//  the exemplar index behind the Finder's Layer B (Phase 2, js/finder-nlu.js).
//
//  Two modes, one constant (SHIP_VECTORS):
//    • json-only (default, measured 2026-10-14): the index carries the
//      exemplar texts + fragments and a fingerprint; the browser embeds the
//      exemplars itself with the same model after the visitor opted in.
//      No model runs in CI; the file is ~10 KB gzip.
//    • vectors (SHIP_VECTORS = true or FINDER_EMB_VECTORS=1): the SAME model
//      the browser downloads (MODEL_ID / DTYPE) embeds every product's
//      "semantic card" (name · brand · family · accords · notes · occasions ·
//      gender · concentration · first 600 chars of the description) and every
//      exemplar in Node, mean-pooled + L2-normalised, optionally PCA-reduced to
//      PCA_DIMS (projection shipped so the browser maps sentences into the same
//      space), int8-quantised per row with one float scale, and writes
//        data/finder-emb.bin   little-endian int8: product rows, exemplar rows,
//                              then the projection matrix (DIM × dim, row-major)
//        data/finder-emb.json  { …, rows, scales, pca: { dim, mean, scale, offset, variance } }
//      Measured: 105 products + 243 exemplars at 384-d = 130 KB gzip; PCA-48 is
//      still 41.8 KB and loses the retrieval gain (scripts/eval-finder-nlu.js),
//      which is why json-only is the default.
//  Hard test (scripts/test-finder.js): whatever is written ≤ MAX_GZIP gzip.
//
//  Degrades to nothing: when the package is missing, a download fails or
//  FINDER_EMBED=0, embedStep() logs one line, deletes any stale
//  data/finder-emb.* and returns null — the finder simply has no Layer B
//  (nothing stale is ever published: data/ is built fresh in CI).
//
//  Cache (vectors mode): raw float embeddings in assets/.cache keyed by
//  sha1(model + dtype + every card / exemplar text); the model files live in
//  MODEL_CACHE_DIR (restored by actions/cache in deploy.yml).
// ============================================================
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// Chosen 2026-10-14 by scripts/eval-finder-nlu.js: both candidates are 384-d,
// 6-layer MiniLM-size models (q8 ONNX + tokenizer: mxbai 24.0 MB, all-MiniLM-L6-v2
// 22.6 MB, both under the 25 MB target). mxbai-embed-xsmall-v1 scored higher on
// every retrieval metric (English top-3 hit under finder.js's gate 21/25 vs 20/25,
// strong hit 64% vs 60%, ungated 88% vs 84%, no sentence below the 0.45 threshold),
// so quality — the first criterion — decided it. The browser (js/finder-nlu.js)
// MUST use the same id + dtype.
const MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
const DTYPE = 'q8';
const DIM = 384;                 // the model's embedding width
const SHIP_VECTORS = false;      // false = json-only index (browser embeds the exemplars)
const PCA_DIMS = 0;              // vectors mode: stored width after PCA (0 = full DIM)
const MAX_GZIP = 40 * 1024;      // everything written, gzip, combined — hard test
const FORMAT = 1;
const CARD_DESC_CHARS = 600;
const BATCH = 32;
const MODEL_CACHE_DIR = process.env.FINDER_MODEL_CACHE || path.join(os.homedir(), '.cache', 'transformers-js');

// ── semantic card ───────────────────────────────────────────
const stripMd = s => String(s == null ? '' : s)
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // [text](url) → text
  .replace(/https?:\/\/\S+/g, ' ')
  .replace(/[*_#>`]+/g, ' ')
  .replace(/\s+/g, ' ').trim();
const labels = (idx, list) => (Array.isArray(idx) ? idx : []).map(i => list && list[i]).filter(Boolean);
const GENDER_TEXT = { 1: 'for men', 2: 'for women', 3: 'unisex' };

// `item` = a finder.json / recs.json item, `details` = productDetails[id] (may be
// undefined), `vocab` = finder.json vocab. Deterministic plain text.
function semanticCard(item, details, vocab) {
  const v = vocab || {};
  const d = details || {};
  const parts = [
    item.nm || '',
    item.b >= 0 && v.b ? v.b[item.b] : '',
    labels(item.f, v.f).join(', '),
    labels(item.a, v.a).join(', '),
    labels(item.n, v.n).join(', '),
    labels(item.o, v.o).join(', '),
    GENDER_TEXT[item.g] || '',
    item.k >= 0 && v.k ? v.k[item.k] : '',
    stripMd(d.description).slice(0, CARD_DESC_CHARS),
  ];
  return parts.map(p => String(p || '').trim()).filter(Boolean).join(' · ');
}

// ── maths (plain JS, deterministic) ─────────────────────────
function l2(v) { let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i]; n = Math.sqrt(n) || 1; const o = new Float32Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] / n; return o; }

// int8 per row with one float scale: q = round(x / scale), scale = max|x| / 127.
// (js/finder-nlu.js quantRow is the same function.)
function quantRow(row) {
  let m = 0; for (let i = 0; i < row.length; i++) m = Math.max(m, Math.abs(row[i]));
  const scale = m ? m / 127 : 1;
  const q = new Int8Array(row.length);
  for (let i = 0; i < row.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(row[i] / scale)));
  return { q, scale };
}
const round = (x, p) => Number(x.toPrecision(p || 6));

// PCA by orthogonal iteration on the covariance of the centred rows.
// Returns { mean: Float32Array(D), W: Float32Array(D*k) row-major (W[i*k+j]),
// variance: fraction of total variance kept }. Deterministic (fixed start,
// fixed iteration count) so the same rows always give the same projection.
function pca(rows, k, iters) {
  const n = rows.length, D = rows[0].length; iters = iters || 60;
  const mean = new Float64Array(D);
  rows.forEach(r => { for (let i = 0; i < D; i++) mean[i] += r[i] / n; });
  const X = rows.map(r => { const o = new Float64Array(D); for (let i = 0; i < D; i++) o[i] = r[i] - mean[i]; return o; });
  // C = Xᵀ X / n (D × D)
  const C = new Float64Array(D * D);
  for (const x of X) for (let i = 0; i < D; i++) { const xi = x[i]; if (!xi) continue; const off = i * D; for (let j = 0; j < D; j++) C[off + j] += xi * x[j]; }
  for (let i = 0; i < C.length; i++) C[i] /= n;
  let total = 0; for (let i = 0; i < D; i++) total += C[i * D + i];
  // Q: D × k, start with the first k unit vectors, then repeat Q ← orth(C·Q).
  let Q = new Float64Array(D * k); for (let j = 0; j < k; j++) Q[j * k + j] = 1;
  const orth = M => {   // Gram-Schmidt on the k columns of a D × k matrix
    for (let j = 0; j < k; j++) {
      for (let p = 0; p < j; p++) { let dot = 0; for (let i = 0; i < D; i++) dot += M[i * k + j] * M[i * k + p]; for (let i = 0; i < D; i++) M[i * k + j] -= dot * M[i * k + p]; }
      let nrm = 0; for (let i = 0; i < D; i++) nrm += M[i * k + j] * M[i * k + j]; nrm = Math.sqrt(nrm) || 1;
      for (let i = 0; i < D; i++) M[i * k + j] /= nrm;
    }
    return M;
  };
  for (let it = 0; it < iters; it++) {
    const Z = new Float64Array(D * k);
    for (let i = 0; i < D; i++) { const off = i * D; for (let l = 0; l < D; l++) { const c = C[off + l]; if (!c) continue; const qo = l * k; for (let j = 0; j < k; j++) Z[i * k + j] += c * Q[qo + j]; } }
    Q = orth(Z);
  }
  // kept variance = Σ_j qⱼᵀ C qⱼ
  let kept = 0;
  for (let j = 0; j < k; j++) { for (let i = 0; i < D; i++) { let s = 0; for (let l = 0; l < D; l++) s += C[i * D + l] * Q[l * k + j]; kept += Q[i * k + j] * s; } }
  // Sign convention so the result is stable: make the largest-|entry| of each column positive.
  for (let j = 0; j < k; j++) { let bi = 0; for (let i = 1; i < D; i++) if (Math.abs(Q[i * k + j]) > Math.abs(Q[bi * k + j])) bi = i; if (Q[bi * k + j] < 0) for (let i = 0; i < D; i++) Q[i * k + j] = -Q[i * k + j]; }
  return { mean: Float32Array.from(mean), W: Float32Array.from(Q), variance: total ? kept / total : 0 };
}
// (x − mean) · W, then L2-normalised — the browser does exactly the same (js/finder-nlu.js).
function project(x, p, k) {
  const D = p.mean.length, out = new Float32Array(k);
  for (let i = 0; i < D; i++) { const xi = x[i] - p.mean[i]; if (!xi) continue; const off = i * k; for (let j = 0; j < k; j++) out[j] += xi * p.W[off + j]; }
  return l2(out);
}

// ── packing ─────────────────────────────────────────────────
const cacheKey = (texts, modelId, dtype) => crypto.createHash('sha1').update([modelId || MODEL_ID, dtype || DTYPE].concat(texts).join('\n')).digest('hex').slice(0, 16);
const baseJson = ({ exemplars, src, key, modelId, dtype }) => ({ v: FORMAT, model: modelId || MODEL_ID, dtype: dtype || DTYPE, dim: DIM, src: src || '', key, rows: 0, products: 0, exemplars: exemplars.map(e => ({ text: e.text, frag: e.frag })) });
// json-only index (no model needed).
function packTexts({ exemplars, src, modelId, dtype }) {
  return { bin: null, json: baseJson({ exemplars, src, key: cacheKey(exemplars.map(e => e.text), modelId, dtype), modelId, dtype }) };
}
// vectors index. productRows / exemplarRows: Float32Array[] (L2-normalised).
function pack({ productRows, exemplarRows, exemplars, src, dims, pcaIters, key, modelId, dtype }) {
  const all = productRows.concat(exemplarRows);
  const k = dims && dims < DIM ? dims : DIM;
  const p = k < DIM ? pca(all, k, pcaIters) : null;
  const reduced = p ? all.map(r => project(r, p, k)) : all;
  const scales = [], chunks = [];
  reduced.forEach(r => { const { q, scale } = quantRow(r); chunks.push(Buffer.from(q.buffer, q.byteOffset, q.byteLength)); scales.push(round(scale, 6)); });
  const json = Object.assign(baseJson({ exemplars, src, key: key || '', modelId, dtype }), { dim: k, rows: reduced.length, products: productRows.length, scales });
  if (p) {
    const { q, scale } = quantRow(p.W);
    json.pca = { dim: DIM, mean: Array.from(p.mean, x => round(x, 5)), scale: round(scale, 6), offset: reduced.length * k, variance: round(p.variance, 4) };
    chunks.push(Buffer.from(q.buffer, q.byteOffset, q.byteLength));
  }
  return { bin: Buffer.concat(chunks), json };
}
const gz = buf => zlib.gzipSync(buf, { level: 9 }).length;
function sizes(built) {
  const jsonStr = JSON.stringify(built.json);
  const binRaw = built.bin ? built.bin.length : 0, binGz = built.bin ? gz(built.bin) : 0;
  return { binRaw, binGz, jsonRaw: Buffer.byteLength(jsonStr), jsonGz: gz(Buffer.from(jsonStr)), get gzTotal() { return this.binGz + this.jsonGz; } };
}

// ── model (Node) ────────────────────────────────────────────
// Returns async (texts) → Float32Array[] (L2-normalised) or throws when the
// optional package is missing / the download fails.
async function loadEmbedder(opts) {
  opts = opts || {};
  const T = await import('@huggingface/transformers');
  T.env.cacheDir = opts.cacheDir || MODEL_CACHE_DIR;
  T.env.allowLocalModels = false;
  const id = opts.modelId || MODEL_ID, dtype = opts.dtype || DTYPE;
  const pipe = await T.pipeline('feature-extraction', id, { dtype, device: 'cpu' });
  const embed = async texts => {
    const out = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const chunk = texts.slice(i, i + BATCH);
      const t = await pipe(chunk, { pooling: 'mean', normalize: true });
      const [n, d] = t.dims;
      for (let r = 0; r < n; r++) out.push(l2(Float32Array.from(t.data.slice(r * d, (r + 1) * d))));
      if (typeof t.dispose === 'function') t.dispose();
    }
    return out;
  };
  embed.dispose = () => pipe.dispose();
  embed.dim = (await pipe(['x'], { pooling: 'mean', normalize: true })).dims[1];
  return embed;
}

// ── embedding cache (raw floats; keyed on model + dtype + texts) ──
function cachePath(ROOT, key) { return path.join(ROOT, 'assets', '.cache', `finder-emb-${key}.json`); }
function readCache(ROOT, key) {
  try { const j = JSON.parse(fs.readFileSync(cachePath(ROOT, key), 'utf8')); return j && Array.isArray(j.rows) ? j.rows.map(r => Float32Array.from(r)) : null; } catch (e) { return null; }
}
function writeCache(ROOT, key, rows) {
  try { fs.mkdirSync(path.dirname(cachePath(ROOT, key)), { recursive: true }); fs.writeFileSync(cachePath(ROOT, key), JSON.stringify({ v: FORMAT, rows: rows.map(r => Array.from(r, x => round(x, 6))) })); } catch (e) { /* cache is best-effort */ }
}

// ── build ───────────────────────────────────────────────────
// finderData = parsed data/finder.json; productDetails[id] = { description, … }.
// opts: { vectors (default SHIP_VECTORS), exemplars, dims, log, cacheDir, root,
//         embed (injected embedder for tests), noCache, modelId, dtype }
async function buildEmbeddings(finderData, productDetails, opts) {
  opts = opts || {};
  const log = opts.log || (() => {});
  const ex = opts.exemplars || require('./finder-exemplars').exemplars;
  const vectors = opts.vectors == null ? SHIP_VECTORS : !!opts.vectors;
  if (!vectors) { const b = packTexts({ exemplars: ex, src: finderData.src, modelId: opts.modelId, dtype: opts.dtype }); b.rows = []; b.cards = []; b.key = b.json.key; return b; }
  const vocab = finderData.vocab || {};
  const cards = finderData.items.map(it => semanticCard(it, (productDetails || {})[it.id], vocab));
  const texts = cards.concat(ex.map(e => e.text));
  const key = cacheKey(texts, opts.modelId, opts.dtype);
  const ROOT = opts.root;
  let rows = ROOT && !opts.noCache ? readCache(ROOT, key) : null;
  if (rows && rows.length === texts.length) log(`embeddings from cache (${key})`);
  else {
    const embed = opts.embed || await loadEmbedder({ modelId: opts.modelId, dtype: opts.dtype, cacheDir: opts.cacheDir });
    const t0 = Date.now();
    rows = await embed(texts);
    log(`embedded ${cards.length} cards + ${ex.length} exemplars with ${opts.modelId || MODEL_ID} (${opts.dtype || DTYPE}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    if (!opts.embed && embed.dispose) await embed.dispose();
    if (ROOT && !opts.noCache) writeCache(ROOT, key, rows);
  }
  const built = pack({ productRows: rows.slice(0, cards.length), exemplarRows: rows.slice(cards.length), exemplars: ex, src: finderData.src, dims: opts.dims == null ? PCA_DIMS : opts.dims, pcaIters: opts.pcaIters, key, modelId: opts.modelId, dtype: opts.dtype });
  built.rows = rows; built.cards = cards; built.key = key;
  return built;
}

const EMB_FILES = ['finder-emb.bin', 'finder-emb.json'];
function removeEmbeddings(ROOT, only) {
  let removed = 0;
  for (const f of (only || EMB_FILES)) { const fp = path.join(ROOT, 'data', f); if (fs.existsSync(fp)) { fs.unlinkSync(fp); removed++; } }
  return removed;
}
// Writes the json (and the bin in vectors mode, removing a stale bin otherwise);
// throws, writing nothing, when the combined gzip size is over budget.
function writeEmbeddings(ROOT, built) {
  const s = sizes(built);
  if (s.gzTotal > MAX_GZIP) throw new Error(`finder-emb over budget: ${(s.gzTotal / 1024).toFixed(1)} KB gzip (bin ${(s.binGz / 1024).toFixed(1)} + json ${(s.jsonGz / 1024).toFixed(1)}) > ${MAX_GZIP / 1024} KB`);
  const dir = path.join(ROOT, 'data'); fs.mkdirSync(dir, { recursive: true });
  if (built.bin) fs.writeFileSync(path.join(dir, 'finder-emb.bin'), built.bin); else removeEmbeddings(ROOT, ['finder-emb.bin']);
  fs.writeFileSync(path.join(dir, 'finder-emb.json'), JSON.stringify(built.json));
  return s;
}

// The build hook: never throws. Returns the sizes or null.
async function embedStep(ROOT, productDetails, opts) {
  opts = opts || {};
  const log = opts.log || (m => console.log(`   ${m}`));
  if (process.env.FINDER_EMBED === '0') { log('finder-emb skipped (FINDER_EMBED=0)'); removeEmbeddings(ROOT); return null; }
  try {
    const vectors = opts.vectors == null ? (process.env.FINDER_EMB_VECTORS === '1' || SHIP_VECTORS) : !!opts.vectors;
    // MODEL_CACHE_DIR is created by the library only in vectors mode: an empty dir must never
    // be saved under the CI cache key, or it would shadow a real model download for good.
    const finderData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'finder.json'), 'utf8'));
    const built = await buildEmbeddings(finderData, productDetails, Object.assign({ root: ROOT, log }, opts, { vectors }));
    const s = writeEmbeddings(ROOT, built);
    const j = built.json;
    log(`finder-emb — ${j.exemplars.length} exemplars` + (j.rows ? ` + ${j.products} product cards × ${j.dim} dims as int8` + (j.pca ? ` (PCA from ${DIM}, ${(j.pca.variance * 100).toFixed(0)}% variance)` : '') + `: bin ${(s.binRaw / 1024).toFixed(1)} KB raw / ${(s.binGz / 1024).toFixed(1)} KB gzip,` : ' (json-only; the browser embeds them with ' + j.model + '):') + ` json ${(s.jsonRaw / 1024).toFixed(1)} KB raw / ${(s.jsonGz / 1024).toFixed(1)} KB gzip → ${(s.gzTotal / 1024).toFixed(1)} KB gzip total (budget ${MAX_GZIP / 1024} KB)`);
    return s;
  } catch (e) {
    const why = /Cannot find (package|module) '@huggingface\/transformers'|ERR_MODULE_NOT_FOUND/.test(String(e && (e.code + ' ' + e.message))) ? 'package @huggingface/transformers not installed' : String(e && e.message || e).split('\n')[0];
    log(`finder-emb skipped — ${why}`);
    const n = removeEmbeddings(ROOT); if (n) log(`removed stale data/finder-emb.* (${n} files)`);
    return null;
  }
}

// ── CLI: `npm run embed` (reads data/finder.json, descriptions via the public REST API) ──
async function fetchDescriptions() {
  require('dotenv').config({ quiet: true });
  const { createClient } = require('@supabase/supabase-js');
  const { SUPABASE_URL } = require('./catalog');
  // Same publishable anon key as scripts/build-from-supabase.js (the catalogue is public-read).
  const PUBLIC_ANON = 'sb_publishable_olO3EcqKY0ssnfh2qzKB7g_2-zxc2Or';
  const sb = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || PUBLIC_ANON);
  const { data, error } = await sb.from('fragrance_details').select('fragrance_id, description');
  if (error) throw new Error('fragrance_details: ' + error.message);
  const out = {}; for (const d of data) out[d.fragrance_id] = { description: d.description || '' };
  return out;
}
if (require.main === module) {
  const ROOT = path.join(__dirname, '..', '..');
  (async () => {
    if (!fs.existsSync(path.join(ROOT, 'data', 'finder.json'))) { console.error('data/finder.json missing — run `npm run build` first'); process.exit(1); }
    const vectors = process.argv.includes('--vectors') || process.env.FINDER_EMB_VECTORS === '1' || SHIP_VECTORS;
    let details = {};
    if (vectors) {
      try { details = await fetchDescriptions(); console.log(`   descriptions for ${Object.keys(details).length} products`); }
      catch (e) { console.warn(`   descriptions unavailable (${e.message}) — cards without descriptions`); }
    }
    const s = await embedStep(ROOT, details, { vectors, log: m => console.log(`   ${m}`) });
    process.exit(s ? 0 : 1);
  })();
}

module.exports = { MODEL_ID, DTYPE, DIM, SHIP_VECTORS, PCA_DIMS, MAX_GZIP, FORMAT, MODEL_CACHE_DIR, CARD_DESC_CHARS, semanticCard, stripMd, l2, quantRow, pca, project, pack, packTexts, sizes, loadEmbedder, buildEmbeddings, writeEmbeddings, removeEmbeddings, embedStep, cacheKey, fetchDescriptions };
