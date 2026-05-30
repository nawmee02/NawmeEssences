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

const SUPABASE_URL      = "https://knviffeqzvzqwgztchks.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmlmZmVxenZ6cXdnenRjaGtzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNDc5MjgsImV4cCI6MjA5NTcyMzkyOH0.DfCYNnYRA28VWKlg_oyIcf8m0HX1c_AXsHAKICwWQkc";

// Initialise client (SDK loaded via CDN in HTML files)
let _sb = null;
function getSupabaseClient() {
  if (!_sb) {
    _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _sb;
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
  // Skip silently if credentials not injected yet
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return;
  }

  try {
    const sb = getSupabaseClient();

    // 1. Insert order header
    const { data: order, error: orderErr } = await sb
      .from("orders")
      .insert({
        buyer_name,
        buyer_phone,
        buyer_address,
        delivery_zone,
        delivery_charge,
        subtotal,
        total,
        channel,
        status: "pending"
      })
      .select("id")
      .single();

    if (orderErr) {
      console.error("[Supabase] Order insert failed:", orderErr.message);
      return;
    }

    // 2. Insert order items
    const items = cartItems.map(item => ({
      order_id:      order.id,
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
    }

  } catch (err) {
    // Never block the checkout — log and move on
    console.error("[Supabase] Unexpected error:", err);
  }
}
