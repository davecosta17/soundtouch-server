'use strict';

const axios     = require('axios');
const WebSocket = require('ws');
const state     = require('./state');
const { speakerUrl, getStatus, getEq, getSources } = require('./helpers');
const { saveCache }        = require('./discovery');
const { restartDiscovery } = require('./discovery');
const spotify              = require('./spotify');

// ─── Broadcast ────────────────────────────────────────────────────────────────

function broadcast(payload) {
    const msg = JSON.stringify(payload);
    state.browserClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

function syncSpotifyPoller(status) {
    if (status?.wifiType === 'spotify' && status?.status === 'PLAY_STATE') {
        spotify.startPoller();
    } else {
        spotify.stopPoller();
    }
}

async function broadcastStatus() {
    try {
        const status = await getStatus();
        broadcast({ type: 'status', ...status });
        syncSpotifyPoller(status);
    } catch {}
}

async function broadcastEq() {
    try { broadcast({ type: 'eq', ...await getEq() }); } catch {}
}

async function broadcastSources() {
    try { broadcast({ type: 'sources', sources: await getSources() }); } catch {}
}

// ─── Speaker WebSocket bridge ─────────────────────────────────────────────────

function connectSpeakerWs() {
    if (!state.speakerIp) return;
    if (state.speakerWsTarget === state.speakerIp && state.speakerWsReady) return;

    if (state.speakerWs) {
        state.speakerWs.removeAllListeners();
        try { state.speakerWs.terminate(); } catch {}
        state.speakerWs = null;
    }

    const target = state.speakerIp;
    state.speakerWsTarget = target;
    console.log(`[SpeakerWS] Connecting to ws://${target}:8080`);

    const ws = new WebSocket(`ws://${target}:8080`, 'gabbo');
    state.speakerWs = ws;

    ws.on('open', () => {
        console.log(`[SpeakerWS] Connected to ${target} ✓`);
        state.speakerWsReady = true;
        state.wsFailCount    = 0;
    });

    ws.on('message', async data => {
        const xml = data.toString();
        if (xml.includes('nowPlayingUpdated') || xml.includes('volumeUpdated')) broadcastStatus();
        if (xml.includes('bassUpdated'))    broadcastEq();
        if (xml.includes('sourcesUpdated')) broadcastSources();
        if (xml.includes('infoUpdated')) {
            try {
                const info = await axios.get(`${speakerUrl()}/info`, { timeout: 3000 });
                const m    = info.data.match(/<n>(.*?)<\/name>/);
                if (m) {
                    state.speakerName = m[1];
                    saveCache(state.speakerIp, state.speakerName);
                    broadcast({ type: 'info', name: state.speakerName });
                    console.log(`[Info] Device name updated: ${state.speakerName}`);
                }
            } catch {}
        }
    });

    ws.on('error', err => {
        state.speakerWsReady = false;
        state.wsFailCount++;
        console.error(`[SpeakerWS] Error (${state.wsFailCount}/3): ${err.message}`);
        if (state.wsFailCount >= 3) {
            console.log('[SpeakerWS] 3 consecutive failures — triggering rediscovery');
            restartDiscovery();
        }
    });

    ws.on('close', () => {
        state.speakerWsReady = false;
        if (state.speakerWsTarget !== target) return;
        console.log(`[SpeakerWS] Disconnected (fail streak: ${state.wsFailCount}) — retrying in 10s`);
        setTimeout(() => {
            if (state.speakerIp && state.speakerWsTarget === target) {
                console.log('[SpeakerWS] Attempting reconnect…');
                connectSpeakerWs();
            }
        }, 10_000);
    });
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

async function fetchCapabilities() {
    try {
        const url = speakerUrl();
        const [capsRes, bassRes] = await Promise.all([
            axios.get(`${url}/capabilities`,     { timeout: 3000 }),
            axios.get(`${url}/bassCapabilities`, { timeout: 3000 }),
        ]);
        const xm = (tag, xml) => { const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`)); return m ? m[1] : null; };
        state.caps.hasToneControls = capsRes.data.includes('audioproducttonecontrols');
        state.caps.hasDspControls  = capsRes.data.includes('audiodspcontrols');
        state.caps.hasBass         = xm('bassAvailable', bassRes.data) === 'true';
        state.caps.bassMin         = Number(xm('bassMin',     bassRes.data) ?? -9);
        state.caps.bassMax         = Number(xm('bassMax',     bassRes.data) ?? 9);
        state.caps.bassDefault     = Number(xm('bassDefault', bassRes.data) ?? 0);
        console.log(`[Caps] Bass:${state.caps.hasBass} Tone:${state.caps.hasToneControls} DSP:${state.caps.hasDspControls}`);
    } catch (err) {
        console.error('[Caps] Fetch failed:', err.message);
    }
}

// ─── Polling ──────────────────────────────────────────────────────────────────

function startPolling() {
    // Fallback poll when WS is down — every 3s
    setInterval(async () => {
        if (!state.speakerWsReady) {
            try {
                await broadcastStatus();
                if (state.httpFailCount > 0) {
                    console.log(`[Poll] Speaker responded — resetting HTTP fail count (was ${state.httpFailCount})`);
                    state.httpFailCount = 0;
                }
            } catch {
                state.httpFailCount++;
                console.warn(`[Poll] HTTP poll failed (${state.httpFailCount}/5) — speaker unreachable`);
                if (state.httpFailCount >= 5 && state.discovered) {
                    console.log('[Poll] 5 consecutive HTTP failures — triggering rediscovery');
                    restartDiscovery();
                }
            }
        }
    }, 3_000);

    // Heartbeat — every 15s regardless
    setInterval(broadcastStatus, 15_000);
}

// ─── Post-discovery hooks ─────────────────────────────────────────────────────

function onDiscovered() {
    connectSpeakerWs();
    fetchCapabilities();
}

function onIpChanged() {
    connectSpeakerWs();
    fetchCapabilities();
}

module.exports = {
    broadcast, broadcastStatus, broadcastEq, broadcastSources,
    connectSpeakerWs, fetchCapabilities, startPolling,
    onDiscovered, onIpChanged,
};