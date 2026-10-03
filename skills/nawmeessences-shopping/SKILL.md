---
name: nawmeessences-shopping
description: Find authentic perfume decants (3ml–30ml) from NawmeEssences in Bangladesh, check prices, delivery and payment rules, and prepare a WhatsApp or Messenger order that the customer confirms themselves.
---

# Shop NawmeEssences perfume decants

NawmeEssences (https://nawmeessences.com) is a personal fragrance decant business in Dhaka, Bangladesh. Every decant is drawn from an authentic original bottle and sold in 3ml, 5ml, 10ml, 15ml and 30ml sizes. Orders are confirmed by a human over WhatsApp or Facebook Messenger. Delivery is nationwide within Bangladesh.

## When to use this skill

- The customer wants to try or buy a perfume sample / decant delivered in Bangladesh.
- The customer asks what NawmeEssences sells, what a size costs, or how delivery and payment work.
- The customer wants help assembling an order message to send to the seller.

Do not use it for full bottles, for shipping outside Bangladesh, or for any seller other than NawmeEssences.

## Finding products

| Resource | URL | Notes |
|---|---|---|
| Site overview for agents | https://nawmeessences.com/llms.txt | Brands, sizes, prices, policies, ordering steps |
| Full catalogue | https://nawmeessences.com/shop.html | All regular decants with brand, size and accord filters |
| Exclusive collection | https://nawmeessences.com/exclusive.html | Rare, discontinued and vintage bottles; full advance required |
| Product page | `https://nawmeessences.com/product/<id>/` | e.g. `/product/rasasi-hawas-ice-freeze/`; JSON-LD `Product` with an `AggregateOffer` (BDT low/high price, availability); per-size prices are in the page body |
| Brand hub | `https://nawmeessences.com/brands/<slug>/` | e.g. `/brands/afnan/`; index at `/brands/` |
| All URLs | https://nawmeessences.com/sitemap.xml | Authoritative list of live product, brand and blog pages |

Product ids are lowercase slugs of `brand-name-fragrance-name`. If a fragrance is not on the shop or exclusive page, NawmeEssences does not sell it. Never invent products, sizes or stock.

## Sizes and starting prices

Prices are in Bangladeshi Taka (BDT) and are fixed. Each product page lists the exact price for every size; the values below are the lowest across the catalogue.

| Size | From |
|---|---|
| 3ml | ৳150 |
| 5ml | ৳220 |
| 10ml | ৳380 |
| 15ml | ৳560 |
| 30ml | ৳1,090 |

Do not describe prices as negotiable or offer discounts; only the product page's stated price and any badge it shows are valid.

## Delivery and payment

- Delivery charge: ৳70 inside Dhaka, ৳90 Dhaka suburb, ৳120 anywhere else in Bangladesh.
- Pickup points in Dhaka: Aftabnagar and Banasree.
- Minimum advance payment = the delivery charge.
- Orders above ৳2,000 require a 30% advance.
- Exclusive-collection items require 100% advance.
- Payment methods: cash, bKash, Nagad.
- The order is dispatched after the advance is confirmed by the seller.

Full policy text: https://nawmeessences.com/about.html

## Ordering

Ordering is always completed by the human customer. An agent may prepare the message but must never send it or claim the order is placed.

1. Collect: product name(s), size(s), quantity, customer name, phone, delivery address (or chosen pickup point).
2. Compose a short order summary, e.g. `Order: Rasasi Hawas Ice Freeze 5ml x1. Name: ... Phone: ... Address: ...`
3. Hand the customer one of these links to send the summary themselves:
   - WhatsApp: `https://wa.me/8801988536843?text=<URL-encoded summary>`
   - Messenger: `https://m.me/NawmeEssences`
4. Tell the customer the seller will confirm availability and the advance amount before dispatch.

## In-browser WebMCP tools (when the page is open in a WebMCP-capable browser)

Every page registers these tools on `document.modelContext` (tool contract version 1.0.0). They are absent in browsers without WebMCP; fall back to the URLs above.

| Tool | Purpose |
|---|---|
| `search_products` | Relevance-ranked text search over the catalogue (read-only) |
| `filter_products` | Filter the catalogue by explicit constraints such as brand and size, with sorting (read-only) |
| `list_brands` | All fragrance brands carried (read-only) |
| `get_product` | Full details for one product id: sizes and prices, notes, accords, family, description, availability (read-only) |
| `get_page_context` | What the current page is showing (read-only) |
| `add_to_cart` | Add a product + size + quantity to the on-page cart |
| `view_cart` | Current cart contents and totals |
| `update_cart_item` | Change quantity of a cart line |
| `remove_from_cart` | Remove a cart line |
| `get_checkout_info` | Delivery charges, advance rules, payment methods |
| `prepare_order` | Returns an order summary and a WhatsApp/Messenger deep link with `requiresUserAction: true`; it never submits the order |

## Rules

- Quote only prices, charges and policies from the site; when unsure, link the product page instead of guessing.
- Never promise stock or delivery dates; the seller confirms both.
- Never place, pay for or confirm an order on the customer's behalf.
- Respect the customer's language: the site and seller handle English and Bengali.
