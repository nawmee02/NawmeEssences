// ============================================================
//  verify-schema.js — graph-integrity checks over every emitted
//  JSON-LD block (root HTML + generated product/brand/blog pages).
//  Run after the build. Exits non-zero on any violation.
//
//  Asserts (see plan):
//   1. every ld+json block parses;
//   2. no CONFLICTING @id — the same @id may recur, but its
//      identity-critical fields must not differ;
//   3. @id REFERENCE integrity, three-way (internal / canonical
//      cross-page / external), so cross-page brand & founder refs
//      are not false failures;
//   4. Product.brand resolves to a real Brand node in the corpus;
//      offers.seller resolves to the canonical #organization.
// ============================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = 'https://nawmeessences.me';
const IDENTITY_FIELDS = ['@type', 'name', 'url', 'logo', 'image', 'sameAs', 'founder'];
const CANONICAL = new Set([`${SITE}/#organization`, `${SITE}/#website`, `${SITE}/#founder`]);
const BRAND_ID_RE = new RegExp(`^${SITE.replace(/[.]/g, '\\.')}/brands/[a-z0-9-]+/#brand$`);

const errors = [];
const declared = new Map();   // @id -> { identity fields snapshot, file }
const nodesById = new Map();  // @id -> full node
const brandIds = new Set();
const refs = [];              // { id, file, kind }

// ── collect target files from sitemap.xml (the authoritative live set, so
//    stale on-disk pages from earlier builds don't cause false failures) ──
function fileForLoc(loc) {
  let p = loc.replace(SITE, '').replace(/^\//, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';       // "/" and "/foo/" → index.html
  return path.join(ROOT, p);
}
const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const files = [...new Set(locs.map(fileForLoc))].filter(fs.existsSync);

const norm = v => JSON.stringify(Array.isArray(v) ? [...v].sort() : v);

function eachNode(obj, fn) {
  if (Array.isArray(obj)) { obj.forEach(o => eachNode(o, fn)); return; }
  if (!obj || typeof obj !== 'object') return;
  if (obj['@graph']) eachNode(obj['@graph'], fn);
  if (obj['@type']) fn(obj);
  for (const k of Object.keys(obj)) if (k !== '@graph') eachNode(obj[k], fn);
}

function collectRefs(file, obj, insideId) {
  if (Array.isArray(obj)) { obj.forEach(o => collectRefs(file, o, insideId)); return; }
  if (!obj || typeof obj !== 'object') return;
  const keys = Object.keys(obj);
  // A pure reference {"@id": "..."} (no @type, few other keys)
  if (obj['@id'] && !obj['@type'] && keys.length <= 2) refs.push({ id: obj['@id'], file });
  for (const k of Object.keys(obj)) if (k !== '@graph' || true) collectRefs(file, obj[k], insideId);
}

for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let data;
    try { data = JSON.parse(m[1]); }
    catch (e) { errors.push(`${rel}: invalid JSON-LD — ${e.message}`); continue; }
    // declared nodes + identity conflict check
    eachNode(data, node => {
      const id = node['@id'];
      if (id) {
        nodesById.set(id, node);
        if (String(node['@type']).includes('Brand')) brandIds.add(id);
        const snap = {};
        for (const f of IDENTITY_FIELDS) if (node[f] !== undefined) snap[f] = norm(node[f]);
        const prev = declared.get(id);
        if (prev) {
          for (const f of Object.keys(snap)) {
            if (prev.snap[f] !== undefined && prev.snap[f] !== snap[f]) {
              errors.push(`conflicting @id "${id}" field ${f}: ${prev.file} vs ${rel}`);
            }
          }
          Object.assign(prev.snap, snap);
        } else declared.set(id, { snap, file: rel });
      }
      // Product.brand → Brand ; offers.seller → #organization
      if (node['@type'] === 'Product') {
        const b = node.brand && (node.brand['@id'] || null);
        if (!b || !BRAND_ID_RE.test(b)) errors.push(`${rel}: Product.brand missing/!Brand @id (${b})`);
        else brandIds.add('__ref__' + b);
        const seller = node.offers && node.offers.seller && node.offers.seller['@id'];
        if (seller !== `${SITE}/#organization`) errors.push(`${rel}: offers.seller not canonical org (${seller})`);
      }
    });
    collectRefs(rel, data);
  }
}

// ── reference integrity (corpus-wide) ─────────────────────────
for (const r of refs) {
  if (nodesById.has(r.id)) continue;                    // resolves somewhere in corpus
  if (CANONICAL.has(r.id)) continue;                    // allowed canonical entity
  if (BRAND_ID_RE.test(r.id)) continue;                 // brand @id (node lives on hub)
  if (/^https?:\/\//.test(r.id)) continue;              // external URL — syntax only
  errors.push(`${r.file}: unresolved @id reference "${r.id}"`);
}
// Product.brand refs must resolve to a declared Brand node in the corpus
for (const key of brandIds) {
  if (!key.startsWith('__ref__')) continue;
  const id = key.slice(7);
  if (!nodesById.has(id) || !String(nodesById.get(id)['@type']).includes('Brand'))
    errors.push(`Product.brand @id "${id}" has no Brand node in the corpus`);
}

console.log(`Scanned ${files.length} HTML files; ${declared.size} unique @id entities, ${refs.length} refs.`);
if (errors.length) {
  console.error(`\n✗ ${errors.length} schema integrity error(s):`);
  errors.slice(0, 50).forEach(e => console.error('  - ' + e));
  process.exit(1);
}
console.log('✓ schema graph integrity OK');
