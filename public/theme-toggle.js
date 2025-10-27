// =================================================================
// Theme Toggle System - ابن حلب
// =================================================================
document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const toggleBtn = document.createElement("button");
  toggleBtn.className = "theme-toggle";
  toggleBtn.innerHTML = "🌙";
  document.body.appendChild(toggleBtn);

  // استرجاع الحالة المحفوظة
  const savedTheme = localStorage.getItem("theme");
  if (savedTheme === "dark") {
    body.classList.add("dark-mode");
    toggleBtn.innerHTML = "☀️";
  }

  // التبديل بين الوضعين
  toggleBtn.addEventListener("click", () => {
    body.classList.toggle("dark-mode");
    const isDark = body.classList.contains("dark-mode");
    toggleBtn.innerHTML = isDark ? "☀️" : "🌙";
    localStorage.setItem("theme", isDark ? "dark" : "light");
  });
});