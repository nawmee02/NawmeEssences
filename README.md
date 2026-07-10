# NawmeEssences

A static e-commerce website for perfume decants, based in Bangladesh.

## Live Site

[nawmeessences.me](https://nawmeessences.me/)

## Features

- Browse regular and exclusive perfume decants
- Filter and sort products by brand, price, and category
- Shopping cart with localStorage persistence
- Order via WhatsApp or Facebook Messenger
- Buyer info form with validation
- Mobile-responsive layout


## Tech Stack

- HTML5, CSS3, Vanilla JavaScript
- No build tools or frameworks
- Hosted on GitHub Pages via GitHub Actions


## Database & schema

Catalog and orders live in Supabase. **The schema lives in `supabase/migrations/`** — run
the files in numeric order (`001` → `005`) in the Supabase SQL Editor, and nowhere else.
Product pages and `sitemap.xml` are regenerated from Supabase in CI by
`scripts/build-from-supabase.js` (nightly and on every push).

## License

All Rights Reserved © NawmeEssences
