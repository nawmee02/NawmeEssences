// ============================================================
//  settings.js — live hydration of admin-editable site content.
//  Fetches the single site_settings row (public-read) and applies
//  it to the page, so edits made in /admin appear on a visitor's
//  next page load without waiting for a rebuild. The static HTML
//  keeps its baked values, so with JS off (or on fetch failure)
//  everything still shows the last-built copy — never a blank.
//
//  Markup contract:
//    data-setting="a.b"        → textContent = value
//    data-setting-href="a.b"   → href = value (contact.whatsapp → wa.me link)
//    data-setting-list="a.b"   → ticker (.ticker-track) or "·"-joined text
//    data-stat-index="0"       → fills .stat-number/.stat-label from stats[i]
//    <body data-settings-meta="home"> → sets <title> + meta description
//
//  Self-contained: reads the row over the Supabase REST API with the
//  public anon key, so it needs no SDK and can run on every page
//  (including the About pages that don't load supabase-js).
// ============================================================
(function () {
  function get(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  function applySettings(s) {
    if (!s || typeof s !== 'object') return;

    // Plain text nodes
    document.querySelectorAll('[data-setting]').forEach(el => {
      const v = get(s, el.getAttribute('data-setting'));
      if (v != null && typeof v !== 'object') el.textContent = String(v);
    });

    // Links (href). WhatsApp stores a bare number → wa.me URL.
    document.querySelectorAll('[data-setting-href]').forEach(el => {
      const path = el.getAttribute('data-setting-href');
      let v = get(s, path);
      if (v == null || v === '') return;
      if (path === 'contact.whatsapp') v = 'https://wa.me/' + String(v).replace(/[^0-9]/g, '');
      el.setAttribute('href', v);
    });

    // Lists — the announcement ticker, or a "·"-joined inline list.
    document.querySelectorAll('[data-setting-list]').forEach(el => {
      const list = get(s, el.getAttribute('data-setting-list'));
      if (!Array.isArray(list) || !list.length) return;
      const track = el.classList.contains('ticker-track') ? el : el.querySelector('.ticker-track');
      if (track) {
        // Doubled for the seamless CSS marquee loop.
        track.textContent = '';
        [...list, ...list].forEach(text => {
          const span = document.createElement('span');
          span.textContent = text;
          track.appendChild(span);
        });
      } else {
        el.textContent = list.join(' · ');
      }
    });

    // Stats: update the count-up target + suffix + label. main.js reads
    // data-target/data-suffix when it animates; set textContent too so the
    // reduced-motion (no-animation) path shows the new number immediately.
    if (Array.isArray(s.stats)) {
      document.querySelectorAll('[data-stat-index]').forEach(item => {
        const st = s.stats[Number(item.getAttribute('data-stat-index'))];
        if (!st) return;
        const num = item.querySelector('.stat-number');
        const label = item.querySelector('.stat-label');
        if (num) {
          num.dataset.target = st.target;
          num.dataset.suffix = st.suffix || '';
          num.textContent = String(st.target) + (st.suffix || '');
        }
        if (label && st.label) label.textContent = st.label;
      });
    }

    // Trust bar — rebuild from the editable list, emitted twice so the ticker
    // loops seamlessly. Empty list keeps the baked default content.
    if (Array.isArray(s.trustBar) && s.trustBar.length) {
      const track = document.querySelector('.trust-track');
      if (track) {
        track.textContent = '';
        [...s.trustBar, ...s.trustBar].forEach(t => {
          const item = document.createElement('div'); item.className = 'trust-item';
          const dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = '◆';
          item.append(dot, document.createTextNode(' ' + t));
          track.appendChild(item);
        });
      }
    }

    // Homepage sections — How-to-Order steps + FAQ accordion. Rebuilt only when
    // the row carries homeSections, so an older row keeps the baked defaults.
    const hs = s.homeSections;
    if (hs) {
      const howto = document.querySelector('[data-setting-howto]');
      // An empty array means "not configured" — keep the baked default content
      // rather than wiping the section to nothing.
      if (howto && Array.isArray(hs.howToOrder) && hs.howToOrder.length) {
        howto.textContent = '';
        hs.howToOrder.forEach((step, i) => {
          const wrap = document.createElement('div'); wrap.className = 'how-step';
          const num = document.createElement('span'); num.className = 'how-step-num'; num.textContent = String(i + 1);
          const h = document.createElement('h3'); h.className = 'how-step-title'; h.textContent = step.title || '';
          const p = document.createElement('p'); p.className = 'how-step-text'; p.textContent = step.text || '';
          wrap.append(num, h, p); howto.appendChild(wrap);
        });
      }
      const faqEl = document.querySelector('[data-setting-faq]');
      if (faqEl && Array.isArray(hs.faq) && hs.faq.length) {
        faqEl.textContent = '';
        hs.faq.forEach(item => {
          const d = document.createElement('details'); d.className = 'faq-item';
          const sm = document.createElement('summary'); sm.className = 'faq-q'; sm.textContent = item.q || '';
          const ans = document.createElement('div'); ans.className = 'faq-a';
          const p = document.createElement('p'); p.textContent = item.a || '';
          ans.appendChild(p); d.append(sm, ans); faqEl.appendChild(d);
        });
      }
    }

    // Homepage <title> + meta description.
    if (document.body && document.body.dataset.settingsMeta === 'home' && s.meta) {
      if (s.meta.homeTitle) document.title = s.meta.homeTitle;
      const md = document.querySelector('meta[name="description"]');
      if (md && s.meta.homeDescription) md.setAttribute('content', s.meta.homeDescription);
    }

    // Expose for cart.html (delivery math) and dispatch so it can recompute.
    window.__SETTINGS__ = s;
    window.dispatchEvent(new CustomEvent('settings:loaded', { detail: s }));
  }

  // Public production defaults (same values committed in js/supabase.js). A
  // gitignored supabase-config.js may set the window overrides for local dev.
  var SB_URL = (typeof window !== 'undefined' && window.__SUPABASE_URL__) || 'https://knviffeqzvzqwgztchks.supabase.co';
  var SB_KEY = (typeof window !== 'undefined' && window.__SUPABASE_ANON_KEY__) || 'sb_publishable_olO3EcqKY0ssnfh2qzKB7g_2-zxc2Or';

  async function load() {
    try {
      const res = await fetch(SB_URL + '/rest/v1/site_settings?id=eq.1&select=data', {
        headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY },
      });
      if (!res.ok) return;                         // keep baked fallback
      const rows = await res.json();
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row && row.data) applySettings(row.data);
    } catch (e) {
      /* keep baked fallback */
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
