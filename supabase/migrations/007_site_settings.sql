-- ============================================================
--  NawmeEssences — Site settings: one editable JSON blob that
--  drives the announcement bar, contact/payment/delivery info,
--  hero copy, stats, and homepage meta. Public-read; admin-write.
--  Run in Supabase Dashboard → SQL Editor (re-runnable).
--  Depends on is_admin() + set_updated_at() from 004_admin.sql.
-- ============================================================

-- ─────────────────────────────────────────
--  1. Singleton table (exactly one row, id = 1)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS site_settings (
  id         int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Auto-bump updated_at on UPDATE (reuse the trigger fn from 004)
DROP TRIGGER IF EXISTS site_settings_set_updated_at ON site_settings;
CREATE TRIGGER site_settings_set_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────
--  2. RLS: everyone reads, only admins write
-- ─────────────────────────────────────────
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read site_settings" ON site_settings;
CREATE POLICY "public read site_settings" ON site_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "admin write site_settings" ON site_settings;
CREATE POLICY "admin write site_settings" ON site_settings
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- ─────────────────────────────────────────
--  3. Seed row 1 with the current live values.
--     ON CONFLICT DO NOTHING so re-running never clobbers edits.
-- ─────────────────────────────────────────
INSERT INTO site_settings (id, data) VALUES (1, '{
  "announcements": [
    "🚚 Delivery ৳70 Dhaka · ৳90 Suburb · ৳120 Outside",
    "✅ 100% Authentic — Decanted from personal collection",
    "📍 Pickup: Aftabnagar · Banasree · NSU",
    "💬 WhatsApp & Messenger support available",
    "💳 Min. advance = delivery charge · 30% advance for orders above ৳2000"
  ],
  "contact": {
    "whatsapp": "8801738221686",
    "instagram": "https://instagram.com/_nawmeessences_",
    "facebook": "https://facebook.com/NawmeEssences"
  },
  "payment": {
    "bkash": "",
    "nagad": "",
    "advanceNote": "Min. advance = delivery charge · 30% advance for orders above ৳2000"
  },
  "delivery": {
    "dhaka": 70,
    "suburb": 90,
    "outside": 120,
    "pickupPoints": ["Aftabnagar", "Banasree", "NSU"]
  },
  "hero": {
    "eyebrow": "Your Signature Scent · Starts Here ·",
    "title": "Authentic Perfume Decants in Bangladesh",
    "subtitle": "Choose from 80+ premium fragrances in sizes from 3ml to 30ml, all decanted from authentic original bottles."
  },
  "stats": [
    { "target": 2000, "suffix": "+", "label": "Orders Delivered" },
    { "target": 80,   "suffix": "+", "label": "Fragrances" },
    { "target": 30,   "suffix": "+", "label": "Brands" },
    { "target": 100,  "suffix": "%", "label": "Authentic" }
  ],
  "meta": {
    "homeTitle": "NawmeEssences — Luxury Fragrance Decants in Bangladesh",
    "homeDescription": "Authentic luxury perfume decants in Bangladesh. Shop Rasasi, JPG, Hugo Boss, Armaf, and more. 3ml, 5ml, 10ml, 15ml sizes. Free delivery info inside."
  }
}'::jsonb)
ON CONFLICT (id) DO NOTHING;
