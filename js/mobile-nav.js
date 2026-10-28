// Mobile nav — injects a hamburger button and turns .nav-links into a drawer.
// Auto-detects both marketing patterns:
//   - TBT:            <header class="header"><div class="nav-container"><ul class="nav-links">...
//   - Three Realms:   <nav><div class="nav-links">...
// No HTML changes required per-page; just include this script.

(function () {
  if (window._mobileNavInit) return;
  window._mobileNavInit = true;

  // Inject CSS once
  const style = document.createElement('style');
  style.textContent = `
    .mobile-hamburger {
      display: none;
      background: none;
      border: none;
      color: currentColor;
      cursor: pointer;
      padding: 8px;
      margin-left: 8px;
      z-index: 200;
    }
    .mobile-hamburger span {
      display: block;
      width: 24px; height: 2px;
      background: currentColor;
      margin: 5px 0;
      transition: transform 0.2s, opacity 0.2s;
      border-radius: 2px;
    }
    .mobile-hamburger.open span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    .mobile-hamburger.open span:nth-child(2) { opacity: 0; }
    .mobile-hamburger.open span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }

    @media (max-width: 780px) {
      .mobile-hamburger { display: block; }
      .mobile-hamburger.on-dark span { background: #fff; }
      .mobile-hamburger.on-light span { background: #1a1a2e; }

      /* Convert nav-links to a full-width slide-down drawer */
      .nav-links.mobile-drawer {
        display: none !important;
      }
      /* The Three Realms logo is 90px tall, so the header is far taller than 60px.
         --mobile-nav-h is measured from the real nav at runtime; the 60px is only a
         fallback for the moment before that happens. */
      .nav-links.mobile-drawer.open {
        display: flex !important;
        flex-direction: column !important;
        position: fixed !important;
        top: var(--mobile-nav-h, 60px); left: 0; right: 0;
        background: #0a1628;
        padding: 18px 22px 28px;
        gap: 4px !important;
        z-index: 150;
        border-top: 1px solid rgba(255,255,255,0.08);
        box-shadow: 0 12px 32px rgba(0,0,0,0.5);
        max-height: calc(100vh - var(--mobile-nav-h, 60px));
        overflow-y: auto;
      }
      /* A 90px logo eats a third of a phone screen; scale the brand mark down so the
         header leaves room for the page. */
      nav .nav-brand img { height: 56px !important; }
      .nav-links.mobile-drawer.open li,
      .nav-links.mobile-drawer.open a {
        display: block;
        width: 100%;
      }
      .nav-links.mobile-drawer.open a {
        padding: 14px 8px;
        color: #f1f5f9 !important;
        font-size: 0.95rem !important;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        text-align: left;
      }
      .nav-links.mobile-drawer.open li:last-child a,
      .nav-links.mobile-drawer.open a:last-child { border-bottom: none; }

      /* Body scroll lock when drawer open */
      body.mobile-nav-open { overflow: hidden; }
    }
  `;
  document.head.appendChild(style);

  function init() {
    // Find the nav container. Prefer .nav-container (TBT), fall back to <nav>.
    const container = document.querySelector('.nav-container') || document.querySelector('nav');
    const links     = document.querySelector('.nav-links');
    if (!container || !links) return;

    links.classList.add('mobile-drawer');

    const btn = document.createElement('button');
    btn.className = 'mobile-hamburger';
    // Guess background — TBT header is white, Three Realms nav is dark navy
    const bg = getComputedStyle(container.tagName === 'NAV' ? container : container.closest('header') || container).backgroundColor;
    const dark = /rgb\(\s*(\d+)/.exec(bg);
    const isDark = dark && parseInt(dark[1], 10) < 128;
    btn.classList.add(isDark ? 'on-dark' : 'on-light');
    btn.setAttribute('aria-label', 'Toggle menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span></span><span></span><span></span>';
    container.appendChild(btn);

    // Measure the header so the drawer opens directly beneath it rather than behind it.
    const syncHeight = () => {
      const h = Math.round((container.getBoundingClientRect().height || 60));
      document.documentElement.style.setProperty('--mobile-nav-h', h + 'px');
    };
    syncHeight();
    window.addEventListener('resize', syncHeight);
    window.addEventListener('orientationchange', syncHeight);

    btn.addEventListener('click', () => {
      syncHeight();
      const open = links.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('mobile-nav-open', open);
    });

    // Close drawer when any link is tapped
    links.addEventListener('click', e => {
      if (e.target.tagName === 'A') {
        links.classList.remove('open');
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('mobile-nav-open');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
