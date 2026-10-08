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

// ── Pickup points ─────────────────────────────────────────────
// The canonical list. Schema departments, the announcement ticker, settings
// fallbacks and the build-time text normaliser all derive from this array, so
// adding or dropping a location is a one-line change here.
const PICKUP_POINTS = [
  { name: 'Aftabnagar', locality: 'Aftabnagar, Dhaka' },
  { name: 'Banasree',   locality: 'Banasree, Dhaka' },
];
// Locations that were retired; the normaliser strips them from any prose that
// still lists them (admin text, older static pages, llms.txt, SKILL.md).
const RETIRED_PICKUP_POINTS = ['NSU (Bashundhara R/A)', 'NSU'];

const pickupNames = () => PICKUP_POINTS.map(p => p.name);
function pickupTicker() { return `Pickup: ${pickupNames().join(' · ')}`; }              // "Pickup: Aftabnagar · Banasree"
function pickupList(conj = 'and') {                                                     // "Aftabnagar and Banasree"
  const n = pickupNames(); return n.length > 1 ? `${n.slice(0, -1).join(', ')} ${conj} ${n[n.length - 1]}` : n[0];
}
function applyPickupPhrases(text) {
  let t = text;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const cur = pickupNames();
  for (const r of RETIRED_PICKUP_POINTS) {
    const R = esc(r);
    // "A · B · NSU"  → "A · B"
    t = t.replace(new RegExp(`(${cur.map(esc).join(' · ')}) · ${R}`, 'g'), '$1');
    // "A, B, and NSU" / "A, B, or NSU" / "A, B and NSU" → "A and B" / "A or B"
    t = t.replace(new RegExp(`${cur.map(esc).join(', ')},? (and|or) ${R}`, 'g'), (_, c) => pickupList(c));
    // "A, B, NSU" → "A, B"
    t = t.replace(new RegExp(`(${cur.map(esc).join(', ')}), ${R}`, 'g'), '$1');
  }
  return t;
}

// ── Delivery rates (BDT) ──────────────────────────────────────
// Set by the build from the admin site_settings.delivery block; consumed by the
// Offer shippingDetails on every product page so schema never disagrees with
// the policy page and ticker.
let delivery = { dhaka: 70, suburb: 90, outside: 120 };
function setDeliveryRates(d) {
  if (!d) return { ...delivery };
  for (const k of ['dhaka', 'suburb', 'outside']) { const n = Number(d[k]); if (Number.isFinite(n) && n >= 0) delivery[k] = n; }
  return { ...delivery };
}
function getDeliveryRates() { return { ...delivery }; }

// ── Announcement ticker ───────────────────────────────────────
// Set by the build from site_settings.announcements so every generated page
// bakes the SAME ticker the browser will hydrate (previously each template
// carried hard-coded defaults that flashed before js/settings.js replaced
// them). Falls back to the defaults in lib/settings.js when nothing is set.
let announcements = [];
function setAnnouncements(list) { announcements = Array.isArray(list) ? list.map(String).filter(Boolean) : []; return [...announcements]; }
function getAnnouncements() {
  if (announcements.length) return [...announcements];
  try { return [...require('./settings').DEFAULTS.announcements]; } catch (e) { return []; }
}
const escHtml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Doubled for the seamless -50% marquee loop (see .ticker-track).
function announcementSpans(indent = '    ') {
  const list = getAnnouncements();
  return [...list, ...list].map(a => `${indent}<span>${escHtml(a)}</span>`).join('\n');
}

module.exports = {
  setCatalogFacts, getCatalogFacts, fragranceLabel, brandLabel, applyCountPhrases,
  setDeliveryRates, getDeliveryRates,
  setAnnouncements, getAnnouncements, announcementSpans,
  PICKUP_POINTS, pickupNames, pickupTicker, pickupList, applyPickupPhrases,
};
