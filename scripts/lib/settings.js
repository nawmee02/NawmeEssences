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
    whatsapp: '8801738221686',
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
    subtitle: 'Choose from 80+ premium fragrances in sizes from 3ml to 30ml, all decanted from authentic original bottles.',
  },
  stats: [
    { target: 2000, suffix: '+', label: 'Orders Delivered' },
    { target: 80, suffix: '+', label: 'Fragrances' },
    { target: 30, suffix: '+', label: 'Brands' },
    { target: 100, suffix: '%', label: 'Authentic' },
  ],
  meta: {
    homeTitle: 'NawmeEssences — Luxury Fragrance Decants in Bangladesh',
    homeDescription: 'Authentic luxury perfume decants in Bangladesh. Shop Rasasi, JPG, Hugo Boss, Armaf, and more. 3ml, 5ml, 10ml, 15ml sizes. Free delivery info inside.',
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
