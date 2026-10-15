// Shared by the Edge Function (Deno) and the Node eval/test scripts: the model, the system prompt built
// from data/finder.json, the response schema (Gemini's OpenAPI subset) and the Gemini call itself.
//
// The model only UNDERSTANDS: it turns a shopper's sentence into the finder's structured contract
// (intent + fields). It never writes the answer — js/finder.js renders every reply from the catalogue
// and the policy templates, so nothing the model says reaches the screen as text.

export const MODEL = 'gemini-2.5-flash-lite';
export const MAX_QUERY_CHARS = 200;

// Keep these lists in sync with js/finder-lexicon.js (scripts/test-finder.js checks they match).
export const FAQ_KEYS = ['payment', 'delivery', 'abroad', 'order', 'tracking', 'authentic', 'sizes', 'decant', 'type', 'returns', 'pickup', 'contact', 'offers'];
export const GLOSS_KEYS = ['edp', 'edt', 'edc', 'extrait', 'parfum', 'intense', 'elixir', 'concentration', 'notes', 'accords', 'clone', 'longevity', 'projection', 'niche', 'unisex', 'flanker', 'decant'];
export const CHAT_KINDS = ['greet', 'thanks', 'bye', 'ack', 'bot', 'maker', 'lang', 'help', 'guide', 'random', 'reset', 'why', 'memory', 'more', 'brands', 'bottle', 'new'];
export const FACT_KINDS = ['smell', 'notes', 'about', 'family', 'gender', 'strength', 'price', 'have', 'buy'];
export const INTENTS = ['search', 'fact', 'compare', 'faq', 'glossary', 'chat', 'unclear'];

const FAQ_MEANING = {
  payment: 'how to pay, bKash/Nagad/bank, advance, bargaining', delivery: 'delivery charge, areas, how long, today/urgent', abroad: 'delivery outside Bangladesh',
  order: 'how to order, cart, checkout, cancel, minimum order', tracking: 'where is my order, status, tracking', authentic: 'original or fake, how decants are made, source',
  sizes: 'which sizes exist, ml, sprays, which size to start with', decant: 'what a decant is, what the shop sells', type: 'attar, oil, roll-on, body spray, alcohol-free, halal',
  returns: 'return, refund, exchange, damaged, wrong item', pickup: 'shop location, visit, self-pickup, hours, smell before buying', contact: 'phone, WhatsApp, Messenger, email, talk to a human',
  offers: 'discount, combo, coupon, sale, gift wrapping, bulk',
};
const CHAT_MEANING = {
  greet: 'hello / how are you', thanks: 'thank you', bye: 'goodbye', ack: 'ok / hmm / nice (acknowledgement only)', bot: 'are you a bot / human', maker: 'who made you',
  lang: 'which languages', help: 'what can you do / how does this work', guide: 'help me choose / recommend something / i dont know what i want', random: 'surprise me / anything / random',
  reset: 'start over / clear', why: 'why these picks / how do you rank', memory: 'refers to earlier picks: the first one, the second one, last time', more: 'show more / another one / something else / next',
  brands: 'other / different brands', bottle: 'describes a bottle by its look or colour', new: 'what is new / new arrivals',
};

// Gemini "responseSchema" (OpenAPI 3.0 subset; string enums need format "enum"; no additionalProperties).
const ENUM = values => ({ type: 'STRING', format: 'enum', enum: values });
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: ENUM(INTENTS),
    language: ENUM(['en', 'banglish', 'bn', 'other']),
    features: { type: 'ARRAY', items: { type: 'OBJECT', properties: { key: { type: 'STRING' }, weight: { type: 'NUMBER' } }, required: ['key', 'weight'] } },
    strength: ENUM(['stronger', 'softer', 'none']),
    gender: ENUM(['men', 'unisex', 'women', 'none']),
    maxPrice: { type: 'NUMBER' }, minPrice: { type: 'NUMBER' },
    anchor: { type: 'STRING' },
    exclude: { type: 'ARRAY', items: { type: 'STRING' } },
    fact: { type: 'OBJECT', nullable: true, properties: { kind: ENUM(FACT_KINDS), name: { type: 'STRING' }, ml: { type: 'NUMBER' } }, required: ['kind', 'name'] },
    compare: { type: 'OBJECT', nullable: true, properties: { names: { type: 'ARRAY', items: { type: 'STRING' } }, criterion: { type: 'STRING' } }, required: ['names'] },
    faq: ENUM(FAQ_KEYS.concat(['none'])),
    glossary: { type: 'ARRAY', items: ENUM(GLOSS_KEYS) },
    chat: ENUM(CHAT_KINDS.concat(['none'])),
  },
  required: ['intent', 'language', 'features', 'strength', 'gender', 'maxPrice', 'minPrice', 'anchor', 'exclude', 'faq', 'glossary', 'chat'],
};

// The system prompt: the shop, the contract, the vocabulary from data/finder.json (labels + stocked names).
export function buildSystemPrompt(finder) {
  const V = finder.vocab, names = finder.items.map(it => it.nm);
  const list = arr => arr.join(', ');
  return [
    'You classify a perfume shopper\'s message for NawmeEssences, a Bangladesh shop selling decants (3 ml to 30 ml) of original fragrances, men\'s and unisex only.',
    'Messages may be English, Banglish (Bangla written in Latin letters, e.g. "office er jonno fresh kichu" = something fresh for the office) or Bangla script. Output JSON only, matching the schema. Set "language".',
    'intent:',
    '- "search": they describe what they want (a vibe, an occasion, a budget, a person, a strength, or "like X"). Fill features: keys "<prefix>:<label>" with prefixes a (accord), f (family), n (note), o (occasion), k (concentration), b (brand); weight 1 = wanted, -1 = avoid, 0.5 = mild ("not too sweet" = 0.5, "less sweet" = -0.5). strength: "stronger" for strong/loud/heavy/long-wear wishes, "softer" for subtle/light/office-safe. gender: "men" for him/dad/brother/myself (male), "unisex" for anyone/couple, "women" for her/wife/girlfriend/mother. maxPrice/minPrice in taka (0 = none; "cheap"/"budget" = maxPrice 300; "premium"/"luxury" = minPrice 400). anchor: a fragrance they want something LIKE, as they wrote it ("" if none). exclude: brands or bottles to avoid, as written.',
    '- "fact": a question about ONE specific bottle. fact.kind: smell (what it smells like / describe), notes, about (tell me about / review), family, gender (is it unisex), strength (is it strong / how long does it last), price (price / how much / cheapest size; set fact.ml when a size is asked), have (do you have / in stock), buy (i want to order X). fact.name = the bottle as written.',
    '- "compare": two or more named bottles against each other (X vs Y, which is better, difference between, rank A, B and C, is X stronger than Y). compare.names as written, compare.criterion ("summer", "office", "stronger", "sweeter"…) or "".',
    '- "faq": a question about the shop. faq key meanings: ' + FAQ_KEYS.map(k => k + ' = ' + FAQ_MEANING[k]).join('; ') + '.',
    '- "glossary": asks what a perfume term means (what is EDP, difference between EDT and EDP, what is sillage). glossary = the term keys asked: ' + list(GLOSS_KEYS) + ' (sillage/beast mode → projection; dupe/copy → clone).',
    '- "chat": small talk or meta. chat kinds: ' + CHAT_KINDS.map(k => k + ' = ' + CHAT_MEANING[k]).join('; ') + '.',
    '- "unclear": none of the above (gibberish, off-topic).',
    'A message that names a bottle AND asks for something like it is "search" with anchor. A message that only asks about a bottle is "fact". Do not output "fact" or "compare" for a vibe word (fresh, sweet, oud).',
    'Vocabulary (use these exact labels in features; never invent labels):',
    'accords: ' + list(V.a) + '.', 'families: ' + list(V.f) + '.', 'occasions: ' + list(V.o) + '.', 'concentrations: ' + list(V.k) + '.', 'brands: ' + list(V.b) + '.',
    'notes (only when the shopper names one): ' + list(V.n.slice(0, 120)) + '.',
    'stocked bottles (when the shopper means one of these, write its exact name in fact.name / compare.names / anchor): ' + list(names) + '.',
    'Famous fragrances that are not stocked (Sauvage, Aventus, Bleu de Chanel, Asad, Yara…) may still appear as anchor, fact.name or compare.names, written as the shopper wrote them.',
  ].join('\n');
}

// Call Gemini and return the parsed JSON object (throws on HTTP / timeout / parse errors).
export async function callGemini(apiKey, systemPrompt, text, opts) {
  opts = opts || {};
  const fetchImpl = opts.fetch || globalThis.fetch, timeoutMs = opts.timeoutMs || 3500, model = opts.model || MODEL;
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'POST', signal: ctrl ? ctrl.signal : undefined,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: String(text).slice(0, MAX_QUERY_CHARS) }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error('gemini http ' + res.status + ' ' + body.slice(0, 200)); }
    const data = await res.json();
    const part = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0];
    const raw = part && typeof part.text === 'string' ? part.text : '';
    return JSON.parse(raw.replace(/^```json\s*|```\s*$/g, ''));
  } finally { if (timer) clearTimeout(timer); }
}
