// ============================================================
//  search.js — global fragrance search.
//  Self-injects a search button into the header and an overlay
//  with live results. Uses Supabase (getSupabaseClient) where
//  available; on pages without it, Enter falls back to
//  /shop.html?q=<query>. No markup changes needed per page.
// ============================================================
(() => {
  let catalog = null;      // [{id,name,brand}]
  let loaded = false;

  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hasSupabase = () => typeof getSupabaseClient === 'function';

  // ─── Inject header button + overlay ────────────────────────
  function inject() {
    const actions = document.querySelector('.nav-actions');
    if (actions && !document.getElementById('search-open-btn')) {
      const btn = document.createElement('button');
      btn.id = 'search-open-btn';
      btn.className = 'search-open-btn';
      btn.setAttribute('aria-label', 'Search');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      actions.insertBefore(btn, actions.firstChild);
      btn.addEventListener('click', open);
    }
    if (!document.getElementById('search-overlay')) {
      const ov = document.createElement('div');
      ov.id = 'search-overlay';
      ov.className = 'search-overlay';
      ov.innerHTML = `
        <div class="search-panel">
          <div class="gs-bar">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="global-search" placeholder="Search fragrances or brands…" autocomplete="off" />
            <button id="search-close" class="search-close" aria-label="Close">&times;</button>
          </div>
          <div class="search-results" id="search-results"></div>
        </div>`;
      document.body.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) close(); });
      document.getElementById('search-close').addEventListener('click', close);
      const input = document.getElementById('global-search');
      input.addEventListener('input', debounce(render, 120));
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { const q = input.value.trim(); if (q) location.href = `/shop.html?q=${encodeURIComponent(q)}`; }
        if (e.key === 'Escape') close();
      });
    }
  }

  // ─── Data ──────────────────────────────────────────────────
  async function ensureCatalog() {
    if (loaded) return;
    loaded = true;
    if (!hasSupabase()) return;
    try {
      const sb = getSupabaseClient();
      const { data } = await sb.from('fragrances')
        .select('id, name, brands(name)')
        .eq('status', 'published')
        .order('name');
      catalog = (data || []).map(r => ({ id: r.id, name: r.name, brand: r.brands?.name || '' }));
    } catch { catalog = null; }
  }

  function thumb(id) {
    return (typeof SUPABASE_URL !== 'undefined')
      ? `${SUPABASE_URL}/storage/v1/object/public/product-images/${id}/thumb.webp`
      : `/images/products/${id}.jpg`;
  }

  // ─── Render results ────────────────────────────────────────
  function render() {
    const q = document.getElementById('global-search').value.trim().toLowerCase();
    const box = document.getElementById('search-results');
    if (!q) { box.innerHTML = '<p class="search-hint">Type a fragrance or brand name…</p>'; return; }

    if (!catalog) {
      box.innerHTML = `<a class="search-all" href="/shop.html?q=${encodeURIComponent(q)}">Search "${esc(q)}" in the shop →</a>`;
      return;
    }

    const matches = catalog.filter(p =>
      p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q));

    if (!matches.length) {
      box.innerHTML = `<p class="search-hint">No matches for "${esc(q)}".</p>`;
      return;
    }

    const rows = matches.slice(0, 8).map(p => `
      <a class="search-result" href="/product/${esc(p.id)}/">
        <img src="${esc(thumb(p.id))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span><span class="sr-brand">${esc(p.brand)}</span><span class="sr-name">${esc(p.name)}</span></span>
      </a>`).join('');
    const more = matches.length > 8
      ? `<a class="search-all" href="/shop.html?q=${encodeURIComponent(q)}">See all ${matches.length} results →</a>` : '';
    box.innerHTML = rows + more;
  }

  // ─── Open / close ──────────────────────────────────────────
  function open() {
    document.getElementById('search-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    const input = document.getElementById('global-search');
    input.value = ''; render();
    input.focus();
    ensureCatalog().then(render);
  }
  function close() {
    document.getElementById('search-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // keyboard shortcut: "/" opens search
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) {
      e.preventDefault(); open();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
  else inject();
})();
