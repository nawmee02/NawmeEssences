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

  // ─── Matching (also used by shop.js via window.searchMatcher) ──
  // Every typed word must match somewhere, in any order:
  //  - name/brand: anywhere, spaces and punctuation ignored ("9 pm" finds
  //    "9PM", "sanaya40" finds "Sanaya 40")
  //  - notes (top/heart/base) and accords: from the start of a word, so "rose"
  //    finds Rose and Rosemary but not Tuberose, "apple" not Pineapple
  // The returned fn gives 4 = name/brand match, 3 = the note words sit in one
  // note ("pink pepper" → Pink Pepper), 2 = they're spread over several notes
  // (Pink Grapefruit + Black Pepper), 1 = an accord was needed (e.g. "woody"),
  // 0 = no match.
  const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const compact = s => fold(s).replace(/[^a-z0-9]/g, '');
  const tokens = s => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
  const hits = (words, list) => (list || []).filter(s => tokens(s).some(t => words.some(w => t.startsWith(w))));
  function searchMatcher(query) {
    const words = tokens(query);
    return (name, brand, notes, accords) => {
      if (!words.length) return 0;
      const title = compact(name) + '|' + compact(brand);
      const noteWords = [];
      let needsAccord = false;
      for (const w of words) {
        if (title.includes(w)) continue;
        if (hits([w], notes).length) { noteWords.push(w); continue; }
        if (hits([w], accords).length) { needsAccord = true; continue; }
        return 0;
      }
      if (needsAccord) return 1;
      if (!noteWords.length) return 4;
      const together = (notes || []).some(n => { const t = tokens(n); return noteWords.every(w => t.some(x => x.startsWith(w))); });
      return together ? 3 : 2;
    };
  }
  window.searchMatcher = searchMatcher;

  // Why a note/accord match showed up, e.g. "Vanilla (base), Tonka Bean (base)".
  // Only the notes matching the most query words, so "pink pepper" shows Pink
  // Pepper rather than Peppermint too.
  function matchReason(p, words) {
    const found = [];
    ['top', 'heart', 'base'].forEach(layer => (p.notes[layer] || []).forEach(n => {
      const t = tokens(n);
      const score = words.filter(w => t.some(x => x.startsWith(w))).length;
      if (score) found.push({ score, text: `${n} (${layer})` });
    }));
    if (found.length) {
      const best = Math.max(...found.map(f => f.score));
      return found.filter(f => f.score === best).slice(0, 3).map(f => f.text).join(', ');
    }
    const acc = hits(words, p.accords);
    return acc.length ? acc.slice(0, 3).join(', ') + ' accord' : '';
  }

  // ─── Inject header button + overlay ────────────────────────
  function inject() {
    const actions = document.querySelector('.nav-actions');
    const navForm = document.querySelector('.nav-search');
    // The static declarative search form (js/webmcp.js tool "search_catalog")
    // is the visible entry now; only inject the legacy icon if it's absent.
    if (actions && !navForm && !document.getElementById('search-open-btn')) {
      const btn = document.createElement('button');
      btn.id = 'search-open-btn';
      btn.className = 'search-open-btn';
      btn.setAttribute('aria-label', 'Search');
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
      actions.insertBefore(btn, actions.firstChild);
      btn.addEventListener('click', () => open());
    }
    // Enhance the static header form: open the rich live-results overlay on
    // focus/submit. Agent-triggered submits (toolautosubmit) navigate natively.
    if (navForm && !navForm.dataset.enhanced) {
      navForm.dataset.enhanced = '1';
      const navInput = navForm.querySelector('input');
      const navBtn = navForm.querySelector('.nav-search-btn');
      const openOverlay = () => open(navInput ? navInput.value : '');
      if (navInput) navInput.addEventListener('focus', openOverlay);
      // Button opens the overlay before native submit/validation runs.
      if (navBtn) navBtn.addEventListener('click', (e) => { e.preventDefault(); openOverlay(); });
      // Native submit only fires with JS off or via WebMCP toolautosubmit; let
      // agent-invoked submits navigate to /shop.html?q=.
      navForm.addEventListener('submit', (e) => {
        if (e.agentInvoked) return;
        e.preventDefault();
        openOverlay();
      });
    }
    if (!document.getElementById('search-overlay')) {
      const ov = document.createElement('div');
      ov.id = 'search-overlay';
      ov.className = 'search-overlay';
      ov.innerHTML = `
        <div class="search-panel">
          <div class="gs-bar">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" id="global-search" placeholder="Search fragrances, brands or notes…" autocomplete="off" />
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
    if (typeof ProductAPI === 'undefined') return;
    try {
      // Notes/accords are optional: if they fail to load, name/brand search still works.
      const [products, details] = await Promise.all([
        ProductAPI.getAll(),
        ProductAPI.getSearchDetails().catch(() => ({})),
      ]);
      catalog = products
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => {
          const d = details[p.id] || {};
          const notes = { top: d.top || [], heart: d.heart || [], base: d.base || [] };
          return { id: p.id, name: p.name, brand: p.brand, notes, allNotes: [...notes.top, ...notes.heart, ...notes.base],
                   accords: d.accords || [], v: verToken(p.updatedAt) };
        });
    } catch { catalog = null; }
  }

  function verToken(updated_at) {
    const t = updated_at ? Date.parse(updated_at) : NaN;
    return Number.isFinite(t) ? Math.floor(t / 1000) : '';
  }

  function thumb(id, v) {
    if (typeof IMAGE_BASE === 'undefined') return `/images/products/${id}.jpg`;
    const base = `${IMAGE_BASE}/storage/v1/object/public/product-images/${id}/thumb.webp`;
    return v ? `${base}?v=${v}` : base;
  }

  // ─── Render results ────────────────────────────────────────
  function render() {
    const q = document.getElementById('global-search').value.trim().toLowerCase();
    const box = document.getElementById('search-results');
    if (!q) { box.innerHTML = '<p class="search-hint">Type a fragrance, brand or note (e.g. vanilla)…</p>'; return; }

    if (!catalog) {
      box.innerHTML = `<a class="search-all" href="/shop.html?q=${encodeURIComponent(q)}">Search "${esc(q)}" in the shop →</a>`;
      return;
    }

    // Name/brand matches first, then note matches, then accord-only (sort is
    // stable, so each group stays alphabetical).
    const match = searchMatcher(q);
    const words = tokens(q);
    const matches = catalog
      .map(p => ({ p, rank: match(p.name, p.brand, p.allNotes, p.accords) }))
      .filter(m => m.rank)
      .sort((a, b) => b.rank - a.rank);

    if (!matches.length) {
      box.innerHTML = `<p class="search-hint">No matches for "${esc(q)}".</p>`;
      return;
    }

    const rows = matches.slice(0, 8).map(({ p, rank }) => {
      const why = rank < 4 ? matchReason(p, words) : '';
      return `
      <a class="search-result" href="/product/${esc(p.id)}/">
        <img src="${esc(thumb(p.id, p.v))}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span><span class="sr-brand">${esc(p.brand)}</span><span class="sr-name">${esc(p.name)}</span>${why ? `<span class="sr-note">${esc(why)}</span>` : ''}</span>
      </a>`;
    }).join('');
    // No number here: the shop matches merged note names (scripts/lib/note-canon.js),
    // so its count can differ by a few for multi-word notes — it shows the exact one.
    const more = matches.length > 8
      ? `<a class="search-all" href="/shop.html?q=${encodeURIComponent(q)}">See all results in the shop →</a>` : '';
    box.innerHTML = rows + more;
  }

  // ─── Open / close ──────────────────────────────────────────
  function open(prefill) {
    document.getElementById('search-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
    const input = document.getElementById('global-search');
    input.value = typeof prefill === 'string' ? prefill : '';
    render();
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
