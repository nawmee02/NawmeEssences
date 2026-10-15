#!/usr/bin/env node
// Prints Gemini's reading of each query, through the deployed Edge Function (--url) or straight
// against Gemini (--direct, needs GEMINI_API_KEY). Used to check the prompt before enabling Layer C
// and to re-check it after a vocabulary change.
//
//   node scripts/eval-finder-server.js --url https://<project>.supabase.co/functions/v1/finder-understand queries.json
//   GEMINI_API_KEY=... node scripts/eval-finder-server.js --direct queries.json [--finder data/finder.json] [--out results.json]
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const direct = args.includes('--direct'), url = opt('--url', null);
const valueFlags = ['--url', '--finder', '--out'];
const file = args.filter((a, i) => !a.startsWith('--') && valueFlags.indexOf(args[i - 1]) < 0).pop();
if (!file || (!direct && !url)) { console.error('usage: eval-finder-server.js (--direct | --url <function url>) queries.json'); process.exit(2); }
const queries = JSON.parse(fs.readFileSync(file, 'utf8'));
const finderPath = opt('--finder', path.join(__dirname, '..', 'data', 'finder.json'));

(async () => {
  const P = await import(pathToFileURL(path.join(__dirname, '..', 'supabase', 'functions', 'finder-understand', 'prompt.mjs')).href);
  let ask;
  if (direct) {
    const key = process.env.GEMINI_API_KEY; if (!key) { console.error('GEMINI_API_KEY missing'); process.exit(2); }
    const finder = JSON.parse(fs.readFileSync(finderPath, 'utf8')); const prompt = P.buildSystemPrompt(finder);
    console.error('system prompt ≈ ' + Math.round(prompt.length / 4) + ' tokens, model ' + P.MODEL);
    ask = q => P.callGemini(key, prompt, q, { timeoutMs: 15000 });
  } else {
    ask = async q => { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q }) }); const j = await r.json(); if (!j.ok) throw new Error(j.reason || ('http ' + r.status)); return j.out; };
  }
  const out = []; let n = 0;
  for (const q of queries) {
    n++; const t0 = Date.now();
    try {
      const o = await ask(q);
      const brief = o.intent + (o.intent === 'search' ? ' ' + JSON.stringify({ f: (o.features || []).map(x => x.key + (x.weight < 0 ? '-' : x.weight < 1 ? '~' : '')), s: o.strength, g: o.gender, max: o.maxPrice, min: o.minPrice, like: o.anchor, ex: o.exclude })
        : o.intent === 'fact' ? ' ' + JSON.stringify(o.fact) : o.intent === 'compare' ? ' ' + JSON.stringify(o.compare) : o.intent === 'faq' ? ' ' + o.faq : o.intent === 'glossary' ? ' ' + JSON.stringify(o.glossary) : o.intent === 'chat' ? ' ' + o.chat : '');
      console.log(String(n).padStart(3), '|', q, '→', brief, '|', o.language, '|', (Date.now() - t0) + ' ms');
      out.push({ n, q, out: o, ms: Date.now() - t0 });
    } catch (e) { console.log(String(n).padStart(3), '|', q, '→ ERROR', e.message.slice(0, 120)); out.push({ n, q, error: e.message }); }
    if (direct) await new Promise(r => setTimeout(r, 4200));   // stay under the free tier's requests per minute
  }
  const outFile = opt('--out', null); if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  const errors = out.filter(x => x.error).length;
  console.error('done: ' + out.length + ' queries, ' + errors + ' errors');
})().catch(e => { console.error(e); process.exit(1); });
