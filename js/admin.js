// ============================================================
//  admin.js — NawmeEssences admin dashboard
//  Auth (Supabase) + full CRUD over the catalog, writing via the
//  atomic upsert_product RPC, with client-side image optimization.
//  All writes are authorized by admin-only RLS policies.
// ============================================================
(() => {
  const BUCKET = 'product-images';
  const GH_RUNS = 'https://api.github.com/repos/nawmee02/NawmeEssences/actions/runs?per_page=1';
  const GH_ACTIONS = 'https://github.com/nawmee02/NawmeEssences/actions';
  const IMG_SIZES = [
    { name: 'thumb',  width: 450,  quality: 0.8 },
    { name: 'medium', width: 800,  quality: 0.85 },
    { name: 'large',  width: 1600, quality: 0.9 },
  ];
  // 1-year immutable cache; ?v=<updated_at> versioning busts it on replace.
  const CACHE_CONTROL = '31536000';

  let sb = null;
  let brands = [];
  let allProducts = [];
  let editing = null;            // product being edited (or null for add)
  let editingUpdatedAt = null;   // optimistic-lock token

  const $ = id => document.getElementById(id);
  const show = (id, on) => { $(id).style.display = on ? '' : 'none'; };
  const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const csv = s => s.split(',').map(x => x.trim()).filter(Boolean);

  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ─── Auth ──────────────────────────────────────────────────
  async function initAuth() {
    sb = getSupabaseClient();
    const { data } = await sb.auth.getSession();
    await render(data.session);
    sb.auth.onAuthStateChange((event, session) => {
      render(session);
      if (event === 'PASSWORD_RECOVERY') openPwModal();
    });
  }

  async function render(session) {
    if (session) {
      show('login-view', false); show('app-view', true);
      $('admin-user').textContent = session.user.email;
      await Promise.all([loadBrands(), loadProducts()]);
      loadBuildStatus();
    } else {
      show('app-view', false); show('login-view', true);
    }
  }

  $('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('login-error').textContent = '';
    $('login-btn').disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: $('login-email').value.trim(), password: $('login-password').value,
    });
    $('login-btn').disabled = false;
    if (error) $('login-error').textContent = error.message;
  });
  $('logout-btn').addEventListener('click', () => sb.auth.signOut());

  // ─── Change password ───────────────────────────────────────
  function openPwModal() { $('pw-msg').textContent=''; $('new-pw').value=''; $('new-pw2').value=''; show('pw-modal', true); $('new-pw').focus(); }
  $('change-pw-btn').addEventListener('click', openPwModal);
  $('pw-cancel').addEventListener('click', () => show('pw-modal', false));
  $('pw-save').addEventListener('click', async () => {
    const a = $('new-pw').value, b = $('new-pw2').value;
    if (a.length < 8) { $('pw-msg').textContent = 'Password must be at least 8 characters.'; return; }
    if (a !== b) { $('pw-msg').textContent = 'Passwords do not match.'; return; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { $('pw-msg').textContent = 'You are not signed in. Close this, log in with your email and password, then try again.'; return; }
    $('pw-save').disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    $('pw-save').disabled = false;
    if (error) { $('pw-msg').textContent = error.message; return; }
    toast('Password updated'); show('pw-modal', false);
  });

  // ─── Build status widget ───────────────────────────────────
  async function loadBuildStatus() {
    try {
      const r = await fetch(GH_RUNS);
      const run = (await r.json()).workflow_runs[0];
      const state = run.status === 'completed' ? run.conclusion : run.status;
      const when = new Date(run.updated_at).toLocaleString();
      const el = $('build-status');
      el.innerHTML = `build: <a href="${GH_ACTIONS}" target="_blank">${state}</a> · ${when}`;
      el.className = 'admin-build ' + (state === 'success' ? 'ok' : state === 'failure' ? 'bad' : 'run');
    } catch { $('build-status').textContent = 'build: n/a'; }
  }

  // ─── Data loading ──────────────────────────────────────────
  async function loadBrands() {
    const { data } = await sb.from('brands').select('id, slug, name').order('name');
    brands = data || [];
    $('brand-list').innerHTML = brands.map(b => `<option value="${b.name}"></option>`).join('');
  }

  async function loadProducts() {
    // Admin sees every status (RLS grants admins full read).
    const { data, error } = await sb.from('fragrances')
      .select('id, name, collection, in_stock, is_bestseller, status, updated_at, brands(name), fragrance_sizes(ml,price)')
      .order('name');
    if (error) { toast('Load failed: ' + error.message); return; }
    allProducts = data || [];
    renderList();
  }

  function renderList() {
    const q = $('list-search').value.trim().toLowerCase();
    const filtered = allProducts.filter(p =>
      !q || p.name.toLowerCase().includes(q) || (p.brands?.name || '').toLowerCase().includes(q));
    $('product-count').textContent = `(${filtered.length})`;

    const groups = { published: [], draft: [], archived: [] };
    filtered.forEach(p => (groups[p.status] || groups.published).push(p));

    const row = p => {
      const price = p.fragrance_sizes?.length ? '৳' + Math.min(...p.fragrance_sizes.map(s => s.price)) : '—';
      return `<tr>
        <td>${esc(p.name)}<div class="admin-muted">${esc(p.brands?.name || '')} · ${p.id}</div></td>
        <td>${price}</td>
        <td><button class="pill-toggle ${p.in_stock ? 'on' : ''}" data-act="stock" data-id="${p.id}">${p.in_stock ? 'In stock' : 'Out'}</button></td>
        <td><button class="pill-toggle ${p.is_bestseller ? 'on' : ''}" data-act="best" data-id="${p.id}">★</button></td>
        <td class="admin-actions">
          <button class="btn-outline btn-sm" data-act="edit" data-id="${p.id}">Edit</button>
          ${p.status === 'archived'
            ? `<button class="btn-outline btn-sm" data-act="restore" data-id="${p.id}">Restore</button>
               <button class="btn-danger btn-sm" data-act="delete" data-id="${p.id}">Delete</button>`
            : `<button class="btn-outline btn-sm" data-act="archive" data-id="${p.id}">Archive</button>`}
        </td></tr>`;
    };
    const section = (title, list) => list.length
      ? `<h3 class="admin-group">${title} <span class="admin-muted">(${list.length})</span></h3>
         <table class="admin-table"><tbody>${list.map(row).join('')}</tbody></table>` : '';

    $('product-list').innerHTML =
      section('Published', groups.published) +
      section('Draft', groups.draft) +
      section('Archived', groups.archived) || '<p class="admin-muted">No products.</p>';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── List actions (event delegation) ───────────────────────
  $('product-list').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const id = btn.dataset.id, act = btn.dataset.act;
    const p = allProducts.find(x => x.id === id);
    if (act === 'edit') return openForm(p);
    if (act === 'stock')   return quickUpdate(id, { in_stock: !p.in_stock });
    if (act === 'best')    return quickUpdate(id, { is_bestseller: !p.is_bestseller });
    if (act === 'archive') return quickUpdate(id, { status: 'archived' });
    if (act === 'restore') return quickUpdate(id, { status: 'published' });
    if (act === 'delete')  return deleteProduct(id);
  });

  async function quickUpdate(id, patch) {
    const { error } = await sb.from('fragrances').update(patch).eq('id', id);
    if (error) return toast('Failed: ' + error.message);
    toast('Updated'); loadProducts();
  }

  async function deleteProduct(id) {
    if (!confirm(`Permanently delete "${id}"? This removes its data and images and cannot be undone.`)) return;
    const { error } = await sb.from('fragrances').delete().eq('id', id);
    if (error) return toast('Delete failed: ' + error.message);
    // clean up Storage folder
    const { data: files } = await sb.storage.from(BUCKET).list(id);
    if (files?.length) await sb.storage.from(BUCKET).remove(files.map(f => `${id}/${f.name}`));
    toast('Deleted'); loadProducts();
  }

  // ─── Form ──────────────────────────────────────────────────
  $('add-btn').addEventListener('click', () => openForm(null));
  $('cancel-btn').addEventListener('click', showList);
  $('cancel-btn-2').addEventListener('click', showList);
  $('list-search').addEventListener('input', renderList);
  $('add-size').addEventListener('click', () => addSizeRow());
  $('f-name').addEventListener('input', () => {
    if (!editing) { $('f-id').value = slugify($('f-name').value); updateIdHint(); }
  });
  $('f-id').addEventListener('input', updateIdHint);

  function updateIdHint() {
    const id = slugify($('f-id').value || $('f-name').value);
    const clash = !editing && allProducts.some(p => p.id === id);
    $('id-hint').textContent = clash ? '⚠ a product with this ID already exists' : (id ? `→ /product/${id}/` : '');
    $('id-hint').style.color = clash ? 'var(--red)' : '';
  }

  function addSizeRow(ml = '', price = '') {
    const div = document.createElement('div');
    div.className = 'size-row';
    div.innerHTML = `<input type="number" class="s-ml" placeholder="ml" value="${ml}" min="1" />
      <input type="number" class="s-price" placeholder="৳ price" value="${price}" min="1" />
      <button type="button" class="btn-outline btn-sm s-del">✕</button>`;
    div.querySelector('.s-del').addEventListener('click', () => div.remove());
    $('sizes-rows').appendChild(div);
  }

  async function openForm(p) {
    editing = p; editingUpdatedAt = p ? p.updated_at : null;
    $('form-title').textContent = p ? `Edit: ${p.name}` : 'Add product';
    $('form-error').textContent = '';
    $('f-id').readOnly = !!p;
    show('list-view', false); show('form-view', true);

    // reset
    $('sizes-rows').innerHTML = '';
    document.querySelectorAll('.f-tag').forEach(c => c.checked = false);
    ['f-name','f-id','f-brand','f-family','f-top','f-heart','f-base','f-accords','f-description'].forEach(x => $(x).value = '');
    $('f-image').value = ''; $('current-image').innerHTML = '';
    $('f-collection').value = 'regular'; $('f-status').value = p ? '' : 'draft';
    $('f-instock').checked = true; $('f-bestseller').checked = false;

    if (!p) { addSizeRow(); updateIdHint(); return; }

    // Load full record for editing
    const { data } = await sb.from('fragrances')
      .select('*, brands(name), fragrance_sizes(ml,price), fragrance_tags(tag), fragrance_details(*)')
      .eq('id', p.id).single();
    $('f-name').value = data.name; $('f-id').value = data.id;
    $('f-brand').value = data.brands?.name || '';
    $('f-collection').value = data.collection; $('f-status').value = data.status;
    $('f-instock').checked = data.in_stock; $('f-bestseller').checked = data.is_bestseller;
    (data.fragrance_sizes || []).sort((a,b)=>a.ml-b.ml).forEach(s => addSizeRow(s.ml, s.price));
    if (!data.fragrance_sizes?.length) addSizeRow();
    (data.fragrance_tags || []).forEach(t => { const c=document.querySelector(`.f-tag[value="${t.tag}"]`); if (c) c.checked = true; });
    const d = data.fragrance_details?.[0];
    if (d) {
      $('f-top').value = (d.top_notes||[]).join(', ');
      $('f-heart').value = (d.heart_notes||[]).join(', ');
      $('f-base').value = (d.base_notes||[]).join(', ');
      $('f-accords').value = (d.accords||[]).join(', ');
      $('f-family').value = d.family || '';
      $('f-description').value = d.description || '';
    }
    const thumb = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${data.id}/thumb.webp?v=${Date.now()}`;
    $('current-image').innerHTML = `<img src="${thumb}" alt="" onerror="this.style.display='none'"><span class="admin-muted">current image (upload to replace)</span>`;
  }

  function showList() { show('form-view', false); show('list-view', true); }

  function collectForm() {
    const id = slugify($('f-id').value || $('f-name').value);
    const sizes = [...document.querySelectorAll('.size-row')].map(r => ({
      ml: Number(r.querySelector('.s-ml').value), price: Number(r.querySelector('.s-price').value),
    })).filter(s => s.ml && s.price);
    const tags = [...document.querySelectorAll('.f-tag:checked')].map(c => c.value);
    return {
      id, name: $('f-name').value.trim(), brand: $('f-brand').value.trim(),
      collection: $('f-collection').value, status: $('f-status').value,
      inStock: $('f-instock').checked, isBestseller: $('f-bestseller').checked,
      sizes, tags,
      details: {
        top: csv($('f-top').value), heart: csv($('f-heart').value), base: csv($('f-base').value),
        accords: csv($('f-accords').value), family: $('f-family').value.trim(), description: $('f-description').value.trim(),
      },
    };
  }

  function validate(f, file) {
    const errs = [];
    if (!f.name) errs.push('Name is required.');
    if (!f.id) errs.push('Product ID is required.');
    if (!f.brand) errs.push('Brand is required.');
    if (!f.status) errs.push('Choose a status.');
    if (!f.sizes.length) errs.push('At least one size is required.');
    if (f.sizes.some(s => s.ml <= 0 || s.price <= 0)) errs.push('Sizes need positive ml and price.');
    if (!editing && allProducts.some(p => p.id === f.id)) errs.push(`Product ID "${f.id}" already exists.`);
    if (file) {
      if (!['image/jpeg','image/png','image/webp'].includes(file.type)) errs.push('Image must be JPG, PNG, or WebP.');
      if (file.size > 5 * 1024 * 1024) errs.push('Image must be ≤ 5 MB.');
    }
    return errs;
  }

  $('product-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('form-error').textContent = '';
    const f = collectForm();
    const file = $('f-image').files[0] || null;
    const errs = validate(f, file);
    if (errs.length) { $('form-error').innerHTML = errs.map(esc).join('<br>'); return; }

    $('save-btn').disabled = true; $('save-btn').textContent = 'Saving…';
    try {
      const { data: newUpdatedAt, error } = await sb.rpc('upsert_product', {
        p_id: f.id, p_name: f.name, p_brand_name: f.brand, p_collection: f.collection,
        p_in_stock: f.inStock, p_is_bestseller: f.isBestseller, p_status: f.status,
        p_sizes: f.sizes, p_tags: f.tags, p_details: f.details,
        p_expected_updated_at: editingUpdatedAt,
      });
      if (error) {
        if (/stale/.test(error.message)) {
          if (confirm('This product changed since you opened it. Reload the latest version?')) { openForm(allProducts.find(p=>p.id===f.id)); }
          return;
        }
        throw error;
      }
      if (file) { $('save-btn').textContent = 'Uploading image…'; await uploadImages(f.id, file); }
      toast('Saved'); await loadProducts(); showList();
    } catch (err) {
      $('form-error').textContent = 'Save failed: ' + err.message;
    } finally {
      $('save-btn').disabled = false; $('save-btn').textContent = 'Save product';
    }
  });

  // ─── Client-side image optimization + upload ───────────────
  async function uploadImages(id, file) {
    // Replace: delete existing variants first (no stale files)
    const { data: existing } = await sb.storage.from(BUCKET).list(id);
    if (existing?.length) await sb.storage.from(BUCKET).remove(existing.map(f => `${id}/${f.name}`));

    const ext = (file.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
    await sb.storage.from(BUCKET).upload(`${id}/original${ext}`, file, { contentType: file.type, upsert: true, cacheControl: CACHE_CONTROL });

    const img = await loadImage(file);
    for (const { name, width, quality } of IMG_SIZES) {
      const blob = await resizeToWebp(img, width, quality);
      const { error } = await sb.storage.from(BUCKET).upload(`${id}/${name}.webp`, blob, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_CONTROL });
      if (error) throw new Error(`image ${name}: ${error.message}`);
    }
    URL.revokeObjectURL(img.src);
  }

  function loadImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => rej(new Error('could not read image'));
      img.src = URL.createObjectURL(file);
    });
  }

  function resizeToWebp(img, targetW, quality) {
    const scale = Math.min(1, targetW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise(res => c.toBlob(res, 'image/webp', quality));
  }

  initAuth();
})();
