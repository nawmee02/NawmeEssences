// ============================================================
//  analytics.js — the one inline <head> snippet every public page
//  carries for Google Tag Manager (GTM-KKCJCDTZ: GA4, Google Ads,
//  Meta Pixel). It only sets up dataLayer + Consent Mode v2
//  defaults and re-applies a visitor's stored choice; it loads
//  nothing. js/cart.js does the deferred loading (first scroll /
//  after a tap's frame / idle fallback), the country check, the
//  consent banner and the ecommerce events.
//
//  Consent policy comes from site_settings.consent (admin-editable,
//  baked here at build time; js/cart.js re-checks the live value):
//    grantedRegions — ISO country codes granted by default
//                     (['BD'] at launch); everyone else is denied
//                     until they accept the banner.
//    version        — bump to ask everyone again.
//  Never added to admin/ (not in any page list).
// ============================================================

const GTM_ID = 'GTM-KKCJCDTZ';

let policy = { grantedRegions: ['BD'], version: 1 };

// Called by the build with the merged site settings before pages are written.
function setPolicy(consent) {
  const c = consent || {};
  policy = {
    grantedRegions: Array.isArray(c.grantedRegions)
      ? c.grantedRegions.map(r => String(r).trim().toUpperCase()).filter(r => /^[A-Z]{2}$/.test(r))
      : ['BD'],
    version: Number.isInteger(c.version) && c.version > 0 ? c.version : 1,
  };
}

function getPolicy() { return { grantedRegions: policy.grantedRegions.slice(), version: policy.version }; }

// Marker comments let the build strip + re-insert it idempotently.
const START = '<!--analytics:start-->';
const END = '<!--analytics:end-->';

function headSnippet() {
  const cfg = JSON.stringify({ gtm: GTM_ID, regions: policy.grantedRegions, v: policy.version });
  return START + '<script>(function(w){var c=' + cfg + ',D="denied",G="granted",l=w.dataLayer=w.dataLayer||[];'
    + 'function g(){l.push(arguments)}w.gtag=w.gtag||g;w.__nawmeTags=c;'
    + 'function s(v){return{ad_storage:v,ad_user_data:v,ad_personalization:v,analytics_storage:v}}'
    + 'g("consent","default",s(D));'
    + 'if(c.regions.length){var r=s(G);r.region=c.regions;g("consent","default",r)}'
    // stored choice per category: analytics → analytics_storage, ads → ad_* (old {granted} = both)
    + 'try{var k=JSON.parse(localStorage.getItem("nawme_consent")||"null");'
    + 'if(k&&k.v===c.v){var A=k.analytics!=null?k.analytics:k.granted,B=k.ads!=null?k.ads:k.granted,u=s(B?G:D);'
    + 'u.analytics_storage=A?G:D;g("consent","update",u)}}catch(e){}'
    + '})(window);</script>' + END;
}

module.exports = { GTM_ID, START, END, headSnippet, setPolicy, getPolicy };
