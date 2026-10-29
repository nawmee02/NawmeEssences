// ============================================================
//  brand-types.js — Arabian / Designer / Niche, for the shop's
//  "Type" filter. The database has no brand classification, so it
//  lives here: edit the lists when a brand is added. A brand in no
//  list gets no type (the build warns) rather than a guess.
// ============================================================
const TYPES = {
  arabian: ['Afnan', 'Al Haramain', 'Arabiyat Prestige', 'Armaf', 'Bujairami', 'French Avenue', 'Gulf Orchid',
            'Junaid Perfumes', 'Lattafa', 'Rasasi', 'Rayhaan', 'Riiffs'],
  niche:   ['Amouage', 'Essential Parfums', 'Mancera', 'Xerjoff'],
  designer: ['Alfred Dunhill', 'Azzaro', 'Bentley', 'Bvlgari', 'Davidoff', 'Dior', 'Dolce & Gabbana', 'Giorgio Armani',
             'Givenchy', 'Gucci', 'Hermes', 'Hugo Boss', 'Issey Miyake', 'Jacques Bogart', 'Jean Paul Gaultier', 'Kenzo',
             'Lalique', 'Mercedes Benz', 'Missoni', 'Nautica', 'Prada', 'Valentino', 'Yves Saint Laurent'],
};
const LABELS = { arabian: 'Arabian', designer: 'Designer', niche: 'Niche' };

const byBrand = new Map();
for (const [type, brands] of Object.entries(TYPES)) brands.forEach(b => byBrand.set(b.toLowerCase(), type));

// 'arabian' | 'designer' | 'niche' | '' (unknown brand)
const brandType = brand => byBrand.get(String(brand || '').trim().toLowerCase()) || '';

module.exports = { brandType, LABELS };
