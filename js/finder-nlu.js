// ============================================================
//  finder-nlu.js — "Find a Scent" Layer B: an opt-in, on-device embedding
//  model that turns free text into the SAME structured-query fragment the
//  lexicon produces, by nearest neighbour over ~240 intent exemplars
//  (scripts/lib/finder-exemplars.js → data/finder-emb.json, written by
//  scripts/lib/embed.js).
//
//  Nothing loads until load() is called (js/finder.js injects this file
//  only after the visitor taps the offer chip). load() then:
//    1. fetches the small index (data-emb JSON: exemplar texts + fragments;
//       data-embbin int8 rows only when the build shipped vectors),
//    2. imports @huggingface/transformers from LIB_URL (one constant),
//    3. downloads the model (MODEL_ID / DTYPE, ~MODEL_MB MB once; the
//       library keeps it in the browser's Cache Storage) from MODEL_HOST
//       (one constant — self-hosting is a one-line switch), WebGPU first,
//       WASM fallback,
//    4. when the index carries no vectors (the default: 384-d int8 rows for
//       products + exemplars are ~130 KB gzip, far over the 40 KB budget,
//       and PCA small enough to fit loses the retrieval gain — see
//       scripts/eval-finder-nlu.js), embeds the exemplar texts on the device
//       with the same model (a few seconds once; the int8 rows are kept in
//       Cache Storage keyed by the index fingerprint, so later visits skip it).
//  understand(text) embeds the sentence, projects it with the index's PCA
//  (when present), takes the top-3 exemplars above THRESHOLD by cosine and
//  merges their fragments weighted by similarity. It never sees prices,
//  negations or names: finder.js merges the fragment under its rule (the
//  deterministic parser always wins) and validates every label.
//
//  Carrier tag (recommend.html, stamped with ?v= by the build):
//    <script type="text/plain" id="finder-nlu-loader" src="js/finder-nlu.js"
//            data-emb="data/finder-emb.json" data-embbin="data/finder-emb.bin"
//            data-model-mb="24"></script>
//  finder.js copies the data-* attributes onto the real <script> it injects;
//  this file reads data-emb / data-embbin from its own tag first and from
//  #finder-nlu-loader as a fallback. data-embbin is fetched only when the
//  JSON says rows > 0.
//
//  Exposed as window.FinderNLU (and module.exports for the Node eval):
//    ENABLED            false = finder.js ignores the module (eval decision)
//    supports()         { webgpu, wasm }   — feature detection only
//    ready()            true after load() resolved
//    load({ onProgress(fraction, label) })  → Promise<void>
//    understand(text)   → Promise<{ features, strength?, gender?, collection?,
//                         exclude, confidence, exemplars: [{ text, score }] }>
//    device()           'webgpu' | 'wasm' | null
//    MODEL_ID, DTYPE, DIM, MODEL_MB, THRESHOLD, TOP, LIB_URL, MODEL_HOST
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    root.FinderNLU = api;
    api._boot(document.currentScript);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Layer B is on only because scripts/eval-finder-nlu.js showed it improves the
  // English subset over the deterministic parser alone (see the report). Flip to
  // false to keep the file deployed but ignored by finder.js.
  const ENABLED = true;
  // MUST match scripts/lib/embed.js (the index refuses a different model/dtype).
  const MODEL_ID = 'mixedbread-ai/mxbai-embed-xsmall-v1';
  const DTYPE = 'q8';
  const DIM = 384;
  const MODEL_MB = 24;                       // q8 ONNX 23.3 MB + tokenizer 0.7 MB (first load also fetches the ~1 MB library + the ORT WASM runtime)
  const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
  const MODEL_HOST = 'https://huggingface.co/';   // self-host: 'https://nawmeessences.com/models/' + keep remotePathTemplate '{model}/resolve/{revision}/'
  const THRESHOLD = 0.45, TOP = 3;
  const CACHE_NAME = 'nawme-finder-nlu-v1';       // Cache Storage bucket for on-device exemplar rows
  const BATCH = 16;

  const S = { urls: { emb: null, bin: null }, lib: null, pipe: null, device: null, index: null, loading: null, ready: false, embed: null, expect: { model: MODEL_ID, dtype: DTYPE } };

  // ── feature detection (no loading) ──
  function supports() {
    const wasm = typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
    const webgpu = typeof navigator !== 'undefined' && !!navigator.gpu;
    return { webgpu, wasm };
  }
  function ready() { return S.ready; }

  // ── carrier attributes ──
  function _boot(script) {
    const read = el => { if (!el) return false; const d = el.dataset || {}; const emb = d.emb || el.getAttribute('data-emb'), bin = d.embbin || el.getAttribute('data-embbin'); if (emb) { S.urls.emb = emb; S.urls.bin = bin || null; return true; } return false; };
    if (!read(script)) { try { read(document.getElementById('finder-nlu-loader')); } catch (e) {} }
  }

  // ── index: int8 rows (+ optional PCA projection) ──
  // Same quantisation as scripts/lib/embed.js quantRow (the scale is irrelevant to the cosine).
  function quantRow(row) {
    let m = 0; for (let i = 0; i < row.length; i++) m = Math.max(m, Math.abs(row[i]));
    const scale = m ? m / 127 : 1, q = new Int8Array(row.length);
    for (let i = 0; i < row.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(row[i] / scale)));
    return q;
  }
  function setIndex(json, rows) {
    if (!json || json.v !== 1 || !Array.isArray(json.exemplars)) throw new Error('finder-emb: bad index');
    if (json.model !== S.expect.model || json.dtype !== S.expect.dtype) throw new Error('finder-emb: index built with ' + json.model + '/' + json.dtype + ', script expects ' + S.expect.model + '/' + S.expect.dtype);
    const dim = json.dim, nProducts = json.products || 0, nRows = nProducts + json.exemplars.length;
    const ix = { dim, rows: null, norms: null, nProducts, exemplars: json.exemplars, pca: null, key: json.key || '', pending: true };
    if (rows) {
      if (!(rows instanceof Int8Array)) rows = new Int8Array(rows.buffer || rows);
      if (rows.length < nRows * dim) throw new Error('finder-emb: bin too short');
      if (json.pca) {
        const off = json.pca.offset;
        if (rows.length < off + json.pca.dim * dim) throw new Error('finder-emb: projection missing');
        ix.pca = { inDim: json.pca.dim, mean: Float32Array.from(json.pca.mean), W: rows.subarray(off, off + json.pca.dim * dim), scale: json.pca.scale };
      }
      finishIndex(ix, rows);
    } else if (dim !== DIM) throw new Error('finder-emb: an index without vectors must use the model width');
    S.index = ix;
    return ix;
  }
  function finishIndex(ix, rows) {
    const dim = ix.dim, n = ix.nProducts + ix.exemplars.length, norms = new Float32Array(n);
    for (let r = 0; r < n; r++) { let s = 0; const off = r * dim; for (let j = 0; j < dim; j++) s += rows[off + j] * rows[off + j]; norms[r] = Math.sqrt(s) || 1; }
    ix.rows = rows; ix.norms = norms; ix.pending = false;
  }
  // Model vector (DIM floats) → the index's space (PCA-projected when the index has one), L2-normalised.
  function project(vec) {
    const ix = S.index; if (!ix) throw new Error('finder-nlu: no index');
    let out;
    if (ix.pca) {
      const k = ix.dim, p = ix.pca; out = new Float32Array(k);
      for (let i = 0; i < p.inDim; i++) { const xi = vec[i] - p.mean[i]; if (!xi) continue; const off = i * k; for (let j = 0; j < k; j++) out[j] += xi * p.W[off + j]; }
      // p.scale is a common factor of every W entry: it cancels in the normalisation.
    } else out = Float32Array.from(vec);
    let n = 0; for (let j = 0; j < out.length; j++) n += out[j] * out[j]; n = Math.sqrt(n) || 1;
    for (let j = 0; j < out.length; j++) out[j] /= n;
    return out;
  }
  // cos(query, exemplar row) for every exemplar (the per-row scale cancels; only the int8 norm matters).
  function scores(q) {
    const ix = S.index; if (!ix || ix.pending) throw new Error('finder-nlu: index has no vectors yet');
    const dim = ix.dim, out = new Float32Array(ix.exemplars.length);
    for (let e = 0; e < out.length; e++) {
      const r = ix.nProducts + e, off = r * dim; let s = 0;
      for (let j = 0; j < dim; j++) s += ix.rows[off + j] * q[j];
      out[e] = s / ix.norms[r];
    }
    return out;
  }
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  // Top-TOP exemplars above THRESHOLD, fragments merged weighted by similarity (best = 1).
  function match(vec) {
    const sc = scores(project(vec));
    const order = Array.from(sc.keys()).sort((a, b) => sc[b] - sc[a] || a - b).slice(0, TOP).filter(i => sc[i] >= THRESHOLD);
    let bestAny = 0; for (let i = 0; i < sc.length; i++) if (sc[i] > bestAny) bestAny = sc[i];
    const out = { features: {}, exclude: [], confidence: Number((order.length ? sc[order[0]] : bestAny).toFixed(4)), exemplars: [] };
    if (!order.length) return out;
    const best = sc[order[0]];
    order.forEach(i => {
      const ex = S.index.exemplars[i], w = sc[i] / best, frag = ex.frag || {};
      out.exemplars.push({ text: ex.text, score: Number(sc[i].toFixed(4)) });
      Object.keys(frag.features || {}).forEach(k => { out.features[k] = (out.features[k] || 0) + w * frag.features[k]; });
      if (frag.strength && !out.strength) out.strength = frag.strength;
      if (frag.gender && !out.gender) out.gender = frag.gender;
      if (frag.collection && !out.collection) out.collection = frag.collection;
      (frag.exclude || []).forEach(x => { if (out.exclude.indexOf(x) < 0) out.exclude.push(x); });
    });
    Object.keys(out.features).forEach(k => { const v = Number(clamp(out.features[k], -1, 1).toFixed(3)); if (v) out.features[k] = v; else delete out.features[k]; });
    return out;
  }

  // ── on-device exemplar rows (index without vectors) ──
  const cacheUrl = key => '/__finder-nlu/' + encodeURIComponent(S.expect.model) + '/' + S.expect.dtype + '/' + key + '.bin';
  async function cachedRows(key, n) {
    try { if (typeof caches === 'undefined' || !key) return null; const c = await caches.open(CACHE_NAME); const r = await c.match(cacheUrl(key)); if (!r) return null; const buf = new Int8Array(await r.arrayBuffer()); return buf.length === n ? buf : null; } catch (e) { return null; }
  }
  async function storeRows(key, rows) {
    try { if (typeof caches === 'undefined' || !key || typeof Response === 'undefined') return; const c = await caches.open(CACHE_NAME); await c.put(cacheUrl(key), new Response(rows.buffer, { headers: { 'content-type': 'application/octet-stream' } })); } catch (e) { /* best effort */ }
  }
  async function buildRows(ix, onProgress) {
    const n = ix.exemplars.length, rows = new Int8Array(n * ix.dim);
    const texts = ix.exemplars.map(e => e.text);
    for (let i = 0; i < n; i += BATCH) {
      const vecs = await S.embed(texts.slice(i, i + BATCH));
      vecs.forEach((v, j) => rows.set(quantRow(v), (i + j) * ix.dim));
      onProgress(0.9 + 0.1 * Math.min(1, (i + vecs.length) / n), 'exemplars');
    }
    return rows;
  }

  // ── loading ──
  const fetchJson = u => fetch(u, { credentials: 'omit' }).then(r => { if (!r.ok) throw new Error('fetch ' + r.status + ' ' + u); return r.json(); });
  const fetchBin = u => fetch(u, { credentials: 'omit' }).then(r => { if (!r.ok) throw new Error('fetch ' + r.status + ' ' + u); return r.arrayBuffer(); });
  // texts: string[] → Float32Array[] (mean-pooled, L2-normalised), via the loaded pipeline.
  async function embedTexts(texts) {
    const t = await S.pipe(texts.map(x => String(x || '').slice(0, 300)), { pooling: 'mean', normalize: true });
    const d = t.dims[t.dims.length - 1], out = [];
    for (let r = 0; r < texts.length; r++) out.push(Float32Array.from(t.data.slice(r * d, r * d + DIM)));
    if (typeof t.dispose === 'function') t.dispose();
    return out;
  }
  // opts: { onProgress(fraction, label) } in the browser; the Node eval passes
  // { embed: async texts[] → Float32Array[], index: { json, bin|null } } instead.
  function load(opts) {
    opts = opts || {};
    if (S.ready) return Promise.resolve();
    if (S.loading) return S.loading;
    // Progress never goes backwards (a model file joining the byte total mid-download would otherwise dip it).
    let lastFraction = 0;
    const onProgress = (f, label) => { if (typeof opts.onProgress !== 'function') return; f = Math.max(lastFraction, Math.min(1, f)); lastFraction = f; try { opts.onProgress(f, label); } catch (e) {} };
    S.loading = (async () => {
      if (opts.index) setIndex(opts.index.json, opts.index.bin || null);
      else {
        if (!S.urls.emb) throw new Error('finder-nlu: no data-emb');
        const json = await fetchJson(S.urls.emb);
        let bin = null;
        if (json.rows > 0) { if (!S.urls.bin) throw new Error('finder-nlu: index has vectors but no data-embbin'); bin = new Int8Array(await fetchBin(S.urls.bin)); }
        setIndex(json, bin);
      }
      onProgress(0.02, 'index');
      if (opts.embed) { S.embed = opts.embed; S.device = 'external'; }
      else {
        const lib = await import(/* webpackIgnore: true */ LIB_URL);
        S.lib = lib;
        lib.env.allowLocalModels = false;
        lib.env.remoteHost = MODEL_HOST;
        lib.env.useBrowserCache = true;
        onProgress(0.04, 'library');
        const files = {};
        const cb = p => {
          if (!p || !p.file) return;
          if (p.status === 'progress') files[p.file] = [p.loaded || 0, p.total || 0];
          else if (p.status === 'done' && files[p.file]) files[p.file][0] = files[p.file][1];
          let l = 0, t = 0; Object.keys(files).forEach(f => { l += files[f][0]; t += files[f][1]; });
          if (t > 0) onProgress(0.04 + 0.84 * Math.min(1, l / t), p.file);
        };
        const sup = supports();
        const devices = (opts.device ? [opts.device] : []).concat(sup.webgpu ? ['webgpu', 'wasm'] : ['wasm']);
        let last = null;
        for (const device of devices) {
          try { S.pipe = await lib.pipeline('feature-extraction', MODEL_ID, { dtype: DTYPE, device, progress_callback: cb }); S.device = device; break; }
          catch (e) { last = e; S.pipe = null; }
        }
        if (!S.pipe) throw last || new Error('finder-nlu: no backend');
        S.embed = embedTexts;
        await S.embed(['warm up']);   // first run compiles the graph; keeps understand() quick
      }
      onProgress(0.9, 'model');
      const ix = S.index;
      if (ix.pending) {
        let rows = await cachedRows(ix.key, ix.exemplars.length * ix.dim);
        if (!rows) { rows = await buildRows(ix, onProgress); await storeRows(ix.key, rows); }
        finishIndex(ix, rows);
      }
      S.ready = true;
      onProgress(1, 'ready');
    })();
    S.loading.catch(() => { S.loading = null; S.ready = false; });
    return S.loading;
  }
  async function understand(text) {
    if (!S.ready || !S.embed) throw new Error('finder-nlu: not loaded');
    const vec = (await S.embed([String(text || '')]))[0];
    return match(vec);
  }

  return { ENABLED, MODEL_ID, DTYPE, DIM, MODEL_MB, THRESHOLD, TOP, LIB_URL, MODEL_HOST, supports, ready, load, understand, device: () => S.device,
    _boot, _setIndex: setIndex, _project: project, _scores: scores, _match: match, _quantRow: quantRow, _state: S,
    _expect: (model, dtype) => { S.expect = { model: model || MODEL_ID, dtype: dtype || DTYPE }; } };
});
