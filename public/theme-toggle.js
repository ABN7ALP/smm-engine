/* ================================================================
   theme-toggle-v2.js
   - Small, safe, accessible theme toggler
   - Persists choice in localStorage ("theme" = "light" | "dark")
   - Adds minimal DOM node, non-invasive
   ================================================================ */
(function(){
  const KEY = 'theme';            // localStorage key
  const DARK_CLASS = 'theme-dark';

  function createButton(){
    // If user already added a theme toggle with data-auto="false", do nothing
    if (document.querySelector('.theme-toggle[data-auto="false"]')) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'theme-toggle';
    btn.setAttribute('aria-label', 'تبديل الوضع النهاري أو الليلي');
    btn.setAttribute('title', 'تبديل الوضع');
    btn.dataset.auto = "true"; // mark as auto-injected
    btn.style.userSelect = 'none';
    return btn;
  }

  function setIcon(btn, isDark){
    btn.textContent = isDark ? '☀️' : '🌙';
  }

  function applyTheme(isDark){
    if (isDark) document.body.classList.add(DARK_CLASS);
    else document.body.classList.remove(DARK_CLASS);
  }

  // Init on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', function(){
    const saved = localStorage.getItem(KEY);
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const initialDark = saved ? (saved === 'dark') : prefersDark;

    // Apply initial
    applyTheme(initialDark);

    // Create button if not present
    const existingBtn = document.querySelector('.theme-toggle[data-auto="false"]');
    let btn = existingBtn || createButton();
    if (!btn) return; // nothing to do

    // If not already in DOM (auto-injected), append
    if (!existingBtn) {
      document.body.appendChild(btn);
    }

    setIcon(btn, document.body.classList.contains(DARK_CLASS));

    // Toggle handler
    btn.addEventListener('click', function(){
      const isDark = !document.body.classList.contains(DARK_CLASS);
      applyTheme(isDark);
      setIcon(btn, isDark);
      try { localStorage.setItem(KEY, isDark ? 'dark' : 'light'); } catch(e){ /* ignore storage errors */ }
    });

    // In case theme changed elsewhere (multiple tabs), listen for storage events
    window.addEventListener('storage', function(e){
      if (e.key !== KEY) return;
      const val = e.newValue;
      applyTheme(val === 'dark');
      setIcon(btn, val === 'dark');
    }, false);
  });
})();
