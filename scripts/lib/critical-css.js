// ============================================================
//  critical-css.js — build-side extraction of the above-the-fold
//  subset of css/style.css so the homepage can inline it and load
//  the full stylesheet without blocking first paint.
//
//  Marking (in css/style.css):
//    /* @critical:start */                      … /* @critical:end */
//    /* @critical:start media=(max-width: 640px) */ … /* @critical:end */
//  The second form re-wraps the extracted rules in that @media so a
//  responsive subset can live inside a larger media block without
//  duplicating it. The extracted text is whitespace-minified only —
//  no rule rewriting — so what is inlined is byte-for-byte the same
//  CSS the stylesheet ships. Every extraction is validated: unbalanced
//  braces or an empty result fail the build loudly rather than
//  shipping a broken <style> block.
// ============================================================
const fs = require('fs');

const START_RE = /\/\*\s*@critical:start(?:\s+media=\(([^*]*?)\))?\s*\*\//g;
const END_TOKEN = '/* @critical:end */';

function minify(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')   // comments (no data-URI contains one)
    .replace(/\s+/g, ' ')                // collapse whitespace (keeps single spaces inside url("…") attrs)
    .replace(/\s*([{};])\s*/g, '$1')     // tighten around braces/semicolons — none occur inside the SVG data URIs
    .replace(/;}/g, '}')
    .trim();
}

function extractCriticalCss(cssPath) {
  const src = fs.readFileSync(cssPath, 'utf8');
  const parts = [];
  let m;
  START_RE.lastIndex = 0;
  while ((m = START_RE.exec(src))) {
    const bodyStart = m.index + m[0].length;
    const end = src.indexOf(END_TOKEN, bodyStart);
    if (end < 0) throw new Error(`critical-css: unterminated @critical:start at offset ${m.index}`);
    let chunk = src.slice(bodyStart, end);
    const opens = (chunk.match(/{/g) || []).length;
    const closes = (chunk.match(/}/g) || []).length;
    if (opens !== closes) throw new Error(`critical-css: unbalanced braces (${opens} '{' vs ${closes} '}') in block at offset ${m.index}`);
    if (m[1]) chunk = `@media (${m[1].trim()}){${chunk}}`;
    parts.push(chunk);
    START_RE.lastIndex = end + END_TOKEN.length;
  }
  if (!parts.length) throw new Error('critical-css: no @critical blocks found in ' + cssPath);
  const out = minify(parts.join('\n'));
  if (out.length < 2000) throw new Error('critical-css: extracted block suspiciously small (' + out.length + ' bytes)');
  if (out.includes('</style')) throw new Error('critical-css: extracted CSS contains "</style"');
  return out;
}

module.exports = { extractCriticalCss, minify };
