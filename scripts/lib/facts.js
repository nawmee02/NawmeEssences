// ============================================================
//  facts.js — the ONE source of truth for the catalogue numbers
//  quoted in prose ("100+ fragrances", "35+ brands"). The build
//  sets them from the live Supabase catalogue; every consumer
//  (Organization schema, root-page meta/OG text, trust bar,
//  llms.txt) reads them from here, so the site, its structured
//  data and its AI-facing files can never disagree again.
//
//  Labels round DOWN to a marketing step so they stay truthful as
//  the catalogue moves: 100–109 products → "100+", 36 brands → "35+".
// ============================================================
let facts = { fragrances: 100, brands: 35 };   // fallback only; build overrides

function setCatalogFacts({ fragrances, brands }) {
  if (Number.isFinite(fragrances) && fragrances > 0) facts.fragrances = fragrances;
  if (Number.isFinite(brands) && brands > 0) facts.brands = brands;
  return { ...facts };
}
function getCatalogFacts() { return { ...facts }; }

const floorTo = (n, step) => Math.max(step, Math.floor(n / step) * step);
function fragranceLabel() { return `${floorTo(facts.fragrances, 10)}+`; }
function brandLabel()     { return `${floorTo(facts.brands, 5)}+`; }

// Rewrite any "NN+ fragrances" / "NN+ brands" style phrase in a text blob to
// the current labels. Deliberately narrow: a 2–3 digit number, a "+", then a
// known noun (optionally with one adjective), so prices ("৳3,000+"), sizes
// ("30ml") and percentages ("100%") are never touched. Idempotent.
const FRAG_RE  = /\b\d{2,3}\+(?=\s*(?:premium |authentic |regular |luxury |original )?(?:fragrances|Fragrances|FRAGRANCES|perfumes|scents|perfume decants|decants))/g;
const BRAND_RE = /\b\d{2,3}\+(?=\s*(?:brands|Brands|BRANDS))/g;
function applyCountPhrases(text) {
  return text.replace(FRAG_RE, fragranceLabel()).replace(BRAND_RE, brandLabel());
}

module.exports = { setCatalogFacts, getCatalogFacts, fragranceLabel, brandLabel, applyCountPhrases };
