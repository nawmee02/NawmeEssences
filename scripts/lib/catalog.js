// ============================================================
//  Shared helpers for the catalog sync pipeline.
//  No side effects on import — pure functions + lazy clients.
// ============================================================
require('dotenv').config();
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT          = path.join(__dirname, '..', '..');
const GENERATED_DIR = path.join(ROOT, 'assets', 'images', 'generated');
const MANIFEST_PATH = path.join(ROOT, 'assets', 'images', '.upload-manifest.json');

const SUPABASE_URL = 'https://knviffeqzvzqwgztchks.supabase.co';
const BUCKET       = 'product-images';
const SIZES        = ['thumb', 'medium', 'large'];

// Public image host. Set IMAGE_CDN to a CDN that edge-caches Supabase Storage
// (a pull-proxy mirroring the /storage/v1/object/public/... path) to serve
// product images from a PoP near customers. Only affects PUBLIC image URLs —
// the Supabase API/auth client stays on SUPABASE_URL. Defaults to Supabase direct.
const IMAGE_BASE = process.env.IMAGE_CDN || 'https://cdn.nawmeessences.me';

// ─── Supabase (service role) ─────────────────────────────────
let _sb = null;
function getSupabase() {
  if (_sb) return _sb;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY — add it to .env');
  }
  const { createClient } = require('@supabase/supabase-js');
  _sb = createClient(SUPABASE_URL, key);
  return _sb;
}

// ─── Product data (loaded from js/products.js without a browser) ─
function loadProducts() {
  const code = fs.readFileSync(path.join(ROOT, 'js', 'products.js'), 'utf8');
  const fn = new Function(
    `${code}; return { regularProducts, exclusiveProducts, specialItems, productDetails, bestsellers };`
  );
  const { regularProducts, exclusiveProducts, specialItems, productDetails, bestsellers } = fn();

  const allProducts = [
    ...regularProducts.map(p => ({ ...p, collection: 'regular' })),
    ...exclusiveProducts.map(p => ({ ...p, collection: 'exclusive' })),
    ...specialItems.map(p => ({ ...p, collection: 'special' })),
  ];

  return {
    regularProducts, exclusiveProducts, specialItems, productDetails, bestsellers,
    allProducts,
    bestsellerSet: new Set(bestsellers),
  };
}

// ─── Path / naming helpers ───────────────────────────────────
function brandSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function storagePath(id, size) {
  return `${id}/${size}.webp`;
}

function publicUrl(id, size, v) {
  const base = `${IMAGE_BASE}/storage/v1/object/public/${BUCKET}/${storagePath(id, size)}`;
  return v ? `${base}?v=${v}` : base;
}

// Cache-busting token from a product's updated_at (matches js/api.js `ver`).
function imageVersion(updatedAt) {
  const t = updatedAt ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(t) ? Math.floor(t / 1000) : '';
}

function generatedFilePath(id, size) {
  return path.join(GENERATED_DIR, id, `${size}.webp`);
}

function hasGeneratedImages(id) {
  return fs.existsSync(generatedFilePath(id, 'thumb'));
}

// All generated webp files as { id, size, path, storagePath }
function listGeneratedFiles() {
  if (!fs.existsSync(GENERATED_DIR)) return [];
  const out = [];
  for (const id of fs.readdirSync(GENERATED_DIR)) {
    const dir = path.join(GENERATED_DIR, id);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const size of SIZES) {
      const fp = generatedFilePath(id, size);
      if (fs.existsSync(fp)) out.push({ id, size, path: fp, storagePath: storagePath(id, size) });
    }
  }
  return out;
}

// ─── Upload manifest (tracks what's actually in Storage) ─────
function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveManifest(manifest) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

// Is this image confirmed uploaded? Prefer manifest truth; fall back to
// local existence when no manifest exists (standalone seed without upload).
function isUploaded(id, size, manifest) {
  if (manifest && Object.keys(manifest).length) {
    return Boolean(manifest[storagePath(id, size)]);
  }
  return fs.existsSync(generatedFilePath(id, size));
}

module.exports = {
  ROOT, GENERATED_DIR, MANIFEST_PATH, SUPABASE_URL, BUCKET, SIZES,
  getSupabase, loadProducts,
  brandSlug, storagePath, publicUrl, imageVersion, generatedFilePath, hasGeneratedImages,
  listGeneratedFiles, sha256, loadManifest, saveManifest, isUploaded,
};
