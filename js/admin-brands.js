// ============================================================
//  admin-brands.js — the "Brands" tab of the admin.
//
//  Brands render as a typographic monogram unless a logo has been
//  uploaded. This tab is the only place to manage that logo.
//
//  Storage: product-images/brands/{slug}/{size}.webp — the same
//  bucket + path-prefix approach blog covers use, so the existing
//  bucket-wide admin policy already covers it (migration 006).
//
//  Writes go straight to the brands table: "admin write brands" is
//  FOR ALL TO authenticated USING is_admin(), so no RPC is needed
//  (the product RPC exists only for multi-table atomicity).
//
//  Rows themselves are created implicitly by upsert_product when a
//  brand name is typed on a product — this tab never adds or
//  deletes brands, it only attaches an image to one.
// ============================================================
(() => {
  const $ = id => document.getElementById(id);
  const BUCKET = 'product-images';
  const CACHE_CONTROL = '31536000';
  // The logo renders in a 46px tile circle / 64px page header, so 360w already
  // covers 5x DPR. `medium` is cheap insurance for any larger use later.
  const IMG_SIZES = [
    { name: 'small',  width: 360, quality: 0.85 },
    { name: 'medium', width: 800, quality: 0.85 },
  ];

  // Must match brandSlug() in scripts/lib/catalog.js — the build derives every
  // /brands/<slug>/ URL from the brand NAME, not from brands.slug (which can
  // drift after a rename). Keying storage on the same derived value is what
  // guarantees the image path and the page URL never disagree.
  const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  let sb = null;
  let brands = [];

  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2800);
  }

  // ─── View toggle ───────────────────────────────────────────
  $('nav-brands').addEventListener('click', async () => { setAdminView('brands'); await loadBrands(); });

  // ─── Load + list ───────────────────────────────────────────
  async function loadBrands() {
    sb = getSupabaseClient();
    // logo/updated_at arrive with migration 012; fall back so the tab still
    // renders (read-only) on a DB where it hasn't been run yet.
    let { data, error } = await sb.from('brands').select('id, slug, name, logo, updated_at').order('name');
    let migrated = true;
    if (error) {
      migrated = false;
      ({ data, error } = await sb.from('brands').select('id, slug, name').order('name'));
    }
    if (error) {
      $('brand-rows').innerHTML = '<p class="admin-error">Could not load brands: ' + esc(error.message) + '</p>';
      return;
    }
    brands = data || [];
    renderList(migrated);
  }

  function logoUrl(name, updatedAt) {
    const v = updatedAt ? Date.parse(updatedAt) : Date.now();
    return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/brands/${slugify(name)}/small.webp?v=${v}`;
  }

  // Initials fallback, mirroring monogram() in scripts/generate-product-pages.js
  // so the admin preview matches what the built page will actually show.
  function monogram(name) {
    const words = String(name || '?').trim().split(/\s+/).filter(w => w && w !== '&' && w.toLowerCase() !== 'and');
    return (words.map(w => w[0]).join('').slice(0, 3) || '?').toUpperCase();
  }

  function renderList(migrated) {
    $('brand-count').textContent = '(' + brands.length + ')';
    if (!migrated) {
      $('brand-rows').innerHTML = '<p class="admin-error">Run migration 012 in Supabase to enable brand logos.</p>';
      return;
    }
    if (!brands.length) {
      $('brand-rows').innerHTML = '<p class="admin-muted">No brands yet. They are created automatically when you save a product.</p>';
      return;
    }
    const row = b => {
      const mark = b.logo
        ? `<img class="admin-brand-logo" src="${esc(logoUrl(b.name, b.updated_at))}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'admin-brand-mono',textContent:'!'}))">`
        : `<span class="admin-brand-mono">${esc(monogram(b.name))}</span>`;
      return `<tr>
        <td style="width:64px">${mark}</td>
        <td>${esc(b.name)}<div class="admin-muted">/brands/${esc(slugify(b.name))}/</div></td>
        <td class="admin-actions">
          <button class="btn-outline btn-sm" data-act="pick" data-id="${esc(b.id)}">${b.logo ? 'Replace logo' : 'Upload logo'}</button>
          ${b.logo ? `<button class="btn-danger btn-sm" data-act="rm" data-id="${esc(b.id)}">Remove</button>` : ''}
        </td></tr>`;
    };
    $('brand-rows').innerHTML = `<table class="admin-table"><tbody>${brands.map(row).join('')}</tbody></table>`;
  }

  // ─── Actions ───────────────────────────────────────────────
  $('brand-rows').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]'); if (!btn) return;
    const b = brands.find(x => String(x.id) === btn.dataset.id); if (!b) return;
    if (btn.dataset.act === 'pick') { pendingId = b.id; $('brand-file').click(); }
    if (btn.dataset.act === 'rm') removeLogo(b);
  });

  let pendingId = null;

  $('brand-file').addEventListener('change', async e => {
    const file = e.target.files[0];
    const b = brands.find(x => x.id === pendingId);
    e.target.value = '';                       // allow re-picking the same file
    if (!file || !b) return;

    // Same rule as products + blog covers.
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return toast('Logo must be JPG, PNG, or WebP.');
    if (file.size > 5 * 1024 * 1024) return toast('Logo must be ≤ 5 MB.');

    toast('Uploading ' + b.name + ' logo…');
    try {
      await uploadLogo(b.name, file);
      // Flipping the flag also bumps updated_at via the trigger from migration
      // 012 — that timestamp is the ?v= cache-buster, so it must happen AFTER
      // the files land.
      const { error } = await sb.from('brands').update({ logo: true }).eq('id', b.id);
      if (error) throw error;
      toast('Logo saved'); await loadBrands();
    } catch (err) {
      toast('Upload failed: ' + err.message);
    }
  });

  async function removeLogo(b) {
    if (!confirm(`Remove the ${b.name} logo? The tile falls back to the “${monogram(b.name)}” monogram.`)) return;
    try {
      const slug = slugify(b.name);
      const { data: files } = await sb.storage.from(BUCKET).list('brands/' + slug);
      if (files && files.length) await sb.storage.from(BUCKET).remove(files.map(f => `brands/${slug}/${f.name}`));
      const { error } = await sb.from('brands').update({ logo: false }).eq('id', b.id);
      if (error) throw error;
      toast('Logo removed'); await loadBrands();
    } catch (err) {
      toast('Remove failed: ' + err.message);
    }
  }

  // ─── Upload: optimize in-browser, then replace the folder ──
  async function uploadLogo(name, file) {
    const slug = slugify(name);
    const { data: existing } = await sb.storage.from(BUCKET).list('brands/' + slug);
    if (existing && existing.length) await sb.storage.from(BUCKET).remove(existing.map(f => `brands/${slug}/${f.name}`));

    const { loadImage, resizeToWebp } = window.AdminImage;
    const img = await loadImage(file);
    for (const { name: size, width, quality } of IMG_SIZES) {
      const blob = await resizeToWebp(img, width, quality);
      const { error } = await sb.storage.from(BUCKET)
        .upload(`brands/${slug}/${size}.webp`, blob, { contentType: 'image/webp', upsert: true, cacheControl: CACHE_CONTROL });
      if (error) throw new Error(`logo ${size}: ${error.message}`);
    }
    URL.revokeObjectURL(img.src);
  }
})();
