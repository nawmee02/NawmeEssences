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

// WebMCP origin-trial token (feature "WebMCP", expires 2026-11-17). Enables
// document.modelContext on this origin in Chrome 150+ WITHOUT a user flag — so
// the WebMCP tools work for real agents and Lighthouse/PSI can score the
// Agentic-Browsing WebMCP audits. Renew at chrome.com/origintrials before expiry
// and replace this string (single source of truth for every page).
const ORIGIN_TRIAL_TOKEN = 'AgEogXN8DniVock4DWRQ/AZeu5OyUOE6gEfm6ZsTWfs60qZCIKB3fjdex9nx5YvosZE9ama4X7dEXCiXzXMeeAQAAABjeyJvcmlnaW4iOiJodHRwczovL25hd21lZXNzZW5jZXMubWU6NDQzIiwiZmVhdHVyZSI6IldlYk1DUCIsImV4cGlyeSI6MTc5NDg3MzYwMCwiaXNTdWJkb21haW4iOnRydWV9';
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
    description: 'Authentic luxury perfume decants. 90+ fragrances in 3ml–30ml sizes. Delivery across Bangladesh.',
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
    department: [
      { '@type': 'Store', name: 'NawmeEssences Pickup — Aftabnagar',
        address: { '@type': 'PostalAddress', addressLocality: 'Aftabnagar, Dhaka', addressCountry: 'BD' } },
      { '@type': 'Store', name: 'NawmeEssences Pickup — Banasree',
        address: { '@type': 'PostalAddress', addressLocality: 'Banasree, Dhaka', addressCountry: 'BD' } },
      { '@type': 'Store', name: 'NawmeEssences Pickup — NSU (Bashundhara R/A)',
        address: { '@type': 'PostalAddress', addressLocality: 'Bashundhara R/A, Dhaka', addressCountry: 'BD' } },
    ],
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
    worksFor: { '@id': ORG_ID },
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
function brandNode(slug, name) {
  const node = {
    '@type': 'Brand',
    '@id': brandId(slug),
    name,
    url: `${SITE}/brands/${slug}/`,
  };
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

module.exports = {
  SITE, ORG_ID, SITE_ID, FOUNDER_ID,
  ref, brandId,
  organizationNode, websiteNode, founderNode, founderInline, brandNode, faqPageNode,
  graphScript, originTrialMeta,
};
