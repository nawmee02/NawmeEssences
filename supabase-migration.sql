-- ================================================================
--  NawmeEssences — Supabase Schema Migration
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ================================================================

-- ── ORDERS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_name      text NOT NULL,
  buyer_phone     text NOT NULL,
  buyer_address   text NOT NULL,
  delivery_zone   text NOT NULL CHECK (delivery_zone IN ('dhaka','suburb','outside')),
  delivery_charge int  NOT NULL,
  subtotal        int  NOT NULL,
  total           int  NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('whatsapp','messenger')),
  status          text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','confirmed','dispatched','delivered','cancelled')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── ORDER ITEMS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  fragrance_id   text NOT NULL,
  fragrance_name text NOT NULL,
  brand_name     text NOT NULL,
  ml             int  NOT NULL,
  price          int  NOT NULL,
  qty            int  NOT NULL DEFAULT 1
);

-- ── ROW LEVEL SECURITY ───────────────────────────────────────────

ALTER TABLE orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- Anyone can INSERT an order (guest checkout)
CREATE POLICY "anon_insert_orders"
  ON orders FOR INSERT
  TO anon
  WITH CHECK (true);

-- Anyone can INSERT order items (for the same guest checkout)
CREATE POLICY "anon_insert_order_items"
  ON order_items FOR INSERT
  TO anon
  WITH CHECK (true);

-- Only authenticated users (you, the admin) can SELECT orders
CREATE POLICY "auth_read_orders"
  ON orders FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "auth_read_order_items"
  ON order_items FOR SELECT
  TO authenticated
  USING (true);

-- Only authenticated users can update order status
CREATE POLICY "auth_update_order_status"
  ON orders FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── INDEXES ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_orders_created_at  ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status       ON orders (status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
