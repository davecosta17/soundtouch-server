'use strict';

const fs    = require('fs');
const axios = require('axios');

const SP_TOKEN_FILE = './spotify-tokens.json';
const SP_SCOPES     = 'user-read-playback-state user-modify-playback-state user-library-read user-library-modify';

// Mutable config — updated by /setup/spotify without restart
const config = {
    clientId:     process.env.SPOTIFY_CLIENT_ID     || '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
    redirectUri:  process.env.SPOTIFY_REDIRECT_URI  || '',
};

let spTokens = null;
try {
    if (fs.existsSync(SP_TOKEN_FILE))
        spTokens = JSON.parse(fs.readFileSync(SP_TOKEN_FILE, 'utf8'));
} catch {}

// ─── Token management ─────────────────────────────────────────────────────────

function saveSpTokens(t) {
    spTokens = t;
    fs.writeFileSync(SP_TOKEN_FILE, JSON.stringify(t, null, 2));
}

async function getSpAccessToken() {
    if (!spTokens) return null;
    if (Date.now() < spTokens.expires_at - 60_000) return spTokens.access_token;
    try {
        const r = await axios.post('https://accounts.spotify.com/api/token',
            new URLSearchParams({
                grant_type:    'refresh_token',
                refresh_token: spTokens.refresh_token,
            }), {
                headers: {
                    'Content-Type':  'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64'),
                },
            });
        saveSpTokens({
            access_token:  r.data.access_token,
            refresh_token: r.data.refresh_token || spTokens.refresh_token,
            expires_at:    Date.now() + r.data.expires_in * 1000,
        });
        console.log('[Spotify] Token refreshed');
        return spTokens.access_token;
    } catch (err) {
        console.error('[Spotify] Token refresh failed:', err.message);
        return null;
    }
}

// ─── Progress poller ──────────────────────────────────────────────────────────

let spPollInterval = null;
let broadcastFn    = null; // injected by server.js to avoid circular dep

function setBroadcast(fn) { broadcastFn = fn; }

function startPoller() {
    if (spPollInterval) return;
    console.log('[Spotify] Starting progress poller');
    spPollInterval = setInterval(poll, 2000);
}

function stopPoller() {
    if (!spPollInterval) return;
    console.log('[Spotify] Stopping progress poller');
    clearInterval(spPollInterval);
    spPollInterval = null;
    if (broadcastFn) broadcastFn({ type: 'progress', progress_ms: 0, duration_ms: 0, is_playing: false, clear: true });
}

async function poll() {
    const token = await getSpAccessToken();
    if (!token) return;
    try {
        const r = await axios.get('https://api.spotify.com/v1/me/player', {
            headers: { Authorization: 'Bearer ' + token },
            timeout: 3000,
        });
        if (r.status === 204 || !r.data) return;

        const { progress_ms, is_playing, item, shuffle_state, repeat_state } = r.data;
        const track_id      = item?.id || null;
        const trackDuration = item?.duration_ms || r.data.duration_ms || 0;
        const remaining     = trackDuration - (progress_ms || 0);

        let nextTrack = null;
        if (remaining > 0 && remaining <= 25_000) {
            try {
                const qr   = await axios.get('https://api.spotify.com/v1/me/player/queue', {
                    headers: { Authorization: 'Bearer ' + token }, timeout: 3000,
                });
                const first = qr.data?.queue?.[0];
                if (first) {
                    nextTrack = {
                        name:   first.name,
                        artist: first.artists?.map(a => a.name).join(', ') || '',
                        artUrl: first.album?.images?.[2]?.url || first.album?.images?.[0]?.url || '',
                    };
                }
            } catch {}
        }

        if (broadcastFn) broadcastFn({
            type:          'progress',
            progress_ms:   progress_ms || 0,
            duration_ms:   trackDuration,
            is_playing,
            shuffle_state: shuffle_state || false,
            repeat_state:  repeat_state  || 'off',
            next_track:    nextTrack,
            track_id,
        });
    } catch (err) {
        if (err.response?.status === 401) console.warn('[Spotify] Token expired mid-poll');
    }
}

module.exports = { config, spTokens: () => spTokens, saveSpTokens, getSpAccessToken, startPoller, stopPoller, setBroadcast, SP_SCOPES };