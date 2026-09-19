# NawmeEssences

A static e-commerce website for perfume decants, based in Bangladesh.

## Live Site

[nawmeessences.com](https://nawmeessences.com/)

## Features

- Browse regular and exclusive perfume decants
- Filter and sort products by brand, price, and category
- Shopping cart with localStorage persistence
- Order via WhatsApp or Facebook Messenger
- Buyer info form with validation
- Customer reviews & recommendations (`/reviews/` + 3 admin-chosen homepage cards, each linked to its original Facebook/WhatsApp source)
- Admin dashboard (`/admin/`) for products, site content, brands, blog and reviews
- Mobile-responsive layout


## Tech Stack

- HTML5, CSS3, Vanilla JavaScript (no framework)
- Supabase (Postgres + Storage + Auth) as the source of truth
- Node build (`scripts/build-from-supabase.js`) bakes catalog, settings, blog and reviews into static HTML
- Hosted on GitHub Pages via GitHub Actions


## Database & schema

Catalog, settings, blog, reviews and orders live in Supabase. **The schema lives in
`supabase/migrations/`** — run the files in numeric order (`001` → `013`) in the Supabase
SQL Editor, and nowhere else. `supabase/seed-reviews.sql` is a one-off, re-runnable seed of
the Facebook recommendations (run once after `013`). Product/brand/blog/reviews pages and
`sitemap.xml` are regenerated from Supabase in CI by `scripts/build-from-supabase.js`
(nightly and on every push).

## License

All Rights Reserved © NawmeEssences
