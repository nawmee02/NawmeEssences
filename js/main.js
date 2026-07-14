function selectSize(id, btn) {
  document.querySelectorAll('#size-' + id + ' .size-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const priceEl = document.getElementById('price-' + id);
  if (priceEl) priceEl.textContent = '৳' + btn.dataset.price;
}

// Theme toggle — the saved theme is applied by an inline <head> script on every
// page (before CSS paints, so no flash); this wires the nav button and keeps
// the button state + browser chrome color (meta theme-color) in sync.
function syncThemeState(btn) {
  const light = document.documentElement.dataset.theme === "light";
  if (btn) {
    btn.setAttribute("aria-label", light ? "Switch to dark theme" : "Switch to light theme");
    btn.setAttribute("aria-pressed", light ? "true" : "false");
  }
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = light ? "#faf8f4" : "#080808";
}

// Nav active link
document.addEventListener("DOMContentLoaded", () => {
  updateCartBadge();

  // Image fade-in safety net. The inline onload="…add('loaded')" handles most
  // images, but cache hits / bfcache can finish before it fires. Mark already-
  // complete images loaded now, and attach listeners to the rest (also catches
  // lazy images when they load on scroll) so none stay stuck at opacity 0.
  document.querySelectorAll(".card-img img, .related-img img, .pd-image img").forEach(img => {
    if (img.complete && img.naturalWidth > 0) { img.classList.add("loaded"); return; }
    img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
    img.addEventListener("error", () => img.classList.add("loaded"), { once: true });
  });

  const themeBtn = document.getElementById("theme-toggle");
  syncThemeState(themeBtn);
  if (themeBtn) {
    let animTimer = null;
    themeBtn.addEventListener("click", () => {
      const root = document.documentElement;
      root.classList.add("theme-anim");
      clearTimeout(animTimer);
      animTimer = setTimeout(() => root.classList.remove("theme-anim"), 300);
      const toLight = root.dataset.theme !== "light";
      if (toLight) root.dataset.theme = "light";
      else delete root.dataset.theme;
      try { localStorage.setItem("theme", toLight ? "light" : "dark"); } catch (e) {}
      syncThemeState(themeBtn);
    });
  }

  // Highlight the nav link for the current page. Handles both relative hrefs
  // (root pages: "shop.html") and absolute ones (generated pages: "/shop.html",
  // "/brands/"), and keeps Brands active on individual /brands/x/ pages.
  const here = location.pathname;
  document.querySelectorAll(".nav-link").forEach(link => {
    const target = new URL(link.getAttribute("href"), location.href).pathname;
    const isHome = target === "/" || target.endsWith("/index.html");
    const active = target === here
      || (isHome && (here === "/" || here === "/index.html"))
      || (!isHome && target.endsWith("/") && here.startsWith(target));
    if (active) link.classList.add("active");
  });

  // Mobile menu toggle
  const burger = document.getElementById("burger");
  const navMenu = document.getElementById("nav-menu");
  if (burger && navMenu) {
    burger.addEventListener("click", () => {
      navMenu.classList.toggle("open");
      burger.classList.toggle("open");
    });
  }

  // Announcement ticker auto-scroll — no JS needed (CSS animation)
  // Close mobile menu on link click
  document.querySelectorAll(".nav-link").forEach(link => {
    link.addEventListener("click", () => navMenu && navMenu.classList.remove("open"));
  });

  // Stats counter animation.
  // The real numbers are already in the HTML (so crawlers / no-JS / slow
  // connections never see "0% Authentic"). Only when we can and should animate
  // do we reset to 0 and count up; otherwise the real numbers stay untouched.
  const statsSection = document.querySelector(".stats-section");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (statsSection && ("IntersectionObserver" in window) && !reduceMotion) {
    let animated = false;
    function runStats() {
      if (animated) return;
      animated = true;
      document.querySelectorAll(".stat-number").forEach(el => {
        const target = parseInt(el.dataset.target, 10);
        const suffix = el.dataset.suffix || "";
        const duration = 1200;
        const start = performance.now();
        function tick(now) {
          const progress = Math.min((now - start) / duration, 1);
          const ease = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(ease * target) + suffix;
          if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) runStats();
    }, { threshold: 0 });
    observer.observe(statsSection);
  }
});
