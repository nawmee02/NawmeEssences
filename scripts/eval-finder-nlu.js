// ============================================================
//  eval-finder-nlu.js — does Layer B (js/finder-nlu.js) help?
//
//  Hand-labelled evaluation set: 25 English + 15 Banglish sentences, each
//  with the product ids a human would accept in the top 3 (labelled from
//  data/finder.json; clear cases only). For every sentence the script runs
//    • the deterministic parser alone (js/finder.js + js/finder-lexicon.js), and
//    • parser + NLU: the sentence embedded in Node with the SAME model the
//      browser downloads, matched against the exemplar index built by
//      scripts/lib/embed.js, merged under finder.js's rule (parser wins on
//      every key it set; NLU only adds), then ranked,
//  and prints top-3 hit rates (a hit = at least one accepted id in the three
//  picks; "≥2" = at least two). Two gates are reported: finder.js's real one
//  (needsNLU: ≥ 4 words and ≥ 2 unknown words or nothing parsed) and
//  "always" (NLU on every sentence) as an upper bound.
//  Decision rule (finder-spec-phase2.md): the English subset must improve
//  under the real gate, otherwise js/finder-nlu.js ships with ENABLED=false.
//
//  Usage: node scripts/eval-finder-nlu.js [--model <id>] [--dims <n>] [--verbose]
//         [--dump-vectors <file>]   (writes the 20 parity sentences' Node vectors
//                                    for the browser agreement check)
//  Needs data/finder.json (npm run build) and the optional package
//  @huggingface/transformers; exits 0 with a note when either is missing.
// ============================================================
'use strict';
const fs = require('fs');
const path = require('path');
const embedLib = require('./lib/embed');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const VERBOSE = args.includes('--verbose');
const MODEL = arg('--model', embedLib.MODEL_ID);
const DTYPE = arg('--dtype', embedLib.DTYPE);
const DIMS = Number(arg('--dims', embedLib.PCA_DIMS));
const DUMP = arg('--dump-vectors', null);

// ── evaluation set (ids from data/finder.json, 2026-10-14 catalogue) ──
// 12 descriptive sentences (note / accord wording the lexicon mostly knows) + 13
// figurative ones (scenes with no lexicon words — where finder.js's gate lets Layer B run).
const ENGLISH = [
  ['smells like the ocean on a scorching day', ['mancera-french-riviera', 'french-avenue-atlantis', 'rayhaan-aquatica', 'davidoff-cool-water', 'missoni-wave']],
  ['like walking into a bakery, cookies and caramel', ['mancera-amore-caffe', 'lattafa-angham', 'lattafa-khamrah-qahwa', 'azzaro-most-wanted-edp-intense']],
  ['smells like a leather jacket and a cigar', ['bvlgari-man-in-black-edp', 'french-avenue-vulcan-black-friday', 'hugo-boss-bottled-absolu', 'rasasi-hawas-lava-gold']],
  ['pineapple with a smoky edge, the famous niche vibe', ['armaf-cdni-edp', 'armaf-cdni-extrait', 'afnan-supremacy-collectors', 'rasasi-hawas-black']],
  ['coconut and sunscreen, beach holiday', ['rasasi-hawas-tropical', 'french-avenue-atlantis', 'rayhaan-aquatica', 'jpg-le-beau', 'jpg-le-beau-paradise-garden']],
  ['powdery iris, elegant like a tailored suit', ['giorgio-armani-code-parfum', 'jpg-le-male-le-parfum', 'french-avenue-magnetiq', 'rasasi-hawas-malibu']],
  ['green and earthy like a garden after rain', ['rasasi-fattan', 'jpg-le-beau-paradise-garden', 'lalique-encre-indigo', 'essential-parfums-bois-imp-rial', 'lalique-encre-noire-sport']],
  ['lavender and vanilla, the classic sailor bottle', ['jpg-le-male', 'jpg-le-male-le-parfum', 'jpg-le-male-elixir', 'valentino-uomo-born-in-roma-intense']],
  ['whiskey and oak, smoky and boozy', ['french-avenue-vulcan-sable', 'bvlgari-man-in-black-edp', 'armani-stronger-absolutely', 'lattafa-teriaq-intense']],
  ['a tea scent, calm and zen', ['rasasi-hawas-kobra', 'lattafa-dynasty', 'lalique-encre-indigo']],
  ['minty and icy fresh, like toothpaste', ['rasasi-hawas-ice-freeze', 'davidoff-indigo', 'bentley-silverlake', 'french-avenue-platine-blanc', 'rayhaan-nocturno-elixir']],
  ['honey and tonka, golden and sweet', ['jpg-le-male-elixir', 'rayhaan-italia', 'lattafa-teriaq-intense', 'jpg-le-beau']],
  ['I want people to ask me what I am wearing', ['afnan-9pm', 'jpg-le-male-elixir', 'armani-stronger-intensely', 'azzaro-most-wanted-edp-intense', 'lattafa-angham']],
  ['the smell of a bakery first thing in the morning', ['lattafa-angham', 'mancera-amore-caffe', 'lattafa-khamrah-qahwa', 'azzaro-most-wanted-edp-intense']],
  ['a walk through a pine forest', ['lalique-encre-noire-sport', 'rasasi-fattan', 'lalique-encre-indigo', 'essential-parfums-bois-imp-rial', 'hugo-boss-bottled-bold-citrus']],
  ['a mosque courtyard during eid prayers', ['al-haramain-amber-oud-dubai-night', 'hugo-boss-bottled-elixir', 'rayhaan-terra', 'mercedes-club-black', 'lalique-encre-noire-a-l-extreme']],
  ['a lemonade stand in july', ['hugo-boss-bottled-bold-citrus', 'rayhaan-azul', 'rasasi-hawas-ice-freeze', 'terre-d-herm-s-eau-givree', 'missoni-parfum-homme']],
  ['a honeymoon in the maldives', ['french-avenue-atlantis', 'rayhaan-aquatica', 'rasasi-hawas-tropical', 'mancera-french-riviera', 'jpg-le-beau-paradise-garden']],
  ['a cigar lounge with leather armchairs', ['bvlgari-man-in-black-edp', 'hugo-boss-bottled-absolu', 'french-avenue-vulcan-black-friday', 'rasasi-hawas-lava-gold']],
  ['sunday morning laundry drying in the sun', ['junaid-perfumes-sanaya', 'junaid-perfumes-sanaya40', 'nautica-voyage', 'bentley-silverlake', 'lalique-encre-noire-sport']],
  ['after a football match in the heat', ['nautica-voyage', 'rasasi-hawas', 'rasasi-hawas-ice', 'al-haramain-amber-oud-aqua-dubai', 'lalique-encre-noire-sport']],
  ['a snowy cabin in the mountains', ['hugo-boss-bottled-absolu', 'lalique-encre-noire-a-l-extreme', 'hugo-boss-bottled-elixir', 'mercedes-club-black', 'prada-luna-rossa-ocean-edp']],
  ['a bowl of sweet payesh at a wedding', ['lattafa-khamrah-qahwa', 'lattafa-angham', 'mancera-amore-caffe', 'azzaro-most-wanted-edp-intense']],
  ['a sea beach at sunset in cox bazar', ['french-avenue-atlantis', 'rayhaan-aquatica', 'mancera-french-riviera', 'rasasi-hawas-tropical', 'kenzo-homme-edp']],
  ['a boss walking into a boardroom', ['ysl-y-edp', 'giorgio-armani-code-parfum', 'hugo-boss-bottled-absolu', 'terre-d-herm-s-eau-givree', 'lalique-encre-indigo']],
];
const BANGLISH = [
  ['garam er din e deyar moto fresh kichu', ['rasasi-hawas-ice', 'rasasi-hawas-ice-freeze', 'rayhaan-azul', 'junaid-perfumes-sanaya', 'mancera-french-riviera']],
  ['biye te deyar jonno oud wala kichu', ['al-haramain-amber-oud-dubai-night', 'afnan-turathi-brown', 'rasasi-hawas-lava-gold', 'essential-parfums-bois-imp-rial']],
  ['mishti vanilla type, shiter rate', ['jpg-le-male-elixir', 'armani-stronger-intensely', 'rayhaan-italia', 'azzaro-most-wanted-edp-intense', 'valentino-uomo-born-in-roma-intense']],
  ['office e deyar moto halka kichu', ['junaid-perfumes-sanaya', 'rayhaan-azul', 'bentley-silverlake', 'issey-miyake-l-eau-d-issey-pour-homme-edt', 'rasasi-fattan']],
  ['bristi te deyar moto earthy green', ['rasasi-fattan', 'lalique-encre-indigo', 'jpg-le-beau-paradise-garden', 'lalique-encre-noire-sport', 'essential-parfums-bois-imp-rial']],
  ['coffee er moto gondho', ['mancera-amore-caffe', 'lattafa-khamrah-qahwa', 'lattafa-angham']],
  ['samudrer moto blue kichu', ['mancera-french-riviera', 'french-avenue-atlantis', 'rayhaan-aquatica', 'davidoff-cool-water', 'missoni-wave']],
  ['gym er pore deyar jonno', ['nautica-voyage', 'rasasi-hawas', 'rasasi-hawas-ice', 'al-haramain-amber-oud-aqua-dubai', 'lalique-encre-noire-sport']],
  ['date e jawar jonno sexy mishti kichu', ['afnan-9pm', 'jpg-le-male-elixir', 'armani-stronger-intensely', 'azzaro-most-wanted-edp-intense', 'mancera-amore-caffe']],
  ['pineapple ar smoky, aventus er moto', ['armaf-cdni-edp', 'armaf-cdni-extrait', 'afnan-supremacy-collectors', 'rasasi-hawas-black']],
  ['leather ar tobacco wala dark kichu', ['bvlgari-man-in-black-edp', 'french-avenue-vulcan-black-friday', 'hugo-boss-bottled-absolu', 'rasasi-hawas-lava-gold']],
  ['chocolate type gourmand', ['rasasi-hawas-elixir', 'lattafa-angham', 'mancera-amore-caffe']],
  ['eid er din e deyar jonno amber kichu', ['al-haramain-amber-oud-dubai-night', 'rayhaan-terra', 'lattafa-teriaq-intense', 'lattafa-khamrah-qahwa', 'rasasi-hawas-elixir']],
  ['mint er moto thanda fresh', ['rasasi-hawas-ice-freeze', 'davidoff-indigo', 'bentley-silverlake', 'french-avenue-platine-blanc', 'rayhaan-nocturno-elixir']],
  ['rose ar oud, romantic dark', ['al-haramain-amber-oud-dubai-night', 'afnan-turathi-brown', 'mancera-instant-crush', 'french-avenue-vulcan-black-friday']],
];
// Node-vs-browser parity sentences (--dump-vectors; compared by the scratchpad puppeteer check).
const PARITY = [
  'fresh and clean for the office', 'something sweet for winter nights', 'smells like the sea', 'a leather jacket and a cigar',
  'old fashioned, like my uncle', 'loud and strong for a party', 'quiet, close to the skin', 'rose and oud for a wedding',
  'coffee and caramel dessert', 'green grass after rain', 'minty icy toothpaste', 'a gift for my father',
  'pineapple and smoke', 'warm vanilla hug', 'citrus and ginger, bright', 'powdery iris, elegant',
  'tea and zen calm', 'tropical mango beach', 'spicy cardamom chai', 'nothing heavy, light and easy',
];

// ── helpers ──
const needsNluFallback = (F, text, parsed) => {
  const words = F.normalize(text).split(' ').filter(Boolean).length;
  return words >= 4 && ((parsed.unknown || []).length >= 2 || !(parsed.parts || []).length);
};
// The merge rule of finder.js (mergeNLU): parser-set keys keep their value, NLU only adds.
function mergeFragment(F, q, frag, model) {
  const v = typeof F.validateFragment === 'function' ? F.validateFragment(frag, model) : frag;
  if (!v) return { q, added: [] };
  const out = Object.assign({}, q, { features: Object.assign({}, q.features), exclude: (q.exclude || []).slice() });
  const added = [];
  Object.keys(v.features || {}).forEach(k => { if (out.features[k] == null) { out.features[k] = v.features[k]; added.push(k); } });
  if (v.strength && !out.strength) { out.strength = v.strength; added.push(v.strength); }
  if (v.gender && !out.gender) { out.gender = v.gender; added.push(v.gender); }
  if (v.collection && !out.collection && typeof F.validateFragment !== 'function') { out.collection = v.collection; added.push(v.collection); }
  (v.exclude || []).forEach(e => { if (out.exclude.indexOf(e) < 0) { out.exclude.push(e); added.push(e); } });
  return { q: out, added };
}
const pct = (n, d) => (d ? Math.round((100 * n) / d) : 0) + '%';
const pad = (s, n) => String(s).padEnd(n);

async function main() {
  const dataPath = path.join(ROOT, 'data', 'finder.json');
  if (!fs.existsSync(dataPath)) { console.log('eval-finder-nlu: data/finder.json missing — run `npm run build` first'); return; }
  let F; try { F = require(process.env.FINDER_JS || path.join(ROOT, 'js', 'finder.js')); } catch (e) { console.log('eval-finder-nlu: js/finder.js cannot be loaded (' + e.message.split('\n')[0] + ')'); return; }
  const L = require(path.join(ROOT, 'js', 'finder-lexicon.js'));
  const NLU = require(path.join(ROOT, 'js', 'finder-nlu.js'));
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const model = F.prepareData(data);
  if (typeof F.setRefs === 'function') F.setRefs(L.refs);
  const known = new Set(data.items.map(i => i.id));
  [...ENGLISH, ...BANGLISH].forEach(([t, ids]) => ids.forEach(id => { if (!known.has(id)) throw new Error(`eval id not in catalogue: ${id} (${t})`); }));

  let embed;
  try { embed = await embedLib.loadEmbedder({ modelId: MODEL, dtype: DTYPE }); }
  catch (e) { console.log('eval-finder-nlu: model unavailable (' + String(e.message).split('\n')[0] + ') — nothing evaluated'); return; }
  // Product cards need the descriptions so the PCA (fitted on cards + exemplars) matches the build's.
  let details = {};
  try { details = await embedLib.fetchDescriptions(); } catch (e) { console.log('   descriptions unavailable (' + e.message + ') — cards without descriptions'); }
  // dims = 0 → the shipped json-only index: the exemplar rows are built through the
  // same on-device path the browser uses (load() embeds them); dims > 0 → the
  // vectors + PCA pipeline, to measure what a shipped .bin would do.
  const built = await embedLib.buildEmbeddings(data, details, { root: ROOT, vectors: DIMS > 0, dims: DIMS, modelId: MODEL, dtype: DTYPE, embed, log: m => console.log('   ' + m) });
  const sz = embedLib.sizes(built);
  console.log(`   index: ${MODEL} ${DTYPE}, ${built.json.dim} dims${built.json.pca ? ` (PCA from ${embedLib.DIM}, ${(built.json.pca.variance * 100).toFixed(0)}% variance kept)` : ''}; bin ${(sz.binRaw / 1024).toFixed(1)} KB raw / ${(sz.binGz / 1024).toFixed(1)} KB gz, json ${(sz.jsonRaw / 1024).toFixed(1)} KB raw / ${(sz.jsonGz / 1024).toFixed(1)} KB gz → ${(sz.gzTotal / 1024).toFixed(1)} KB gz (budget ${embedLib.MAX_GZIP / 1024} KB)`);
  // Load the module exactly like the browser would, with the Node embedder and the freshly packed index.
  NLU._state.ready = false; NLU._state.loading = null;
  NLU._expect(MODEL, DTYPE);   // eval-only: lets a candidate model be scored with the same module
  const asInt8 = b => (b ? new Int8Array(b.buffer, b.byteOffset, b.length) : null);
  const t0 = Date.now();
  await NLU.load({ embed, index: { json: built.json, bin: asInt8(built.bin) } });
  if (!built.bin) console.log(`   exemplar rows embedded on load (as the browser does): ${built.json.exemplars.length} texts in ${((Date.now() - t0) / 1000).toFixed(1)} s (Node CPU)`);

  // How much does the PCA reduction change exemplar retrieval? (top-1 / top-3 agreement vs the full 384-d index)
  if (built.json.pca) {
    const full = embedLib.pack({ productRows: built.rows.slice(0, built.cards.length), exemplarRows: built.rows.slice(built.cards.length), exemplars: built.json.exemplars, src: built.json.src, dims: 0, modelId: MODEL, dtype: DTYPE });
    const sentences = [...ENGLISH, ...BANGLISH].map(x => x[0]).concat(PARITY);
    const vecs = await embed(sentences);
    const topk = (json, bin, v) => { NLU._setIndex(json, asInt8(bin)); const sc = NLU._scores(NLU._project(v)); return Array.from(sc.keys()).sort((a, b) => sc[b] - sc[a]).slice(0, 3); };
    let t1 = 0, j3 = 0;
    vecs.forEach(v => { const a = topk(full.json, full.bin, v), b = topk(built.json, built.bin, v); if (a[0] === b[0]) t1++; const inter = a.filter(x => b.includes(x)).length; j3 += inter / (6 - inter); });
    NLU._setIndex(built.json, asInt8(built.bin));
    console.log(`   PCA ${built.json.dim}-d vs full 384-d on ${sentences.length} sentences: top-1 exemplar agreement ${pct(t1, sentences.length)}, mean top-3 Jaccard ${(j3 / sentences.length).toFixed(2)}`);
  }

  const needsNLU = typeof F.needsNLU === 'function' ? F.needsNLU : (t, p) => needsNluFallback(F, t, p);
  const top3 = q => F.answer(model, q, { limit: 3 }).picks.map(p => p.id);
  async function run(set) {
    const rows = [];
    for (const [text, accepted] of set) {
      const parsed = F.parse(text, L, model, {});
      const base = top3(parsed);
      const frag = await NLU.understand(text);
      const merged = mergeFragment(F, parsed, frag, model);
      const withNlu = merged.added.length ? top3(merged.q) : base;
      const gated = needsNLU(text, parsed) ? withNlu : base;
      const hits = ids => ids.filter(id => accepted.includes(id)).length;
      rows.push({ text, base, withNlu, gated, gate: needsNLU(text, parsed), unknown: parsed.unknown || [], conf: frag.confidence, ex: frag.exemplars.map(e => e.text), added: merged.added, h: [hits(base), hits(gated), hits(withNlu)] });
    }
    return rows;
  }
  const summarise = (name, rows) => {
    const n = rows.length;
    const c = i => rows.filter(r => r.h[i] >= 1).length, c2 = i => rows.filter(r => r.h[i] >= 2).length;
    console.log(`\n${name} (${n} sentences) — top-3 hit (≥1 accepted) / strong hit (≥2 accepted)`);
    console.log(`   parser alone:          ${pct(c(0), n)} / ${pct(c2(0), n)}`);
    console.log(`   parser + NLU (gated):  ${pct(c(1), n)} / ${pct(c2(1), n)}   (NLU ran on ${rows.filter(r => r.gate).length}/${n})`);
    console.log(`   parser + NLU (always): ${pct(c(2), n)} / ${pct(c2(2), n)}`);
    console.log(`   mean confidence (best exemplar cosine): ${(rows.reduce((s, r) => s + r.conf, 0) / n).toFixed(3)}; below threshold ${NLU.THRESHOLD}: ${rows.filter(r => r.conf < NLU.THRESHOLD).length}`);
    if (VERBOSE) rows.forEach(r => console.log(`   ${r.h[0]}→${r.h[1]}${r.gate ? '' : ' (no gate)'} ${pad(r.text, 52)} base=[${r.base.join(',')}] nlu=[${r.withNlu.join(',')}] conf=${r.conf} ex=${JSON.stringify(r.ex[0] || null)} unknown=${JSON.stringify(r.unknown)} added=${r.added.length}`));
    return { n, base: c(0), gated: c(1), always: c(2), base2: c2(0), gated2: c2(1), always2: c2(2) };
  }
  const en = summarise('ENGLISH', await run(ENGLISH));
  const bn = summarise('BANGLISH', await run(BANGLISH));
  const verdict = en.gated > en.base ? 'IMPROVES' : (en.gated === en.base ? 'NO CHANGE' : 'WORSE');
  console.log(`\nEnglish subset under finder.js's gate: ${en.base}/${en.n} → ${en.gated}/${en.n} — Layer B ${verdict}` + (verdict === 'IMPROVES' ? ' (ENABLED may stay true)' : ' (set ENABLED=false in js/finder-nlu.js)'));
  console.log(`Banglish subset under the gate: ${bn.base}/${bn.n} → ${bn.gated}/${bn.n}`);

  if (DUMP) {
    const vecs = await embed(PARITY);
    const ix = NLU._state.index;
    fs.writeFileSync(DUMP, JSON.stringify({ model: MODEL, dtype: DTYPE, sentences: PARITY, vectors: vecs.map(v => Array.from(v)), index: { json: built.json, bin: built.bin ? Buffer.from(built.bin).toString('base64') : null },
      // the exemplar rows as Node built them (int8, same quantisation as the browser), for row-level parity
      rows: Buffer.from(ix.rows.buffer, ix.rows.byteOffset, ix.rows.length).toString('base64'), dim: ix.dim, nProducts: ix.nProducts }));
    console.log(`\nwrote ${PARITY.length} Node vectors + the index to ${DUMP}`);
  }
  await embed.dispose();
  return { en, bn };
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { ENGLISH, BANGLISH, PARITY, mergeFragment, main };
