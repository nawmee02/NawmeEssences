// ============================================================
//  finder.js — "Find a Scent" (recommend.html): a chat-style perfume
//  finder on top of the tier-1 feature space.
//
//  No model, no server: the build writes data/finder.json (recs items +
//  description keywords + optional inspired_by references) and this file
//  turns what the visitor types or taps into ONE structured query
//  (anchor, signed features, price band, gender, strength, collection,
//  exclusions, unknown words) and ranks the catalogue against it with the
//  same keys and weights as js/recs.js (f2 a2 n1 o1 g1.5 k0.5 b1, plus the
//  finder-only w0.5 for description keywords). The tier-1 profile from
//  localStorage "nawme_signals" is read (never written) and only tilts
//  the ranking; the thread never mentions it.
//
//  Contract: nothing is fetched until the visitor's first chip or text;
//  every product appears at most once per thread (thread.renderedIds);
//  no longevity claims — every sentence lives in T below and is checked
//  by scripts/test-finder.js. The pure parts (normalize, parse, mergeQuery,
//  fromChip, vectorize, queryVector, buildProfile, rank, answer, reasons)
//  are exported for Node.
// ============================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    root.NawmeFinder = api;
    api._init(document.currentScript);
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── every visible sentence (one object so the claims test can scan it) ──
  const T = {
    opening: "Tell me what you're after, or pick a few quick answers.",
    askOccasion: 'When will you mostly wear it?',
    askVibe: 'What kind of scent do you lean towards?',
    askBudget: 'Budget for the smallest decant?',
    askWho: 'Who will wear it?',
    askName: 'Which fragrance do you like? Type its name, e.g. Creed Aventus or Dior Sauvage.',
    answer: 'Here are three picks that fit.',
    answerFor: 'Three picks for {what}:',
    caution: { en: 'Heads-up: strong {what} — worth a 3 ml decant first.', bn: 'Kheyal korun: {what} beshi bojha jay — age 3 ml diye try korun.', bs: 'খেয়াল করুন: {what} বেশ বোঝা যায় — আগে 3 ml দিয়ে ট্রাই করুন।' },
    cheaperLike: { en: 'Cheaper like this', bn: 'Kom dame emon', bs: 'কম দামে এমন' },
    // Chat-style answer lines (chosen by what the visitor asked for; rotated so a thread doesn't repeat itself)
    chat: {
      en: {
        both: ['Something {vibe} for {occ}{price}? Here are three I\'d try:', 'For {occ}, I\'d go {vibe}{price}. Three to start with:', 'Three {vibe} picks for {occ}{price}:'],
        vibe: ['Something {vibe}{price}? Here are three I think you\'ll like:', 'Three {vibe} ones worth a try{price}:', 'Here are three {vibe} picks{price}:'],
        occ: ['For {occ}{price}, these three are a good start:', 'Three good picks for {occ}{price}:', 'Here are three for {occ}{price}:'],
        none: ['Here are three that fit{price}:', 'Three picks that fit{price}:', 'These three fit{price}:'],
        stronger: ', on the stronger side', softer: ', on the softer side',
        under: ' under ৳{max}', over: ' from ৳{min} up', between: ' between ৳{min} and ৳{max}',
        nothing: ', nothing {neg}', really: 'really ',
      },
      bn: {
        both: ['{occ} er jonno {vibe} kichu{price}? Ei tinta try kore dekhen:', '{occ} e {vibe} kichu chaile{price} — ei tinta bhalo hobe:', '{occ} er jonno {vibe}{price} — amar tinta pick:'],
        vibe: ['{vibe} kichu{price}? Ei tinta dekhen:', '{vibe} vibe er moddhe{price} ei tinta try korte paren:', '{vibe}{price} — ei tinta bhalo lagbe:'],
        occ: ['{occ} er jonno{price} ei tinta bhalo hobe:', '{occ} er jonno{price} amar tinta pick:', '{occ} e porar moto{price} ei tinta:'],
        none: ['Ei tinta apnar shathe mile{price}:', 'Ei tinta dekhen{price}:', 'Amar tinta pick{price}:'],
        stronger: ', ektu strong dike', softer: ', ektu halka dike',
        under: ' ৳{max} er moddhe', over: ' ৳{min} er upore', between: ' ৳{min} theke ৳{max} er moddhe',
        nothing: ', {neg} chara', really: 'onek ',
      },
      bs: {
        both: ['{occ} জন্য {vibe} কিছু{price}? এই তিনটা দেখুন:', '{occ} জন্য {vibe} কিছু চাইলে{price} — এই তিনটা ভালো হবে:', '{occ} জন্য {vibe}{price} — আমার তিনটা পছন্দ:'],
        vibe: ['{vibe} কিছু{price}? এই তিনটা দেখুন:', '{vibe}{price} — এই তিনটা ভালো লাগবে:', '{vibe} ধাঁচের{price} এই তিনটা দেখতে পারেন:'],
        occ: ['{occ} জন্য{price} — এই তিনটা ভালো হবে:', '{occ} জন্য{price} — আমার তিনটা পছন্দ:', '{occ} জন্য{price} — এই তিনটা দেখুন:'],
        none: ['এই তিনটা আপনার সাথে মিলবে{price}:', 'এই তিনটা দেখুন{price}:', 'আমার তিনটা পছন্দ{price}:'],
        stronger: ', একটু কড়া ধাঁচের', softer: ', একটু হালকা ধাঁচের',
        under: ' ৳{max}-এর মধ্যে', over: ' ৳{min}-এর উপরে', between: ' ৳{min} থেকে ৳{max}-এর মধ্যে',
        nothing: ', {neg} ছাড়া', really: 'খুব ',
      },
    },
    exclusiveBrandNote: '{brand} is in our Exclusive collection (rare bottles, full advance payment).',
    askVibeFor: 'Got it — {what}. What kind of scent do you lean towards?',
    more: 'Three more that fit.',
    noMore: "That's everything that fits what you've told me. Remove a constraint above, or start over.",
    anchorCatalog: 'Closest to {name} in our catalogue:',
    anchorStocked: 'We stock {name} itself — these are the closest alternatives:',
    anchorRef: 'Closest matches to {name} by scent profile:',
    communityRef: 'often compared to {name} by Fragrantica users',
    unknownAnchor: "I couldn't find that one, so here are matches based on what you've told me so far.",
    unknownAnchorOnly: "I couldn't find that one. Try another name, or tell me what you like — fresh, sweet, office, a budget.",
    notUnderstood: "I didn't understand: {words}. Try words like fresh, sweet, office, or a fragrance name.",
    notUnderstoodAnswer: "I didn't understand: {words} — so these follow what you told me before.",
    nothingNew: 'Nothing new to go on there. Tell me a vibe, an occasion, a budget, or a fragrance name — or tap a quick reply.',
    status: '{n} quick replies below.',
    unisexNote: "We currently stock men's and unisex decants, so these focus on unisex options that suit gifting.",
    womenNote: "We currently stock men's and unisex decants, so these are unisex picks that suit women too.",
    womenNoteBn: 'Amader kache ekhon chele ar unisex decant ache, tai egula unisex — meyeder jonno o bhalo.',
    womenNoteBs: 'আমাদের কাছে এখন ছেলেদের আর ইউনিসেক্স ডিক্যান্ট আছে, তাই এগুলো ইউনিসেক্স — মেয়েদের জন্যও ভালো।',
    strongerNote: 'Leans stronger: higher concentration and a heavier profile.',
    softerNote: 'Leans softer: lighter concentration and a fresher profile.',
    exclusiveNote: 'Showing rare and exclusive bottles, as asked.',
    relaxed: 'Nothing matched everything, so I relaxed {what}.',
    relaxCheaper: 'the cheaper-than limit', relaxPrice: 'the price limit', relaxGender: 'the gender filter',
    relaxCollection: 'the collection filter', relaxThreshold: 'the scent match',
    cheaper: 'Cheaper than ৳{price}:',
    noCheaper: "I couldn't find a cheaper match, so here are the closest alternatives.",
    // Relational follow-ups: each pick must be fresher / sweeter / stronger than the last #1 overall.
    axisTitle: { fresh: 'Fresher than {name}, and still what you asked for — try these three:', sweet: 'Sweeter than {name}, and still what you asked for — try these three:', strong: 'Stronger than {name}, and still what you asked for — try these three:' },
    axisTitleBs: { fresh: '{name}-এর চেয়ে আরো ফ্রেশ, কিন্তু আপনার চাহিদা মতো — এই তিনটা দেখুন:', sweet: '{name}-এর চেয়ে আরো মিষ্টি, কিন্তু আপনার চাহিদা মতো — এই তিনটা দেখুন:', strong: '{name}-এর চেয়ে আরো কড়া, কিন্তু আপনার চাহিদা মতো — এই তিনটা দেখুন:' },
    axisTitleBn: { fresh: '{name} er cheye aro fresh, kintu apnar chahida moto — ei tinta dekhen:', sweet: '{name} er cheye aro sweet, kintu apnar chahida moto — ei tinta dekhen:', strong: '{name} er cheye aro strong, kintu apnar chahida moto — ei tinta dekhen:' },
    noAxis: { fresh: "Nothing that still fits is fresher than {name} overall, so here are the closest picks.", sweet: "Nothing that still fits is sweeter than {name} overall, so here are the closest picks.", strong: "Nothing that still fits is stronger than {name} overall, so here are the closest picks." },
    compare: 'Side by side:',
    compareNeed: 'Pick a few answers first, then I can compare the top two.',
    vsNote: "I can only compare bottles we stock side by side. For {other}, type 'like {other}'.",
    suitYes: '{name} is listed for {occ} — a good fit. Its character: {profile}.',
    suitNo: "{name} is not usually worn for {occ} (it is listed for {listed}). Its character: {profile}. These fit {occ} better:",
    suitUnknown: '{name}: {profile}. Listed for {listed}.',
    suitPartial: "{name} is not listed for {occ} specifically, but it is for {hit} — workable. Its character: {profile}.",
    honesty: 'Scent sits differently on everyone — start with a 3 ml decant before a bigger size.',
    unavailable: 'The finder is unavailable right now.',
    browseAll: 'Browse all fragrances →',
    whatsapp: 'Ask Nawmee on WhatsApp',
    waIntro: 'Hi! I used Find a Scent on NawmeEssences. My shortlist:',
    waLooking: 'Looking for: ',
    skip: 'Skip', nameChip: 'Alternative to a fragrance I like',
    // Example prompts on the opening screen (tapping one sends it as typed text).
    examples: ['Fresh & clean for the office', 'Like Aventus, but cheaper', 'Sweet for winter nights'],
    // Guided mode: four short questions answered in ONE panel (nothing piles up in the thread).
    guideChip: 'Answer four quick questions',
    stepOf: 'Step {n} of 4',
    stepTitle: { occasion: 'When will you mostly wear it?', vibe: 'What kind of scent do you lean towards?', budget: 'Budget for the smallest decant?', who: 'Who will wear it?' },
    moodsChip: 'Pick a mood instead', vibesChip: 'Back to scent types',
    guideDone: 'Show my picks',
    likeThis: 'More like this', compareLink: 'Compare the top two', brandsLink: 'Other brands',
    follow: { likeCheap: 'Cheaper like #{n}', more: 'Show 3 more', cheaper: 'Cheaper', stronger: 'Stronger', fresher: 'Fresher', sweeter: 'Sweeter', brands: 'Different brands', like: 'More like #{n}', compare: 'Compare #1 and #2', reset: 'Start over' },
    compareRows: { brand: 'Brand', family: 'Family', accords: 'Accords', notes: 'Notes', occasions: 'Occasions', concentration: 'Concentration', price: 'From price' },
    tokenPrefix: { like: 'Like ', not: 'not ', under: 'under ৳', over: 'over ৳', men: 'For men', unisex: 'Unisex', gift: 'Unisex (gift)', stronger: 'Leans stronger', softer: 'Leans softer', exclusive: 'Exclusive', cheaper: 'cheaper than ৳', surprise: 'Surprise: ', ai: '' },
    // Phase 3 (display only, never in the score)
    also: 'People who chose {name} also considered:',
    // Phase 2 — on-device understanding (nothing leaves the browser; nothing loads until asked)
    aiRead: 'I read that as: {what}.',
    serverRead: 'I read that as: {what}.',
    serverWait: 'Thinking…',
    aiNothing: "I couldn't add anything more, so these follow the words I understood.",
    aiConsent: "Want me to understand free text better? Your browser may need a one-time download first.",
    aiConsentChip: "Yes, understand my words better",
    aiOffer: 'I understood only part of that. Want me to understand free text better? It needs a one-time download of about {mb} MB.',
    aiOfferChip: 'Understand my words better (~{mb} MB once)',
    aiLoading: 'Getting ready… {pct}%',
    aiLoadFailed: "That didn't load, so I'll keep using the words I understand.",
    aiNoSupport: "This browser can't do that, so I'll keep using the words I understand.",
    noThanks: 'No thanks',
    // Skill 1 — facts about a bottle we stock (every value comes from finder.json; nothing invented)
    factSmell: '{name} by {brand} — {family}: {accords}.',
    factSmellSelf: '{name} — {family}: {accords}.',
    factNotes: 'Notes: {notes}.',
    factPyramid: 'Top, heart and base notes are split out on the product page.',
    factListed: 'Listed for {occ} · {gender} · {conc}.',
    factListedNoOcc: '{gender} · {conc}.',
    factFrom: 'From ৳{price}',
    factPrice: '{name} starts at ৳{price} for {ml} ml.',
    factPriceSize: '{name} in {ml} ml is ৳{price}.',
    factNoSize: "{name} isn't sold in {ml} ml.",
    factSizes: 'Sizes: {sizes}.',
    factSale: 'On sale — {pct}% off is already included in these prices.',
    factUnisex: '{name} is listed as unisex.',
    factMen: '{name} is listed for men.',
    factStrength: "We don't track wear time, so I can't quote how long it stays. {name} is {conc}, and its profile leans {lean}.",
    factStrengthNoConc: "We don't track wear time, so I can't quote how long it stays. {name}'s concentration isn't listed; its profile leans {lean}.",
    leanStrong: 'stronger — higher concentration and a heavier profile',
    leanSoft: 'softer — lighter concentration and a fresher profile',
    leanMid: 'neither heavy nor light',
    concUnlisted: 'concentration not listed',
    factHave: 'Yes — we stock {name}.',
    factHaveOut: '{name} is out of stock right now. Closest alternatives we have:',
    factBuy: 'Pick a size on the card to add {name} to your cart, or send it to Nawmee on WhatsApp.',
    factSimilar: 'Similar in our catalogue:',
    factExclusive: '{name} is in our Exclusive collection (rare bottle, full advance payment).',
    notStocked: "We don't stock {name}.",
    haveNoBrand: "We don't carry {brand} right now. Tell me which of their bottles you like and I'll find the closest match we stock.",
    haveUnknown: "I couldn't find '{name}' in our catalogue or among the fragrances I know. Ask Nawmee on WhatsApp, or tell me what it smells like and I'll match that.",
    // Skill 2 — conversation (greetings, meta questions, open-ended asks)
    chatGreet: "Hi! Tell me what you're after — a vibe, an occasion, a budget, or a fragrance you like — or tap a quick reply below.",
    chatThanks: "You're welcome! Ask me anything else, or send your shortlist to Nawmee on WhatsApp when you're ready.",
    chatBye: 'Bye for now! Come back any time.',
    chatByeList: 'Bye for now! Your shortlist stays on this page until you close the tab.',
    chatAck: 'Anything else? Try a vibe, an occasion, a budget, or a fragrance name.',
    chatBot: "I'm Nawmee's scent finder, an automated helper, not a person. For a human, message Nawmee on WhatsApp.",
    chatMaker: 'NawmeEssences built me for this shop. I only know our catalogue and our policies.',
    chatLang: "I understand English and Banglish (Bangla in English letters), e.g. 'office er jonno fresh kichu'. Bangla script isn't supported yet.",
    chatHelp: 'Here is what I can do:',
    chatHelpLines: [
      'Find decants by vibe, occasion, budget or who it is for — "fresh for office under 500"',
      'Find alternatives to a fragrance you like — "like Aventus but cheaper"',
      'Compare two bottles we stock — "Hawas Ice vs Sanaya"',
      'Tell you about a bottle: notes, sizes and price — "what does 9PM smell like", "price of Khamrah Qahwa"',
      'Answer delivery, payment, pickup and ordering questions',
      'English or Banglish, typed or with the quick replies below',
    ],
    chatGuide: "Let's narrow it down with four quick questions.",
    chatWhy: 'The grey line under each card is the reason: the notes and occasions that matched your words (or the ones it shares with the bottle you named), then the price. Owner-verified alternatives say so. Nothing here is sponsored.',
    chatWhyNone: "Once you have picks, the grey line under each card shows why it was chosen — the notes and occasions that matched. Nothing is sponsored.",
    chatMoreStart: "Nothing to add to yet — four quick questions and I'll have a first set for you.",
    chatMemory: "I only remember this tab — nothing is kept once you close it. Tell me again what you liked and I'll pick it up from there.",
    chatMemoryList: 'Your current shortlist is above. Tap "More like this" under a card to continue from it, or tell me what to change.',
    chatNew: "I can't list new arrivals yet. Tell me a vibe, an occasion or a budget and I'll pick from everything in stock, or browse the shop.",
    // Skill 3 — shop questions (policies from the About page; delivery amounts from the live settings)
    faqDelivery: 'Delivery is ৳{dhaka} inside Dhaka, ৳{suburb} in the Dhaka suburbs and ৳{outside} anywhere else in Bangladesh.',
    faqDeliveryTime: 'Orders are typically delivered within 1–2 business days in Dhaka and 2–3 business days outside Dhaka.',
    faqDeliveryAdvance: 'To confirm an order, at least the delivery charge is paid in advance.',
    faqAbroad: 'We deliver across Bangladesh. For anywhere else, ask Nawmee on WhatsApp first.',
    faqPayment: 'To confirm an order, pay at least the delivery charge in advance — 30% for orders above ৳2,000, and the full amount for Exclusive bottles. Advance via bKash, Nagad or bank transfer.',
    faqPaymentFixed: 'Prices are fixed; there is no bargaining.',
    faqOrder: 'Pick a size on any card and add it to the cart, then check out with your contact and delivery details. Or send your shortlist to Nawmee on WhatsApp and confirm there.',
    faqOrderAdvance: 'The order is confirmed once the advance is paid (at least the delivery charge).',
    faqAuthentic: 'Yes. Every decant is taken directly from authentic original bottles. We never dilute, mix, or alter the fragrance.',
    faqAuthenticHow: "Decanted with a syringe from the owner's own bottles — what you smell in store is what you get in your decant.",
    faqSizes: 'Decant sizes: 3 ml (about 40–45 sprays), 5 ml (70–75), 10 ml (140–150), 15 ml (210–225) and 30 ml on selected bottles (420–450).',
    faqSizesStart: 'Prices start from ৳{min} for 3 ml and differ per bottle — ask "price of <name>". Start with 3 ml to try; 5 ml is the most popular.',
    faqDecant: 'A perfume decant is a smaller quantity of fragrance transferred from an authentic original bottle into a travel-sized atomizer.',
    faqDecantWhy: 'It lets you try premium fragrances at a fraction of a full bottle\'s price before committing.',
    faqType: 'We sell decants only — measured amounts of the original alcohol-based spray in a glass atomizer. No attars, perfume oils, roll-ons or body sprays.',
    faqTypeSizes: 'Sizes run from 3 ml to 30 ml; ask "sizes" for the spray counts.',
    faqReturns: 'Opened or used decants cannot be returned. If you receive a damaged, missing or incorrect item, contact us within one day with a continuous unboxing video — verified claims get a replacement or refund.',
    faqReturnsCancel: 'Orders cannot be cancelled after confirmation.',
    faqPickup: 'Self-pickup is available from {points} (Dhaka) by prior arrangement on WhatsApp.',
    faqContact: 'Fastest on WhatsApp — tap the link below. You can also reach Nawmee via Facebook Messenger or Instagram.',
    faqOffers: 'Prices are fixed. When a bottle is on sale, its card shows the reduced price. For bulk or gift orders, message Nawmee on WhatsApp.',
    faqTracking: 'For an update on an order you have placed, message Nawmee on WhatsApp with your name and what you ordered.',
    faqMore: 'All policies',
    // bugs round (2026-10-15): bottle looks, Bangla script, skin type, comparisons, glossary
    chatBottle: "I can't see bottles. Tell me the name or the brand, or what it smells like, and I'll find it.",
    banglaHelp: "I can read only a little Bangla script so far. Please type in English or Banglish, e.g. 'office er jonno fresh kichu' or 'mishti perfume 500 taka er moddhe'.",
    banglaNote: "Some of the Bangla words were new to me, so these follow the words I understood — English or Banglish works best.",
    modestNote: "We currently stock men's and unisex decants, so these are the unisex ones that stay clean and close to the skin.",
    sweatNote: 'In heat and sweat, fresh citrus and aquatic scents stay pleasant, while heavy sweet ones can turn cloying. A spray on your shirt as well as your skin helps.',
    sweatNoteBs: 'গরমে আর ঘামে ফ্রেশ, সাইট্রাস আর অ্যাকোয়াটিক ঘ্রাণ ভালো থাকে; ভারী মিষ্টি ঘ্রাণ ঘামে একটু ভারী লাগতে পারে। ত্বকের পাশাপাশি শার্টেও একটা স্প্রে দিন।',
    commuteNoteBs: 'ভিড়ের বাস বা অফিসের জন্য এগুলো হালকা থাকে — আপনার কাছে ভালো লাগবে, আশেপাশের মানুষের কাছে বেশি লাগবে না।',
    skinNoteBs: 'ত্বকের ধরনে পারফিউম খুব একটা বদলায় না — প্রত্যেকের ত্বকে একটু আলাদা লাগে, তাই আগে 3 ml ডিক্যান্ট দিয়ে ট্রাই করুন।',
    sweatNoteBn: 'Gorome ar ghame fresh, citrus ar aquatic scent bhalo thake; bhari mishti scent ghame ektu cloying lagte pare. Skin er pashapashi shirt eo ekta spray din.',
    commuteNote: 'For a crowded bus or office, these stay close and easy — pleasant to you without filling the space around you.',
    commuteNoteBn: 'Bhir bus ba office er jonno egula halka thake — apnar kache bhalo lagbe, ashe pasher manush er kache beshi lagbe na.',
    skinNoteBn: 'Skin type e perfume khub ekta bodlay na — prottek er skin e ektu alada lage, tai age 3 ml decant diye try korun.',
    skinNote: "Skin type doesn't change which bottle suits you much — scent sits differently on everyone, so start with a 3 ml decant and see how it wears on you.",
    cmpListedAll: '{all} are listed for {occ}.',
    cmpListedSome: '{yes} listed for {occ}; {no} not.',
    cmpListedNone: '{none} is listed for {occ}.',
    cmpAxis: '{name} leans {word} overall.',
    cmpAxisTie: 'They are about even on {axis}.',
    cmpWear: "We don't track wear time; by concentration and profile, {name} leans {word}.",
    cmpWearOne: "We don't track wear time, so I can't rank them on it — concentration and profile are what I can show.",
    gloss: {
      edp: 'EDP (Eau de Parfum) is the common strong concentration — roughly 15–20% perfume oil — and most of our catalogue.',
      edt: 'EDT (Eau de Toilette) is lighter — roughly 5–15% perfume oil — fresher on the open and usually softer than the EDP of the same name.',
      edc: 'EDC (Eau de Cologne) is the lightest — around 2–5% oil — a splash-and-refresh concentration.',
      extrait: 'Extrait de Parfum is the richest concentration — roughly 20–40% oil — denser and closer to the skin; Sanaya 40 is our 40% example.',
      parfum: 'Parfum (or pure parfum) is a high concentration, typically 20% oil or more, denser than an EDP.',
      intense: '"Intense" is a flanker name: usually a denser, darker or heavier version of the original EDP, not a fixed concentration.',
      elixir: '"Elixir" is a flanker name for richer, heavier versions of a line (for example Hawas Elixir) — often extrait strength, but it varies by house.',
      concentration: 'Concentration is the share of perfume oil in the bottle: EDC < EDT < EDP < Extrait. Higher usually means denser and heavier, but the actual profile matters more than the label.',
      notes: 'Notes are the ingredients you smell over time: top notes open in the first minutes, heart notes follow, base notes stay longest. Our product pages list all three.',
      accords: 'Accords are the overall character several notes create together — fresh, sweet, woody, amber — the words the finder matches on.',
      clone: 'A clone (or dupe) is a budget fragrance made to smell like a famous one. Here, "Verified alternative" means the owner lists that reference; "often compared to X by Fragrantica users" is community votes.',
      longevity: 'Longevity is how long a fragrance stays noticeable on skin. We do not publish figures — it depends on skin, weather and dose — so start with a 3 ml decant.',
      projection: 'Projection (or sillage) is how far a fragrance radiates from the skin; "beast mode" is slang for very far. We do not rate it; the finder only describes concentration and profile.',
      niche: 'Designer houses (Dior, YSL, Armani) sell widely; niche houses (Xerjoff, Amouage, Mancera) are smaller, pricier and less common; clone houses (Lattafa, Armaf, Afnan) make affordable takes on both.',
      unisex: "Unisex means the house markets it to anyone; in practice it is about the scent, not the label. Our catalogue is men's and unisex.",
      flanker: 'A flanker is a spin-off of an existing fragrance under the same name (Hawas → Hawas Ice), sharing the bottle shape and part of the DNA.',
      decant: 'A decant is a measured amount of the original fragrance transferred into a smaller atomizer — what we sell, in 3 ml to 30 ml.',
    },
    glossConc: 'Higher concentration generally means a denser, heavier scent; the finder uses it together with the profile when you ask for "stronger" or "lighter".',
  };

  // ── tuning (vector weights MUST stay identical to js/recs.js) ──
  const WEIGHTS = { f: 2, a: 2, n: 1, o: 1, g: 1.5, k: 0.5, b: 1, w: 0.5 };
  const EVENT_W = { v: 1, c: 3, s: 0.5 };
  const HALF_LIFE_DAYS = 14, EXPIRY_DAYS = 90, DAY = 864e5;
  const SIGNALS_KEY = 'nawme_signals', STATE_KEY = 'nawme_finder';
  const QUERY_SHARE = 0.85, PROFILE_SHARE = 0.15, BS_BONUS = 0.05, STRENGTH_BONUS = 0.08, PRICE_PEN = 0.10;
  const MIN_COS = 0.05, BRAND_CAP = 2, ANSWER_SIZE = 3, CHEAP_DEFAULT = 300, ANCHOR_FEATURE_SHARE = 0.6;
  const VERIFIED_BONUS = 1;   // owner-entered inspired_by match: always first (scores are ≤ ~1.1 otherwise)
  const ANCHOR_COS_SHARE = 0.5;   // "like X": 0.5 · cosine + 0.5 · coverage of X's profile (see coverage())
  // Phase 1c: typed questions are logged anonymously (text + match count only; never for chips).
  const LOG_QUERIES = true, LOG_TABLE = 'finder_queries';
  // Phase 2: on-device understanding is tried only when the deterministic parser is lost
  // (≥ 4 words and ≥ 2 unknown content words, or nothing parsed at all).
  // Layer C: server-side understanding (server understanding), asked only when the parser is unsure.
  const SERVER_NLU = true, SERVER_NLU_PATH = '/functions/v1/finder-understand', SERVER_TIMEOUT_MS = 10000;
  const NLU_MIN_WORDS = 4, NLU_MIN_UNKNOWN = 2, NLU_TIMEOUT_MS = 4000, NLU_CONSENT_KEY = 'nawme_finder_ai';
  const WA_FALLBACK = '8801988536843', CDN = 'https://cdn.nawmeessences.com';

  // ── built-in word lists (unioned with the lexicon's; the lexicon may be richer) ──
  const NEG = ['not', 'no', "don't", 'dont', 'without', 'hate', 'hates', 'hated', 'hating', 'dislike', 'dislikes', 'disliked', 'cant stand', 'cannot stand', 'allergic to', 'not a fan of', 'not into', 'sick of', 'tired of', 'bored of', 'fed up with', 'no more', 'avoid', 'never', 'nothing', 'na', 'noy', 'chai na', 'nai', 'except'];
  const SUFFIX_NEG = /(^|\s)(na|noy|nai|noi|nah|nei|chaina|nope|না|নাই|নেই|নয়)$/;
  const BOUND_WORDS = ['but', 'kintu', 'tobe', 'however', 'for', 'jonno', 'jonne', 'with', 'except', 'কিন্তু', 'তবে', 'জন্য'];   // "no vanilla FOR office": the window never crosses these
  const MILD_WORDS = ['too', 'overly', 'so', 'very', 'much', 'beshi', 'onek', 'বেশি', 'অনেক', 'খুব'];
  // "less sweet" / "mishti kom": a mild rejection (−0.5), not a wish and not a hard "no"
  const LESS = ['less', 'lesser', 'kom', 'komano', 'reduce', 'reduced', 'lighter on', 'easy on', 'go easy on', 'tone down', 'toned down', 'low on', 'কম'];   // "not too sweet" = a little sweet, not "no sweet"
  const ANTI_TRIGGERS = ['different from', 'unlike', 'not like', 'anything but', 'nothing like', 'opposite of', 'different than'];
  const INT = { 'বেশি': 1.3, 'অনেক': 1.3, 'খুব': 1.3, 'একটু': 0.5, very: 1.3, too: 1.3, really: 1.3, super: 1.3, extremely: 1.4, 'a bit': 0.5, slightly: 0.5, little: 0.5, 'a little': 0.5, somewhat: 0.6, beshi: 1.3, onek: 1.3, ektu: 0.5, 'ek tu': 0.5 };
  const GENDER = { women: ['for her', 'her', 'wife', 'girlfriend', 'gf', 'mom', 'mother', 'sister', 'women', 'woman', 'ladies', 'female', 'meye', 'bou'], men: ['for him', 'him', 'husband', 'boyfriend', 'bf', 'dad', 'brother', 'men', 'man', 'male', 'chele'] };
  const STRENGTH = { stronger: ['strong', 'stronger', 'powerful', 'heavy', 'intense', 'shokto', 'kora'], softer: ['soft', 'softer', 'subtle', 'light', 'not loud', 'quiet', 'close to skin', 'halka', 'office safe'] };
  const EXCL = ['rare', 'vintage', 'discontinued', 'exclusive', 'collector'];
  const PMAX = ['under', 'below', 'upto', 'up to', 'max', 'maximum', 'within', 'less than', 'cheaper than', 'at most', 'not more than', 'no more than', 'around', 'about', 'budget of', 'max budget', 'under budget'];
  const PMAX_POST = ['মধ্যে', 'এর মধ্যে', 'নিচে', 'এর নিচে', 'ভিতরে', 'er moddhe', 'moddhe', 'er modhe', 'modhe', 'er niche', 'niche', 'r moddhe', 'er bhitor', 'bhitor', 'er bhitore'];
  const PMIN = ['over', 'above', 'more than', 'at least', 'minimum', 'from', 'starting', 'starting from'];
  const PMIN_POST = ['উপরে', 'এর উপরে', 'এর বেশি', 'er upore', 'upore', 'er beshi', 'r upore'];
  const CHEAP = ['cheap', 'cheapest', 'budget', 'sasta', 'shosta', 'sosta', 'dam kom', 'kom dam', 'kom dame', 'kom damer', 'affordable', 'inexpensive', 'low price', 'lowest price', 'low budget'];
  const CUR = ['taka', 'tk', 'bdt', '৳', 'tak', 'টাকা', 'টাকার', 'টাকায়', 'টক'];
  const TRIGGERS = ['like', 'similar to', 'smells like', 'smell like', 'smelling like', 'alternative to', 'alternatives to', 'alternative of', 'alternative for', 'dupe of', 'dupe for', 'dupes of', 'clone of', 'clones of', 'same as', 'instead of', 'close to', 'reminds me of', 'version of', 'inspired by', 'copy of', 'moto'];
  const POST_TRIGGERS = ['type', 'er moto', 'r moto', 'er mto', 'er moton'];
  const DIFF_BRANDS = ['different brand', 'different brands', 'other brand', 'other brands', 'another brand', 'new brands', 'onno brand', 'onno brands'];
  const UNISEX = ['ইউনিসেক্স', 'unisex', 'anyone', 'for anyone', 'both'];
  const CONJ = ['to', 'and', 'theke'];
  const SELF_WEAR = ['on me', 'for me', 'for myself', 'on myself', 'i wear', 'i will wear', 'ill wear', 'i would wear', 'when i wear', 'i can wear', 'i want to wear', 'i wanna wear', 'me to wear', 'amar gaye', 'ami porle', 'ami dile', 'ami porbo', 'ami use korbo', 'nije porbo', 'amar jonno', 'nijer jonno'];
  const HARD_STOP = new Set(['but', 'and', 'under', 'over', 'below', 'above', 'within', 'upto', 'max', 'min', 'cheaper', 'cheap', 'budget', 'not', 'no', 'na', 'chai', 'jonno', 'jonne', 'kichu', 'with', 'without', 'that', 'which', 'something', 'anything', 'please', ',', '৳', 'or', 'kintu']);
  const GENERIC = new Set(['eau', 'de', 'la', 'le', 'les', 'du', 'des', 'pour', 'homme', 'femme', 'man', 'men', 'woman', 'women', 'him', 'her', 'for', 'the', 'and', 'of', 'edp', 'edt', 'edc', 'parfum', 'extrait', 'intense', 'elixir', 'cologne', 'toilette', 'concentree', 'absolu', 'by', 'a', 'an', 'no', 'new']);
  const STOP = new Set(('others কিন্তু তবে changing change changed else speak speaking languages language করা যায় যাবে পারব পারবো পারবেন দিয়ে থেকে সাথে কাছে কে কেউ সব সবাই কোনো কোনও যদি তাহলে তো পারফিউম পারফিউমের জন্য জন্যে চাই চাচ্ছি একটা একটি কিছু আমার আমি আমাকে আমাদের কোনটা কোন কি কী কেমন কত কিভাবে টা টি এর দিন দেন দাও দিবেন লাগবে লাগে আছে হবে হয় করে করেন করো করার কেনার কিনতে কিনব কিনবো নিব নিবো নেব দরকার একটু এমন যেটা যা তা ও এ এই সেই ওই এটা ওটা আর এবং বা নাকি মত মতো দেখান দেখাও বলুন বলো আপনি আপনার আপনারা তুমি তোমার a an the and or but for with without to of in on at by from as is are am be was were it its this that these those i me my we our you your he she they them his her their what which who whom when where why how do does did dont want wants wanted need needs like likes love loves looking look find show give get suggest recommend recommendation please pls plz thanks thank something anything some any thing things kind type sort one ones more less most very too really quite just also only all each every both few many much lot lots good nice best better great perfect ideal maybe would could should can will shall may might must have has had having if then than so such own same other another different new old use used using wear wearing wears smell smells smelling scent scents perfume perfumes fragrance fragrances decant decants bottle bottles ml size sizes taka tk bdt price prices budget under over below above between within around about upto up max min guys bro bhai apu ami amar amake ache achhe hoy hobe hole korar kore korte korbo kori koro ekta akta lagbe dorkar dekhan dekhao dekhte dao din deben ta ti gula gulo er e te r ki kono keu kew jeta jei je jonno jonne jonnoe chai chaii kichu kisu valo bhalo parbo parben amra tumi apni apnar tomar help wanna gonna kinda idea ideas option options suggestion suggestions tell know think feel').split(' '));

  // ── small helpers ───────────────────────────────────────────
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? vars[k] : ''));
  const union = (a, b) => { const out = []; [].concat(a || [], b || []).forEach(x => { if (x && out.indexOf(x) < 0) out.push(x); }); return out; };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const isNum = t => /^\d+$/.test(t);
  const isWord = t => /^[a-zÀ-ɏঀ-৿]+$/.test(t);
  const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const joinAnd = arr => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' & ' + arr[arr.length - 1]);
  const effectivePrice = (price, sp) => (sp > 0 ? Math.round(price * (100 - sp) / 100) : price);

  // Lower-case, keep digits and ৳, turn sentence punctuation into a "," boundary
  // token (negation / intensifier / anchor windows never cross it), split glued
  // units ("500tk", "5ml", "1k"), collapse spaces. Lexicon phrases go through the
  // same function, so both sides always agree.
  // Number words → digits ("eight hundred" → 800, "pach sho" → 500, "ek hajar" → 1000), so prices typed in words parse
  // and a word like "eight" is never typo-corrected into a vibe word ("night").
  const NUM_UNIT = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const NUM_BN = { ek: 1, dui: 2, tin: 3, char: 4, pach: 5, panch: 5, choy: 6, chhoy: 6, sat: 7, at: 8, noy: 9, dosh: 10, dos: 10, egaro: 11, baro: 12, ponero: 15, bish: 20, pochish: 25, trish: 30, chollish: 40, ponchash: 50, shat: 60, sottor: 70, ashi: 80, nobboi: 90 };
  const NUM_SCALE = { hundred: 100, thousand: 1000, sho: 100, shoto: 100, hajar: 1000, hazar: 1000, lakh: 100000, lac: 100000 };
  function numberWords(text) {
    const tk = text.split(' '), out = []; let cur = 0, has = false, lone = '';
    // a lone "one" is an idiom ("which one", "the first one"), never a number; anything else in a group becomes digits
    const flush = () => { if (has) out.push(lone === 'one' ? 'one' : String(cur)); cur = 0; has = false; lone = ''; };
    for (let i = 0; i < tk.length; i++) {
      const w = tk[i], nxt = tk[i + 1];
      if (w === 'and' && has && NUM_UNIT[nxt] != null) continue;
      if (NUM_UNIT[w] != null) {
        // "twenty five" and "eight hundred fifty" continue a number; "five five" or "one two" do not
        const continues = has && ((cur >= 100 && cur % 100 === 0) || (cur >= 20 && cur % 10 === 0 && NUM_UNIT[w] < 10));
        if (!continues) flush();
        lone = has ? '' : w; cur += NUM_UNIT[w]; has = true; continue;
      }
      if (NUM_BN[w] != null && NUM_SCALE[nxt] != null) { flush(); cur = NUM_BN[w]; has = true; continue; }   // "pach sho", "ek hajar"
      if (NUM_SCALE[w] != null && (has || NUM_SCALE[w] <= 1000)) { cur = (has ? cur : 1) * NUM_SCALE[w]; has = true; lone = ''; continue; }
      flush(); out.push(w);
    }
    flush(); return out.join(' ');
  }
  function normalize(text) {
    return numberWords(String(text == null ? '' : text).toLowerCase()
      .replace(/[০-৯]/g, d => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))   // Bengali numerals → digits (৫০০ → 500)
      .replace(/([a-z])[‘’']s\b/g, '$1')   // women's → women, dad's → dad
      .replace(/[‘’']/g, '')
      .replace(/(\d)[,.](?=\d{3}\b)/g, '$1')
      .replace(/\b(\d+)[.,](\d{1,2})\s*k\b/g, (m, a, b) => String(Math.round(parseFloat(a + '.' + b) * 1000)))
      .replace(/[,;.!?]+/g, ' , ')
      .replace(/</g, ' under ').replace(/>/g, ' over ')
      .replace(/৳/g, ' ৳ ')
      .replace(/(\d)(k|ml|tk|taka|bdt)\b/g, '$1 $2')
      .replace(/[^a-z0-9৳,À-ɏঀ-৿\s]+/g, ' ')
      .replace(/\b(?:millilit(?:er|re)s?|mls)\b/g, 'ml')
      .replace(/\s+/g, ' ').trim());
  }
  const tokensOf = text => normalize(text).split(' ').filter(Boolean);

  function lev(a, b, max) {
    if (a === b) return 0;
    const la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    let prev = [], cur = [];
    for (let j = 0; j <= lb; j++) prev[j] = j;
    for (let i = 1; i <= la; i++) {
      cur = [i]; let rowMin = i;
      for (let j = 1; j <= lb; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowMin) rowMin = cur[j];
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[lb];
  }
  // Typo distance for names: one edit allowed per 4 letters (max 2), so "savage" →
  // "sauvage" (1) passes while "savage" → "sahare" (2 of 6) does not; bare names
  // (no "like …") allow a single edit from 6 letters. Returns -1 when too far.
  function dist(a, b, strict) {
    if (a === b) return 0;
    const n = Math.min(a.length, b.length);
    if (n < 4) return -1;
    const tol = strict ? (n >= 6 ? 1 : 0) : Math.min(2, Math.floor(n / 4));
    if (!tol) return -1;
    const d = lev(a, b, tol);
    return d <= tol ? d : -1;
  }
  const fuzzyEq = (a, b, strict) => dist(a, b, strict) >= 0;

  // ── structured query (the stable contract) ─────────────────
  function emptyQuery() {
    return { anchor: null, features: {}, maxPrice: null, minPrice: null, cheaper: false, refPrice: null, gender: null, note: null, strength: null, collection: null, exclude: [], unknown: [] };
  }
  function mergeQuery(prev, next) {
    prev = prev || emptyQuery(); next = next || {};
    const q = emptyQuery();
    q.anchor = next.anchor || prev.anchor || null;
    Object.keys(prev.features || {}).forEach(k => { q.features[k] = prev.features[k]; });
    Object.keys(next.features || {}).forEach(k => {
      const v = next.features[k], old = q.features[k];
      q.features[k] = old != null && Math.sign(old) !== Math.sign(v) ? v : clamp((old || 0) + v, -2, 2);
    });
    q.maxPrice = next.maxPrice != null ? next.maxPrice : (prev.maxPrice != null ? prev.maxPrice : null);
    q.minPrice = next.minPrice != null ? next.minPrice : (prev.minPrice != null ? prev.minPrice : null);
    q.cheaper = next.cheaper ? true : (next.maxPrice != null ? false : !!prev.cheaper);
    q.refPrice = q.cheaper ? (next.refPrice != null ? next.refPrice : (prev.refPrice != null ? prev.refPrice : null)) : null;
    q.gender = next.gender || prev.gender || null;
    q.note = next.gender ? (next.note || null) : (prev.note || null);
    q.strength = next.strength || prev.strength || null;
    q.collection = next.collection || prev.collection || null;
    q.exclude = union(prev.exclude, next.exclude);
    q.unknown = (next.unknown || []).slice();
    if (next.unknownAnchor) q.unknownAnchor = next.unknownAnchor;
    return q;
  }
  const compose = parts => (parts || []).reduce((q, p) => mergeQuery(q, p), emptyQuery());

  // Feature labels: "a:Sweet" → canonical vocab spelling when the model knows it.
  function canon(prefix, label, model) {
    if (!model || !model.lookup[prefix]) return label;
    const i = model.lookup[prefix].get(String(label).toLowerCase());
    return i == null ? label : model.vocab[prefix][i];
  }
  function addFeat(f, key, w) { f[key] = clamp((f[key] || 0) + w, -2, 2); }
  // One lexicon entry / chip / mood → one part. Later labels of a list weigh a
  // little less than the first (deterministic, so "fresh" leans Fresh > Aromatic).
  function featuresOf(e, w, model) {
    const f = {};
    ['f', 'a', 'n', 'o', 'k', 'w', 'b'].forEach(p => (Array.isArray(e[p]) ? e[p] : []).forEach((label, i) => {
      if (label == null || label === '') return;
      addFeat(f, p + ':' + canon(p, label, model), w * (i === 0 ? 1 : Math.max(0.5, 1 - 0.15 * i)));
    }));
    return f;
  }
  function priceText(min, max) {
    if (min != null && max != null) return { label: '৳' + min + '–' + max, text: min + ' to ' + max };
    if (max != null) return { label: T.tokenPrefix.under + max, text: 'under ' + max };
    return { label: T.tokenPrefix.over + min, text: 'over ' + min };
  }
  function entryPart(e, sign, factor, raw, model) {
    const w = (typeof e.w === 'number' ? e.w : 1) * factor * sign;
    const part = { features: featuresOf(e, w, model), label: (sign < 0 ? T.tokenPrefix.not : '') + raw, text: (sign < 0 ? 'no ' : factor > 1 ? 'very ' : factor < 1 ? 'a bit ' : '') + raw };
    if (sign > 0) {
      if (e.g === 'men' || e.g === 'unisex') part.gender = e.g;
      if (e.gift) part.note = 'unisex';
      if (typeof e.note === 'string' && e.note !== 'unisex') part.note = e.note;   // e.g. 'skin' → an honest note, no gender
      if (e.strength === 'stronger' || e.strength === 'softer') part.strength = e.strength;
      if (e.collection === 'exclusive') part.collection = 'exclusive';
      if (e.price && typeof e.price === 'object') { if (e.price.max != null) part.maxPrice = Number(e.price.max); if (e.price.min != null) part.minPrice = Number(e.price.min); }
    }
    return part;
  }
  // Chip (lexicon chips/moods) → query, merged with the previous one.
  function chipPart(c, model) {
    const part = entryPart(c, 1, 1, c.label || '', model);
    part.label = c.label || '';
    const words = [];
    ['f', 'a', 'n', 'o', 'k', 'b'].forEach(p => (Array.isArray(c[p]) ? c[p] : []).forEach(l => { const w = String(l).toLowerCase(); if (words.indexOf(w) < 0) words.push(w); }));
    if (part.maxPrice != null || part.minPrice != null) words.push(priceText(part.minPrice, part.maxPrice).text);
    if (c.g === 'men') words.push('for men'); else if (c.note === 'women') words.push('for women'); else if (c.g === 'unisex' || c.gift) words.push('unisex');
    if (c.strength) words.push(c.strength); if (c.collection === 'exclusive') words.push('exclusive');
    part.text = words.join(' ');
    return hasEffect(part) ? part : null;
  }
  const hasEffect = p => !!p && (Object.keys(p.features || {}).length > 0 || p.anchor || p.maxPrice != null || p.minPrice != null || p.cheaper || p.gender || p.strength || p.collection || (p.exclude && p.exclude.length));
  function fromChip(chip, prev, model) {
    const part = chip && chipPart(chip, model);
    const q = mergeQuery(prev, part || {});
    q.parts = part ? [part] : [];
    return q;
  }
  // "Surprise me": deterministic by thread turn count.
  function surprisePart(seed, L, model) {
    const vibes = (((L || {}).chips || {}).vibe || []).filter(c => !c.surprise), moods = (L || {}).moods || [];
    const picks = [];
    if (vibes.length) picks.push(vibes[seed % vibes.length]);
    if (moods.length) picks.push(moods[(seed * 7 + 3) % moods.length]);
    const parts = picks.map(c => chipPart(c, model)).filter(Boolean);
    if (!parts.length) return null;
    const q = compose(parts);
    return { features: q.features, label: T.tokenPrefix.surprise + picks.map(c => c.label).join(' + '), text: parts.map(p => p.text).join(' ') };
  }

  // ── phrase index (lexicon + vocab labels + built-ins), cached per (lexicon, model) ──
  let INDEX = null;
  function getIndex(L, model) {
    if (INDEX && INDEX.L === L && INDEX.model === model) return INDEX;
    const idx = new Map(); let maxLen = 1;
    const add = (phrase, unit) => {
      const p = normalize(phrase); if (!p || p === ',') return;
      const n = p.split(' ').length; if (n > maxLen) maxLen = n;
      if (!idx.has(p)) idx.set(p, []);
      idx.get(p).push(unit);
    };
    L = L || {};
    (L.entries || []).forEach(e => (e.m || []).forEach(m => add(m, { kind: 'entry', data: e })));
    (L.moods || []).forEach(e => (e.m || []).forEach(m => add(m, { kind: 'entry', data: e })));
    (L.refs || []).forEach(r => (r.m || []).forEach(m => add(m, { kind: 'ref', data: r })));
    union(L.negations, NEG).forEach(w => add(w, { kind: 'neg', data: SUFFIX_NEG.test(normalize(w)) }));
    const ints = Object.assign({}, INT, L.intensifiers || {});
    Object.keys(ints).forEach(w => add(w, { kind: 'int', data: Number(ints[w]) || 1 }));
    const gw = L.genderWords || {};
    union(gw.women, GENDER.women).forEach(w => add(w, { kind: 'gender', data: 'women' }));
    union(gw.men, GENDER.men).forEach(w => add(w, { kind: 'gender', data: 'men' }));
    const st = L.strength || {};
    union(st.stronger, STRENGTH.stronger).forEach(w => add(w, { kind: 'strength', data: 'stronger' }));
    union(st.softer, STRENGTH.softer).forEach(w => add(w, { kind: 'strength', data: 'softer' }));
    union(L.exclusiveWords, EXCL).forEach(w => add(w, { kind: 'excl' }));
    PMAX.forEach(w => add(w, { kind: 'pmax' })); PMAX_POST.forEach(w => add(w, { kind: 'pmaxpost' }));
    PMIN.forEach(w => add(w, { kind: 'pmin' })); PMIN_POST.forEach(w => add(w, { kind: 'pminpost' }));
    CHEAP.forEach(w => add(w, { kind: 'cheap' })); add('cheaper', { kind: 'cheaper' }); add('between', { kind: 'between' }); LESS.forEach(w => add(w, { kind: 'less' }));
    CONJ.forEach(w => add(w, { kind: 'conj' })); CUR.forEach(w => add(w, { kind: 'cur' })); add('ml', { kind: 'ml' });
    TRIGGERS.forEach(w => add(w, { kind: 'trigger' })); POST_TRIGGERS.forEach(w => add(w, { kind: 'ptrigger' }));
    ANTI_TRIGGERS.forEach(w => add(w, { kind: 'antitrigger' }));
    DIFF_BRANDS.forEach(w => add(w, { kind: 'diffbrands' })); UNISEX.forEach(w => add(w, { kind: 'unisex' }));
    if (model) {
      model.vocab.b.forEach((name, i) => add(name, { kind: 'brand', data: { name, i } }));
      // Lexicon brand aliases ("armani" → Giorgio Armani); aliases for brands we do not stock are ignored here.
      const aliases = L.brandAliases || {};
      Object.keys(aliases).forEach(alias => { const i = model.vocab.b.findIndex(b => String(b).toLowerCase() === String(aliases[alias]).toLowerCase()); if (i >= 0) add(alias, { kind: 'brand', data: { name: model.vocab.b[i], i } }); });
      ['f', 'a', 'n', 'o', 'k'].forEach(p => model.vocab[p].forEach(label => add(label, { kind: 'vocab', data: { p, label, w: 1 } })));
      model.vocab.w.forEach(label => add(label, { kind: 'vocab', data: { p: 'w', label, w: 0.7 } }));
    }
    // Single lexicon/vocab words for the typo fallback ("frsh" → fresh, "swet" → sweet).
    const words = []; idx.forEach((units, k) => { if (k.indexOf(' ') < 0 && k.length >= 4 && units.some(u => ['entry', 'vocab', 'strength', 'gender', 'brand'].indexOf(u.kind) >= 0)) words.push(k); });
    INDEX = { L, model, idx, maxLen, words };
    return INDEX;
  }
  // Closest known word within one edit (two for long words); null when ambiguous or too far.
  const KIND_RANK = { entry: 0, strength: 1, gender: 1, brand: 2, vocab: 3 };
  const isSubsequence = (a, b) => { let i = 0; for (const ch of b) if (ch === a[i]) i++; return i === a.length; };
  function typoFix(index, t) {
    if (t.length < 4) return null;
    const tol = t.length >= 10 ? 2 : 1; let best = null, n = 0;
    for (const w of index.words) {
      const d = lev(t, w, tol); if (d > tol) continue;
      // A 4-letter word may only be a dropped letter ("frsh" → fresh), never a substitution ("year" → pear).
      if (t.length === 4 && !(w.length === 5 && isSubsequence(t, w))) continue;
      const units = kindsAt(index, w); let rank = 9; units.forEach(u => { const r = KIND_RANK[u.kind] == null ? 9 : (u.kind === 'vocab' && u.data && u.data.p === 'w' ? 4 : KIND_RANK[u.kind]); if (r < rank) rank = r; });
      // A dropped double letter ("swet" → sweet, "offce" → office) is the commonest slip: it wins ties.
      if (w.length === t.length + 1 && /(.)\1/.test(w) && w.replace(/(.)\1/, '$1') === t) rank -= 0.5;
      if (!best || d < best.d || (d === best.d && rank < best.rank)) { best = { w, d, rank }; n = 1; } else if (d === best.d && rank === best.rank) n++;
    }
    return best && n === 1 ? best.w : null;   // one clear winner (a vibe word beats a description keyword at the same distance)
  }
  const kindsAt = (index, phrase) => index.idx.get(phrase) || [];
  const hasKind = (units, kind) => units.some(u => u.kind === kind);

  // ── catalogue / reference name resolution ("like savage", "aventus type") ──
  function nameTokens(it, model) {
    if (!it._nt) {
      const bt = tokensOf(model.vocab.b[it.b] || '');
      const nt = tokensOf(it.nm);
      let st = nt.slice();
      if (bt.length && bt.every((t, k) => nt[k] === t)) st = nt.slice(bt.length);
      it._nt = nt; it._st = st; it._full = union(bt, nt);
    }
    return it;
  }
  // Generic name words ("le", "homme", "intense", numbers) match exactly; everything else allows typos.
  // Name words that cost nothing when left untyped (articles, prepositions, gender words); flanker markers
  // like 'intense' / 'elixir' / 'edp' are NOT free, so a bare 'hawas' is Hawas for Him, not Hawas Elixir.
  const FREE_WORDS = new Set(['eau', 'de', 'la', 'le', 'les', 'du', 'des', 'pour', 'homme', 'femme', 'man', 'men', 'woman', 'women', 'him', 'her', 'for', 'the', 'and', 'of', 'by', 'a', 'an']);
  const tokEq = (c, t, strict) => ((GENERIC.has(c) || isNum(c)) ? c === t : fuzzyEq(c, t, strict));
  // lex: indices of C that are lexicon words (bare runs only) — they may complete a name
  // ("dior homme SPORT 2017") but never carry a match on their own ("lattafa sweet" is a brand + a vibe).
  function resolveName(C, model, L, index, strict, lex) {
    if (!C.length) return null;
    const first = C[0];
    // A plain lexicon word ("fresh") never anchors a product on its own.
    const firstIsWord = kindsAt(index, first).some(u => u.kind === 'entry' || u.kind === 'vocab' || u.kind === 'strength' || u.kind === 'gender');
    if (model) {
      let best = null;
      for (const it of model.items) {
        nameTokens(it, model);
        const used = []; let real = 0, generic = 0, edits = 0;
        C.forEach((c, ci) => {
          const g = GENERIC.has(c) || isNum(c);
          let d = -1; it._full.forEach(t => { const x = g ? (t === c ? 0 : -1) : dist(c, t, strict); if (x >= 0 && (d < 0 || x < d)) d = x; });
          if (d >= 0) { used.push(ci); edits += d; if (g) generic++; else real++; }
        });
        if (!real) continue;
        // Longest contiguous run of span tokens inside the full name: generic words count
        // here, so "le male", "dior homme", "le beau" resolve to the stocked product.
        let run = { len: 0, s: 0, own: false };
        for (let s = 0; s < C.length; s++) for (let t = 0; t < it._full.length; t++) {
          let k = 0; while (s + k < C.length && t + k < it._full.length && tokEq(C[s + k], it._full[t + k], strict)) k++;
          let own = false; for (let i = s; i < s + k; i++) if (!lex || !lex.has(i)) own = true;
          if (k > run.len || (k === run.len && own && !run.own)) run = { len: k, s, own };
        }
        if (lex && lex.size && (run.len < 2 || !run.own || used.some(i => lex.has(i) && (i < run.s || i >= run.s + run.len)))) continue;
        const prefix = it._st.length > 0 && !GENERIC.has(first) && !firstIsWord && fuzzyEq(first, it._st[0], strict);
        if (!(real >= 2 || prefix || run.len >= 2)) continue;
        let cover = 0; it._nt.forEach(t => { if (C.some(c => tokEq(c, t, strict))) cover++; });
        // Each of the name's own words (not generic like 'for him' / 'pour homme', not a number) left
        // untyped costs a little, so a bare 'hawas' is Hawas for Him rather than the flanker Hawas Ice.
        const own = it._nt.filter(t => !FREE_WORDS.has(t) && !isNum(t)), ownCovered = own.filter(t => C.some(c => tokEq(c, t, strict))).length;
        const score = real + 0.3 * generic + 0.5 * cover / Math.max(1, it._nt.length) - 0.1 * (own.length - ownCovered) + (prefix ? 0.2 : 0) + 0.2 * run.len + 0.01 * (it.bs || 0) - 0.3 * edits;
        if (!best || score > best.score || (score === best.score && it.idx < best.item.idx)) best = { score, item: it, used, edits };
      }
      // The catalogue wins unless a reference-lexicon name is clearly closer (two edits fewer), or the
      // typed name IS a famous reference and only a flanker of it is stocked ("khamrah" → we stock
      // Khamrah Qahwa: say "closest matches to Lattafa Khamrah", never "we stock Khamrah itself").
      if (best) {
        const r = resolveRef(C, L, strict);
        if (r && best.edits >= 2 && best.edits - r.edits >= 2) return r;
        const st = best.item._st; let lastCovered = -1;
        st.forEach((t, i) => { if (C.some(c => tokEq(c, t, strict))) lastCovered = i; });
        const flankerSuffix = st.slice(lastCovered + 1).some(t => !GENERIC.has(t)) && !st.slice(0, lastCovered).some(t => !GENERIC.has(t) && !C.some(c => tokEq(c, t, strict)));
        if (r && r.edits === 0 && r.used.length === C.length && flankerSuffix) return r;
        return { kind: 'catalog', item: best.item, used: best.used };
      }
      // A leading brand name ("dior …") — unless a reference phrase covers more of the span ("dior sauvage").
      const r = resolveRef(C, L, strict);
      for (let bi = 0; bi < model.vocab.b.length; bi++) {
        const bt = tokensOf(model.vocab.b[bi]);
        if (bt.length && bt.every((t, k) => C[k] != null && fuzzyEq(C[k], t, true)) && !(r && r.used.length > bt.length)) return { kind: 'brand', name: model.vocab.b[bi], used: bt.map((_, k) => k) };
      }
      return r;
    }
    return resolveRef(C, L, strict);
  }
  function resolveRef(C, L, strict) {
    let bestRef = null;
    ((L || {}).refs || []).forEach(r => (r.m || []).forEach(m => {
      const pt = tokensOf(m); if (!pt.length) return;
      for (let s = 0; s + pt.length <= C.length; s++) {
        let edits = 0, ok = true;
        for (let k = 0; k < pt.length && ok; k++) { const d = dist(C[s + k], pt[k], strict && pt.length === 1); if (d < 0) ok = false; else edits += d; }
        if (!ok) continue;
        const score = pt.length - 0.01 * s - 0.3 * edits;
        if (!bestRef || score > bestRef.score) { const used = []; for (let k = 0; k < pt.length; k++) used.push(s + k); bestRef = { score, ref: r, used, edits }; }
      }
    }));
    return bestRef ? { kind: 'ref', ref: bestRef.ref, used: bestRef.used, edits: bestRef.edits } : null;
  }
  function anchorFrom(res) {
    if (res.kind === 'catalog') return { kind: 'catalog', id: res.item.id, name: res.item.nm };
    if (res.kind === 'ref') return { kind: 'ref', name: res.ref.name || (res.ref.m && res.ref.m[0]) || '', ref: res.ref };
    return null;
  }
  function anchorPart(anchor) {
    return { anchor, label: T.tokenPrefix.like + anchor.name, text: 'like ' + String(anchor.name).toLowerCase() };
  }

  // ── the parser: free text → structured query (deterministic) ──
  // ctx: { lastBrands: [...], refPrice } — brands already shown (for "different
  // brands") and the reference price for a relational "cheaper".
  function parse(text, lexicon, model, ctx) {
    const L = lexicon || {}; ctx = ctx || {};
    const index = getIndex(L, model);
    const tokens = tokensOf(text);
    const consumed = tokens.map(() => false);
    const parts = [];
    let anchor = null, unknownAnchor = null, hadTrigger = false;

    const spanAfter = start => { const s = []; for (let j = start; j < tokens.length && s.length < 6; j++) { if (consumed[j] || HARD_STOP.has(tokens[j])) break; if (isNum(tokens[j]) && (hasKind(kindsAt(index, tokens[j + 1] || ''), 'cur') || tokens[j + 1] === 'ml')) break; s.push(j); } return s; };
    const spanBefore = end => { const s = []; for (let j = end - 1; j >= 0 && s.length < 6; j--) { if (consumed[j] || HARD_STOP.has(tokens[j])) break; s.unshift(j); } return s; };
    const settle = (span, strict, bare, lex, post) => {
      const C = span.map(j => tokens[j]);
      const res = resolveName(C, model, L, index, strict, lex);
      if (res) {
        res.used.forEach(ci => { consumed[span[ci]] = true; });
        if (res.kind === 'brand') { const f = {}; f['b:' + res.name] = 1; parts.push({ features: f, label: res.name, text: res.name.toLowerCase() }); return true; }
        if (!anchor) { anchor = anchorFrom(res); parts.push(anchorPart(anchor)); }
        return true;
      }
      if (bare) return false;
      // Unknown name after a trigger: only the leading tokens nobody understands (never a
      // lexicon word; a leading generic word like "le" is skipped, never reported).
      const lead = [];
      // "X type" / "X er moto": the unknown name must sit right before the trigger, read backwards ("… barite use korbo ar dark type" names nothing)
      const order = post ? span.slice().reverse() : span;
      for (const j of order) { const t = tokens[j]; if (GENERIC.has(t) && !lead.length) continue; if (kindsAt(index, t).length || STOP.has(t) || GENERIC.has(t) || !(isWord(t) || isNum(t))) break; lead.push(j); if (lead.length >= 4) break; }
      if (post) lead.reverse();
      if (lead.length && !unknownAnchor) { unknownAnchor = lead.map(j => tokens[j]).join(' '); lead.forEach(j => { consumed[j] = true; }); return true; }
      return false;
    };
    // 1. triggered anchors ("like X", "alternative to X", "X type") and anti-anchors ("different from X")
    for (let i = 0; i < tokens.length; i++) {
      if (consumed[i]) continue;
      let tl = 0, post = false, anti = false;
      for (let n = Math.min(3, tokens.length - i); n >= 1 && !tl; n--) {
        const ks = kindsAt(index, tokens.slice(i, i + n).join(' '));
        if (hasKind(ks, 'antitrigger')) { tl = n; anti = true; } else if (hasKind(ks, 'trigger')) tl = n; else if (hasKind(ks, 'ptrigger')) { tl = n; post = true; }
      }
      if (!tl) continue;
      const span = post ? spanBefore(i) : spanAfter(i + tl);
      if (!span.length) continue;
      if (anti) {   // exclude that product (catalogue) — a famous name just drops out of the sentence
        const res = resolveName(span.map(j => tokens[j]), model, L, index, false);
        if (res) { res.used.forEach(ci => { consumed[span[ci]] = true; }); for (let k = 0; k < tl; k++) consumed[i + k] = true; }
        if (res && res.kind === 'catalog') parts.push({ exclude: ['id:' + res.item.id], label: T.tokenPrefix.not + res.item.nm, text: 'different from ' + String(res.item.nm).toLowerCase() });
        continue;
      }
      hadTrigger = true;
      if (settle(span, false, false, null, post)) for (let k = 0; k < tl; k++) consumed[i + k] = true;
    }
    // 2. phrase units over what is left (longest phrase first, whole tokens)
    const units = [];
    for (let i = 0; i < tokens.length;) {
      if (consumed[i]) { i++; continue; }
      const t = tokens[i];
      if (t === ',') { units.push({ pos: i, len: 1, raw: t, kinds: [{ kind: 'bound' }] }); i++; continue; }
      if (isNum(t)) { const k = tokens[i + 1] === 'k' && !consumed[i + 1]; units.push({ pos: i, len: k ? 2 : 1, raw: t, kinds: [{ kind: 'num', data: Number(t) * (k ? 1000 : 1) }] }); i += k ? 2 : 1; continue; }
      let hit = null, hl = 0;
      for (let n = Math.min(index.maxLen, tokens.length - i); n >= 1 && !hit; n--) {
        let ok = true; for (let j = i; j < i + n; j++) if (consumed[j] || tokens[j] === ',') { ok = false; break; }
        if (!ok) continue;
        const ks = kindsAt(index, tokens.slice(i, i + n).join(' '));
        if (ks.length) { hit = ks; hl = n; }
      }
      if (hit) { units.push({ pos: i, len: hl, raw: tokens.slice(i, i + hl).join(' '), kinds: hit }); i += hl; }
      else {
        const fixed = !STOP.has(t) && isWord(t) ? typoFix(index, t) : null;
        if (fixed) units.push({ pos: i, len: 1, raw: fixed, typo: t, kinds: kindsAt(index, fixed) });
        else units.push({ pos: i, len: 1, raw: t, kinds: [{ kind: 'word' }] });
        i++;
      }
    }
    const kindOf = (u, k) => (u ? u.kinds.find(x => x.kind === k) : null);
    // A comma / contrast word ends a window; a brand / strength / gender / exclusive word
    // "takes" the negation, so "not lattafa strong" excludes the brand and keeps "strong".
    const bounds = units.filter(u => u.kinds[0].kind === 'bound' || BOUND_WORDS.indexOf(u.raw) >= 0).map(u => u.pos);
    const blocked = (a, b) => bounds.some(p => p > a && p < b);
    const closers = units.filter(u => ['brand', 'strength', 'gender', 'excl', 'unisex'].some(k => hasKind(u.kinds, k))).map(u => ({ a: u.pos, b: u.pos + u.len - 1 }));
    const closed = (a, b) => closers.some(c => c.a > a && c.b < b);
    const negs = units.filter(u => hasKind(u.kinds, 'neg')).map(u => ({ pos: u.pos, end: u.pos + u.len - 1, suffix: !!u.kinds.find(k => k.kind === 'neg').data }));
    const ints = units.filter(u => hasKind(u.kinds, 'int')).map(u => ({ pos: u.pos, end: u.pos + u.len - 1, f: u.kinds.find(k => k.kind === 'int').data }));
    const negated = u => { const e = u.pos + u.len - 1; return negs.some(n => (!n.suffix && u.pos - n.end >= 1 && u.pos - n.end <= 3 && !blocked(n.end, u.pos) && !closed(n.end, u.pos)) || (n.suffix && n.pos - e >= 1 && n.pos - e <= 3 && !blocked(e, n.pos) && !closed(e, n.pos))); };
    // "not TOO sweet" / "not overly sweet": a mild wish for the feature, not a rejection.
    const mild = u => negs.some(n => (!n.suffix && u.pos - n.end >= 2 && u.pos - n.end <= 3 && tokens.slice(n.end + 1, u.pos).some(w => MILD_WORDS.indexOf(w) >= 0))
      || (n.suffix && n.pos - (u.pos + u.len - 1) === 1 && u.pos > 0 && MILD_WORDS.indexOf(tokens[u.pos - 1]) >= 0));   // "beshi mishti na" = not too sweet
    // "less sweet" (before) or "mishti kom" (after): the feature is toned down, never a wish
    const lessers = units.filter(u => hasKind(u.kinds, 'less')).map(u => ({ pos: u.pos, end: u.pos + u.len - 1 }));
    const lessened = u => { const e = u.pos + u.len - 1; return lessers.some(n => (u.pos - n.end >= 1 && u.pos - n.end <= 2 && !blocked(n.end, u.pos)) || (n.pos - e === 1)); };
    const factorOf = u => { const x = ints.find(n => u.pos - n.end >= 1 && u.pos - n.end <= 2 && !blocked(n.end, u.pos)); return x ? x.f : 1; };
    // Does a matched phrase ("for my wife") contain a "for her" word? Then the unisex note applies.
    const womenIn = raw => { const tk = raw.split(' '); for (let i = 0; i < tk.length; i++) for (let n = 1; n <= 3 && i + n <= tk.length; n++) if (kindsAt(index, tk.slice(i, i + n).join(' ')).some(k => k.kind === 'gender' && k.data === 'women')) return true; return false; };
    // 3. bare names ("sauvage cheaper", "dior homme sport 2017", "hawas ice", "lattafa"): runs of
    //    unmatched words, numbers and brand names; lexicon words may continue a run a brand or
    //    unknown word started. A resolved name consumes its tokens first, so a year inside a
    //    product name is never read as a price and its brand is not a separate part.
    const LEX_KINDS = ['entry', 'vocab', 'ref', 'strength', 'gender', 'excl', 'unisex'];
    const NAME_SAFE = ['word', 'num', 'brand'].concat(LEX_KINDS);
    let run = [], runLex = new Set(), nrun = [];
    const flush = () => { if (run.length && !anchor) settle(run, true, true, runLex); run = []; runLex = new Set(); };
    // A negated bottle name ("no more hawas", "not 9pm") excludes that bottle; a negated famous name just drops out.
    const flushNeg = () => {
      if (nrun.length) {
        const res = resolveName(nrun.map(j => tokens[j]), model, L, index, true);
        if (res && (res.kind === 'catalog' || res.kind === 'ref')) res.used.forEach(ci => { consumed[nrun[ci]] = true; });
        if (res && res.kind === 'catalog') parts.push({ exclude: ['id:' + res.item.id], label: T.tokenPrefix.not + res.item.nm, text: 'not ' + String(res.item.nm).toLowerCase() });
      }
      nrun = [];
    };
    units.forEach(u => {
      const k0 = u.kinds[0].kind, namey = hasKind(u.kinds, 'brand') || hasKind(u.kinds, 'ref');   // a brand or famous-name phrase is name-like, not a vibe word
      const lexical = !namey && LEX_KINDS.some(k => hasKind(u.kinds, k));
      const nameSafe = !consumed[u.pos] && u.kinds.every(k => NAME_SAFE.indexOf(k.kind) >= 0)
        && (k0 === 'num' || namey || (k0 === 'word' ? !STOP.has(u.raw) && isWord(u.raw) : lexical && run.length > 0));
      if (nameSafe && !hasKind(u.kinds, 'brand') && !lexical && negated(u)) { flush(); for (let k = 0; k < u.len; k++) nrun.push(u.pos + k); return; }
      flushNeg();
      const ok = nameSafe && !negated(u);
      if (!ok) { flush(); return; }
      for (let k = 0; k < u.len; k++) { if (lexical) runLex.add(run.length); run.push(u.pos + k); }
    });
    flush(); flushNeg();
    // 3a. prices
    let sawPrice = false;
    const done = new Set();
    units.forEach((u, ui) => {
      const num = kindOf(u, 'num'); if (!num || done.has(ui)) return;
      if (consumed[u.pos]) { done.add(ui); return; }   // part of a product name ("Dior Homme Sport 2017")
      const next = units[ui + 1], next2 = units[ui + 2];
      if (next && (kindOf(next, 'ml'))) { done.add(ui); return; }
      let k = ui - 1; while (k >= 0 && kindOf(units[k], 'cur')) k--;
      const before = ui - k <= 3 ? units[k] : null;
      const numAfter = next && kindOf(next, 'num') && !consumed[next.pos] ? next : (next && kindOf(next, 'conj') && next2 && kindOf(next2, 'num') && !consumed[next2.pos] ? next2 : null);
      let part = null;
      if (numAfter) {
        const other = numAfter.kinds[0].data;
        part = { minPrice: Math.min(num.data, other), maxPrice: Math.max(num.data, other) }; done.add(units.indexOf(numAfter));
      } else if (before && (kindOf(before, 'pmin'))) part = { minPrice: num.data };
      else if (before && (kindOf(before, 'pmax') || kindOf(before, 'cheap') || kindOf(before, 'between'))) part = { maxPrice: num.data };
      else if (next && kindOf(next, 'pminpost')) part = { minPrice: num.data };
      else if (next && kindOf(next, 'pmaxpost')) part = { maxPrice: num.data };
      else if ((next && kindOf(next, 'cur')) || (ui > 0 && kindOf(units[ui - 1], 'cur')) || num.data >= 100) part = { maxPrice: num.data };
      if (!part) return;
      done.add(ui); sawPrice = true;
      Object.assign(part, priceText(part.minPrice != null ? part.minPrice : null, part.maxPrice != null ? part.maxPrice : null));
      parts.push(part);
    });
    // "my wife will love it ON ME" / "for myself": the wearer is the visitor, so a woman mentioned
    // in the sentence is not the wearer and must not switch the answer to unisex.
    const joined = ' ' + tokens.join(' ') + ' ';
    const selfWear = SELF_WEAR.some(p => joined.indexOf(' ' + p + ' ') >= 0);
    // 3b. everything else
    units.forEach(u => {
      if (consumed[u.pos]) return;   // part of a resolved product name
      const ks = u.kinds; const isMild = mild(u); const less = !isMild && lessened(u); const neg = !isMild && (negated(u) || less); const factor = isMild || less ? 0.5 : factorOf(u);
      const negWord = less ? 'less ' : T.tokenPrefix.not, negText = less ? 'less ' : 'no ';
      const entries = ks.filter(k => k.kind === 'entry');
      const gender = kindOf(u, 'gender'), strength = kindOf(u, 'strength');
      // A word that is also a strength / gender / exclusive / negation word is not a description keyword
      // ("strong" → Leans stronger, never a w:strong pull on products whose text merely says "strong").
      const slotWord = !!(gender || strength || kindOf(u, 'excl') || kindOf(u, 'neg') || kindOf(u, 'unisex'));
      let entryGender = null;
      if (entries.length) {
        const sign = neg ? -1 : 1, f = neg && factor > 1 ? 0.5 : factor;
        const merged = compose(entries.map(k => entryPart(k.data, sign, f, u.raw, model)));
        // "not (too) expensive" / "no budget-breaker": a price ceiling at the entry's own threshold, not a wish for luxury accords
        const pmin = entries.map(k => k.data.price && k.data.price.min).find(v => v != null);
        if (pmin != null && (neg || isMild) && !sawPrice) { if (!parts.some(p => p.maxPrice != null)) parts.push(Object.assign({ maxPrice: Number(pmin) }, priceText(null, Number(pmin)))); return; }
        const prim = Object.keys(entries[0].data || {}).find(k => ['f', 'a', 'n', 'o', 'k'].indexOf(k) >= 0) || null;
        const part = { primary: prim, features: merged.features, label: (neg ? negWord : '') + u.raw, text: (neg ? negText : f > 1 ? 'very ' : f < 1 ? 'a bit ' : '') + u.raw };
        if (merged.gender && !(selfWear && merged.gender === 'unisex' && womenIn(u.raw))) {
          part.gender = entryGender = merged.gender; part.note = merged.note || (merged.gender === 'unisex' && womenIn(u.raw) ? 'unisex' : null);
          part.label = T.tokenPrefix[part.note === 'unisex' ? 'gift' : merged.gender];   // the spec label; `text` keeps the phrase so the share link re-parses
        }
        const noted = entries.find(k => typeof k.data.note === 'string' && k.data.note !== 'unisex');
        if (noted && !neg) part.note = noted.data.note;   // e.g. skin type → an honest note with the answer
        if (merged.strength) part.strength = merged.strength;
        if (merged.collection) part.collection = merged.collection;
        if (merged.maxPrice != null && !sawPrice) part.maxPrice = merged.maxPrice;
        if (merged.minPrice != null && !sawPrice) part.minPrice = merged.minPrice;
        if (hasEffect(part)) parts.push(part);
      } else {
        const vocabs = ks.filter(k => k.kind === 'vocab' && !(slotWord && k.data.p === 'w'));
        if (vocabs.length) {
          const f = {}; const sign = neg ? -1 : 1, fac = neg && factor > 1 ? 0.5 : factor;
          vocabs.forEach(k => addFeat(f, k.data.p + ':' + k.data.label, sign * fac * k.data.w));
          parts.push({ primary: vocabs[0].data.p === 'w' ? 'a' : vocabs[0].data.p, features: f, label: (neg ? negWord : '') + u.raw, text: (neg ? negText : '') + u.raw });
        }
      }
      const brand = kindOf(u, 'brand');
      if (brand) { if (neg) parts.push({ exclude: ['brand:' + brand.data.name], label: T.tokenPrefix.not + brand.data.name, text: 'not ' + u.raw }); else { const f = {}; f['b:' + brand.data.name] = 1; parts.push({ features: f, label: brand.data.name, text: u.raw }); } }
      const ref = kindOf(u, 'ref');
      if (ref && !anchor && !neg) {
        // A famous name typed bare: the catalogue is tried first (we may stock it), then the reference profile.
        const span = []; for (let k = 0; k < u.len; k++) span.push(u.pos + k);
        if (!settle(span, true, true)) { anchor = anchorFrom({ kind: 'ref', ref: ref.data }); parts.push(anchorPart(anchor)); }
      }
      if (gender && !neg && !entryGender && !(selfWear && gender.data === 'women')) parts.push(gender.data === 'women' ? { gender: 'unisex', note: 'unisex', label: T.tokenPrefix.gift, text: 'unisex' } : { gender: 'men', label: T.tokenPrefix.men, text: 'for men' });
      if (kindOf(u, 'unisex') && !neg && !gender && !entryGender) parts.push({ gender: 'unisex', label: T.tokenPrefix.unisex, text: 'unisex' });
      if (strength && !entries.length) { const s = neg ? (strength.data === 'stronger' ? 'softer' : 'stronger') : strength.data; parts.push({ strength: s, label: T.tokenPrefix[s], text: s }); }
      if (kindOf(u, 'excl') && !neg) parts.push({ collection: 'exclusive', label: T.tokenPrefix.exclusive, text: 'exclusive' });
      if (kindOf(u, 'diffbrands')) { const bs = (ctx.lastBrands || []).filter(Boolean); if (bs.length) parts.push({ exclude: bs.map(b => 'brand:' + b), label: T.follow.brands, text: bs.map(b => 'not ' + b.toLowerCase()).join(', ') }); }
      if (kindOf(u, 'cheaper') && !sawPrice) { const r = ctx.refPrice != null ? ctx.refPrice : null; parts.push({ cheaper: true, refPrice: r, label: r != null ? T.tokenPrefix.cheaper + r : T.follow.cheaper, text: r != null ? 'under ' + r : 'cheaper' }); }
      if (kindOf(u, 'cheap') && !sawPrice && !units.some(x => kindOf(x, 'num') && !consumed[x.pos])) { if (!parts.some(p => p.maxPrice != null)) parts.push(Object.assign({ maxPrice: CHEAP_DEFAULT }, priceText(null, CHEAP_DEFAULT))); }
    });
    // The same feature rejected and wished for in one message ("i hate sweet… everything is too
    // sweet these days"): the rejection wins; a wish that loses all its features is dropped.
    const negKeys = new Set();
    parts.forEach(p => { const ks = Object.keys(p.features || {}); if (ks.length && ks.every(k => p.features[k] < 0)) ks.forEach(k => negKeys.add(k)); });
    if (negKeys.size) for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i], ks = Object.keys(p.features || {});
      if (!ks.length || ks.every(k => p.features[k] < 0)) continue;
      ks.forEach(k => { if (p.features[k] > 0 && negKeys.has(k)) delete p.features[k]; });
      if (!hasEffect(p)) parts.splice(i, 1);
    }
    // 4. unknown words (alphabetic, ≥ 4 letters, not a stop-word, not consumed)
    const unknown = [];
    units.forEach(u => { if (u.kinds[0].kind === 'word' && !consumed[u.pos] && isWord(u.raw) && u.raw.length >= 4 && !STOP.has(u.raw) && unknown.indexOf(u.raw) < 0 && unknown.length < 6) unknown.push(u.raw); });
    if (unknownAnchor && unknown.indexOf(unknownAnchor) < 0) unknown.unshift(unknownAnchor);
    // One part per gender / strength / collection slot (the last mention wins).
    ['gender', 'strength', 'collection'].forEach(slot => { for (let i = parts.length - 1, seen = false; i >= 0; i--) if (parts[i][slot] && !parts[i].features && !parts[i].anchor) { if (seen) parts.splice(i, 1); seen = true; } });
    const own = compose(parts);
    own.unknown = unknown;
    if (unknownAnchor) own.unknownAnchor = unknownAnchor;
    const q = ctx.prev ? mergeQuery(ctx.prev, own) : own;
    q.parts = parts; q.hadTrigger = hadTrigger;
    return q;
  }
  function hasTrigger(text, L, model) {
    const index = getIndex(L || {}, model), tk = tokensOf(text);
    for (let i = 0; i < tk.length; i++) for (let n = 1; n <= 3 && i + n <= tk.length; n++) { const ks = kindsAt(index, tk.slice(i, i + n).join(' ')); if (hasKind(ks, 'trigger') || hasKind(ks, 'ptrigger')) return true; }
    return false;
  }

  // ── vectors (key-for-key identical to js/recs.js, plus w<idx>) ──
  function vectorize(it) {
    const v = new Map();
    const add = (k, w) => v.set(k, (v.get(k) || 0) + w);
    (it.f || []).forEach(i => add('f' + i, WEIGHTS.f));
    (it.a || []).forEach(i => add('a' + i, WEIGHTS.a));
    (it.n || []).forEach(i => add('n' + i, WEIGHTS.n));
    (it.o || []).forEach(i => add('o' + i, WEIGHTS.o));
    if (it.g) add('g' + it.g, WEIGHTS.g);
    if (it.k >= 0) add('k' + it.k, WEIGHTS.k);
    if (it.b >= 0) add('b' + it.b, WEIGHTS.b);
    (it.kw || []).forEach(i => add('w' + i, WEIGHTS.w));
    let n = 0; v.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1;
    v.forEach((w, k) => v.set(k, w / n));
    return v;
  }
  function normalizeVec(v) { let n = 0; v.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1; v.forEach((w, k) => v.set(k, w / n)); return v; }
  function prepareData(data) {
    if (!data || data.v !== 1 || !Array.isArray(data.items)) return null;
    const vocab = Object.assign({ b: [], f: [], a: [], n: [], o: [], k: [], w: [], r: [] }, data.vocab || {});
    const lookup = {};
    ['b', 'f', 'a', 'n', 'o', 'k', 'w', 'r'].forEach(p => { lookup[p] = new Map(); (vocab[p] || []).forEach((label, i) => { const k = String(label).toLowerCase(); if (!lookup[p].has(k)) lookup[p].set(k, i); }); });
    const byId = new Map();
    const items = data.items.map((it, idx) => { const m = Object.assign({}, it, { idx, vec: vectorize(it) }); byId.set(it.id, m); return m; });
    return { vocab, lookup, items, byId, src: data.src || '' };
  }
  function queryVector(query, model) {
    const v = new Map();
    const f = (query && query.features) || {};
    Object.keys(f).forEach(k => {
      const m = /^([fanokbw]):(.+)$/.exec(k); if (!m || !f[k]) return;
      const i = model.lookup[m[1]].get(m[2].toLowerCase()); if (i == null) return;
      v.set(m[1] + i, (v.get(m[1] + i) || 0) + f[k] * WEIGHTS[m[1]]);
    });
    return normalizeVec(v);
  }
  function refVector(ref, model) {
    const v = new Map();
    ['f', 'a', 'n'].forEach(p => (ref[p] || []).forEach((label, i) => { const idx = model.lookup[p].get(String(label).toLowerCase()); if (idx != null) v.set(p + idx, (v.get(p + idx) || 0) + WEIGHTS[p] * (i === 0 ? 1 : Math.max(0.5, 1 - 0.15 * i))); }));
    return normalizeVec(v);
  }
  // Anchor vector (catalogue product or reference profile); extra typed features
  // ("like X but sweeter") tilt it instead of being dropped.
  function buildQueryVec(query, model) {
    const qv = queryVector(query, model);
    const a = query.anchor;
    if (!a) return qv;
    let av = null;
    if (a.kind === 'catalog') { const it = model.byId.get(a.id); if (it) av = new Map(it.vec); }
    else if (a.kind === 'ref') { const ref = a.ref || refFor(a.name, model); if (ref) av = refVector(ref, model); }
    if (!av || !av.size) return qv;
    if (qv.size) { qv.forEach((w, k) => av.set(k, (av.get(k) || 0) + ANCHOR_FEATURE_SHARE * w)); normalizeVec(av); }
    return av;
  }
  let REFS = null;   // set by the browser init / tests so a restored ref anchor keeps its profile
  function refFor(name, model) {
    const n = normalize(name);
    return ((REFS || (INDEX && INDEX.L && INDEX.L.refs) || [])).find(r => normalize(r.name) === n || (r.m || []).some(m => normalize(m) === n)) || null;
  }

  // ── tier-1 profile (read-only copy of recs.js rules) ──
  function readSignals() {
    try {
      if (typeof localStorage === 'undefined') return [];
      const raw = localStorage.getItem(SIGNALS_KEY); if (!raw) return [];
      const d = JSON.parse(raw); if (!d || d.v !== 1 || !Array.isArray(d.e)) return [];
      const cutoff = Date.now() - EXPIRY_DAYS * DAY;
      return d.e.filter(e => e && typeof e.id === 'string' && e.ts > cutoff);
    } catch (e) { return []; }
  }
  function priceOf(item, ml) {
    if (ml) { const s = (item.s || []).find(x => x[0] === Number(ml)); if (s) return effectivePrice(s[1], item.sp); }
    return item.p;
  }
  function buildProfile(signals, model) {
    if (signals && signals.items && model && !model.items) { const t = signals; signals = model; model = t; }   // (model, signals) order also accepted
    const vec = new Map(), ids = new Set();
    let weight = 0, logSum = 0;
    const now = Date.now();
    for (const ev of signals || []) {
      const item = model && model.byId.get(ev.id); if (!item) continue;
      ids.add(ev.id);
      const w = (EVENT_W[ev.t] || 0) * Math.pow(0.5, Math.max(0, now - ev.ts) / DAY / HALF_LIFE_DAYS);
      if (!w) continue;
      weight += w; logSum += w * Math.log(priceOf(item, ev.ml));
      item.vec.forEach((x, k) => vec.set(k, (vec.get(k) || 0) + w * x));
    }
    normalizeVec(vec);
    return { vec, weight, logP: weight ? logSum / weight : 0, ids };
  }
  function cosine(a, b) {
    let s = 0; const small = a.size < b.size ? a : b, big = small === a ? b : a;
    small.forEach((x, k) => { const y = big.get(k); if (y) s += x * y; });
    return s;
  }
  // Share of the query's positive weight that the item carries. Cosine alone
  // punishes richly described products (16 notes → a long vector → low cosine
  // even when every note of the reference is there), which hid the real clones:
  // for "like Bleu de Chanel" Club de Nuit Iconic carries 80% of the profile
  // but ranked 5th by cosine. Anchor queries blend the two.
  function coverage(q, v) {
    let s = 0, t = 0; q.forEach((w, k) => { if (w > 0) { t += w; if (v.has(k)) s += w; } });
    return t ? s / t : 0;
  }

  // ── character axes: the OVERALL profile of a fragrance ──
  // A vibe word ("fresh") must describe the whole fragrance, not one note: a sweet
  // amber with a bergamot top note is not "fresh". Accords are listed in dominance
  // order in the data, so the first accords weigh most; the family and (for
  // strength) the concentration add a little. Scores land in [-1, 1].
  const AXES = {
    fresh: { plus: { fresh: 1, citrus: 1, aquatic: 1, marine: 1, ozonic: 1, green: 0.8, aromatic: 0.6, 'fresh spicy': 0.5, mineral: 0.5, herbal: 0.5, salty: 0.5, tea: 0.3, soapy: 0.4 },
             minus: { sweet: 1, vanilla: 0.9, gourmand: 1, caramel: 0.8, chocolate: 0.8, cacao: 0.8, honey: 0.6, amber: 0.7, oud: 0.6, boozy: 0.6, 'warm spicy': 0.5, tobacco: 0.5, leather: 0.4, smoky: 0.4 },
             fam: { fresh: 0.5, citrus: 0.5, aquatic: 0.5, green: 0.4, gourmand: -0.5, vanilla: -0.5, oriental: -0.3 } },
    sweet: { plus: { sweet: 1, vanilla: 1, gourmand: 1, caramel: 0.9, chocolate: 0.8, cacao: 0.8, honey: 0.7, coconut: 0.6, lactonic: 0.5, almond: 0.5, fruity: 0.4, boozy: 0.3, tonka: 0.5 },
             minus: { fresh: 1, citrus: 0.8, aquatic: 0.8, marine: 0.8, ozonic: 0.8, green: 0.8, herbal: 0.5, mossy: 0.5, mineral: 0.5 },
             fam: { gourmand: 0.5, vanilla: 0.5, fresh: -0.5, citrus: -0.5, aquatic: -0.5, green: -0.4 } },
    strong: { plus: { oud: 1, amber: 0.8, leather: 0.8, tobacco: 0.8, smoky: 0.8, animalic: 0.8, 'warm spicy': 0.7, balsamic: 0.6, boozy: 0.6, patchouli: 0.5, woody: 0.4, sweet: 0.3, vanilla: 0.3 },
              minus: { aquatic: 0.9, marine: 0.9, ozonic: 0.9, fresh: 0.8, citrus: 0.8, green: 0.6, soapy: 0.5, tea: 0.5, mineral: 0.5 },
              fam: { oriental: 0.4, leather: 0.4, fresh: -0.4, aquatic: -0.5, citrus: -0.4 },
              conc: { extrait: 0.6, parfum: 0.5, 'edp intense': 0.5, elixir: 0.5, edp: 0.1, edt: -0.3, edc: -0.5 } },
  };
  const AXIS_W = 0.3, AXIS_STEP = 0.05, AXIS_FLOOR = 0.1;   // "fresher" = fresher than #1 AND at least leaning fresh overall
  // Which axes a query cares about, from its signed features and strength: { fresh: 1, sweet: -0.5, strong: 1 }.
  const AXIS_OF = { 'a:fresh': ['fresh', 1], 'a:citrus': ['fresh', 0.8], 'a:aquatic': ['fresh', 1], 'a:marine': ['fresh', 1], 'a:ozonic': ['fresh', 1], 'a:green': ['fresh', 0.6], 'f:fresh': ['fresh', 1], 'f:citrus': ['fresh', 0.8], 'f:aquatic': ['fresh', 1], 'f:green': ['fresh', 0.6],
    'a:sweet': ['sweet', 1], 'a:vanilla': ['sweet', 0.8], 'a:gourmand': ['sweet', 1], 'a:caramel': ['sweet', 0.8], 'a:honey': ['sweet', 0.5], 'a:chocolate': ['sweet', 0.7], 'f:gourmand': ['sweet', 1], 'f:vanilla': ['sweet', 0.8] };
  // An axis counts in proportion to how much of the query is about it: "fresh" is
  // all fresh (≈0.75), while "woody musky office" only brushes it through the
  // office entry's mild fresh tilt (≈0.1), so the woody match still wins.
  function queryAxes(query) {
    const out = {}, f = (query && query.features) || {};
    let total = 0; Object.keys(f).forEach(k => { total += Math.abs(f[k]); });
    Object.keys(f).forEach(k => {
      const m = AXIS_OF[k.toLowerCase()]; if (!m) return;
      out[m[0]] = (out[m[0]] || 0) + f[k] * m[1];
    });
    Object.keys(out).forEach(k => { out[k] = total ? clamp(out[k] / total, -1, 1) : 0; if (Math.abs(out[k]) < 0.02) delete out[k]; });
    return out;   // strength is scored once, by strengthBonus() on the strong axis
  }
  function axisScore(it, axis, model) {
    const A = AXES[axis]; if (!A || !it) return 0;
    let s = 0;
    (it.a || []).forEach((ai, i) => {
      const l = String(model.vocab.a[ai] || '').toLowerCase(), pos = Math.max(0.3, 1 - 0.12 * i);
      if (A.plus[l]) s += A.plus[l] * pos; if (A.minus[l]) s -= A.minus[l] * pos;
    });
    (it.f || []).forEach(fi => { const l = String(model.vocab.f[fi] || '').toLowerCase(); if (A.fam && A.fam[l]) s += A.fam[l]; });
    if (A.conc && it.k >= 0) { const k = String(model.vocab.k[it.k] || '').toLowerCase(); if (A.conc[k]) s += A.conc[k]; }
    return clamp(s / 2.2, -1, 1);
  }

  // ── profile similarity for "like X": what a nose compares, not every feature ──
  // Accords in dominance order (first ones weigh most), shared notes, family, and the
  // three character axes. Brand, occasion, concentration and description keywords are
  // left out on purpose: "more like Hawas Ice" should not favour other Rasasi bottles.
  const SIM_W = { a: 0.45, n: 0.25, f: 0.15, x: 0.15 };
  function accordSim(aIdx, bIdx) {
    const w = i => Math.max(0.3, 1 - 0.12 * i); let s = 0, na = 0, nb = 0;
    aIdx.forEach((x, i) => { na += w(i); const j = bIdx.indexOf(x); if (j >= 0) s += Math.min(w(i), w(j)); });
    bIdx.forEach((x, j) => { nb += w(j); });
    return s ? s / Math.sqrt(na * nb) : 0;
  }
  const jaccard = (A, B) => { if (!A.length || !B.length) return 0; const b = new Set(B); let s = 0; A.forEach(x => { if (b.has(x)) s++; }); return s / (A.length + B.length - s); };
  function profileSim(a, b, model) {
    const ax = ['fresh', 'sweet', 'strong'].reduce((s, k) => s + Math.abs(axisScore(a, k, model) - axisScore(b, k, model)), 0) / 3;
    return SIM_W.a * accordSim(a.a || [], b.a || []) + SIM_W.n * jaccard(a.n || [], b.n || []) + SIM_W.f * jaccard(a.f || [], b.f || []) + SIM_W.x * (1 - ax);
  }
  // A reference fragrance (lexicon) as a pseudo item in the catalogue's index space.
  function refItem(ref, model) {
    const idx = (p, labels) => (labels || []).map(l => model.lookup[p].get(String(l).toLowerCase())).filter(x => x != null);
    return { a: idx('a', ref.a), n: idx('n', ref.n), f: idx('f', ref.f), k: -1, g: 0 };
  }
  const SIM_BOOST = 0.35, CREF_BOOST = 0.45;   // Fragrantica "reminds me of" votes: catalogue pairs / famous references

  // ── ranking ──
  const brandOf = (it, model) => model.vocab.b[it.b] || '';
  // Continuous: a "stronger" request rewards the whole heavy profile (oud, amber,
  // leather, higher concentration), "softer" rewards the light one; ±0.12 at most.
  function strengthBonus(it, strength, model) {
    if (strength !== 'stronger' && strength !== 'softer') return 0;
    return STRENGTH_BONUS * 1.5 * (strength === 'stronger' ? 1 : -1) * axisScore(it, 'strong', model);
  }
  // Ordered candidates after the hard filters, brand-capped while walking, up to opts.limit.
  //   opts: exclude (Set/array of ids), referencePrice, signals | profile, limit, brandCap, minCos,
  //         ignoreCheaper / ignorePrice / ignoreGender / anyCollection (used by answer() to relax)
  function rank(model, query, opts) {
    opts = opts || {}; query = query || emptyQuery();
    if (!model) return [];
    const ex = new Set(opts.exclude instanceof Set ? Array.from(opts.exclude) : (opts.exclude || []));
    if (query.anchor && query.anchor.id) ex.add(query.anchor.id);
    const exBrands = new Set();
    (query.exclude || []).forEach(e => { if (/^id:/.test(e)) ex.add(e.slice(3)); else if (/^brand:/i.test(e)) exBrands.add(e.slice(6).toLowerCase()); });
    const qv = opts.queryVec || buildQueryVec(query, model);
    // The similarity threshold needs something to be similar TO: a purely negative query
    // ("not sweet") only pushes items down, it does not empty the ranking.
    let hasQ = false; qv.forEach(w => { if (w > 0) hasQ = true; });
    // An explicitly requested brand ("rasasi", "something from armaf") is exempt from the brand cap.
    const wanted = new Set(Object.keys(query.features || {}).filter(k => /^b:/.test(k) && query.features[k] > 0).map(k => k.slice(2).toLowerCase()));
    const prof = opts.profile || (opts.signals ? buildProfile(opts.signals, model) : null);
    const refPrice = opts.referencePrice > 0 ? opts.referencePrice : (query.cheaper && query.refPrice > 0 ? query.refPrice : null);
    const minCos = opts.minCos == null ? MIN_COS : opts.minCos;
    const collection = opts.anyCollection ? null : (query.collection === 'exclusive' ? 'e' : 'r');
    const refAnchor = query.anchor && query.anchor.kind === 'ref' && model.vocab.r && model.vocab.r.length ? normalize(query.anchor.name) : null;
    // Anchor profile for profileSim: the catalogue product itself, or the reference's lists.
    const anchorItem = query.anchor ? (query.anchor.kind === 'catalog' ? model.byId.get(query.anchor.id) : refItem(query.anchor.ref || refFor(query.anchor.name, model) || {}, model)) : null;
    const anchorSim = anchorItem && query.anchor.kind === 'catalog' && Array.isArray(anchorItem.sim) ? new Map(anchorItem.sim.map(p => [Number(p[0]), Number(p[1])])) : null;
    const community = !opts.noCommunity;
    // Does a community reference name match the typed reference? ("dior sauvage" ~ "DIOR Sauvage Eau de Parfum")
    const refMatches = n => { if (!refAnchor) return false; const x = normalize(n); return x === refAnchor || x.indexOf(refAnchor) >= 0 || refAnchor.indexOf(x) >= 0; };
    const axes = opts.axes || queryAxes(query), axisKeys = Object.keys(axes).filter(k => axes[k]);
    const axisMin = !opts.ignoreAxis && opts.axisMin && AXES[opts.axisMin.axis] ? opts.axisMin : null;   // relational "fresher than #1"
    const out = [];
    for (const it of model.items) {
      if (!it.i || ex.has(it.id)) continue;
      // A brand asked for by name is shown even when its bottles live in the Exclusive collection (Xerjoff, Amouage).
      if (collection && it.c !== collection && !(it.c === 'e' && wanted.has(brandOf(it, model).toLowerCase()))) continue;
      if (!opts.ignorePrice) {
        if (query.maxPrice != null && it.p > query.maxPrice) continue;
        if (query.minPrice != null && it.p < query.minPrice) continue;
      }
      if (!opts.ignoreGender && query.gender === 'men' && it.g !== 1 && it.g !== 3) continue;
      if (!opts.ignoreGender && query.gender === 'unisex' && it.g !== 3) continue;
      if (exBrands.size && exBrands.has(brandOf(it, model).toLowerCase())) continue;
      if (!opts.ignoreCheaper && query.cheaper && refPrice != null && !(it.p < refPrice)) continue;
      if (axisMin && !(axisScore(it, axisMin.axis, model) > axisMin.min)) continue;
      let cq = qv.size ? (query.anchor ? ANCHOR_COS_SHARE * cosine(qv, it.vec) + (1 - ANCHOR_COS_SHARE) * coverage(qv, it.vec) : cosine(qv, it.vec)) : 0;
      // Measured against Fragrantica's "reminds me of" votes (42 products with voted partners, 2026-10-15):
      // the full vector blend predicts voters better (top-5 64%) than a nose-only profile (57%), so the
      // profile similarity is opt-in (opts.simMode === 'profile') and the votes themselves do the lifting.
      if (anchorItem && opts.simMode === 'profile') cq = 0.5 * cq + 0.5 * profileSim(anchorItem, it, model);
      // An owner-entered inspired_by match (migration 018) is a VERIFIED alternative:
      // it passes the threshold and outranks any scent-profile similarity.
      const verified = refAnchor != null && (it.ref || []).some(ri => normalize(model.vocab.r[ri]) === refAnchor);
      // Fragrantica community votes: this product reminds people of the anchor (catalogue pair),
      // or of the famous reference the visitor named.
      let simW = community && anchorSim && anchorSim.has(it.idx) ? anchorSim.get(it.idx) : 0;
      let crefW = 0; if (community && refAnchor && Array.isArray(it.cref)) it.cref.forEach(p => { if (refMatches(model.vocab.r[Number(p[0])] || '')) crefW = Math.max(crefW, Number(p[1]) || 0); });
      if (hasQ && cq <= minCos && !verified && !simW && !crefW) continue;
      const cp = prof && prof.weight ? cosine(prof.vec, it.vec) : 0;
      let score = QUERY_SHARE * cq + PROFILE_SHARE * cp + BS_BONUS * (it.bs || 0) + strengthBonus(it, query.strength, model) + (verified ? VERIFIED_BONUS : 0) + SIM_BOOST * simW + CREF_BOOST * crefW;
      // Overall character: "fresh" ranks genuinely fresh fragrances above a sweet one with a citrus top note.
      let ax = 0; axisKeys.forEach(k => { ax += axes[k] * axisScore(it, k, model); });
      score += AXIS_W * ax;
      if (refPrice != null) score -= PRICE_PEN * Math.min(1, Math.abs(Math.log(it.p) - Math.log(refPrice)) / Math.log(3));
      const matched = []; qv.forEach((w, k) => { if (w > 0 && it.vec.has(k)) matched.push(k); });
      out.push({ id: it.id, item: it, score, cos: cq, matched, verified, axis: ax, community: crefW > 0 || simW > 0 });
    }
    out.sort((x, y) => (y.score - x.score) || (x.item.p - y.item.p) || (x.item.idx - y.item.idx));
    const cap_ = opts.brandCap == null ? BRAND_CAP : opts.brandCap, limit = opts.limit == null ? ANSWER_SIZE : opts.limit;
    const picks = [], per = new Map();
    for (const r of out) {
      const b = r.item.b;
      if (cap_ && (per.get(b) || 0) >= cap_ && !wanted.has(brandOf(r.item, model).toLowerCase())) continue;
      picks.push(r); per.set(b, (per.get(b) || 0) + 1);
      if (limit && picks.length >= limit) break;
    }
    return picks;
  }
  // rank() plus the relaxation ladder (cheaper → price band → gender → collection → threshold);
  // returns { picks, relaxed: [codes] } so the reply can say what was dropped.
  function answer(model, query, opts) {
    const steps = [];
    if (opts && opts.axisMin) steps.push('axis');
    if (query.cheaper) steps.push('cheaper');
    if (query.maxPrice != null || query.minPrice != null) steps.push('price');
    if (query.gender) steps.push('gender');
    if (query.collection === 'exclusive') steps.push('collection');
    steps.push('threshold');
    const o = Object.assign({}, opts || {});
    let picks = rank(model, query, o); const relaxed = [];
    for (const s of steps) {
      if (picks.length) break;
      relaxed.push(s);
      if (s === 'axis') o.ignoreAxis = true; else if (s === 'cheaper') o.ignoreCheaper = true; else if (s === 'price') o.ignorePrice = true; else if (s === 'gender') o.ignoreGender = true; else if (s === 'collection') o.anyCollection = true; else o.minCos = -1;
      picks = rank(model, query, o);
    }
    // A strong "without X" can leave one or two picks ("sweet but without vanilla"): soften the
    // avoided features to half weight so the answer still has three cards (nothing else changes).
    const limit = o.limit == null ? ANSWER_SIZE : o.limit;
    if (picks.length && picks.length < limit && Object.keys(query.features || {}).some(k => query.features[k] < 0)) {
      const soft = Object.assign({}, query, { features: {} });
      Object.keys(query.features).forEach(k => { soft.features[k] = query.features[k] < 0 ? query.features[k] * 0.5 : query.features[k]; });
      const more = rank(model, soft, o);
      if (more.length > picks.length) picks = more;
    }
    return { picks, relaxed };
  }

  // ── reason line per card (three modes, never invented) ──
  const lowerList = labels => cap(joinAnd(labels.map(l => String(l).toLowerCase())));
  // A label that is both a note and an accord (Vanilla, Lavender, Leather …) is said once.
  const uniq = labels => { const seen = new Set(), out = []; labels.forEach(l => { const k = String(l).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(l); } }); return out; };
  // ── chat-style answer line ──
  const OCC_WORD = {
    en: { Office: 'the office', Everyday: 'everyday wear', 'Date Night': 'a date night', Evening: 'evenings out', Party: 'a party', Wedding: 'a wedding', Formal: 'formal events', Summer: 'summer', Winter: 'winter', 'Gym / Sport': 'the gym', Casual: 'casual days', Festivals: 'festivals', Holiday: 'holidays', Monsoon: 'the rainy season', Spring: 'spring' },
    bn: { Office: 'office', Everyday: 'protidin', 'Date Night': 'date night', Evening: 'shondhay baire', Party: 'party', Wedding: 'biye bari', Formal: 'formal program', Summer: 'gorom', Winter: 'sheet', 'Gym / Sport': 'gym', Casual: 'casual', Festivals: 'utshob', Holiday: 'chhuti', Monsoon: 'borsha', Spring: 'boshonto' },
  };
  // Bangla occasion words are stored in the possessive ("অফিসের", "বিয়ে বাড়ির"): the templates say "{occ} জন্য".
  const OCC_BS = { Office: 'অফিসের', Everyday: 'প্রতিদিনের', 'Date Night': 'ডেট নাইটের', Evening: 'সন্ধ্যার', Party: 'পার্টির', Wedding: 'বিয়ে বাড়ির', Formal: 'ফরমাল অনুষ্ঠানের', Summer: 'গরমের', Winter: 'শীতের', 'Gym / Sport': 'জিমের', Casual: 'ক্যাজুয়াল দিনের', Festivals: 'উৎসবের', Holiday: 'ছুটির', Monsoon: 'বর্ষার', Spring: 'বসন্তের' };
  OCC_WORD.bs = OCC_BS;
  // Bold accords that split opinion: said once per card when the visitor did not ask for them (ScentWise's "risk" line, from our own data).
  const BOLD = { Oud: 'oud', Smoky: 'smoke', Leather: 'leather', Animalic: 'animalic notes', Tobacco: 'tobacco', Patchouli: 'patchouli', Earthy: 'earthy notes', Coffee: 'coffee', Boozy: 'boozy notes', Whiskey: 'whiskey', Rum: 'rum', Anis: 'anise', Anise: 'anise', Metallic: 'metallic notes', Terpenic: 'resinous notes', Salty: 'salty notes', Mossy: 'oakmoss' };
  function cautionFor(it, q, model, lang) {
    const V = model.vocab, f = (q && q.features) || {};
    const top = (it.a || []).slice(0, 3).map(i => V.a[i]).filter(Boolean);
    const hit = top.find(a => BOLD[a] && !(f['a:' + a] > 0) && !(f['n:' + a] > 0) && !(f['f:' + a] > 0));
    if (!hit) return '';
    const LK = lang === 'bs' ? 'bs' : lang === 'bn' ? 'bn' : 'en';
    return fill(T.caution[LK], { what: BOLD[hit] });
  }
  const ACC_WORD = { Citrus: 'citrusy', Leather: 'leathery', Amber: 'warm amber', 'Warm Spicy': 'warm spicy', 'Fresh Spicy': 'peppery', 'Soft Spicy': 'softly spicy', Spicy: 'spicy', Fruity: 'fruity', Smoky: 'smoky', Powdery: 'powdery', Musky: 'musky', Earthy: 'earthy', Mossy: 'mossy', Balsamic: 'balsamic', Animalic: 'animalic', Tropical: 'tropical', Marine: 'marine', Herbal: 'herbal', Lactonic: 'creamy', 'White Floral': 'white floral', Gourmand: 'gourmand' };
  const accWord = a => ACC_WORD[a] || String(a).toLowerCase();
  // Banglish typed messages get Banglish replies (sticky for the thread once seen).
  const BN_MARK = new Set(['jonno', 'jonne', 'kichu', 'kisu', 'lagbe', 'chai', 'amar', 'amr', 'ami', 'korbo', 'korte', 'ekta', 'akta', 'moddhe', 'valo', 'bhalo', 'onek', 'onk', 'beshi', 'dekhen', 'dekhan', 'dao', 'jeta', 'jeita', 'porbo', 'barite', 'bari', 'theke', 'kemon', 'koto', 'ache', 'ase', 'hobe', 'naki', 'apni', 'tumi', 'amake', 'dite', 'nibo', 'kinbo', 'er', 'r', 'ar']);
  const isBanglaScript = text => (String(text || '').match(/[\u0980-\u09FF]+/g) || []).length >= 2;
  const langOf = text => (isBanglaScript(text) ? 'bs' : isBanglish(text) ? 'bn' : null);
  function isBanglish(text) { const tk = tokensOf(text).filter(t => /^[a-z]+$/.test(t)); let n = 0; tk.forEach(t => { if (BN_MARK.has(t)) n++; }); return n >= 2 || (n >= 1 && tk.length <= 3); }
  // q = the composed query; parts = the thread's parts; turnNo picks a variant. Returns { text, folded } (folded: the strength sentence is included).
  // "aro sweet kichu" / "more fresh" / "sweeter one" / "ektu beshi strong" → { axis, text } for the relational follow-up, else null.
  const AXIS_WORDS = { sweet: ['sweet', 'mishti', 'misti', 'sweeter', 'মিষ্টি'], fresh: ['fresh', 'fresher', 'freshi', 'ফ্রেশ'], strong: ['strong', 'stronger', 'kora', 'shokto', 'heavier', 'heavy', 'bhari', 'কড়া'] };
  const AXIS_MORE = new Set(['aro', 'more', 'beshi', 'ektu', 'a', 'bit', 'little', 'even', 'much', 'slightly', 'somewhat', 'onk', 'onek', 'আরো', 'আরও', 'বেশি', 'একটু']);
  const AXIS_TAIL = new Set(['kichu', 'ta', 'one', 'ones', 'please', 'pls', 'option', 'options', 'dao', 'den', 'dekhan', 'chai', 'hobe', 'koro', 'kichu dekhan', 'কিছু', 'চাই']);
  function axisFollowUp(text) {
    const tk = tokensOf(text).filter(t => t !== ',');
    if (!tk.length || tk.length > 5) return null;
    let axis = null, comparative = false, more = false;
    for (const t of tk) {
      const hit = Object.keys(AXIS_WORDS).find(k => AXIS_WORDS[k].indexOf(t) >= 0);
      if (hit) { if (axis && axis !== hit) return null; axis = hit; if (/er$/.test(t)) comparative = true; continue; }
      if (AXIS_MORE.has(t)) { more = true; continue; }
      if (AXIS_TAIL.has(t)) continue;
      return null;
    }
    return axis && (comparative || more) ? { axis, text: axis } : null;
  }
  // A typed message that stands on its own: five or more words, its own occasion / vibe / bottle, and no refinement word.
  const REFINE_WORDS = new Set(['more', 'also', 'too', 'instead', 'same', 'again', 'another', 'other', 'aro', 'arekta', 'abar', 'eta', 'etar', 'oita', 'ota', 'ektu', 'but', 'kintu', 'than', 'theke', 'similar', 'like', 'moto']);
  function isNewRequest(text, parsed) {
    const tk = tokensOf(text).filter(t => t !== ',');
    if (tk.length < 5 || tk.some(t => REFINE_WORDS.has(t))) return false;
    return (parsed.parts || []).some(p => p.anchor || (p.primary && ['o', 'a', 'f', 'n'].indexOf(p.primary) >= 0));
  }
  function chatLine(q, parts, lang, turnNo) {
    const LK = lang === 'bs' ? 'bs' : lang === 'bn' ? 'bn' : 'en', bn = LK !== 'en', C = T.chat[LK], f = q.features || {};
    const AND = LK === 'bs' ? ' আর ' : LK === 'bn' ? ' ar ' : ' and ';
    parts = (parts || []).filter(p => !p.anchor && !p.exclude);
    // How much of a part is about occasions vs accords: "biye" is an occasion word, "dark" a vibe word (both carry some of each).
    const share = (p, pre) => { let a = 0, t = 0; Object.keys(p.features || {}).forEach(k => { const w = p.features[k]; if (w > 0) { t += w; if (k.indexOf(pre + ':') === 0) a += w; } }); return t ? a / t : 0; };
    const occScore = {};
    const isOcc = p => !p.gender && (p.primary ? p.primary === 'o' : share(p, 'o') >= 0.5);
    parts.filter(isOcc).forEach(p => { Object.keys(p.features || {}).forEach(k => { if (/^o:/.test(k) && p.features[k] > 0) occScore[k.slice(2)] = (occScore[k.slice(2)] || 0) + p.features[k]; }); });
    const occKeys = Object.keys(occScore).sort((a, b) => occScore[b] - occScore[a]);
    const occs = occKeys.filter(k => occScore[k] >= 0.95 * occScore[occKeys[0]]).slice(0, 2).map(o => OCC_WORD[LK][o] || String(o).toLowerCase());
    // Vibe: the visitor's own words when they are short vibe words ("dark", "sweet", "mishti"), else the top accords.
    // the visitor's words without intensifiers and Banglish filler ("fresh kichu" → "fresh", "office er jonno" → "office")
    const plain = t => String(t || '').replace(/^(very|a bit) /, '').replace(/ (kichu|kisu|kichhu|ta|ekta|er jonno|jonno|jonne|chai|lagbe|কিছু|জন্য|এর জন্য|চাই|লাগবে)$/, '');
    const own = parts.filter(p => !p.gender && !p.ai && !isOcc(p) && (p.primary ? ['a', 'f', 'n'].indexOf(p.primary) >= 0 : share(p, 'a') + share(p, 'f') + share(p, 'n') >= 0.5) && Object.keys(p.features || {}).some(k => p.features[k] > 0)
      && /^[a-zঀ-৿]+( [a-zঀ-৿]+)?$/i.test(plain(p.text)) && !/\blike\b/.test(p.text || ''));
    const stressedOwn = own.some(p => /^very /.test(p.text || ''));
    let vibe = '';
    // context words ("I sweat a lot", "bus e jai") are not vibes; say the character they lead to instead ("fresh and citrusy")
    const context = parts.filter(p => p.note && ['sweat', 'commute', 'skin', 'modest'].indexOf(p.note) >= 0);
    if (own.length) vibe = own.slice(0, 2).map(p => plain(p.text)).join(AND);
    else if (context.length) {
      const cf = {}; context.forEach(p => Object.keys(p.features || {}).forEach(k => { if (/^a:/.test(k) && p.features[k] > 0) cf[k] = (cf[k] || 0) + p.features[k]; }));
      vibe = Object.keys(cf).sort((a, b) => cf[b] - cf[a]).slice(0, 2).map(k => accWord(k.slice(2))).join(AND);
    } else if (!occs.length) {   // no vibe word and no occasion (a gift, an AI reading): describe the top accords instead
      const ks = Object.keys(f).filter(k => /^a:/.test(k) && f[k] > 0).sort((a, b) => f[b] - f[a]);
      vibe = ks.filter(k => f[k] >= 0.6 * f[ks[0]]).slice(0, 2).map(k => accWord(k.slice(2))).join(AND);
    }
    if (vibe && stressedOwn) vibe = C.really + vibe;
    const negPart = parts.find(p => /^(not|less) /.test(p.label || ''));
    let price = negPart ? fill(C.nothing, { neg: String(negPart.label).replace(/^(not|less) /, '') }) : '';
    if (q.maxPrice != null && q.minPrice != null) price = fill(C.between, { min: q.minPrice, max: q.maxPrice }) + price;
    else if (q.maxPrice != null) price = fill(C.under, { max: q.maxPrice }) + price;
    else if (q.minPrice != null) price = fill(C.over, { min: q.minPrice }) + price;
    const folded = q.strength === 'stronger' || q.strength === 'softer';
    if (folded) price += C[q.strength];
    const occ = occs.join(AND);
    const set = vibe && occ ? C.both : vibe ? C.vibe : occ ? C.occ : C.none;
    let text = fill(set[(turnNo || 0) % set.length], { vibe, occ, price }).replace(/\s+([:?.,])/g, '$1');
    text = text.charAt(0).toUpperCase() + text.slice(1);
    return { text, folded };
  }
  function reasons(cand, query, model, anchor) {
    const it = cand.item || cand, V = model.vocab, price = 'from ৳' + it.p;
    const labelsOf = (p, idxs) => idxs.map(i => V[p][i]).filter(Boolean);
    let notes = [];
    if (anchor && (anchor.kind === 'catalog' || anchor.kind === 'ref')) {
      let an = [], aa = [];
      if (anchor.kind === 'catalog') { const ai = model.byId.get(anchor.id); if (ai) { an = ai.n || []; aa = ai.a || []; } }
      else { const ref = anchor.ref || refFor(anchor.name, model) || {}; an = (ref.n || []).map(l => model.lookup.n.get(String(l).toLowerCase())).filter(x => x != null); aa = (ref.a || []).map(l => model.lookup.a.get(String(l).toLowerCase())).filter(x => x != null); }
      notes = uniq(labelsOf('n', (it.n || []).filter(i => an.indexOf(i) >= 0)).concat(labelsOf('a', (it.a || []).filter(i => aa.indexOf(i) >= 0)))).slice(0, 3);
      if (!notes.length) notes = labelsOf('a', (it.a || []).slice(0, 2));
      const verified = anchor.kind === 'ref' && (it.ref || []).some(ri => normalize(V.r[ri]) === normalize(anchor.name));
      if (verified) return 'Verified alternative to ' + anchor.name + (notes.length ? ' · ' + notes.map(l => String(l).toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' & $1') : '') + ' · ' + price;
      if (cand.community) return (notes.length ? lowerList(notes) + ' · ' : '') + fill(T.communityRef, { name: anchor.name }) + ' · ' + price;
      return (notes.length ? lowerList(notes) + ' · ' : '') + 'closest match to ' + anchor.name + ' · ' + price;
    }
    const m = cand.matched || [];
    const pick = (p, limit) => m.filter(k => k.charAt(0) === p).map(k => V[p][Number(k.slice(1))]).filter(Boolean).slice(0, limit);
    // Accords describe the overall character ("Fresh, citrus & aromatic"); notes follow if room is left.
    notes = uniq(pick('a', 3).concat(pick('n', 3))).slice(0, 3);
    if (!notes.length) notes = labelsOf('a', (it.a || []).slice(0, 2));
    const occ = pick('o', 2);
    return [notes.length ? lowerList(notes) : '', occ.length ? occ.join(', ') : '', price].filter(Boolean).join(' · ');
  }

  // ── Phase 2: on-device NLU fragments → the same structured query (pure parts) ──
  // A fragment is what any understanding layer may return: { features, strength, gender,
  // exclude, unknown }. validateFragment() keeps only keys the catalogue knows; mergeNLU()
  // applies the merge rule: the deterministic parser's prices, anchor, negations and gender
  // always win, a model may only ADD features / strength / exclusions.
  const NLU_SCHEMA = {
    type: 'object', additionalProperties: false,
    properties: {
      features: { type: 'object', additionalProperties: { type: 'number', minimum: -1, maximum: 1 }, description: 'keys like "a:Sweet", "o:Office", "n:Vanilla", "f:Woody", "k:EDP", "b:Lattafa"; negative = avoid' },
      strength: { type: 'string', enum: ['stronger', 'softer', 'none'] },
      gender: { type: 'string', enum: ['men', 'unisex', 'none'] },
      exclude_brands: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      unknown: { type: 'array', items: { type: 'string' }, maxItems: 6 },
    },
    required: ['features'],
  };
  function validateFragment(raw, model) {
    if (!raw || typeof raw !== 'object' || !model) return null;
    const out = { features: {}, strength: null, gender: null, exclude: [], unknown: [] };
    const f = raw.features && typeof raw.features === 'object' ? raw.features : {};
    Object.keys(f).forEach(k => {
      const m = /^([fanokb]):(.+)$/.exec(String(k)); const w = Number(f[k]);
      if (!m || !isFinite(w) || !w) return;
      const idx = model.lookup[m[1]] && model.lookup[m[1]].get(m[2].trim().toLowerCase()); if (idx == null) return;
      const key = m[1] + ':' + model.vocab[m[1]][idx];
      out.features[key] = clamp((out.features[key] || 0) + clamp(w, -1, 1), -1, 1);
    });
    if (raw.strength === 'stronger' || raw.strength === 'softer') out.strength = raw.strength;
    if (raw.gender === 'men' || raw.gender === 'unisex') out.gender = raw.gender;
    (Array.isArray(raw.exclude_brands) ? raw.exclude_brands : (Array.isArray(raw.exclude) ? raw.exclude : [])).forEach(b => {
      const name = String(b).replace(/^brand:/i, '').trim(); const idx = model.lookup.b.get(name.toLowerCase());
      if (idx != null && out.exclude.length < 5) out.exclude.push('brand:' + model.vocab.b[idx]);
    });
    (Array.isArray(raw.unknown) ? raw.unknown : []).forEach(u => { if (typeof u === 'string' && u.trim() && out.unknown.length < 6) out.unknown.push(u.trim().slice(0, 40)); });
    const effect = Object.keys(out.features).length || out.strength || out.gender || out.exclude.length;
    return effect ? out : null;
  }
  // parsed = the deterministic parser's own query for this sentence; returns ONE part or null.
  function mergeNLU(parsed, frag, model) {
    if (!frag) return null;
    const own = (parsed && parsed.features) || {};
    const part = { features: {}, exclude: [], label: '', text: '' };
    const said = [];
    Object.keys(frag.features).forEach(k => {
      if (own[k] != null) return;                                  // the parser already decided this feature (sign included)
      part.features[k] = frag.features[k]; said.push((frag.features[k] < 0 ? 'no ' : '') + k.slice(2).toLowerCase());
    });
    if (frag.strength && !(parsed && parsed.strength)) { part.strength = frag.strength; said.push(frag.strength); }
    if (frag.gender && !(parsed && parsed.gender)) { part.gender = frag.gender; said.push(frag.gender === 'men' ? 'for men' : 'unisex'); }
    frag.exclude.forEach(e => { if (!(parsed && (parsed.exclude || []).indexOf(e) >= 0)) { part.exclude.push(e); said.push('not ' + e.slice(6).toLowerCase()); } });
    if (!hasEffect(part)) return null;
    part.label = T.tokenPrefix.ai + said.slice(0, 4).join(', ');
    part.text = said.join(' ');
    part.ai = true;
    return part;
  }
  // Phase 3 — "People who chose #1 also considered": display only, from the build's cp pairs.
  function alsoConsidered(pick, model, excludeIds, limit) {
    const it = pick && (pick.item || pick); if (!it || !Array.isArray(it.cp) || !model) return [];
    const ex = new Set(excludeIds || []); const out = [];
    for (const pair of it.cp) {
      const o = model.items[Number(pair[0])]; if (!o || !o.i || o.id === it.id || ex.has(o.id)) continue;
      if (o.c === 'e' && it.c !== 'e') continue;   // exclusive bottles only alongside an exclusive pick
      out.push({ id: o.id, nm: o.nm }); if (out.length >= (limit || 3)) break;
    }
    return out;
  }
  // Phase 1c — anonymous query log row (text + match count only).
  const queryLogBody = (text, matched) => ({ q: String(text || '').trim().slice(0, 200), matched: clamp(Number(matched) || 0, 0, 99) });
  const wordCount = text => tokensOf(text).filter(t => t !== ',').length;
  const needsServer = (text, parsed) => { const w = wordCount(text), u = (parsed.unknown || []).length, none = !(parsed.parts || []).length; return (none && w >= 2) || (w >= 3 && u >= 1) || (/[ঀ-৿]/.test(String(text)) && (u > 0 || none)); };
  const needsNLU = (text, parsed) => wordCount(text) >= NLU_MIN_WORDS && ((parsed.unknown || []).length >= NLU_MIN_UNKNOWN || !(parsed.parts || []).length);

  // ── browser integration ──
  const S = { url: '', model: null, pending: null, failed: false, lex: null, thread: null, el: null, chips: [], logged: new Set(), ai: { session: null, avail: null, loading: null, lastText: '' } };
  const DEFAULT_CHIPS = {
    occasion: [{ label: 'Office / University', o: ['Office', 'Everyday'] }, { label: 'Everyday', o: ['Everyday', 'Casual'] }, { label: 'Date night', o: ['Date Night', 'Evening'] }, { label: 'Evening / Party', o: ['Party', 'Evening'] }, { label: 'Summer heat', o: ['Summer'], a: ['Fresh', 'Citrus'] }, { label: 'Winter', o: ['Winter'], a: ['Amber', 'Warm Spicy'] }, { label: 'Gym', o: ['Gym / Sport'], a: ['Fresh'] }, { label: 'Formal / Wedding', o: ['Formal', 'Wedding'] }],
    vibe: [{ label: 'Fresh & clean', a: ['Fresh', 'Citrus', 'Aromatic'] }, { label: 'Sweet', a: ['Sweet', 'Vanilla'] }, { label: 'Woody & warm', a: ['Woody', 'Amber'] }, { label: 'Spicy', a: ['Warm Spicy', 'Fresh Spicy'] }, { label: 'Aquatic / blue', a: ['Aquatic', 'Marine', 'Fresh'] }, { label: 'Soft & powdery', a: ['Powdery', 'Musky'] }, { label: 'Green', a: ['Green'] }, { label: 'Surprise me', surprise: true }],
    budget: [{ label: 'Under ৳300', price: { max: 300 } }, { label: '৳300–600', price: { min: 300, max: 600 } }, { label: '৳600–1,000', price: { min: 600, max: 1000 } }, { label: 'Any' }],
    who: [{ label: 'Men', g: 'men' }, { label: 'Women', g: 'unisex', note: 'women' }, { label: 'Anyone (unisex)', g: 'unisex' }],
  };
  const lexChips = set => { const c = ((S.lex || {}).chips || {})[set]; return Array.isArray(c) && c.length ? c : DEFAULT_CHIPS[set]; };
  function freshThread() { return { v: 1, query: emptyQuery(), turns: [], renderedIds: [], parts: [], chips: 'opening', lastIds: [], awaitName: false, pending: [], cards: {}, wizard: null }; }
  const STEPS = ['occasion', 'vibe', 'budget', 'who'];
  function imgUrl(item, size) {
    const base = (typeof IMAGE_BASE === 'string' && IMAGE_BASE) || CDN;
    return base + '/storage/v1/object/public/product-images/' + encodeURIComponent(item.id) + '/' + size + '.webp?v=' + item.v;
  }
  function toCard(item, model) {
    const vocab = (model || S.model).vocab;
    return {
      id: item.id, name: item.nm, brand: vocab.b[item.b] || '',
      sizes: (item.s || []).map(x => ({ ml: x[0], price: x[1] })), tags: item.t || [],
      accords: (item.a || []).map(i => vocab.a[i]).filter(Boolean),
      inStock: !!item.i, sale_percent: item.sp,
      image_thumb: imgUrl(item, 'thumb'), image_small: imgUrl(item, 'small'),
    };
  }
  // One fetch per page (in-flight de-duplicated); nothing before the first chip/text.
  function prepare() {
    if (S.model) return Promise.resolve(S.model);
    if (S.pending) return S.pending;
    if (!S.url || typeof fetch !== 'function') return Promise.resolve(null);
    S.pending = fetch(S.url, { credentials: 'omit' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { S.model = prepareData(d); return S.model; })
      .catch(() => null)
      .then(m => { S.pending = null; if (!m) S.failed = true; return m; });
    return S.pending;
  }
  // ── state ──
  function save() {
    try {
      const th = S.thread; if (!th) return;
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ v: 1, query: th.query, turns: th.turns, renderedIds: th.renderedIds, parts: th.parts, chips: th.chips, lastIds: th.lastIds, awaitName: th.awaitName, pending: th.pending, cards: th.cards, wizard: th.wizard || null, lang: th.lang || null }));
    } catch (e) {}
  }
  function loadStored() {
    try {
      const d = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
      if (!d || d.v !== 1 || !Array.isArray(d.turns) || !Array.isArray(d.renderedIds)) return null;
      const th = Object.assign(freshThread(), d, { query: compose(d.parts || []) });
      if (!th.cards || typeof th.cards !== 'object') th.cards = {};
      return th;
    } catch (e) { return null; }
  }
  const clearStored = () => { try { sessionStorage.removeItem(STATE_KEY); } catch (e) {} };
  // Constraint parts: one slot each for anchor / price / gender / strength / collection;
  // feature parts accumulate, an opposite-sign repeat replaces the older one.
  // A part that also carries scent features ("bus diye" = fresh + softer, "office" = office + softer) is a wish, not a slot:
  // a later strength / gender / price word must not delete its features. Only feature-less parts fill a slot.
  const slotOf = p => (p.anchor ? 'anchor' : (p.maxPrice != null || p.minPrice != null || p.cheaper) && !Object.keys(p.features || {}).length ? 'price'
    : Object.keys(p.features || {}).length ? null : p.gender ? 'gender' : p.strength ? 'strength' : p.collection ? 'collection' : null);
  function addParts(parts) {
    const th = S.thread;
    parts.forEach(p => {
      if (!hasEffect(p)) return;
      const slot = slotOf(p);
      th.parts = th.parts.filter(old => {
        if (slot && slotOf(old) === slot) return false;
        if (old.label && p.label && old.label === p.label && !old.anchor) return false;   // the same wish twice ("sweet, not too sweet") stays one token
        const keys = Object.keys(old.features || {});
        if (keys.length && p.features && keys.every(k => p.features[k] != null && Math.sign(p.features[k]) !== Math.sign(old.features[k]))) return false;
        return true;
      });
      th.parts.push(p); th.pending.push(p);
    });
    th.query = compose(th.parts);
    renderBar();
  }
  const removePart = k => { const th = S.thread; th.parts.splice(k, 1); th.query = compose(th.parts); renderBar(); };

  // ── rendering ──
  const el = id => document.getElementById(id);
  function msgEl(role, html) {
    const d = document.createElement('div'); d.className = 'msg msg-' + role; d.innerHTML = html;
    return d;
  }
  function appendMsg(node) {
    const th = S.el.thread; const foot = th.querySelector('.finder-foot');
    if (foot) th.insertBefore(node, foot); else th.appendChild(node);
    return node;
  }
  // Cards render from the thread's stored card data (filled at answer time), so a
  // restored thread paints synchronously: no fetch, nothing moves.
  // A bot turn = a short bubble (sentence + notes). Cards live OUTSIDE the bubble in a
  // plain answer block: grid, one reason line and a "More like this" per card, then the
  // "also considered" row and two quiet links. The honesty line and WhatsApp handoff
  // appear once, at the end of the thread (renderFoot), not under every answer.
  function renderTurn(turn, scroll) {
    if (turn.role === 'user') return appendMsg(msgEl('user', esc(turn.text)));
    const cards = S.thread.cards || {};
    let html = '<p>' + esc(turn.text) + '</p>';
    (turn.notes || []).forEach(n => { html += '<p class="finder-sub">' + esc(n) + '</p>'; });
    if (turn.link && turn.link.href) html += '<p class="finder-sub"><a href="' + esc(turn.link.href) + '"' + (turn.link.external ? ' target="_blank" rel="noopener"' : '') + '>' + esc(turn.link.label || turn.link.href) + ' →</a></p>';
    if (turn.table) html += compareTable(turn.table);
    const node = appendMsg(msgEl('bot', html));
    const ids = (turn.ids || []).filter(id => cards[id] && cards[id].c);
    if (ids.length) {
      let a = '<div class="product-grid finder-cards">';
      ids.forEach((id, i) => {
        const c = cards[id];
        const card = window.RenderCard && typeof RenderCard.renderCard === 'function'
          ? RenderCard.renderCard(c.c, { isExclusive: !!c.e, priority: false })
          : '<div class="product-card" data-id="' + esc(c.c.id) + '"><a class="card-link" href="/product/' + esc(c.c.id) + '/">' + esc(c.c.name) + '</a></div>';
        const caution = (turn.cautions || [])[i], LK = turn.lang === 'bs' ? 'bs' : turn.lang === 'bn' ? 'bn' : 'en';
        a += card + '<p class="finder-reason">' + esc((turn.reasons || [])[i] || '') + (caution ? '<span class="finder-caution">' + esc(caution) + '</span>' : '') + ' <button type="button" class="finder-like" data-n="' + i + '">' + esc(T.likeThis) + '</button>'
          + ((turn.cheap || [])[i] ? ' <button type="button" class="finder-cheap" data-n="' + i + '">' + esc(T.cheaperLike[LK]) + '</button>' : '') + '</p>';
      });
      a += '</div>';
      if (turn.also && turn.also.items && turn.also.items.length) {
        a += '<p class="finder-also">' + esc(turn.also.label || fill(T.also, { name: turn.also.name })) + ' ' +
          turn.also.items.map(x => '<a href="/product/' + esc(x.id) + '/">' + esc(x.nm) + '</a>').join(', ') + '</p>';
      }
      a += '<p class="finder-links">' + (ids.length >= 2 ? '<button type="button" class="finder-link" data-op="compare">' + esc(T.compareLink) + '</button>' : '') + '<button type="button" class="finder-link" data-op="brands">' + esc(T.brandsLink) + '</button></p>';
      const block = document.createElement('div'); block.className = 'finder-answer'; block.innerHTML = a;
      appendMsg(block);
      // js/api.js declares `const ProductAPI` (a global lexical binding, NOT a window property), so test the name itself.
      if (typeof ProductAPI !== 'undefined' && ProductAPI && typeof ProductAPI.hydrateCards === 'function') { try { ProductAPI.hydrateCards(); } catch (e) {} }
    }
    if (scroll) { try { node.scrollIntoView({ block: 'nearest' }); } catch (e) {} }
    return node;
  }
  // Compare rows are computed once (model needed) and stored on the turn as plain text.
  function compareRows(ids, model) {
    const V = model.vocab, items = ids.map(id => model.byId.get(id)).filter(Boolean);
    if (items.length < 2) return null;
    const R = T.compareRows;
    const row = (label, fn) => [label].concat(items.map(it => fn(it) || '—'));
    return { names: items.map(it => it.nm), rows: [
      row(R.brand, it => V.b[it.b]), row(R.family, it => (it.f || []).map(i => V.f[i]).join(', ')), row(R.accords, it => (it.a || []).map(i => V.a[i]).join(', ')),
      row(R.notes, it => (it.n || []).map(i => V.n[i]).join(', ')), row(R.occasions, it => (it.o || []).map(i => V.o[i]).join(', ')),
      row(R.concentration, it => V.k[it.k]), row(R.price, it => '৳' + it.p),
    ] };
  }
  function compareTable(t) {
    if (!t || !t.rows) return '';
    // The wrapper (finder.css) scrolls sideways if a long notes list needs it, so the
    // table never widens the page (a wider layout viewport makes phone taps land off-target).
    return '<div class="finder-compare-wrap"><table class="finder-compare"><thead><tr><th></th>' + t.names.map(n => '<th scope="col">' + esc(n) + '</th>').join('') + '</tr></thead><tbody>' +
      t.rows.map(r => '<tr><th scope="row">' + esc(r[0]) + '</th>' + r.slice(1).map(v => '<td>' + esc(v) + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  }
  function renderBar() {
    const bar = S.el.bar; if (!bar) return;
    bar.textContent = '';
    (S.thread.parts || []).forEach((p, k) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'finder-token'; b.dataset.part = String(k);
      b.textContent = (p.label || p.text || '') + ' ✕'; b.setAttribute('aria-label', 'Remove ' + (p.label || p.text || ''));
      bar.appendChild(b);
    });
  }
  // Chip sets. Opening: three examples + the two ways in. Guided steps: one question's
  // chips at a time (the vibe step can swap to moods). Follow-ups: five refinements + reset;
  // "more like this", compare and other brands sit on the answer block itself.
  function chipSet(id) {
    const L = S.lex || {};
    const mk = c => ({ label: c.label, kind: c.surprise ? 'surprise' : 'chip', data: c });
    if (id === 'opening') return (T.examples || []).map(x => ({ label: x, kind: 'example', text: x })).concat([{ label: T.guideChip, kind: 'guide' }, { label: T.nameChip, kind: 'name' }]);
    if (id === 'occasion' || id === 'budget' || id === 'who') return lexChips(id).map(mk).concat([{ label: T.skip, kind: 'skip' }]);
    if (id === 'vibe') return lexChips('vibe').map(mk).concat((L.moods || []).length ? [{ label: T.moodsChip, kind: 'moods' }] : [], [{ label: T.skip, kind: 'skip' }]);
    if (id === 'moods') return (L.moods || []).map(mk).concat([{ label: T.vibesChip, kind: 'vibes' }, { label: T.skip, kind: 'skip' }]);
    if (id === 'name') return [{ label: T.skip, kind: 'skip' }];
    if (id === 'follow') return ['more', 'cheaper', 'fresher', 'sweeter', 'stronger', 'reset'].map(op => ({ label: T.follow[op], kind: 'follow', op }));
    return [];
  }
  const stepOf = id => (id === 'moods' ? 'vibe' : id);
  function setChips(id, aiKind) {
    S.thread.chips = id; S.chips = aiChips(aiKind).concat(chipSet(id));
    const box = S.el.chips; if (!box) return;
    box.textContent = '';
    const step = STEPS.indexOf(stepOf(id));
    if (step >= 0) {   // guided mode: the question lives in the panel, not in the thread
      const h = document.createElement('p'); h.className = 'finder-step';
      h.innerHTML = '<span class="finder-step-n">' + esc(fill(T.stepOf, { n: step + 1 })) + '</span> ' + esc(T.stepTitle[stepOf(id)]);
      box.appendChild(h);
    }
    const row = document.createElement('div'); row.className = 'finder-chip-row'; box.appendChild(row);
    S.chips.forEach((c, k) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (c.kind === 'guide' ? ' chip-primary' : c.kind === 'example' ? ' chip-example' : c.kind === 'skip' || c.kind === 'moods' || c.kind === 'vibes' || c.kind === 'ai-no' ? ' chip-quiet' : ''); b.dataset.chip = String(k); b.textContent = c.label; row.appendChild(b); });
    // Screen readers hear the question from the panel; this sr-only status says the buttons changed too.
    if (S.el.status) S.el.status.textContent = S.chips.length ? fill(T.status, { n: S.chips.length }) : '';
  }
  function waHref() {
    const th = S.thread || { lastIds: [], parts: [] }, model = S.model;
    let num = WA_FALLBACK;
    try { const s = window.__SETTINGS__; const n = s && s.contact && s.contact.whatsapp; if (n) num = String(n).replace(/[^0-9]/g, '') || WA_FALLBACK; } catch (e) {}
    const lines = [T.waIntro];
    (th.lastIds || []).forEach((id, i) => { const it = model && model.byId.get(id); if (it) lines.push((i + 1) + '. ' + it.nm + ' (' + (model.vocab.b[it.b] || '') + ') — from ৳' + it.p); });
    const cons = (th.parts || []).map(p => p.label).filter(Boolean);
    if (cons.length) lines.push(T.waLooking + cons.join(', '));
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(lines.join('\n'));
  }
  function renderFoot() {
    const th = S.thread; let foot = S.el.thread.querySelector('.finder-foot');
    if (!th.lastIds.length) { if (foot) foot.remove(); return; }
    if (!foot) { foot = document.createElement('div'); foot.className = 'finder-foot'; }
    foot.innerHTML = '<p class="finder-note">' + esc(T.honesty) + '</p><a class="finder-wa" href="' + esc(waHref()) + '" target="_blank" rel="noopener">' + esc(T.whatsapp) + '</a>';
    S.el.thread.appendChild(foot);
  }
  function shareUrl() {
    try {
      const q = (S.thread.parts || []).map(p => p.text).filter(Boolean).join(', ');
      const url = location.pathname + (q ? '?q=' + encodeURIComponent(q).replace(/%20/g, '+') : '');
      history.replaceState({ nawmeFinder: 1 }, '', url);
    } catch (e) {}
  }
  function renderAll() {
    S.el.thread.textContent = '';
    S.thread.turns.forEach(t => renderTurn(t, false));
    renderBar(); setChips(S.thread.chips); renderFoot();
  }
  function renderUnavailable() {
    appendMsg(msgEl('bot', '<p>' + esc(T.unavailable) + ' <a href="shop.html">' + esc(T.browseAll) + '</a></p>'));
    setChips('none');
  }
  function addUserTurn(text) { const t = { role: 'user', text }; S.thread.turns.push(t); renderTurn(t, false); }
  function botText(text) { const t = { role: 'bot', text }; S.thread.turns.push(t); renderTurn(t, true); }

  // ── the conversation ──
  function renderOpening() { botText(T.opening); setChips('opening'); save(); }
  // Guided mode: the four questions are answered in the chip panel; the thread gets one
  // user line ("Office / University · Fresh & clean · ৳300–600 · Me") and then the answer.
  function startGuide() { S.thread.wizard = { picks: [] }; prepare(); setChips('occasion'); save(); }
  // Steps whose slot is already filled (a typed budget, a gender word) are skipped.
  function stepFilled(step) {
    const q = S.thread.query || emptyQuery();
    if (step === 'budget') return q.maxPrice != null || q.minPrice != null || q.cheaper;
    if (step === 'who') return !!q.gender;
    return false;
  }
  function nextStep(from) {
    let i = STEPS.indexOf(stepOf(from));
    while (i >= 0 && i < STEPS.length - 1 && stepFilled(STEPS[i + 1])) i++;
    if (i < 0 || i >= STEPS.length - 1) return finishGuide();
    setChips(STEPS[i + 1]); save();
  }
  function finishGuide() {
    const th = S.thread, picks = (th.wizard && th.wizard.picks) || [];
    th.wizard = null;
    addUserTurn(picks.length ? picks.join(' · ') : T.skip);
    runAnswer({ mode: 'answer', retry: true });
  }
  function onChip(c) {
    const th = S.thread;
    if (c.kind === 'chip' || c.kind === 'surprise') {
      const part = c.kind === 'surprise' ? surprisePart(th.turns.length + ((th.wizard && th.wizard.picks.length) || 0), S.lex, S.model) : chipPart(c.data, S.model);
      if (part) addParts([part]);
      prepare();
      if (th.wizard) { th.wizard.picks.push(c.label); nextStep(th.chips); }
      else { addUserTurn(c.label); runAnswer({ mode: 'answer' }); }   // a chip outside guided mode (restored older state) answers directly
    } else if (c.kind === 'guide') startGuide();
    else if (c.kind === 'moods') { setChips('moods'); save(); }
    else if (c.kind === 'vibes') { setChips('vibe'); save(); }
    else if (c.kind === 'skip') { th.awaitName = false; if (th.wizard) nextStep(th.chips); else { setChips(th.lastIds.length ? 'follow' : 'opening'); save(); } }
    else if (c.kind === 'name') { addUserTurn(c.label); th.awaitName = true; botText(T.askName); setChips('name'); prepare(); save(); }
    else if (c.kind === 'example') onSubmit(c.text);
    else if (c.kind === 'ai-consent' || c.kind === 'ai-load' || c.kind === 'ai-no') onAiChip(c);
    else if (c.kind === 'follow') followUp(c.op, c.n);
  }
  function onSubmit(raw) {
    const text = String(raw || '').trim().slice(0, 200); if (!text) return;
    const th = S.thread;
    addUserTurn(text);
    prepare().then(model => {
      let t = text;
      if (th.awaitName && model && !hasTrigger(t, S.lex, model)) t = 'like ' + t;
      th.awaitName = false;
      runAnswer({ mode: 'text', text: t, typed: true });
    });
  }
  // ── Phase 1c: anonymous log of typed questions (never chips; once per sentence per page) ──
  function logQuery(text, matched) {
    try {
      if (!LOG_QUERIES || typeof fetch !== 'function') return;
      if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') return;
      if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
      const body = queryLogBody(text, matched); if (!body.q || S.logged.has(body.q)) return;
      S.logged.add(body.q);
      fetch(SUPABASE_URL + '/rest/v1/' + LOG_TABLE, {
        method: 'POST', keepalive: true, credentials: 'omit',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(body),
      }).catch(() => {});
    } catch (e) { /* logging is optional */ }
  }
  // ── Phase 2: Layer A — Chrome's built-in model (desktop Chrome; feature-detected) ──
  const hasPromptApi = () => typeof LanguageModel !== 'undefined' && LanguageModel && typeof LanguageModel.create === 'function';
  function aiSystemPrompt(model) {
    const V = model.vocab;
    return 'You turn a perfume shopper\'s sentence into a JSON object for a catalogue search. Use ONLY these labels. ' +
      'Feature keys are "<prefix>:<label>" with prefixes a (accord), f (family), n (note), o (occasion), k (concentration), b (brand); weight 1 = wanted, -1 = avoid. ' +
      'Accords: ' + V.a.join(', ') + '. Families: ' + V.f.join(', ') + '. Occasions: ' + V.o.join(', ') + '. Concentrations: ' + V.k.join(', ') + '. Brands: ' + V.b.join(', ') + '. ' +
      'Notes (use only if named): ' + V.n.slice(0, 120).join(', ') + '. ' +
      '"strength": "stronger" for strong/loud/heavy/long wear requests, "softer" for subtle/office-safe/light, else "none". "gender": "men", "unisex" (also for women, gifts, partners) or "none". ' +
      'Never output prices, product names or anything not in the lists. Put words you could not map into "unknown". Output JSON only.';
  }
  const withTimeout = (p, ms) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), ms); p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); }); });
  async function promptApiUnderstand(text, model) {
    if (!hasPromptApi()) return null;
    const ai = S.ai;
    if (ai.avail == null) { try { ai.avail = await LanguageModel.availability(); } catch (e) { ai.avail = 'unavailable'; } }
    if (ai.avail === 'unavailable') return null;
    let consent = null; try { consent = localStorage.getItem(NLU_CONSENT_KEY); } catch (e) {}
    if (ai.avail !== 'available' && consent !== 'yes') return { needConsent: true };
    if (!ai.session) ai.session = await withTimeout(LanguageModel.create({ initialPrompts: [{ role: 'system', content: aiSystemPrompt(model) }] }), 20000);
    const raw = await withTimeout(ai.session.prompt(text, { responseConstraint: NLU_SCHEMA }), NLU_TIMEOUT_MS);
    let obj = null; try { obj = JSON.parse(String(raw).replace(/^```json\s*|```\s*$/g, '')); } catch (e) { return null; }
    return validateFragment(obj, model);
  }
  // ── Phase 2: Layer B — js/finder-nlu.js (browser embedding model, loaded only after a tap) ──
  const nluCarrier = () => document.getElementById('finder-nlu-loader');
  const nluModule = () => (typeof window !== 'undefined' && window.FinderNLU && window.FinderNLU.ENABLED !== false ? window.FinderNLU : null);
  function nluSupported() { const c = nluCarrier(); if (!c) return false; const m = nluModule(); if (m && typeof m.supports === 'function') { const s = m.supports(); return !!(s && (s.webgpu || s.wasm)); } return !!(window.WebAssembly); }
  function loadNluScript() {
    const c = nluCarrier(); if (!c) return Promise.reject(new Error('no carrier'));
    if (nluModule()) return Promise.resolve(nluModule());
    return new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = c.getAttribute('src'); s.async = true;
      Object.keys(c.dataset).forEach(k => { s.dataset[k] = c.dataset[k]; });
      s.onload = () => { const m = nluModule(); m ? res(m) : rej(new Error('module missing')); }; s.onerror = () => rej(new Error('script failed'));
      document.body.appendChild(s);
    });
  }
  const nluMb = () => { const c = nluCarrier(); const mb = c && Number(c.dataset.modelMb); return mb > 0 ? mb : 25; };
  async function embeddingUnderstand(text, model) {
    const m = nluModule(); if (!m || typeof m.ready !== 'function' || !m.ready() || typeof m.understand !== 'function') return null;
    const raw = await withTimeout(m.understand(text), NLU_TIMEOUT_MS);
    return validateFragment(raw, model);
  }
  // ── Phase 2: Layer C — the server  reads the sentence into the same contract; the engine answers ──
  // Everything is re-validated here: unknown labels, keys, kinds and intents are dropped, names are trimmed.
  function validateServer(raw, model, L) {
    if (!raw || typeof raw !== 'object' || !model) return null;
    L = L || S.lex || {};
    const str = v => (typeof v === 'string' ? v.trim().slice(0, 80) : '');
    const has = (list, v) => Array.isArray(list) && list.indexOf(v) >= 0;
    const intents = ['search', 'fact', 'compare', 'faq', 'glossary', 'chat', 'unclear'];
    const out = { intent: has(intents, raw.intent) ? raw.intent : 'unclear', language: str(raw.language) || 'other', frag: null, anchor: '', maxPrice: null, minPrice: null, women: false, fact: null, compare: null, faq: null, glossary: [], chat: null };
    const fmap = {}; (Array.isArray(raw.features) ? raw.features : []).forEach(f => { if (f && typeof f.key === 'string') fmap[f.key] = Number(f.weight); });
    out.frag = validateFragment({ features: fmap, strength: raw.strength, gender: raw.gender === 'women' ? 'unisex' : raw.gender, exclude_brands: Array.isArray(raw.exclude) ? raw.exclude : [] }, model);
    out.women = raw.gender === 'women';
    out.anchor = str(raw.anchor);
    const px = v => { const n = Number(v); return isFinite(n) && n >= 50 && n <= 100000 ? Math.round(n) : null; };
    out.maxPrice = px(raw.maxPrice); out.minPrice = px(raw.minPrice);
    if (raw.fact && typeof raw.fact === 'object' && has(['smell', 'notes', 'about', 'family', 'gender', 'strength', 'price', 'have', 'buy'], raw.fact.kind) && str(raw.fact.name)) {
      const ml = Number(raw.fact.ml); out.fact = { kind: raw.fact.kind, name: str(raw.fact.name), ml: isFinite(ml) && ml > 0 && ml <= 100 ? ml : null };
    }
    if (raw.compare && typeof raw.compare === 'object' && Array.isArray(raw.compare.names)) {
      const names = raw.compare.names.map(str).filter(Boolean).slice(0, 4);
      if (names.length >= 2) out.compare = { names, crit: str(raw.compare.criterion) || null };
    }
    const faqKeys = (L.faq || []).map(f => f.key); if (has(faqKeys, raw.faq)) out.faq = raw.faq;
    const glossKeys = (L.glossary || []).map(g => g.key); (Array.isArray(raw.glossary) ? raw.glossary : []).forEach(k => { if (has(glossKeys, k) && out.glossary.indexOf(k) < 0) out.glossary.push(k); });
    if (L.intents && typeof raw.chat === 'string' && raw.chat !== 'none' && L.intents[raw.chat]) out.chat = raw.chat;
    // an intent that lacks its payload falls back to what IS there
    if (out.intent === 'fact' && !out.fact) out.intent = 'search';
    if (out.intent === 'compare' && !out.compare) out.intent = 'search';
    if (out.intent === 'faq' && !out.faq) out.intent = 'unclear';
    if (out.intent === 'glossary' && !out.glossary.length) out.intent = 'unclear';
    if (out.intent === 'chat' && !out.chat) out.intent = 'unclear';
    if (out.intent === 'search' && !out.frag && !out.anchor && out.maxPrice == null && out.minPrice == null) out.intent = 'unclear';
    return out;
  }
  // A local dev server may point the finder at its own stand-in (window.__FINDER_NLU_URL__); otherwise the Supabase function.
  const devNluUrl = () => { try { return typeof window !== 'undefined' && typeof window.__FINDER_NLU_URL__ === 'string' ? window.__FINDER_NLU_URL__ : ''; } catch (e) { return ''; } };
  const serverUrl = () => devNluUrl() || (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL ? SUPABASE_URL + SERVER_NLU_PATH : '');
  const serverEnabled = () => SERVER_NLU && typeof fetch === 'function' && !!serverUrl()
    && !(typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true));
  async function serverUnderstand(text, model) {
    if (!serverEnabled()) return null;
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), SERVER_TIMEOUT_MS) : null;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (typeof SUPABASE_ANON_KEY !== 'undefined' && SUPABASE_ANON_KEY) { headers.apikey = SUPABASE_ANON_KEY; headers.Authorization = 'Bearer ' + SUPABASE_ANON_KEY; }
      const res = await fetch(serverUrl(), { method: 'POST', headers, credentials: 'omit', signal: ctrl ? ctrl.signal : undefined, body: JSON.stringify({ q: String(text).slice(0, 200) }) });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.ok ? validateServer(data.out, model, S.lex) : null;
    } catch (e) { return null; } finally { if (timer) clearTimeout(timer); }
  }
  // Non-search intents from the server go straight to the matching skill; "search" is merged by the caller.
  function dispatchServer(req, model, out, parsed) {
    if (!out) return false;
    const again = r => { runAnswer(Object.assign({ mode: 'text', typed: false }, r)); return true; };
    if (out.intent === 'faq') { const a = faqLines(out.faq, model); return a ? sayTurn(req, a.text, a.notes, a.link) : false; }
    if (out.intent === 'glossary') { const defs = out.glossary.map(k => T.gloss[k]).filter(Boolean); return defs.length ? sayTurn(req, defs[0], defs.slice(1).concat(out.glossary.some(k => GLOSS_CONC.has(k)) ? [T.glossConc] : [])) : false; }
    if (out.intent === 'chat') return chatAnswer(req, out.chat, model);
    if (out.intent === 'fact') {
      const r = resolveFact(out.fact.name, model, S.lex);
      if (r && r.kind === 'catalog') return factAnswer(req, model, { kind: out.fact.kind, name: out.fact.name, ml: out.fact.ml }, r.item);
      if (r && r.kind === 'ref') return again({ text: 'like ' + out.fact.name, preNote: fill(T.notStocked, { name: r.name }) });
      if (r && r.kind === 'brand') return again({ text: out.fact.name });
      if (r && r.kind === 'nobrand') return sayTurn(req, fill(T.haveNoBrand, { brand: r.name }), null, waLink());
      return false;
    }
    if (out.intent === 'compare') {
      const sides = resolveSides(out.compare.names, model, S.lex);
      if (sides.some(x => x.r === null || (x.r.kind === 'unknown' && !cleanName(x.n)))) return false;
      const r = { text: req.text, typed: req.typed };
      if (compareSides(r, model, sides, out.compare.crit, out.compare.crit || '')) return true;
      if (r.text !== req.text) return again({ text: r.text, vsNote: r.vsNote, preNote: r.preNote });
      return false;
    }
    if (out.intent === 'search') {   // the caller merges the fragment; prices and a "like" name are added here when the parser found none
      if (out.anchor && !parsed.anchor) { const r = resolveFact(out.anchor, model, S.lex); if (r && (r.kind === 'catalog' || r.kind === 'ref')) parsed.parts.push(anchorPart(r.kind === 'catalog' ? { kind: 'catalog', id: r.item.id, name: r.item.nm } : r.anchor)); }
      if (out.maxPrice != null && parsed.maxPrice == null && !parsed.parts.some(p => p.maxPrice != null)) parsed.parts.push(Object.assign({ maxPrice: out.maxPrice }, priceText(null, out.maxPrice)));
      if (out.minPrice != null && parsed.minPrice == null && !parsed.parts.some(p => p.minPrice != null)) parsed.parts.push(Object.assign({ minPrice: out.minPrice }, priceText(out.minPrice, null)));
      if (out.women && !parsed.gender && !parsed.parts.some(p => p.gender)) parsed.parts.push({ gender: 'unisex', note: 'unisex', label: T.tokenPrefix.gift, text: 'unisex' });
    }
    return false;
  }
  // Escalation: Layer A (on-device) first, then the server, then an already-loaded Layer B; otherwise the chips offer one.
  async function understand(text, parsed, model) {
    let frag = null, offer = null, server = null, source = 'device';
    try { const a = await promptApiUnderstand(text, model); if (a && a.needConsent) offer = 'consent'; else frag = a; } catch (e) { frag = null; }
    if (!frag && needsServer(text, parsed)) { server = await serverUnderstand(text, model); if (server) { offer = null; source = 'server'; if (server.intent === 'search') frag = server.frag; } }
    if (!frag && !server && !offer) { try { frag = await embeddingUnderstand(text, model); } catch (e) { frag = null; } }
    if (!frag && !server && !offer && !nluModule() && nluCarrier() && nluSupported()) offer = 'load';
    return { part: mergeNLU(parsed, frag, model), offer, tried: !!(frag || server || offer === null), server, source };
  }
  const lastBrands = model => { const out = []; S.thread.renderedIds.forEach(id => { const it = model.byId.get(id); const b = it && model.vocab.b[it.b]; if (b && out.indexOf(b) < 0) out.push(b); }); return out; };
  const median = arr => { const a = arr.slice().sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
  function referenceFor(model, q, forCheaper) {
    const th = S.thread;
    if (q.anchor && q.anchor.kind === 'catalog') { const it = model.byId.get(q.anchor.id); if (it) return it.p; }
    const last = th.lastIds.map(id => model.byId.get(id)).filter(Boolean).map(it => it.p);
    if (!last.length) return null;
    return forCheaper ? median(last) : last[0];
  }
  // Comparisons: "X vs Y", "which is better for summer, X or Y", "difference between X and Y",
  // "compare / rank A, B and C". Two or more stocked bottles → side by side (+ a verdict on the
  // criterion); one stocked → anchor on it and explain the other; none → the normal path.
  const CMP_PRE = 'which (?:one |of (?:them|these|the two|the 2) )?(?:is better|is best|is the best|is stronger|is fresher|is sweeter|is lighter|is softer|lasts longer|lasts more|lasts the longest|last longer|last the longest|is more [a-z]+|should i (?:get|buy|pick|choose|take|go for)|would you (?:recommend|suggest|pick|choose)|do you (?:recommend|suggest|prefer)|is good|is nicer|is more popular|is cheaper|is more expensive|is better value|is best value|smells better|performs better|projects more|wins)|what is better|whats better|what s better|whats the difference between|what is the difference between|what s the difference between|difference between|differences between|parthokko|kon ta valo|konta valo|kon ta bhalo|konta bhalo|kon ta better|konta better|kon ta nibo|konta nibo|kon ta kinbo|konta kinbo|kon ta beshi valo|konta beshi valo|kon ta beshi strong|konta beshi strong|better|best';
  const CMP_SUF = 'which (?:one )?is better|which is better|which one|which|kon ta valo|konta valo|kon ta bhalo|konta bhalo|kon ta|konta|difference|differences|er difference|moddhe difference|er moddhe difference|parthokko|er parthokko|compare|comparison|which should i get|which should i buy|which to get|which to buy|which is stronger|which lasts longer|which one lasts longer|kon ta beshi strong|konta beshi strong|which is fresher|which is sweeter';
  const CMP_PAIR_RE = new RegExp('^(?:(?<pre>' + CMP_PRE + ')(?: (?:for|in|on|at|during) (?<c1>.+?))? )?(?<x>.+?) (?:vs|versus|or|and|naki|&) (?<y>.+?)(?: (?<suf>' + CMP_SUF + '))?(?: (?:for|in|on|at|during) (?<c2>.+?))?$');
  const CMP_THAN_RE = /^(?:is|does|will|would) (.+?) (stronger|better|fresher|sweeter|lighter|softer|cheaper|nicer|heavier|more [a-z]+|last longer|lasts longer|lasting longer) than (.+)$/;
  const CMP_LIST_RE = /^(?:compare|comparison of|comparison between|compare between|compare these|compare all|rank|rank these|order|sort|rate) (.+)$/;
  const CMP_WEAR_RE = /lasts? (?:longer|more|the longest)|last long|longevity|performs? better|projects? more|stronger|beshi strong|beshi thake|koto khon|kotokkhon/;
  const AXIS_WORD = { fresh: 'fresher', sweet: 'sweeter', strong: 'stronger' }, AXIS_NOUN = { fresh: 'freshness', sweet: 'sweetness', strong: 'strength' };
  // Pure: the names, the criterion ("for summer") and the question words around a comparison, or null.
  function parseCompare(text) {
    const withCommas = tokensOf(text).join(' '), s = tokensOf(text).filter(t => t !== ',').join(' ');
    if (!s) return null;
    let m = CMP_LIST_RE.exec(withCommas);
    if (m) {
      let rest = m[1].replace(/ , /g, ', ').replace(/^, |, $/g, ''), crit = null;
      const fm = /^(.+?) (?:for|in|on|at|during) (.+)$/.exec(rest);
      if (fm) { rest = fm[1]; crit = fm[2]; }
      const names = rest.split(/, | and | vs | versus | or | naki | & /).map(x => x.trim()).filter(Boolean);
      return { names, crit, pre: 'compare', list: true, rest: m[1].replace(/ , /g, ' ') };
    }
    m = CMP_THAN_RE.exec(s);
    if (m) return { names: [m[1], m[3]], crit: null, pre: 'which is ' + m[2], list: false };
    m = CMP_PAIR_RE.exec(s);
    if (!m) return null;
    const g = m.groups;
    return { names: [g.x, g.y], crit: g.c1 || g.c2 || null, pre: ((g.pre || '') + ' ' + (g.suf || '')).trim(), list: false };
  }
  // Verdict lines for the criterion: listed occasions, and the fresh / sweet / strong axes.
  function compareVerdict(items, crit, pre, model) {
    const out = [], V = model.vocab, cq = crit ? parse(crit, S.lex, model, {}) : null;
    const wantOcc = cq ? Object.keys(cq.features || {}).filter(k => /^o:/.test(k) && cq.features[k] > 0).sort((a, b) => cq.features[b] - cq.features[a]).map(k => k.slice(2)) : [];
    const axes = cq ? queryAxes(cq) : {};
    if (cq && cq.strength) axes.strong = cq.strength === 'stronger' ? 1 : -1;
    const p = ' ' + (pre || '') + ' ';
    if (/ (?:is )?fresher /.test(p)) axes.fresh = 1;
    if (/ (?:is )?sweeter /.test(p)) axes.sweet = 1;
    if (/ (?:is )?(?:lighter|softer) /.test(p)) axes.strong = -1;
    const wear = CMP_WEAR_RE.test((pre || '') + ' ' + (crit || ''));
    if (wear && !axes.strong) axes.strong = 1;
    const many = items.length > 2;
    wantOcc.slice(0, 2).forEach(occ => {
      const yes = items.filter(it => (it.o || []).some(i => String(V.o[i]).toLowerCase() === occ.toLowerCase())).map(it => it.nm);
      const no = items.filter(it => yes.indexOf(it.nm) < 0).map(it => it.nm);
      out.push(!no.length ? fill(T.cmpListedAll, { all: many ? 'All' : 'Both', occ }) : !yes.length ? fill(T.cmpListedNone, { none: many ? 'None' : 'Neither', occ }) : fill(T.cmpListedSome, { yes: joinAnd(yes), occ, no: joinAnd(no) }));
    });
    Object.keys(axes).filter(k => axes[k] && AXES[k]).slice(0, 2).forEach(k => {
      const dir = Math.sign(axes[k]), scored = items.map(it => ({ it, s: axisScore(it, k, model) * dir })).sort((a, b) => b.s - a.s);
      const word = dir > 0 ? AXIS_WORD[k] : (k === 'strong' ? 'softer' : 'less ' + AXIS_NOUN[k].replace(/ness$/, ''));
      if (scored[0].s - scored[1].s < 0.05) out.push(fill(T.cmpAxisTie, { axis: AXIS_NOUN[k] }));
      else out.push(fill(k === 'strong' && wear ? T.cmpWear : T.cmpAxis, { name: scored[0].it.nm, word }));
    });
    return out;
  }
  // The sides of a comparison; a name nobody knows is retried in the context of a resolved one
  // ("club de nuit intense vs iconic" → Armaf + iconic, "hawas ice vs elixir" → Rasasi Hawas + elixir).
  function resolveSides(names, model, L) {
    const sides = names.map(n => ({ n, r: resolveFact(n, model, L) }));
    const ctx = sides.find(x => x.r && x.r.kind === 'catalog');
    if (ctx) sides.forEach(x => {
      if (x.r && x.r.kind !== 'unknown') return;   // unknown, or a lone word that reads as a vibe ('elixir', 'intense'): retry in context
      const it = ctx.r.item, brand = model.vocab.b[it.b] || '', typed = tokensOf(ctx.n), own = tokensOf(it.nm).filter(t => !FREE_WORDS.has(t));
      const tries = [typed.slice(0, -1).join(' '), brand, own.slice(0, -1).join(' ')].filter(Boolean).map(p => p + ' ' + x.n);
      for (const t of tries) { const r = resolveFact(t, model, L); if (r && r.kind === 'catalog' && r.item.id !== it.id) { x.r = r; break; } }
    });
    return sides;
  }
  function tryCompare(req, model) {
    const th = S.thread, c = parseCompare(req.text);
    if (!c) return false;
    const sides = resolveSides(c.names, model, S.lex);
    const named = sides.filter(x => x.r && (x.r.kind === 'catalog' || x.r.kind === 'ref'));
    if (c.list && (c.names.length < 2 || !named.length)) {
      // "compare your top 3 fresh ones": answer the words, then put the picks side by side
      if (parse(c.rest, S.lex, model, {}).parts.length) { req.text = c.rest; req.compareAfter = true; }
      return false;
    }
    // a vibe word on one side ("fresh or sweet"), or only filler ("hawas ice and something"): a search, not a comparison
    if (sides.some(x => x.r === null || (x.r.kind === 'unknown' && !cleanName(x.n)))) return false;
    return compareSides(req, model, sides, c.crit, c.pre);
  }
  // Two or more stocked bottles → the table (+ verdict); one → anchor on it (req.text / notes changed for the caller); none → false.
  function compareSides(req, model, sides, crit, pre) {
    const th = S.thread, seen = new Set(), stocked = [];
    sides.forEach(x => { if (x.r && x.r.kind === 'catalog' && !seen.has(x.r.item.id)) { seen.add(x.r.item.id); stocked.push(x.r.item); } });
    const others = sides.filter(x => !x.r || x.r.kind !== 'catalog').map(x => (x.r && x.r.name) || x.n);
    if (stocked.length >= 2) {
      const ids = stocked.map(it => it.id), notes = [];
      if (others.length) notes.push(fill(T.vsNote, { other: others.join(', ') }));
      compareVerdict(stocked, crit, pre, model).forEach(l => notes.push(l));
      const turn = { role: 'bot', text: T.compare, notes, table: compareRows(ids, model), mode: 'compare' };
      th.turns.push(turn); renderTurn(turn, true); th.lastIds = ids; setChips('follow'); renderFoot(); save();
      if (req.typed) logQuery(req.text, ids.length);
      return true;
    }
    if (stocked.length === 1) {   // one stocked bottle: anchor on it, explain the other
      req.text = 'like ' + String(stocked[0].nm).toLowerCase(); req.vsNote = fill(T.vsNote, { other: others.join(', ') });
      if (CMP_WEAR_RE.test(pre || '')) req.preNote = T.cmpWearOne;
    }
    return false;
  }
  // "is X good for Y" / "does X work for Y": suitability of a stocked bottle for an occasion.
  const SUIT_RE = /^(?:is|does|will|can)\s+(.+?)\s+(?:good|ok|okay|suitable|fine|work|nice|right|wearable)\s+(?:for|in|at|on|during)\s+(.+?)\s*\??$/i;
  const catalogOf = (text, model) => { const q = parse(hasTrigger(text, S.lex, model) ? text : 'like ' + text, S.lex, model, {}); return q.anchor && q.anchor.kind === 'catalog' ? model.byId.get(q.anchor.id) : null; };
  function profileLine(it, model) {
    const V = model.vocab; const acc = (it.a || []).slice(0, 3).map(i => V.a[i]).filter(Boolean);
    return lowerList(acc) + (it.k >= 0 && V.k[it.k] ? ', ' + V.k[it.k] : '');
  }
  // ── Skills 1–3 (2026-10-15): product facts · conversation · shop questions ──
  // Closure rule (intents and shop questions): the WHOLE message must be covered by known
  // phrases plus filler / question words. Anything left over means "search for that".
  const QWORDS = new Set(('din dine pabo pabe paben pai dite dibo dib deya dewa nite nibo it them these those speak speaks talk amount how much many what whats which where when why who is are was were do does did can could will would should there here your you u ur the a an it its this that in to of for on at with about koto ki kivabe kemne kemon naki ache ase achhe hoy hobe kore koren korte dao den diben parben parbo pari paren paro jay jabe i me my we our please pls plz bro bhai vai apni tumi tomra apnara apnader tomader ami amra amar amader ekta kichu ek one vs versus or and also too ta er r e ke te ji na hmm tell say bolo bolen bolun janao janan jante chai chacchi want need like sell sells selling accept take taken have has got give gives available provide provides possible info information details detail question ask asking kina koi kothay kothai kon konta hole now today ekhon akhon currently still again abar ok okay so then um uh eh hi hello hey thanks thank bhaiya apu dear sir madam mam').split(' '));
  let CHAT = null;
  function chatIndex(L) {
    if (CHAT && CHAT.L === L) return CHAT;
    L = L || {};
    const intents = new Map(), faq = new Map(); let maxLen = 1;
    const add = (map, phrase, key) => { const p = normalize(phrase); if (!p || p === ',') return; const n = p.split(' ').length; if (n > maxLen) maxLen = n; if (!map.has(p)) map.set(p, key); };
    Object.keys(L.intents || {}).forEach(k => (L.intents[k] || []).forEach(m => add(intents, m, k)));
    (L.faq || []).forEach(f => (f.m || []).forEach(m => add(faq, m, f.key)));
    const gloss = new Map(); (L.glossary || []).forEach(g => (g.m || []).forEach(m => add(gloss, m, g.key)));
    const skip = new Set(STOP); QWORDS.forEach(w => skip.add(w)); (L.stop || []).forEach(w => skip.add(normalize(w)));
    const glossSkip = new Set(skip); GLOSS_MARK.forEach(w => glossSkip.add(w)); ['between', 'means', 'mean', 'meaning', 'stand', 'stands', 'full', 'form', 'term', 'terms', 'word', 'words', 'perfume', 'perfumes', 'fragrance', 'fragrances', 'lasts', 'last', 'longer', 'longest', 'stronger', 'better', 'which', 'one', 'than', 'more', 'less'].forEach(w => glossSkip.add(w));
    CHAT = { L, intents, faq, gloss, skip, glossSkip, maxLen };
    return CHAT;
  }
  // Glossary ("what is the difference between edp and edt"): needs a question marker, so "edp" alone stays a search.
  const GLOSS_MARK = new Set(['what', 'whats', 'ki', 'mane', 'means', 'mean', 'meaning', 'difference', 'different', 'differences', 'vs', 'versus', 'explain', 'define', 'definition', 'stand', 'stands', 'full', 'kake', 'bujhay', 'bolte', 'jinis', 'better', 'bujhi', 'bujhlam', 'মানে', 'কাকে', 'পার্থক্য']);
  const GLOSS_CONC = new Set(['edp', 'edt', 'edc', 'extrait', 'parfum', 'intense', 'elixir', 'concentration']);
  function glossOf(text, L) {
    L = L || S.lex || {};
    const cx = chatIndex(L); if (!cx.gloss.size) return null;
    const tk = tokensOf(text); if (!tk.length || !tk.some(t => GLOSS_MARK.has(t))) return null;
    const r = closure(tk, cx.gloss, Object.assign({}, cx, { skip: cx.glossSkip }));
    if (!r.hits.length || r.rest.length) return null;
    return r.hits.filter((k, i) => r.hits.indexOf(k) === i);
  }
  // Longest-phrase walk: the keys hit (in order) and the tokens nothing covered.
  function closure(tokens, map, cx) {
    const hits = [], rest = [];
    for (let i = 0; i < tokens.length;) {
      let hit = null;
      for (let n = Math.min(cx.maxLen, tokens.length - i); n >= 1 && !hit; n--) { const k = map.get(tokens.slice(i, i + n).join(' ')); if (k) hit = { k, n }; }
      if (hit) { hits.push(hit.k); i += hit.n; continue; }
      const t = tokens[i];
      if (t === ',' || cx.skip.has(t) || (isNum(t) && tokens[i + 1] === 'ml')) { i++; continue; }
      rest.push(t); i++;
    }
    return { hits, rest };
  }
  const INTENT_ORDER = ['reset', 'guide', 'help', 'random', 'why', 'memory', 'new', 'lang', 'maker', 'bot', 'bye', 'thanks', 'greet', 'ack'];
  function intentOf(text, L) {
    L = L || S.lex || {};
    const cx = chatIndex(L), tk = tokensOf(text);
    if (!tk.length) return null;
    const r = closure(tk, cx.intents, cx);
    if (!r.hits.length || r.rest.length) return null;
    const k = INTENT_ORDER.find(k => r.hits.indexOf(k) >= 0) || r.hits[0];
    if (k === 'ack' && tk.filter(t => t !== ',').length > 3) return null;   // "ok show me 5ml price" is not an acknowledgement
    return k;
  }
  function faqOf(text, L) {
    L = L || S.lex || {};
    const cx = chatIndex(L), tk = tokensOf(text);
    if (!tk.length) return null;
    const r = closure(tk, cx.faq, cx);
    if (!r.hits.length || r.rest.length) return null;
    const keys = (L.faq || []).map(f => f.key), count = new Map();
    r.hits.forEach(k => count.set(k, (count.get(k) || 0) + 1));
    if (count.has('abroad')) return 'abroad';   // "do you ship to India": the place decides, not the verb
    let best = null; count.forEach((c, k) => { if (!best || c > best.c || (c === best.c && keys.indexOf(k) < keys.indexOf(best.k))) best = { k, c }; });
    return best ? best.k : null;
  }
  // Question frames around a product name. Matched on the normalised, punctuation-free text;
  // group 1 is the name. A frame only counts when the name resolves (see resolveFact).
  const ML_RE = /\b(\d+(?:\.\d+)?) ml\b/;
  const FRAMES = [
    ['smell', /^(?:what|how) (?:does|do|is|would|will|dose) (.+?) (?:smell|smells|smell like|smells like)$/],
    ['smell', /^(?:what|how) (?:does|do|is) the (?:smell|scent|vibe|character|dna) of (.+)$/],
    ['smell', /^(.+?) (?:smells? like what|smell kemon|er smell kemon|kemon smell|kemon ghran|er ghran kemon|gondho kemon|er gondho kemon|kemon lage|kemon|kemon hoy|smell ki rokom|ki rokom)$/],
    ['notes', /^(?:what (?:are|is) |whats |what |)(?:the |its |)(?:top |heart |middle |base |main |key |)notes? (?:of|in|for|on) (.+)$/],
    ['notes', /^(.+?) (?:er |)(?:top |heart |middle |base |main |)notes?$/],
    ['notes', /^(?:notes? |ingredients? |accords? |composition |pyramid )(?:of |in |for |)(.+)$/],
    ['notes', /^(?:what (?:are|is) |)(?:the |)(?:ingredients|accords|composition|pyramid|note breakdown) (?:of|in|for) (.+)$/],
    ['price', /^(?:tell me |)(?:how much|what) (?:(?:does|is|do|would|will) )?(?:the |a |an |)(.+?) (?:cost|costs|price|priced at|sell for|go for)(?: please| pls| plz)?$/],
    ['about', /^(?:tell me about|tell me more about|tell about|tell me|describe|about|info on|info about|information about|information on|details of|details about|details on|detail of|review of|review|reviews of|explain|what is|whats|what about|how is|how good is|hows|how about|thoughts on|opinion on|your opinion on|is it good|rate|rating of|how would you rate|how do you rate) (.+)$/],
    ['about', /^(.+?) (?:er |)(?:details|detail|review|reviews|info|information|bapare bolo|bapare bolen|bapare bolun|somporke bolo|somporke bolen|bapare|somporke|kemon hobe|niye bolo|niye bolen|niye bolun|ki rokom|rating|ratings)$/],
    ['family', /^(?:what|which) (?:family|type|kind|category|genre|style) (?:is|does|of|do|has) (.+?)(?: belong to| fall under| fall in| have| has| come under)?$/],
    ['family', /^(.+?) (?:er |)(?:family|type|category|genre|style)(?: ki| kon| koto| what)?$/],
    ['gender', /^(?:is|does|can) (.+?) (?:unisex|for men|for women|for ladies|for girls|for guys|for boys|for a man|for a woman|masculine|feminine|a mens|a womens|mens|womens|men|women|for both|for male|for female|male|female|for her|for him|wearable by women|good for women|good for ladies|ok for women|ok for ladies|for everyone|for anyone|only for men|only for women|manly|girly)(?: or (?:men|women|unisex|for men|for women|female|male))?$/],
    ['gender', /^(.+?) (?:ki |)(?:unisex|meyeder jonno|cheleder jonno|meyera porte parbe|meye ra porte parbe|chele ra porte parbe|mens|womens|for men|for women|male|female|masculine|feminine|unisex naki|unisex ki)$/],
    ['strength', /^(?:is|does) (.+?) (?:strong|powerful|heavy|loud|light|soft|subtle|weak|long lasting|longlasting|a beast|beast mode|beastly|intense|mild|gentle|strong enough|too strong|too heavy|too loud|office safe|a skin scent|skin scent)(?: or (?:light|soft|weak|strong|heavy|mild))?$/],
    ['strength', /^how (?:strong|powerful|heavy|loud|light|soft|intense|strong or light|heavy or light) (?:is|does|will|would) (.+)$/],
    ['strength', /^how (?:long|many hours) (?:does|do|will|can|would) (.+?) (?:last|lasts|stay|stays|lasting|last on skin|stay on skin|last for|go|last on clothes)$/],
    ['strength', /^(?:how|whats|what is|how is|hows|rate the|rate|what about the|how about the) (?:the |)(?:longevity|performance|projection|sillage|strength|power|lasting power|staying power|longevity and projection|projection and longevity) (?:of|for|on|is) (.+)$/],
    ['strength', /^(.+?) (?:er |)(?:longevity|performance|projection|sillage|strength|lasting power|staying power|longevity kemon|performance kemon|projection kemon)(?: kemon| koto| ki| how is it| how much| how long)?$/],
    ['strength', /^(.+?) (?:koto khon|kotokkhon|kotokhon|koto time|koto ghonta|koto somoy|kotokkhon porjonto|koto der|kotokhon porjonto) (?:thake|thakbe|lasts?|lasting|stay|stays|jay|jabe|thakbe skin e|skin e thake)$/],
    ['strength', /^(.+?) (?:ki |)(?:strong|kora|shokto|halka|light|soft|heavy|bhari|vari|beast|long lasting|longlasting)(?: naki| ki| hoy| perfume)?$/],
    ['strength', /^(?:does|is|will|can) (.+?) (?:last long|last all day|last the whole day|last whole day|stay long|stay all day|last for long|last for hours|last hours|last \d+ hours|last \d+ hour|last \d+ hrs|project well|project|perform well|perform|have good longevity|have good projection|have good sillage|last till evening|last till night|survive the heat|survive summer)$/],
    ['price', /^(?:price|prices|cost|dam|rate|rates|how much|how much is|how much for|how much does|how much do|how much are|how much will|koto|koto taka|koto dam|dam koto|price koto|what is the price|whats the price|what the price|what is the cost|whats the cost|what the cost|cheapest size|cheapest price|lowest price|smallest size|biggest size|largest size|price list|price range|pricing|price check|how much money) (?:of |for |is |does |the |a |will |)(.+?)(?: cost| costs| price| dam| koto| taka| tk| cost in taka| in taka| be)?$/],
    ['price', /^(.+?) (?:er |r |)(?:price|prices|cost|rate|koto|koto taka|dam|dam koto|price koto|price ki|price list|koto kore|koto tk|koto taka kore|dam ki|kinte koto|price range|pricing)(?: koto| ki| kemon| lagbe| hobe| porbe| what| taka| tk| please| pls)?$/],
    ['have', /^(?:do you|do u|du|you|u|does nawmee|does the shop|does this shop|do they|does your shop|do you guys|you guys|do you people|does nawme|ki|apnader kache|apnader|tomader kache|tomader|apnar kache|tomar kache|apni|tumi|do you still|do u still) (?:have|has|sell|sells|stock|carry|got|keep|offer|provide|still have|still sell|still stock|also have|also sell|ache|ase|achhe|rakhen|rakho|rakhe|bikri koren|bikri koro|bikroy koren|bikri kore|kinte pabo|pabo|paoa jabe|pawa jabe|got any|have any|have got|have the|sell the|stock the)(?: any| the| some| a| an| this| that| ei| oi)? (.+?)(?: in stock| available| instock| in your stock| in your shop| in the shop| ache| ase| achhe| naki| now| right now| currently| ekhon| or not)?$/],
    ['have', /^(?:is|are|was|has|have) (?:the |)(.+?) (?:in stock|available|instock|in-stock|still available|still in stock|back in stock|restocked|sold out|out of stock|ache|ase|achhe|paoa jay|pawa jay|paoa jabe|pawa jabe|stock e ache|stock e ase|stock ache|stock ase|stock a ase|ekhon ache|ekhon ase|there|here|on the site|on your site|on your website|listed)(?: now| right now| currently| ekhon| naki| ki| or not)?$/],
    ['have', /^(.+?) (?:ache|ase|achhe|ache ki|ase ki|achhe ki|ki ache|ki ase|in stock|available|instock|available ki|is available|is in stock|paoa jabe|pawa jabe|paoa jay|pawa jay|paoa jabe ki|pawa jabe ki|stock e ache|stock e ase|stock ache|stock ase|stock a ase|stock a ache|ekhon ache|ekhon ase|stock|availability|available naki|ache naki|ase naki)(?: ki| naki| now| right now| ekhon| apnader kache| tomader kache)?$/],
    ['have', /^(?:have|got|sell|stock|availability of|availability|stock of|do u have|any stock of|got any|looking for|searching for|searching|i am looking for|im looking for|i m looking for|where can i find|where can i get|where to get|where to buy|where can i buy|khujtesi|khujchi|khujtechi) (?:any |the |some |a |an |)(.+)$/],
    ['have', /^(?:any|anything|something|some|bottles|perfumes|decants|kichu|other|others|more|all|everything) (?:from|by|of|er|r) (.+)$/],
    ['buy', /^(?:i want to |i wanna |want to |wanna |i would like to |id like to |i d like to |i will |ill |i ll |lets |let s |let me |i want |can i |could i |how to |how do i |how can i |i need to |need to |)(?:buy|order|purchase|get|take|book|reserve|nibo|kinbo|kinte chai|nite chai|order korbo|order korte chai|order dibo|order dite chai|kinte chacchi|nite chacchi|add|confirm) (?:the |a |one |ekta |this |that |me |)(.+?)(?: please| pls| plz| now| today| for me| to cart| to my cart| to the cart)?$/],
    ['buy', /^(.+?) (?:ta |ekta |)(?:kinbo|nibo|kinte chai|nite chai|order korbo|order korte chai|order dibo|order dite chai|kinte chacchi|nite chacchi|lagbe|chai|order koro|order korun|order dao|order den|book koro|book korun|nite chacchi|kinte chaci|nite chaci)$/],
  ];
  const NAME_LEAD = /^(?:(?:any|anything|something|some|the|a|an|this|that|ei|oi|kono|ekta|all|every|other|others|more|new|good|nice|best|your|ur|from|by|of|in|about|on|for|to|is|does|do|please|pls|plz|me|us|one|called|named|name|this one|that one|ok|okay|so|then|now|show|tell|give|can you|could you|just|also|same|but|and|only|again|it|them|these|those|first|next) )+/;
  const NAME_TAIL = /(?: (?:perfume|perfumes|fragrance|fragrances|decant|decants|bottle|bottles|scent|ta|ti|one|er|r|ki|naki|please|pls|plz|bhai|bro|vai|at your shop|here|on your site|in your shop|in your store|in bangladesh|in bd|in dhaka|now|right now|currently|ekhon|today|for me|cost|price|dam|koto|taka|tk|at all|or not|me|us|it|them|these|those|this|that|ok|okay|so|then|just|also|same|but|and|only|again|show|tell|give))+$/;
  function cleanName(name) {
    let n = String(name || '').replace(/\s+/g, ' ').trim();
    for (let k = 0; k < 3; k++) n = n.replace(NAME_LEAD, '').replace(NAME_TAIL, '').trim();
    if (/^(?:me|us|it|them|these|those|this|that|ok|okay|so|then|just|also|same|but|and|only|again|show|tell|give|one|please|pls|plz|the|a|an)$/.test(n)) n = '';   // a lone filler word is no name
    return n;
  }
  function matchFrame(text) {
    const s = tokensOf(text).filter(t => t !== ',').join(' ');
    if (!s) return null;
    const mm = ML_RE.exec(s), ml = mm ? Number(mm[1]) : null;
    for (const [kind, re] of FRAMES) {
      const m = re.exec(s); if (!m) continue;
      let name = String(m[1] || '').trim();
      if (ml != null) name = name.replace(ML_RE, ' ').replace(/\s+/g, ' ').trim();
      name = cleanName(name);
      return { kind, name, ml, pyramid: kind === 'notes' && /\b(?:top|heart|middle|base)\b/.test(s) };
    }
    return null;
  }
  // What the name refers to: a stocked bottle, a famous reference, a brand we carry, a
  // brand we know but do not carry, a vibe word (→ null: normal search) or nothing known.
  function resolveFact(name, model, L) {
    if (!name || !model) return null;
    L = L || S.lex || {};
    // Bare first: a name with a stop word inside it ("supremacy not only intense") resolves as one phrase there,
    // while the "like …" scan would stop at the "not".
    const bare = parse(name, L, model, {});
    if (bare.anchor && bare.anchor.kind === 'catalog') { const it = model.byId.get(bare.anchor.id); if (it) return { kind: 'catalog', item: it, anchor: bare.anchor }; }
    const q = parse(hasTrigger(name, L, model) ? name : 'like ' + name, L, model, {});
    if (q.anchor && q.anchor.kind === 'catalog') { const it = model.byId.get(q.anchor.id); if (it) return { kind: 'catalog', item: it, anchor: q.anchor }; }
    if (q.anchor && q.anchor.kind === 'ref') return { kind: 'ref', name: q.anchor.name, anchor: q.anchor };
    const alias = (L.brandAliases || {})[normalize(name)];
    if (alias && !model.vocab.b.some(b => String(b).toLowerCase() === String(alias).toLowerCase())) return { kind: 'nobrand', name: alias };
    const bq = parse(name, L, model, {});
    const feats = Object.keys(bq.features || {});
    const brand = feats.find(k => /^b:/.test(k) && bq.features[k] > 0);
    const scent = feats.some(k => !/^b:/.test(k)) || bq.maxPrice != null || bq.minPrice != null || !!bq.strength || !!bq.gender || !!bq.collection || !!bq.cheaper;
    if (scent) return null;
    if (brand) return { kind: 'brand', name: brand.slice(2) };
    return { kind: 'unknown', name };
  }
  const CONC_LONG = { EDP: 'an Eau de Parfum (EDP)', EDT: 'an Eau de Toilette (EDT)', EDC: 'an Eau de Cologne (EDC)', Extrait: 'an Extrait de Parfum', Parfum: 'a Parfum', 'EDP Intense': 'an EDP Intense', Elixir: 'an Elixir' };
  // The fact reply (text + sub lines) for one stocked bottle; pure, so the tests can read it.
  function factLines(kind, it, model, x) {
    x = x || {}; const V = model.vocab, labels = (p, idxs) => idxs.map(i => V[p][i]).filter(Boolean);
    const name = it.nm, brand = V.b[it.b] || '';
    const fam = labels('f', it.f || []), acc = labels('a', (it.a || []).slice(0, 5)), notes = labels('n', (it.n || []).slice(0, kind === 'notes' ? 12 : 6)), occ = labels('o', it.o || []);
    const conc = it.k >= 0 && V.k[it.k] ? V.k[it.k] : null, gender = it.g === 3 ? 'Unisex' : 'For men';
    const sizes = (it.s || []).map(p => p[0] + ' ml ৳' + effectivePrice(p[1], it.sp)).join(' · ');
    const smell = fill(normalize(name).indexOf(normalize(brand)) === 0 && brand ? T.factSmellSelf : T.factSmell, { name, brand, family: fam.length ? lowerList(fam) : 'family not listed', accords: acc.length ? acc.map(a => String(a).toLowerCase()).join(', ') : '—' });
    const listed = occ.length ? fill(T.factListed, { occ: occ.join(', '), gender, conc: conc || T.concUnlisted }) : fill(T.factListedNoOcc, { gender, conc: conc || T.concUnlisted });
    const priceLine = fill(T.factFrom, { price: it.p }) + (sizes ? ' — ' + sizes : '');
    const noteLine = notes.length ? fill(T.factNotes, { notes: notes.map(n => String(n).toLowerCase()).join(', ') }) : null;
    let text, lines;
    if (kind === 'price') {
      if (x.ml != null) { const sz = (it.s || []).find(p => Number(p[0]) === x.ml); text = sz ? fill(T.factPriceSize, { name, ml: x.ml, price: effectivePrice(sz[1], it.sp) }) : fill(T.factNoSize, { name, ml: x.ml }); }
      else text = fill(T.factPrice, { name, price: it.p, ml: (it.s && it.s[0] && it.s[0][0]) || 3 });
      lines = [sizes ? fill(T.factSizes, { sizes }) : null, it.sp > 0 ? fill(T.factSale, { pct: it.sp }) : null, smell, listed];
    } else if (kind === 'gender') { text = fill(it.g === 3 ? T.factUnisex : T.factMen, { name }); lines = [smell, listed, priceLine]; }
    else if (kind === 'strength') {
      const a = axisScore(it, 'strong', model), lean = a > 0.15 ? T.leanStrong : a < -0.15 ? T.leanSoft : T.leanMid;
      text = conc ? fill(T.factStrength, { name, conc: CONC_LONG[conc] || conc, lean }) : fill(T.factStrengthNoConc, { name, lean }); lines = [smell, listed, priceLine];
    } else if (kind === 'have') { text = fill(T.factHave, { name }); lines = [smell, listed, priceLine]; }
    else if (kind === 'buy') { text = fill(T.factBuy, { name }); lines = [smell, priceLine]; }
    else { text = smell; lines = [noteLine, x.pyramid ? T.factPyramid : null, listed, priceLine]; }   // smell · notes · about · family
    if (it.c === 'e') lines.push(fill(T.factExclusive, { name }));
    return { text, notes: lines.filter(Boolean) };
  }
  function similarTo(it, model, excludeIds, limit) {
    const q = compose([anchorPart({ kind: 'catalog', id: it.id, name: it.nm })]);
    return rank(model, q, { exclude: excludeIds, limit: limit || 3 }).map(r => r.item);
  }
  const minFrom = model => { let m = null; model.items.forEach(it => { if (it.i && it.c === 'r' && it.p > 0 && (m == null || it.p < m)) m = it.p; }); return m == null ? 170 : m; };
  const FAQ_RATES = { dhaka: 70, suburb: 90, outside: 120 }, FAQ_POINTS = ['Aftabnagar', 'Banasree'];
  const siteSettings = () => { try { return (typeof window !== 'undefined' && window.__SETTINGS__) || null; } catch (e) { return null; } };
  // The owner's homepage FAQ (site settings) answers first when it has the question.
  function ownerFaq(re) { const s = siteSettings(); const list = s && s.homeSections && Array.isArray(s.homeSections.faq) ? s.homeSections.faq : []; const hit = list.find(f => f && re.test(String(f.q || ''))); return hit && hit.a ? String(hit.a).trim() : null; }
  const waLink = () => ({ href: waHref(), label: T.whatsapp, external: true });
  function faqLines(key, model) {
    const s = siteSettings() || {}, d = s.delivery || {};
    const rate = k => { const n = Number(d[k]); return Number.isFinite(n) && n >= 0 ? n : FAQ_RATES[k]; };
    const pts = Array.isArray(d.pickupPoints) && d.pickupPoints.length ? d.pickupPoints.map(String) : FAQ_POINTS;
    const about = { href: 'about.html', label: T.faqMore };
    switch (key) {
      case 'delivery': return { text: fill(T.faqDelivery, { dhaka: rate('dhaka'), suburb: rate('suburb'), outside: rate('outside') }), notes: [ownerFaq(/deliver/i) || T.faqDeliveryTime, T.faqDeliveryAdvance], link: about };
      case 'abroad': return { text: T.faqAbroad, notes: [], link: waLink() };
      case 'payment': return { text: T.faqPayment, notes: [T.faqPaymentFixed], link: about };
      case 'order': return { text: T.faqOrder, notes: [T.faqOrderAdvance, T.faqReturnsCancel], link: about };
      case 'authentic': return { text: ownerFaq(/authentic/i) || T.faqAuthentic, notes: [T.faqAuthenticHow], link: about };
      case 'sizes': return { text: T.faqSizes, notes: [fill(T.faqSizesStart, { min: minFrom(model) })], link: about };
      case 'decant': return { text: ownerFaq(/what is a .*decant/i) || T.faqDecant, notes: [ownerFaq(/why buy a decant/i) || T.faqDecantWhy, T.faqType], link: about };
      case 'type': return { text: T.faqType, notes: [T.faqTypeSizes], link: about };
      case 'returns': return { text: ownerFaq(/return|exchange/i) || T.faqReturns, notes: [T.faqReturnsCancel], link: about };
      case 'pickup': return { text: fill(T.faqPickup, { points: joinAnd(pts) }), notes: [], link: waLink() };
      case 'contact': return { text: T.faqContact, notes: [], link: waLink() };
      case 'offers': return { text: T.faqOffers, notes: [], link: waLink() };
      case 'tracking': return { text: T.faqTracking, notes: [], link: waLink() };
    }
    return null;
  }
  // A plain reply turn (no cards); the chip row stays where it was.
  function sayTurn(req, text, notes, link, logged) {
    const th = S.thread, t = { role: 'bot', text, notes: notes || [], link: link || null };
    th.turns.push(t); renderTurn(t, true);
    if (th.wizard) setChips(th.chips); else setChips(th.lastIds.length ? 'follow' : 'opening');
    save();
    if (req.typed && logged !== false) logQuery(req.text, 0);
    return true;
  }
  const ORDINALS = [['second', 1], ['2nd', 1], ['two', 1], ['ditio', 1], ['দ্বিতীয়', 1], ['third', 2], ['3rd', 2], ['three', 2], ['tritio', 2], ['তৃতীয়', 2], ['first', 0], ['1st', 0], ['top', 0], ['prothom', 0], ['প্রথম', 0], ['one', 0], ['1', 0]];
  function ordinalIn(text, count) {
    const s = ' ' + tokensOf(text).join(' ') + ' ';
    if (/ (?:last|shesh|শেষ) (?:one|ta|টা)? ?/.test(s) && count) return count - 1;
    for (const [w, i] of ORDINALS) if (s.indexOf(' ' + w + ' ') >= 0 && i < count) return i;
    const m = /(?:number|no|#) ?([1-3])\b/.exec(s); if (m && Number(m[1]) - 1 < count) return Number(m[1]) - 1;
    return null;
  }
  function chatAnswer(req, kind, model) {
    const th = S.thread;
    switch (kind) {
      case 'reset': reset(); return true;
      case 'guide': { const t = { role: 'bot', text: T.chatGuide }; th.turns.push(t); renderTurn(t, true); startGuide(); if (req.typed) logQuery(req.text, 0); return true; }
      case 'random': { const part = surprisePart(th.turns.length, S.lex, model); if (part) addParts([part]); if (req.typed) logQuery(req.text, 0); runAnswer({ mode: 'answer', retry: true }); return true; }
      case 'help': return sayTurn(req, T.chatHelp, T.chatHelpLines);
      case 'greet': return sayTurn(req, T.chatGreet, null, null, false);
      case 'thanks': return sayTurn(req, T.chatThanks, null, null, false);
      case 'bye': return sayTurn(req, th.lastIds.length ? T.chatByeList : T.chatBye, null, null, false);
      case 'ack': return sayTurn(req, T.chatAck, null, null, false);
      case 'bot': return sayTurn(req, T.chatBot, null, waLink());
      case 'maker': return sayTurn(req, T.chatMaker);
      case 'lang': return sayTurn(req, T.chatLang);
      case 'why': return sayTurn(req, th.lastIds.length ? T.chatWhy : T.chatWhyNone);
      case 'memory': {
        // "the first one price" / "more like the second one" / "the last one": act on that pick when there is a shortlist
        const n = ordinalIn(req.text, th.lastIds.length), it = n != null ? model.byId.get(th.lastIds[n]) : null;
        if (it) {
          const s = tokensOf(req.text).join(' ');
          if (/\b(?:price|prices|cost|dam|koto|taka|tk|ml|rate)\b/.test(s)) { const mm = ML_RE.exec(s); return factAnswer(req, model, { kind: 'price', name: it.nm, ml: mm ? Number(mm[1]) : null }, it); }
          if (/\b(?:like|similar|moto|more|aro|onno)\b/.test(s)) { addParts([anchorPart({ kind: 'catalog', id: it.id, name: it.nm })]); if (req.typed) logQuery(req.text, 0); runAnswer({ mode: 'answer' }); return true; }
          return factAnswer(req, model, { kind: 'about', name: it.nm }, it);
        }
        return sayTurn(req, th.lastIds.length ? T.chatMemoryList : T.chatMemory);
      }
      case 'new': return sayTurn(req, T.chatNew, null, { href: 'shop.html', label: T.browseAll.replace(/\s*→\s*$/, '') });
      case 'bottle': return sayTurn(req, T.chatBottle);
      case 'more': if (th.lastIds.length) { if (req.typed) logQuery(req.text, 0); runAnswer({ mode: 'more' }); return true; } { const t = { role: 'bot', text: T.chatMoreStart }; th.turns.push(t); renderTurn(t, true); startGuide(); if (req.typed) logQuery(req.text, 0); return true; }
      case 'brands': if (th.lastIds.length) { if (req.typed) logQuery(req.text, 0); runAnswer({ mode: 'answer', text: 'different brands' }); return true; } { const t = { role: 'bot', text: T.chatMoreStart }; th.turns.push(t); renderTurn(t, true); startGuide(); if (req.typed) logQuery(req.text, 0); return true; }
    }
    return false;
  }
  // One bottle we stock: its card (never twice in a thread), the facts, and three similar links.
  function factAnswer(req, model, f, it) {
    const th = S.thread;
    if (!it.i) { req.text = 'like ' + String(it.nm).toLowerCase(); req.preNote = fill(T.factHaveOut, { name: it.nm }); return false; }
    const x = factLines(f.kind, it, model, f);
    addParts([Object.assign(anchorPart({ kind: 'catalog', id: it.id, name: it.nm }), { soft: true })]);   // soft: follow-ups use it, a new search drops it
    th.pending = [];
    const fresh = th.renderedIds.indexOf(it.id) < 0;
    if (fresh) th.cards[it.id] = { c: toCard(it, model), e: it.c === 'e' };
    const sim = similarTo(it, model, th.renderedIds.concat([it.id]), 3);
    const turn = { role: 'bot', text: x.text, notes: x.notes, ids: fresh ? [it.id] : [], reasons: fresh ? [reasons({ item: it, matched: [] }, th.query, model, null)] : [], mode: 'fact' };
    if (sim.length) turn.also = { label: T.factSimilar, items: sim.map(s => ({ id: s.id, nm: s.nm })) };
    th.turns.push(turn);
    if (fresh) th.renderedIds.push(it.id);
    th.lastIds = [it.id];
    renderTurn(turn, true); setChips('follow'); renderFoot(); shareUrl(); save();
    if (req.typed) logQuery(req.text, 1);
    return true;
  }
  function trySpecial(req, model) {
    if (!req.typed || !req.text) return false;
    const th = S.thread, text = String(req.text).trim();
    // Typed relational follow-ups ("aro sweet kichu", "more fresh", "sweeter one"): the same as the Fresher / Sweeter / Stronger chips —
    // each pick must lean that way more than the current #1, not just nudge the ranking.
    if (th.lastIds.length) {
      const ax = axisFollowUp(text);
      if (ax) { if (req.typed) logQuery(req.text, 0); runAnswer({ mode: 'axis', axis: ax.axis, text: ax.text }); return true; }
    }
    // Skill 2: greetings, meta questions, open-ended asks (the whole message, nothing left over)
    const intent = intentOf(text, S.lex);
    if (intent && chatAnswer(req, intent, model)) return true;
    // Glossary ("what does extrait mean", "edp vs edt") — before the fact frames, so "what is sillage" is never a bottle name
    const gk = glossOf(text, S.lex);
    if (gk) { const defs = gk.map(k => T.gloss[k]).filter(Boolean); if (defs.length) return sayTurn(req, defs[0], defs.slice(1).concat(gk.some(k => GLOSS_CONC.has(k)) ? [T.glossConc] : [])); }
    // Skill 1: a question about one bottle ("what does X smell like", "price of X", "do you have X")
    const f = matchFrame(text);
    if (f) {
      const cur = th.query && th.query.anchor && th.query.anchor.kind === 'catalog' ? model.byId.get(th.query.anchor.id) : null;
      if (!f.name && f.ml != null && cur) { f.kind = 'price'; return factAnswer(req, model, f, cur); }
      const r = f.name ? resolveFact(f.name, model, S.lex) : null;
      if (r && r.kind === 'catalog') return factAnswer(req, model, f, r.item);
      if (r && r.kind === 'ref') { req.text = 'like ' + f.name; req.preNote = fill(T.notStocked, { name: r.name }); return false; }
      if (r && r.kind === 'brand') { req.text = f.name; return false; }
      if (r && r.kind === 'nobrand') return sayTurn(req, fill(T.haveNoBrand, { brand: r.name }), null, waLink());
      if (r && r.kind === 'unknown' && !faqOf(text, S.lex)) return sayTurn(req, fill(T.haveUnknown, { name: f.name }), null, waLink());
    }
    // Skill 3: shop questions (delivery, payment, sizes, authenticity …)
    const fk = faqOf(text, S.lex);
    if (fk) { const a = faqLines(fk, model); if (a) return sayTurn(req, a.text, a.notes, a.link); }
    // Comparisons (two or more stocked bottles side by side, with a verdict on the criterion)
    if (tryCompare(req, model)) return true;
    let m = SUIT_RE.exec(text);
    if (m) {
      const it = catalogOf(m[1], model); if (!it) return false;
      const occQ = parse(m[2], S.lex, model, {});
      const V = model.vocab, listed = (it.o || []).map(i => V.o[i]).filter(Boolean);
      const wanted = Object.keys(occQ.features || {}).filter(k => /^o:/.test(k) && occQ.features[k] > 0).sort((x, y) => occQ.features[y] - occQ.features[x]).map(k => k.slice(2));
      const isListed = w => listed.some(l => l.toLowerCase() === w.toLowerCase());
      const hit = wanted.filter(isListed);
      const profile = profileLine(it, model);   // (the user turn was already added by onSubmit)
      if (!wanted.length) { botText(fill(T.suitUnknown, { name: it.nm, profile, listed: listed.join(', ') || '—' })); setChips(th.lastIds.length ? 'follow' : 'opening'); save(); if (req.typed) logQuery(req.text, 0); return true; }
      // The occasion they named (first) must be listed; a secondary one ("office" also implies Everyday) is only "workable".
      if (hit.length && isListed(wanted[0])) { botText(fill(T.suitYes, { name: it.nm, occ: wanted[0], profile })); setChips(th.lastIds.length ? 'follow' : 'opening'); save(); if (req.typed) logQuery(req.text, 1); return true; }
      if (hit.length) { botText(fill(T.suitPartial, { name: it.nm, occ: wanted[0], hit: hit.join(', '), profile })); setChips(th.lastIds.length ? 'follow' : 'opening'); save(); if (req.typed) logQuery(req.text, 1); return true; }
      // not listed for it: say so, then answer the occasion itself (the bottle excluded)
      addParts(occQ.parts || []); addParts([{ exclude: ['id:' + it.id], label: T.tokenPrefix.not + it.nm, text: 'not ' + String(it.nm).toLowerCase() }]);
      req.text = null; req.mode = 'answer'; req.preNote = fill(T.suitNo, { name: it.nm, occ: wanted.join(', '), listed: listed.join(', ') || '—', profile });
      return false;
    }
    return false;
  }
  function runAnswer(req) {
    const th = S.thread;
    return prepare().then(async model => {
      if (!model) { renderUnavailable(); return; }
      if (trySpecial(req, model)) return;
      const notes = [];
      if (req.preNote) notes.push(req.preNote);
      if (req.vsNote) notes.push(req.vsNote);
      let parsed = null, aiOffer = null;
      if (req.text != null) {
        parsed = parse(req.text, S.lex, model, { lastBrands: lastBrands(model), refPrice: null });
        // Phase 2: only typed sentences the parser is lost on go to an on-device layer.
        if (req.typed && (needsNLU(req.text, parsed) || (serverEnabled() && needsServer(req.text, parsed)))) {
          S.ai.lastText = req.text;
          const wait = serverEnabled() && needsServer(req.text, parsed) ? appendMsg(msgEl('bot', '<p class="finder-sub">' + esc(T.serverWait) + '</p>')) : null;
          const u = await understand(req.text, parsed, model);
          if (wait && wait.parentNode) wait.parentNode.removeChild(wait);
          if (u.server && u.server.intent !== 'search' && dispatchServer(req, model, u.server, parsed)) return;
          if (u.server && u.server.intent === 'search') dispatchServer(req, model, u.server, parsed);
          if (u.part) {
            parsed.parts.push(u.part);
            parsed.unknown = parsed.unknown.filter(w => u.part.text.toLowerCase().indexOf(w) < 0);
          } else if (u.server && u.server.intent === 'search' && parsed.parts.length) parsed.unknown = [];
          else if (u.tried) notes.push(T.aiNothing);
          aiOffer = u.offer;
        }
        // A bottle you merely asked about never steers a NEW search: the soft anchor goes once you type scent words or another name.
        if (parsed.parts.some(p => p.anchor || Object.keys(p.features || {}).length)) { const k = th.parts.findIndex(p => p.anchor && p.soft); if (k >= 0) removePart(k); }
        // A new, complete request ("ami daily bus e jai, onk sweat kori") replaces the earlier scent wishes instead of piling
        // onto them; a short refinement ("sweeter", "for winter", "under 500") still adds. Budget, gender and exclusions stay.
        if (req.typed && th.lastIds.length && isNewRequest(req.text, parsed)) {
          th.parts = th.parts.filter(p => !(p.anchor || Object.keys(p.features || {}).length || p.strength));
          th.query = compose(th.parts); renderBar();
        }
        if (parsed.parts.length) addParts(parsed.parts);
        if (!parsed.parts.length) {
          const words = parsed.unknown.join(', ');
          const bangla = parsed.unknown.some(w => /[ঀ-৿]/.test(w)) || /[ঀ-৿]/.test(String(req.text || ''));   // Bangla script we could not read: say so instead of echoing the words
          if (req.typed) logQuery(req.text, 0);
          if (parsed.unknownAnchor && !th.parts.length) { botText(T.unknownAnchorOnly); offerAi(aiOffer); save(); return; }
          // Nothing usable yet: echo the unknown words, or (only stop-words: "thanks", "different brands" before any answer) say so.
          if (!parsed.unknownAnchor && !th.parts.length) { botText(bangla ? T.banglaHelp : words ? fill(T.notUnderstood, { words }) : T.nothingNew); offerAi(aiOffer); save(); return; }
          // After an answer, a message with no new constraint and no unknown words changes nothing: no re-answer.
          if (!parsed.unknownAnchor && !words && th.lastIds.length) { botText(T.nothingNew); setChips('follow'); save(); return; }
          // Chips so far + a throw-away text → answer from the chips (with the honest note when words were unknown).
          if (parsed.unknownAnchor) notes.push(T.unknownAnchor); else if (words) notes.push(bangla ? T.banglaNote : fill(T.notUnderstoodAnswer, { words }));
        } else if (parsed.unknownAnchor) notes.push(T.unknownAnchor);
      }
      let q = th.query = compose(th.parts);
      // Nothing about the SCENT yet (only a budget, a person, a brand exclusion…): ask the one
      // question that matters instead of answering with the same default trio every time.
      if (!th.lastIds.length && !q.anchor && !q.strength && !Object.keys(q.features).length && (req.mode === 'answer' || req.mode === 'text') && !req.retry && th.parts.length) {
        const what = th.parts.map(p => p.label || p.text).filter(Boolean).join(', ');
        botText(fill(T.askVibeFor, { what })); th.wizard = { picks: [], from: 'vibe' }; setChips('vibe'); save();
        if (req.typed) logQuery(req.text, 0);
        return;
      }
      // Relational "cheaper": pin the reference price into the part so the token and the share URL carry it.
      if (q.cheaper && q.refPrice == null) {
        const R = referenceFor(model, q, true);
        const cp = th.parts.find(p => p.cheaper);
        if (R != null) { cp.refPrice = R; cp.label = T.tokenPrefix.cheaper + R; cp.text = 'under ' + R; }
        else { delete cp.cheaper; cp.maxPrice = CHEAP_DEFAULT; Object.assign(cp, priceText(null, CHEAP_DEFAULT)); }
        q = th.query = compose(th.parts); renderBar();
      }
      const refPrice = q.cheaper ? q.refPrice : referenceFor(model, q, false);
      // Relational axis follow-up ("Fresher"): the previous #1 sets the bar.
      const lastTop = th.lastIds.length ? model.byId.get(th.lastIds[0]) : null;
      const axisMin = req.mode === 'axis' && lastTop ? { axis: req.axis, min: Math.max(axisScore(lastTop, req.axis, model) + AXIS_STEP, AXIS_FLOOR) } : null;
      const res = answer(model, q, { exclude: th.renderedIds, referencePrice: refPrice, signals: readSignals(), limit: ANSWER_SIZE, axisMin });
      if (res.relaxed.indexOf('axis') >= 0 && lastTop) notes.push(fill(T.noAxis[req.axis], { name: lastTop.nm }));
      if (res.relaxed.indexOf('cheaper') >= 0) {
        const k = th.parts.findIndex(p => p.cheaper); if (k >= 0) removePart(k);
        th.query = compose(th.parts);
        if (req.mode === 'cheaper' && th.lastIds.length) { botText(T.noCheaper); setChips('follow'); th.pending = []; save(); shareUrl(); return; }
        notes.push(T.noCheaper);
      }
      const other = res.relaxed.filter(s => s !== 'cheaper' && s !== 'axis');
      if (other.length) notes.push(fill(T.relaxed, { what: joinAnd(other.map(s => T['relax' + cap(s)])) }));
      if (!res.picks.length) { botText(T.noMore); setChips('follow'); th.pending = []; save(); return; }
      // Reply text: echo what this answer is based on ("Three picks for fresh, office, under ৳500:").
      if (req.typed && req.text && langOf(req.text)) th.lang = langOf(req.text);
      const answersSoFar = th.turns.filter(t => t.ids && t.ids.length).length;
      const chat = !q.anchor ? chatLine(q, th.parts, th.lang, answersSoFar) : null;
      let text = chat ? chat.text : T.answer;
      const a = q.anchor;
      // Exclusive bottles shown only because their brand was asked for: say so once.
      const exBrand = res.picks.find(r => r.item.c === 'e' && q.collection !== 'exclusive');
      if (exBrand && notes.indexOf(fill(T.exclusiveBrandNote, { brand: model.vocab.b[exBrand.item.b] })) < 0) notes.push(fill(T.exclusiveBrandNote, { brand: model.vocab.b[exBrand.item.b] }));
      if (req.mode === 'cheaper' && q.cheaper) text = fill(T.cheaper, { price: q.refPrice });
      else if (req.mode === 'axis' && lastTop && res.relaxed.indexOf('axis') < 0) text = fill((th.lang === 'bs' ? T.axisTitleBs : th.lang === 'bn' ? T.axisTitleBn : T.axisTitle)[req.axis], { name: lastTop.nm });
      else if (req.mode === 'more' && !a) text = T.more;
      else if (a && a.kind === 'catalog') { const ai = model.byId.get(a.id); text = fill(ai && ai.i && th.renderedIds.indexOf(a.id) < 0 ? T.anchorStocked : T.anchorCatalog, { name: a.name }); }
      else if (a && a.kind === 'ref') text = fill(T.anchorRef, { name: a.name });
      // Notes for constraints added since the last answer (never repeated).
      th.pending.forEach(p => {
        if (p.note === 'unisex' && notes.indexOf(T.unisexNote) < 0) notes.push(T.unisexNote);
        const noteIn = key => (th.lang === 'bs' && T[key + 'Bs']) || (th.lang === 'bn' && T[key + 'Bn']) || T[key];
        if (p.note === 'skin' && notes.indexOf(noteIn('skinNote')) < 0) notes.push(noteIn('skinNote'));
        if (p.note === 'sweat' && notes.indexOf(noteIn('sweatNote')) < 0) notes.push(noteIn('sweatNote'));
        if (p.note === 'women' && notes.indexOf(noteIn('womenNote')) < 0) notes.push(noteIn('womenNote'));
        if (p.note === 'commute' && !th.pending.some(x => x.note === 'sweat') && notes.indexOf(noteIn('commuteNote')) < 0) notes.push(noteIn('commuteNote'));
        if (p.note === 'modest' && notes.indexOf(T.modestNote) < 0) notes.push(T.modestNote);
        if (p.strength === 'stronger' && !(chat && chat.folded && text === chat.text) && notes.indexOf(T.strongerNote) < 0) notes.push(T.strongerNote);
        if (p.strength === 'softer' && !(chat && chat.folded && text === chat.text) && notes.indexOf(T.softerNote) < 0) notes.push(T.softerNote);
        if (p.collection === 'exclusive' && notes.indexOf(T.exclusiveNote) < 0) notes.push(T.exclusiveNote);
      });
      th.pending = [];
      const ids = res.picks.map(r => r.id);
      res.picks.forEach(r => { th.cards[r.id] = { c: toCard(r.item, model), e: r.item.c === 'e' }; });
      const floor = minFrom(model);
      const turn = { role: 'bot', text, notes, ids, reasons: res.picks.map(r => reasons(r, q, model, a)), cautions: res.picks.map(r => cautionFor(r.item, q, model, th.lang)), cheap: res.picks.map(r => r.item.p > floor), lang: th.lang || null, mode: req.mode || 'answer' };
      if (req.compareAfter && ids.length >= 2) turn.table = compareRows(ids, model);   // "compare your top 3 fresh ones"
      // Phase 3: co-purchase row for #1 (display only; never a card, never in the score)
      const also = alsoConsidered(res.picks[0], model, th.renderedIds.concat(ids), 3);
      if (also.length) turn.also = { name: res.picks[0].item.nm, items: also };
      th.turns.push(turn);
      ids.forEach(id => { if (th.renderedIds.indexOf(id) < 0) th.renderedIds.push(id); });
      th.lastIds = ids;
      renderTurn(turn, true);
      setChips('follow', aiOffer); renderFoot(); shareUrl(); save();
      if (req.typed) logQuery(req.text, ids.length);
    });
  }
  // The on-device layers are offered, never imposed: a chip the visitor can ignore.
  function offerAi(kind) { if (kind) setChips(S.thread.chips === 'opening' ? 'opening' : 'follow', kind); }
  function aiChips(kind) {
    if (kind === 'consent') return [{ label: T.aiConsentChip, kind: 'ai-consent' }, { label: T.noThanks, kind: 'ai-no' }];
    if (kind === 'load') return [{ label: fill(T.aiOfferChip, { mb: nluMb() }), kind: 'ai-load' }, { label: T.noThanks, kind: 'ai-no' }];
    return [];
  }
  function onAiChip(c) {
    const th = S.thread;
    if (c.kind === 'ai-no') { setChips(th.lastIds.length ? 'follow' : th.chips === 'opening' ? 'opening' : th.chips); save(); return; }
    const text = S.ai.lastText; if (!text) { setChips('follow'); return; }
    if (c.kind === 'ai-consent') {
      try { localStorage.setItem(NLU_CONSENT_KEY, 'yes'); } catch (e) {}
      addUserTurn(c.label);
      runAnswer({ mode: 'text', text, typed: true, retry: true });
      return;
    }
    // ai-load: inject js/finder-nlu.js, load the model with progress, then re-run the sentence.
    addUserTurn(c.label);
    const node = appendMsg(msgEl('bot', '<p>' + esc(fill(T.aiLoading, { pct: 0 })) + '</p>'));
    setChips('none');
    const onProgress = (fraction) => { try { node.firstChild.textContent = fill(T.aiLoading, { pct: Math.round(clamp(fraction || 0, 0, 1) * 100) }); } catch (e) {} };
    loadNluScript().then(m => (typeof m.load === 'function' ? m.load({ onProgress }) : null)).then(() => {
      node.remove();
      runAnswer({ mode: 'text', text, typed: true, retry: true });
    }).catch(() => { node.remove(); botText(T.aiLoadFailed); setChips(th.lastIds.length ? 'follow' : 'opening'); save(); });
  }
  function followUp(op, n) {
    const th = S.thread;
    if (op === 'reset') { reset(); return; }
    addUserTurn(op === 'like' ? fill(T.follow.like, { n: n + 1 }) : op === 'likecheap' ? fill(T.follow.likeCheap, { n: n + 1 }) : (T.follow[op] || (op === 'compare' ? T.compareLink : op === 'brands' ? T.brandsLink : op)));
    if (op === 'more') runAnswer({ mode: 'more' });
    else if (op === 'cheaper') runAnswer({ mode: 'cheaper', text: 'cheaper' });
    else if (op === 'stronger') runAnswer({ mode: 'axis', axis: 'strong', text: 'stronger' });
    else if (op === 'fresher') runAnswer({ mode: 'axis', axis: 'fresh', text: 'fresh' });
    else if (op === 'sweeter') runAnswer({ mode: 'axis', axis: 'sweet', text: 'sweet' });
    else if (op === 'brands') runAnswer({ mode: 'answer', text: 'different brands' });
    else if (op === 'likecheap') {   // "Cheaper like this": that bottle's profile, priced below it
      prepare().then(model => {
        const id = th.lastIds[n], it = model && model.byId.get(id);
        if (!it) { runAnswer({ mode: 'answer' }); return; }
        addParts([anchorPart({ kind: 'catalog', id, name: it.nm }), { cheaper: true, refPrice: it.p, label: T.tokenPrefix.cheaper + it.p, text: 'under ' + it.p }]);
        runAnswer({ mode: 'cheaper' });
      });
    } else if (op === 'like') {
      prepare().then(model => {
        const id = th.lastIds[n], it = model && model.byId.get(id);
        if (!it) { runAnswer({ mode: 'answer' }); return; }
        addParts([anchorPart({ kind: 'catalog', id, name: it.nm })]);
        runAnswer({ mode: 'answer' });
      });
    } else if (op === 'compare') {
      prepare().then(model => {
        if (!model) { renderUnavailable(); return; }
        if (th.lastIds.length < 2) { botText(T.compareNeed); save(); return; }
        const turn = { role: 'bot', text: T.compare, table: compareRows(th.lastIds.slice(0, 2), model), mode: 'compare' };
        th.turns.push(turn); renderTurn(turn, true); setChips('follow'); save();
      });
    }
  }
  function reset() {
    clearStored();
    S.thread = freshThread();
    S.el.thread.textContent = ''; renderBar();
    try { history.replaceState({ nawmeFinder: 1 }, '', location.pathname); } catch (e) {}
    renderOpening();
    clearStored();   // the fresh opening is what a reload shows anyway; keep sessionStorage empty after "Start over"
  }
  // How the page was opened: 'reload' (refresh), 'back_forward' (Back from a product page), or 'navigate'.
  const navType = () => { try { const e = performance.getEntriesByType('navigation')[0]; return (e && e.type) || ''; } catch (e) { return ''; } };
  function restore() {
    // A refresh starts the conversation from the beginning (and drops the ?q= our own thread wrote into the URL);
    // Back from a product page still brings the thread back, so a shopper doesn't lose their picks.
    if (navType() === 'reload') {
      clearStored();
      try { history.replaceState(null, '', location.pathname); } catch (e) {}
      S.thread = freshThread(); renderOpening(); clearStored();
      return;
    }
    let params = null;
    try { params = new URLSearchParams(location.search); } catch (e) {}
    const q = params && params.get('q'), like = params && params.get('like');
    const st = loadStored();
    // A shared link (?q= / ?like=) wins over a stored thread; our own replaceState
    // URL (history.state marker, kept across reload / back) restores the thread.
    let own = false; try { own = !!(history.state && history.state.nawmeFinder); } catch (e) {}
    if ((q || like) && !(own && st)) {
      clearStored(); S.thread = freshThread();
      const text = (like ? 'like ' + like + (q ? ', ' + q : '') : q).slice(0, 200);
      // Shared link: the answer arrives after a fetch, so nothing inside #finder
      // is painted until it is ready (chips/form hidden, height reserved) and the
      // whole thread lands in one paint — no painted element gets pushed (CLS 0).
      // The reserved height goes on the first click/keypress (input-excluded).
      const root = S.el.root; root.classList.add('finder-pending', 'finder-reserve');
      const reveal = () => root.classList.remove('finder-pending');
      const unreserve = () => root.classList.remove('finder-reserve');
      ['click', 'keydown'].forEach(ev => document.addEventListener(ev, unreserve, { once: true, capture: true }));
      prepare().then(() => { botText(T.opening); addUserTurn(text); return runAnswer({ mode: 'text', text }); }).then(reveal, reveal);
      return;
    }
    if (st) { S.thread = st; renderAll(); return; }
    S.thread = freshThread();
    renderOpening();
  }
  function wire() {
    S.el = { root: el('finder'), bar: el('finder-bar'), thread: el('finder-thread'), chips: el('finder-chips'), form: el('finder-form'), input: el('finder-input'), status: null };
    if (!S.el.root || !S.el.thread) return;
    // sr-only status line for quick-reply changes (absolutely positioned: no layout impact)
    if (S.el.chips) { const st = document.createElement('p'); st.className = 'sr-only'; st.setAttribute('role', 'status'); S.el.chips.parentNode.insertBefore(st, S.el.chips.nextSibling); S.el.status = st; }
    S.lex = (typeof window !== 'undefined' && window.FinderLexicon) || {};
    REFS = S.lex.refs || [];
    if (S.el.chips) S.el.chips.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('button[data-chip]') : null; if (!b) return;
      const c = S.chips[Number(b.dataset.chip)]; if (c) onChip(c);
    });
    // Answer-block controls: "More like this" per card, compare / other brands links.
    S.el.thread.addEventListener('click', e => {
      const t = e.target && e.target.closest ? e.target.closest('button.finder-like, button.finder-cheap, button.finder-link') : null; if (!t) return;
      if (t.classList.contains('finder-cheap')) followUp('likecheap', Number(t.dataset.n)); else if (t.classList.contains('finder-like')) followUp('like', Number(t.dataset.n)); else followUp(t.dataset.op);
    });
    if (S.el.bar) S.el.bar.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('button[data-part]') : null; if (!b) return;
      const k = Number(b.dataset.part); if (!(k >= 0 && k < S.thread.parts.length)) return;
      const label = S.thread.parts[k].label || S.thread.parts[k].text;
      removePart(k);
      if (S.thread.lastIds.length) { addUserTurn('Remove: ' + label); runAnswer({ mode: 'answer' }); } else save();
    });
    if (S.el.form) S.el.form.addEventListener('submit', e => {
      e.preventDefault();
      const v = S.el.input ? S.el.input.value : ''; if (S.el.input) S.el.input.value = '';
      onSubmit(v);
    });
    restore();
  }
  function _init(scriptEl) {
    try {
      S.url = (scriptEl && scriptEl.dataset && scriptEl.dataset.finder) || '';
      // The card renderer's Add to Cart calls a global handleAdd (js/shop.js L7-14); this page does not load shop.js.
      if (typeof handleAdd === 'undefined') {
        window.handleAdd = function handleAdd(id, isExclusive) {
          const card = document.querySelector('.product-card[data-id="' + id + '"]');
          const pill = document.querySelector('#size-' + id + ' .size-pill.active');
          if (!card || !pill) return;
          const name = card.querySelector('.card-name').textContent.trim();
          const sizes = [...document.querySelectorAll('#size-' + id + ' .size-pill')].map(b => ({ ml: Number(b.dataset.ml), price: Number(b.dataset.price) }));
          addToCart(id, pill.dataset.ml, pill.dataset.price, name, card.dataset.brand, isExclusive, sizes);
        };
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, { once: true }); else wire();
    } catch (e) { /* the finder is optional; the page keeps its static intro + shop link */ }
  }

  return { T, WEIGHTS, EVENT_W, MIN_COS, BRAND_CAP, ANSWER_SIZE, CHEAP_DEFAULT, NLU_SCHEMA, normalize, lev, parse, hasTrigger, mergeQuery, emptyQuery, compose, fromChip, chipPart, surprisePart, prepareData, vectorize, queryVector, buildQueryVec, buildProfile, cosine, readSignals, rank, answer, reasons, toCard, validateFragment, mergeNLU, alsoConsidered, queryLogBody, needsNLU, aiSystemPrompt, AXES, axisScore, queryAxes, profileSim, refItem, typoFix: (t, L, model) => typoFix(getIndex(L || {}, model), normalize(t)), setRefs: r => { REFS = r || []; }, intentOf, faqOf, glossOf, parseCompare, compareVerdict, resolveSides, ordinalIn, validateServer, needsServer, chatLine, isBanglish, isBanglaScript, cautionFor, axisFollowUp, isNewRequest, SERVER_NLU, SERVER_NLU_PATH, matchFrame, cleanName, resolveFact, factLines, faqLines, FAQ_RATES, FAQ_POINTS, _state: S, _init };
});
