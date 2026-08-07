// ============================================================
//  admin-settings.js — the "Site content" tab of the admin.
//  Loads / edits / saves the single site_settings row (id=1).
//  Writes are authorized by the admin-write RLS policy (007),
//  the same way admin.js writes the catalog. Reuses the singleton
//  Supabase client from js/supabase.js.
// ============================================================
(() => {
  const $ = id => document.getElementById(id);
  let sb = null;
  let loaded = {};          // last-loaded settings (preserve unknown keys on save)

  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ─── View toggle ───────────────────────────────────────────
  function showSettings(on) {
    ['list-view', 'form-view'].forEach(id => { const el = $(id); if (el) el.style.display = on ? 'none' : ''; });
    // form-view should stay hidden when returning to the list; admin.js owns it.
    if (!on) { $('form-view').style.display = 'none'; $('list-view').style.display = ''; }
    $('settings-view').style.display = on ? '' : 'none';
    $('nav-settings').style.display = on ? 'none' : '';
    $('nav-products').style.display = on ? '' : 'none';
  }

  $('nav-settings').addEventListener('click', async () => { showSettings(true); await loadSettings(); });
  $('nav-products').addEventListener('click', () => showSettings(false));

  // ─── Repeater rows (mirrors addSizeRow in admin.js) ────────
  function rowInput(value, placeholder, cls) {
    const i = document.createElement('input');
    i.type = 'text'; i.value = value || ''; i.placeholder = placeholder || ''; i.className = cls;
    return i;
  }
  function delBtn(row) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn-outline btn-sm'; b.textContent = '✕';
    b.addEventListener('click', () => row.remove());
    return b;
  }

  function addAnnRow(value = '') {
    const row = document.createElement('div'); row.className = 'size-row';
    const i = rowInput(value, 'Announcement line', 'ann-input'); i.style.flex = '1';
    row.append(i, delBtn(row)); $('ann-rows').appendChild(row);
  }
  function addPickupRow(value = '') {
    const row = document.createElement('div'); row.className = 'size-row';
    const i = rowInput(value, 'Pickup point', 'pickup-input');
    row.append(i, delBtn(row)); $('pickup-rows').appendChild(row);
  }
  function addStatRow(st = {}) {
    const row = document.createElement('div'); row.className = 'size-row';
    const num = document.createElement('input');
    num.type = 'number'; num.value = (st.target ?? ''); num.placeholder = 'Number'; num.className = 'stat-target'; num.style.width = '90px';
    const suf = rowInput(st.suffix, '+ / %', 'stat-suffix'); suf.style.width = '60px';
    const lbl = rowInput(st.label, 'Label', 'stat-label-in'); lbl.style.flex = '1';
    row.append(num, suf, lbl, delBtn(row)); $('stat-rows').appendChild(row);
  }

  // Stacked block (multi-field) rows for How-to steps and FAQ items.
  function blockRow(container, fields) {
    const row = document.createElement('div');
    row.className = 'size-row';
    row.style.cssText = 'flex-direction:column;align-items:stretch;gap:6px;border:1px solid var(--border);padding:10px;border-radius:6px;';
    const inputs = fields.map(f => {
      const el = document.createElement(f.tag || 'input');
      if (f.tag === 'textarea') el.rows = 2; else el.type = 'text';
      el.value = f.value || ''; el.placeholder = f.placeholder || ''; el.className = f.cls;
      row.appendChild(el);
      return el;
    });
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'btn-outline btn-sm'; del.textContent = '✕ Remove';
    del.style.alignSelf = 'flex-end';
    del.addEventListener('click', () => row.remove());
    row.appendChild(del);
    container.appendChild(row);
    return inputs;
  }
  function addHowtoRow(step = {}) {
    blockRow($('howto-rows'), [
      { cls: 'howto-title-in', value: step.title, placeholder: 'Step title' },
      { cls: 'howto-text-in', value: step.text, placeholder: 'Step description' },
    ]);
  }
  function addFaqRow(item = {}) {
    blockRow($('faq-rows'), [
      { cls: 'faq-q-in', value: item.q, placeholder: 'Question' },
      { tag: 'textarea', cls: 'faq-a-in', value: item.a, placeholder: 'Answer' },
    ]);
  }

  $('ann-add').addEventListener('click', () => addAnnRow());
  $('pickup-add').addEventListener('click', () => addPickupRow());
  $('stat-add').addEventListener('click', () => addStatRow());
  $('howto-add').addEventListener('click', () => addHowtoRow());
  $('faq-add').addEventListener('click', () => addFaqRow());

  // ─── Load ──────────────────────────────────────────────────
  async function loadSettings() {
    $('settings-error').textContent = '';
    sb = getSupabaseClient();
    const { data, error } = await sb.from('site_settings').select('data, updated_at').eq('id', 1).single();
    if (error) {
      $('settings-error').textContent = 'Could not load settings: ' + error.message +
        (/relation|does not exist/i.test(error.message) ? ' — run migration 007 in Supabase first.' : '');
      return;
    }
    loaded = (data && data.data) || {};
    populate(loaded);
    $('settings-updated').textContent = data.updated_at ? 'Last saved ' + new Date(data.updated_at).toLocaleString() : '';
  }

  function populate(s) {
    // Announcements
    $('ann-rows').innerHTML = '';
    (s.announcements || []).forEach(addAnnRow);
    if (!(s.announcements || []).length) addAnnRow();

    // Contact
    const c = s.contact || {};
    $('s-whatsapp').value = c.whatsapp || '';
    $('s-instagram').value = c.instagram || '';
    $('s-facebook').value = c.facebook || '';

    // Payment
    const p = s.payment || {};
    $('s-bkash').value = p.bkash || '';
    $('s-nagad').value = p.nagad || '';
    $('s-advance').value = p.advanceNote || '';

    // Delivery
    const d = s.delivery || {};
    $('s-d-dhaka').value = d.dhaka ?? '';
    $('s-d-suburb').value = d.suburb ?? '';
    $('s-d-outside').value = d.outside ?? '';
    $('pickup-rows').innerHTML = '';
    (d.pickupPoints || []).forEach(addPickupRow);
    if (!(d.pickupPoints || []).length) addPickupRow();

    // Hero
    const h = s.hero || {};
    $('s-hero-eyebrow').value = h.eyebrow || '';
    $('s-hero-title').value = h.title || '';
    $('s-hero-subtitle').value = h.subtitle || '';

    // Stats
    $('stat-rows').innerHTML = '';
    (s.stats || []).forEach(addStatRow);
    if (!(s.stats || []).length) addStatRow();

    // Homepage sections (How-to + FAQ)
    const hs = s.homeSections || {};
    $('howto-rows').innerHTML = '';
    (hs.howToOrder || []).forEach(addHowtoRow);
    if (!(hs.howToOrder || []).length) addHowtoRow();
    $('faq-rows').innerHTML = '';
    (hs.faq || []).forEach(addFaqRow);
    if (!(hs.faq || []).length) addFaqRow();

    // Meta
    const m = s.meta || {};
    $('s-meta-title').value = m.homeTitle || '';
    $('s-meta-desc').value = m.homeDescription || '';
  }

  // ─── Collect + save ────────────────────────────────────────
  function collect() {
    const anns = [...document.querySelectorAll('.ann-input')].map(i => i.value.trim()).filter(Boolean);
    const pickups = [...document.querySelectorAll('.pickup-input')].map(i => i.value.trim()).filter(Boolean);
    const stats = [...$('stat-rows').querySelectorAll('.size-row')].map(r => ({
      target: Number(r.querySelector('.stat-target').value) || 0,
      suffix: r.querySelector('.stat-suffix').value.trim(),
      label: r.querySelector('.stat-label-in').value.trim(),
    })).filter(s => s.label);
    const numOr = (id, fb) => { const v = Number($(id).value); return Number.isFinite(v) ? v : fb; };

    const howToOrder = [...$('howto-rows').querySelectorAll('.size-row')].map(r => ({
      title: r.querySelector('.howto-title-in').value.trim(),
      text: r.querySelector('.howto-text-in').value.trim(),
    })).filter(x => x.title || x.text);
    const faq = [...$('faq-rows').querySelectorAll('.size-row')].map(r => ({
      q: r.querySelector('.faq-q-in').value.trim(),
      a: r.querySelector('.faq-a-in').value.trim(),
    })).filter(x => x.q);

    // Spread over `loaded` so any keys not in the form are preserved.
    return {
      ...loaded,
      announcements: anns,
      contact: { whatsapp: $('s-whatsapp').value.trim(), instagram: $('s-instagram').value.trim(), facebook: $('s-facebook').value.trim() },
      payment: { bkash: $('s-bkash').value.trim(), nagad: $('s-nagad').value.trim(), advanceNote: $('s-advance').value.trim() },
      delivery: {
        dhaka: numOr('s-d-dhaka', 0), suburb: numOr('s-d-suburb', 0), outside: numOr('s-d-outside', 0),
        pickupPoints: pickups,
      },
      hero: { eyebrow: $('s-hero-eyebrow').value.trim(), title: $('s-hero-title').value.trim(), subtitle: $('s-hero-subtitle').value.trim() },
      stats,
      homeSections: { howToOrder, faq },
      meta: { homeTitle: $('s-meta-title').value.trim(), homeDescription: $('s-meta-desc').value.trim() },
    };
  }

  $('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('settings-error').textContent = '';
    const btn = $('settings-save');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const data = collect();
      const { error } = await sb.from('site_settings').update({ data }).eq('id', 1);
      if (error) throw error;
      loaded = data;
      toast('Site content saved');
      $('settings-updated').textContent = 'Last saved ' + new Date().toLocaleString();
    } catch (err) {
      $('settings-error').textContent = 'Save failed: ' + err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Save site content';
    }
  });
})();
