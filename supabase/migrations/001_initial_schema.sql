-- ============================================================
--  NawmeEssences — Initial Schema
--  Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- ─────────────────────────────────────────
--  1. BRANDS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       text UNIQUE NOT NULL,       -- e.g. "rasasi"
  name       text        NOT NULL,       -- e.g. "Rasasi"
  created_at timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
--  2. FRAGRANCES
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fragrances (
  id           text PRIMARY KEY,          -- slug e.g. "rasasi-hawas-ice"
  name         text        NOT NULL,
  brand_id     uuid        REFERENCES brands(id) ON DELETE SET NULL,
  collection   text        NOT NULL DEFAULT 'regular'
                           CHECK (collection IN ('regular','exclusive','special')),
  in_stock     boolean     NOT NULL DEFAULT true,
  is_bestseller boolean    NOT NULL DEFAULT false,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
--  3. FRAGRANCE SIZES  (replaces sizes[] array)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fragrance_sizes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fragrance_id  text NOT NULL REFERENCES fragrances(id) ON DELETE CASCADE,
  ml            int  NOT NULL,
  price         int  NOT NULL    -- in BDT (৳)
);

-- ─────────────────────────────────────────
--  4. FRAGRANCE TAGS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fragrance_tags (
  fragrance_id text NOT NULL REFERENCES fragrances(id) ON DELETE CASCADE,
  tag          text NOT NULL
               CHECK (tag IN ('new','limited','restocked','discontinued','exclusive')),
  PRIMARY KEY (fragrance_id, tag)
);

-- ─────────────────────────────────────────
--  5. PROFILES  (extends Supabase auth.users)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name             text,
  phone            text,
  default_address  text,
  default_zone     text DEFAULT 'dhaka'
                   CHECK (default_zone IN ('dhaka','suburb','outside')),
  created_at       timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
--  6. ORDERS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_name       text        NOT NULL,
  buyer_phone      text        NOT NULL,
  buyer_address    text        NOT NULL,
  delivery_zone    text        NOT NULL
                   CHECK (delivery_zone IN ('dhaka','suburb','outside')),
  delivery_charge  int         NOT NULL,
  subtotal         int         NOT NULL,
  total            int         NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','confirmed','dispatched','delivered','cancelled')),
  channel          text        NOT NULL DEFAULT 'whatsapp'
                   CHECK (channel IN ('whatsapp','messenger')),
  profile_id       uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz DEFAULT now()
);

-- ─────────────────────────────────────────
--  7. ORDER ITEMS
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  fragrance_id     text REFERENCES fragrances(id) ON DELETE SET NULL,
  fragrance_name   text NOT NULL,  -- snapshot so renames don't break history
  brand_name       text NOT NULL,  -- snapshot
  ml               int  NOT NULL,
  price            int  NOT NULL,  -- price at time of order
  qty              int  NOT NULL DEFAULT 1
);

-- ─────────────────────────────────────────
--  INDEXES
-- ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fragrance_sizes_fragrance ON fragrance_sizes(fragrance_id);
CREATE INDEX IF NOT EXISTS idx_fragrance_tags_fragrance  ON fragrance_tags(fragrance_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order         ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_status             ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created            ON orders(created_at DESC);

-- ─────────────────────────────────────────
--  ROW LEVEL SECURITY
-- ─────────────────────────────────────────

-- Catalog tables: public read, no public write
ALTER TABLE brands           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fragrances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fragrance_sizes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE fragrance_tags   ENABLE ROW LEVEL SECURITY;

-- Policies use DROP ... IF EXISTS first so this script is safely re-runnable
-- (Postgres has no CREATE POLICY IF NOT EXISTS).
DROP POLICY IF EXISTS "public read brands"          ON brands;
DROP POLICY IF EXISTS "public read fragrances"      ON fragrances;
DROP POLICY IF EXISTS "public read fragrance_sizes" ON fragrance_sizes;
DROP POLICY IF EXISTS "public read fragrance_tags"  ON fragrance_tags;

CREATE POLICY "public read brands"           ON brands           FOR SELECT USING (true);
CREATE POLICY "public read fragrances"       ON fragrances       FOR SELECT USING (true);
CREATE POLICY "public read fragrance_sizes"  ON fragrance_sizes  FOR SELECT USING (true);
CREATE POLICY "public read fragrance_tags"   ON fragrance_tags   FOR SELECT USING (true);

-- Orders: anyone can insert, nobody can read from frontend (admin only via service key)
ALTER TABLE orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public insert orders"      ON orders;
DROP POLICY IF EXISTS "public insert order_items" ON order_items;

CREATE POLICY "public insert orders"      ON orders      FOR INSERT WITH CHECK (true);
CREATE POLICY "public insert order_items" ON order_items FOR INSERT WITH CHECK (true);

-- Profiles: owner can read and update their own row
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner read profile"   ON profiles;
DROP POLICY IF EXISTS "owner update profile" ON profiles;
DROP POLICY IF EXISTS "owner insert profile" ON profiles;

CREATE POLICY "owner read profile"   ON profiles FOR SELECT USING  (auth.uid() = id);
CREATE POLICY "owner update profile" ON profiles FOR UPDATE USING  (auth.uid() = id);
CREATE POLICY "owner insert profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);
