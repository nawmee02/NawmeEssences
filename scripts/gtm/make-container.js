// Builds scripts/gtm/gtm-kkcjcdtz-import.json — a GTM container export to import
// into GTM-KKCJCDTZ (Admin → Import Container → Merge, rename conflicts) — from
// the event contract in js/cart.js (NawmeTrack). Run: node scripts/gtm/make-container.js
// Not part of the site (the deploy prunes scripts/). See scripts/gtm/README.md.
//
// Performance + consent design (plan step 1a / 1b):
//   Stage 1 — Initialization: Google tag (GA4 + Google Ads), Conversion Linker,
//             and a tiny Meta `fbq` queue (no script download).
//   Stage 2 — `nawme_idle` (pushed by js/cart.js after gtm.js, in an idle
//             period): inject Meta's fbevents.js, which then replays the queue.
//   Meta + Google Ads tags require ad_storage (and ad_user_data); they also fire
//   on `consent_update`, so accepting the banner starts them mid-visit.
//   No auto-event listeners (clicks, scroll depth, visibility, timers).
const fs = require('fs');
const path = require('path');

let nextId = 10;
const id = () => String(nextId++);
const T = (key, value) => ({ type: 'TEMPLATE', key, value: String(value) });
const B = (key, value) => ({ type: 'BOOLEAN', key, value: String(!!value) });
const base = { accountId: '0', containerId: '0' };
const ALL_PAGES = '2147479553';          // built-in "All Pages" (page view)
const INIT_ALL = '2147479573';           // built-in "Initialization - All Pages"
const consent = list => (list && list.length
  ? { consentStatus: 'NEEDED', consentType: { type: 'LIST', list: list.map(v => ({ type: 'TEMPLATE', value: v })) } }
  : { consentStatus: 'NOT_SET' });

// ── variables ───────────────────────────────────────────────
const variable = [];
const constant = (name, value, notes) => { variable.push({ ...base, variableId: id(), name, type: 'c', notes, parameter: [T('value', value)] }); return `{{${name}}}`; };
const dlv = (name, key) => { variable.push({ ...base, variableId: id(), name, type: 'v', parameter: [{ type: 'INTEGER', key: 'dataLayerVersion', value: '2' }, B('setDefaultValue', false), T('name', key)] }); return `{{${name}}}`; };
const jsVar = (name, fn) => { variable.push({ ...base, variableId: id(), name, type: 'jsm', parameter: [T('javascript', fn)] }); return `{{${name}}}`; };

const GA4 = constant('GA4 Measurement ID', 'G-ZH3N2EESDZ', 'Existing GA4 property.');
const PIXEL = constant('Meta Pixel ID', 'REPLACE_WITH_META_PIXEL_ID', 'Events Manager → Data sources → your Pixel → ID (digits only).');
const AW_ID = constant('Google Ads Conversion ID', 'REPLACE_WITH_ADS_CONVERSION_ID', 'Google Ads → Goals → Conversions → the Purchase action → Tag setup → "Conversion ID" (digits only, without AW-).');
const AW_LABEL = constant('Google Ads Purchase Label', 'REPLACE_WITH_ADS_PURCHASE_LABEL', 'Same screen → "Conversion label".');
const V_VALUE = dlv('DLV - ecommerce.value', 'ecommerce.value');
const V_TX = dlv('DLV - ecommerce.transaction_id', 'ecommerce.transaction_id');
const V_EVENT_ID = dlv('DLV - event_id', 'event_id');
const V_TERM = dlv('DLV - search_term', 'search_term');
dlv('DLV - ecommerce.items', 'ecommerce.items');
const QUIZ_PARAMS = ['status', 'count', 'step', 'value', 'position', 'label'].map(k => [k, dlv('DLV - quiz ' + k, k)]);
const ERR_KIND = dlv('DLV - error_kind', 'error_kind');
const CHANNEL = dlv('DLV - order_channel', 'order_channel');
const META_IDS = jsVar('JS - Meta content_ids', 'function(){var i={{DLV - ecommerce.items}}||[];return i.map(function(x){return x.item_id;});}');
const META_CONTENTS = jsVar('JS - Meta contents', 'function(){var i={{DLV - ecommerce.items}}||[];return i.map(function(x){return {id:x.item_id,quantity:x.quantity||1,item_price:x.price};});}');
const META_NUM = jsVar('JS - Meta num_items', 'function(){var i={{DLV - ecommerce.items}}||[];var n=0;for(var k=0;k<i.length;k++)n+=(i[k].quantity||1);return n;}');

// ── triggers ────────────────────────────────────────────────
const trigger = [];
const ce = (name, event, regex) => {
  const triggerId = id();
  trigger.push({ ...base, triggerId, name, type: 'CUSTOM_EVENT',
    customEventFilter: [{ type: regex ? 'MATCH_REGEX' : 'EQUALS', parameter: [T('arg0', '{{_event}}'), T('arg1', event)] }] });
  return triggerId;
};
const TR = {
  ecommerce: ce('CE - ecommerce (GA4)', '^(view_item|add_to_cart|begin_checkout|purchase)$', true),
  view: ce('CE - view_item', 'view_item'),
  add: ce('CE - add_to_cart', 'add_to_cart'),
  checkout: ce('CE - begin_checkout', 'begin_checkout'),
  purchase: ce('CE - purchase', 'purchase'),
  search: ce('CE - search', 'search'),
  quiz: ce('CE - scent_match_*', '^scent_match_', true),
  failed: ce('CE - order_save_failed', 'order_save_failed'),
  idle: ce('CE - nawme_idle (stage 2)', 'nawme_idle'),
  consent: ce('CE - consent_update', 'consent_update'),
};

// ── tags ────────────────────────────────────────────────────
const tag = [];
const add = t => { tag.push({ ...base, tagId: id(), tagFiringOption: 'ONCE_PER_EVENT', ...t }); };
const params = rows => ({ type: 'LIST', key: 'eventSettingsTable', list: rows.map(([k, v]) => ({ type: 'MAP', map: [T('parameter', k), T('parameterValue', v)] })) });
const html = (name, code, triggers, notes, once) => add({
  name, type: 'html', notes, firingTriggerId: triggers, tagFiringOption: once ? 'ONCE_PER_LOAD' : 'ONCE_PER_EVENT',
  parameter: [T('html', code), B('supportDocumentWrite', false)], consentSettings: consent(['ad_storage', 'ad_user_data']),
});

// Stage 1 — Google tag (GA4). Consent Mode v2 handles denied visitors (cookieless pings only).
add({ name: 'Google tag - GA4', type: 'googtag', firingTriggerId: [INIT_ALL], tagFiringOption: 'ONCE_PER_LOAD',
  notes: 'GA4 page views. In GA4 → Admin → Data streams → Enhanced measurement: turn OFF "Page changes based on browser history events" (the quiz uses pushState), scrolls, form interactions and site search (the site sends its own search event).',
  parameter: [T('tagId', GA4)], consentSettings: consent() });
// Google Ads tag (remarketing + conversion linking) — only with ad consent.
add({ name: 'Google tag - Google Ads', type: 'googtag', firingTriggerId: [INIT_ALL, TR.consent], tagFiringOption: 'ONCE_PER_LOAD',
  notes: 'Remarketing / audiences. Fires only with ad_storage + ad_user_data consent (Bangladesh by default; elsewhere after Accept).',
  parameter: [T('tagId', 'AW-' + AW_ID)], consentSettings: consent(['ad_storage', 'ad_user_data']) });
add({ name: 'Conversion Linker', type: 'gclidw', firingTriggerId: [ALL_PAGES], tagFiringOption: 'ONCE_PER_LOAD',
  parameter: [B('enableCrossDomain', false), B('enableUrlPassthrough', false), B('enableCookieOverrides', false)], consentSettings: consent(['ad_storage']) });

// GA4 events
add({ name: 'GA4 - ecommerce', type: 'gaawe', firingTriggerId: [TR.ecommerce],
  parameter: [T('eventName', '{{Event}}'), T('measurementIdOverride', GA4), B('sendEcommerceData', true), T('getEcommerceDataFrom', 'dataLayer'),
    params([['event_id', V_EVENT_ID], ['order_channel', CHANNEL]])], consentSettings: consent() });
add({ name: 'GA4 - search', type: 'gaawe', firingTriggerId: [TR.search],
  parameter: [T('eventName', 'search'), T('measurementIdOverride', GA4), params([['search_term', V_TERM]])], consentSettings: consent() });
add({ name: 'GA4 - Quick Scent Match', type: 'gaawe', firingTriggerId: [TR.quiz],
  parameter: [T('eventName', '{{Event}}'), T('measurementIdOverride', GA4), params(QUIZ_PARAMS)], consentSettings: consent() });
add({ name: 'GA4 - order_save_failed', type: 'gaawe', firingTriggerId: [TR.failed],
  notes: 'Diagnostics only: a checkout whose order did not save in Supabase. Never a conversion.',
  parameter: [T('eventName', 'order_save_failed'), T('measurementIdOverride', GA4), params([['error_kind', ERR_KIND], ['order_channel', CHANNEL]])], consentSettings: consent() });

// Google Ads purchase conversion — only after the order is saved (the site pushes `purchase` then).
add({ name: 'Google Ads - Purchase', type: 'awct', firingTriggerId: [TR.purchase],
  notes: 'Fires on `purchase`, which the site pushes only after Supabase confirms the order. Order ID de-duplicates.',
  parameter: [T('conversionId', AW_ID), T('conversionLabel', AW_LABEL), T('conversionValue', V_VALUE), T('currencyCode', 'BDT'),
    T('orderId', V_TX), B('enableConversionLinker', true), B('enableProductReporting', false), B('enableNewCustomerReporting', false), T('rdp', 'false')],
  consentSettings: consent(['ad_storage', 'ad_user_data']) });

// Meta Pixel — Stage 1: queue only (exactly Meta's base-code stub, without the
// script). init + PageView are queued first so fbevents.js replays them in order.
const FBQ_STUB = '<script>(function(f){if(f.fbq)return;var n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};'
  + 'if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];'
  + 'fbq("set","autoConfig",false,"' + PIXEL + '");fbq("init","' + PIXEL + '");fbq("track","PageView");})(window);</script>';
html('Meta - queue + init (stage 1)', FBQ_STUB, [INIT_ALL, TR.consent],
  'Defines fbq as a queue and queues init + PageView (no download). autoConfig=false: no automatic button/metadata events. In Events Manager also turn OFF "Automatic advanced matching" so form fields (phone) are never read.', true);
// Stage 2: download fbevents.js in an idle period; it replays the queue.
html('Meta - load fbevents.js (stage 2)',
  '<script>(function(b){if(window.__nawmeFbLoaded||!window.fbq)return;window.__nawmeFbLoaded=1;var t=b.createElement("script");t.async=!0;t.src="https://connect.facebook.net/en_US/fbevents.js";b.head.appendChild(t);})(document);</script>',
  [TR.idle, TR.consent], 'Stage 2 of the performance plan: Meta\'s script parses in its own idle period, not alongside GTM/gtag.', true);
const metaEvent = (name, trig, ev, extra, eventId) => html(name,
  '<script>window.fbq&&fbq("track","' + ev + '",{' + extra + 'currency:"BDT"},{eventID:' + JSON.stringify(eventId) + '});</script>', [trig]);
metaEvent('Meta - ViewContent', TR.view, 'ViewContent', 'content_ids:' + META_IDS + ',content_type:"product",value:' + V_VALUE + ',', V_EVENT_ID);
metaEvent('Meta - AddToCart', TR.add, 'AddToCart', 'content_ids:' + META_IDS + ',contents:' + META_CONTENTS + ',content_type:"product",value:' + V_VALUE + ',', V_EVENT_ID);
metaEvent('Meta - InitiateCheckout', TR.checkout, 'InitiateCheckout', 'content_ids:' + META_IDS + ',contents:' + META_CONTENTS + ',num_items:' + META_NUM + ',content_type:"product",value:' + V_VALUE + ',', V_EVENT_ID);
// Purchase eventID = the order id, so a future Conversions API event (sent from the order row) de-duplicates with it.
metaEvent('Meta - Purchase', TR.purchase, 'Purchase', 'content_ids:' + META_IDS + ',contents:' + META_CONTENTS + ',num_items:' + META_NUM + ',content_type:"product",value:' + V_VALUE + ',', V_TX);
html('Meta - Search', '<script>window.fbq&&fbq("track","Search",{search_string:' + V_TERM + '},{eventID:' + V_EVENT_ID + '});</script>', [TR.search]);

// The Meta event tags carry {{variables}} that GTM substitutes as JS literals; the
// eventID literal must be a variable reference, not a quoted string.
for (const t of tag) for (const p of t.parameter || []) if (p.key === 'html') p.value = p.value.replace(/"(\{\{[^}]+\}\})"/g, '$1');

const out = {
  exportFormatVersion: 2,
  exportTime: '2026-11-01 00:00:00',
  containerVersion: {
    ...base, path: 'accounts/0/containers/0/versions/0', containerVersionId: '0',
    container: { ...base, path: 'accounts/0/containers/0', name: 'NawmeEssences', publicId: 'GTM-KKCJCDTZ', usageContext: ['WEB'] },
    tag, trigger, variable,
    builtInVariable: [{ ...base, type: 'EVENT', name: 'Event' }, { ...base, type: 'PAGE_URL', name: 'Page URL' }],
  },
};
const file = path.join(__dirname, 'gtm-kkcjcdtz-import.json');
fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${path.relative(process.cwd(), file)}: ${tag.length} tags, ${trigger.length} triggers, ${variable.length} variables`);
