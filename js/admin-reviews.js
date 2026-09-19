// ============================================================
//  admin-reviews.js — the "Reviews" tab of the admin. CRUD over the
//  reviews table (migration 013) via the admin-write RLS policy.
//  Same shape as admin-blog.js: list → form → upsert, photos
//  optimized in the browser (js/admin-image.js) and stored under
//  reviews/{id}/ in the product-images bucket. Uses the singleton
//  Supabase client and the shared setAdminView() switcher.
//
//  Homepage slots: each review may hold slot 1, 2 or 3 (unique index
//  in the DB). Choosing a taken slot moves it here — the previous
//  holder is cleared first, so two reviews can never share a slot.
// ============================================================
(() => {
  const $ = id => document.getElementById(id);
  const BUCKET = 'product-images';
  const CACHE_CONTROL = '31536000';
  const IMG_SIZES = [
    { name: 'thumb',  width: 450, q: 0.8 },
    { name: 'medium', width: 800, q: 0.85 },
  ];
  const SOURCE_LABEL = {
    facebook: 'Facebook', whatsapp: 'WhatsApp', messenger: 'Messenger',
    instagram: 'Instagram', google: 'Google', website: 'Website', other: 'Other',
  };

  let sb = null;
  let reviews = [];
  let editing = null;

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  const topToolbar = () => document.querySelector('#reviews-view > .admin-toolbar');

  // ─── View toggle ───────────────────────────────────────────
  $('nav-reviews').addEventListener('click', async () => { setAdminView('reviews'); showList(); await loadReviews(); });

  function showList() {
    $('review-form-view').style.display = 'none';
    $('review-list').style.display = ''; $('review-home-strip').style.display = ''; topToolbar().style.display = '';
  }
  function showForm() {
    $('review-form-view').style.display = '';
    $('review-list').style.display = 'none'; $('review-home-strip').style.display = 'none'; topToolbar().style.display = 'none';
  }

  // ─── Load + list ───────────────────────────────────────────
  async function loadReviews() {
    sb = getSupabaseClient();
    // Admin sees every status (RLS grants admins full read).
    const { data, error } = await sb.from('reviews')
      .select('id, display_name, rating, source, source_url, reviewed_at, status, verified, home_slot, photo, updated_at')
      .order('reviewed_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) {
      $('review-list').innerHTML = '<p class="admin-error">Could not load reviews: ' + esc(error.message) +
        (/relation|does not exist/i.test(error.message) ? ' — run migration 013 in Supabase first.' : '') + '</p>';
      $('review-home-strip').innerHTML = '';
      return;
    }
    reviews = data || [];
    renderList();
  }

  const ratingMark = r => r.rating
    ? '<span style="color:var(--gold)">' + '★'.repeat(r.rating) + '</span>'
    : '<span class="admin-muted">👍 recommends</span>';

  function renderList() {
    $('review-count').textContent = '(' + reviews.length + ')';

    // Homepage strip — what is live on the homepage, in slot order.
    const slots = [1, 2, 3].map(n => {
      const r = reviews.find(x => x.home_slot === n);
      const state = !r ? '<span class="admin-muted">empty</span>'
        : r.status !== 'published' ? esc(r.display_name) + ' <span class="admin-error" style="display:inline">(not published!)</span>'
        : esc(r.display_name);
      return `<div class="admin-home-slot"><span class="admin-home-slot-num">${n}</span>${state}</div>`;
    }).join('');
    $('review-home-strip').innerHTML = `<div class="admin-muted" style="margin-bottom:6px">Homepage reviews (set via each review’s “Homepage slot”)</div><div class="admin-home-slots">${slots}</div>`;

    if (!reviews.length) { $('review-list').innerHTML = '<p class="admin-muted">No reviews yet. Click “Add review”.</p>'; return; }
    const row = r => `<tr>
      <td style="width:44px">${r.home_slot ? `<span class="tag tag-new" title="Homepage slot ${r.home_slot}">#${r.home_slot}</span>` : ''}</td>
      <td>${esc(r.display_name)}<div class="admin-muted">${esc(SOURCE_LABEL[r.source] || r.source)}${r.reviewed_at ? ' · ' + new Date(r.reviewed_at).toLocaleDateString() : ''}${r.verified ? ' · <span style="color:var(--stock-in)">✓ verified</span>' : ''}</div></td>
      <td>${ratingMark(r)}</td>
      <td>${r.status === 'published' ? '<span class="tag tag-new">Live</span>' : '<span class="admin-muted">Draft</span>'}</td>
      <td class="admin-actions">
        <button class="btn-outline btn-sm" data-act="edit" data-id="${esc(r.id)}">Edit</button>
        <button class="btn-danger btn-sm" data-act="del" data-id="${esc(r.id)}">Delete</button>
      </td></tr>`;
    $('review-list').innerHTML = `<table class="admin-table"><tbody>${reviews.map(row).join('')}</tbody></table>`;
  }

  $('review-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    if (btn.dataset.act === 'edit') return openForm(btn.dataset.id);
    if (btn.dataset.act === 'del') return del(btn.dataset.id);
  });

  // ─── Form ──────────────────────────────────────────────────
  $('review-add').addEventListener('click', () => openForm(null));
  $('review-cancel').addEventListener('click', showList);
  $('r-slot').addEventListener('change', slotHint);

  // Tell the owner who currently holds the chosen slot (they lose it on save).
  function slotHint() {
    const n = Number($('r-slot').value);
    const holder = n ? reviews.find(r => r.home_slot === n && (!editing || r.id !== editing.id)) : null;
    $('r-slot-hint').textContent = holder ? `Replaces “${holder.display_name}” in slot ${n}` : '';
  }

  async function openForm(id) {
    editing = id ? reviews.find(r => r.id === id) : null;
    $('review-form-title').textContent = id ? 'Edit review' : 'Add review';
    $('review-error').textContent = '';
    ['r-name', 'r-url', 'r-product', 'r-date', 'r-body'].forEach(x => $(x).value = '');
    $('r-source').value = 'facebook'; $('r-rating').value = ''; $('r-lang').value = 'en';
    $('r-slot').value = ''; $('r-status').value = 'draft'; $('r-verified').checked = false;
    $('r-photo').value = ''; $('r-current-photo').innerHTML = '';
    showForm();

    if (!id) { slotHint(); return; }

    const { data, error } = await sb.from('reviews').select('*').eq('id', id).single();
    if (error || !data) { $('review-error').textContent = 'Load failed: ' + (error ? error.message : 'not found'); return; }
    $('r-name').value = data.display_name || ''; $('r-body').value = data.body || '';
    $('r-rating').value = data.rating == null ? '' : String(data.rating);
    $('r-source').value = data.source || 'facebook'; $('r-url').value = data.source_url || '';
    $('r-product').value = data.product_name || '';
    $('r-date').value = data.reviewed_at ? String(data.reviewed_at).slice(0, 10) : '';
    $('r-lang').value = data.lang || 'en';
    $('r-slot').value = data.home_slot == null ? '' : String(data.home_slot);
    $('r-status').value = data.status === 'published' ? 'published' : 'draft';
    $('r-verified').checked = !!data.verified;
    if (data.photo) {
      const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/reviews/${data.id}/thumb.webp?v=${Date.now()}`;
      $('r-current-photo').innerHTML = `<img src="${url}" alt="" onerror="this.style.display='none'"><span class="admin-muted">current photo (upload to replace)</span>`;
    }
    slotHint();
  }

  $('review-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('review-error').textContent = '';
    const name = $('r-name').value.trim();
    const body = $('r-body').value.trim();
    const url = $('r-url').value.trim();
    const rating = $('r-rating').value ? Number($('r-rating').value) : null;
    const slot = $('r-slot').value ? Number($('r-slot').value) : null;
    const file = $('r-photo').files[0] || null;

    const errs = [];
    if (!name) errs.push('Display name is required.');
    if (!body) errs.push('Review text is required.');
    if (url && !/^https:\/\//i.test(url)) errs.push('Source URL must start with https://');
    if (rating != null && !(rating >= 1 && rating <= 5)) errs.push('Rating must be 1–5 or blank.');
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) errs.push('Photo must be JPG, PNG, or WebP.');
      if (file.size > 5 * 1024 * 1024) errs.push('Photo must be ≤ 5 MB.');
    }
    if (errs.length) { $('review-error').innerHTML = errs.map(esc).join('<br>'); return; }

    const btn = $('review-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      // Known id up front so the photo path exists before upload (like orders).
      const id = editing ? editing.id : crypto.randomUUID();
      const hadPhoto = editing ? !!editing.photo : false;

      // Free the slot from its current holder first — the DB's unique index
      // would otherwise reject the save.
      if (slot) {
        const { error: slotErr } = await sb.from('reviews').update({ home_slot: null }).eq('home_slot', slot).neq('id', id);
        if (slotErr) throw slotErr;
      }

      const row = {
        id,
        display_name: name,
        body,
        rating,
        source: $('r-source').value,
        source_url: url || null,
        product_name: $('r-product').value.trim() || null,
        reviewed_at: $('r-date').value || null,
        lang: $('r-lang').value === 'bn' ? 'bn' : 'en',
        verified: $('r-verified').checked,
        home_slot: slot,
        status: $('r-status').value === 'published' ? 'published' : 'draft',
        photo: hadPhoto || !!file,
      };
      const { error } = await sb.from('reviews').upsert(row);
      if (error) throw error;
      if (file) { btn.textContent = 'Uploading photo…'; await uploadPhoto(id, file); }
      toast('Review saved'); await loadReviews(); showList();
    } catch (err) {
      $('review-error').textContent = 'Save failed: ' + err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Save review';
    }
  });

  async function del(id) {
    const r = reviews.find(x => x.id === id);
    if (!confirm(`Delete the review by "${r ? r.display_name : id}"? This removes it and any photo.`)) return;
    const { error } = await sb.from('reviews').delete().eq('id', id);
    if (error) return toast('Delete failed: ' + error.message);
    const { data: files } = await sb.storage.from(BUCKET).list('reviews/' + id);
    if (files && files.length) await sb.storage.from(BUCKET).remove(files.map(f => `reviews/${id}/${f.name}`));
    toast('Deleted'); loadReviews();
  }

  // ─── Photo: optimize in-browser + upload (like blog covers) ──
  async function uploadPhoto(id, file) {
    const { loadImage, resizeToWebp } = window.AdminImage;
    const { data: existing } = await sb.storage.from(BUCKET).list('reviews/' + id);
    if (existing && existing.length) await sb.storage.from(BUCKET).remove(existing.map(f => `reviews/${id}/${f.name}`));
    const img = await loadImage(file);
    for (const { name, width, q } of IMG_SIZES) {
      const blob = await resizeToWebp(img, width, q);
      const { error } = await sb.storage.from(BUCKET).upload(`reviews/${id}/${name}.webp`, blob, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_CONTROL });
      if (error) throw new Error(`photo ${name}: ${error.message}`);
    }
    URL.revokeObjectURL(img.src);
  }
})();
