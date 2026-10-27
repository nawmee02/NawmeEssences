# finder-understand (Find a Scent, Layer C)

Server-side *understanding* for the finder. When the deterministic parser on recommend.html is unsure
about a typed sentence, the page sends just the words to this function; Gemini Flash-Lite turns
them into the finder's structured contract (intent + fields) and the page renders the answer itself
from the catalogue and the policy templates (model: Gemini 3.1 Flash-Lite, free tier; the owner picked it after Google closed 2.5 Flash-Lite to new keys in October 2026). The model never writes reply text, so every answer stays
as honest as the templates (no invented prices, no wear-time claims).

## One-time setup (owner)

1. Create an API key at <https://aistudio.google.com/apikey> (free tier is enough: roughly 15 requests
   a minute and 1,000 a day for Flash-Lite at the time of writing; check the current limits). Keys
   made in October 2026 or later cannot use 2.5 Flash-Lite any more; the function defaults to 3.1 Flash-Lite.
2. Store it as a function secret and deploy (the site uses a publishable key, which is not a JWT, so
   JWT verification must be off):

   ```sh
   # one personal access token from https://supabase.com/dashboard/account/tokens
   set SUPABASE_ACCESS_TOKEN=sbp_...            # PowerShell: $env:SUPABASE_ACCESS_TOKEN="sbp_..."
   npx supabase@latest secrets set --project-ref knviffeqzvzqwgztchks GEMINI_API_KEY=AQ....
   npx supabase@latest functions deploy finder-understand --project-ref knviffeqzvzqwgztchks --no-verify-jwt
   ```

   No install and no Docker needed: npx downloads the CLI (v2.121 checked 2026-10-16) and the
   deploy bundles on Supabase's side.

   Optional: `supabase secrets set SITE_ORIGIN=https://nawmeessences.com` (default) — the function
   loads the vocabulary from `<SITE_ORIGIN>/data/finder.json` and caches it for an hour.
   Optional: `supabase secrets set GEMINI_MODEL=gemini-flash-lite-latest` to switch the model without
   a redeploy (default `gemini-3.1-flash-lite`: Google closed 2.5 Flash-Lite to new keys in October 2026).
3. Nothing to change on the site: js/finder.js calls `<SUPABASE_URL>/functions/v1/finder-understand`
   only when its own parser is unsure, with a 10-second timeout, and falls back to the deterministic
   answer if the function is missing, slow or rate-limited.

## Guards

- Per IP 10 requests a minute, 14 a minute overall, 950 a day (in-memory per function instance).
- One 9 s budget per question (the page waits 10 s): the first Gemini call may use 8.5 s, a fast 503 / 429 / 500 is retried once with the time left (measured from the deployed function: most answers 1.9–3.3 s, some past 5 s); `temperature 0`, thinking off, JSON schema enforced by Gemini and
  re-validated in the browser (unknown labels, keys and intents are dropped).
- Only the typed sentence is sent (no cookies, no product ids). Visitors with Do Not Track or
  Global Privacy Control enabled never reach this function; the page's privacy line says so.

## Trying it

```sh
# through the deployed function
node scripts/eval-finder-server.js --url https://<project>.supabase.co/functions/v1/finder-understand queries.json
# straight against Gemini (no deploy needed)
GEMINI_API_KEY=AIza... node scripts/eval-finder-server.js --direct queries.json
```

`queries.json` is a JSON array of strings; the script prints the model's reading of each one.

## Turning it off

Set `SERVER_NLU = false` near the top of js/finder.js (or delete the function). The on-device
Chrome layer and the deterministic parser keep working as before.
