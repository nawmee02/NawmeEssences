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

  // Fallback content for the How-to-Order / FAQ editors so they never load
  // blank (a blank editor + Save would wipe the live sections). Mirrors
  // DEFAULTS.homeSections in scripts/lib/settings.js.
  const DEFAULT_HOME_SECTIONS = {
    howToOrder: [
      { title: 'Choose Your Fragrance', text: 'Select your favorite fragrance and preferred size (3ml–30ml).' },
      { title: 'Place Your Order', text: 'Add items to your cart and complete checkout with your contact and delivery details.' },
      { title: 'Confirm with Advance', text: 'Pay the required advance via bKash, Nagad, or Bank Transfer.' },
      { title: 'Receive or Collect', text: 'Enjoy nationwide delivery or collect your order from Aftabnagar, Banasree, or NSU.' },
    ],
    faq: [
      { q: 'What is a perfume decant?', a: 'A perfume decant is a smaller quantity of fragrance transferred from an authentic original bottle into a travel-sized atomizer.' },
      { q: 'Are your perfumes authentic?', a: 'Yes. Every decant is taken directly from authentic original bottles. We never dilute, mix, or alter the fragrance.' },
      { q: 'Why buy a decant instead of a full bottle?', a: 'Decants let you experience premium fragrances at a lower cost before investing in a full-size bottle.' },
      { q: 'What sizes do you offer?', a: 'We offer 3ml, 5ml, 10ml, 15ml, and selected fragrances in 30ml.' },
      { q: 'How are decants measured?', a: "We use sterile syringes to ensure accurate volume and maintain the fragrance's quality." },
      { q: 'How long does delivery take?', a: 'Orders are typically delivered within 1–2 business days in Dhaka and 2–3 business days outside Dhaka.' },
      { q: 'Can I return or exchange my order?', a: 'Opened or used decants cannot be returned. If you receive a damaged, missing, or incorrect item, contact us within 24 hours with a continuous unboxing video.' },
      { q: 'Where can I collect my order?', a: 'Self-pickup is available from Aftabnagar, Banasree, and NSU by prior arrangement.' },
      { q: 'How can I contact you?', a: 'The fastest way is through WhatsApp. You can also reach us via Messenger or Facebook.' },
    ],
  };

  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ─── View toggle (uses the shared switcher from admin.js) ──
  $('nav-settings').addEventListener('click', async () => { setAdminView('settings'); await loadSettings(); });
  $('nav-products').addEventListener('click', () => setAdminView('products'));

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
      el.style.width = '100%'; el.style.boxSizing = 'border-box';
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

    // Homepage sections (How-to + FAQ). An empty/missing list falls back to the
    // default content so the editors never load blank (a blank editor + Save
    // would wipe the live sections).
    const hs = s.homeSections || {};
    const howTo = (hs.howToOrder && hs.howToOrder.length) ? hs.howToOrder : DEFAULT_HOME_SECTIONS.howToOrder;
    const faqs = (hs.faq && hs.faq.length) ? hs.faq : DEFAULT_HOME_SECTIONS.faq;
    $('howto-rows').innerHTML = '';
    howTo.forEach(addHowtoRow);
    $('faq-rows').innerHTML = '';
    faqs.forEach(addFaqRow);

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
