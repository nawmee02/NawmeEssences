// ============================================================
//  admin-image.js — browser-side image optimization shared by
//  every admin module. Products (admin.js), blog covers
//  (admin-blog.js) and brand logos (admin-brands.js) all resize
//  through the same canvas → WebP path, so it lives here once
//  instead of a verbatim copy per module.
//
//  Transparency survives on purpose: a 2D canvas context is
//  alpha-enabled by default and lossy WebP carries an alpha
//  channel, so a cut-out PNG logo keeps its transparent
//  background rather than picking up a white box.
//
//  Must load BEFORE the modules that use it (see admin/index.html).
// ============================================================
window.AdminImage = (() => {
  function loadImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => rej(new Error('could not read image'));
      img.src = URL.createObjectURL(file);
    });
  }

  // Never upscales — Math.min(1, …) caps the scale factor at 1:1.
  function resizeToWebp(img, targetW, quality) {
    const scale = Math.min(1, targetW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return new Promise(res => c.toBlob(res, 'image/webp', quality));
  }

  return { loadImage, resizeToWebp };
})();
