/**
 * dest-picker.js — Shared Destination Picker + DNA Counter
 * Requires: destinations.js (DESTINATIONS array) loaded first
 *
 * Public API:
 *   initDestPicker(options)          — render picker into a container div
 *   dpGetValues(prefix)              — { destination, country, continent, airport, passion }
 *   dpSetValues(prefix, values)      — restore saved selections (e.g. editing a trip)
 *   dpClear(prefix)                  — reset all fields
 *   dnaDecrement(email, profile)     — decrement Airtable DNA counter
 */
(function () {

  // Inject shared styles once
  if (!document.getElementById('dest-picker-styles')) {
    const s = document.createElement('style');
    s.id = 'dest-picker-styles';
    s.textContent = `
      .dp-field-group { margin-bottom: 14px; }
      .dp-label {
        font-family: 'Montserrat', sans-serif; font-weight: 700;
        font-size: 0.78rem; text-transform: uppercase;
        letter-spacing: 0.07em; color: var(--soft, #94a3b8); margin-bottom: 6px;
      }
      .dp-required { color: #f43f5e; }
      .dp-select, .dp-text-input {
        width: 100%;
        background: var(--s2, #1a2535);
        border: 1.5px solid rgba(255,255,255,0.1);
        border-radius: 8px; padding: 11px 14px;
        color: var(--text, #e2e8f0);
        font-family: 'Open Sans', sans-serif; font-size: 0.9rem;
        outline: none; transition: border-color 0.2s;
        box-sizing: border-box;
      }
      .dp-select {
        appearance: none; -webkit-appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%2364748b' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 14px center;
        background-color: var(--s2, #1a2535); padding-right: 36px; cursor: pointer;
      }
      .dp-select:focus, .dp-text-input:focus { border-color: var(--teal, #2dd4bf); }
      .dp-select:disabled { opacity: 0.4; cursor: not-allowed; }
      .dp-airport-row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
      .dp-airport-row .dp-text-input { max-width: 130px; text-transform: uppercase; }
      .dp-hint { font-size: 0.78rem; color: var(--muted, #64748b); }
      .dp-manual-note { font-size: 0.8rem; color: var(--soft, #94a3b8); margin-top: 4px; }
    `;
    document.head.appendChild(s);
  }

  const DP_STATE_COUNTRIES = new Set([
    'United States','Canada','Australia','India','Brazil',
    'Mexico','Argentina','South Africa','Nigeria','Indonesia',
    'Malaysia','Russia','China'
  ]);

  const PASSION_GROUPS = [
    { label: 'Landscapes & Environments', passions: ['Open Spaces','Rainforests & Jungles','Urban Places','Mountains & High Places','Oceans & Coastlines'] },
    { label: 'Adventure & Active',        passions: ['Day Hiking & Trekking','Mountain Climbing','Cycling & Mountain Biking','SCUBA & Marine Exploration','Sailing & Boating','Canoeing, Kayaking & Whitewater','Skiing & Snow Sports','Rock Climbing','Golf','Tennis','Fishing'] },
    { label: 'Nature & Wildlife',         passions: ['Wildlife & Safari','Birding','National Parks'] },
    { label: 'Culture & History',         passions: ['Ancient History & Archaeology','Art & Architecture','Local Traditions & Village Life','Religious & Sacred Sites','Literary & Book Travel','Music & Performing Arts'] },
    { label: 'Food & Drink',              passions: ['Culinary Travel & Street Food','Wine & Vineyards','Craft Beer & Distilleries','Coffee Culture'] },
    { label: 'Wellness & Reflection',     passions: ['Wellness & Spa','Yoga & Meditation','Gardens & Landscapes','Photography'] },
    { label: 'Purpose & Connection',      passions: ['Voluntourism & Service','Pilgrimage','Cultural Immersion','Pet-Friendly Travel'] },
  ];
  const PASSION_LIST = PASSION_GROUPS.flatMap(g => g.passions);

  // ── initDestPicker ─────────────────────────────────────────
  // options:
  //   containerId  — id of the div to render into
  //   idPrefix     — prefix for element ids (default 'dp')
  //   showPassion  — include passion dropdown (default true)
  //   showAirport  — include airport field (default true)
  //   onDestChange — callback({ destination, country, continent, airport, passion })
  window.initDestPicker = function (options) {
    const {
      containerId,
      idPrefix     = 'dp',
      showPassion  = true,
      showAirport  = true,
      onDestChange = null
    } = options;

    const container = document.getElementById(containerId);
    if (!container) return;

    const p = idPrefix;

    const airportHtml = showAirport ? `
      <div class="dp-field-group" id="${p}-airport-wrap">
        <div class="dp-label">
          Airport Code
          <span id="${p}-airport-hint" class="dp-hint"></span>
        </div>
        <div class="dp-airport-row">
          <input id="${p}-airport" type="text" maxlength="4" placeholder="e.g. CDG"
                 class="dp-text-input" oninput="_dpFireCb('${p}')" />
          <a href="https://www.iata.org/en/publications/directories/code-search/"
             target="_blank" class="dp-hint" style="color:var(--teal,#2dd4bf);">Look up code →</a>
        </div>
      </div>` : '';

    const passionHtml = showPassion ? `
      <div class="dp-field-group">
        <div class="dp-label">Passion Focus</div>
        <select id="${p}-passion" class="dp-select" onchange="_dpFireCb('${p}')">
          <option value="">— Any / Auto-select —</option>
          ${PASSION_GROUPS.map(g =>
            `<optgroup label="${g.label}">${g.passions.map(v => `<option value="${v}">${v}</option>`).join('')}</optgroup>`
          ).join('\n          ')}
        </select>
      </div>` : '';

    container.innerHTML = `
      <div class="dp-field-group">
        <div class="dp-label">Continent <span class="dp-required">*</span></div>
        <select id="${p}-continent" class="dp-select" onchange="_dpContinent('${p}')">
          <option value="">— Select Continent —</option>
        </select>
      </div>
      <div class="dp-field-group">
        <div class="dp-label">Country <span class="dp-required">*</span></div>
        <select id="${p}-country" class="dp-select" disabled onchange="_dpCountry('${p}')">
          <option value="">— Select Country —</option>
        </select>
      </div>
      <div class="dp-field-group">
        <div class="dp-label">Destination <span class="dp-required">*</span></div>
        <select id="${p}-dest" class="dp-select" disabled onchange="_dpDest('${p}')">
          <option value="">— Select Destination —</option>
        </select>
      </div>
      <div class="dp-field-group" id="${p}-manual-wrap" style="display:none;">
        <div class="dp-label">Destination Name <span class="dp-required">*</span></div>
        <input id="${p}-manual" type="text" class="dp-text-input"
               placeholder="Enter city, region or place name"
               oninput="_dpFireCb('${p}')" />
        <div class="dp-manual-note">Not in the list — you can still generate your guide.</div>
      </div>
      <div class="dp-field-group" id="${p}-state-wrap" style="display:none;">
        <div class="dp-label">State / Province</div>
        <input id="${p}-state" type="text" class="dp-text-input"
               placeholder="e.g. WI, Ontario, Queensland…"
               oninput="_dpFireCb('${p}')" />
      </div>
      ${airportHtml}
      ${passionHtml}`;

    // Populate continents from shared DESTINATIONS data
    if (typeof DESTINATIONS !== 'undefined') {
      const continents = [...new Set(DESTINATIONS.map(r => r[2]))].sort();
      const sel = document.getElementById(`${p}-continent`);
      continents.forEach(c => {
        const o = document.createElement('option');
        o.value = o.textContent = c;
        sel.appendChild(o);
      });
    }

    window[`_dpCb_${p}`] = onDestChange;
  };

  // ── Cascade handlers ────────────────────────────────────────
  window._dpContinent = function (p) {
    const continent = document.getElementById(`${p}-continent`).value;
    const ctrySel  = document.getElementById(`${p}-country`);
    const destSel  = document.getElementById(`${p}-dest`);
    const manWrap  = document.getElementById(`${p}-manual-wrap`);

    ctrySel.innerHTML = '<option value="">— Select Country —</option>';
    destSel.innerHTML = '<option value="">— Select Destination —</option>';
    destSel.disabled  = true;
    if (manWrap) manWrap.style.display = 'none';

    if (!continent) { ctrySel.disabled = true; return; }

    const countries = [...new Set(
      DESTINATIONS.filter(r => r[2] === continent).map(r => r[1])
    )].sort();
    countries.forEach(c => {
      const o = document.createElement('option');
      o.value = o.textContent = c;
      ctrySel.appendChild(o);
    });
    ctrySel.disabled = false;
  };

  window._dpCountry = function (p) {
    const continent  = document.getElementById(`${p}-continent`).value;
    const country    = document.getElementById(`${p}-country`).value;
    const destSel    = document.getElementById(`${p}-dest`);
    const manWrap    = document.getElementById(`${p}-manual-wrap`);
    const stateWrap  = document.getElementById(`${p}-state-wrap`);
    const stateEl    = document.getElementById(`${p}-state`);

    destSel.innerHTML = '<option value="">— Select Destination —</option>';
    if (manWrap) manWrap.style.display = 'none';
    if (stateWrap) { stateWrap.style.display = 'none'; if (stateEl) stateEl.value = ''; }

    if (!country) { destSel.disabled = true; return; }

    const dests = DESTINATIONS.filter(r => r[2] === continent && r[1] === country);
    dests.forEach(r => {
      const o = document.createElement('option');
      o.value = r[0];
      o.textContent = r[0] + (r[14] ? ' 🏛' : '');
      destSel.appendChild(o);
    });

    // Always offer manual entry at the bottom
    const other = document.createElement('option');
    other.value       = '__other__';
    other.textContent = '✏ Not on list — enter manually';
    destSel.appendChild(other);
    destSel.disabled = false;
  };

  window._dpDest = function (p) {
    const continent  = document.getElementById(`${p}-continent`).value;
    const country    = document.getElementById(`${p}-country`).value;
    const dest       = document.getElementById(`${p}-dest`).value;
    const manWrap    = document.getElementById(`${p}-manual-wrap`);
    const stateWrap  = document.getElementById(`${p}-state-wrap`);
    const stateEl    = document.getElementById(`${p}-state`);
    const airportEl  = document.getElementById(`${p}-airport`);
    const hintEl     = document.getElementById(`${p}-airport-hint`);
    const passionEl  = document.getElementById(`${p}-passion`);

    if (manWrap) manWrap.style.display = dest === '__other__' ? 'block' : 'none';
    if (stateWrap) {
      const showState = dest === '__other__' && DP_STATE_COUNTRIES.has(country);
      stateWrap.style.display = showState ? 'block' : 'none';
      if (!showState && stateEl) stateEl.value = '';
    }

    if (dest && dest !== '__other__') {
      const row = DESTINATIONS.find(r => r[2] === continent && r[1] === country && r[0] === dest);
      if (row) {
        if (airportEl) {
          airportEl.value = row[3] || '';
          if (hintEl) hintEl.textContent = row[3] ? '— auto-filled' : '— please enter';
        }
        // Pre-fill passion only if user hasn't picked one yet
        if (passionEl && !passionEl.value) passionEl.value = Array.isArray(row[6]) ? row[6][0] || '' : row[6] || '';
      }
    } else if (dest === '__other__') {
      if (airportEl) {
        airportEl.value = '';
        if (hintEl) hintEl.textContent = '— enter if known';
      }
    }

    _dpFireCb(p);
  };

  window._dpFireCb = function (p) {
    const cb = window[`_dpCb_${p}`];
    if (typeof cb === 'function') cb(dpGetValues(p));
  };

  // ── Public helpers ───────────────────────────────────────────
  window.dpGetValues = function (p) {
    const v = id => (document.getElementById(id) || {}).value || '';
    const destSel = v(`${p}-dest`);
    let destination = destSel;
    if (destSel === '__other__') {
      const city  = v(`${p}-manual`).trim();
      const state = v(`${p}-state`).trim();
      destination = (city && state) ? `${city}, ${state}` : city;
    }
    return {
      destination,
      country:   v(`${p}-country`),
      continent: v(`${p}-continent`),
      airport:   v(`${p}-airport`).trim().toUpperCase(),
      passion:   v(`${p}-passion`)
    };
  };

  window.dpSetValues = function (p, { continent, country, destination, airport, passion } = {}) {
    const contSel = document.getElementById(`${p}-continent`);
    if (!contSel) return;

    // If no continent (e.g. place not in DESTINATIONS), drop straight to manual entry
    if (!continent) {
      if (destination) {
        const mw = document.getElementById(`${p}-manual-wrap`);
        const mi = document.getElementById(`${p}-manual`);
        if (mw) mw.style.display = 'block';
        if (mi) mi.value = destination;
        const destSel = document.getElementById(`${p}-dest`);
        if (destSel) destSel.value = '__other__';
      }
      return;
    }

    contSel.value = continent;
    _dpContinent(p);

    const ctrySel = document.getElementById(`${p}-country`);
    if (!ctrySel || !country) return;
    ctrySel.value = country;
    _dpCountry(p);

    const destSel = document.getElementById(`${p}-dest`);
    if (!destSel) return;

    const inList = destination && Array.from(destSel.options)
      .some(o => o.value === destination && o.value !== '__other__');

    if (inList) {
      destSel.value = destination;
    } else if (destination) {
      destSel.value = '__other__';
      const mw = document.getElementById(`${p}-manual-wrap`);
      const mi = document.getElementById(`${p}-manual`);
      const sw = document.getElementById(`${p}-state-wrap`);
      const si = document.getElementById(`${p}-state`);
      if (mw) mw.style.display = 'block';
      // Split "City, State" into separate fields for state-needing countries
      if (sw && si && DP_STATE_COUNTRIES.has(country) && destination.includes(',')) {
        const lastComma = destination.lastIndexOf(',');
        const city  = destination.slice(0, lastComma).trim();
        const state = destination.slice(lastComma + 1).trim();
        if (mi) mi.value = city;
        si.value = state;
        sw.style.display = 'block';
      } else {
        if (mi) mi.value = destination;
      }
    }

    const airportEl = document.getElementById(`${p}-airport`);
    if (airportEl && airport) airportEl.value = airport;
    const passionEl = document.getElementById(`${p}-passion`);
    if (passionEl && passion) passionEl.value = passion;
  };

  window.dpClear = function (p) {
    ['continent', 'country', 'dest', 'airport', 'passion', 'manual', 'state'].forEach(field => {
      const el = document.getElementById(`${p}-${field}`);
      if (el) el.value = '';
    });
    const ctrySel = document.getElementById(`${p}-country`);
    if (ctrySel) { ctrySel.innerHTML = '<option value="">— Select Country —</option>'; ctrySel.disabled = true; }
    const destSel = document.getElementById(`${p}-dest`);
    if (destSel) { destSel.innerHTML = '<option value="">— Select Destination —</option>'; destSel.disabled = true; }
    const mw = document.getElementById(`${p}-manual-wrap`);
    if (mw) mw.style.display = 'none';
    const sw = document.getElementById(`${p}-state-wrap`);
    if (sw) sw.style.display = 'none';
    const hint = document.getElementById(`${p}-airport-hint`);
    if (hint) hint.textContent = '';
  };

  // ── DNA Counter ──────────────────────────────────────────────
  // Decrement DNA Guides Remaining + increment DNA Guides To Date in Airtable.
  // Pass localProfile (portalProfile) to avoid an extra GET call when available.
  window.dnaDecrement = async function (email, localProfile) {
    if (!email) return;
    try {
      let toDate, remaining;
      const raw = localProfile && localProfile['DNA Guides Remaining'];

      if (localProfile && (raw !== null && raw !== undefined && raw !== '')) {
        toDate    = Number(localProfile['DNA Guides To Date']    || 0) + 1;
        remaining = Math.max(0, Number(raw) - 1);
      } else {
        const r = await fetch('/api/airtable-traveler?email=' + encodeURIComponent(email));
        const d = await r.json();
        if (!d.record) return;
        const f   = d.record.fields;
        toDate    = Number(f['DNA Guides To Date']    || 0) + 1;
        remaining = Math.max(0, Number(f['DNA Guides Remaining'] || 0) - 1);
      }

      fetch('/api/airtable-traveler', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, dnaQueryUpdate: true, dnaToDate: toDate, dnaRemaining: remaining })
      }).catch(() => {});

      return { toDate, remaining };
    } catch (e) { /* non-blocking */ }
  };

})();
