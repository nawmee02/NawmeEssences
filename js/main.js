function selectSize(id, btn) {
  document.querySelectorAll('#size-' + id + ' .size-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const priceEl = document.getElementById('price-' + id);
  if (priceEl) priceEl.textContent = '৳' + btn.dataset.price;
}

// Nav active link
document.addEventListener("DOMContentLoaded", () => {
  updateCartBadge();

  // Highlight active nav link
  const path = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".nav-link").forEach(link => {
    if (link.getAttribute("href") === path) link.classList.add("active");
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
