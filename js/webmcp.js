// ============================================================
//  webmcp.js — exposes NawmeEssences' customer actions as WebMCP
//  tools for in-browser AI agents. Progressive enhancement:
//  feature-detected and completely INERT when the browser has no
//  WebMCP support (the reality for ~all visitors today) — zero
//  console noise, zero cost. Tools wrap js/commerce-adapter.js
//  only (never the raw globals). HTTPS-only per the spec.
//
//  Contract: tool names + input schemas are a versioned public
//  contract (TOOL_CONTRACT_VERSION). Additive changes within a
//  major version; breaking changes require a new major version.
//  Read tools are marked readOnlyHint and never mutate state;
//  write tools validate against live catalog/cart; checkout is
//  human-confirmed (prepare_order returns a deep link, never sends).
// ============================================================
(function () {
  // Current API is document.modelContext; navigator.modelContext is deprecated.
  const mc = (typeof document !== 'undefined' && document.modelContext)
    || (typeof navigator !== 'undefined' && navigator.modelContext);
  if (!mc || typeof mc.registerTool !== 'function') return;   // inert when unsupported

  const A = window.CommerceAdapter;
  if (!A) return;

  const TOOL_CONTRACT_VERSION = '1.0.0';
  const reg = (def) => {
    // Stamp the contract version into annotations where the runtime keeps it.
    def.annotations = Object.assign({ 'x-contract-version': TOOL_CONTRACT_VERSION }, def.annotations);
    try { mc.registerTool(def); } catch (e) { /* duplicate/invalid — ignore */ }
  };
  const RO = { readOnlyHint: true };

  // ── Discovery (read-only) ──────────────────────────────────
  reg({
    name: 'search_products',
    description: 'Relevance-ranked text search over the NawmeEssences fragrance catalog (matches product name and brand). Returns products with effective price, available sizes, stock, and URL.',
    annotations: RO,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query, e.g. "fresh summer" or "rasasi hawas".' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
    },
    execute: async ({ query, limit }) => ({ results: await A.searchProducts(query, limit || 10) }),
  });

  reg({
    name: 'filter_products',
    description: 'Filter the catalog by deterministic constraints and sort. Use this (not search_products) when the user gives explicit filters.',
    annotations: RO,
    inputSchema: {
      type: 'object',
      properties: {
        brand: { type: 'string' },
        size: { type: 'string', description: 'e.g. "5ml".' },
        maxPrice: { type: 'number', description: 'Max effective (post-sale) starting price in BDT.' },
        inStock: { type: 'boolean' },
        sort: { type: 'string', enum: ['price-asc', 'price-desc', 'name-asc'] },
      },
    },
    execute: async (a) => ({ results: await A.filterProducts(a || {}) }),
  });

  reg({
    name: 'list_brands',
    description: 'List all fragrance brands carried by NawmeEssences.',
    annotations: RO,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => ({ brands: await A.listBrands() }),
  });

  reg({
    name: 'get_product',
    description: 'Full details for one product: sizes & prices, fragrance notes (top/heart/base), accords, family, description, and availability.',
    annotations: RO,
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Product id/slug, e.g. "rasasi-hawas".' } },
      required: ['id'],
    },
    execute: async ({ id }) => (await A.getProduct(id)) || { error: 'not_found', id },
  });

  reg({
    name: 'get_page_context',
    description: 'Current page context: the product/size being viewed and cart count/total, so you need not rediscover page state.',
    annotations: RO,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => A.getPageContext(),
  });

  // ── Cart (write, validated) ────────────────────────────────
  reg({
    name: 'add_to_cart',
    description: 'Add a product size to the cart. Validates that the size exists and the product is in stock.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string' },
        size: { type: 'string', description: 'e.g. "5ml".' },
        quantity: { type: 'integer', minimum: 1 },
      },
      required: ['productId', 'size'],
    },
    execute: async (a) => await A.addToCart(a),
  });

  reg({
    name: 'view_cart',
    description: 'View current cart items, count, and total.',
    annotations: RO,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => A.viewCart(),
  });

  reg({
    name: 'update_cart_item',
    description: 'Set the quantity of a cart line identified by productId + size.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string' }, size: { type: 'string' },
        quantity: { type: 'integer', minimum: 1 },
      },
      required: ['productId', 'size', 'quantity'],
    },
    execute: async (a) => A.updateCartItem(a),
  });

  reg({
    name: 'remove_from_cart',
    description: 'Remove a cart line identified by productId + size.',
    inputSchema: {
      type: 'object',
      properties: { productId: { type: 'string' }, size: { type: 'string' } },
      required: ['productId', 'size'],
    },
    execute: async (a) => A.removeFromCart(a),
  });

  // ── Checkout (human-confirmed) ─────────────────────────────
  reg({
    name: 'get_checkout_info',
    description: 'Delivery zones & charges, cart subtotal, advance-payment rules, and order channels.',
    annotations: RO,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => A.getCheckoutInfo(),
  });

  reg({
    name: 'prepare_order',
    description: 'Prepare an order for the user to CONFIRM and send. Does NOT submit — returns an order summary and a WhatsApp/Messenger deep link that the human opens to complete the order.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        phone: { type: 'string' },
        address: { type: 'string' },
        zone: { type: 'string', enum: ['dhaka', 'suburb', 'outside'] },
        channel: { type: 'string', enum: ['whatsapp', 'messenger'] },
      },
      required: ['name', 'phone', 'address', 'zone'],
    },
    execute: async (a) => A.prepareOrder(a),
  });
})();
