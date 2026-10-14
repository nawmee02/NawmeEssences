// ============================================================
//  asset-version.js — content-hash cache-busting for local
//  CSS/JS/data. Appends ?v=<hash> to css/*.css, js/*.js and
//  data/*.json|bin references so a long browser cache (Cloudflare)
//  can be safe: the URL changes only when the file's bytes change,
//  so repeat visitors always get the current asset without a hard
//  refresh. Idempotent: re-running replaces any existing ?v=.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashFile(fp) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(fp)).digest('hex').slice(0, 8); }
  catch (e) { return null; }
}

// Hash every file in ROOT/<dir> whose name matches `re`, keyed '<dir>/<file>'.
// Directory order is sorted so the map is deterministic across platforms.
function hashDir(ROOT, dir, re, map) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const f of fs.readdirSync(abs).sort()) {
    if (!re.test(f)) continue;
    const h = hashFile(path.join(abs, f));
    if (h) map[dir + '/' + f] = h;
  }
}

// { 'css/style.css': '<hash>', 'js/main.js': '<hash>', 'data/recs.json': '<hash>', ... }
// css/*.css (style.css, finder.css …), js/*.js, and the build-generated data
// files (data/*.json, data/*.bin — recs.json for js/recs.js via data-recs,
// finder.json for js/finder.js via data-finder, embeddings later).
function buildAssetMap(ROOT) {
  const map = {};
  hashDir(ROOT, 'css', /\.css$/, map);
  hashDir(ROOT, 'js', /\.js$/, map);
  hashDir(ROOT, 'data', /\.(?:json|bin)$/, map);
  return map;
}

// Rewrite local css/<name>.css, js/<name>.js and data/<name>.json|bin references
// (href/src/data-recs/data-finder/data-emb/data-embbin, with or without a leading slash) to
// carry ?v=<hash>. External URLs (https://…) and assets missing from the map
// never change.
function versionHtml(html, map) {
  return html.replace(
    /(href|src|data-recs|data-finder|data-emb|data-embbin)="(\/?)((?:css\/[A-Za-z0-9_-]+\.css)|(?:data\/[A-Za-z0-9_-]+\.(?:json|bin))|(?:js\/[A-Za-z0-9_-]+\.js))(?:\?v=[a-z0-9]+)?"/g,
    (m, attr, slash, asset) => {
      const v = map[asset];
      return v ? `${attr}="${slash}${asset}?v=${v}"` : m;
    }
  );
}

module.exports = { buildAssetMap, versionHtml };
