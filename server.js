const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');
const { Bonjour } = require('bonjour-service');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));


// ─── mDNS Discovery ───────────────────────────────────────────────────────────
// SoundTouch speakers broadcast themselves as _soundtouch._tcp on the local
// network. We watch for that service so we never need a hardcoded IP.

let speakerIp   = null;   // populated by mDNS, stays current even if IP changes
let speakerName = null;

const bonjour = new Bonjour();
const browser = bonjour.find({ type: 'soundtouch' });

browser.on('up', service => {
    // A SoundTouch device appeared (or changed IP and re-announced itself)
    const ip = service.addresses?.find(a => a.includes('.')) ?? service.host;
    if (speakerIp !== ip) {
        speakerIp   = ip;
        speakerName = service.name;
        console.log(`[mDNS] Speaker found: "${speakerName}" at ${speakerIp}`);
    }
});

browser.on('down', service => {
    if (service.name === speakerName) {
        console.log(`[mDNS] Speaker "${speakerName}" went offline`);
        // Keep the last known IP — it may just be a brief dropout
    }
});

// Helper: returns the base URL or throws a clear error if not yet discovered
function speakerUrl() {
    if (!speakerIp) throw new Error("Speaker not yet discovered on the network");
    return `http://${speakerIp}:8090`;
}

// Cache stations at startup so we're not doing sync disk reads on every request
const stations = JSON.parse(fs.readFileSync('stations.json'));


// ─── Helpers ──────────────────────────────────────────────────────────────────

// Send a key press to the speaker (handles both press and release for held keys)
async function sendKey(key) {
    const headers = { 'Content-Type': 'application/xml' };
    await axios.post(
        `${speakerUrl()}/key`,
        `<key state="press" sender="Gabbo">${key}</key>`,
        { headers }
    );
}

// Parse the now_playing and volume XML into a status object
function parseStatus(nowPlayingXml, volumeXml) {

    function extract(tag) {
        const match = nowPlayingXml.match(new RegExp(`<${tag}>(.*?)<\/${tag}>`));
        return match ? match[1] : "";
    }

    const track  = extract("track");
    const artist = extract("artist");
    const album  = extract("album");
    const status = extract("playStatus");

    const volumeMatch = volumeXml.match(/<actualvolume>(.*?)<\/actualvolume>/);
    const volume = volumeMatch ? Number(volumeMatch[1]) : 0;

    // Source detection — single authoritative place for this logic
    let source   = "unknown";
    let wifiType = null;

    if (nowPlayingXml.includes("AUX IN")) {
        source = "aux";
    } else if (nowPlayingXml.includes("RADIO_STREAMING")) {
        source   = "wifi";
        wifiType = "radio";
    } else if (nowPlayingXml.includes("spotify:")) {
        source   = "wifi";
        wifiType = "spotify";
    } else if (nowPlayingXml.includes("AirPlay")) {
        source   = "wifi";
        wifiType = "airplay";
    } else if (track || artist) {
        source = "bluetooth";
    }

    return { source, wifiType, track, artist, album, status, volume };
}

// Fetch and return a status object, or an error object if the speaker is offline
async function getStatus() {
    try {
        const url = speakerUrl();
        const [nowPlaying, volume] = await Promise.all([
            axios.get(`${url}/now_playing`),
            axios.get(`${url}/volume`)
        ]);
        return parseStatus(nowPlaying.data, volume.data);
    } catch (err) {
        console.error("getStatus error:", err.message);
        return { error: speakerIp ? "Speaker offline" : "Speaker not yet discovered" };
    }
}


// ─── Playback Controls ────────────────────────────────────────────────────────

app.get('/power', async (req, res) => {
    try {
        await sendKey('POWER');
        res.send("Power toggled");
    } catch (err) {
        console.error('/power error:', err.message);
        res.status(502).send("Error");
    }
});

app.get('/mute', async (req, res) => {
    try {
        await sendKey('MUTE');
        res.send("Mute toggled");
    } catch (err) {
        console.error('/mute error:', err.message);
        res.status(502).send("Error");
    }
});

app.get('/play', async (req, res) => {
    try {
        await sendKey('PLAY');
        res.send("Play sent");
    } catch (err) {
        console.error('/play error:', err.message);
        res.status(502).send("Error");
    }
});

app.get('/pause', async (req, res) => {
    try {
        await sendKey('PAUSE');
        res.send("Pause sent");
    } catch (err) {
        console.error('/pause error:', err.message);
        res.status(502).send("Error");
    }
});

// Toggles between play and pause
app.get('/playpause', async (req, res) => {
    try {
        await sendKey('PLAY_PAUSE');
        res.send("Play/Pause toggled");
    } catch (err) {
        console.error('/playpause error:', err.message);
        res.status(502).send("Error");
    }
});

app.get('/next', async (req, res) => {
    try {
        await sendKey('NEXT_TRACK');
        res.send("Next track");
    } catch (err) {
        console.error('/next error:', err.message);
        res.status(502).send("Error");
    }
});

app.get('/prev', async (req, res) => {
    try {
        await sendKey('PREV_TRACK');
        res.send("Previous track");
    } catch (err) {
        console.error('/prev error:', err.message);
        res.status(502).send("Error");
    }
});

// Repeat: on | all | off
app.get('/repeat/:mode', async (req, res) => {
    const modeMap = {
        one:  'REPEAT_ONE',
        all:  'REPEAT_ALL',
        off:  'REPEAT_OFF'
    };
    const key = modeMap[req.params.mode.toLowerCase()];
    if (!key) return res.status(400).send("Invalid mode. Use: one, all, off");
    try {
        await sendKey(key);
        res.send(`Repeat set to ${req.params.mode}`);
    } catch (err) {
        console.error('/repeat error:', err.message);
        res.status(502).send("Error");
    }
});

// Shuffle: on | off
app.get('/shuffle/:mode', async (req, res) => {
    const modeMap = {
        on:  'SHUFFLE_ON',
        off: 'SHUFFLE_OFF'
    };
    const key = modeMap[req.params.mode.toLowerCase()];
    if (!key) return res.status(400).send("Invalid mode. Use: on, off");
    try {
        await sendKey(key);
        res.send(`Shuffle ${req.params.mode}`);
    } catch (err) {
        console.error('/shuffle error:', err.message);
        res.status(502).send("Error");
    }
});


// ─── Volume ───────────────────────────────────────────────────────────────────

app.get('/volume/:level', async (req, res) => {
    const level = parseInt(req.params.level, 10);
    if (isNaN(level) || level < 0 || level > 100) {
        return res.status(400).send("Volume must be a number between 0 and 100");
    }
    try {
        await axios.post(
            `${speakerUrl()}/volume`,
            `<volume>${level}</volume>`,
            { headers: { 'Content-Type': 'application/xml' } }
        );
        res.send(`Volume set to ${level}`);
    } catch (err) {
        console.error('/volume error:', err.message);
        res.status(502).send("Error");
    }
});


// ─── Presets ──────────────────────────────────────────────────────────────────

// Get all 6 presets stored on the speaker
app.get('/presets', async (req, res) => {
    try {
        const response = await axios.get(`${speakerUrl()}/presets`);
        res.send(response.data); // Returns raw XML — parse on the client if needed
    } catch (err) {
        console.error('/presets error:', err.message);
        res.status(502).send("Error");
    }
});

// Activate a preset by number (1–6)
app.get('/preset/:num', async (req, res) => {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 6) {
        return res.status(400).send("Preset must be a number between 1 and 6");
    }
    try {
        await sendKey(`PRESET_${num}`);
        res.send(`Preset ${num} activated`);
    } catch (err) {
        console.error(`/preset/${num} error:`, err.message);
        res.status(502).send("Error");
    }
});


// ─── Status ───────────────────────────────────────────────────────────────────

// Show what the mDNS discovery has found — useful for debugging
app.get('/discovery', (req, res) => {
    res.json({
        discovered: !!speakerIp,
        name: speakerName,
        ip: speakerIp
    });
});

app.get('/status', async (req, res) => {
    res.json(await getStatus());
});


// ─── Stations / Radio ─────────────────────────────────────────────────────────

app.get('/stations', (req, res) => {
    res.json(stations);
});

// Serve individual station JSON files — the speaker fetches this directly.
// This avoids relying on content.api.bose.io which will go offline with Bose cloud.
app.get('/station-data/:id', (req, res) => {
    const station = stations[req.params.id];
    if (!station) return res.status(404).send("Station not found");
    // Bose LOCAL_INTERNET_RADIO JSON format
    res.json({ name: station.name, imageUrl: "", streamUrl: station.url });
});

app.get('/radio/:id', async (req, res) => {
    const station = stations[req.params.id];
    if (!station) return res.status(404).send("Station not found");

    // Point the speaker at our own server for the station JSON, not Bose's cloud.
    // This will keep working after Bose shuts down content.api.bose.io.
    const host = req.headers.host; // e.g. "192.168.1.50:3000"
    const location = `http://${host}/station-data/${req.params.id}`;

    const xml = `<ContentItem source="LOCAL_INTERNET_RADIO" type="stationurl" location="${location}" sourceAccount="">
<itemName>${station.name}</itemName>
</ContentItem>`;

    try {
        await axios.post(
            `${speakerUrl()}/select`,
            xml,
            { headers: { 'Content-Type': 'application/xml' } }
        );
        res.send("Playing");
    } catch (err) {
        console.error(`/radio/${req.params.id} error:`, err.message);
        res.status(502).send("Radio Error");
    }
});


// ─── WebSocket: push status every second ──────────────────────────────────────

const server = app.listen(3000, () => {
    console.log("SoundTouch Server running on port 3000");
});

const wss = new WebSocket.Server({ server });

setInterval(async () => {
    const status = await getStatus();
    const payload = JSON.stringify(status);
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}, 1000);