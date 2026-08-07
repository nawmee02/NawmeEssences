// ============================================================
//  admin-blog.js — the "Blog" tab of the admin. CRUD over the
//  blog_posts table (Markdown + cover image) via the admin-write
//  RLS policy from migration 010. Cover images are optimized in
//  the browser (like products) and stored under blog/{slug}/ in
//  the product-images bucket. Uses the singleton Supabase client
//  and the shared setAdminView() switcher from admin.js.
// ============================================================
(() => {
  const $ = id => document.getElementById(id);
  const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const BUCKET = 'product-images';
  const CACHE_CONTROL = '31536000';
  const IMG_SIZES = [
    { name: 'thumb',  width: 450,  q: 0.8 },
    { name: 'medium', width: 800,  q: 0.85 },
    { name: 'large',  width: 1600, q: 0.9 },
  ];

  let sb = null;
  let posts = [];
  let editing = null;

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
  }
  const topToolbar = () => document.querySelector('#blog-view > .admin-toolbar');

  // ─── View toggle ───────────────────────────────────────────
  $('nav-blog').addEventListener('click', async () => { setAdminView('blog'); showList(); await loadPosts(); });

  function showList() { $('post-form-view').style.display = 'none'; $('post-list').style.display = ''; topToolbar().style.display = ''; }
  function showForm() { $('post-form-view').style.display = ''; $('post-list').style.display = 'none'; topToolbar().style.display = 'none'; }

  // ─── Load + list ───────────────────────────────────────────
  async function loadPosts() {
    sb = getSupabaseClient();
    const { data, error } = await sb.from('blog_posts')
      .select('id, title, status, published_at, updated_at, cover')
      .order('published_at', { ascending: false, nullsFirst: false });
    if (error) {
      $('post-list').innerHTML = '<p class="admin-error">Could not load posts: ' + esc(error.message) +
        (/relation|does not exist/i.test(error.message) ? ' — run migration 010 in Supabase first.' : '') + '</p>';
      return;
    }
    posts = data || [];
    renderList();
  }

  function renderList() {
    $('post-count').textContent = '(' + posts.length + ')';
    if (!posts.length) { $('post-list').innerHTML = '<p class="admin-muted">No posts yet. Click “New post”.</p>'; return; }
    const row = p => `<tr>
      <td>${esc(p.title)}<div class="admin-muted">/blog/${esc(p.id)}/</div></td>
      <td>${p.published_at ? new Date(p.published_at).toLocaleDateString() : '—'}</td>
      <td>${p.status === 'published' ? '<span class="tag tag-new">Live</span>' : '<span class="admin-muted">Draft</span>'}</td>
      <td class="admin-actions">
        <button class="btn-outline btn-sm" data-act="edit" data-id="${esc(p.id)}">Edit</button>
        <button class="btn-danger btn-sm" data-act="del" data-id="${esc(p.id)}">Delete</button>
      </td></tr>`;
    $('post-list').innerHTML = `<table class="admin-table"><tbody>${posts.map(row).join('')}</tbody></table>`;
  }

  $('post-list').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    if (btn.dataset.act === 'edit') return openForm(btn.dataset.id);
    if (btn.dataset.act === 'del') return del(btn.dataset.id);
  });

  // ─── Form ──────────────────────────────────────────────────
  $('post-add').addEventListener('click', () => openForm(null));
  $('post-cancel').addEventListener('click', showList);
  $('p-title').addEventListener('input', () => { if (!editing) { $('p-slug').value = slugify($('p-title').value); slugHint(); } });
  $('p-slug').addEventListener('input', slugHint);
  $('p-body').addEventListener('input', renderPreview);

  function slugHint() {
    const s = slugify($('p-slug').value || $('p-title').value);
    const clash = !editing && posts.some(p => p.id === s);
    $('p-slug-hint').textContent = clash ? '⚠ a post with this slug already exists' : (s ? `→ /blog/${s}/` : '');
    $('p-slug-hint').style.color = clash ? 'var(--red)' : '';
  }
  function renderPreview() {
    if (typeof marked !== 'undefined') $('p-preview').innerHTML = marked.parse($('p-body').value || '');
  }

  async function openForm(id) {
    editing = id ? posts.find(p => p.id === id) : null;
    $('post-form-title').textContent = id ? 'Edit post' : 'New post';
    $('post-error').textContent = '';
    $('p-slug').readOnly = !!id;
    ['p-title', 'p-slug', 'p-excerpt', 'p-body', 'p-meta-title', 'p-meta-desc'].forEach(x => $(x).value = '');
    $('p-cover').value = ''; $('p-current-cover').innerHTML = '';
    $('p-status').value = id ? '' : 'draft'; $('p-date').value = '';
    showForm();

    if (!id) { renderPreview(); slugHint(); return; }

    const { data, error } = await sb.from('blog_posts').select('*').eq('id', id).single();
    if (error || !data) { $('post-error').textContent = 'Load failed: ' + (error ? error.message : 'not found'); return; }
    $('p-title').value = data.title || ''; $('p-slug').value = data.id;
    $('p-excerpt').value = data.excerpt || ''; $('p-body').value = data.body_md || '';
    $('p-status').value = data.status; $('p-meta-title').value = data.meta_title || '';
    $('p-meta-desc').value = data.meta_description || '';
    $('p-date').value = data.published_at ? new Date(data.published_at).toISOString().slice(0, 10) : '';
    if (data.cover) {
      const url = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/blog/${data.id}/thumb.webp?v=${Date.now()}`;
      $('p-current-cover').innerHTML = `<img src="${url}" alt="" onerror="this.style.display='none'"><span class="admin-muted">current cover (upload to replace)</span>`;
    }
    renderPreview();
  }

  $('post-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('post-error').textContent = '';
    const id = slugify($('p-slug').value || $('p-title').value);
    const title = $('p-title').value.trim();
    const file = $('p-cover').files[0] || null;

    const errs = [];
    if (!title) errs.push('Title is required.');
    if (!id) errs.push('Slug is required.');
    if (!editing && posts.some(p => p.id === id)) errs.push(`Slug "${id}" already exists.`);
    if (file) {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) errs.push('Cover must be JPG, PNG, or WebP.');
      if (file.size > 5 * 1024 * 1024) errs.push('Cover must be ≤ 5 MB.');
    }
    if (errs.length) { $('post-error').innerHTML = errs.map(esc).join('<br>'); return; }

    const btn = $('post-save'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const hadCover = editing ? !!editing.cover : false;
      const row = {
        id, title,
        excerpt: $('p-excerpt').value.trim(),
        body_md: $('p-body').value,
        status: $('p-status').value || 'draft',
        meta_title: $('p-meta-title').value.trim() || null,
        meta_description: $('p-meta-desc').value.trim() || null,
        published_at: $('p-date').value
          ? new Date($('p-date').value).toISOString()
          : (editing && editing.published_at) || new Date().toISOString(),
        cover: hadCover || !!file,
      };
      const { error } = await sb.from('blog_posts').upsert(row);
      if (error) throw error;
      if (file) { btn.textContent = 'Uploading cover…'; await uploadCover(id, file); }
      toast('Post saved'); await loadPosts(); showList();
    } catch (err) {
      $('post-error').textContent = 'Save failed: ' + err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Save post';
    }
  });

  async function del(id) {
    if (!confirm(`Delete post "${id}"? This removes the post and its cover image.`)) return;
    const { error } = await sb.from('blog_posts').delete().eq('id', id);
    if (error) return toast('Delete failed: ' + error.message);
    const { data: files } = await sb.storage.from(BUCKET).list('blog/' + id);
    if (files && files.length) await sb.storage.from(BUCKET).remove(files.map(f => `blog/${id}/${f.name}`));
    toast('Deleted'); loadPosts();
  }

  // ─── Cover image: optimize in-browser + upload (like products) ──
  function loadImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => rej(new Error('could not read image'));
      img.src = URL.createObjectURL(file);
    });
  }
  function resizeToWebp(img, targetW, q) {
    const scale = Math.min(1, targetW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise(r => c.toBlob(r, 'image/webp', q));
  }
  async function uploadCover(id, file) {
    const { data: existing } = await sb.storage.from(BUCKET).list('blog/' + id);
    if (existing && existing.length) await sb.storage.from(BUCKET).remove(existing.map(f => `blog/${id}/${f.name}`));
    const img = await loadImage(file);
    for (const { name, width, q } of IMG_SIZES) {
      const blob = await resizeToWebp(img, width, q);
      const { error } = await sb.storage.from(BUCKET).upload(`blog/${id}/${name}.webp`, blob, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_CONTROL });
      if (error) throw new Error(`cover ${name}: ${error.message}`);
    }
    URL.revokeObjectURL(img.src);
  }
})();
