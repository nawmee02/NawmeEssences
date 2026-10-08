// ============================================================
//  finder.js — "Find a Scent" (recommend.html): a chat-style perfume
//  finder on top of the tier-1 feature space.
//
//  No model, no server: the build writes data/finder.json (recs items +
//  description keywords + optional inspired_by references) and this file
//  turns what the visitor types or taps into ONE structured query
//  (anchor, signed features, price band, gender, strength, collection,
//  exclusions, unknown words) and ranks the catalogue against it with the
//  same keys and weights as js/recs.js (f2 a2 n1 o1 g1.5 k0.5 b1, plus the
//  finder-only w0.5 for description keywords). The tier-1 profile from
//  localStorage "nawme_signals" is read (never written) and only tilts
//  the ranking; the thread never mentions it.
//
//  Contract: nothing is fetched until the visitor's first chip or text;
//  every product appears at most once per thread (thread.renderedIds);
//  no longevity claims — every sentence lives in T below and is checked
//  by scripts/test-finder.js. The pure parts (normalize, parse, mergeQuery,
//  fromChip, vectorize, queryVector, buildProfile, rank, answer, reasons)
//  are exported for Node.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    root.NawmeFinder = api;
    api._init(document.currentScript);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── every visible sentence (one object so the claims test can scan it) ──
  const T = {
    opening: "Tell me what you're after, or pick a few quick answers.",
    askOccasion: 'When will you mostly wear it?',
    askVibe: 'What kind of scent do you lean towards?',
    askBudget: 'Budget for the smallest decant?',
    askWho: 'Who is it for?',
    askName: 'Which fragrance do you like? Type its name, e.g. Creed Aventus or Dior Sauvage.',
    answer: 'Here are three picks that fit.',
    more: 'Three more that fit.',
    noMore: "That's everything that fits what you've told me. Remove a constraint above, or start over.",
    anchorCatalog: 'Closest to {name} in our catalogue:',
    anchorStocked: 'We stock {name} itself — these are the closest alternatives:',
    anchorRef: 'Closest matches to {name} by scent profile:',
    unknownAnchor: "I couldn't find that one, so here are matches based on what you've told me so far.",
    unknownAnchorOnly: "I couldn't find that one. Try another name, or tell me what you like — fresh, sweet, office, a budget.",
    notUnderstood: "I didn't understand: {words}. Try words like fresh, sweet, office, or a fragrance name.",
    notUnderstoodAnswer: "I didn't understand: {words} — so these follow what you told me before.",
    nothingNew: 'Nothing new to go on there. Tell me a vibe, an occasion, a budget, or a fragrance name — or tap a quick reply.',
    status: '{n} quick replies below.',
    unisexNote: "We currently stock men's and unisex decants, so these focus on unisex options that suit gifting.",
    strongerNote: 'Leans stronger: higher concentration and a heavier profile.',
    softerNote: 'Leans softer: lighter concentration and a fresher profile.',
    exclusiveNote: 'Showing rare and exclusive bottles, as asked.',
    relaxed: 'Nothing matched everything, so I relaxed {what}.',
    relaxCheaper: 'the cheaper-than limit', relaxPrice: 'the price limit', relaxGender: 'the gender filter',
    relaxCollection: 'the collection filter', relaxThreshold: 'the scent match',
    cheaper: 'Cheaper than ৳{price}:',
    noCheaper: "I couldn't find a cheaper match, so here are the closest alternatives.",
    compare: 'Side by side:',
    compareNeed: 'Pick a few answers first, then I can compare the top two.',
    honesty: 'Scent sits differently on everyone — start with a 3 ml decant before a bigger size.',
    unavailable: 'The finder is unavailable right now.',
    browseAll: 'Browse all fragrances →',
    whatsapp: 'Ask Nawmee on WhatsApp',
    waIntro: 'Hi! I used Find a Scent on NawmeEssences. My shortlist:',
    waLooking: 'Looking for: ',
    skip: 'Skip', nameChip: 'Alternative to a fragrance I like',
    follow: { more: 'Show 3 more', cheaper: 'Cheaper', stronger: 'Stronger', fresher: 'Fresher', sweeter: 'Sweeter', brands: 'Different brands', like: 'More like #{n}', compare: 'Compare #1 and #2', reset: 'Start over' },
    compareRows: { brand: 'Brand', family: 'Family', accords: 'Accords', notes: 'Notes', occasions: 'Occasions', concentration: 'Concentration', price: 'From price' },
    tokenPrefix: { like: 'Like ', not: 'not ', under: 'under ৳', over: 'over ৳', men: 'For men', unisex: 'Unisex', gift: 'Unisex (gift)', stronger: 'Leans stronger', softer: 'Leans softer', exclusive: 'Exclusive', cheaper: 'cheaper than ৳', surprise: 'Surprise: ' },
  };

  // ── tuning (vector weights MUST stay identical to js/recs.js) ──
  const WEIGHTS = { f: 2, a: 2, n: 1, o: 1, g: 1.5, k: 0.5, b: 1, w: 0.5 };
  const EVENT_W = { v: 1, c: 3, s: 0.5 };
  const HALF_LIFE_DAYS = 14, EXPIRY_DAYS = 90, DAY = 864e5;
  const SIGNALS_KEY = 'nawme_signals', STATE_KEY = 'nawme_finder';
  const QUERY_SHARE = 0.85, PROFILE_SHARE = 0.15, BS_BONUS = 0.05, STRENGTH_BONUS = 0.08, PRICE_PEN = 0.10;
  const MIN_COS = 0.05, BRAND_CAP = 2, ANSWER_SIZE = 3, CHEAP_DEFAULT = 300, ANCHOR_FEATURE_SHARE = 0.6;
  const WA_FALLBACK = '8801988536843', CDN = 'https://cdn.nawmeessences.com';
  const STRONG_K = ['extrait', 'parfum', 'edp intense'], STRONG_A = ['amber', 'woody', 'vanilla', 'oud'];
  const SOFT_K = ['edt', 'edc'], SOFT_A = ['fresh', 'citrus', 'aquatic', 'green'];

  // ── built-in word lists (unioned with the lexicon's; the lexicon may be richer) ──
  const NEG = ['not', 'no', "don't", 'dont', 'without', 'hate', 'avoid', 'never', 'nothing', 'na', 'noy', 'chai na', 'nai', 'except'];
  const SUFFIX_NEG = /(^|\s)(na|noy|nai|noi|nah|nei|chaina|nope)$/;
  const BOUND_WORDS = ['but', 'kintu', 'tobe', 'however'];   // a contrast word ends a negation / intensifier window like a comma does
  const INT = { very: 1.3, too: 1.3, really: 1.3, super: 1.3, extremely: 1.4, 'a bit': 0.5, slightly: 0.5, little: 0.5, 'a little': 0.5, somewhat: 0.6, beshi: 1.3, onek: 1.3, ektu: 0.5, 'ek tu': 0.5 };
  const GENDER = { women: ['for her', 'her', 'wife', 'girlfriend', 'gf', 'mom', 'mother', 'sister', 'women', 'woman', 'ladies', 'female', 'meye', 'bou'], men: ['for him', 'him', 'husband', 'boyfriend', 'bf', 'dad', 'brother', 'men', 'man', 'male', 'chele'] };
  const STRENGTH = { stronger: ['strong', 'stronger', 'powerful', 'heavy', 'intense', 'shokto', 'kora'], softer: ['soft', 'softer', 'subtle', 'light', 'not loud', 'quiet', 'close to skin', 'halka', 'office safe'] };
  const EXCL = ['rare', 'vintage', 'discontinued', 'exclusive', 'collector'];
  const PMAX = ['under', 'below', 'upto', 'up to', 'max', 'maximum', 'within', 'less than', 'cheaper than', 'at most', 'not more than', 'no more than', 'around', 'about', 'budget of', 'max budget', 'under budget'];
  const PMAX_POST = ['er moddhe', 'moddhe', 'er modhe', 'modhe', 'er niche', 'niche', 'r moddhe', 'er bhitor', 'bhitor', 'er bhitore'];
  const PMIN = ['over', 'above', 'more than', 'at least', 'minimum', 'from', 'starting', 'starting from'];
  const PMIN_POST = ['er upore', 'upore', 'er beshi', 'r upore'];
  const CHEAP = ['cheap', 'budget', 'sasta', 'shosta', 'dam kom', 'kom dam', 'kom dame', 'kom damer', 'affordable', 'inexpensive', 'low price', 'low budget'];
  const CUR = ['taka', 'tk', 'bdt', '৳', 'tak'];
  const TRIGGERS = ['like', 'similar to', 'smells like', 'smell like', 'smelling like', 'alternative to', 'alternatives to', 'alternative of', 'alternative for', 'dupe of', 'dupe for', 'dupes of', 'clone of', 'clones of', 'same as', 'instead of', 'close to', 'reminds me of', 'version of', 'inspired by', 'copy of', 'moto'];
  const POST_TRIGGERS = ['type', 'er moto', 'r moto', 'er mto', 'er moton'];
  const DIFF_BRANDS = ['different brand', 'different brands', 'other brand', 'other brands', 'another brand', 'new brands', 'onno brand', 'onno brands'];
  const UNISEX = ['unisex', 'anyone', 'for anyone', 'both'];
  const CONJ = ['to', 'and', 'theke'];
  const HARD_STOP = new Set(['but', 'and', 'under', 'over', 'below', 'above', 'within', 'upto', 'max', 'min', 'cheaper', 'cheap', 'budget', 'not', 'no', 'na', 'chai', 'jonno', 'jonne', 'kichu', 'with', 'without', 'that', 'which', 'something', 'anything', 'please', ',', '৳', 'or', 'kintu']);
  const GENERIC = new Set(['eau', 'de', 'la', 'le', 'les', 'du', 'des', 'pour', 'homme', 'femme', 'man', 'men', 'woman', 'women', 'for', 'the', 'and', 'of', 'edp', 'edt', 'edc', 'parfum', 'extrait', 'intense', 'elixir', 'cologne', 'toilette', 'concentree', 'absolu', 'by', 'a', 'an', 'no', 'new']);
  const STOP = new Set(('a an the and or but for with without to of in on at by from as is are am be was were it its this that these those i me my we our you your he she they them his her their what which who whom when where why how do does did dont want wants wanted need needs like likes love loves looking look find show give get suggest recommend recommendation please pls plz thanks thank something anything some any thing things kind type sort one ones more less most very too really quite just also only all each every both few many much lot lots good nice best better great perfect ideal maybe would could should can will shall may might must have has had having if then than so such own same other another different new old use used using wear wearing wears smell smells smelling scent scents perfume perfumes fragrance fragrances decant decants bottle bottles ml size sizes taka tk bdt price prices budget under over below above between within around about upto up max min guys bro bhai apu ami amar amake ache achhe hoy hobe hole korar kore korte korbo kori koro ekta akta lagbe dorkar dekhan dekhao dekhte dao din deben ta ti gula gulo er e te r ki kono keu kew jeta jei je jonno jonne jonnoe chai chaii kichu kisu valo bhalo parbo parben amra tumi apni apnar tomar help wanna gonna kinda idea ideas option options suggestion suggestions tell know think feel').split(' '));

  // ── small helpers ───────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : ''));
  const union = (a, b) => { const out = []; [].concat(a || [], b || []).forEach(x => { if (x && out.indexOf(x) < 0) out.push(x); }); return out; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const isNum = t => /^\d+$/.test(t);
  const isWord = t => /^[a-zÀ-ɏঀ-৿]+$/.test(t);
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const joinAnd = arr => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' & ' + arr[arr.length - 1]);
  const effectivePrice = (price, sp) => (sp > 0 ? Math.round(price * (100 - sp) / 100) : price);

  // Lower-case, keep digits and ৳, turn sentence punctuation into a "," boundary
  // token (negation / intensifier / anchor windows never cross it), split glued
  // units ("500tk", "5ml", "1k"), collapse spaces. Lexicon phrases go through the
  // same function, so both sides always agree.
  function normalize(text) {
    return String(text == null ? '' : text).toLowerCase()
      .replace(/[‘’']/g, '')
      .replace(/(\d)[,.](?=\d{3}\b)/g, '$1')
      .replace(/\b(\d+)[.,](\d{1,2})\s*k\b/g, (m, a, b) => String(Math.round(parseFloat(a + '.' + b) * 1000)))
      .replace(/[,;.!?]+/g, ' , ')
      .replace(/</g, ' under ').replace(/>/g, ' over ')
      .replace(/৳/g, ' ৳ ')
      .replace(/(\d)(k|ml|tk|taka|bdt)\b/g, '$1 $2')
      .replace(/[^a-z0-9৳,À-ɏঀ-৿\s]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  const tokensOf = text => normalize(text).split(' ').filter(Boolean);

  function lev(a, b, max) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let prev = [], cur = [];
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      cur = [i]; let rowMin = i;
      for (let j = 1; j <= lb; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[lb];
  }
  // Typo distance for names: one edit allowed per 4 letters (max 2), so "savage" →
  // "sauvage" (1) passes while "savage" → "sahare" (2 of 6) does not; bare names
  // (no "like …") allow a single edit from 6 letters. Returns -1 when too far.
  function dist(a, b, strict) {
    if (a === b) return 0;
    const n = Math.min(a.length, b.length);
    if (n < 4) return -1;
    const tol = strict ? (n >= 6 ? 1 : 0) : Math.min(2, Math.floor(n / 4));
    if (!tol) return -1;
    const d = lev(a, b, tol);
    return d <= tol ? d : -1;
  }
  const fuzzyEq = (a, b, strict) => dist(a, b, strict) >= 0;

  // ── structured query (the stable contract) ─────────────────
  function emptyQuery() {
    return { anchor: null, features: {}, maxPrice: null, minPrice: null, cheaper: false, refPrice: null, gender: null, note: null, strength: null, collection: null, exclude: [], unknown: [] };
  }
  function mergeQuery(prev, next) {
    prev = prev || emptyQuery(); next = next || {};
    const q = emptyQuery();
    q.anchor = next.anchor || prev.anchor || null;
    Object.keys(prev.features || {}).forEach(k => { q.features[k] = prev.features[k]; });
    Object.keys(next.features || {}).forEach(k => {
      const v = next.features[k], old = q.features[k];
      q.features[k] = old != null && Math.sign(old) !== Math.sign(v) ? v : clamp((old || 0) + v, -2, 2);
    });
    q.maxPrice = next.maxPrice != null ? next.maxPrice : (prev.maxPrice != null ? prev.maxPrice : null);
    q.minPrice = next.minPrice != null ? next.minPrice : (prev.minPrice != null ? prev.minPrice : null);
    q.cheaper = next.cheaper ? true : (next.maxPrice != null ? false : !!prev.cheaper);
    q.refPrice = q.cheaper ? (next.refPrice != null ? next.refPrice : (prev.refPrice != null ? prev.refPrice : null)) : null;
    q.gender = next.gender || prev.gender || null;
    q.note = next.gender ? (next.note || null) : (prev.note || null);
    q.strength = next.strength || prev.strength || null;
    q.collection = next.collection || prev.collection || null;
    q.exclude = union(prev.exclude, next.exclude);
    q.unknown = (next.unknown || []).slice();
    if (next.unknownAnchor) q.unknownAnchor = next.unknownAnchor;
    return q;
  }
  const compose = parts => (parts || []).reduce((q, p) => mergeQuery(q, p), emptyQuery());

  // Feature labels: "a:Sweet" → canonical vocab spelling when the model knows it.
  function canon(prefix, label, model) {
    if (!model || !model.lookup[prefix]) return label;
    const i = model.lookup[prefix].get(String(label).toLowerCase());
    return i == null ? label : model.vocab[prefix][i];
  }
  function addFeat(f, key, w) { f[key] = clamp((f[key] || 0) + w, -2, 2); }
  // One lexicon entry / chip / mood → one part. Later labels of a list weigh a
  // little less than the first (deterministic, so "fresh" leans Fresh > Aromatic).
  function featuresOf(e, w, model) {
    const f = {};
    ['f', 'a', 'n', 'o', 'k', 'w', 'b'].forEach(p => (Array.isArray(e[p]) ? e[p] : []).forEach((label, i) => {
      if (label == null || label === '') return;
      addFeat(f, p + ':' + canon(p, label, model), w * (i === 0 ? 1 : Math.max(0.5, 1 - 0.15 * i)));
    }));
    return f;
  }
  function priceText(min, max) {
    if (min != null && max != null) return { label: '৳' + min + '–' + max, text: min + ' to ' + max };
    if (max != null) return { label: T.tokenPrefix.under + max, text: 'under ' + max };
    return { label: T.tokenPrefix.over + min, text: 'over ' + min };
  }
  function entryPart(e, sign, factor, raw, model) {
    const w = (typeof e.w === 'number' ? e.w : 1) * factor * sign;
    const part = { features: featuresOf(e, w, model), label: (sign < 0 ? T.tokenPrefix.not : '') + raw, text: (sign < 0 ? 'no ' : factor > 1 ? 'very ' : factor < 1 ? 'a bit ' : '') + raw };
    if (sign > 0) {
      if (e.g === 'men' || e.g === 'unisex') part.gender = e.g;
      if (e.gift) part.note = 'unisex';
      if (e.strength === 'stronger' || e.strength === 'softer') part.strength = e.strength;
      if (e.collection === 'exclusive') part.collection = 'exclusive';
      if (e.price && typeof e.price === 'object') { if (e.price.max != null) part.maxPrice = Number(e.price.max); if (e.price.min != null) part.minPrice = Number(e.price.min); }
    }
    return part;
  }
  // Chip (lexicon chips/moods) → query, merged with the previous one.
  function chipPart(c, model) {
    const part = entryPart(c, 1, 1, c.label || '', model);
    part.label = c.label || '';
    const words = [];
    ['f', 'a', 'n', 'o', 'k', 'b'].forEach(p => (Array.isArray(c[p]) ? c[p] : []).forEach(l => { const w = String(l).toLowerCase(); if (words.indexOf(w) < 0) words.push(w); }));
    if (part.maxPrice != null || part.minPrice != null) words.push(priceText(part.minPrice, part.maxPrice).text);
    if (c.g === 'men') words.push('for men'); else if (c.g === 'unisex' || c.gift) words.push('unisex');
    if (c.strength) words.push(c.strength); if (c.collection === 'exclusive') words.push('exclusive');
    part.text = words.join(' ');
    return hasEffect(part) ? part : null;
  }
  const hasEffect = p => !!p && (Object.keys(p.features || {}).length > 0 || p.anchor || p.maxPrice != null || p.minPrice != null || p.cheaper || p.gender || p.strength || p.collection || (p.exclude && p.exclude.length));
  function fromChip(chip, prev, model) {
    const part = chip && chipPart(chip, model);
    const q = mergeQuery(prev, part || {});
    q.parts = part ? [part] : [];
    return q;
  }
  // "Surprise me": deterministic by thread turn count.
  function surprisePart(seed, L, model) {
    const vibes = (((L || {}).chips || {}).vibe || []).filter(c => !c.surprise), moods = (L || {}).moods || [];
    const picks = [];
    if (vibes.length) picks.push(vibes[seed % vibes.length]);
    if (moods.length) picks.push(moods[(seed * 7 + 3) % moods.length]);
    const parts = picks.map(c => chipPart(c, model)).filter(Boolean);
    if (!parts.length) return null;
    const q = compose(parts);
    return { features: q.features, label: T.tokenPrefix.surprise + picks.map(c => c.label).join(' + '), text: parts.map(p => p.text).join(' ') };
  }

  // ── phrase index (lexicon + vocab labels + built-ins), cached per (lexicon, model) ──
  let INDEX = null;
  function getIndex(L, model) {
    if (INDEX && INDEX.L === L && INDEX.model === model) return INDEX;
    const idx = new Map(); let maxLen = 1;
    const add = (phrase, unit) => {
      const p = normalize(phrase); if (!p || p === ',') return;
      const n = p.split(' ').length; if (n > maxLen) maxLen = n;
      if (!idx.has(p)) idx.set(p, []);
      idx.get(p).push(unit);
    };
    L = L || {};
    (L.entries || []).forEach(e => (e.m || []).forEach(m => add(m, { kind: 'entry', data: e })));
    (L.moods || []).forEach(e => (e.m || []).forEach(m => add(m, { kind: 'entry', data: e })));
    (L.refs || []).forEach(r => (r.m || []).forEach(m => add(m, { kind: 'ref', data: r })));
    union(L.negations, NEG).forEach(w => add(w, { kind: 'neg', data: SUFFIX_NEG.test(normalize(w)) }));
    const ints = Object.assign({}, INT, L.intensifiers || {});
    Object.keys(ints).forEach(w => add(w, { kind: 'int', data: Number(ints[w]) || 1 }));
    const gw = L.genderWords || {};
    union(gw.women, GENDER.women).forEach(w => add(w, { kind: 'gender', data: 'women' }));
    union(gw.men, GENDER.men).forEach(w => add(w, { kind: 'gender', data: 'men' }));
    const st = L.strength || {};
    union(st.stronger, STRENGTH.stronger).forEach(w => add(w, { kind: 'strength', data: 'stronger' }));
    union(st.softer, STRENGTH.softer).forEach(w => add(w, { kind: 'strength', data: 'softer' }));
    union(L.exclusiveWords, EXCL).forEach(w => add(w, { kind: 'excl' }));
    PMAX.forEach(w => add(w, { kind: 'pmax' })); PMAX_POST.forEach(w => add(w, { kind: 'pmaxpost' }));
    PMIN.forEach(w => add(w, { kind: 'pmin' })); PMIN_POST.forEach(w => add(w, { kind: 'pminpost' }));
    CHEAP.forEach(w => add(w, { kind: 'cheap' })); add('cheaper', { kind: 'cheaper' }); add('between', { kind: 'between' });
    CONJ.forEach(w => add(w, { kind: 'conj' })); CUR.forEach(w => add(w, { kind: 'cur' })); add('ml', { kind: 'ml' });
    TRIGGERS.forEach(w => add(w, { kind: 'trigger' })); POST_TRIGGERS.forEach(w => add(w, { kind: 'ptrigger' }));
    DIFF_BRANDS.forEach(w => add(w, { kind: 'diffbrands' })); UNISEX.forEach(w => add(w, { kind: 'unisex' }));
    if (model) {
      model.vocab.b.forEach((name, i) => add(name, { kind: 'brand', data: { name, i } }));
      ['f', 'a', 'n', 'o', 'k'].forEach(p => model.vocab[p].forEach(label => add(label, { kind: 'vocab', data: { p, label, w: 1 } })));
      model.vocab.w.forEach(label => add(label, { kind: 'vocab', data: { p: 'w', label, w: 0.7 } }));
    }
    INDEX = { L, model, idx, maxLen };
    return INDEX;
  }
  const kindsAt = (index, phrase) => index.idx.get(phrase) || [];
  const hasKind = (units, kind) => units.some(u => u.kind === kind);

  // ── catalogue / reference name resolution ("like savage", "aventus type") ──
  function nameTokens(it, model) {
    if (!it._nt) {
      const bt = tokensOf(model.vocab.b[it.b] || '');
      const nt = tokensOf(it.nm);
      let st = nt.slice();
      if (bt.length && bt.every((t, k) => nt[k] === t)) st = nt.slice(bt.length);
      it._nt = nt; it._st = st; it._full = union(bt, nt);
    }
    return it;
  }
  // Generic name words ("le", "homme", "intense", numbers) match exactly; everything else allows typos.
  const tokEq = (c, t, strict) => ((GENERIC.has(c) || isNum(c)) ? c === t : fuzzyEq(c, t, strict));
  // lex: indices of C that are lexicon words (bare runs only) — they may complete a name
  // ("dior homme SPORT 2017") but never carry a match on their own ("lattafa sweet" is a brand + a vibe).
  function resolveName(C, model, L, index, strict, lex) {
    if (!C.length) return null;
    const first = C[0];
    // A plain lexicon word ("fresh") never anchors a product on its own.
    const firstIsWord = kindsAt(index, first).some(u => u.kind === 'entry' || u.kind === 'vocab' || u.kind === 'strength' || u.kind === 'gender');
    if (model) {
      let best = null;
      for (const it of model.items) {
        nameTokens(it, model);
        const used = []; let real = 0, generic = 0, edits = 0;
        C.forEach((c, ci) => {
          const g = GENERIC.has(c) || isNum(c);
          let d = -1; it._full.forEach(t => { const x = g ? (t === c ? 0 : -1) : dist(c, t, strict); if (x >= 0 && (d < 0 || x < d)) d = x; });
          if (d >= 0) { used.push(ci); edits += d; if (g) generic++; else real++; }
        });
        if (!real) continue;
        // Longest contiguous run of span tokens inside the full name: generic words count
        // here, so "le male", "dior homme", "le beau" resolve to the stocked product.
        let run = { len: 0, s: 0, own: false };
        for (let s = 0; s < C.length; s++) for (let t = 0; t < it._full.length; t++) {
          let k = 0; while (s + k < C.length && t + k < it._full.length && tokEq(C[s + k], it._full[t + k], strict)) k++;
          let own = false; for (let i = s; i < s + k; i++) if (!lex || !lex.has(i)) own = true;
          if (k > run.len || (k === run.len && own && !run.own)) run = { len: k, s, own };
        }
        if (lex && lex.size && (run.len < 2 || !run.own || used.some(i => lex.has(i) && (i < run.s || i >= run.s + run.len)))) continue;
        const prefix = it._st.length > 0 && !GENERIC.has(first) && !firstIsWord && fuzzyEq(first, it._st[0], strict);
        if (!(real >= 2 || prefix || run.len >= 2)) continue;
        let cover = 0; it._nt.forEach(t => { if (C.some(c => tokEq(c, t, strict))) cover++; });
        const score = real + 0.3 * generic + 0.5 * cover / Math.max(1, it._nt.length) + (prefix ? 0.2 : 0) + 0.2 * run.len + 0.01 * (it.bs || 0) - 0.3 * edits;
        if (!best || score > best.score || (score === best.score && it.idx < best.item.idx)) best = { score, item: it, used, edits };
      }
      // The catalogue wins unless a reference-lexicon name is clearly closer (two edits fewer).
      if (best && best.edits >= 2) { const r = resolveRef(C, L, strict); if (r && best.edits - r.edits >= 2) return r; }
      if (best) return { kind: 'catalog', item: best.item, used: best.used };
      // A leading brand name ("dior …") — unless a reference phrase covers more of the span ("dior sauvage").
      const r = resolveRef(C, L, strict);
      for (let bi = 0; bi < model.vocab.b.length; bi++) {
        const bt = tokensOf(model.vocab.b[bi]);
        if (bt.length && bt.every((t, k) => C[k] != null && fuzzyEq(C[k], t, true)) && !(r && r.used.length > bt.length)) return { kind: 'brand', name: model.vocab.b[bi], used: bt.map((_, k) => k) };
      }
      return r;
    }
    return resolveRef(C, L, strict);
  }
  function resolveRef(C, L, strict) {
    let bestRef = null;
    ((L || {}).refs || []).forEach(r => (r.m || []).forEach(m => {
      const pt = tokensOf(m); if (!pt.length) return;
      for (let s = 0; s + pt.length <= C.length; s++) {
        let edits = 0, ok = true;
        for (let k = 0; k < pt.length && ok; k++) { const d = dist(C[s + k], pt[k], strict && pt.length === 1); if (d < 0) ok = false; else edits += d; }
        if (!ok) continue;
        const score = pt.length - 0.01 * s - 0.3 * edits;
        if (!bestRef || score > bestRef.score) { const used = []; for (let k = 0; k < pt.length; k++) used.push(s + k); bestRef = { score, ref: r, used, edits }; }
      }
    }));
    return bestRef ? { kind: 'ref', ref: bestRef.ref, used: bestRef.used, edits: bestRef.edits } : null;
  }
  function anchorFrom(res) {
    if (res.kind === 'catalog') return { kind: 'catalog', id: res.item.id, name: res.item.nm };
    if (res.kind === 'ref') return { kind: 'ref', name: res.ref.name || (res.ref.m && res.ref.m[0]) || '', ref: res.ref };
    return null;
  }
  function anchorPart(anchor) {
    return { anchor, label: T.tokenPrefix.like + anchor.name, text: 'like ' + String(anchor.name).toLowerCase() };
  }

  // ── the parser: free text → structured query (deterministic) ──
  // ctx: { lastBrands: [...], refPrice } — brands already shown (for "different
  // brands") and the reference price for a relational "cheaper".
  function parse(text, lexicon, model, ctx) {
    const L = lexicon || {}; ctx = ctx || {};
    const index = getIndex(L, model);
    const tokens = tokensOf(text);
    const consumed = tokens.map(() => false);
    const parts = [];
    let anchor = null, unknownAnchor = null, hadTrigger = false;

    const spanAfter = start => { const s = []; for (let j = start; j < tokens.length && s.length < 6; j++) { if (consumed[j] || HARD_STOP.has(tokens[j])) break; if (isNum(tokens[j]) && (hasKind(kindsAt(index, tokens[j + 1] || ''), 'cur') || tokens[j + 1] === 'ml')) break; s.push(j); } return s; };
    const spanBefore = end => { const s = []; for (let j = end - 1; j >= 0 && s.length < 6; j--) { if (consumed[j] || HARD_STOP.has(tokens[j])) break; s.unshift(j); } return s; };
    const settle = (span, strict, bare, lex) => {
      const C = span.map(j => tokens[j]);
      const res = resolveName(C, model, L, index, strict, lex);
      if (res) {
        res.used.forEach(ci => { consumed[span[ci]] = true; });
        if (res.kind === 'brand') { const f = {}; f['b:' + res.name] = 1; parts.push({ features: f, label: res.name, text: res.name.toLowerCase() }); return true; }
        if (!anchor) { anchor = anchorFrom(res); parts.push(anchorPart(anchor)); }
        return true;
      }
      if (bare) return false;
      // Unknown name after a trigger: only the leading tokens nobody understands (never a
      // lexicon word; a leading generic word like "le" is skipped, never reported).
      const lead = [];
      for (const j of span) { const t = tokens[j]; if (GENERIC.has(t) && !lead.length) continue; if (kindsAt(index, t).length || STOP.has(t) || GENERIC.has(t) || !(isWord(t) || isNum(t))) break; lead.push(j); if (lead.length >= 4) break; }
      if (lead.length && !unknownAnchor) { unknownAnchor = lead.map(j => tokens[j]).join(' '); lead.forEach(j => { consumed[j] = true; }); return true; }
      return false;
    };
    // 1. triggered anchors ("like X", "alternative to X", "X type")
    for (let i = 0; i < tokens.length; i++) {
      if (consumed[i]) continue;
      let tl = 0, post = false;
      for (let n = Math.min(3, tokens.length - i); n >= 1 && !tl; n--) {
        const ks = kindsAt(index, tokens.slice(i, i + n).join(' '));
        if (hasKind(ks, 'trigger')) tl = n; else if (hasKind(ks, 'ptrigger')) { tl = n; post = true; }
      }
      if (!tl) continue;
      hadTrigger = true;
      const span = post ? spanBefore(i) : spanAfter(i + tl);
      if (!span.length) continue;
      if (settle(span, false)) for (let k = 0; k < tl; k++) consumed[i + k] = true;
    }
    // 2. phrase units over what is left (longest phrase first, whole tokens)
    const units = [];
    for (let i = 0; i < tokens.length;) {
      if (consumed[i]) { i++; continue; }
      const t = tokens[i];
      if (t === ',') { units.push({ pos: i, len: 1, raw: t, kinds: [{ kind: 'bound' }] }); i++; continue; }
      if (isNum(t)) { const k = tokens[i + 1] === 'k' && !consumed[i + 1]; units.push({ pos: i, len: k ? 2 : 1, raw: t, kinds: [{ kind: 'num', data: Number(t) * (k ? 1000 : 1) }] }); i += k ? 2 : 1; continue; }
      let hit = null, hl = 0;
      for (let n = Math.min(index.maxLen, tokens.length - i); n >= 1 && !hit; n--) {
        let ok = true; for (let j = i; j < i + n; j++) if (consumed[j] || tokens[j] === ',') { ok = false; break; }
        if (!ok) continue;
        const ks = kindsAt(index, tokens.slice(i, i + n).join(' '));
        if (ks.length) { hit = ks; hl = n; }
      }
      if (hit) { units.push({ pos: i, len: hl, raw: tokens.slice(i, i + hl).join(' '), kinds: hit }); i += hl; }
      else { units.push({ pos: i, len: 1, raw: t, kinds: [{ kind: 'word' }] }); i++; }
    }
    const kindOf = (u, k) => (u ? u.kinds.find(x => x.kind === k) : null);
    // A comma / contrast word ends a window; a brand / strength / gender / exclusive word
    // "takes" the negation, so "not lattafa strong" excludes the brand and keeps "strong".
    const bounds = units.filter(u => u.kinds[0].kind === 'bound' || BOUND_WORDS.indexOf(u.raw) >= 0).map(u => u.pos);
    const blocked = (a, b) => bounds.some(p => p > a && p < b);
    const closers = units.filter(u => ['brand', 'strength', 'gender', 'excl', 'unisex'].some(k => hasKind(u.kinds, k))).map(u => ({ a: u.pos, b: u.pos + u.len - 1 }));
    const closed = (a, b) => closers.some(c => c.a > a && c.b < b);
    const negs = units.filter(u => hasKind(u.kinds, 'neg')).map(u => ({ pos: u.pos, end: u.pos + u.len - 1, suffix: !!u.kinds.find(k => k.kind === 'neg').data }));
    const ints = units.filter(u => hasKind(u.kinds, 'int')).map(u => ({ pos: u.pos, end: u.pos + u.len - 1, f: u.kinds.find(k => k.kind === 'int').data }));
    const negated = u => { const e = u.pos + u.len - 1; return negs.some(n => (!n.suffix && u.pos - n.end >= 1 && u.pos - n.end <= 3 && !blocked(n.end, u.pos) && !closed(n.end, u.pos)) || (n.suffix && n.pos - e >= 1 && n.pos - e <= 3 && !blocked(e, n.pos) && !closed(e, n.pos))); };
    const factorOf = u => { const x = ints.find(n => u.pos - n.end >= 1 && u.pos - n.end <= 2 && !blocked(n.end, u.pos)); return x ? x.f : 1; };
    // Does a matched phrase ("for my wife") contain a "for her" word? Then the unisex note applies.
    const womenIn = raw => { const tk = raw.split(' '); for (let i = 0; i < tk.length; i++) for (let n = 1; n <= 3 && i + n <= tk.length; n++) if (kindsAt(index, tk.slice(i, i + n).join(' ')).some(k => k.kind === 'gender' && k.data === 'women')) return true; return false; };
    // 3. bare names ("sauvage cheaper", "dior homme sport 2017", "hawas ice", "lattafa"): runs of
    //    unmatched words, numbers and brand names; lexicon words may continue a run a brand or
    //    unknown word started. A resolved name consumes its tokens first, so a year inside a
    //    product name is never read as a price and its brand is not a separate part.
    const LEX_KINDS = ['entry', 'vocab', 'ref', 'strength', 'gender', 'excl', 'unisex'];
    const NAME_SAFE = ['word', 'num', 'brand'].concat(LEX_KINDS);
    let run = [], runLex = new Set();
    const flush = () => { if (run.length && !anchor) settle(run, true, true, runLex); run = []; runLex = new Set(); };
    units.forEach(u => {
      const k0 = u.kinds[0].kind, namey = hasKind(u.kinds, 'brand') || hasKind(u.kinds, 'ref');   // a brand or famous-name phrase is name-like, not a vibe word
      const lexical = !namey && LEX_KINDS.some(k => hasKind(u.kinds, k));
      const ok = !consumed[u.pos] && u.kinds.every(k => NAME_SAFE.indexOf(k.kind) >= 0) && !negated(u)
        && (k0 === 'num' || namey || (k0 === 'word' ? !STOP.has(u.raw) && isWord(u.raw) : lexical && run.length > 0));
      if (!ok) { flush(); return; }
      for (let k = 0; k < u.len; k++) { if (lexical) runLex.add(run.length); run.push(u.pos + k); }
    });
    flush();
    // 3a. prices
    let sawPrice = false;
    const done = new Set();
    units.forEach((u, ui) => {
      const num = kindOf(u, 'num'); if (!num || done.has(ui)) return;
      if (consumed[u.pos]) { done.add(ui); return; }   // part of a product name ("Dior Homme Sport 2017")
      const next = units[ui + 1], next2 = units[ui + 2];
      if (next && (kindOf(next, 'ml'))) { done.add(ui); return; }
      let k = ui - 1; while (k >= 0 && kindOf(units[k], 'cur')) k--;
      const before = ui - k <= 3 ? units[k] : null;
      const numAfter = next && kindOf(next, 'num') && !consumed[next.pos] ? next : (next && kindOf(next, 'conj') && next2 && kindOf(next2, 'num') && !consumed[next2.pos] ? next2 : null);
      let part = null;
      if (numAfter) {
        const other = numAfter.kinds[0].data;
        part = { minPrice: Math.min(num.data, other), maxPrice: Math.max(num.data, other) }; done.add(units.indexOf(numAfter));
      } else if (before && (kindOf(before, 'pmin'))) part = { minPrice: num.data };
      else if (before && (kindOf(before, 'pmax') || kindOf(before, 'cheap') || kindOf(before, 'between'))) part = { maxPrice: num.data };
      else if (next && kindOf(next, 'pminpost')) part = { minPrice: num.data };
      else if (next && kindOf(next, 'pmaxpost')) part = { maxPrice: num.data };
      else if ((next && kindOf(next, 'cur')) || (ui > 0 && kindOf(units[ui - 1], 'cur')) || num.data >= 100) part = { maxPrice: num.data };
      if (!part) return;
      done.add(ui); sawPrice = true;
      Object.assign(part, priceText(part.minPrice != null ? part.minPrice : null, part.maxPrice != null ? part.maxPrice : null));
      parts.push(part);
    });
    // 3b. everything else
    units.forEach(u => {
      if (consumed[u.pos]) return;   // part of a resolved product name
      const ks = u.kinds; const neg = negated(u); const factor = factorOf(u);
      const entries = ks.filter(k => k.kind === 'entry');
      const gender = kindOf(u, 'gender'), strength = kindOf(u, 'strength');
      // A word that is also a strength / gender / exclusive / negation word is not a description keyword
      // ("strong" → Leans stronger, never a w:strong pull on products whose text merely says "strong").
      const slotWord = !!(gender || strength || kindOf(u, 'excl') || kindOf(u, 'neg') || kindOf(u, 'unisex'));
      let entryGender = null;
      if (entries.length) {
        const sign = neg ? -1 : 1, f = neg && factor > 1 ? 0.5 : factor;
        const merged = compose(entries.map(k => entryPart(k.data, sign, f, u.raw, model)));
        const part = { features: merged.features, label: (neg ? T.tokenPrefix.not : '') + u.raw, text: (neg ? 'no ' : f > 1 ? 'very ' : f < 1 ? 'a bit ' : '') + u.raw };
        if (merged.gender) {
          part.gender = entryGender = merged.gender; part.note = merged.note || (merged.gender === 'unisex' && womenIn(u.raw) ? 'unisex' : null);
          part.label = T.tokenPrefix[part.note === 'unisex' ? 'gift' : merged.gender];   // the spec label; `text` keeps the phrase so the share link re-parses
        }
        if (merged.strength) part.strength = merged.strength;
        if (merged.collection) part.collection = merged.collection;
        if (merged.maxPrice != null && !sawPrice) part.maxPrice = merged.maxPrice;
        if (merged.minPrice != null && !sawPrice) part.minPrice = merged.minPrice;
        if (hasEffect(part)) parts.push(part);
      } else {
        const vocabs = ks.filter(k => k.kind === 'vocab' && !(slotWord && k.data.p === 'w'));
        if (vocabs.length) {
          const f = {}; const sign = neg ? -1 : 1, fac = neg && factor > 1 ? 0.5 : factor;
          vocabs.forEach(k => addFeat(f, k.data.p + ':' + k.data.label, sign * fac * k.data.w));
          parts.push({ features: f, label: (neg ? T.tokenPrefix.not : '') + u.raw, text: (neg ? 'no ' : '') + u.raw });
        }
      }
      const brand = kindOf(u, 'brand');
      if (brand) { if (neg) parts.push({ exclude: ['brand:' + brand.data.name], label: T.tokenPrefix.not + brand.data.name, text: 'not ' + u.raw }); else { const f = {}; f['b:' + brand.data.name] = 1; parts.push({ features: f, label: brand.data.name, text: u.raw }); } }
      const ref = kindOf(u, 'ref');
      if (ref && !anchor && !neg) {
        // A famous name typed bare: the catalogue is tried first (we may stock it), then the reference profile.
        const span = []; for (let k = 0; k < u.len; k++) span.push(u.pos + k);
        if (!settle(span, true, true)) { anchor = anchorFrom({ kind: 'ref', ref: ref.data }); parts.push(anchorPart(anchor)); }
      }
      if (gender && !neg && !entryGender) parts.push(gender.data === 'women' ? { gender: 'unisex', note: 'unisex', label: T.tokenPrefix.gift, text: 'unisex' } : { gender: 'men', label: T.tokenPrefix.men, text: 'for men' });
      if (kindOf(u, 'unisex') && !neg && !gender && !entryGender) parts.push({ gender: 'unisex', label: T.tokenPrefix.unisex, text: 'unisex' });
      if (strength && !entries.length) { const s = neg ? (strength.data === 'stronger' ? 'softer' : 'stronger') : strength.data; parts.push({ strength: s, label: T.tokenPrefix[s], text: s }); }
      if (kindOf(u, 'excl') && !neg) parts.push({ collection: 'exclusive', label: T.tokenPrefix.exclusive, text: 'exclusive' });
      if (kindOf(u, 'diffbrands')) { const bs = (ctx.lastBrands || []).filter(Boolean); if (bs.length) parts.push({ exclude: bs.map(b => 'brand:' + b), label: T.follow.brands, text: bs.map(b => 'not ' + b.toLowerCase()).join(', ') }); }
      if (kindOf(u, 'cheaper') && !sawPrice) { const r = ctx.refPrice != null ? ctx.refPrice : null; parts.push({ cheaper: true, refPrice: r, label: r != null ? T.tokenPrefix.cheaper + r : T.follow.cheaper, text: r != null ? 'under ' + r : 'cheaper' }); }
      if (kindOf(u, 'cheap') && !sawPrice && !units.some(x => kindOf(x, 'num') && !consumed[x.pos])) { if (!parts.some(p => p.maxPrice != null)) parts.push(Object.assign({ maxPrice: CHEAP_DEFAULT }, priceText(null, CHEAP_DEFAULT))); }
    });
    // 4. unknown words (alphabetic, ≥ 4 letters, not a stop-word, not consumed)
    const unknown = [];
    units.forEach(u => { if (u.kinds[0].kind === 'word' && !consumed[u.pos] && isWord(u.raw) && u.raw.length >= 4 && !STOP.has(u.raw) && unknown.indexOf(u.raw) < 0 && unknown.length < 6) unknown.push(u.raw); });
    if (unknownAnchor && unknown.indexOf(unknownAnchor) < 0) unknown.unshift(unknownAnchor);
    // One part per gender / strength / collection slot (the last mention wins).
    ['gender', 'strength', 'collection'].forEach(slot => { for (let i = parts.length - 1, seen = false; i >= 0; i--) if (parts[i][slot] && !parts[i].features && !parts[i].anchor) { if (seen) parts.splice(i, 1); seen = true; } });
    const own = compose(parts);
    own.unknown = unknown;
    if (unknownAnchor) own.unknownAnchor = unknownAnchor;
    const q = ctx.prev ? mergeQuery(ctx.prev, own) : own;
    q.parts = parts; q.hadTrigger = hadTrigger;
    return q;
  }
  function hasTrigger(text, L, model) {
    const index = getIndex(L || {}, model), tk = tokensOf(text);
    for (let i = 0; i < tk.length; i++) for (let n = 1; n <= 3 && i + n <= tk.length; n++) { const ks = kindsAt(index, tk.slice(i, i + n).join(' ')); if (hasKind(ks, 'trigger') || hasKind(ks, 'ptrigger')) return true; }
    return false;
  }

  // ── vectors (key-for-key identical to js/recs.js, plus w<idx>) ──
  function vectorize(it) {
    const v = new Map();
    const add = (k, w) => v.set(k, (v.get(k) || 0) + w);
    (it.f || []).forEach(i => add('f' + i, WEIGHTS.f));
    (it.a || []).forEach(i => add('a' + i, WEIGHTS.a));
    (it.n || []).forEach(i => add('n' + i, WEIGHTS.n));
    (it.o || []).forEach(i => add('o' + i, WEIGHTS.o));
    if (it.g) add('g' + it.g, WEIGHTS.g);
    if (it.k >= 0) add('k' + it.k, WEIGHTS.k);
    if (it.b >= 0) add('b' + it.b, WEIGHTS.b);
    (it.kw || []).forEach(i => add('w' + i, WEIGHTS.w));
    let n = 0; v.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1;
    v.forEach((w, k) => v.set(k, w / n));
    return v;
  }
  function normalizeVec(v) { let n = 0; v.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1; v.forEach((w, k) => v.set(k, w / n)); return v; }
  function prepareData(data) {
    if (!data || data.v !== 1 || !Array.isArray(data.items)) return null;
    const vocab = Object.assign({ b: [], f: [], a: [], n: [], o: [], k: [], w: [], r: [] }, data.vocab || {});
    const lookup = {};
    ['b', 'f', 'a', 'n', 'o', 'k', 'w', 'r'].forEach(p => { lookup[p] = new Map(); (vocab[p] || []).forEach((label, i) => { const k = String(label).toLowerCase(); if (!lookup[p].has(k)) lookup[p].set(k, i); }); });
    const byId = new Map();
    const items = data.items.map((it, idx) => { const m = Object.assign({}, it, { idx, vec: vectorize(it) }); byId.set(it.id, m); return m; });
    return { vocab, lookup, items, byId, src: data.src || '' };
  }
  function queryVector(query, model) {
    const v = new Map();
    const f = (query && query.features) || {};
    Object.keys(f).forEach(k => {
      const m = /^([fanokbw]):(.+)$/.exec(k); if (!m || !f[k]) return;
      const i = model.lookup[m[1]].get(m[2].toLowerCase()); if (i == null) return;
      v.set(m[1] + i, (v.get(m[1] + i) || 0) + f[k] * WEIGHTS[m[1]]);
    });
    return normalizeVec(v);
  }
  function refVector(ref, model) {
    const v = new Map();
    ['f', 'a', 'n'].forEach(p => (ref[p] || []).forEach((label, i) => { const idx = model.lookup[p].get(String(label).toLowerCase()); if (idx != null) v.set(p + idx, (v.get(p + idx) || 0) + WEIGHTS[p] * (i === 0 ? 1 : Math.max(0.5, 1 - 0.15 * i))); }));
    return normalizeVec(v);
  }
  // Anchor vector (catalogue product or reference profile); extra typed features
  // ("like X but sweeter") tilt it instead of being dropped.
  function buildQueryVec(query, model) {
    const qv = queryVector(query, model);
    const a = query.anchor;
    if (!a) return qv;
    let av = null;
    if (a.kind === 'catalog') { const it = model.byId.get(a.id); if (it) av = new Map(it.vec); }
    else if (a.kind === 'ref') { const ref = a.ref || refFor(a.name, model); if (ref) av = refVector(ref, model); }
    if (!av || !av.size) return qv;
    if (qv.size) { qv.forEach((w, k) => av.set(k, (av.get(k) || 0) + ANCHOR_FEATURE_SHARE * w)); normalizeVec(av); }
    return av;
  }
  let REFS = null;   // set by the browser init / tests so a restored ref anchor keeps its profile
  function refFor(name, model) {
    const n = normalize(name);
    return ((REFS || (INDEX && INDEX.L && INDEX.L.refs) || [])).find(r => normalize(r.name) === n || (r.m || []).some(m => normalize(m) === n)) || null;
  }

  // ── tier-1 profile (read-only copy of recs.js rules) ──
  function readSignals() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(SIGNALS_KEY); if (!raw) return [];
      const d = JSON.parse(raw); if (!d || d.v !== 1 || !Array.isArray(d.e)) return [];
      const cutoff = Date.now() - EXPIRY_DAYS * DAY;
      return d.e.filter(e => e && typeof e.id === 'string' && e.ts > cutoff);
    } catch (e) { return []; }
  }
  function priceOf(item, ml) {
    if (ml) { const s = (item.s || []).find(x => x[0] === Number(ml)); if (s) return effectivePrice(s[1], item.sp); }
    return item.p;
  }
  function buildProfile(signals, model) {
    if (signals && signals.items && model && !model.items) { const t = signals; signals = model; model = t; }   // (model, signals) order also accepted
    const vec = new Map(), ids = new Set();
    let weight = 0, logSum = 0;
    const now = Date.now();
    for (const ev of signals || []) {
      const item = model && model.byId.get(ev.id); if (!item) continue;
      ids.add(ev.id);
      const w = (EVENT_W[ev.t] || 0) * Math.pow(0.5, Math.max(0, now - ev.ts) / DAY / HALF_LIFE_DAYS);
      if (!w) continue;
      weight += w; logSum += w * Math.log(priceOf(item, ev.ml));
      item.vec.forEach((x, k) => vec.set(k, (vec.get(k) || 0) + w * x));
    }
    normalizeVec(vec);
    return { vec, weight, logP: weight ? logSum / weight : 0, ids };
  }
  function cosine(a, b) {
    let s = 0; const small = a.size < b.size ? a : b, big = small === a ? b : a;
    small.forEach((x, k) => { const y = big.get(k); if (y) s += x * y; });
    return s;
  }

  // ── ranking ──
  const brandOf = (it, model) => model.vocab.b[it.b] || '';
  function strengthBonus(it, strength, model) {
    if (!strength) return 0;
    const k = String(model.vocab.k[it.k] || '').toLowerCase();
    const acc = (it.a || []).map(i => String(model.vocab.a[i] || '').toLowerCase());
    if (strength === 'stronger') return STRONG_K.indexOf(k) >= 0 || acc.some(a => STRONG_A.indexOf(a) >= 0) ? STRENGTH_BONUS : 0;
    if (strength === 'softer') return SOFT_K.indexOf(k) >= 0 || acc.some(a => SOFT_A.indexOf(a) >= 0) ? STRENGTH_BONUS : 0;
    return 0;
  }
  // Ordered candidates after the hard filters, brand-capped while walking, up to opts.limit.
  //   opts: exclude (Set/array of ids), referencePrice, signals | profile, limit, brandCap, minCos,
  //         ignoreCheaper / ignorePrice / ignoreGender / anyCollection (used by answer() to relax)
  function rank(model, query, opts) {
    opts = opts || {}; query = query || emptyQuery();
    if (!model) return [];
    const ex = new Set(opts.exclude instanceof Set ? Array.from(opts.exclude) : (opts.exclude || []));
    if (query.anchor && query.anchor.id) ex.add(query.anchor.id);
    const exBrands = new Set();
    (query.exclude || []).forEach(e => { if (/^id:/.test(e)) ex.add(e.slice(3)); else if (/^brand:/i.test(e)) exBrands.add(e.slice(6).toLowerCase()); });
    const qv = opts.queryVec || buildQueryVec(query, model);
    // The similarity threshold needs something to be similar TO: a purely negative query
    // ("not sweet") only pushes items down, it does not empty the ranking.
    let hasQ = false; qv.forEach(w => { if (w > 0) hasQ = true; });
    // An explicitly requested brand ("rasasi", "something from armaf") is exempt from the brand cap.
    const wanted = new Set(Object.keys(query.features || {}).filter(k => /^b:/.test(k) && query.features[k] > 0).map(k => k.slice(2).toLowerCase()));
    const prof = opts.profile || (opts.signals ? buildProfile(opts.signals, model) : null);
    const refPrice = opts.referencePrice > 0 ? opts.referencePrice : (query.cheaper && query.refPrice > 0 ? query.refPrice : null);
    const minCos = opts.minCos == null ? MIN_COS : opts.minCos;
    const collection = opts.anyCollection ? null : (query.collection === 'exclusive' ? 'e' : 'r');
    const out = [];
    for (const it of model.items) {
      if (!it.i || ex.has(it.id)) continue;
      if (collection && it.c !== collection) continue;
      if (!opts.ignorePrice) {
        if (query.maxPrice != null && it.p > query.maxPrice) continue;
        if (query.minPrice != null && it.p < query.minPrice) continue;
      }
      if (!opts.ignoreGender && query.gender === 'men' && it.g !== 1 && it.g !== 3) continue;
      if (!opts.ignoreGender && query.gender === 'unisex' && it.g !== 3) continue;
      if (exBrands.size && exBrands.has(brandOf(it, model).toLowerCase())) continue;
      if (!opts.ignoreCheaper && query.cheaper && refPrice != null && !(it.p < refPrice)) continue;
      const cq = qv.size ? cosine(qv, it.vec) : 0;
      if (hasQ && cq <= minCos) continue;
      const cp = prof && prof.weight ? cosine(prof.vec, it.vec) : 0;
      let score = QUERY_SHARE * cq + PROFILE_SHARE * cp + BS_BONUS * (it.bs || 0) + strengthBonus(it, query.strength, model);
      if (refPrice != null) score -= PRICE_PEN * Math.min(1, Math.abs(Math.log(it.p) - Math.log(refPrice)) / Math.log(3));
      const matched = []; qv.forEach((w, k) => { if (w > 0 && it.vec.has(k)) matched.push(k); });
      out.push({ id: it.id, item: it, score, cos: cq, matched });
    }
    out.sort((x, y) => (y.score - x.score) || (x.item.p - y.item.p) || (x.item.idx - y.item.idx));
    const cap_ = opts.brandCap == null ? BRAND_CAP : opts.brandCap, limit = opts.limit == null ? ANSWER_SIZE : opts.limit;
    const picks = [], per = new Map();
    for (const r of out) {
      const b = r.item.b;
      if (cap_ && (per.get(b) || 0) >= cap_ && !wanted.has(brandOf(r.item, model).toLowerCase())) continue;
      picks.push(r); per.set(b, (per.get(b) || 0) + 1);
      if (limit && picks.length >= limit) break;
    }
    return picks;
  }
  // rank() plus the relaxation ladder (cheaper → price band → gender → collection → threshold);
  // returns { picks, relaxed: [codes] } so the reply can say what was dropped.
  function answer(model, query, opts) {
    const steps = [];
    if (query.cheaper) steps.push('cheaper');
    if (query.maxPrice != null || query.minPrice != null) steps.push('price');
    if (query.gender) steps.push('gender');
    if (query.collection === 'exclusive') steps.push('collection');
    steps.push('threshold');
    const o = Object.assign({}, opts || {});
    let picks = rank(model, query, o); const relaxed = [];
    for (const s of steps) {
      if (picks.length) break;
      relaxed.push(s);
      if (s === 'cheaper') o.ignoreCheaper = true; else if (s === 'price') o.ignorePrice = true; else if (s === 'gender') o.ignoreGender = true; else if (s === 'collection') o.anyCollection = true; else o.minCos = -1;
      picks = rank(model, query, o);
    }
    return { picks, relaxed };
  }

  // ── reason line per card (three modes, never invented) ──
  const lowerList = labels => cap(joinAnd(labels.map(l => String(l).toLowerCase())));
  // A label that is both a note and an accord (Vanilla, Lavender, Leather …) is said once.
  const uniq = labels => { const seen = new Set(), out = []; labels.forEach(l => { const k = String(l).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(l); } }); return out; };
  function reasons(cand, query, model, anchor) {
    const it = cand.item || cand, V = model.vocab, price = 'from ৳' + it.p;
    const labelsOf = (p, idxs) => idxs.map(i => V[p][i]).filter(Boolean);
    let notes = [];
    if (anchor && (anchor.kind === 'catalog' || anchor.kind === 'ref')) {
      let an = [], aa = [];
      if (anchor.kind === 'catalog') { const ai = model.byId.get(anchor.id); if (ai) { an = ai.n || []; aa = ai.a || []; } }
      else { const ref = anchor.ref || refFor(anchor.name, model) || {}; an = (ref.n || []).map(l => model.lookup.n.get(String(l).toLowerCase())).filter(x => x != null); aa = (ref.a || []).map(l => model.lookup.a.get(String(l).toLowerCase())).filter(x => x != null); }
      notes = uniq(labelsOf('n', (it.n || []).filter(i => an.indexOf(i) >= 0)).concat(labelsOf('a', (it.a || []).filter(i => aa.indexOf(i) >= 0)))).slice(0, 3);
      if (!notes.length) notes = labelsOf('a', (it.a || []).slice(0, 2));
      const verified = anchor.kind === 'ref' && (it.ref || []).some(ri => normalize(V.r[ri]) === normalize(anchor.name));
      if (verified) return 'Verified alternative to ' + anchor.name + (notes.length ? ' · ' + notes.map(l => String(l).toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' & $1') : '') + ' · ' + price;
      return (notes.length ? lowerList(notes) + ' · ' : '') + 'closest match to ' + anchor.name + ' · ' + price;
    }
    const m = cand.matched || [];
    const pick = (p, limit) => m.filter(k => k.charAt(0) === p).map(k => V[p][Number(k.slice(1))]).filter(Boolean).slice(0, limit);
    notes = uniq(pick('n', 3).concat(pick('a', 3))).slice(0, 3);
    if (!notes.length) notes = labelsOf('a', (it.a || []).slice(0, 2));
    const occ = pick('o', 2);
    return [notes.length ? lowerList(notes) : '', occ.length ? occ.join(', ') : '', price].filter(Boolean).join(' · ');
  }

  // ── browser integration ──
  const S = { url: '', model: null, pending: null, failed: false, lex: null, thread: null, el: null, chips: [] };
  const STEP_ASK = { vibe: 'askVibe', budget: 'askBudget', who: 'askWho' };
  const DEFAULT_CHIPS = {
    occasion: [{ label: 'Office / University', o: ['Office', 'Everyday'] }, { label: 'Everyday', o: ['Everyday', 'Casual'] }, { label: 'Date night', o: ['Date Night', 'Evening'] }, { label: 'Evening / Party', o: ['Party', 'Evening'] }, { label: 'Summer heat', o: ['Summer'], a: ['Fresh', 'Citrus'] }, { label: 'Winter', o: ['Winter'], a: ['Amber', 'Warm Spicy'] }, { label: 'Gym', o: ['Gym / Sport'], a: ['Fresh'] }, { label: 'Formal / Wedding', o: ['Formal', 'Wedding'] }],
    vibe: [{ label: 'Fresh & clean', a: ['Fresh', 'Citrus', 'Aromatic'] }, { label: 'Sweet', a: ['Sweet', 'Vanilla'] }, { label: 'Woody & warm', a: ['Woody', 'Amber'] }, { label: 'Spicy', a: ['Warm Spicy', 'Fresh Spicy'] }, { label: 'Aquatic / blue', a: ['Aquatic', 'Marine', 'Fresh'] }, { label: 'Soft & powdery', a: ['Powdery', 'Musky'] }, { label: 'Green', a: ['Green'] }, { label: 'Surprise me', surprise: true }],
    budget: [{ label: 'Under ৳300', price: { max: 300 } }, { label: '৳300–600', price: { min: 300, max: 600 } }, { label: '৳600–1,000', price: { min: 600, max: 1000 } }, { label: 'Any' }],
    who: [{ label: 'Me', g: 'men' }, { label: 'Unisex / anyone', g: 'unisex' }, { label: 'A gift', g: 'unisex', gift: true }],
  };
  const lexChips = set => { const c = ((S.lex || {}).chips || {})[set]; return Array.isArray(c) && c.length ? c : DEFAULT_CHIPS[set]; };
  function freshThread() { return { v: 1, query: emptyQuery(), turns: [], renderedIds: [], parts: [], chips: 'opening', lastIds: [], awaitName: false, pending: [], cards: {} }; }
  function imgUrl(item, size) {
    const base = (typeof IMAGE_BASE === 'string' && IMAGE_BASE) || CDN;
    return base + '/storage/v1/object/public/product-images/' + encodeURIComponent(item.id) + '/' + size + '.webp?v=' + item.v;
  }
  function toCard(item, model) {
    const vocab = (model || S.model).vocab;
    return {
      id: item.id, name: item.nm, brand: vocab.b[item.b] || '',
      sizes: (item.s || []).map(x => ({ ml: x[0], price: x[1] })), tags: item.t || [],
      accords: (item.a || []).map(i => vocab.a[i]).filter(Boolean),
      inStock: !!item.i, sale_percent: item.sp,
      image_thumb: imgUrl(item, 'thumb'), image_small: imgUrl(item, 'small'),
    };
  }
  // One fetch per page (in-flight de-duplicated); nothing before the first chip/text.
  function prepare() {
    if (S.model) return Promise.resolve(S.model);
    if (S.pending) return S.pending;
    if (!S.url || typeof fetch !== 'function') return Promise.resolve(null);
    S.pending = fetch(S.url, { credentials: 'omit' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { S.model = prepareData(d); return S.model; })
      .catch(() => null)
      .then(m => { S.pending = null; if (!m) S.failed = true; return m; });
    return S.pending;
  }
  // ── state ──
  function save() {
    try {
      const th = S.thread; if (!th) return;
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, query: th.query, turns: th.turns, renderedIds: th.renderedIds, parts: th.parts, chips: th.chips, lastIds: th.lastIds, awaitName: th.awaitName, pending: th.pending, cards: th.cards }));
    } catch (e) {}
  }
  function loadStored() {
    try {
      const d = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
      if (!d || d.v !== 1 || !Array.isArray(d.turns) || !Array.isArray(d.renderedIds)) return null;
      const th = Object.assign(freshThread(), d, { query: compose(d.parts || []) });
      if (!th.cards || typeof th.cards !== 'object') th.cards = {};
      return th;
    } catch (e) { return null; }
  }
  const clearStored = () => { try { sessionStorage.removeItem(STATE_KEY); } catch (e) {} };
  // Constraint parts: one slot each for anchor / price / gender / strength / collection;
  // feature parts accumulate, an opposite-sign repeat replaces the older one.
  const slotOf = p => (p.anchor ? 'anchor' : (p.maxPrice != null || p.minPrice != null || p.cheaper) ? 'price' : p.gender ? 'gender' : p.strength ? 'strength' : p.collection ? 'collection' : null);
  function addParts(parts) {
    const th = S.thread;
    parts.forEach(p => {
      if (!hasEffect(p)) return;
      const slot = slotOf(p);
      th.parts = th.parts.filter(old => {
        if (slot && slotOf(old) === slot) return false;
        const keys = Object.keys(old.features || {});
        if (keys.length && p.features && keys.every(k => p.features[k] != null && Math.sign(p.features[k]) !== Math.sign(old.features[k]))) return false;
        return true;
      });
      th.parts.push(p); th.pending.push(p);
    });
    th.query = compose(th.parts);
    renderBar();
  }
  const removePart = k => { const th = S.thread; th.parts.splice(k, 1); th.query = compose(th.parts); renderBar(); };

  // ── rendering ──
  const el = id => document.getElementById(id);
  function msgEl(role, html) {
    const d = document.createElement('div'); d.className = 'msg msg-' + role; d.innerHTML = html;
    return d;
  }
  function appendMsg(node) {
    const th = S.el.thread; const foot = th.querySelector('.finder-foot');
    if (foot) th.insertBefore(node, foot); else th.appendChild(node);
    return node;
  }
  // Cards render from the thread's stored card data (filled at answer time), so a
  // restored thread paints synchronously: no fetch, nothing moves.
  function renderTurn(turn, scroll) {
    if (turn.role === 'user') return appendMsg(msgEl('user', esc(turn.text)));
    const cards = S.thread.cards || {};
    let html = '<p>' + esc(turn.text) + '</p>';
    (turn.notes || []).forEach(n => { html += '<p class="finder-sub">' + esc(n) + '</p>'; });
    const ids = (turn.ids || []).filter(id => cards[id] && cards[id].c);
    if (ids.length) {
      html += '<div class="product-grid finder-cards">';
      ids.forEach((id, i) => {
        const c = cards[id];
        const card = window.RenderCard && typeof RenderCard.renderCard === 'function'
          ? RenderCard.renderCard(c.c, { isExclusive: !!c.e, priority: false })
          : '<div class="product-card" data-id="' + esc(c.c.id) + '"><a class="card-link" href="/product/' + esc(c.c.id) + '/">' + esc(c.c.name) + '</a></div>';
        html += card + '<p class="finder-reason">' + esc((turn.reasons || [])[i] || '') + '</p>';
      });
      html += '</div>';
    }
    if (turn.table) html += compareTable(turn.table);
    if (ids.length || turn.table) html += '<p class="finder-note">' + esc(T.honesty) + '</p>';
    const node = appendMsg(msgEl('bot', html));
    // js/api.js declares `const ProductAPI` (a global lexical binding, NOT a window property), so test the name itself.
    if (ids.length && typeof ProductAPI !== 'undefined' && ProductAPI && typeof ProductAPI.hydrateCards === 'function') { try { ProductAPI.hydrateCards(); } catch (e) {} }
    if (scroll) { try { node.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    return node;
  }
  // Compare rows are computed once (model needed) and stored on the turn as plain text.
  function compareRows(ids, model) {
    const V = model.vocab, items = ids.map(id => model.byId.get(id)).filter(Boolean);
    if (items.length < 2) return null;
    const R = T.compareRows;
    const row = (label, fn) => [label].concat(items.map(it => fn(it) || '—'));
    return { names: items.map(it => it.nm), rows: [
      row(R.brand, it => V.b[it.b]), row(R.family, it => (it.f || []).map(i => V.f[i]).join(', ')), row(R.accords, it => (it.a || []).map(i => V.a[i]).join(', ')),
      row(R.notes, it => (it.n || []).map(i => V.n[i]).join(', ')), row(R.occasions, it => (it.o || []).map(i => V.o[i]).join(', ')),
      row(R.concentration, it => V.k[it.k]), row(R.price, it => '৳' + it.p),
    ] };
  }
  function compareTable(t) {
    if (!t || !t.rows) return '';
    // The wrapper (finder.css) scrolls sideways if a long notes list needs it, so the
    // table never widens the page (a wider layout viewport makes phone taps land off-target).
    return '<div class="finder-compare-wrap"><table class="finder-compare"><thead><tr><th></th>' + t.names.map(n => '<th scope="col">' + esc(n) + '</th>').join('') + '</tr></thead><tbody>' +
      t.rows.map(r => '<tr><th scope="row">' + esc(r[0]) + '</th>' + r.slice(1).map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function renderBar() {
    const bar = S.el.bar; if (!bar) return;
    bar.textContent = '';
    (S.thread.parts || []).forEach((p, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'finder-token'; b.dataset.part = String(k);
      b.textContent = (p.label || p.text || '') + ' ✕'; b.setAttribute('aria-label', 'Remove ' + (p.label || p.text || ''));
      bar.appendChild(b);
    });
  }
  function chipSet(id) {
    const L = S.lex || {};
    const mk = (c, next) => ({ label: c.label, kind: c.surprise ? 'surprise' : 'chip', data: c, next });
    if (id === 'opening') return lexChips('occasion').map(c => mk(c, 'vibe')).concat((L.moods || []).map(c => mk(c, 'vibe')), [{ label: T.nameChip, kind: 'name' }, { label: T.skip, kind: 'skip', next: 'vibe' }]);
    if (id === 'vibe') return lexChips('vibe').map(c => mk(c, 'budget')).concat([{ label: T.skip, kind: 'skip', next: 'budget' }]);
    if (id === 'budget') return lexChips('budget').map(c => mk(c, 'who')).concat([{ label: T.skip, kind: 'skip', next: 'who' }]);
    if (id === 'who') return lexChips('who').map(c => mk(c, 'answer')).concat([{ label: T.skip, kind: 'skip', next: 'answer' }]);
    if (id === 'name') return [{ label: T.skip, kind: 'skip', next: 'vibe' }];
    if (id === 'follow') {
      const n = S.thread.lastIds.length, out = [];
      ['more', 'cheaper', 'stronger', 'fresher', 'sweeter', 'brands'].forEach(op => out.push({ label: T.follow[op], kind: 'follow', op }));
      for (let i = 0; i < Math.min(3, n); i++) out.push({ label: fill(T.follow.like, { n: i + 1 }), kind: 'follow', op: 'like', n: i });
      if (n >= 2) out.push({ label: T.follow.compare, kind: 'follow', op: 'compare' });
      out.push({ label: T.follow.reset, kind: 'follow', op: 'reset' });
      return out;
    }
    return [];
  }
  function setChips(id) {
    S.thread.chips = id; S.chips = chipSet(id);
    const box = S.el.chips; if (!box) return;
    box.textContent = '';
    S.chips.forEach((c, k) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (c.kind === 'name' ? ' chip-primary' : ''); b.dataset.chip = String(k); b.textContent = c.label; box.appendChild(b); });
    // Screen readers hear the question from the (live) thread; this sr-only status says the buttons changed too.
    if (S.el.status) S.el.status.textContent = S.chips.length ? fill(T.status, { n: S.chips.length }) : '';
  }
  function waHref() {
    const th = S.thread, model = S.model;
    let num = WA_FALLBACK;
    try { const s = window.__SETTINGS__; const n = s && s.contact && s.contact.whatsapp; if (n) num = String(n).replace(/[^0-9]/g, '') || WA_FALLBACK; } catch (e) {}
    const lines = [T.waIntro];
    (th.lastIds || []).forEach((id, i) => { const it = model && model.byId.get(id); if (it) lines.push((i + 1) + '. ' + it.nm + ' (' + (model.vocab.b[it.b] || '') + ') — from ৳' + it.p); });
    const cons = (th.parts || []).map(p => p.label).filter(Boolean);
    if (cons.length) lines.push(T.waLooking + cons.join(', '));
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(lines.join('\n'));
  }
  function renderFoot() {
    const th = S.thread; let foot = S.el.thread.querySelector('.finder-foot');
    if (!th.lastIds.length) { if (foot) foot.remove(); return; }
    if (!foot) { foot = document.createElement('p'); foot.className = 'finder-foot'; }
    foot.innerHTML = '<a class="finder-wa" href="' + esc(waHref()) + '" target="_blank" rel="noopener">' + esc(T.whatsapp) + '</a>';
    S.el.thread.appendChild(foot);
  }
  function shareUrl() {
    try {
      const q = (S.thread.parts || []).map(p => p.text).filter(Boolean).join(', ');
      const url = location.pathname + (q ? '?q=' + encodeURIComponent(q).replace(/%20/g, '+') : '');
      history.replaceState({ nawmeFinder: 1 }, '', url);
    } catch (e) {}
  }
  function renderAll() {
    S.el.thread.textContent = '';
    S.thread.turns.forEach(t => renderTurn(t, false));
    renderBar(); setChips(S.thread.chips); renderFoot();
  }
  function renderUnavailable() {
    appendMsg(msgEl('bot', '<p>' + esc(T.unavailable) + ' <a href="shop.html">' + esc(T.browseAll) + '</a></p>'));
    setChips('none');
  }
  function addUserTurn(text) { const t = { role: 'user', text }; S.thread.turns.push(t); renderTurn(t, false); }
  function botText(text) { const t = { role: 'bot', text }; S.thread.turns.push(t); renderTurn(t, true); }

  // ── the conversation ──
  function renderOpening() { botText(T.opening); setChips('opening'); save(); }
  function advance(next) {
    if (next === 'answer') runAnswer({ mode: 'answer' });
    else { botText(T[STEP_ASK[next]] || T.askVibe); setChips(next); save(); }
  }
  function onChip(c) {
    const th = S.thread;
    if (c.kind === 'chip' || c.kind === 'surprise') {
      addUserTurn(c.label);
      const part = c.kind === 'surprise' ? surprisePart(th.turns.length, S.lex, S.model) : chipPart(c.data, S.model);
      if (part) addParts([part]);
      prepare();
      advance(c.next);
    } else if (c.kind === 'skip') { addUserTurn(T.skip); th.awaitName = false; advance(c.next); }
    else if (c.kind === 'name') { addUserTurn(c.label); th.awaitName = true; botText(T.askName); setChips('name'); prepare(); save(); }
    else if (c.kind === 'follow') followUp(c.op, c.n);
  }
  function onSubmit(raw) {
    const text = String(raw || '').trim().slice(0, 200); if (!text) return;
    const th = S.thread;
    addUserTurn(text);
    prepare().then(model => {
      let t = text;
      if (th.awaitName && model && !hasTrigger(t, S.lex, model)) t = 'like ' + t;
      th.awaitName = false;
      runAnswer({ mode: 'text', text: t });
    });
  }
  const lastBrands = model => { const out = []; S.thread.renderedIds.forEach(id => { const it = model.byId.get(id); const b = it && model.vocab.b[it.b]; if (b && out.indexOf(b) < 0) out.push(b); }); return out; };
  const median = arr => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
  function referenceFor(model, q, forCheaper) {
    const th = S.thread;
    if (q.anchor && q.anchor.kind === 'catalog') { const it = model.byId.get(q.anchor.id); if (it) return it.p; }
    const last = th.lastIds.map(id => model.byId.get(id)).filter(Boolean).map(it => it.p);
    if (!last.length) return null;
    return forCheaper ? median(last) : last[0];
  }
  function runAnswer(req) {
    const th = S.thread;
    return prepare().then(model => {
      if (!model) { renderUnavailable(); return; }
      const notes = [];
      let parsed = null;
      if (req.text != null) {
        parsed = parse(req.text, S.lex, model, { lastBrands: lastBrands(model), refPrice: null });
        if (parsed.parts.length) addParts(parsed.parts);
        if (!parsed.parts.length) {
          const words = parsed.unknown.join(', ');
          if (parsed.unknownAnchor && !th.parts.length) { botText(T.unknownAnchorOnly); save(); return; }
          // Nothing usable yet: echo the unknown words, or (only stop-words: "thanks", "different brands" before any answer) say so.
          if (!parsed.unknownAnchor && !th.parts.length) { botText(words ? fill(T.notUnderstood, { words }) : T.nothingNew); save(); return; }
          // After an answer, a message with no new constraint and no unknown words changes nothing: no re-answer.
          if (!parsed.unknownAnchor && !words && th.lastIds.length) { botText(T.nothingNew); setChips('follow'); save(); return; }
          // Chips so far + a throw-away text → answer from the chips (with the honest note when words were unknown).
          if (parsed.unknownAnchor) notes.push(T.unknownAnchor); else if (words) notes.push(fill(T.notUnderstoodAnswer, { words }));
        } else if (parsed.unknownAnchor) notes.push(T.unknownAnchor);
      }
      let q = th.query = compose(th.parts);
      // Relational "cheaper": pin the reference price into the part so the token and the share URL carry it.
      if (q.cheaper && q.refPrice == null) {
        const R = referenceFor(model, q, true);
        const cp = th.parts.find(p => p.cheaper);
        if (R != null) { cp.refPrice = R; cp.label = T.tokenPrefix.cheaper + R; cp.text = 'under ' + R; }
        else { delete cp.cheaper; cp.maxPrice = CHEAP_DEFAULT; Object.assign(cp, priceText(null, CHEAP_DEFAULT)); }
        q = th.query = compose(th.parts); renderBar();
      }
      const refPrice = q.cheaper ? q.refPrice : referenceFor(model, q, false);
      const res = answer(model, q, { exclude: th.renderedIds, referencePrice: refPrice, signals: readSignals(), limit: ANSWER_SIZE });
      if (res.relaxed.indexOf('cheaper') >= 0) {
        const k = th.parts.findIndex(p => p.cheaper); if (k >= 0) removePart(k);
        th.query = compose(th.parts);
        if (req.mode === 'cheaper' && th.lastIds.length) { botText(T.noCheaper); setChips('follow'); th.pending = []; save(); shareUrl(); return; }
        notes.push(T.noCheaper);
      }
      const other = res.relaxed.filter(s => s !== 'cheaper');
      if (other.length) notes.push(fill(T.relaxed, { what: joinAnd(other.map(s => T['relax' + cap(s)])) }));
      if (!res.picks.length) { botText(T.noMore); setChips('follow'); th.pending = []; save(); return; }
      // Reply text
      let text = T.answer;
      const a = q.anchor;
      if (req.mode === 'cheaper' && q.cheaper) text = fill(T.cheaper, { price: q.refPrice });
      else if (req.mode === 'more' && !a) text = T.more;
      else if (a && a.kind === 'catalog') { const ai = model.byId.get(a.id); text = fill(ai && ai.i && th.renderedIds.indexOf(a.id) < 0 ? T.anchorStocked : T.anchorCatalog, { name: a.name }); }
      else if (a && a.kind === 'ref') text = fill(T.anchorRef, { name: a.name });
      // Notes for constraints added since the last answer (never repeated).
      th.pending.forEach(p => {
        if (p.note === 'unisex' && notes.indexOf(T.unisexNote) < 0) notes.push(T.unisexNote);
        if (p.strength === 'stronger' && notes.indexOf(T.strongerNote) < 0) notes.push(T.strongerNote);
        if (p.strength === 'softer' && notes.indexOf(T.softerNote) < 0) notes.push(T.softerNote);
        if (p.collection === 'exclusive' && notes.indexOf(T.exclusiveNote) < 0) notes.push(T.exclusiveNote);
      });
      th.pending = [];
      const ids = res.picks.map(r => r.id);
      res.picks.forEach(r => { th.cards[r.id] = { c: toCard(r.item, model), e: r.item.c === 'e' }; });
      const turn = { role: 'bot', text, notes, ids, reasons: res.picks.map(r => reasons(r, q, model, a)), mode: req.mode || 'answer' };
      th.turns.push(turn);
      ids.forEach(id => { if (th.renderedIds.indexOf(id) < 0) th.renderedIds.push(id); });
      th.lastIds = ids;
      renderTurn(turn, true);
      setChips('follow'); renderFoot(); shareUrl(); save();
    });
  }
  function followUp(op, n) {
    const th = S.thread;
    if (op === 'reset') { reset(); return; }
    addUserTurn(op === 'like' ? fill(T.follow.like, { n: n + 1 }) : T.follow[op]);
    if (op === 'more') runAnswer({ mode: 'more' });
    else if (op === 'cheaper') runAnswer({ mode: 'cheaper', text: 'cheaper' });
    else if (op === 'stronger') runAnswer({ mode: 'answer', text: 'stronger' });
    else if (op === 'fresher') runAnswer({ mode: 'answer', text: 'fresh' });
    else if (op === 'sweeter') runAnswer({ mode: 'answer', text: 'sweet' });
    else if (op === 'brands') runAnswer({ mode: 'answer', text: 'different brands' });
    else if (op === 'like') {
      prepare().then(model => {
        const id = th.lastIds[n], it = model && model.byId.get(id);
        if (!it) { runAnswer({ mode: 'answer' }); return; }
        addParts([anchorPart({ kind: 'catalog', id, name: it.nm })]);
        runAnswer({ mode: 'answer' });
      });
    } else if (op === 'compare') {
      prepare().then(model => {
        if (!model) { renderUnavailable(); return; }
        if (th.lastIds.length < 2) { botText(T.compareNeed); save(); return; }
        const turn = { role: 'bot', text: T.compare, table: compareRows(th.lastIds.slice(0, 2), model), mode: 'compare' };
        th.turns.push(turn); renderTurn(turn, true); setChips('follow'); save();
      });
    }
  }
  function reset() {
    clearStored();
    S.thread = freshThread();
    S.el.thread.textContent = ''; renderBar();
    try { history.replaceState({ nawmeFinder: 1 }, '', location.pathname); } catch (e) {}
    renderOpening();
    clearStored();   // the fresh opening is what a reload shows anyway; keep sessionStorage empty after "Start over"
  }
  function restore() {
    let params = null;
    try { params = new URLSearchParams(location.search); } catch (e) {}
    const q = params && params.get('q'), like = params && params.get('like');
    const st = loadStored();
    // A shared link (?q= / ?like=) wins over a stored thread; our own replaceState
    // URL (history.state marker, kept across reload / back) restores the thread.
    let own = false; try { own = !!(history.state && history.state.nawmeFinder); } catch (e) {}
    if ((q || like) && !(own && st)) {
      clearStored(); S.thread = freshThread();
      const text = (like ? 'like ' + like + (q ? ', ' + q : '') : q).slice(0, 200);
      // Shared link: the answer arrives after a fetch, so nothing inside #finder
      // is painted until it is ready (chips/form hidden, height reserved) and the
      // whole thread lands in one paint — no painted element gets pushed (CLS 0).
      // The reserved height goes on the first click/keypress (input-excluded).
      const root = S.el.root; root.classList.add('finder-pending', 'finder-reserve');
      const reveal = () => root.classList.remove('finder-pending');
      const unreserve = () => root.classList.remove('finder-reserve');
      ['click', 'keydown'].forEach(ev => document.addEventListener(ev, unreserve, { once: true, capture: true }));
      prepare().then(() => { botText(T.opening); addUserTurn(text); return runAnswer({ mode: 'text', text }); }).then(reveal, reveal);
      return;
    }
    if (st) { S.thread = st; renderAll(); return; }
    S.thread = freshThread();
    renderOpening();
  }
  function wire() {
    S.el = { root: el('finder'), bar: el('finder-bar'), thread: el('finder-thread'), chips: el('finder-chips'), form: el('finder-form'), input: el('finder-input'), status: null };
    if (!S.el.root || !S.el.thread) return;
    // sr-only status line for quick-reply changes (absolutely positioned: no layout impact)
    if (S.el.chips) { const st = document.createElement('p'); st.className = 'sr-only'; st.setAttribute('role', 'status'); S.el.chips.parentNode.insertBefore(st, S.el.chips.nextSibling); S.el.status = st; }
    S.lex = (typeof window !== 'undefined' && window.FinderLexicon) || {};
    REFS = S.lex.refs || [];
    if (S.el.chips) S.el.chips.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('button[data-chip]') : null; if (!b) return;
      const c = S.chips[Number(b.dataset.chip)]; if (c) onChip(c);
    });
    if (S.el.bar) S.el.bar.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('button[data-part]') : null; if (!b) return;
      const k = Number(b.dataset.part); if (!(k >= 0 && k < S.thread.parts.length)) return;
      const label = S.thread.parts[k].label || S.thread.parts[k].text;
      removePart(k);
      if (S.thread.lastIds.length) { addUserTurn('Remove: ' + label); runAnswer({ mode: 'answer' }); } else save();
    });
    if (S.el.form) S.el.form.addEventListener('submit', e => {
      e.preventDefault();
      const v = S.el.input ? S.el.input.value : ''; if (S.el.input) S.el.input.value = '';
      onSubmit(v);
    });
    restore();
  }
  function _init(scriptEl) {
    try {
      S.url = (scriptEl && scriptEl.dataset && scriptEl.dataset.finder) || '';
      // The card renderer's Add to Cart calls a global handleAdd (js/shop.js L7-14); this page does not load shop.js.
      if (typeof handleAdd === 'undefined') {
        window.handleAdd = function handleAdd(id, isExclusive) {
          const card = document.querySelector('.product-card[data-id="' + id + '"]');
          const pill = document.querySelector('#size-' + id + ' .size-pill.active');
          if (!card || !pill) return;
          const name = card.querySelector('.card-name').textContent.trim();
          const sizes = [...document.querySelectorAll('#size-' + id + ' .size-pill')].map(b => ({ ml: Number(b.dataset.ml), price: Number(b.dataset.price) }));
          addToCart(id, pill.dataset.ml, pill.dataset.price, name, card.dataset.brand, isExclusive, sizes);
        };
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true }); else wire();
    } catch (e) { /* the finder is optional; the page keeps its static intro + shop link */ }
  }

  return { T, WEIGHTS, EVENT_W, MIN_COS, BRAND_CAP, ANSWER_SIZE, CHEAP_DEFAULT, normalize, lev, parse, hasTrigger, mergeQuery, emptyQuery, compose, fromChip, chipPart, surprisePart, prepareData, vectorize, queryVector, buildQueryVec, buildProfile, cosine, readSignals, rank, answer, reasons, toCard, setRefs: r => { REFS = r || []; }, _state: S, _init };
});
