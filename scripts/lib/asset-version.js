// ============================================================
//  asset-version.js — content-hash cache-busting for local
//  CSS/JS. Appends ?v=<hash> to css/style.css and js/*.js
//  references so a long browser cache (Cloudflare) can be safe:
//  the URL changes only when the file's bytes change, so repeat
//  visitors always get the current asset without a hard refresh.
//  Idempotent: re-running replaces any existing ?v=.
// ============================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashFile(fp) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(fp)).digest('hex').slice(0, 8); }
  catch (e) { return null; }
}

// { 'css/style.css': '<hash>', 'js/main.js': '<hash>', ... }
function buildAssetMap(ROOT) {
  const map = {};
  const css = hashFile(path.join(ROOT, 'css', 'style.css'));
  if (css) map['css/style.css'] = css;
  const jsDir = path.join(ROOT, 'js');
  if (fs.existsSync(jsDir)) {
    for (const f of fs.readdirSync(jsDir)) {
      if (!f.endsWith('.js')) continue;
      const h = hashFile(path.join(jsDir, f));
      if (h) map['js/' + f] = h;
    }
  }
  return map;
}

// Rewrite local css/style.css and js/*.js references (href/src, with or without
// a leading slash) to carry ?v=<hash>. External URLs (https://…) never match.
function versionHtml(html, map) {
  return html.replace(
    /(href|src)="(\/?)((?:css\/style\.css)|(?:js\/[A-Za-z0-9_-]+\.js))(?:\?v=[a-z0-9]+)?"/g,
    (m, attr, slash, asset) => {
      const v = map[asset];
      return v ? `${attr}="${slash}${asset}?v=${v}"` : m;
    }
  );
}

module.exports = { buildAssetMap, versionHtml };
