// ─────────────────────────────────────────────────────────────
//  Supabase Configuration — NawmeEssences
//
//  HOW TO FILL IN:
//  1. Go to https://supabase.com/dashboard → your project
//  2. Settings → API
//  3. Copy "Project URL" → paste as SUPABASE_URL
//  4. Copy "anon / public" key → paste as SUPABASE_ANON_KEY
//
//  The anon key is SAFE to commit — it is public by design.
//  Never put the service_role key here.
// ─────────────────────────────────────────────────────────────

// Public Supabase credentials. The anon key is SAFE to commit — it is public by
// design and the tables are protected by Row Level Security (orders/order_items
// are insert-only for the anon role; nothing is readable from the frontend).
// These are the production defaults so the deployed site works without an inject
// step. A gitignored js/supabase-config.js may override them for local dev.
const SUPABASE_URL_DEFAULT = "https://knviffeqzvzqwgztchks.supabase.co";
const SUPABASE_ANON_KEY_DEFAULT = "sb_publishable_olO3EcqKY0ssnfh2qzKB7g_2-zxc2Or";

const SUPABASE_URL = (typeof __SUPABASE_URL__ !== 'undefined') ? __SUPABASE_URL__ :
  (typeof window !== 'undefined' && window.__SUPABASE_URL__) ? window.__SUPABASE_URL__ : SUPABASE_URL_DEFAULT;

// Public image host — set to a CDN that edge-caches Supabase Storage to serve
// product images from a nearby PoP. Defaults to Supabase direct (images unproxied).
// Only for image URLs; the API/auth client above stays on SUPABASE_URL.
const IMAGE_BASE_DEFAULT = "https://cdn.nawmeessences.me";
const IMAGE_BASE = (typeof __IMAGE_CDN__ !== 'undefined') ? __IMAGE_CDN__ :
  (typeof window !== 'undefined' && window.__IMAGE_CDN__) ? window.__IMAGE_CDN__ : IMAGE_BASE_DEFAULT;

const SUPABASE_ANON_KEY = (typeof __SUPABASE_ANON_KEY__ !== 'undefined') ? __SUPABASE_ANON_KEY__ :
  (typeof window !== 'undefined' && window.__SUPABASE_ANON_KEY__) ? window.__SUPABASE_ANON_KEY__ : SUPABASE_ANON_KEY_DEFAULT;

// Optional webhook URL to notify on insert failures. Configure in gitignored config if desired.
const NOTIFY_WEBHOOK_URL = (typeof __NOTIFY_WEBHOOK_URL__ !== 'undefined') ? __NOTIFY_WEBHOOK_URL__ :
  (typeof window !== 'undefined' && window.__NOTIFY_WEBHOOK_URL__) ? window.__NOTIFY_WEBHOOK_URL__ : '';

// Initialise client. SYNCHRONOUS — assumes the SDK global is already present.
// admin/index.html still loads supabase-js with an eager <script>, and every
// admin module calls this directly; that path is deliberately unchanged.
// Public pages have no eager tag and must use getSupabaseClientAsync() below.
let _sb = null;
function getSupabaseClient() {
  if (!_sb) {
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _sb;
}

// ─── Lazy SDK loading (public pages) ─────────────────────────
// Product cards, prices, filters and stock badges are all baked into the HTML
// at build time, so nothing before first paint needs the SDK. Shipping it as an
// eager <script> meant every visitor downloaded ~54KB (gzipped) that only stock
// hydration and checkout ever use, competing with the LCP image. It is now
// fetched on first real use instead.
//
// Pinned to an EXACT version — not @2, not ^2.x — so the bytes behind a long
// CDN cache are reproducible. Keep in step with package.json.
const SUPABASE_SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.108.2';

const _sdkReady = () => typeof window !== 'undefined' && window.supabase && typeof window.supabase.createClient === 'function';
let _sdkPromise = null;

function loadSupabaseSdk() {
  if (_sdkReady()) return Promise.resolve();          // already there (e.g. admin)
  if (_sdkPromise) return _sdkPromise;                // in flight — share it
  _sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SUPABASE_SDK_URL;
    s.async = true;
    // A 200 that didn't define the global is still a failure. Verify rather
    // than resolving into an "undefined is not a function" further downstream.
    s.onload = () => _sdkReady() ? resolve() : reject(new Error('supabase-js loaded but window.supabase is missing'));
    s.onerror = () => reject(new Error('supabase-js failed to load'));
    document.head.appendChild(s);
  }).catch(err => {
    // Drop the memo so a later call retries. Caching the rejection would break
    // checkout permanently after a single flaky moment.
    _sdkPromise = null;
    throw err;
  });
  return _sdkPromise;
}

// Async counterpart to getSupabaseClient() — loads the SDK first if needed.
async function getSupabaseClientAsync() {
  await loadSupabaseSdk();
  return getSupabaseClient();
}

// Generate a valid UUID v4 for the order id.
// crypto.randomUUID() only exists in secure contexts (HTTPS); over plain HTTP
// it is undefined, so we fall back to getRandomValues (available on HTTP too),
// then to Math.random as a last resort. All three return a real UUID so the
// orders.id (type uuid) column always accepts it.
function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
    const h = [...b].map(x => x.toString(16).padStart(2, '0'));
    return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ─────────────────────────────────────────────────────────────
//  saveOrderToSupabase
//
//  Called silently alongside the WhatsApp / Messenger checkout.
//  If Supabase is unreachable or not configured, it fails
//  quietly — the customer's checkout still completes normally.
//
//  @param {object} params
//    buyer_name      {string}
//    buyer_phone     {string}
//    buyer_address   {string}
//    delivery_zone   {string}  "dhaka" | "suburb" | "outside"
//    delivery_charge {number}
//    subtotal        {number}
//    total           {number}
//    channel         {string}  "whatsapp" | "messenger"
//    cartItems       {Array}   from getCart()
// ─────────────────────────────────────────────────────────────
async function saveOrderToSupabase({
  buyer_name,
  buyer_phone,
  buyer_address,
  delivery_zone,
  delivery_charge,
  subtotal,
  total,
  channel,
  cartItems
}) {
  // Skip if credentials not injected yet — but report it so failures aren't invisible
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("[Supabase] Missing config — URL or anon key not loaded.");
    return { ok: false, error: "Supabase config not loaded (URL/anon key missing)." };
  }

  try {
    // Loads the SDK on demand (checkout click). Inside the existing try/catch,
    // so a CDN failure degrades exactly as an unreachable Supabase already did:
    // the order isn't recorded, but the WhatsApp/Messenger checkout completes.
    const sb = await getSupabaseClientAsync();
    const orderId = generateUUID();

    // 1. Insert order header
    const { error: orderErr } = await sb
      .from("orders")
      .insert({
        id: orderId,
        buyer_name,
        buyer_phone,
        buyer_address,
        delivery_zone,
        delivery_charge,
        subtotal,
        total,
        channel,
        status: "pending"
      });

    if (orderErr) {
      console.error("[Supabase] Order insert failed:", orderErr.message);
      // Optionally notify an external webhook (owner/operator) about the failure
      if (NOTIFY_WEBHOOK_URL) {
        try { await fetch(NOTIFY_WEBHOOK_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({type:'order_insert_failed', error: orderErr.message, order: { id: orderId, buyer_name, buyer_phone, buyer_address, total }}) }); } catch(e){}
      }
      return { ok: false, error: "orders insert: " + orderErr.message };
    }

    // 2. Insert order items
    const items = cartItems.map(item => ({
      order_id:      orderId,
      fragrance_id:  item.productId,
      fragrance_name: item.name,
      brand_name:    item.brand,
      ml:            item.ml,
      price:         item.price,
      qty:           item.qty
    }));

    const { error: itemsErr } = await sb.from("order_items").insert(items);

    if (itemsErr) {
      console.error("[Supabase] Order items insert failed:", itemsErr.message);
      if (NOTIFY_WEBHOOK_URL) {
        try { await fetch(NOTIFY_WEBHOOK_URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({type:'order_items_insert_failed', error: itemsErr.message, order_id: orderId, items}) }); } catch(e){}
      }
      return { ok: false, error: "order_items insert: " + itemsErr.message, order_id: orderId };
    }

    return { ok: true, order_id: orderId };

  } catch (err) {
    // Never block the checkout — log and move on
    console.error("[Supabase] Unexpected error:", err);
    return { ok: false, error: "unexpected: " + (err && err.message ? err.message : String(err)) };
  }
}
