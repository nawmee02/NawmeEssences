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

  // Stats counter animation
  const statsSection = document.querySelector(".stats-section");
  if (statsSection) {
    let animated = false;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !animated) {
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
    }, { threshold: 0.3 });
    observer.observe(statsSection);
  }
});
