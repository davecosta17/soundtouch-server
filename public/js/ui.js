import { state }                               from './state.js';
import { pauseMarquees, resumeMarquees }        from './playback.js';
import { hideProgress, applyShuffleRepeat,
         setHeartVisible, setQueueIconVisible,
         dismissUpNext }                      from './spotify.js';

// ── Album art & dynamic background ───────────────────────────────────────────

function extractDominantColor(imgEl) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 24;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(imgEl, 0, 0, 24, 24);
        const data = ctx.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
            const br = (data[i] + data[i+1] + data[i+2]) / 3;
            if (br > 25 && br < 225) { r += data[i]; g += data[i+1]; b += data[i+2]; count++; }
        }
        if (!count) return null;
        return [Math.round(r/count), Math.round(g/count), Math.round(b/count)];
    } catch { return null; }
}

function applyBackground(rgb) {
    const overlay = document.getElementById('bgOverlay');
    if (!rgb) { overlay.style.opacity = '0'; return; }
    const [r, g, b] = rgb;
    const d = x => Math.round(x * 0.35);
    overlay.style.background = `linear-gradient(to bottom, rgb(${d(r)},${d(g)},${d(b)}) 0%, rgb(${d(r)*2},${d(g)*2},${d(b)*2}) 100%)`;
    overlay.style.opacity = '1';
}

function showArtLayout(proxyUrl, s) {
    const img = document.getElementById('artImg');
    img.src = proxyUrl;
    img.onload = () => {
        const rgb = extractDominantColor(img);
        applyBackground(rgb);
    };
    document.getElementById('artSection').style.display = '';
    document.getElementById('npWrap').style.display = 'none';
    document.querySelector('.app').classList.add('art-mode');
    updateArtInfo(s);
}

function showCardLayout() {
    document.getElementById('artSection').style.display = 'none';
    document.getElementById('npWrap').style.display = '';
    document.querySelector('.app').classList.remove('art-mode');
    applyBackground(null);
}

function updateArtInfo(s) {
    const isRadio = s.source === 'wifi' && s.wifiType === 'radio';
    document.getElementById('artTrack').textContent  = s.track || '';
    document.getElementById('artArtist').textContent = isRadio
        ? (s.stationName || s.track || 'Internet Radio')
        : (s.artist || '');
    document.getElementById('artAlbum').textContent  = isRadio ? '' : (s.album || '');
}

// ── Marquee scroll ────────────────────────────────────────────────────────────

export function updateMarquee(el, isPlaying) {
    if (!el) return;
    const wrap = el.parentElement;
    if (!wrap?.classList.contains('marquee-wrap')) return;
    el.classList.remove('scrolling', 'paused');
    el.style.removeProperty('--marquee-dist');
    el.style.removeProperty('--marquee-dur');
    requestAnimationFrame(() => {
        const overflow = el.scrollWidth - wrap.clientWidth;
        if (overflow > 4) {
            const dur = Math.min(16, Math.max(4, overflow / 60));
            el.style.setProperty('--marquee-dist', `-${overflow}px`);
            el.style.setProperty('--marquee-dur',  `${dur}s`);
            el.classList.add('scrolling');
            if (!isPlaying) el.classList.add('paused');
        }
    });
}

// ── Status application ────────────────────────────────────────────────────────

export function applyStatus(s) {
    if (s.error) {
        document.getElementById('offlineBanner').style.display = '';
        return;
    }
    document.getElementById('offlineBanner').style.display = 'none';

    state.currentSource = s.source;
    state.isPlaying     = s.status === 'PLAY_STATE';

    // Play/pause icon
    document.getElementById('iconPlay').style.display  = state.isPlaying ? 'none' : '';
    document.getElementById('iconPause').style.display = state.isPlaying ? '' : 'none';
    state.isPlaying ? resumeMarquees() : pauseMarquees();

    // Power button glow
    document.getElementById('btnPower')?.classList.toggle('on', s.status !== 'STANDBY_STATE');

    // Volume
    if (s.volume !== undefined) setSliderValue(s.volume);
    document.getElementById('muteBtn')?.classList.toggle('muted', !!s.muted);
    document.getElementById('iconMuteOff').style.display = s.muted ? 'none' : '';
    document.getElementById('iconMuteOn').style.display  = s.muted ? '' : 'none';

    // Source tabs
    document.getElementById('tabBluetooth')?.classList.toggle('active', s.source === 'bluetooth');
    document.getElementById('tabAux')?.classList.toggle('active',       s.source === 'aux');
    document.getElementById('tabWifi')?.classList.toggle('active',      s.source === 'wifi');

    // Source label
    const labels = {
        bluetooth: s.bluetoothDevice ? `Bluetooth · ${s.bluetoothDevice}` : 'Bluetooth',
        aux:       'AUX',
        wifi:      s.wifiType === 'spotify' ? 'Spotify Connect'
                 : s.wifiType === 'airplay' ? 'AirPlay'
                 : s.wifiType === 'radio'   ? 'Internet Radio' : 'Wi-Fi',
    };
    document.getElementById('sourceLabel').textContent = labels[s.source] || s.source;

    // Art / card layout
    const isSpotify = s.source === 'wifi' && s.wifiType === 'spotify';
    if (!isSpotify) { hideProgress(); dismissUpNext(); }
    setQueueIconVisible(isSpotify);
    setHeartVisible(isSpotify);

    if (s.artUrl && s.artUrl !== state.lastArtUrl) {
        state.lastArtUrl = s.artUrl;
        const proxyUrl   = `/art-proxy?url=${encodeURIComponent(s.artUrl)}`;
        showArtLayout(proxyUrl, s);
    } else if (!s.artUrl) {
        state.lastArtUrl = null;
        showCardLayout();
    }

    // Now playing card text
    const trackEl  = document.getElementById('npTrack');
    const artistEl = document.getElementById('npArtist');
    const albumEl  = document.getElementById('npAlbum');
    const isRadio  = s.source === 'wifi' && s.wifiType === 'radio';

    if (isRadio) {
        trackEl.textContent  = s.stationName || s.track || 'Internet Radio';
        artistEl.textContent = s.track ? (s.artist || '') : '';
        albumEl.textContent  = '';
    } else if (s.track || s.artist) {
        trackEl.textContent  = s.track  || '';
        artistEl.textContent = s.artist || '';
        albumEl.textContent  = s.album  || '';
    } else if (s.source === 'bluetooth' && s.bluetoothDevice) {
        trackEl.textContent  = s.bluetoothDevice;
        artistEl.textContent = 'Connected via Bluetooth';
        albumEl.textContent  = '';
    } else {
        trackEl.innerHTML    = '<span class="np-idle">—</span>';
        artistEl.textContent = '';
        albumEl.textContent  = '';
    }

    const playing = s.status === 'PLAY_STATE';
    updateMarquee(document.getElementById('npTrack'),  playing);
    updateMarquee(document.getElementById('artTrack'), playing);

    // Always keep art-info text current
    if (s.artUrl) updateArtInfo(s);
}

function setSliderValue(val) {
    const slider = document.getElementById('volumeSlider');
    if (!slider) return;
    slider.value = val;
    const pct = ((val - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

// ── Speaker rename ────────────────────────────────────────────────────────────

export async function fetchSpeakerName() {
    if (state.nameFetched) return;
    try {
        const r = await fetch('/discovery').then(r => r.json());
        if (r.name) document.getElementById('speakerName').textContent = r.name.toUpperCase();
        state.nameFetched = true;
    } catch {}
}

export function startRename() {
    const nameEl = document.getElementById('speakerName');
    const wrap   = document.getElementById('nameEditWrap');
    const input  = document.getElementById('nameInput');
    input.value  = nameEl.textContent;
    nameEl.style.display = 'none';
    wrap.style.display   = '';
    input.focus();
    input.select();
}

export function cancelRename() {
    document.getElementById('speakerName').style.display = '';
    document.getElementById('nameEditWrap').style.display = 'none';
}

export async function commitRename() {
    const input = document.getElementById('nameInput');
    const name  = input.value.trim();
    if (!name) { cancelRename(); return; }
    try {
        const r = await fetch('/name', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        if (r.ok) {
            const data = await r.json();
            document.getElementById('speakerName').textContent = data.name.toUpperCase();
        }
    } catch {}
    cancelRename();
}

// ── Drawer ────────────────────────────────────────────────────────────────────

export function openDrawer() {
    document.getElementById('drawerOverlay').classList.add('open');
    import('./radio.js').then(m => {
        m.loadPresets();
        m.loadStations();
        if (!document.getElementById('countryGrid').querySelector('.country-pill')) {
            m.initCountryGrid();
        }
    });
}

export function closeDrawer(e) {
    if (e && e.target !== document.getElementById('drawerOverlay')) return;
    document.getElementById('drawerOverlay').classList.remove('open');
}

// ── Wi-Fi popover ─────────────────────────────────────────────────────────────

export function toggleWifiPopover() {
    const pop = document.getElementById('wifiPopover');
    const btn = document.getElementById('tabWifi');
    const isOpen = pop.classList.toggle('open');
    if (isOpen) document.addEventListener('click', closeWifiOutside);
}

function closeWifiOutside(e) {
    const pop = document.getElementById('wifiPopover');
    const btn = document.getElementById('tabWifi');
    if (!pop.contains(e.target) && e.target !== btn) {
        pop.classList.remove('open');
        document.removeEventListener('click', closeWifiOutside);
    }
}

export function closeWifiPopover() {
    document.getElementById('wifiPopover').classList.remove('open');
}

export function switchSpotify() {
    closeWifiPopover();
    const spotify = (state.allSources || []).find(s => s.source === 'SPOTIFY' && s.status === 'READY');
    if (spotify) {
        fetch('/source', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'SPOTIFY', sourceAccount: spotify.sourceAccount }),
        });
    }
}

export function openRadioDrawer() {
    closeWifiPopover();
    document.getElementById('drawerOverlay').classList.add('open');
    import('./radio.js').then(m => {
        m.loadPresets();
        m.loadStations();
        if (!document.getElementById('countryGrid').querySelector('.country-pill')) {
            m.initCountryGrid();
        }
    });
    setTimeout(() => {
        const el = document.getElementById('stationsSection');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
}

// ── Up Next flyout (exported for use in spotify.js) ───────────────────────────

// dismissUpNext is defined and exported from spotify.js