'use strict';

require('dotenv').config();

const express   = require('express');
const WebSocket = require('ws');

const state     = require('./lib/state');
const discovery = require('./lib/discovery');
const speaker   = require('./lib/speaker');
const spotify   = require('./lib/spotify');
const { getStatus, getEq, getSources } = require('./lib/helpers');

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static('public'));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/', require('./lib/routes/playback'));
app.use('/', require('./lib/routes/radio'));
app.use('/', require('./lib/routes/spotify'));

// ─── WebSocket server ─────────────────────────────────────────────────────────

const server = app.listen(3000, () => console.log('SoundTouch Server running on port 3000'));
const wss    = new WebSocket.Server({ server });

wss.on('connection', async ws => {
    state.browserClients.add(ws);
    ws.on('close', () => state.browserClients.delete(ws));
    try {
        const [status, eq, sources] = await Promise.all([getStatus(), getEq(), getSources()]);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'status',  ...status }));
            ws.send(JSON.stringify({ type: 'eq',      ...eq     }));
            ws.send(JSON.stringify({ type: 'sources', sources   }));
        }
    } catch {}
});

// ─── Wire up cross-module dependencies ───────────────────────────────────────

// Discovery needs to call speaker hooks after finding the speaker
discovery.setCallbacks({
    onDiscovered: speaker.onDiscovered,
    onIpChanged:  speaker.onIpChanged,
});

// Spotify poller needs the broadcast function — injected to avoid circular dep
spotify.setBroadcast(speaker.broadcast);

// ─── Start ────────────────────────────────────────────────────────────────────

// SPEAKER_IP env var skips discovery entirely
if (process.env.SPEAKER_IP) {
    console.log(`[Config] SPEAKER_IP override: ${process.env.SPEAKER_IP}`);
    discovery.setSpeaker(process.env.SPEAKER_IP, process.env.SPEAKER_NAME || 'SoundTouch');
} else {
    discovery.startDiscovery();
}

speaker.startPolling();