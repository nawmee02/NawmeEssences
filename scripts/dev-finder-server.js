#!/usr/bin/env node
// Local preview of the site WITH the finder's server understanding (Layer C) before the Edge Function
// is deployed: serves the built site from the repo root and answers POST /functions/v1/finder-understand
// exactly like supabase/functions/finder-understand (same prompt.mjs, same model, one retry on overload).
// recommend.html gets one injected line pointing the finder at this endpoint; nothing is written to disk.
//
//   PowerShell:  $env:GEMINI_API_KEY="AQ..."; node scripts/dev-finder-server.js      → http://127.0.0.1:8766/recommend.html
//   bash:        GEMINI_API_KEY=AQ... node scripts/dev-finder-server.js [--port 8766]
// Without a key the site is still served and the finder falls back to its own parser.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const PORT = Number((args[args.indexOf('--port') + 1]) || 0) || 8766;
const KEY = process.env.GEMINI_API_KEY || '';
const NLU_PATH = '/functions/v1/finder-understand';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8', '.bin': 'application/octet-stream', '.webmanifest': 'application/manifest+json' };

let P = null, prompt = '', promptAt = 0;
async function systemPrompt() {
  if (!P) P = await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', 'finder-understand', 'prompt.mjs')).href);
  const stat = fs.statSync(path.join(ROOT, 'data', 'finder.json'));
  if (!prompt || stat.mtimeMs !== promptAt) { prompt = P.buildSystemPrompt(JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'finder.json'), 'utf8'))); promptAt = stat.mtimeMs; }
  return prompt;
}
const model = () => process.env.GEMINI_MODEL || (P && P.MODEL);

async function understand(req, res) {
  let body = ''; for await (const c of req) { body += c; if (body.length > 4000) break; }
  let q = ''; try { q = String(JSON.parse(body).q || '').trim().slice(0, 200); } catch (e) {}
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (!q) return send(400, { ok: false, reason: 'empty' });
  if (!KEY) return send(503, { ok: false, reason: 'no key' });
  const t0 = Date.now();
  try {
    const sys = await systemPrompt();
    let out;
    try { out = await P.callGemini(KEY, sys, q, { timeoutMs: 5000, model: model() }); }
    catch (e) { if (!/http (503|429|500)/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 400)); out = await P.callGemini(KEY, sys, q, { timeoutMs: 4500, model: model() }); }
    console.log(`  AI ${Date.now() - t0} ms  "${q}" → ${out.intent}${out.faq && out.faq !== 'none' ? ':' + out.faq : ''}${out.chat && out.chat !== 'none' ? ':' + out.chat : ''}${out.fact ? ':' + out.fact.kind + ' ' + out.fact.name : ''}`);
    send(200, { ok: true, model: model(), out });
  } catch (e) { console.log(`  AI failed ${Date.now() - t0} ms "${q}": ${e.message.slice(0, 120)}`); send(502, { ok: false, reason: e.message.slice(0, 120) }); }
}

function serveFile(req, res) {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { const nf = path.join(ROOT, '404.html'); res.writeHead(404, { 'Content-Type': TYPES['.html'] }); return res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found'); }
  const ext = path.extname(file).toLowerCase();
  let data = fs.readFileSync(file);
  if (path.basename(file) === 'recommend.html') data = Buffer.from(String(data).replace('<head>', '<head>\n<script>window.__FINDER_NLU_URL__ = ' + JSON.stringify(NLU_PATH) + ';</script>'));
  res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  res.end(data);
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.split('?')[0] === NLU_PATH) return understand(req, res).catch(() => { res.writeHead(500); res.end(); });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  try { serveFile(req, res); } catch (e) { res.writeHead(500); res.end(String(e.message)); }
}).listen(PORT, '127.0.0.1', async () => {
  await systemPrompt().catch(() => {});
  console.log(`Finder dev server: http://127.0.0.1:${PORT}/recommend.html`);
  console.log(KEY ? `  server understanding ON (${model()}); AI calls are logged below` : '  GEMINI_API_KEY not set: server understanding OFF (the parser answers alone)');
});
