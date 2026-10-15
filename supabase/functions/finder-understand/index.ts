// finder-understand — Find a Scent, Layer C (server-side understanding).
//
// POST { q: "<typed sentence>" } → { ok: true, out: { intent, … } } — the finder's structured contract,
// produced by Gemini Flash-Lite (GEMINI_MODEL, default 3.1) from the vocabulary in the live data/finder.json. The browser
// validates the object again and renders the answer itself; the model never writes reply text.
//
// Secrets: GEMINI_API_KEY (required), SITE_ORIGIN (optional, default https://nawmeessences.com),
//          GEMINI_MODEL (optional; default gemini-3.1-flash-lite — 2.5 Flash-Lite is closed to new keys since 2026-10).
// Deploy:  supabase functions deploy finder-understand --no-verify-jwt   (the site uses a publishable key, not a JWT)
// Guards:  per-IP and per-minute rate limits + a daily cap sized for the Gemini free tier; 8 s upstream timeout.
import { MODEL, MAX_QUERY_CHARS, buildSystemPrompt, callGemini } from './prompt.mjs';

const KEY = Deno.env.get('GEMINI_API_KEY') || '';
const MODEL_ID = Deno.env.get('GEMINI_MODEL') || MODEL;
const SITE = (Deno.env.get('SITE_ORIGIN') || 'https://nawmeessences.com').replace(/\/$/, '');
const ALLOW = new Set([SITE, 'https://nawmeessences.com', 'https://www.nawmeessences.com', 'http://127.0.0.1:8765', 'http://localhost:8765']);
const PER_IP_MIN = 10, PER_MIN = 14, PER_DAY = 950;   // free tier (check the current limits): ~15 requests/min, ~1,000/day
const FINDER_TTL_MS = 60 * 60 * 1000;

let finder: any = null, finderAt = 0, prompt = '';
const ipHits = new Map<string, number[]>();
let minuteHits: number[] = [];
const day = { key: '', n: 0 };

function corsHeaders(origin: string | null) {
  const allowed = origin && ALLOW.has(origin) ? origin : SITE;
  return { 'Access-Control-Allow-Origin': allowed, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type, apikey, authorization, x-client-info', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
}
const json = (status: number, body: unknown, headers: Record<string, string>) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

function limited(ip: string): string | null {
  const now = Date.now(), minuteAgo = now - 60_000;
  minuteHits = minuteHits.filter(t => t > minuteAgo);
  const mine = (ipHits.get(ip) || []).filter(t => t > minuteAgo);
  const today = new Date().toISOString().slice(0, 10);
  if (day.key !== today) { day.key = today; day.n = 0; }
  if (mine.length >= PER_IP_MIN) return 'ip';
  if (minuteHits.length >= PER_MIN) return 'minute';
  if (day.n >= PER_DAY) return 'day';
  mine.push(now); ipHits.set(ip, mine); minuteHits.push(now); day.n++;
  if (ipHits.size > 5000) ipHits.clear();
  return null;
}

async function loadFinder() {
  if (finder && Date.now() - finderAt < FINDER_TTL_MS) return;
  const res = await fetch(SITE + '/data/finder.json', { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error('finder.json ' + res.status);
  finder = await res.json(); finderAt = Date.now(); prompt = buildSystemPrompt(finder);
}

Deno.serve(async (req: Request) => {
  const headers = corsHeaders(req.headers.get('origin'));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return json(405, { ok: false, reason: 'method' }, headers);
  if (!KEY) return json(503, { ok: false, reason: 'no key' }, headers);
  let q = '';
  try { const body = await req.json(); q = typeof body?.q === 'string' ? body.q.trim().slice(0, MAX_QUERY_CHARS) : ''; } catch { /* fall through */ }
  if (!q) return json(400, { ok: false, reason: 'empty' }, headers);
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim();
  const why = limited(ip);
  if (why) return json(429, { ok: false, reason: 'rate ' + why }, { ...headers, 'Retry-After': '60' });
  try {
    await loadFinder();
    // Flash-Lite answers 503 'model overloaded' now and then (7 of 199 in the 2026-10-16 eval): one quick retry.
    let out;
    try { out = await callGemini(KEY, prompt, q, { timeoutMs: 5000, model: MODEL_ID }); }
    catch (e) { if (!/http (503|429|500)/.test(String(e && (e as Error).message))) throw e; await new Promise(r => setTimeout(r, 400)); out = await callGemini(KEY, prompt, q, { timeoutMs: 4500, model: MODEL_ID }); }
    if (!out || typeof out !== 'object' || typeof out.intent !== 'string') return json(502, { ok: false, reason: 'bad output' }, headers);
    return json(200, { ok: true, model: MODEL_ID, out }, headers);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(/abort/i.test(msg) ? 504 : 502, { ok: false, reason: msg.slice(0, 120) }, headers);
  }
});
