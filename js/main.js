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
});
