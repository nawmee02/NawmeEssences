// ============================================================
//  product-faq.js — the ONE place the product page's standard
//  Q&A is generated. Used by the build (scripts/generate-product-
//  pages.js, via require) AND by the admin dashboard (as
//  window.ProductFaq) so the admin can preview exactly what the
//  page will say and customise or hide any question.
//
//  Pure functions, no DOM, no network. Every answer is derived from
//  the product's own data; a question is skipped when its data is
//  missing. Nothing is invented.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProductFaq = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CONCENTRATION_LABEL = {
    'EDP': 'Eau de Parfum (EDP)', 'EDT': 'Eau de Toilette (EDT)', 'EDC': 'Eau de Cologne (EDC)',
    'Parfum': 'Parfum', 'Extrait': 'Extrait de Parfum', 'Elixir': 'Elixir',
    'Parfum Intense': 'Parfum Intense', 'Attar/Oil': 'Attar / perfume oil',
  };
  const GENDER_LABEL = { men: 'Men', women: 'Women', unisex: 'Unisex' };

  // Any concentration text is allowed (migration 017). Known codes get their
  // full label; otherwise EDP/EDT/EDC inside the text are expanded and the
  // original kept in brackets, e.g. "EDP Intense" → "Eau de Parfum Intense (EDP Intense)".
  function concentrationLabel(raw) {
    const s = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    const known = Object.keys(CONCENTRATION_LABEL).find(k => k.toLowerCase() === s.toLowerCase());
    if (known) return CONCENTRATION_LABEL[known];
    const expanded = s.replace(/\bEDP\b/gi, 'Eau de Parfum').replace(/\bEDT\b/gi, 'Eau de Toilette').replace(/\bEDC\b/gi, 'Eau de Cologne');
    return expanded.toLowerCase() === s.toLowerCase() ? s : `${expanded} (${s})`;
  }

  // Same rule as lib/render-card.js and js/api.js.
  function effectivePrice(price, sp) { return sp > 0 ? Math.round(price * (100 - sp) / 100) : price; }

  // Occasion inference from accords (used when the admin ticked none).
  const OCCASION_RULES = {
    'Office':      ['Fresh', 'Aquatic', 'Citrus', 'Green', 'Aromatic', 'Marine', 'Tea', 'Powdery'],
    'Gym / Sport': ['Fresh', 'Aquatic', 'Citrus', 'Marine', 'Green'],
    'Date Night':  ['Sweet', 'Oriental', 'Gourmand', 'Vanilla', 'Leather', 'Oud', 'Honey', 'Boozy', 'Tobacco', 'Amber'],
    'Party':       ['Spicy', 'Oriental', 'Fruity', 'Gourmand', 'Smoky', 'Dark', 'Intense', 'Leather'],
    'Everyday':    ['Woody', 'Aromatic', 'Floral', 'Fruity', 'Powdery', 'Fresh'],
  };
  function occasionsFor(accords) {
    if (!accords || !accords.length) return ['Everyday'];
    const set = new Set();
    for (const occ of Object.keys(OCCASION_RULES)) if (accords.some(a => OCCASION_RULES[occ].includes(a))) set.add(occ);
    if (!set.size) set.add('Everyday');
    return [...set].slice(0, 4);
  }

  // Price-dependent answers. Kept as plain named functions (no closures over
  // module state except effectivePrice) because the product page inlines their
  // source via Function.toString() to re-render these answers from live prices.
  function priceList(sizes, sp) {
    return (sizes || []).filter(function (s) { return s && s.ml && s.price; })
      .sort(function (a, b) { return a.ml - b.ml; })
      .map(function (s) { return s.ml + 'ml ৳' + effectivePrice(s.price, sp); }).join(', ');
  }
  function costAnswer(sizes, sp) {
    var list = priceList(sizes, sp);
    return list ? 'NawmeEssences decant prices: ' + list + '. Prices are fixed; delivery is charged separately.' : '';
  }
  function sizeAnswer(sizes) {
    var mls = (sizes || []).filter(function (s) { return s && s.ml && s.price; }).map(function (s) { return s.ml; });
    if (!mls.length) return '';
    var smallest = Math.min.apply(null, mls);
    return 'Start with the ' + smallest + 'ml decant (roughly ' + Math.round(smallest * 12) + '–' + Math.round(smallest * 15) + ' sprays) to test it across several wears. Move up to 5ml or 10ml once you know you like it.';
  }

  const normQ = q => String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const clean = a => (Array.isArray(a) ? a.map(x => String(x).trim().replace(/[.;,]+$/, '')).filter(Boolean) : []);
  const join = a => clean(a).join(', ');
  const article = w => (/^[aeiou]/i.test(w) ? 'an' : 'a');

  // p: { name, brand, sizes:[{ml,price}], salePercent, family, top, heart, base,
  //      accords, occasions, gender ('men'|'women'|'unisex'|''), concentration (code) }
  // opts: { delivery:{dhaka,suburb,outside}, pickupText:'Aftabnagar and Banasree' }
  function standardFaq(p, opts) {
    opts = opts || {};
    const sp = Number(p.salePercent) || 0;
    const sizes = [...(p.sizes || [])].filter(s => s && s.ml && s.price).sort((a, b) => a.ml - b.ml);
    const out = [];
    const family = p.family ? String(p.family).trim() : '';
    const top = join(p.top), heart = join(p.heart), base = join(p.base);
    if (family || top) {
      let a = family ? `${p.name} is ${article(family)} ${family.toLowerCase()} fragrance by ${p.brand}.` : `${p.name} is by ${p.brand}.`;
      if (top) a += ` It opens with ${top}`;
      if (heart) a += `${top ? ',' : ' It'} moves into ${heart}`;
      if (base) a += `${top || heart ? ', and' : ' It'} settles on ${base}`;
      if (top || heart || base) a += '.';
      out.push({ key: 'smell', q: `What does ${p.name} smell like?`, a });
    }
    const occ = clean(p.occasions).length ? clean(p.occasions) : occasionsFor(clean(p.accords));
    if (occ.length) out.push({ key: 'wear', q: `When is ${p.name} best to wear?`, a: `Best suited to ${occ.join(', ').toLowerCase()} wear.` });
    const gender = GENDER_LABEL[String(p.gender || '').toLowerCase()];
    if (gender) out.push({ key: 'who', q: `Who is ${p.name} for?`, a: gender === 'Unisex' ? `${p.name} is unisex — worn by both men and women.` : `${p.name} is marketed for ${gender.toLowerCase()}.` });
    const conc = concentrationLabel(p.concentration);
    if (conc) out.push({ key: 'concentration', q: `What concentration is ${p.name}?`, a: `This decant is ${conc}, taken from the original ${conc.replace(/\s*\(.*\)$/, '')} bottle.` });
    if (sizes.length) {
      out.push({ key: 'cost', q: `How much does a ${p.name} decant cost in Bangladesh?`, a: costAnswer(sizes, sp) });
      out.push({ key: 'size', q: 'Which decant size should I start with?', a: sizeAnswer(sizes) });
    }
    out.push({ key: 'original', q: `Is this an original ${p.name} decant?`, a: `Yes. Every NawmeEssences decant is drawn from an authentic original bottle with a syringe into a clean glass atomiser — never diluted, mixed or altered.` });
    const r = Object.assign({ dhaka: 70, suburb: 90, outside: 120 }, opts.delivery || {});
    const pickup = opts.pickupText || 'Aftabnagar and Banasree';
    out.push({ key: 'delivery', q: 'What is the delivery charge in Bangladesh?', a: `৳${r.dhaka} inside Dhaka (1–2 days), ৳${r.suburb} in the Dhaka suburbs, ৳${r.outside} anywhere else in Bangladesh (2–3 days). Pickup is available at ${pickup}. The advance to confirm an order is the delivery charge.` });
    return out;
  }

  // Admin entries (fragrance_details.faq): same question text → replaces the
  // standard answer; answer "-" → hides it; anything else → appended.
  function mergeFaq(standard, admin) {
    const out = standard.map(x => ({ q: x.q, a: x.a, key: x.key }));
    const byNorm = new Map(out.map(x => [normQ(x.q), x]));
    for (const x of (admin || []).filter(x => x && x.q && x.a)) {
      const key = normQ(x.q), hide = String(x.a).trim() === '-';
      if (byNorm.has(key)) {
        const i = out.indexOf(byNorm.get(key));
        if (hide) out.splice(i, 1); else out[i] = { q: x.q, a: x.a, key: 'custom' };
        byNorm.delete(key);
      } else if (!hide) out.push({ q: x.q, a: x.a, key: 'custom' });
    }
    return out;
  }

  return { CONCENTRATION_LABEL, concentrationLabel, GENDER_LABEL, OCCASION_RULES, priceList, costAnswer, sizeAnswer, occasionsFor, effectivePrice, normQ, standardFaq, mergeFaq };
});
