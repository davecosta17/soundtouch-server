import { state }       from './state.js';

// ── Progress bar ──────────────────────────────────────────────────────────────

export function fmtMs(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function applyProgress(msg) {
    if (msg.clear) { hideProgress(); return; }

    state.spProgressMs = msg.progress_ms  || 0;
    state.spDurationMs = msg.duration_ms  || 0;
    state.spIsPlaying  = msg.is_playing;

    document.getElementById('spProgressWrap').classList.add('visible');
    document.getElementById('sourceRow').style.display = 'none';

    clearInterval(state.spTickInterval);
    if (state.spIsPlaying) {
        state.spTickInterval = setInterval(() => {
            state.spProgressMs = Math.min(state.spProgressMs + 1000, state.spDurationMs);
            renderProgress();
        }, 1000);
    }
    renderProgress();

    if (msg.shuffle_state !== undefined) applyShuffleRepeat(msg.shuffle_state, msg.repeat_state || 'off');
    checkUpNext(msg.progress_ms, msg.duration_ms, msg.next_track);

    if (msg.track_id && msg.track_id !== state.currentTrackId) {
        state.currentTrackId = msg.track_id;
        fetchLikedStatus(state.currentTrackId);
    }
}

function renderProgress() {
    const pct = state.spDurationMs > 0 ? (state.spProgressMs / state.spDurationMs) * 100 : 0;
    document.getElementById('spBarFill').style.width    = pct.toFixed(2) + '%';
    document.getElementById('spElapsed').textContent    = fmtMs(state.spProgressMs);
    document.getElementById('spDuration').textContent   = fmtMs(state.spDurationMs);
}

export function hideProgress() {
    clearInterval(state.spTickInterval);
    state.spTickInterval = null;
    state.spProgressMs = state.spDurationMs = 0;
    document.getElementById('spProgressWrap').classList.remove('visible');
    document.getElementById('sourceRow').style.display = '';
}

export async function spSeek(e) {
    if (!state.spDurationMs) return;
    const bar  = document.getElementById('spBarRow');
    const rect = bar.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const position_ms = Math.round(pct * state.spDurationMs);
    document.getElementById('spBarFill').style.transition = 'none';
    state.spProgressMs = position_ms;
    renderProgress();
    setTimeout(() => document.getElementById('spBarFill').style.transition = 'width 1s linear', 50);
    try {
        await fetch('/spotify/seek', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ position_ms }),
        });
    } catch {}
}

// ── Shuffle / Repeat ──────────────────────────────────────────────────────────

export function applyShuffleRepeat(shuffle, repeat) {
    state.shuffleOn  = shuffle;
    state.repeatMode = repeat;
    document.getElementById('btnShuffle')?.classList.toggle('active', shuffle);
    const btnRepeat = document.getElementById('btnRepeat');
    if (btnRepeat) {
        btnRepeat.classList.toggle('active', repeat !== 'off');
        const all = document.getElementById('iconRepeatAll');
        const one = document.getElementById('iconRepeatOne');
        if (all && one) {
            all.style.display = repeat === 'track' ? 'none' : '';
            one.style.display = repeat === 'track' ? ''     : 'none';
        }
    }
}

export function toggleShuffle() {
    state.shuffleOn = !state.shuffleOn;
    document.getElementById('btnShuffle')?.classList.toggle('active', state.shuffleOn);
    fetch(`/shuffle/${state.shuffleOn ? 'on' : 'off'}`);
}

export function cycleRepeat() {
    const next = { off: 'all', all: 'one', one: 'off' };
    state.repeatMode = next[state.repeatMode] || 'off';
    applyShuffleRepeat(state.shuffleOn, state.repeatMode);
    const map = { off: 'off', all: 'all', one: 'one' };
    fetch(`/repeat/${map[state.repeatMode]}`);
}

// ── Liked Songs ───────────────────────────────────────────────────────────────

export async function fetchLikedStatus(trackId) {
    if (!trackId) return;
    try {
        const r = await fetch(`/spotify/liked?id=${trackId}`).then(r => r.json());
        state.isLiked = r.liked;
        document.getElementById('btnHeart')?.classList.toggle('liked', state.isLiked);
    } catch {}
}

export async function toggleLike() {
    if (!state.currentTrackId) return;
    state.isLiked = !state.isLiked;
    document.getElementById('btnHeart')?.classList.toggle('liked', state.isLiked);
    try {
        await fetch('/spotify/like', {
            method: state.isLiked ? 'POST' : 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: state.currentTrackId }),
        });
    } catch {
        state.isLiked = !state.isLiked;
        document.getElementById('btnHeart')?.classList.toggle('liked', state.isLiked);
    }
}

export function setHeartVisible(visible) {
    document.getElementById('btnHeart')?.classList.toggle('visible', visible);
    if (!visible) {
        state.currentTrackId = null;
        state.isLiked = false;
        document.getElementById('btnHeart')?.classList.remove('liked');
    }
}

// ── Queue drawer ──────────────────────────────────────────────────────────────

export function setQueueIconVisible(visible) {
    document.getElementById('btnQueue')?.classList.toggle('visible', visible);
}

export async function openQueueDrawer() {
    document.getElementById('queueOverlay').classList.add('open');
    const list = document.getElementById('queueList');
    list.innerHTML = '<div style="padding:24px 20px;color:rgba(255,255,255,0.3);font-family:Barlow,sans-serif;font-size:0.85rem">Loading…</div>';

    await fetchSpStatus();

    if (!state.spStatus.hasClientId) {
        list.innerHTML = `
            <div class="sp-setup-card">
                <div class="sp-setup-card-icon">
                    <svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
                </div>
                <h3>Connect Spotify</h3>
                <p>Set up Spotify to unlock queue, progress bar, liked songs, and more.</p>
                <div class="sp-setup-nudge">
                    <div class="sp-setup-nudge-item"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>Progress bar &amp; seek</div>
                    <div class="sp-setup-nudge-item"><svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z"/></svg>Queue &amp; Up Next</div>
                    <div class="sp-setup-nudge-item"><svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>Liked Songs</div>
                    <div class="sp-setup-nudge-item"><svg viewBox="0 0 24 24"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>Up Next flyout</div>
                </div>
                <button class="sp-connect-btn" id="queueSetupBtn">Connect Spotify</button>
            </div>`;
        document.getElementById('queueSetupBtn')?.addEventListener('click', () => {
            closeQueueDrawer();
            openSpWizard();
        });
        return;
    }

    if (!state.spStatus.connected) {
        list.innerHTML = `
            <div class="sp-setup-card">
                <div class="sp-setup-card-icon">
                    <svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>
                </div>
                <h3>Authorisation Needed</h3>
                <p>Your Spotify credentials are saved but the app needs to be authorised.</p>
                <button class="sp-connect-btn" id="queueReauthBtn">Sign in with Spotify</button>
                <button class="sp-reauth-btn" id="queueChangeCredBtn">Change Credentials</button>
            </div>`;
        document.getElementById('queueReauthBtn')?.addEventListener('click', spAuthorise);
        document.getElementById('queueChangeCredBtn')?.addEventListener('click', () => {
            closeQueueDrawer(); openSpWizard();
        });
        return;
    }

    try {
        state.queueData = await fetch('/spotify/queue').then(r => r.json());
        if (!state.queueData.length) {
            list.innerHTML = '<div style="padding:24px 20px;color:rgba(255,255,255,0.3);font-family:Barlow,sans-serif;font-size:0.85rem">Queue is empty</div>';
            return;
        }
        list.innerHTML = state.queueData.map((t, i) => `
            <div class="queue-item" data-idx="${i}">
                <span class="queue-item-num">${i + 1}</span>
                <img class="queue-item-art" src="${t.artUrl || ''}" alt="" onerror="this.style.opacity=0" />
                <div class="queue-item-info">
                    <div class="queue-item-name">${t.name}</div>
                    <div class="queue-item-artist">${t.artist}</div>
                </div>
            </div>`).join('');
        list.querySelectorAll('.queue-item').forEach(el => {
            el.addEventListener('click', () => confirmSkip(
                parseInt(el.dataset.idx) + 1,
                state.queueData[el.dataset.idx]?.name || ''
            ));
        });
    } catch {
        list.innerHTML = '<div style="padding:24px 20px;color:rgba(255,255,255,0.3);font-family:Barlow,sans-serif;font-size:0.85rem">Could not load queue</div>';
    }
}

export function closeQueueDrawer(e) {
    if (e && e.target !== document.getElementById('queueOverlay')) return;
    document.getElementById('queueOverlay').classList.remove('open');
}

function confirmSkip(numSkips, trackName) {
    state.queueConfirmSkips = numSkips;
    const msg = numSkips === 1 ? `Skip to "${trackName}"?` : `Skip ${numSkips} tracks to "${trackName}"?`;
    document.getElementById('queueConfirmMsg').textContent = msg;
    document.getElementById('queueConfirm').classList.add('open');
}

export function closeQueueConfirm() {
    document.getElementById('queueConfirm').classList.remove('open');
}

export async function executeSkip() {
    closeQueueConfirm();
    closeQueueDrawer();
    for (let i = 0; i < state.queueConfirmSkips; i++) {
        await fetch('/next');
        if (i < state.queueConfirmSkips - 1) await new Promise(r => setTimeout(r, 600));
    }
}

// ── Up Next flyout ────────────────────────────────────────────────────────────

export function dismissUpNext() {
    document.getElementById('upnextFlyout').classList.remove('show');
    clearTimeout(state.upnextTimer);
}

function showUpNext(track) {
    if (!track) return;
    document.getElementById('upnextArt').src            = track.artUrl || '';
    document.getElementById('upnextName').textContent   = track.name;
    document.getElementById('upnextArtist').textContent = track.artist;
    document.getElementById('upnextFlyout').classList.add('show');
    clearTimeout(state.upnextTimer);
    state.upnextTimer = setTimeout(dismissUpNext, 5000);
}

function checkUpNext(progressMs, durationMs, nextTrack) {
    if (!durationMs) return;
    const remaining  = durationMs - progressMs;
    const threshold  = 20_000;
    if (remaining > threshold + 5000) state.upnextShown = false;
    if (!nextTrack || !remaining || state.upnextShown) return;
    if (remaining <= threshold && remaining > 0) {
        const key = nextTrack.name + nextTrack.artist;
        if (key !== state.lastNextTrack) {
            state.lastNextTrack = key;
            state.upnextShown   = true;
            showUpNext(nextTrack);
        }
    }
}

// ── Spotify setup wizard ──────────────────────────────────────────────────────

export async function fetchSpStatus() {
    try { state.spStatus = await fetch('/spotify/status').then(r => r.json()); } catch {}
    return state.spStatus;
}

export function openSpWizard() {
    state.spWizardStep = 0;
    spWizardRender();
    document.getElementById('spWizardOverlay').classList.add('open');
    const uri = `http://${state.spServerIp}:3000/spotify/callback`;
    document.getElementById('spRedirectUriDisplay').textContent = uri;
}

export function closeSpWizard() {
    document.getElementById('spWizardOverlay').classList.remove('open');
}

function spWizardRender() {
    document.querySelectorAll('.sp-wizard-step').forEach((s, i) =>
        s.classList.toggle('active', i === state.spWizardStep));
    document.querySelectorAll('.sp-wizard-step-dot').forEach((d, i) => {
        d.classList.toggle('done',   i < state.spWizardStep);
        d.classList.toggle('active', i === state.spWizardStep);
    });
}

export function spWizardNext() {
    if (state.spWizardStep < 3) { state.spWizardStep++; spWizardRender(); }
}

export function spWizardBack() {
    if (state.spWizardStep > 0) { state.spWizardStep--; spWizardRender(); }
}

export function copyRedirectUri() {
    const uri = document.getElementById('spRedirectUriDisplay').textContent;
    navigator.clipboard?.writeText(uri).then(() => {
        const btn = document.querySelector('.sp-copy-btn');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); }
    });
}

export async function spSaveCredentials() {
    const clientId     = document.getElementById('spClientId').value.trim();
    const clientSecret = document.getElementById('spClientSecret').value.trim();
    const errEl        = document.getElementById('spSaveError');
    const saveBtn      = document.getElementById('spSaveBtn');
    if (!clientId || !clientSecret) {
        errEl.textContent = 'Both fields are required.';
        errEl.style.display = 'block'; return;
    }
    errEl.style.display = 'none';
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
        const r = await fetch('/setup/spotify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, clientSecret }),
        });
        if (!r.ok) throw new Error(await r.text());
        const data = await r.json();
        document.getElementById('spRedirectUriDisplay').textContent = data.redirectUri;
        spWizardNext();
    } catch (err) {
        errEl.textContent = 'Could not save: ' + err.message;
        errEl.style.display = 'block';
    } finally {
        saveBtn.disabled = false; saveBtn.textContent = 'Save & Continue';
    }
}

export function spAuthorise() {
    window.open('/spotify/login', '_blank');
    closeSpWizard();
    let attempts = 0;
    const poll = setInterval(async () => {
        attempts++;
        const status = await fetch('/spotify/status').then(r => r.json()).catch(() => ({}));
        if (status.connected || attempts > 30) {
            clearInterval(poll);
            if (status.connected) {
                state.spStatus = status;
                if (state.currentSource === 'wifi') {
                    setQueueIconVisible(true);
                    setHeartVisible(true);
                }
            }
        }
    }, 2000);
}