// ============================================================
//  schema.js — single source of truth for the site's schema.org
//  entity graph. Both the build (scripts/build-from-supabase.js,
//  for the static root pages) and the page generator
//  (scripts/generate-product-pages.js) emit JSON-LD from these
//  builders, so every page declares the SAME entities under the
//  same @id (one canonical Organization, Website, founder Person,
//  and per-brand Brand node) — no rich-node-vs-thin-stub drift.
//
//  Design rules (see plan): one canonical @id per real-world
//  entity; Brand nodes are our *representation of* an external
//  brand (never an ownership claim); no fabricated ratings; the
//  entity graph reflects only visible page content.
// ============================================================

const SITE = 'https://nawmeessences.com';
const { fragranceLabel, PICKUP_POINTS, getDeliveryRates } = require('./facts');

// WebMCP origin-trial token (feature "WebMCP", expires 2026-11-17). Enables
// document.modelContext on this origin in Chrome 150+ WITHOUT a user flag — so
// the WebMCP tools work for real agents and Lighthouse/PSI can score the
// Agentic-Browsing WebMCP audits. Renew at chrome.com/origintrials before expiry
// and replace this string (single source of truth for every page).
const ORIGIN_TRIAL_TOKEN = 'As57SiyvGZPH7BBw1u8A0T1emm7cXxA+fBx9zlMD/Tqb36viRUM8SJ0qGoW/3BBjtH4k52nUz/v7qpWMVX44xwUAAABkeyJvcmlnaW4iOiJodHRwczovL25hd21lZXNzZW5jZXMuY29tOjQ0MyIsImZlYXR1cmUiOiJXZWJNQ1AiLCJleHBpcnkiOjE3OTQ4NzM2MDAsImlzU3ViZG9tYWluIjp0cnVlfQ==';
function originTrialMeta() {
  return ORIGIN_TRIAL_TOKEN ? `<meta http-equiv="origin-trial" content="${ORIGIN_TRIAL_TOKEN}" />` : '';
}

// ─── Config: fill with real, verifiable URLs ─────────────────
// Base social handles already used across the site.
const BASE_SAMEAS = [
  'https://www.facebook.com/NawmeEssences',
  'https://www.instagram.com/_nawmeessences_',
  'https://wa.me/8801988536843',
];
// Google Business Profile / Maps listing URL — strong local KG signal. '' = none yet.
const GOOGLE_BUSINESS_PROFILE_URL = 'https://maps.app.goo.gl/TXQzzgoSDC9C2jR78';
// Extra public profiles (TikTok / YouTube / X / LinkedIn …). Add full URLs.
const EXTRA_SOCIALS = [
  'https://www.tiktok.com/@nawmeessences',
  'https://www.linkedin.com/company/nawmeessences',
  'https://x.com/nawmeessences',
];
// Per-brand external authority links (official site, Wikidata …), keyed by brand slug.
// Empty for now; extend as you verify links, e.g. { 'afnan': ['https://…', 'https://www.wikidata.org/wiki/Q…'] }.
const BRAND_SAMEAS = {};

// Organization.sameAs = base handles + GBP + extras (deduped, blanks dropped).
function orgSameAs() {
  return [...BASE_SAMEAS, GOOGLE_BUSINESS_PROFILE_URL, ...EXTRA_SOCIALS].filter(Boolean);
}

// A bare @id reference to an already-declared node.
function ref(id) {
  return { '@id': id.startsWith('http') ? id : `${SITE}/${id.replace(/^#/, '#')}` };
}

const ORG_ID = `${SITE}/#organization`;
const SITE_ID = `${SITE}/#website`;
const FOUNDER_ID = `${SITE}/#founder`;

// ─── Canonical entity nodes ──────────────────────────────────
// Deliberate type strategy: ["Organization","Store"] — an online store with
// pickup points (kept as `department` sub-nodes). LocalBusiness is intentionally
// NOT stacked here; add it only with genuine per-location address/geo/hours data.
function organizationNode() {
  return {
    '@type': ['Organization', 'Store'],
    '@id': ORG_ID,
    name: 'NawmeEssences',
    url: `${SITE}/`,
    logo: `${SITE}/images/logo.png`,
    image: `${SITE}/images/og-card.jpg`,
    // Count comes from lib/facts.js (set by the build from the live catalogue) so
    // schema, page copy and llms.txt always quote the same number.
    description: `Authentic luxury perfume decants. ${fragranceLabel()} fragrances in 3ml–30ml sizes. Delivery across Bangladesh.`,
    telephone: '+8801988536843',
    hasMap: GOOGLE_BUSINESS_PROFILE_URL,
    // Merchant-level return policy (Google associates it with every offer).
    hasMerchantReturnPolicy: merchantReturnPolicy(),
    sameAs: orgSameAs(),
    founder: { '@id': FOUNDER_ID },
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: '+8801988536843',
      contactType: 'customer service',
      availableLanguage: ['English', 'Bengali'],
    },
    areaServed: 'BD',
    priceRange: '৳150–৳3050',
    currenciesAccepted: 'BDT',
    paymentAccepted: 'Cash, bKash, Nagad',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Dhaka',
      addressRegion: 'Dhaka',
      addressCountry: 'BD',
    },
    department: PICKUP_POINTS.map(p => ({
      '@type': 'Store', name: `NawmeEssences Pickup — ${p.name}`,
      address: { '@type': 'PostalAddress', addressLocality: p.locality, addressCountry: 'BD' },
    })),
  };
}

function websiteNode() {
  return {
    '@type': 'WebSite',
    '@id': SITE_ID,
    url: `${SITE}/`,
    name: 'NawmeEssences',
    publisher: { '@id': ORG_ID },
    potentialAction: {
      '@type': 'SearchAction',
      target: `${SITE}/shop.html?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

const FOUNDER_NAME = 'Nawmee';

// Founder Person (public name "Nawmee"). Neutral wording — no assumed pronouns.
function founderNode() {
  return {
    '@type': 'Person',
    '@id': FOUNDER_ID,
    name: FOUNDER_NAME,
    image: `${SITE}/images/nawmee.jpg`,
    jobTitle: 'Founder',
    url: `${SITE}/about-me.html`,
    worksFor: { '@id': ORG_ID },
    // Entity anchors for the founder himself (the brand's socials live on the
    // Organization node). Add personal profiles here as they exist.
    sameAs: ['https://github.com/nawmee02'],
    knowsAbout: ['Perfume decants', 'Designer and niche fragrances', 'Middle Eastern perfumery'],
  };
}

// Minimal inline Person (id + name) for cross-page author refs so each page is
// self-valid; identity-critical `name` matches the full founderNode().
function founderInline() {
  return { '@type': 'Person', '@id': FOUNDER_ID, name: FOUNDER_NAME };
}

// Brand @id lives on the brand's hub page (its entity home on our domain).
function brandId(slug) { return `${SITE}/brands/${slug}/#brand`; }

// A Brand node: our representation of / page about an external brand — NOT an
// ownership claim. `sameAs` only when verifiably known (BRAND_SAMEAS).
// `logo` is the uploaded brand image when there is one. NOTE: verify-schema.js
// treats `logo` as an identity field, so every page declaring this @id must
// agree on it — which holds because the node is declared on the brand hub page
// only; everywhere else references the @id.
function brandNode(slug, name, logo) {
  const node = {
    '@type': 'Brand',
    '@id': brandId(slug),
    name,
    url: `${SITE}/brands/${slug}/`,
  };
  if (logo) node.logo = logo;
  const same = BRAND_SAMEAS[slug];
  if (Array.isArray(same) && same.length) node.sameAs = same;
  return node;
}

// FAQPage from the settings FAQ array [{q,a}]. Semantic/machine-readable
// enrichment — NOT an assumed Google rich-result feature.
function faqPageNode(faq) {
  const items = (Array.isArray(faq) ? faq : []).filter(f => f && f.q && f.a);
  if (!items.length) return null;
  return {
    '@type': 'FAQPage',
    '@id': `${SITE}/#faq`,
    mainEntity: items.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  };
}

// Wrap nodes into a single @graph <script>. Drops nulls and per-node @context.
function graphScript(...nodes) {
  const graph = nodes.filter(Boolean).map(n => { const { '@context': _c, ...rest } = n; return rest; });
  const json = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
  return `<script type="application/ld+json">${json}</script>`;
}


// ─── Merchant listing helpers (Google "merchant listing" rich results) ───
// Return policy mirrors about.html#refund exactly: no returns or exchanges on
// opened/used decants; verified damage/missing/wrong-item claims (reported
// within 24 h with an unboxing video) get a replacement or refund at no cost.
function merchantReturnPolicy() {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'BD',
    returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
    itemDefectReturnFees: 'https://schema.org/FreeReturn',
    itemDefectReturnLabelSource: 'https://schema.org/ReturnLabelCustomerResponsibility',
    merchantReturnLink: `${SITE}/about.html#refund`,
  };
}

// Shipping tiers from the admin delivery rates (lib/facts.js): Dhaka city and
// the rest of Bangladesh. The suburb tier has no region code Google can match,
// so it stays in prose on the policy page. Transit times match the FAQ.
function shippingDetails() {
  const r = getDeliveryRates();
  const tier = (rate, region, minT, maxT) => ({
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: rate, currency: 'BDT' },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: 'BD', ...(region ? { addressRegion: [region] } : {}) },
    deliveryTime: {
      '@type': 'ShippingDeliveryTime',
      handlingTime: { '@type': 'QuantitativeValue', minValue: 0, maxValue: 1, unitCode: 'DAY' },
      transitTime: { '@type': 'QuantitativeValue', minValue: minT, maxValue: maxT, unitCode: 'DAY' },
    },
  });
  return [tier(r.dhaka, 'Dhaka', 1, 2), tier(r.outside, null, 2, 3)];
}

module.exports = {
  SITE, ORG_ID, SITE_ID, FOUNDER_ID,
  merchantReturnPolicy, shippingDetails,
  ref, brandId,
  organizationNode, websiteNode, founderNode, founderInline, brandNode, faqPageNode,
  graphScript, originTrialMeta,
};
