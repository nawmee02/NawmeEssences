// ============================================================
//  finder-exemplars.js — intent exemplars for the Finder's Layer B
//  (Phase 2, js/finder-nlu.js). DATA, not code.
//
//  Each entry is a short phrase a visitor might type and the structured-
//  query FRAGMENT it stands for. scripts/lib/embed.js embeds every `text`
//  with the same model the browser later downloads; at run time the
//  visitor's sentence is embedded, the nearest exemplars are found by
//  cosine, and their fragments are merged (js/finder-nlu.js). Fragments
//  use ONLY the structured-query fields:
//    features: { 'a:Sweet': 0.6, 'n:Oud': 0.5, 'o:Office': 1, 'a:Powdery': -0.6 }
//              keys  f: family  a: accord  n: note  o: occasion  k: concentration  b: brand
//              labels = canonical spelling from data/recs.json vocab (checked by
//              scripts/test-finder.js); values in [-1, 1], negative = avoid
//    strength:   'stronger' | 'softer'      (the ONLY way to express loud / subtle —
//                                            never a longevity or projection claim)
//    gender:     'men' | 'unisex'
//    collection: 'exclusive'
//    exclude:    ['brand:Armaf']
//  No prices here: numbers belong to the deterministic parser, which always
//  wins on prices, negations and anchors (see finder.js mergeNLU).
//  English only (the model is English; Banglish stays on the lexicon path).
// ============================================================
'use strict';

const E = [];
const add = (text, features, extra) => E.push({ text, frag: Object.assign({ features }, extra || {}) });

// ── fresh / clean ──────────────────────────────────────────
add('fresh and clean', { 'f:Fresh': 1, 'a:Fresh': 1, 'a:Citrus': 0.6, 'a:Aromatic': 0.4 });
add('smells like a cold shower in the morning', { 'a:Fresh': 1, 'n:White Musk': 0.7, 'a:Citrus': 0.5, 'a:Aquatic': 0.4 });
add('crisp, bright and refreshing', { 'a:Fresh': 1, 'a:Citrus': 0.8, 'a:Aromatic': 0.4, 'f:Fresh': 0.8 });
add('just-showered, freshly laundered clothes feel', { 'a:Musky': 0.7, 'a:Fresh': 0.6, 'n:White Musk': 0.6 });
add('clean soap and white musk, nothing heavy', { 'a:Musky': 0.8, 'n:White Musk': 0.7, 'a:Amber': -0.3 }, { strength: 'softer' });
add('cool minty and icy', { 'n:Mint': 1, 'a:Fresh': 0.8, 'a:Aromatic': 0.5, 'a:Citrus': 0.4 });
add('breezy and airy, like open windows', { 'a:Fresh': 0.9, 'a:Ozonic': 0.7, 'a:Aquatic': 0.5, 'a:Green': 0.3 });
add('light and easy, not heavy at all', { 'a:Fresh': 0.8, 'a:Citrus': 0.5, 'a:Amber': -0.3 }, { strength: 'softer' });

// ── blue / aquatic / beach ─────────────────────────────────
add('smells like the ocean, sea breeze, salty air', { 'f:Aquatic': 1, 'a:Marine': 1, 'a:Aquatic': 1, 'a:Salty': 0.6, 'n:Sea Notes': 0.8 });
add('a blue fragrance, watery and cool', { 'f:Aquatic': 1, 'a:Aquatic': 1, 'a:Marine': 0.7, 'a:Fresh': 0.7, 'n:Calone': 0.5 });
add('beach vacation, coconut and sun', { 'a:Coconut': 1, 'a:Tropical': 0.9, 'a:Aquatic': 0.6, 'n:Coconut': 0.8, 'o:Holiday': 0.8, 'o:Summer': 0.7 });
add('swimming pool, wet skin, chlorine clean', { 'a:Aquatic': 1, 'a:Ozonic': 0.7, 'a:Fresh': 0.6, 'n:Watery Notes': 0.6 });
add('like a seaside morning', { 'a:Marine': 1, 'a:Aquatic': 0.8, 'a:Citrus': 0.5, 'n:Sea Water': 0.6, 'o:Summer': 0.5 });
add('rain on the sea, ozone and salt', { 'a:Ozonic': 1, 'a:Marine': 0.8, 'a:Salty': 0.6, 'a:Aquatic': 0.6 });
add('tropical island drink with lime and coconut', { 'a:Tropical': 1, 'a:Coconut': 0.8, 'n:Lime': 0.6, 'n:Coconut Milk': 0.6, 'a:Citrus': 0.5, 'o:Holiday': 0.6 });
add('water, melon and cucumber, very cooling', { 'a:Aquatic': 1, 'n:Melon': 0.7, 'n:Watermelon': 0.6, 'a:Fresh': 0.7, 'o:Summer': 0.5 });

// ── citrus ─────────────────────────────────────────────────
add('zesty lemon and orange, sparkling', { 'a:Citrus': 1, 'f:Citrus': 0.9, 'n:Lemon': 0.7, 'n:Orange': 0.6, 'n:Bergamot': 0.5 });
add('bitter grapefruit and bergamot opening', { 'a:Citrus': 1, 'n:Grapefruit': 0.9, 'n:Bergamot': 0.8, 'a:Fresh Spicy': 0.4 });
add('a cologne style citrus, classic and simple', { 'a:Citrus': 1, 'f:Citrus': 0.8, 'a:Aromatic': 0.6, 'n:Neroli': 0.4 }, { strength: 'softer' });
add('tangy, sour, lime and yuzu', { 'a:Citrus': 1, 'n:Lime': 0.7, 'n:Yuzu': 0.6, 'a:Fresh': 0.6 });
add('mandarin and ginger, bright and spicy', { 'a:Citrus': 0.9, 'a:Fresh Spicy': 0.9, 'n:Mandarin': 0.7, 'n:Ginger': 0.8 });
add('sunny italian lemon garden', { 'a:Citrus': 1, 'n:Lemon': 0.8, 'n:Bergamot': 0.5, 'a:Green': 0.4, 'o:Summer': 0.5 });

// ── sweet / gourmand ───────────────────────────────────────
add('sweet like dessert, caramel and sugar', { 'f:Gourmand': 1, 'a:Sweet': 1, 'a:Caramel': 0.8, 'a:Vanilla': 0.6, 'n:Caramel': 0.6 });
add('smells like a bakery, cookies and pastry', { 'f:Gourmand': 1, 'a:Gourmand': 1, 'a:Sweet': 0.9, 'a:Vanilla': 0.6, 'n:Praline': 0.5, 'n:Speculoos': 0.5 });
add('candy floss and sugary fruit, playful', { 'a:Sweet': 1, 'a:Fruity': 0.8, 'a:Caramel': 0.5, 'n:Candied Fruits': 0.6, 'o:Party': 0.4 });
add('honey and tonka bean, warm and sweet', { 'a:Honey': 1, 'a:Sweet': 0.8, 'n:Honey': 0.8, 'n:Tonka Bean': 0.8, 'a:Amber': 0.4 });
add('toffee, praline and nuts', { 'a:Gourmand': 1, 'a:Caramel': 0.8, 'a:Nutty': 0.7, 'n:Toffee': 0.7, 'n:Praline': 0.6, 'a:Sweet': 0.7 });
add('like an ice cream shop', { 'a:Gourmand': 1, 'a:Sweet': 0.9, 'a:Vanilla': 0.8, 'n:Ice cream': 0.8, 'a:Lactonic': 0.4 });
add('rich chocolate and dark cocoa', { 'a:Chocolate': 1, 'n:Dark Chocolate': 0.8, 'n:Cacao': 0.7, 'a:Sweet': 0.6, 'a:Gourmand': 0.7 });
add('sweet boozy rum and dried fruit', { 'a:Boozy': 1, 'a:Rum': 0.8, 'n:Rum': 0.8, 'a:Sweet': 0.7, 'n:Plum Liquor': 0.4, 'o:Evening': 0.4 });
add('almond, marzipan and cherry liqueur', { 'a:Almond': 1, 'n:Almond': 0.8, 'a:Sweet': 0.7, 'a:Nutty': 0.5, 'n:Amaretto': 0.6 });
add('syrupy sweet and creamy', { 'a:Sweet': 1, 'a:Vanilla': 0.8, 'a:Lactonic': 0.5, 'a:Gourmand': 0.7 });

// ── vanilla / cosy / warm ──────────────────────────────────
add('warm creamy vanilla', { 'f:Vanilla': 1, 'a:Vanilla': 1, 'n:Vanilla': 0.8, 'a:Sweet': 0.6, 'a:Amber': 0.4 });
add('cosy like a blanket on a cold night', { 'a:Vanilla': 0.9, 'a:Amber': 0.8, 'a:Warm Spicy': 0.6, 'a:Sweet': 0.5, 'o:Winter': 0.8, 'o:Evening': 0.4 });
add('comforting, soft and huggable', { 'a:Vanilla': 0.8, 'a:Musky': 0.7, 'a:Powdery': 0.5, 'a:Sweet': 0.5, 'n:Tonka Bean': 0.4 });
add('warm and inviting, cinnamon and vanilla', { 'a:Warm Spicy': 1, 'a:Vanilla': 0.8, 'a:Cinnamon': 0.8, 'n:Cinnamon': 0.7, 'o:Winter': 0.6 });
add('a fireplace in winter, smoky and sweet', { 'a:Smoky': 0.9, 'a:Amber': 0.8, 'a:Vanilla': 0.5, 'a:Balsamic': 0.6, 'o:Winter': 0.9, 'n:Incense': 0.5 });
add('amber and benzoin, resinous warmth', { 'a:Amber': 1, 'a:Balsamic': 0.9, 'n:Benzoin': 0.7, 'n:Labdanum': 0.5, 'a:Warm Spicy': 0.5 });

// ── woody / earthy ─────────────────────────────────────────
add('woody and dry, cedar and sandalwood', { 'f:Woody': 1, 'a:Woody': 1, 'n:Cedar': 0.7, 'n:Sandalwood': 0.7, 'n:Vetiver': 0.4 });
add('earthy, smells like forest floor and damp soil', { 'a:Earthy': 1, 'a:Woody': 0.8, 'a:Mossy': 0.7, 'n:Vetiver': 0.7, 'n:Patchouli': 0.7, 'n:Oakmoss': 0.5 });
add('vetiver and grass, dry and rooty', { 'n:Vetiver': 1, 'a:Earthy': 0.8, 'a:Green': 0.6, 'a:Woody': 0.7 });
add('pencil shavings and cedar wood', { 'a:Woody': 1, 'n:Cedar': 0.9, 'n:Virginia Cedar': 0.6, 'n:Cedarwood': 0.6, 'f:Woody': 0.8 });
add('warm woods with a bit of spice', { 'a:Woody': 1, 'a:Warm Spicy': 0.7, 'a:Amber': 0.5, 'f:Woody': 0.8, 'n:Sandalwood': 0.4 });
add('a walk in the pine forest', { 'a:Woody': 0.9, 'a:Green': 0.8, 'a:Aromatic': 0.6, 'n:Juniper': 0.5, 'n:Cypress': 0.6, 'a:Earthy': 0.4 });

// ── amber / oriental / arabic / oud ────────────────────────
add('smells expensive, luxurious, rich', { 'a:Amber': 0.6, 'a:Woody': 0.4, 'n:Oud': 0.5, 'a:Oud': 0.4, 'a:Leather': 0.3, 'f:Oriental': 0.5 });
add('arabian oud, dark and resinous', { 'a:Oud': 1, 'n:Oud': 0.9, 'n:Agarwood': 0.7, 'a:Amber': 0.7, 'f:Oriental': 0.8, 'a:Smoky': 0.4 });
add('oriental, middle eastern style, saffron and rose', { 'f:Oriental': 1, 'n:Saffron': 0.9, 'n:Rose': 0.6, 'a:Rose': 0.6, 'a:Amber': 0.7, 'a:Oud': 0.5 });
add('deep amber with incense', { 'a:Amber': 1, 'n:Incense': 0.9, 'a:Balsamic': 0.6, 'a:Smoky': 0.5, 'f:Oriental': 0.7, 'n:Frankincense': 0.5 });
add('heavy, rich and opulent for the night', { 'a:Amber': 0.9, 'a:Oud': 0.6, 'a:Warm Spicy': 0.6, 'f:Oriental': 0.8, 'o:Evening': 0.7 }, { strength: 'stronger' });
add('like a royal palace, regal and majestic', { 'a:Amber': 0.8, 'a:Oud': 0.7, 'n:Saffron': 0.5, 'a:Rose': 0.4, 'f:Oriental': 0.8, 'o:Formal': 0.5 });
add('spicy oud with saffron and leather', { 'a:Oud': 1, 'n:Saffron': 0.8, 'a:Leather': 0.7, 'a:Warm Spicy': 0.7, 'f:Oriental': 0.7 });
add('exotic and mysterious, resin and spices', { 'a:Balsamic': 0.8, 'a:Warm Spicy': 0.8, 'a:Amber': 0.8, 'n:Myrrh': 0.5, 'n:Incense': 0.5, 'f:Oriental': 0.7 });

// ── spicy ──────────────────────────────────────────────────
add('spicy, peppery and warm', { 'f:Spicy': 1, 'a:Warm Spicy': 1, 'a:Fresh Spicy': 0.6, 'n:Pepper': 0.6, 'n:Black Pepper': 0.5 });
add('cardamom and cinnamon, chai spices', { 'a:Warm Spicy': 1, 'n:Cardamom': 0.9, 'n:Cinnamon': 0.8, 'a:Cinnamon': 0.6, 'f:Spicy': 0.7 });
add('pink pepper and ginger, fresh spicy', { 'a:Fresh Spicy': 1, 'n:Pink Pepper': 0.8, 'n:Ginger': 0.8, 'a:Citrus': 0.5 });
add('fiery, hot and bold spices', { 'a:Warm Spicy': 1, 'f:Spicy': 0.9, 'n:Cloves': 0.5, 'n:Nutmeg': 0.5, 'a:Amber': 0.4 }, { strength: 'stronger' });
add('mild gentle spice, nothing harsh', { 'a:Soft Spicy': 1, 'a:Warm Spicy': 0.5, 'a:Powdery': 0.3 }, { strength: 'softer' });

// ── leather / tobacco / smoky / boozy ──────────────────────
add('leather jacket, smoky and dark', { 'f:Leather': 1, 'a:Leather': 1, 'n:Leather': 0.8, 'a:Smoky': 0.8, 'a:Woody': 0.5 });
add('tobacco and vanilla, pipe smoke', { 'a:Tobacco': 1, 'n:Tobacco': 0.9, 'a:Vanilla': 0.7, 'a:Sweet': 0.5, 'n:Tobacco Leaf': 0.6 });
add('whiskey, oak barrel and smoke', { 'a:Whiskey': 1, 'a:Boozy': 0.9, 'n:Whiskey': 0.8, 'a:Woody': 0.7, 'n:Oak': 0.5, 'a:Smoky': 0.5 });
add('campfire smoke and burnt wood', { 'a:Smoky': 1, 'a:Woody': 0.8, 'n:Birch': 0.6, 'n:Incense': 0.5, 'a:Earthy': 0.4 });
add('a gentleman\'s club, cigars and old leather chairs', { 'a:Tobacco': 0.9, 'a:Leather': 0.9, 'a:Boozy': 0.5, 'a:Woody': 0.6, 'o:Evening': 0.5, 'o:Formal': 0.4 });
add('dark, brooding and animalic', { 'a:Animalic': 1, 'a:Leather': 0.7, 'a:Musky': 0.6, 'a:Smoky': 0.5, 'a:Amber': 0.5 });
add('rum and spices, pirate ship', { 'a:Rum': 1, 'a:Boozy': 0.9, 'n:Rum': 0.8, 'a:Warm Spicy': 0.7, 'a:Woody': 0.4 });
add('black tea and smoke, moody', { 'a:Tea': 1, 'n:Black Tea': 0.8, 'a:Smoky': 0.7, 'a:Woody': 0.5 });

// ── green / herbal / rainy ─────────────────────────────────
add('green and leafy, freshly cut grass', { 'f:Green': 1, 'a:Green': 1, 'n:Green Notes': 0.8, 'n:Green Leaves': 0.6, 'a:Fresh': 0.5 });
add('herbal, like rosemary, sage and basil', { 'a:Herbal': 1, 'a:Aromatic': 0.9, 'n:Rosemary': 0.7, 'n:Sage': 0.6, 'n:Basil': 0.6, 'a:Green': 0.5 });
add('smells like rain on dry earth', { 'a:Earthy': 1, 'a:Green': 0.8, 'a:Aquatic': 0.5, 'n:Vetiver': 0.5, 'n:Patchouli': 0.4, 'o:Monsoon': 0.8 });
add('fig leaves and green tea, calm garden', { 'a:Green': 1, 'n:Fig': 0.8, 'n:Fig Leaf': 0.7, 'n:Green Tea': 0.7, 'a:Tea': 0.5 });
add('mossy, damp and shady like a forest after rain', { 'a:Mossy': 1, 'a:Earthy': 0.8, 'a:Green': 0.8, 'n:Oakmoss': 0.6, 'n:Moss': 0.6, 'o:Monsoon': 0.6 });
add('aromatic lavender and herbs, barbershop', { 'f:Fougere': 1, 'a:Lavender': 1, 'a:Aromatic': 0.9, 'n:Lavender': 0.8, 'n:Geranium': 0.4 });

// ── powdery / iris / soft ──────────────────────────────────
add('soft and powdery, like baby powder', { 'a:Powdery': 1, 'a:Musky': 0.6, 'a:Iris': 0.5, 'n:Iris': 0.4 }, { strength: 'softer' });
add('iris and violet, elegant and dusty', { 'a:Iris': 1, 'n:Iris': 0.8, 'a:Violet': 0.7, 'n:Violet': 0.6, 'a:Powdery': 0.8, 'n:Orris': 0.5 });
add('velvety smooth, skin-like and soft', { 'a:Musky': 1, 'a:Powdery': 0.7, 'n:Musk': 0.7, 'a:Woody': 0.3 }, { strength: 'softer' });
add('makeup, lipstick, soft powder', { 'a:Powdery': 1, 'a:Iris': 0.8, 'a:Violet': 0.6, 'a:Floral': 0.4, 'n:Orris': 0.5 });
add('delicate and quiet, nothing shouting', { 'a:Musky': 0.7, 'a:Powdery': 0.5, 'a:Fresh': 0.4 }, { strength: 'softer' });

// ── floral / rose ──────────────────────────────────────────
add('rose, romantic and floral', { 'f:Floral': 1, 'a:Rose': 1, 'n:Rose': 0.9, 'a:Floral': 0.8, 'o:Date Night': 0.5 });
add('white flowers, jasmine and orange blossom', { 'a:White Floral': 1, 'n:Jasmine': 0.8, 'n:Orange Blossom': 0.8, 'a:Floral': 0.7, 'f:Floral': 0.7 });
add('a bouquet of fresh flowers', { 'f:Floral': 1, 'a:Floral': 1, 'a:White Floral': 0.6, 'a:Rose': 0.5, 'a:Fresh': 0.4 });
add('dark rose with oud and spice', { 'a:Rose': 1, 'n:Rose': 0.7, 'a:Oud': 0.8, 'n:Oud': 0.6, 'a:Warm Spicy': 0.6, 'f:Oriental': 0.7 });
add('tuberose and gardenia, creamy flowers', { 'a:White Floral': 1, 'n:Tuberose': 0.8, 'n:Gardenia': 0.7, 'a:Floral': 0.8, 'a:Lactonic': 0.3 });

// ── fruity / tropical ──────────────────────────────────────
add('fruity and juicy, pineapple and apple', { 'f:Fruity': 1, 'a:Fruity': 1, 'n:Pineapple': 0.8, 'n:Apple': 0.7, 'a:Sweet': 0.4 });
add('mango and tropical fruits', { 'a:Tropical': 1, 'a:Fruity': 0.9, 'n:Mango': 0.9, 'a:Sweet': 0.5, 'o:Summer': 0.5 });
add('berries, blackcurrant and plum', { 'a:Fruity': 1, 'n:Black Currant': 0.8, 'n:Plum': 0.7, 'n:Raspberry': 0.6, 'n:Red Fruits': 0.6 });
add('green apple and pear, crunchy fresh fruit', { 'a:Fruity': 1, 'n:Green Apple': 0.8, 'n:Apple': 0.7, 'n:Pear': 0.7, 'a:Fresh': 0.6 });
add('pineapple with smoky birch, fruity but masculine', { 'a:Fruity': 1, 'n:Pineapple': 0.9, 'a:Smoky': 0.7, 'n:Birch': 0.7, 'a:Woody': 0.5, 'f:Chypre': 0.5, 'n:Oakmoss': 0.4 });
add('summer fruit cocktail, cheerful', { 'a:Fruity': 1, 'a:Tropical': 0.7, 'a:Citrus': 0.6, 'a:Sweet': 0.5, 'o:Summer': 0.7, 'o:Casual': 0.4 });

// ── musky / skin ───────────────────────────────────────────
add('musky, like clean skin', { 'f:Musk': 1, 'a:Musky': 1, 'n:Musk': 0.9, 'n:White Musk': 0.6 });
add('your skin but better, intimate and close', { 'a:Musky': 1, 'n:Musk': 0.8, 'a:Powdery': 0.4, 'a:Woody': 0.3 }, { strength: 'softer' });
add('ambergris and musk, salty skin', { 'n:Ambergris': 1, 'a:Musky': 0.8, 'a:Salty': 0.6, 'n:Ambroxan': 0.6, 'a:Amber': 0.4 });
add('warm musk and amber, sensual', { 'a:Musky': 1, 'a:Amber': 0.8, 'n:Musk': 0.7, 'a:Sweet': 0.4, 'o:Date Night': 0.5 });

// ── coffee / tea ───────────────────────────────────────────
add('coffee, espresso, roasted beans', { 'a:Coffee': 1, 'n:Coffee': 0.9, 'a:Gourmand': 0.6, 'a:Sweet': 0.4, 'a:Boozy': 0.3 });
add('cafe latte with cardamom and sugar', { 'a:Coffee': 1, 'n:Coffee': 0.8, 'n:Cardamom': 0.7, 'a:Sweet': 0.7, 'a:Gourmand': 0.7, 'a:Warm Spicy': 0.4 });
add('green tea and ginger, zen and calm', { 'a:Tea': 1, 'n:Green Tea': 0.9, 'n:Ginger': 0.6, 'a:Fresh': 0.6, 'a:Citrus': 0.4 });
add('hot chocolate with spices on a cold day', { 'a:Chocolate': 1, 'n:Dark Chocolate': 0.7, 'a:Warm Spicy': 0.7, 'a:Sweet': 0.7, 'o:Winter': 0.7 });

// ── occasions: office / work / study ───────────────────────
add('something I can wear to the office every day', { 'o:Office': 1, 'o:Everyday': 0.8, 'a:Fresh': 0.6, 'a:Citrus': 0.4, 'a:Woody': 0.3 }, { strength: 'softer' });
add('professional, safe for work and meetings', { 'o:Office': 1, 'o:Formal': 0.6, 'a:Fresh': 0.5, 'a:Woody': 0.5, 'a:Aromatic': 0.4 }, { strength: 'softer' });
add('for university classes and the library', { 'o:Office': 0.9, 'o:Everyday': 0.9, 'o:Casual': 0.5, 'a:Fresh': 0.7, 'a:Citrus': 0.5 }, { strength: 'softer' });
add('won\'t bother my colleagues in a small room', { 'o:Office': 1, 'a:Fresh': 0.5, 'a:Musky': 0.4, 'a:Amber': -0.3, 'a:Sweet': -0.3 }, { strength: 'softer' });
add('corporate job, suit and tie, clean and sharp', { 'o:Office': 1, 'o:Formal': 0.8, 'a:Woody': 0.6, 'a:Fresh': 0.6, 'a:Aromatic': 0.5 });
add('interview day, want to seem confident but not loud', { 'o:Office': 1, 'o:Formal': 0.8, 'a:Woody': 0.6, 'a:Fresh': 0.5 }, { strength: 'softer' });
add('a teacher in a classroom all day', { 'o:Office': 0.9, 'o:Everyday': 0.9, 'a:Fresh': 0.6, 'n:White Musk': 0.4 }, { strength: 'softer' });
add('working in an air conditioned office', { 'o:Office': 1, 'o:Everyday': 0.7, 'a:Fresh': 0.5, 'a:Woody': 0.4, 'a:Citrus': 0.4 });

// ── everyday / casual ──────────────────────────────────────
add('an everyday signature scent I can wear anywhere', { 'o:Everyday': 1, 'o:Casual': 0.7, 'a:Woody': 0.5, 'a:Musky': 0.5, 'a:Fresh': 0.5 });
add('casual weekend, jeans and t-shirt', { 'o:Casual': 1, 'o:Everyday': 0.8, 'a:Fresh': 0.6, 'a:Citrus': 0.5, 'a:Fruity': 0.3 });
add('a daily driver, versatile for any situation', { 'o:Everyday': 1, 'o:Office': 0.5, 'o:Casual': 0.6, 'a:Woody': 0.5, 'a:Fresh': 0.5, 'a:Aromatic': 0.4 });
add('something to wear while running errands and shopping', { 'o:Everyday': 1, 'o:Casual': 0.9, 'a:Fresh': 0.6, 'a:Citrus': 0.4 });

// ── date night / romantic ──────────────────────────────────
add('romantic dinner date, want to smell seductive', { 'o:Date Night': 1, 'o:Evening': 0.7, 'a:Sweet': 0.7, 'a:Amber': 0.7, 'a:Vanilla': 0.6, 'a:Musky': 0.4 });
add('something she will want to get closer to', { 'o:Date Night': 1, 'a:Sweet': 0.8, 'a:Vanilla': 0.7, 'a:Amber': 0.6, 'a:Musky': 0.5 });
add('sexy, warm and a bit sweet for the night', { 'o:Date Night': 1, 'o:Evening': 0.8, 'a:Sweet': 0.8, 'a:Amber': 0.7, 'a:Warm Spicy': 0.5, 'a:Vanilla': 0.5 });
add('anniversary evening, candle light', { 'o:Date Night': 1, 'o:Evening': 0.8, 'a:Amber': 0.7, 'a:Vanilla': 0.5, 'a:Rose': 0.4, 'a:Sweet': 0.5 });
add('intimate and cuddly, close to the skin', { 'o:Date Night': 0.8, 'a:Musky': 0.9, 'a:Vanilla': 0.6, 'a:Powdery': 0.4 }, { strength: 'softer' });
add('first date, want to leave a good impression', { 'o:Date Night': 1, 'a:Sweet': 0.6, 'a:Fresh': 0.5, 'a:Amber': 0.5, 'a:Fruity': 0.3 });

// ── party / club / night ───────────────────────────────────
add('nightclub, loud music, want to stand out', { 'o:Party': 1, 'o:Evening': 0.7, 'a:Sweet': 0.7, 'a:Amber': 0.6, 'a:Vanilla': 0.5, 'a:Fruity': 0.4 }, { strength: 'stronger' });
add('a party scent that gets noticed', { 'o:Party': 1, 'a:Sweet': 0.8, 'a:Amber': 0.6, 'a:Vanilla': 0.5, 'a:Fruity': 0.5 }, { strength: 'stronger' });
add('friday night out with the boys', { 'o:Party': 1, 'o:Evening': 0.8, 'a:Sweet': 0.6, 'a:Warm Spicy': 0.5, 'a:Amber': 0.5, 'a:Fruity': 0.4 });
add('concert, crowded place, want to be smelled', { 'o:Party': 1, 'o:Evening': 0.6, 'a:Sweet': 0.7, 'a:Amber': 0.7, 'a:Vanilla': 0.5 }, { strength: 'stronger' });
add('birthday celebration with friends', { 'o:Party': 1, 'o:Casual': 0.5, 'a:Sweet': 0.6, 'a:Fruity': 0.6, 'a:Fresh': 0.3 });
add('late night, after dark, dim lights', { 'o:Evening': 1, 'o:Date Night': 0.6, 'a:Amber': 0.7, 'a:Woody': 0.5, 'a:Smoky': 0.4, 'a:Vanilla': 0.4 });
add('dinner with friends in the evening', { 'o:Evening': 1, 'o:Casual': 0.5, 'a:Woody': 0.5, 'a:Amber': 0.5, 'a:Warm Spicy': 0.4 });
add('after sunset, cool night air', { 'o:Evening': 1, 'a:Woody': 0.5, 'a:Aromatic': 0.5, 'a:Amber': 0.4, 'a:Fresh': 0.3 });

// ── formal / wedding ───────────────────────────────────────
add('wedding reception, dressed up in a sherwani', { 'o:Wedding': 1, 'o:Formal': 0.9, 'o:Festivals': 0.4, 'a:Amber': 0.7, 'a:Oud': 0.6, 'a:Rose': 0.4, 'a:Warm Spicy': 0.5 });
add('a formal event, black tie, elegant', { 'o:Formal': 1, 'o:Evening': 0.6, 'a:Woody': 0.7, 'a:Amber': 0.5, 'a:Aromatic': 0.4, 'a:Leather': 0.3 });
add('my own wedding day', { 'o:Wedding': 1, 'o:Formal': 0.8, 'a:Amber': 0.6, 'a:Oud': 0.5, 'a:Rose': 0.4, 'a:Sweet': 0.4 });
add('attending a friend\'s wedding in winter', { 'o:Wedding': 1, 'o:Winter': 0.7, 'o:Festivals': 0.4, 'a:Amber': 0.7, 'a:Warm Spicy': 0.6, 'a:Oud': 0.4 });
add('graduation ceremony, smart and polished', { 'o:Formal': 1, 'o:Office': 0.5, 'a:Woody': 0.6, 'a:Fresh': 0.5, 'a:Aromatic': 0.5 });
add('business dinner, refined and understated', { 'o:Formal': 1, 'o:Evening': 0.6, 'a:Woody': 0.7, 'a:Amber': 0.4, 'a:Aromatic': 0.4 }, { strength: 'softer' });

// ── gym / sport ────────────────────────────────────────────
add('gym, workout, something sporty', { 'o:Gym / Sport': 1, 'a:Fresh': 0.9, 'a:Citrus': 0.7, 'a:Aquatic': 0.5, 'a:Aromatic': 0.4 });
add('after football practice, sweaty, need fresh', { 'o:Gym / Sport': 1, 'a:Fresh': 1, 'a:Citrus': 0.6, 'a:Aquatic': 0.5, 'n:White Musk': 0.4 });
add('cycling and running outdoors', { 'o:Gym / Sport': 1, 'o:Casual': 0.5, 'a:Fresh': 0.8, 'a:Green': 0.5, 'a:Citrus': 0.5 });
add('energetic and sporty, like a sports drink', { 'o:Gym / Sport': 0.9, 'a:Fresh': 0.8, 'a:Citrus': 0.7, 'a:Ozonic': 0.4, 'a:Fruity': 0.3 });

// ── festivals / family ─────────────────────────────────────
add('eid morning with family, traditional', { 'o:Festivals': 1, 'o:Formal': 0.4, 'a:Oud': 0.6, 'a:Amber': 0.7, 'a:Rose': 0.4, 'a:Warm Spicy': 0.4, 'f:Oriental': 0.6 });
add('festive season, celebration and sweets', { 'o:Festivals': 1, 'a:Sweet': 0.6, 'a:Amber': 0.6, 'a:Warm Spicy': 0.5, 'a:Vanilla': 0.4 });
add('durga puja pandal hopping', { 'o:Festivals': 1, 'o:Casual': 0.4, 'a:Amber': 0.5, 'a:Sweet': 0.5, 'a:Floral': 0.4, 'a:Fresh': 0.3 });
add('family gathering, something respectable', { 'o:Festivals': 0.8, 'o:Formal': 0.5, 'a:Woody': 0.6, 'a:Amber': 0.5, 'a:Fresh': 0.4 }, { strength: 'softer' });

// ── holiday / travel ───────────────────────────────────────
add('going on holiday, vacation mood', { 'o:Holiday': 1, 'o:Summer': 0.7, 'o:Casual': 0.6, 'a:Fresh': 0.6, 'a:Tropical': 0.5, 'a:Citrus': 0.5 });
add('travelling, long flight, airport', { 'o:Holiday': 0.8, 'o:Everyday': 0.6, 'a:Fresh': 0.7, 'a:Musky': 0.4 }, { strength: 'softer' });
add('cox\'s bazar beach trip', { 'o:Holiday': 1, 'o:Summer': 0.8, 'a:Aquatic': 0.8, 'a:Tropical': 0.6, 'a:Coconut': 0.5, 'a:Citrus': 0.4 });

// ── seasons / weather ──────────────────────────────────────
add('for hot and humid weather', { 'o:Summer': 1, 'a:Fresh': 0.9, 'a:Citrus': 0.8, 'a:Aquatic': 0.6, 'a:Amber': -0.3, 'a:Sweet': -0.2 });
add('summer heat, sweating in the sun', { 'o:Summer': 1, 'a:Citrus': 0.8, 'a:Fresh': 0.8, 'a:Aquatic': 0.6, 'a:Vanilla': -0.3 });
add('won\'t turn sickly in the heat', { 'o:Summer': 1, 'a:Fresh': 0.8, 'a:Citrus': 0.6, 'a:Sweet': -0.5, 'a:Vanilla': -0.4 });
add('scorching afternoon in dhaka traffic', { 'o:Summer': 1, 'a:Fresh': 0.9, 'a:Citrus': 0.7, 'a:Aquatic': 0.5, 'a:Amber': -0.3 });
add('spring, flowers blooming, light and happy', { 'o:Spring': 1, 'a:Floral': 0.7, 'a:Green': 0.6, 'a:Fresh': 0.6, 'a:Fruity': 0.4 });
add('mild weather, neither hot nor cold', { 'o:Spring': 0.8, 'o:Everyday': 0.6, 'a:Fresh': 0.5, 'a:Woody': 0.4, 'a:Aromatic': 0.4 });
add('cold winter nights', { 'o:Winter': 1, 'a:Amber': 0.9, 'a:Warm Spicy': 0.7, 'a:Vanilla': 0.6, 'a:Sweet': 0.5, 'a:Fresh': -0.2 });
add('foggy december morning, shawl and tea', { 'o:Winter': 1, 'a:Warm Spicy': 0.7, 'a:Amber': 0.7, 'a:Tea': 0.4, 'a:Woody': 0.5 });
add('something warm for the cold season', { 'o:Winter': 1, 'a:Amber': 0.8, 'a:Vanilla': 0.6, 'a:Warm Spicy': 0.6, 'a:Woody': 0.4 });
add('chilly evening, warm sweater', { 'o:Winter': 0.9, 'o:Evening': 0.6, 'a:Amber': 0.7, 'a:Vanilla': 0.6, 'a:Musky': 0.4 });
add('rainy day, monsoon, grey skies', { 'o:Monsoon': 1, 'a:Green': 0.7, 'a:Aquatic': 0.6, 'a:Earthy': 0.6, 'a:Woody': 0.4 });
add('during the rains, wet streets, petrichor', { 'o:Monsoon': 1, 'a:Earthy': 0.9, 'a:Green': 0.7, 'a:Aquatic': 0.5, 'n:Vetiver': 0.4 });
add('humid rainy season, want something that still feels clean', { 'o:Monsoon': 1, 'a:Fresh': 0.7, 'a:Green': 0.5, 'a:Aquatic': 0.5, 'n:White Musk': 0.3 });
add('stormy weather, thunder, dramatic', { 'o:Monsoon': 0.8, 'a:Ozonic': 0.7, 'a:Aquatic': 0.5, 'a:Woody': 0.5, 'a:Smoky': 0.3 });

// ── moods ──────────────────────────────────────────────────
add('confident, bold and powerful', { 'a:Woody': 0.8, 'a:Amber': 0.7, 'a:Leather': 0.5, 'a:Fresh Spicy': 0.4, 'f:Woody': 0.6, 'o:Formal': 0.4 }, { strength: 'stronger' });
add('boss energy, commanding the room', { 'a:Woody': 0.8, 'a:Amber': 0.7, 'a:Leather': 0.5, 'a:Warm Spicy': 0.4, 'o:Formal': 0.5 }, { strength: 'stronger' });
add('alpha, dominant and masculine', { 'a:Woody': 0.8, 'a:Leather': 0.6, 'a:Amber': 0.6, 'a:Smoky': 0.4, 'a:Floral': -0.3 }, { gender: 'men', strength: 'stronger' });
add('cosy and comforting', { 'a:Vanilla': 0.9, 'a:Sweet': 0.6, 'a:Amber': 0.6, 'a:Warm Spicy': 0.4, 'f:Gourmand': 0.5, 'o:Winter': 0.5 });
add('clean, minimal and understated', { 'n:White Musk': 0.8, 'a:Musky': 0.8, 'a:Fresh': 0.6, 'a:Powdery': 0.3, 'o:Everyday': 0.5 }, { strength: 'softer' });
add('seductive and sensual', { 'a:Sweet': 0.8, 'a:Amber': 0.8, 'a:Vanilla': 0.7, 'a:Musky': 0.6, 'a:Oud': 0.4, 'o:Date Night': 0.8 });
add('playful, fun and cheerful', { 'a:Fruity': 0.9, 'a:Sweet': 0.7, 'a:Citrus': 0.6, 'a:Fresh': 0.5, 'a:Tropical': 0.4, 'o:Casual': 0.5 });
add('youthful and energetic, like a college student', { 'a:Fresh': 0.8, 'a:Fruity': 0.7, 'a:Sweet': 0.6, 'a:Citrus': 0.5, 'o:Everyday': 0.6, 'o:Casual': 0.6 });
add('something for a teenager, first perfume', { 'a:Fresh': 0.9, 'a:Fruity': 0.6, 'a:Citrus': 0.6, 'a:Sweet': 0.4, 'o:Everyday': 0.7, 'o:Casual': 0.5 }, { strength: 'softer' });
add('mature, classy and sophisticated', { 'f:Chypre': 0.6, 'a:Woody': 0.8, 'a:Leather': 0.5, 'a:Mossy': 0.4, 'a:Amber': 0.5, 'a:Sweet': -0.3 });
add('old money, quiet luxury, timeless', { 'a:Woody': 0.8, 'f:Chypre': 0.6, 'a:Leather': 0.5, 'a:Iris': 0.4, 'a:Mossy': 0.4, 'a:Sweet': -0.3 });
add('a proper gentleman, refined', { 'a:Woody': 0.8, 'a:Aromatic': 0.6, 'a:Leather': 0.4, 'a:Lavender': 0.4, 'f:Fougere': 0.4, 'o:Formal': 0.4 });
add('distinguished, like a well dressed older man', { 'a:Woody': 0.8, 'a:Leather': 0.5, 'a:Amber': 0.5, 'f:Chypre': 0.5, 'a:Mossy': 0.4, 'o:Formal': 0.5 }, { gender: 'men' });
add('a signature that people associate with me', { 'o:Everyday': 0.8, 'a:Woody': 0.6, 'a:Musky': 0.5, 'a:Amber': 0.4, 'a:Aromatic': 0.4 });
add('luxury, like a five star hotel lobby', { 'a:Amber': 0.6, 'a:Woody': 0.6, 'a:Musky': 0.4, 'a:Oud': 0.3, 'a:Iris': 0.3, 'f:Oriental': 0.4 });
add('smells like money and success', { 'a:Amber': 0.7, 'a:Woody': 0.5, 'a:Oud': 0.5, 'a:Leather': 0.4, 'a:Fruity': 0.3, 'a:Smoky': 0.3 });
add('a scent that makes people ask what I am wearing', { 'a:Sweet': 0.7, 'a:Amber': 0.6, 'a:Vanilla': 0.5, 'a:Fruity': 0.4, 'o:Date Night': 0.5, 'o:Party': 0.4 }, { strength: 'stronger' });
add('compliment magnet, people will notice', { 'a:Sweet': 0.8, 'a:Amber': 0.6, 'a:Vanilla': 0.6, 'a:Fruity': 0.4, 'o:Party': 0.4, 'o:Date Night': 0.4 }, { strength: 'stronger' });
add('attention grabbing, head turner', { 'a:Sweet': 0.7, 'a:Amber': 0.7, 'a:Warm Spicy': 0.5, 'a:Vanilla': 0.5, 'o:Party': 0.5 }, { strength: 'stronger' });
add('mysterious, dark and moody', { 'a:Smoky': 0.7, 'a:Amber': 0.7, 'a:Oud': 0.5, 'a:Leather': 0.5, 'a:Woody': 0.5, 'o:Evening': 0.6 });
add('calm, relaxing and meditative', { 'a:Woody': 0.6, 'a:Powdery': 0.4, 'n:Incense': 0.5, 'a:Musky': 0.5, 'a:Tea': 0.4, 'a:Green': 0.3 }, { strength: 'softer' });
add('peaceful like a spa, eucalyptus and tea', { 'a:Aromatic': 0.8, 'a:Herbal': 0.7, 'n:Eucalyptus': 0.6, 'a:Tea': 0.5, 'a:Fresh': 0.5 }, { strength: 'softer' });
add('elegant and feminine but wearable by anyone', { 'a:Floral': 0.6, 'a:Powdery': 0.5, 'a:Musky': 0.5, 'a:Iris': 0.4, 'a:Sweet': 0.3 }, { gender: 'unisex' });
add('edgy, modern and different from the usual', { 'a:Metallic': 0.5, 'a:Ozonic': 0.5, 'a:Woody': 0.5, 'a:Smoky': 0.4, 'a:Mineral': 0.4 });
add('nostalgic, reminds me of childhood', { 'a:Powdery': 0.6, 'a:Sweet': 0.5, 'a:Vanilla': 0.5, 'n:White Musk': 0.4, 'a:Musky': 0.4 });

// ── negatives (what to avoid) ──────────────────────────────
add('old fashioned, uncle-like', { 'a:Powdery': -0.6, 'a:Lavender': -0.3, 'a:Fresh': 0.4, 'a:Fruity': 0.3 });
add('smells like my grandfather\'s aftershave', { 'a:Powdery': -0.6, 'a:Lavender': -0.4, 'f:Fougere': -0.3, 'a:Fresh': 0.4 });
add('nothing dated or like an old man', { 'a:Powdery': -0.6, 'a:Lavender': -0.3, 'a:Mossy': -0.2, 'a:Fresh': 0.4, 'a:Sweet': 0.3 });
add('too sweet, sickly, gives me a headache', { 'a:Sweet': -0.7, 'a:Vanilla': -0.5, 'a:Caramel': -0.4, 'a:Fresh': 0.4 });
add('not a dessert, not cloying', { 'a:Sweet': -0.7, 'a:Gourmand': -0.6, 'a:Vanilla': -0.4, 'a:Woody': 0.3 });
add('I hate sugary perfumes', { 'a:Sweet': -0.8, 'a:Caramel': -0.5, 'a:Vanilla': -0.4, 'a:Fresh': 0.3 });
add('bored of blue aquatic fragrances', { 'a:Aquatic': -0.6, 'a:Marine': -0.6, 'a:Ozonic': -0.3, 'a:Woody': 0.3, 'a:Sweet': 0.3 });
add('not another generic fresh one', { 'a:Fresh': -0.5, 'a:Aquatic': -0.4, 'a:Citrus': -0.3, 'a:Amber': 0.3, 'a:Woody': 0.3 });
add('nothing heavy or suffocating', { 'a:Amber': -0.5, 'a:Oud': -0.5, 'a:Warm Spicy': -0.3, 'a:Fresh': 0.4 }, { strength: 'softer' });
add('not too spicy, no pepper', { 'a:Warm Spicy': -0.6, 'a:Fresh Spicy': -0.5, 'f:Spicy': -0.4 });
add('no florals, nothing girly', { 'a:White Floral': -0.6, 'a:Rose': -0.5, 'a:Floral': -0.6, 'f:Floral': -0.5, 'a:Woody': 0.3 }, { gender: 'men' });
add('not woody or dry, something juicier', { 'a:Woody': -0.6, 'a:Earthy': -0.4, 'a:Fruity': 0.5, 'a:Sweet': 0.4 });
add('smells too synthetic and chemical', { 'a:Ozonic': -0.4, 'a:Metallic': -0.4, 'a:Aquatic': -0.3, 'a:Woody': 0.3, 'a:Amber': 0.3 });
add('not smoky, I don\'t like burnt smells', { 'a:Smoky': -0.7, 'a:Leather': -0.4, 'a:Tobacco': -0.4 });
add('nothing powdery or soapy', { 'a:Powdery': -0.7, 'n:White Musk': -0.6, 'a:Iris': -0.4 });
add('no oud, too strong for me', { 'a:Oud': -0.8, 'n:Oud': -0.6, 'a:Animalic': -0.4 }, { strength: 'softer' });
add('nothing that smells like a cheap body spray', { 'a:Fresh': -0.2, 'a:Ozonic': -0.3, 'a:Woody': 0.4, 'a:Amber': 0.4, 'a:Musky': 0.3 });

// ── strength (the only permitted way to express loud / subtle) ──
add('loud and strong, fills the room', { 'a:Amber': 0.4, 'a:Sweet': 0.3 }, { strength: 'stronger' });
add('want everyone to notice me from far away', { 'a:Amber': 0.4, 'a:Sweet': 0.3, 'a:Oud': 0.3 }, { strength: 'stronger' });
add('something with presence, big and bold', { 'a:Amber': 0.4, 'a:Woody': 0.3, 'a:Warm Spicy': 0.3 }, { strength: 'stronger' });
add('an intense, concentrated version', { 'k:Extrait': 0.6, 'k:Parfum': 0.5, 'k:EDP Intense': 0.5, 'a:Amber': 0.3 }, { strength: 'stronger' });
add('heavy hitter for the night', { 'a:Amber': 0.5, 'a:Oud': 0.4, 'a:Sweet': 0.3, 'o:Evening': 0.5 }, { strength: 'stronger' });
add('office safe, not loud, subtle', { 'o:Office': 0.5, 'a:Fresh': 0.3 }, { strength: 'softer' });
add('quiet, sits close to the skin, only I can smell it', { 'a:Musky': 0.4 }, { strength: 'softer' });
add('a light eau de toilette, nothing overpowering', { 'k:EDT': 0.7, 'a:Fresh': 0.4, 'a:Citrus': 0.3 }, { strength: 'softer' });
add('gentle and soft spoken', { 'a:Musky': 0.4, 'a:Powdery': 0.3 }, { strength: 'softer' });
add('a skin scent, barely there', { 'a:Musky': 0.6, 'n:Musk': 0.4 }, { strength: 'softer' });

// ── gender / who ───────────────────────────────────────────
add('manly, masculine, for a guy', { 'a:Woody': 0.5, 'a:Aromatic': 0.4, 'a:Fresh Spicy': 0.3 }, { gender: 'men' });
add('for my husband, something masculine', { 'a:Woody': 0.5, 'a:Amber': 0.4, 'a:Aromatic': 0.3 }, { gender: 'men' });
add('a gift for my father', { 'a:Woody': 0.6, 'a:Amber': 0.4, 'a:Aromatic': 0.4, 'o:Formal': 0.3 }, { gender: 'men' });
add('unisex, something both of us can share', { 'a:Musky': 0.4, 'a:Fresh': 0.3, 'a:Woody': 0.3 }, { gender: 'unisex' });
add('a gift for a woman, wearable by anyone', { 'a:Sweet': 0.4, 'a:Floral': 0.4, 'a:Musky': 0.3, 'a:Fruity': 0.3 }, { gender: 'unisex' });
add('something my girlfriend can also wear', { 'a:Sweet': 0.4, 'a:Fruity': 0.3, 'a:Musky': 0.3, 'a:Vanilla': 0.3 }, { gender: 'unisex' });
add('a present for my sister', { 'a:Floral': 0.4, 'a:Sweet': 0.4, 'a:Fruity': 0.3, 'a:Musky': 0.3 }, { gender: 'unisex' });

// ── collection / concentration ─────────────────────────────
add('rare, discontinued, hard to find bottles', { 'a:Woody': 0.2 }, { collection: 'exclusive' });
add('vintage formulation, collector\'s item', { 'a:Woody': 0.2, 'a:Amber': 0.2 }, { collection: 'exclusive' });
add('niche and exclusive, not the usual designer stuff', { 'a:Oud': 0.3, 'a:Amber': 0.3, 'a:Woody': 0.2 }, { collection: 'exclusive' });
add('an extrait or parfum concentration', { 'k:Extrait': 0.8, 'k:Parfum': 0.8, 'k:EDP Intense': 0.4 }, { strength: 'stronger' });
add('an eau de parfum, the regular strength', { 'k:EDP': 0.8 });
add('an elixir, the richer version', { 'k:Elixir': 0.9, 'k:EDP Intense': 0.4, 'a:Amber': 0.3, 'a:Vanilla': 0.3 }, { strength: 'stronger' });

// ── profile sketches without names (the parser owns real names) ──
add('fruity pineapple with smoke and musk, the famous niche profile', { 'a:Fruity': 0.9, 'n:Pineapple': 0.9, 'a:Smoky': 0.7, 'a:Musky': 0.6, 'n:Birch': 0.6, 'f:Chypre': 0.5 });
add('peppery ambroxan and bergamot, the modern mass-pleaser', { 'a:Fresh Spicy': 0.9, 'a:Aromatic': 0.7, 'n:Bergamot': 0.7, 'n:Ambroxan': 0.7, 'n:Pepper': 0.6, 'a:Amber': 0.4 });
add('lavender, mint and vanilla, the sailor classic', { 'a:Lavender': 0.9, 'n:Lavender': 0.8, 'n:Mint': 0.7, 'a:Vanilla': 0.8, 'f:Fougere': 0.7, 'f:Oriental': 0.4 });
add('iris and cocoa, powdery and elegant', { 'a:Iris': 1, 'n:Iris': 0.7, 'a:Powdery': 0.8, 'a:Chocolate': 0.4, 'n:Cacao': 0.4, 'a:Woody': 0.4 });
add('vanilla with tobacco and spices, the sweet night classic', { 'a:Vanilla': 0.9, 'a:Tobacco': 0.7, 'a:Warm Spicy': 0.6, 'a:Sweet': 0.6, 'o:Evening': 0.5 });
add('ginger, sage and juniper, the modern woody fresh', { 'a:Woody': 0.8, 'a:Fresh': 0.7, 'n:Ginger': 0.7, 'n:Sage': 0.6, 'n:Juniper': 0.5, 'a:Aromatic': 0.5 });
add('coconut and tonka, creamy summer vanilla', { 'a:Coconut': 0.9, 'a:Vanilla': 0.8, 'n:Coconut': 0.7, 'n:Tonka Bean': 0.7, 'a:Lactonic': 0.5, 'o:Summer': 0.5 });
add('salty ambergris and citrus, mineral and sunny', { 'n:Ambergris': 0.9, 'a:Salty': 0.8, 'a:Mineral': 0.6, 'a:Citrus': 0.6, 'a:Marine': 0.4 });
add('cherry and almond, boozy sweet', { 'n:Amaretto': 0.6, 'a:Almond': 0.8, 'a:Boozy': 0.6, 'a:Sweet': 0.7, 'a:Fruity': 0.4 });
add('saffron and amberwood, sweet spicy unisex', { 'n:Saffron': 0.9, 'n:Amberwood': 0.7, 'a:Amber': 0.7, 'a:Sweet': 0.6, 'a:Warm Spicy': 0.6, 'a:Woody': 0.5 }, { gender: 'unisex' });
add('apple, cinnamon and vanilla, like apple pie', { 'n:Apple': 0.9, 'n:Cinnamon': 0.8, 'a:Cinnamon': 0.6, 'a:Vanilla': 0.7, 'a:Sweet': 0.7, 'a:Fruity': 0.5 });
add('green tea and bergamot, light and calm', { 'a:Tea': 0.9, 'n:Green Tea': 0.8, 'n:Bergamot': 0.7, 'a:Citrus': 0.5, 'a:Fresh': 0.6 }, { strength: 'softer' });

// ── situational / misc ─────────────────────────────────────
add('something that works from morning to a night out', { 'o:Everyday': 0.8, 'o:Evening': 0.7, 'a:Woody': 0.6, 'a:Amber': 0.5, 'a:Fresh': 0.4 });
add('a scent for my motorbike commute in the city', { 'o:Everyday': 0.9, 'o:Casual': 0.6, 'a:Fresh': 0.7, 'a:Woody': 0.4, 'a:Citrus': 0.4 });
add('hospital or clinic, must be very discreet', { 'o:Office': 0.8, 'n:White Musk': 0.6, 'a:Musky': 0.6, 'a:Fresh': 0.5, 'a:Amber': -0.3 }, { strength: 'softer' });
add('a long day outdoors in the sun', { 'o:Summer': 0.9, 'o:Casual': 0.6, 'a:Citrus': 0.7, 'a:Fresh': 0.7, 'a:Aquatic': 0.5 });
add('a student on a tight budget who wants to smell good', { 'o:Everyday': 0.9, 'o:Casual': 0.6, 'a:Fresh': 0.6, 'a:Sweet': 0.4, 'a:Citrus': 0.4 });
add('something different from what everyone else wears', { 'a:Smoky': 0.4, 'a:Tea': 0.4, 'a:Green': 0.4, 'a:Iris': 0.3, 'a:Metallic': 0.3, 'a:Aquatic': -0.2 });
add('a crowd pleaser everyone likes', { 'a:Sweet': 0.6, 'a:Fresh': 0.5, 'a:Fruity': 0.5, 'a:Vanilla': 0.4, 'a:Amber': 0.4, 'o:Everyday': 0.5 });
add('romantic rainy evening at a rooftop cafe', { 'o:Monsoon': 0.7, 'o:Date Night': 0.8, 'o:Evening': 0.7, 'a:Amber': 0.5, 'a:Green': 0.4, 'a:Sweet': 0.4 });
add('a prayer gathering, traditional and respectful', { 'o:Festivals': 0.7, 'o:Formal': 0.5, 'a:Oud': 0.6, 'a:Amber': 0.5, 'n:Incense': 0.4, 'a:Rose': 0.3, 'f:Oriental': 0.5 });
add('rich and creamy, sandalwood and milk', { 'n:Sandalwood': 0.9, 'a:Lactonic': 0.7, 'a:Woody': 0.7, 'a:Powdery': 0.4, 'a:Sweet': 0.3 });
add('smells like a luxury car interior, leather and wood', { 'a:Leather': 0.9, 'a:Woody': 0.8, 'n:Leather': 0.6, 'a:Amber': 0.4, 'f:Leather': 0.6 });
add('like a flower shop, green stems and petals', { 'a:Floral': 0.9, 'a:Green': 0.8, 'f:Floral': 0.7, 'n:Green Notes': 0.5, 'a:Fresh': 0.4 });
add('soft spice and cream, like kheer', { 'a:Soft Spicy': 0.8, 'n:Cardamom': 0.7, 'a:Lactonic': 0.6, 'a:Sweet': 0.6, 'a:Vanilla': 0.5 });
add('a cup of masala tea on a winter morning', { 'a:Tea': 0.8, 'a:Warm Spicy': 0.8, 'n:Cardamom': 0.6, 'n:Cinnamon': 0.5, 'a:Sweet': 0.4, 'o:Winter': 0.6 });

module.exports = { exemplars: E };
