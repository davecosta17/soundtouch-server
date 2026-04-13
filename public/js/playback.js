import { state } from './state.js';

// ── API helper ────────────────────────────────────────────────────────────────

export async function api(endpoint) {
    try { await fetch(`/${endpoint}`); } catch {}
}

// ── Transport ─────────────────────────────────────────────────────────────────

export function togglePlay() { api(state.isPlaying ? 'pause' : 'play'); }

export function handleBluetoothTab() { switchSource('BLUETOOTH', ''); }

export async function switchSource(source, sourceAccount) {
    const body = { source, sourceAccount };
    if (source === 'SPOTIFY') {
        const sp = (state.allSources || []).find(s => s.source === 'SPOTIFY' && s.status === 'READY');
        if (sp) body.sourceAccount = sp.sourceAccount;
    }
    try {
        await fetch('/source', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch {}
}

// ── Volume ────────────────────────────────────────────────────────────────────

export function onVolumeInput(val) {
    const slider = document.getElementById('volumeSlider');
    const pct = ((val - slider.min) / (slider.max - slider.min)) * 100;
    slider.style.setProperty('--pct', pct + '%');
}

export function setVolume(val) { api(`volume/${val}`); }

// ── Mute ──────────────────────────────────────────────────────────────────────

export function toggleMute() {
    state.isMuted = !state.isMuted;
    document.getElementById('iconMuteOff').style.display = state.isMuted ? 'none' : '';
    document.getElementById('iconMuteOn').style.display  = state.isMuted ? '' : 'none';
    api('mute');
}

// ── Marquee pause/resume (called from applyStatus in ui.js) ───────────────────

export function pauseMarquees() {
    document.querySelectorAll('.marquee-inner.scrolling').forEach(el => el.classList.add('paused'));
}

export function resumeMarquees() {
    document.querySelectorAll('.marquee-inner.scrolling').forEach(el => el.classList.remove('paused'));
}