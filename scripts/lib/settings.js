// ============================================================
//  settings.js — the site's editable non-product content.
//  One JSON blob in Supabase (site_settings, id=1) drives the
//  announcement bar, contact/payment/delivery info, hero copy,
//  stats, and homepage meta.
//
//  DEFAULTS mirror the seed in migration 007 so the build works
//  even before the migration runs (or if the fetch fails): a
//  missing table/row/key falls back to the baked-in current copy.
// ============================================================

// Keep in sync with 007_site_settings.sql's seed.
const DEFAULTS = {
  announcements: [
    '🚚 Delivery ৳70 Dhaka · ৳90 Suburb · ৳120 Outside',
    '✅ 100% Authentic — Decanted from personal collection',
    '📍 Pickup: Aftabnagar · Banasree · NSU',
    '💬 WhatsApp & Messenger support available',
    '💳 Min. advance = delivery charge · 30% advance for orders above ৳2000',
  ],
  contact: {
    whatsapp: '8801988536843',
    instagram: 'https://instagram.com/_nawmeessences_',
    facebook: 'https://facebook.com/NawmeEssences',
  },
  payment: {
    bkash: '',
    nagad: '',
    advanceNote: 'Min. advance = delivery charge · 30% advance for orders above ৳2000',
  },
  delivery: {
    dhaka: 70,
    suburb: 90,
    outside: 120,
    pickupPoints: ['Aftabnagar', 'Banasree', 'NSU'],
  },
  hero: {
    eyebrow: 'Your Signature Scent · Starts Here ·',
    title: 'Authentic Perfume Decants in Bangladesh',
    subtitle: 'Choose from 90+ premium fragrances in sizes from 3ml to 30ml, all decanted from authentic original bottles.',
  },
  stats: [
    { target: 2000, suffix: '+', label: 'Orders Delivered' },
    { target: 90, suffix: '+', label: 'Fragrances' },
    { target: 30, suffix: '+', label: 'Brands' },
    { target: 100, suffix: '%', label: 'Authentic' },
  ],
  trustBar: [
    '100% Authentic',
    '90+ Fragrances',
    'Sizes: 3ml · 5ml · 10ml · 15ml',
    'Pickup: Aftabnagar · Banasree · NSU',
    'Dhaka ৳70 · Suburb ৳90 · Outside ৳120',
    'WhatsApp Orders',
    'Prices Fixed & Fair',
  ],
  meta: {
    homeTitle: 'NawmeEssences — Luxury Fragrance Decants in Bangladesh',
    homeDescription: 'Authentic luxury perfume decants in Bangladesh. Shop Rasasi, JPG, Hugo Boss, Armaf, and more. 3ml, 5ml, 10ml, 15ml sizes. Free delivery info inside.',
  },
  homeSections: {
    howToOrder: [
      { title: 'Choose Your Fragrance', text: 'Select your favorite fragrance and preferred size (3ml–30ml).' },
      { title: 'Place Your Order', text: 'Add items to your cart and complete checkout with your contact and delivery details.' },
      { title: 'Confirm with Advance', text: 'Pay the required advance via bKash, Nagad, or Bank Transfer.' },
      { title: 'Receive or Collect', text: 'Enjoy nationwide delivery or collect your order from Aftabnagar, Banasree, or NSU.' },
    ],
    faq: [
      { q: 'What is a perfume decant?', a: 'A perfume decant is a smaller quantity of fragrance transferred from an authentic original bottle into a travel-sized atomizer.' },
      { q: 'Are your perfumes authentic?', a: 'Yes. Every decant is taken directly from authentic original bottles. We never dilute, mix, or alter the fragrance.' },
      { q: 'Why buy a decant instead of a full bottle?', a: 'Decants let you experience premium fragrances at a lower cost before investing in a full-size bottle.' },
      { q: 'What sizes do you offer?', a: 'We offer 3ml, 5ml, 10ml, 15ml, and selected fragrances in 30ml.' },
      { q: 'How are decants measured?', a: "We use sterile syringes to ensure accurate volume and maintain the fragrance's quality." },
      { q: 'How long does delivery take?', a: 'Orders are typically delivered within 1–2 business days in Dhaka and 2–3 business days outside Dhaka.' },
      { q: 'Can I return or exchange my order?', a: 'Opened or used decants cannot be returned. If you receive a damaged, missing, or incorrect item, contact us within 24 hours with a continuous unboxing video.' },
      { q: 'Where can I collect my order?', a: 'Self-pickup is available from Aftabnagar, Banasree, and NSU by prior arrangement.' },
      { q: 'How can I contact you?', a: 'The fastest way is through WhatsApp. You can also reach us via Messenger or Facebook.' },
    ],
  },
};

// Deep-merge `over` onto a clone of `base`. Objects merge key-by-key; arrays and
// scalars replace wholesale (so an edited announcements list wins entirely, and a
// missing key keeps the default). Mirrors the client merge in js/settings.js.
function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? base : over;
  if (base && typeof base === 'object' && over && typeof over === 'object') {
    const out = { ...base };
    for (const k of Object.keys(over)) out[k] = deepMerge(base[k], over[k]);
    return out;
  }
  return over === undefined ? base : over;
}

// Fetch the settings row and merge it over DEFAULTS. Never throws — a missing
// table (migration not run yet) or any error degrades to DEFAULTS so the build
// keeps producing the current copy.
async function fetchSettings(sb) {
  try {
    const { data, error } = await sb.from('site_settings').select('data').eq('id', 1).single();
    if (error || !data || !data.data) return { ...DEFAULTS };
    return deepMerge(DEFAULTS, data.data);
  } catch {
    return { ...DEFAULTS };
  }
}

module.exports = { DEFAULTS, deepMerge, fetchSettings };
