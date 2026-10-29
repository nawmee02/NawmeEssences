// ============================================================
//  note-canon.js — one key per note/accord for the shop filters.
//  The catalogue spells the same note several ways ("Madagascar
//  Vanilla", "Bourbon Vanilla", "Vanilla."), so the Note filter
//  would miss products. Conservative on purpose:
//    1. drop a leading place of origin when something is left
//       ("Sicilian Bergamot" → bergamot, "Taif Rose" → rose)
//    2. a short list of obvious duplicates (ALIASES)
//  Genuinely different materials stay apart: Pink Pepper ≠ Pepper,
//  Violet Leaf ≠ Violet, Blood Orange ≠ Orange, Clary Sage ≠ Sage,
//  White Musk ≠ Musk. Search still uses the original names.
// ============================================================
const { norm } = require('./recs');

const ORIGINS = new Set([
  'amalfi', 'australian', 'bourbon', 'brazilian', 'bulgarian', 'calabrian', 'ceylon', 'chinese', 'egyptian',
  'florentine', 'french', 'grasse', 'guatemalan', 'haitian', 'indian', 'indonesian', 'italian', 'jamaican',
  'japanese', 'java', 'javanese', 'madagascar', 'mexican', 'moroccan', 'mysore', 'nigerian', 'paraguayan',
  'persian', 'sicilian', 'spanish', 'tahitian', 'taif', 'tunisian', 'turkish', 'tuscan', 'virginia',
]);

const ALIASES = {
  'agarwood': 'oud', 'agarwood oud': 'oud', 'oud wood': 'oud',
  'amber wood': 'amberwood',
  'anis': 'anise',
  'black pepper': 'pepper',
  'black vanilla husk': 'vanilla', 'vanilla bean': 'vanilla', 'vanilla absolute': 'vanilla',
  'cedar wood': 'cedar', 'cedarwood': 'cedar',
  'citruses': 'citrus',
  'cocoa': 'cacao', 'dark cacao': 'cacao',
  'elemi resin': 'elemi',
  'granny smith apple': 'apple', 'green apple': 'apple', 'red apple': 'apple',
  'green mandarin': 'mandarin', 'mandarin orange': 'mandarin',
  'juniper berries': 'juniper', 'juniper berry': 'juniper',
  'lily of the valley': 'lily-of-the-valley',
  'mirabelle plum': 'plum',
  'oak moss': 'oakmoss',
  'orris': 'iris', 'orris root': 'iris',
  'patchouli leaf': 'patchouli',
  'pimento seeds': 'pimento',
  'tonka': 'tonka bean', 'tonka beans': 'tonka bean',
  'woodsy notes': 'woody notes',
  // Same material under another name, or a typo
  'aromatic spices': 'spices', 'spicy notes': 'spices',
  'green pear': 'pear',
  'lemon zest': 'lemon',
  'mastic or lentisque': 'mastic',
  'muguet': 'lily-of-the-valley',
  'olibanum': 'frankincense',
  'onka bean': 'tonka bean',
  'pelargonium': 'geranium',
  'tobacco leaf': 'tobacco',
  'violet leaves': 'violet leaf',
};

// Lower-case canonical key for a note or accord ('' for blanks).
function canonNote(raw) {
  let k = norm(raw).toLowerCase().replace(/[™®]/g, '').replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (ALIASES[k]) return ALIASES[k];
  const words = k.split(' ');
  while (words.length > 1 && ORIGINS.has(words[0])) words.shift();
  k = words.join(' ');
  return ALIASES[k] || k;
}

// Display label for a canonical key: Title Case per word / hyphen part, small
// joining words kept lower ("Lily-of-the-Valley").
const SMALL = new Set(['of', 'the', 'and', 'de', 'du', 'la']);
const canonLabel = k => k.replace(/(^|[\s-])([a-z]+)/g, (m, sep, w) =>
  sep + (sep && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));

module.exports = { canonNote, canonLabel };
