// Mobile nav toggle
const mobileMenuButton = document.getElementById("mobile-menu-button");
const mobileMenu = document.getElementById("mobile-menu");
const iconMenu = document.getElementById("icon-menu");
const iconClose = document.getElementById("icon-close");

if (mobileMenuButton && mobileMenu && iconMenu && iconClose) {
  mobileMenuButton.addEventListener("click", () => {
    const isOpen = mobileMenu.style.maxHeight && mobileMenu.style.maxHeight !== "0px";

    if (isOpen) {
      mobileMenu.style.maxHeight = "0px";
      iconMenu.classList.remove("hidden");
      iconClose.classList.add("hidden");
    } else {
      mobileMenu.style.maxHeight = mobileMenu.scrollHeight + "px";
      iconMenu.classList.add("hidden");
      iconClose.classList.remove("hidden");
    }
  });
}

// Set current year in footer
const yearSpan = document.getElementById("year");
if (yearSpan) {
  yearSpan.textContent = new Date().getFullYear().toString();
}

// Optional: smooth scroll for internal links (Tools, About, Contact)
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", (e) => {
    const targetId = anchor.getAttribute("href");
    if (!targetId || targetId === "#") return;

    const targetElement = document.querySelector(targetId);
    if (!targetElement) return;

    e.preventDefault();
    targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
