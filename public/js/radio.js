import { state } from './state.js';

function closeDrawer() {
    document.getElementById('drawerOverlay')?.classList.remove('open');
}

// ─── Radio icon SVG (shared fallback) ─────────────────────────────────────────
const RADIO_SVG = `<svg class="{cls}" viewBox="0 0 28 25"><rect x="18.5" y="0" width="3" height="8" rx="1.5"/><rect x="0" y="6" width="28" height="19" rx="4"/><circle cx="20" cy="15.5" r="6.5" fill="white" opacity="0.92"/><circle cx="5.5" cy="10.5" r="2" fill="white" opacity="0.92"/><circle cx="5.5" cy="15.5" r="2" fill="white" opacity="0.92"/><circle cx="5.5" cy="20.5" r="2" fill="white" opacity="0.92"/><circle cx="10" cy="10.5" r="2.2" fill="white" opacity="0.92"/><circle cx="10" cy="15.5" r="2.2" fill="white" opacity="0.92"/><circle cx="10" cy="20.5" r="2.2" fill="white" opacity="0.92"/></svg>`;

function radioSvg(cls) { return RADIO_SVG.replace('{cls}', cls); }

// ─── Saved stations ───────────────────────────────────────────────────────────

export async function loadStations() {
    try {
        state.stationsData = await fetch('/stations').then(r => r.json());
        renderStations();
    } catch {
        document.getElementById('stationList').innerHTML = '<li><span class="item-name">Could not load stations</span></li>';
    }
}

export function renderStations() {
    const list = document.getElementById('stationList');
    if (!state.stationsData.length) {
        list.innerHTML = '<li><span class="item-name" style="color:rgba(255,255,255,0.3)">No stations yet — add one below</span></li>';
        return;
    }
    list.innerHTML = state.stationsData.map((s, i) => {
        const logo = s.favicon
            ? `<img class="station-favicon" src="${s.favicon}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" />${radioSvg('station-favicon-fallback').replace('>', ' style="display:none">')}`
            : radioSvg('station-favicon-fallback');
        return `<li class="station-item" data-index="${i}" style="-webkit-tap-highlight-color:transparent">
            <div class="station-logo-wrap">${logo}</div>
            <span class="item-name" data-action="play" data-id="${i}" style="flex:1;cursor:pointer">${s.name}</span>
            <div style="display:flex;align-items:center;gap:4px">
                <div class="item-icon" data-action="play" data-id="${i}" style="cursor:pointer">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </div>
                <button class="delete-btn" data-action="preset" data-name="${s.name.replace(/"/g,'&quot;')}" data-url="${s.url}" title="Save to preset">
                    <svg viewBox="0 0 24 24"><path d="M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm0 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z"/></svg>
                </button>
                <button class="delete-btn" data-action="delete" data-id="${i}" title="Remove">
                    <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
                <div class="drag-handle" data-action="drag" data-id="${i}" title="Drag to reorder">
                    <svg viewBox="0 0 24 24"><path d="M9 3h2v2H9zm4 0h2v2h-2zM9 7h2v2H9zm4 0h2v2h-2zM9 11h2v2H9zm4 0h2v2h-2zM9 15h2v2H9zm4 0h2v2h-2zM9 19h2v2H9zm4 0h2v2h-2z"/></svg>
                </div>
            </div>
        </li>`;
    }).join('');

    // Event delegation on the list
    list.addEventListener('click', handleStationClick);
}

function handleStationClick(e) {
    const action = e.target.closest('[data-action]')?.dataset;
    if (!action) return;
    if (action.action === 'play')   { playStation(parseInt(action.id)); }
    if (action.action === 'delete') { e.stopPropagation(); deleteStation(parseInt(action.id)); }
    if (action.action === 'preset') { e.stopPropagation(); showPresetPicker(action.name, action.url, null); }
    if (action.action === 'drag')   { /* handled by touchstart/mousedown below */ }
}

async function playStation(id) {
    closeDrawer();
    await fetch(`/radio/${id}`);
}

async function saveStationsOrder() {
    try {
        await fetch('/stations', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state.stationsData),
        });
    } catch {}
}

export async function addStation() {
    const name = document.getElementById('stationNameInput').value.trim();
    const url  = document.getElementById('stationUrlInput').value.trim();
    if (!name || !url) { alert('Please enter both a name and a stream URL.'); return; }
    try {
        const res = await fetch('/stations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, url }),
        });
        if (!res.ok) { alert(await res.text()); return; }
        document.getElementById('stationNameInput').value = '';
        document.getElementById('stationUrlInput').value  = '';
        await loadStations();
    } catch { alert('Could not save station.'); }
}

async function deleteStation(id) {
    if (!confirm('Remove this station?')) return;
    try { await fetch(`/stations/${id}`, { method: 'DELETE' }); await loadStations(); }
    catch { alert('Could not delete station.'); }
}

// ─── Drag-to-reorder ──────────────────────────────────────────────────────────

export function initDragHandlers() {
    const list = document.getElementById('stationList');
    list.addEventListener('mousedown',  e => { if (e.target.closest('[data-action="drag"]')) dragStart(e, parseInt(e.target.closest('[data-action]').dataset.id)); });
    list.addEventListener('touchstart', e => { if (e.target.closest('[data-action="drag"]')) dragStart(e, parseInt(e.target.closest('[data-action]').dataset.id)); }, { passive: false });
}

function dragStart(e, idx) {
    state.dragSrcIdx = idx;
    const li   = document.querySelector(`.station-item[data-index="${idx}"]`);
    if (!li) return;
    const rect   = li.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    state.dragOffsetX = clientX - rect.left;
    state.dragOffsetY = clientY - rect.top;

    state.dragGhost = document.createElement('div');
    state.dragGhost.className = 'drag-ghost';
    state.dragGhost.textContent = state.stationsData[idx]?.name || '';
    state.dragGhost.style.left  = rect.left + 'px';
    state.dragGhost.style.top   = rect.top  + 'px';
    state.dragGhost.style.width = rect.width + 'px';
    document.body.appendChild(state.dragGhost);
    li.classList.add('dragging');

    if (e.touches) {
        document.addEventListener('touchmove', dragMove, { passive: false });
        document.addEventListener('touchend',  dragEnd,  { once: true });
    } else {
        document.addEventListener('mousemove', dragMove);
        document.addEventListener('mouseup',   dragEnd, { once: true });
    }
    e.preventDefault();
}

function dragMove(e) {
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    if (state.dragGhost) {
        state.dragGhost.style.left = (clientX - state.dragOffsetX) + 'px';
        state.dragGhost.style.top  = (clientY - state.dragOffsetY) + 'px';
    }
    document.querySelectorAll('.station-item').forEach(li => li.classList.remove('drag-over'));
    const el = document.elementFromPoint(clientX, clientY)?.closest('.station-item');
    if (el && el.dataset.index != state.dragSrcIdx) el.classList.add('drag-over');
    e.preventDefault();
}

function dragEnd(e) {
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('mousemove', dragMove);
    const clientX = e.touches ? e.changedTouches[0].clientX : e.clientX;
    const clientY = e.touches ? e.changedTouches[0].clientY : e.clientY;
    const target  = document.elementFromPoint(clientX, clientY)?.closest('.station-item');
    const destIdx = target ? parseInt(target.dataset.index) : null;
    if (state.dragGhost) { state.dragGhost.remove(); state.dragGhost = null; }
    document.querySelectorAll('.station-item').forEach(li => li.classList.remove('dragging', 'drag-over'));
    if (destIdx !== null && destIdx !== state.dragSrcIdx) {
        const item = state.stationsData.splice(state.dragSrcIdx, 1)[0];
        state.stationsData.splice(destIdx, 0, item);
        renderStations();
        saveStationsOrder();
    }
    state.dragSrcIdx = null;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export async function loadPresets() {
    try {
        const xml    = await fetch('/presets').then(r => r.text());
        const parser = new DOMParser();
        const doc    = parser.parseFromString(xml, 'text/xml');
        state.presetsData = Array(6).fill(null);
        doc.querySelectorAll('preset').forEach(p => {
            const id   = parseInt(p.getAttribute('id'), 10) - 1;
            const item = p.querySelector('ContentItem');
            if (id >= 0 && id < 6 && item) {
                state.presetsData[id] = {
                    name:   item.querySelector('itemName')?.textContent || 'Preset ' + (id + 1),
                    source: item.getAttribute('source') || '',
                };
            }
        });
        renderPresets();
    } catch { renderPresets(); }
}

function renderPresets() {
    const grid = document.getElementById('presetGrid');
    if (!grid) return;
    grid.innerHTML = state.presetsData.map((p, i) =>
        p ? `<button class="preset-tile filled" data-preset="${i+1}" title="${p.name}">
                 <span class="preset-tile-name">${p.name}</span>
                 <span class="preset-tile-num">${i+1}</span>
             </button>`
          : `<button class="preset-tile" data-preset-empty="${i+1}" title="Save to preset ${i+1}">
                 <span class="preset-tile-plus">+</span>
                 <span class="preset-tile-num">${i+1}</span>
             </button>`
    ).join('');

    grid.querySelectorAll('[data-preset]').forEach(btn => {
        btn.addEventListener('click', () => { fetch(`/preset/${btn.dataset.preset}`); closeDrawer(); });
    });
    grid.querySelectorAll('[data-preset-empty]').forEach(btn => {
        btn.addEventListener('click', () => showPresetPicker(null, null, parseInt(btn.dataset.presetEmpty)));
    });
}

function showPresetPicker(stationName, stationUrl, preSelectSlot) {
    const existing = document.getElementById('presetPickerOverlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'presetPickerOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:500;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:#222;border-radius:16px;padding:22px 18px;width:80%;max-width:300px';
    const title = document.createElement('div');
    title.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:0.95rem;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);margin-bottom:14px";
    title.textContent = stationName ? 'Save to Preset' : 'Choose Preset Slot';
    box.appendChild(title);
    const pgrid = document.createElement('div');
    pgrid.style.cssText = 'display:grid;grid-template-columns:repeat(6,1fr);gap:8px;margin-bottom:18px';
    state.presetsData.forEach((p, i) => {
        const btn = document.createElement('button');
        btn.style.cssText = 'aspect-ratio:1/1;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.07);cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:4px;-webkit-tap-highlight-color:transparent';
        btn.innerHTML = p
            ? `<span style="font-size:0.55rem;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:rgba(255,255,255,0.7);text-align:center;line-height:1.1;word-break:break-word">${p.name}</span>`
            : `<span style="font-size:1.1rem;color:rgba(255,255,255,0.25)">+</span>`;
        btn.innerHTML += `<span style="font-size:0.55rem;font-family:'Barlow Condensed',sans-serif;color:rgba(255,255,255,0.3)">${i+1}</span>`;
        if (preSelectSlot === i + 1) btn.style.borderColor = '#0066ff';
        btn.addEventListener('click', () => {
            overlay.remove();
            if (stationName && stationUrl) commitSaveToPreset(i + 1, stationName, stationUrl);
        });
        pgrid.appendChild(btn);
    });
    box.appendChild(pgrid);
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = 'width:100%;padding:11px 0;border-radius:10px;border:none;background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.7);font-family:"Barlow Condensed",sans-serif;font-size:0.85rem;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer';
    cancel.addEventListener('click', () => overlay.remove());
    box.appendChild(cancel);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
}

async function commitSaveToPreset(num, name, url) {
    try {
        await fetch('/preset/store', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ num, name, url }),
        });
        await loadPresets();
    } catch {}
}

// ─── Radio Browser ────────────────────────────────────────────────────────────

const COUNTRIES = [
    ['Afghanistan','AF'],['Albania','AL'],['Algeria','DZ'],['Angola','AO'],['Argentina','AR'],
    ['Armenia','AM'],['Australia','AU'],['Austria','AT'],['Azerbaijan','AZ'],['Bahrain','BH'],
    ['Bangladesh','BD'],['Belarus','BY'],['Belgium','BE'],['Benin','BJ'],['Bolivia','BO'],
    ['Bosnia','BA'],['Botswana','BW'],['Brazil','BR'],['Bulgaria','BG'],['Burkina Faso','BF'],
    ['Burundi','BI'],['Cambodia','KH'],['Cameroon','CM'],['Canada','CA'],['Chad','TD'],
    ['Chile','CL'],['China','CN'],['Colombia','CO'],['Congo','CG'],['Costa Rica','CR'],
    ['Croatia','HR'],['Cuba','CU'],['Cyprus','CY'],['Czech Republic','CZ'],['Denmark','DK'],
    ['Dominican Republic','DO'],['DR Congo','CD'],['Ecuador','EC'],['Egypt','EG'],
    ['El Salvador','SV'],['Estonia','EE'],['Ethiopia','ET'],['Finland','FI'],['France','FR'],
    ['Gabon','GA'],['Gambia','GM'],['Georgia','GE'],['Germany','DE'],['Ghana','GH'],
    ['Greece','GR'],['Guatemala','GT'],['Guinea','GN'],["Côte d'Ivoire",'CI'],['Haiti','HT'],
    ['Honduras','HN'],['Hungary','HU'],['Iceland','IS'],['India','IN'],['Indonesia','ID'],
    ['Iran','IR'],['Iraq','IQ'],['Ireland','IE'],['Israel','IL'],['Italy','IT'],
    ['Jamaica','JM'],['Japan','JP'],['Jordan','JO'],['Kazakhstan','KZ'],['Kenya','KE'],
    ['Kosovo','XK'],['Kuwait','KW'],['Latvia','LV'],['Lebanon','LB'],['Liberia','LR'],
    ['Libya','LY'],['Lithuania','LT'],['Luxembourg','LU'],['Madagascar','MG'],['Malawi','MW'],
    ['Malaysia','MY'],['Mali','ML'],['Malta','MT'],['Mauritania','MR'],['Mauritius','MU'],
    ['Mexico','MX'],['Moldova','MD'],['Morocco','MA'],['Mozambique','MZ'],['Myanmar','MM'],
    ['Namibia','NA'],['Nepal','NP'],['Netherlands','NL'],['New Zealand','NZ'],['Nicaragua','NI'],
    ['Niger','NE'],['Nigeria','NG'],['North Macedonia','MK'],['Norway','NO'],['Oman','OM'],
    ['Pakistan','PK'],['Palestine','PS'],['Panama','PA'],['Paraguay','PY'],['Peru','PE'],
    ['Philippines','PH'],['Poland','PL'],['Portugal','PT'],['Qatar','QA'],['Romania','RO'],
    ['Russia','RU'],['Rwanda','RW'],['Saudi Arabia','SA'],['Senegal','SN'],['Serbia','RS'],
    ['Sierra Leone','SL'],['Singapore','SG'],['Slovakia','SK'],['Slovenia','SI'],
    ['Somalia','SO'],['South Africa','ZA'],['South Korea','KR'],['South Sudan','SS'],
    ['Spain','ES'],['Sri Lanka','LK'],['Sudan','SD'],['Sweden','SE'],['Switzerland','CH'],
    ['Syria','SY'],['Taiwan','TW'],['Tanzania','TZ'],['Thailand','TH'],['Togo','TG'],
    ['Trinidad','TT'],['Tunisia','TN'],['Turkey','TR'],['Uganda','UG'],['Ukraine','UA'],
    ['United Arab Emirates','AE'],['United Kingdom','GB'],['United States','US'],
    ['Uruguay','UY'],['Uzbekistan','UZ'],['Venezuela','VE'],['Vietnam','VN'],['Yemen','YE'],
    ['Zambia','ZM'],['Zimbabwe','ZW'],
];

export function initCountryGrid() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            async pos => {
                try {
                    const { latitude: lat, longitude: lon } = pos.coords;
                    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
                        { headers: { 'Accept-Language': 'en' } }).then(r => r.json());
                    const code = r.address?.country_code?.toUpperCase();
                    if (code) state.detectedCountryCode = code;
                } catch {}
                renderCountryGrid();
            },
            () => renderCountryGrid()
        );
    } else {
        renderCountryGrid();
    }
}

function renderCountryGrid() {
    const grid   = document.getElementById('countryGrid');
    const sorted = [...COUNTRIES].sort((a, b) => {
        if (a[1] === state.detectedCountryCode) return -1;
        if (b[1] === state.detectedCountryCode) return 1;
        return a[0].localeCompare(b[0]);
    });
    grid.innerHTML = sorted.map(([name, code]) => {
        const det = code === state.detectedCountryCode;
        const sel = code === state.selectedCountryCode;
        return `<button class="country-pill${det ? ' country-detected' : ''}${sel ? ' selected' : ''}"
            data-code="${code}" data-name="${name.replace(/"/g, '&quot;')}">
            ${name}${det ? ' 📍' : ''}
        </button>`;
    }).join('');

    grid.querySelectorAll('.country-pill').forEach(btn => {
        btn.addEventListener('click', () => selectCountry(btn.dataset.code, btn.dataset.name, btn));
    });
}

function selectCountry(code, name, btn) {
    if (state.selectedCountryCode === code) {
        state.selectedCountryCode = null;
        document.querySelectorAll('.country-pill').forEach(p => p.classList.remove('selected'));
        document.getElementById('rbSearchInput').placeholder = 'Search stations…';
        return;
    }
    state.selectedCountryCode = code;
    document.querySelectorAll('.country-pill').forEach(p => p.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('rbSearchInput').placeholder = `Search in ${name}…`;
}

export async function rbSearch() {
    const q = document.getElementById('rbSearchInput').value.trim();
    if (!q) return;
    const btn     = document.getElementById('rbSearchBtn');
    const results = document.getElementById('rbResults');
    const divider = document.getElementById('rbDivider');
    btn.disabled = true; btn.textContent = '…';
    results.innerHTML = '<ul class="sheet-list"><li><span class="item-name" style="color:rgba(255,255,255,0.35)">Searching…</span></li></ul>';
    divider.style.display = 'none';
    state.rbActiveIdx = null;
    try {
        const countryParam = state.selectedCountryCode ? `&country=${state.selectedCountryCode}` : '';
        state.rbData = await fetch(`/radio-browser/search?q=${encodeURIComponent(q)}${countryParam}`).then(r => r.json());
        if (!state.rbData.length) {
            results.innerHTML = '<ul class="sheet-list"><li><span class="item-name" style="color:rgba(255,255,255,0.35)">No results found</span></li></ul>';
        } else {
            rbRender();
            divider.style.display = '';
        }
    } catch {
        results.innerHTML = '<ul class="sheet-list"><li><span class="item-name" style="color:rgba(255,255,255,0.35)">Search failed — check connection</span></li></ul>';
    } finally {
        btn.disabled = false; btn.textContent = 'Search';
    }
}

function rbRender() {
    const results = document.getElementById('rbResults');
    results.innerHTML = `<ul class="sheet-list">${state.rbData.map((r, i) => {
        const meta    = [r.country, r.codec && r.bitrate ? `${r.codec} · ${r.bitrate} kbps` : null].filter(Boolean).join(' · ');
        const isOpen  = state.rbActiveIdx === i;
        const favicon = r.favicon
            ? `<img class="rb-favicon" src="${r.favicon}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='block'" />${radioSvg('rb-favicon-fallback').replace('>', ' style="display:none">')}`
            : radioSvg('rb-favicon-fallback');
        return `<li>
            <div class="rb-result-main" data-rb-toggle="${i}">
                <div class="rb-logo-wrap">${favicon}</div>
                <div class="rb-result-info">
                    <div class="rb-result-name">${r.name}</div>
                    ${meta ? `<div class="rb-result-meta">${meta}</div>` : ''}
                </div>
                <div class="rb-chevron ${isOpen ? 'open' : ''}">
                    <svg viewBox="0 0 24 24"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/></svg>
                </div>
            </div>
            <div class="rb-actions ${isOpen ? 'open' : ''}" id="rbA${i}">
                <button class="rb-action-btn play" data-rb-play="${i}">▶ Play Now</button>
                <button class="rb-action-btn save" data-rb-save="${i}">+ Save</button>
            </div>
        </li>`;
    }).join('')}</ul>`;

    results.querySelectorAll('[data-rb-toggle]').forEach(el =>
        el.addEventListener('click', () => rbToggle(parseInt(el.dataset.rbToggle))));
    results.querySelectorAll('[data-rb-play]').forEach(el =>
        el.addEventListener('click', () => rbPlayFrom(state.rbData, parseInt(el.dataset.rbPlay), `rbA${el.dataset.rbPlay}`)));
    results.querySelectorAll('[data-rb-save]').forEach(el =>
        el.addEventListener('click', () => rbSaveFrom(state.rbData, parseInt(el.dataset.rbSave), `rbA${el.dataset.rbSave}`)));
}

function rbToggle(i) {
    state.rbActiveIdx = state.rbActiveIdx === i ? null : i;
    rbRender();
}

async function rbPlayFrom(data, i) {
    const r = data[i];
    if (!r) return;
    closeDrawer();
    try {
        await fetch('/radio-browser/play', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ streamUrl: r.streamUrl, name: r.name, favicon: r.favicon || '' }),
        });
    } catch {}
}

async function rbSaveFrom(data, i, actionsId) {
    const r   = data[i];
    if (!r) return;
    const btn = document.querySelector(`#${actionsId} .save`);
    if (btn) { btn.textContent = '…'; btn.disabled = true; }
    try {
        const res = await fetch('/stations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: r.name, url: r.streamUrl, favicon: r.favicon || '' }),
        });
        if (res.ok) { if (btn) btn.textContent = '✓ Saved'; await loadStations(); }
        else { if (btn) { btn.textContent = '+ Save'; btn.disabled = false; } }
    } catch {
        if (btn) { btn.textContent = '+ Save'; btn.disabled = false; }
    }
}