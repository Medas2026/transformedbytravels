// Three Realms wishlist widget — injects two nav icons (Regions + Animals)
// with count badges, and exposes helper functions for save/unsave toggles.
//
// Storage keys (must match wishlist.html):
//   tbt-wishlist-regions   [{ name, hero, badges, land, ocean, sky }]
//   tbt-wishlist-animals   [{ id, name, sci, photo, category }]
//
// Include on any Three Realms page with:
//   <script src="wishlist-widget.js" defer></script>

(function () {
  const KEY_REGIONS = 'tbt-wishlist-regions';
  const KEY_ANIMALS = 'tbt-wishlist-animals';
  const KEY_PLACES  = 'tbt-wishlist-places';
  const KEY_ITINS   = 'tbt-wishlist-itineraries';

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
  }
  function save(key, list) {
    localStorage.setItem(key, JSON.stringify(list));
    // Broadcast so multiple tabs / widgets stay in sync
    window.dispatchEvent(new CustomEvent('tbt-wishlist-changed', { detail: { key } }));
    updateBadges();
  }

  window.tbtWishlist = {
    isRegionSaved(name)    { return load(KEY_REGIONS).some(r => r.name === name); },
    isAnimalSaved(id)      { return load(KEY_ANIMALS).some(a => (a.id || a.name) === id); },
    isPlaceSaved(id)       { return load(KEY_PLACES ).some(p => p.id === id); },
    isItinerarySaved(name) { return load(KEY_ITINS  ).some(i => i.name === name); },

    toggleRegion(region) {
      const list = load(KEY_REGIONS);
      const idx  = list.findIndex(r => r.name === region.name);
      if (idx >= 0) list.splice(idx, 1);
      else          list.push(region);
      save(KEY_REGIONS, list);
      return idx < 0;
    },

    toggleAnimal(animal) {
      const list = load(KEY_ANIMALS);
      const key  = animal.id || animal.name;
      const idx  = list.findIndex(a => (a.id || a.name) === key);
      if (idx >= 0) list.splice(idx, 1);
      else          list.push(animal);
      save(KEY_ANIMALS, list);
      return idx < 0;
    },

    togglePlace(place) {
      const list = load(KEY_PLACES);
      const idx  = list.findIndex(p => p.id === place.id);
      if (idx >= 0) list.splice(idx, 1);
      else          list.push(place);
      save(KEY_PLACES, list);
      return idx < 0;
    },

    toggleItinerary(itin) {
      const list = load(KEY_ITINS);
      const idx  = list.findIndex(i => i.name === itin.name);
      if (idx >= 0) list.splice(idx, 1);
      else          list.push(itin);
      save(KEY_ITINS, list);
      return idx < 0;
    },

    counts() {
      return {
        regions:     load(KEY_REGIONS).length,
        animals:     load(KEY_ANIMALS).length,
        places:      load(KEY_PLACES ).length,
        itineraries: load(KEY_ITINS  ).length,
      };
    },
  };

  function ensureBadgeStyles() {
    if (document.getElementById('tbt-wishlist-styles')) return;
    const s = document.createElement('style');
    s.id = 'tbt-wishlist-styles';
    s.textContent = `
      .tbt-wl-icon {
        position: relative; display: inline-flex; align-items: center; justify-content: center;
        width: 40px; height: 40px; border-radius: 10px;
        color: #cbd5e1; cursor: pointer;
        border: 1px solid transparent;
        transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.1s;
      }
      .tbt-wl-heart { font-size: 1.35rem; line-height: 1; }
      .tbt-wl-icon:hover {
        background: rgba(45,212,191,0.15);
        color: #2dd4bf;
        border-color: rgba(45,212,191,0.4);
      }
      .tbt-wl-icon:active { transform: scale(0.94); }
      .tbt-wl-badge {
        position: absolute; top: -4px; right: -4px;
        min-width: 20px; height: 20px; padding: 0 6px;
        background: #2dd4bf; color: #0a1628;
        font-family: 'Montserrat', sans-serif; font-weight: 800; font-size: 0.7rem;
        border-radius: 10px;
        display: flex; align-items: center; justify-content: center; line-height: 1;
        box-shadow: 0 0 0 2px #0f1e35;
      }
      .tbt-wl-badge.hidden { display: none; }
    `;
    document.head.appendChild(s);
  }

  function insertIcons() {
    ensureBadgeStyles();
    const nav = document.querySelector('.nav, nav');
    if (!nav) return;
    if (nav.querySelector('.tbt-wl-icon')) return;

    const mount = nav.querySelector('.nav-right, .nav-links') || nav;

    const icon = document.createElement('button');
    icon.className = 'tbt-wl-icon';
    icon.type = 'button';
    icon.title = 'Your wishlist';
    icon.style.border = 'none';
    icon.style.background = 'none';
    icon.onclick = openWishlistModal;
    // Heart with a count of everything saved.
    icon.innerHTML = '<span class="tbt-wl-heart">♥</span><span class="tbt-wl-badge hidden" id="tbt-wl-badge-total">0</span>';

    mount.appendChild(icon);
    updateBadges();
  }

  // ─── Modal ──────────────────────────────────────────────────────────────
  function ensureModalStyles() {
    if (document.getElementById('tbt-wl-modal-styles')) return;
    const s = document.createElement('style');
    s.id = 'tbt-wl-modal-styles';
    s.textContent = `
      .tbt-wl-overlay { position: fixed; inset: 0; background: rgba(2,8,20,0.75); backdrop-filter: blur(6px); z-index: 9998; display: none; align-items: center; justify-content: center; padding: 20px; }
      .tbt-wl-overlay.open { display: flex; }
      .tbt-wl-modal { width: 100%; max-width: 560px; max-height: 90vh; overflow-y: auto; background: #0f1e35; border: 1px solid rgba(45,212,191,0.2); border-radius: 16px; padding: 24px 26px; font-family: 'Montserrat', sans-serif; color: #f1f5f9; }
      .tbt-wl-modal h2 { font-weight: 900; font-size: 1.3rem; margin: 0 0 4px; color: #fff; letter-spacing: -0.01em; }
      .tbt-wl-modal .tbt-sub { font-family: 'Lora', Georgia, serif; font-size: 0.9rem; color: #cbd5e1; margin-bottom: 18px; line-height: 1.55; }
      .tbt-wl-section { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px; }
      .tbt-wl-section-title { display: flex; justify-content: space-between; align-items: center; font-weight: 800; font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: #2dd4bf; margin-bottom: 8px; }
      .tbt-wl-item { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
      .tbt-wl-item + .tbt-wl-item { border-top: 1px solid rgba(255,255,255,0.05); }
      .tbt-wl-item img { width: 40px; height: 40px; object-fit: cover; border-radius: 6px; flex-shrink: 0; }
      .tbt-wl-item .tbt-wl-fb { width: 40px; height: 40px; border-radius: 6px; background: rgba(255,255,255,0.05); display: flex; align-items: center; justify-content: center; font-size: 1rem; flex-shrink: 0; }
      .tbt-wl-item-name { flex: 1; font-size: 0.88rem; font-weight: 600; color: #f1f5f9; }
      .tbt-wl-item-x { background: none; border: none; color: #64748b; font-size: 1.1rem; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
      .tbt-wl-item-x:hover { color: #f43f5e; background: rgba(244,63,94,0.1); }
      .tbt-wl-empty { color: #64748b; font-size: 0.85rem; font-style: italic; padding: 4px 0; }
      .tbt-wl-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
      .tbt-wl-field label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; }
      .tbt-wl-field input { padding: 10px 12px; border: 1px solid rgba(255,255,255,0.12); background: rgba(0,0,0,0.3); border-radius: 8px; color: #f1f5f9; font-family: inherit; font-size: 0.92rem; transition: border-color 0.15s; }
      .tbt-wl-field input:focus { outline: none; border-color: #2dd4bf; }
      .tbt-wl-btns { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
      .tbt-wl-btn { flex: 1; min-width: 130px; padding: 11px 14px; border-radius: 8px; font-family: inherit; font-weight: 800; font-size: 0.82rem; cursor: pointer; transition: all 0.15s; border: 1px solid; }
      .tbt-wl-btn.primary { background: #2dd4bf; color: #0a1628; border-color: #2dd4bf; }
      .tbt-wl-btn.primary:hover:not(:disabled) { background: #14b8a6; }
      .tbt-wl-btn.primary:disabled { opacity: 0.6; cursor: not-allowed; }
      .tbt-wl-btn.outline { background: transparent; color: #cbd5e1; border-color: rgba(255,255,255,0.15); }
      .tbt-wl-btn.outline:hover { color: #fff; border-color: rgba(255,255,255,0.3); }
      .tbt-wl-btn.danger { background: transparent; color: #f43f5e; border-color: rgba(244,63,94,0.35); }
      .tbt-wl-btn.danger:hover { background: rgba(244,63,94,0.1); }
      .tbt-wl-close { position: absolute; top: 12px; right: 12px; background: none; border: none; color: #64748b; font-size: 1.4rem; cursor: pointer; padding: 4px 8px; line-height: 1; }
      .tbt-wl-close:hover { color: #f1f5f9; }
      .tbt-wl-status { display: none; padding: 10px 12px; border-radius: 8px; margin-top: 10px; font-size: 0.85rem; text-align: center; }
      .tbt-wl-status.ok  { background: rgba(45,212,191,0.1); border: 1px solid rgba(45,212,191,0.3); color: #2dd4bf; }
      .tbt-wl-status.err { background: rgba(244,63,94,0.1);  border: 1px solid rgba(244,63,94,0.3);  color: #f43f5e; }
    `;
    document.head.appendChild(s);
  }

  function ensureModal() {
    if (document.getElementById('tbt-wl-overlay')) return;
    ensureModalStyles();
    const overlay = document.createElement('div');
    overlay.id = 'tbt-wl-overlay';
    overlay.className = 'tbt-wl-overlay';
    overlay.innerHTML = `
      <div class="tbt-wl-modal" style="position:relative;">
        <button class="tbt-wl-close" onclick="tbtWishlist.close()">✕</button>
        <h2>Your Wishlist</h2>
        <p class="tbt-sub">Send this to Michael and we'll build the trip around what you've saved.</p>
        <div id="tbt-wl-content"></div>
        <div class="tbt-wl-field">
          <label>Your name *</label>
          <input type="text" id="tbt-wl-name" autocomplete="name">
        </div>
        <div class="tbt-wl-field">
          <label>Email *</label>
          <input type="email" id="tbt-wl-email" autocomplete="email">
        </div>
        <div class="tbt-wl-field">
          <label>When are you thinking? (rough is fine)</label>
          <input type="text" id="tbt-wl-dates" placeholder="e.g. Sep–Oct 2027, or 'next spring'">
        </div>
        <div class="tbt-wl-btns">
          <button class="tbt-wl-btn primary" id="tbt-wl-submit" onclick="tbtWishlist.submit()">Send to Michael →</button>
          <button class="tbt-wl-btn outline"  onclick="tbtWishlist.close()">Keep browsing</button>
          <button class="tbt-wl-btn danger"   onclick="tbtWishlist.clearAll()">Empty wishlist</button>
        </div>
        <div class="tbt-wl-status" id="tbt-wl-status"></div>
      </div>
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) closeWishlistModal(); });
    document.body.appendChild(overlay);
  }

  function renderContent() {
    const regions = load(KEY_REGIONS);
    const places  = load(KEY_PLACES);
    const animals = load(KEY_ANIMALS);
    const itins   = load(KEY_ITINS);
    const el = document.getElementById('tbt-wl-content');
    if (!el) return;

    const itinsHtml = itins.length
      ? itins.map((it, i) => `
        <div class="tbt-wl-item">
          <div class="tbt-wl-fb">🗺️</div>
          <div class="tbt-wl-item-name">${escapeHtml(it.name)}${it.days ? ` <span style="color:#64748b;font-weight:400;font-size:0.78rem;">· ${escapeHtml(it.days)}</span>` : ''}</div>
          <button class="tbt-wl-item-x" onclick="tbtWishlist.removeItinerary(${i})" title="Remove">✕</button>
        </div>`).join('')
      : '<div class="tbt-wl-empty">No itineraries saved yet — save one from an itinerary page.</div>';

    const regionsHtml = regions.length
      ? regions.map((r, i) => `
        <div class="tbt-wl-item">
          ${r.hero ? `<img src="${r.hero.replace(/"/g,'&quot;')}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="tbt-wl-fb" style="display:none;">🌍</div>` : `<div class="tbt-wl-fb">🌍</div>`}
          <div class="tbt-wl-item-name">${escapeHtml(r.name)}</div>
          <button class="tbt-wl-item-x" onclick="tbtWishlist.removeRegion(${i})" title="Remove">✕</button>
        </div>`).join('')
      : '<div class="tbt-wl-empty">No regions saved yet — close and browse to add.</div>';

    const placesHtml = places.length
      ? places.map((p, i) => `
        <div class="tbt-wl-item">
          <div class="tbt-wl-fb">📍</div>
          <div class="tbt-wl-item-name">${escapeHtml(p.name)}${p.region ? ` <span style="color:#64748b;font-weight:400;font-size:0.78rem;">· ${escapeHtml(p.region)}</span>` : ''}</div>
          <button class="tbt-wl-item-x" onclick="tbtWishlist.removePlace(${i})" title="Remove">✕</button>
        </div>`).join('')
      : '<div class="tbt-wl-empty">No specific parks saved yet — pick a place on any region page to add.</div>';

    const animalsHtml = animals.length
      ? animals.map((a, i) => `
        <div class="tbt-wl-item">
          ${a.photo ? `<img src="${a.photo.replace(/"/g,'&quot;')}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"><div class="tbt-wl-fb" style="display:none;">🐾</div>` : `<div class="tbt-wl-fb">🐾</div>`}
          <div class="tbt-wl-item-name">${escapeHtml(a.name)}</div>
          <button class="tbt-wl-item-x" onclick="tbtWishlist.removeAnimal(${i})" title="Remove">✕</button>
        </div>`).join('')
      : '<div class="tbt-wl-empty">No animals saved yet — tap a species on a region page to add.</div>';

    el.innerHTML = `
      <div class="tbt-wl-section">
        <div class="tbt-wl-section-title">🌍 Regions <span style="color:#64748b;font-weight:700;">${regions.length}</span></div>
        ${regionsHtml}
      </div>
      <div class="tbt-wl-section">
        <div class="tbt-wl-section-title">🗺️ Itineraries <span style="color:#64748b;font-weight:700;">${itins.length}</span></div>
        ${itinsHtml}
      </div>
      <div class="tbt-wl-section">
        <div class="tbt-wl-section-title">📍 Parks / Places <span style="color:#64748b;font-weight:700;">${places.length}</span></div>
        ${placesHtml}
      </div>
      <div class="tbt-wl-section">
        <div class="tbt-wl-section-title">🐾 Animals <span style="color:#64748b;font-weight:700;">${animals.length}</span></div>
        ${animalsHtml}
      </div>
    `;
  }

  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function openWishlistModal(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    ensureModal();
    renderContent();
    document.getElementById('tbt-wl-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeWishlistModal() {
    const el = document.getElementById('tbt-wl-overlay');
    if (el) el.classList.remove('open');
    document.body.style.overflow = '';
    const s = document.getElementById('tbt-wl-status');
    if (s) { s.style.display = 'none'; s.className = 'tbt-wl-status'; s.textContent = ''; }
    const submit = document.getElementById('tbt-wl-submit');
    if (submit) { submit.disabled = false; submit.textContent = 'Send to Michael →'; }
  }

  function showStatus(kind, msg) {
    const s = document.getElementById('tbt-wl-status');
    if (!s) return;
    s.className = 'tbt-wl-status ' + kind;
    s.textContent = msg;
    s.style.display = 'block';
  }

  window.tbtWishlist.close       = closeWishlistModal;
  window.tbtWishlist.open        = openWishlistModal;
  window.tbtWishlist.removeRegion = function (idx) {
    const list = load(KEY_REGIONS); list.splice(idx, 1); save(KEY_REGIONS, list); renderContent();
  };
  window.tbtWishlist.removePlace = function (idx) {
    const list = load(KEY_PLACES); list.splice(idx, 1); save(KEY_PLACES, list); renderContent();
  };
  window.tbtWishlist.removeAnimal = function (idx) {
    const list = load(KEY_ANIMALS); list.splice(idx, 1); save(KEY_ANIMALS, list); renderContent();
  };
  window.tbtWishlist.removeItinerary = function (idx) {
    const list = load(KEY_ITINS); list.splice(idx, 1); save(KEY_ITINS, list); renderContent();
  };
  window.tbtWishlist.clearAll = function () {
    if (!confirm('Empty your wishlist? This removes all saved regions, itineraries, places, and animals.')) return;
    save(KEY_REGIONS, []); save(KEY_PLACES, []); save(KEY_ANIMALS, []); save(KEY_ITINS, []);
    renderContent();
    if (typeof renderRegionGrid === 'function') renderRegionGrid();
  };
  window.tbtWishlist.submit = async function () {
    const name  = (document.getElementById('tbt-wl-name').value  || '').trim();
    const email = (document.getElementById('tbt-wl-email').value || '').trim();
    const dates = (document.getElementById('tbt-wl-dates').value || '').trim();
    if (!name || !email) { showStatus('err', 'Please enter your name and email.'); return; }
    const regions = load(KEY_REGIONS);
    const places  = load(KEY_PLACES);
    const animals = load(KEY_ANIMALS);
    const itineraries = load(KEY_ITINS);
    if (!regions.length && !places.length && !animals.length && !itineraries.length) { showStatus('err', 'Your wishlist is empty — add a region, itinerary, place, or animal first.'); return; }
    let realms = {};
    try { realms = JSON.parse(localStorage.getItem('tbt-realm-interests') || '{}'); } catch (e) {}
    const submit = document.getElementById('tbt-wl-submit');
    submit.disabled = true; submit.textContent = 'Sending…';
    try {
      const resp = await fetch('/api/trip-inquiry', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, dates, regions, places, animals, itineraries, realms }),
      });
      const data = await resp.json();
      if (!resp.ok || data.error) throw new Error(data.error || 'Server error');
      showStatus('ok', 'Thanks! Your wishlist is on its way to Michael. He typically responds within a day.');
      submit.textContent = 'Sent ✓';
    } catch (e) {
      showStatus('err', 'Something went wrong — please email MichaelE@transformedbytravels.com directly.');
      submit.disabled = false; submit.textContent = 'Send to Michael →';
    }
  };

  function updateBadges() {
    const c = window.tbtWishlist.counts();
    const total = c.regions + c.places + c.animals + c.itineraries;
    const el = document.getElementById('tbt-wl-badge-total');
    if (!el) return;
    el.textContent = total;
    el.classList.toggle('hidden', total === 0);
  }

  // Also react to changes from other tabs / other widgets on the page
  window.addEventListener('storage',              updateBadges);
  window.addEventListener('tbt-wishlist-changed', updateBadges);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', insertIcons);
  else insertIcons();
})();
