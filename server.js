const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');
const mdns = require('multicast-dns');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static('public'));


// ─── mDNS Discovery ───────────────────────────────────────────────────────────
// setSpeaker() does ONE thing: record the IP and fire onDiscovered().
// It has zero other side effects so nothing can interfere with it.

const IP_CACHE = './speaker-cache.json';

let speakerIp   = null;
let speakerName = null;
let discovered  = false;

function saveCache(ip, name) {
    try { fs.writeFileSync(IP_CACHE, JSON.stringify({ ip, name }, null, 2)); }
    catch (err) { console.error('[Cache] Write failed:', err.message); }
}

function setSpeaker(ip, name) {
    const ipChanged = ip !== speakerIp;
    speakerIp   = ip;
    speakerName = name ?? speakerName ?? 'SoundTouch';

    if (!discovered) {
        discovered = true;
        console.log(`[Discovery] Speaker "${speakerName}" found at ${speakerIp}`);
        saveCache(speakerIp, speakerName);
        onDiscovered();   // ← fires exactly once, cleanly separated
    } else if (ipChanged) {
        console.log(`[Discovery] Speaker IP changed to ${speakerIp}`);
        saveCache(speakerIp, speakerName);
        onIpChanged();    // ← only reconnects the speaker WS
    }
}

// ── Load & validate cached IP ─────────────────────────────────────────────────
async function loadCache() {
    try {
        const cache = JSON.parse(fs.readFileSync(IP_CACHE, 'utf8'));
        if (!cache.ip) return;
        console.log(`[Cache] Last known IP: ${cache.ip} — validating…`);
        try {
            await axios.get(`http://${cache.ip}:8090/info`, { timeout: 2500 });
            setSpeaker(cache.ip, cache.name);
            console.log('[Cache] Confirmed — speaker still at', speakerIp);
        } catch {
            console.log('[Cache] Stale — will rediscover via mDNS');
        }
    } catch { /* no cache yet */ }
}

// ── Active mDNS querying ──────────────────────────────────────────────────────
const mcast = mdns();

mcast.on('response', packet => {
    const ptr = packet.answers.find(
        a => a.type === 'PTR' && a.name === '_soundtouch._tcp.local'
    );
    if (!ptr) return;
    const name    = ptr.data.replace('._soundtouch._tcp.local', '');
    const aRecord = packet.additionals.find(a => a.type === 'A');
    if (aRecord) setSpeaker(aRecord.data, name);
});

mcast.on('error', err => console.error('[mDNS] Error:', err.message));

function queryMdns() {
    if (!discovered) console.log('[mDNS] Querying for _soundtouch._tcp.local…');
    mcast.query({ questions: [{ name: '_soundtouch._tcp.local', type: 'PTR' }] });
}

// Query immediately, retry every 5s until found, then slow heartbeat every 30s
queryMdns();
const fastInterval = setInterval(() => {
    queryMdns();
    if (discovered) {
        clearInterval(fastInterval);
        setInterval(queryMdns, 30_000);
    }
}, 5_000);

// Start cache validation — runs in parallel, does not block mDNS
loadCache();

// ── Subnet scanner fallback ───────────────────────────────────────────────────
// If mDNS is blocked (common on Windows), we scan every IP on the local subnet
// for port 8090 and check the /info endpoint. Runs only if mDNS hasn't found
// the speaker within 15 seconds.
const os = require('os');

function getLocalSubnets() {
    const interfaces = os.networkInterfaces();
    const subnets = new Set();
    for (const iface of Object.values(interfaces)) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal) {
                subnets.add(addr.address.split('.').slice(0, 3).join('.'));
            }
        }
    }
    return [...subnets];
}

async function scanSubnet(subnet) {
    console.log(`[Scan] Scanning ${subnet}.1–254…`);
    for (let batch = 0; batch < 255; batch += 30) {
        if (discovered) return;
        const checks = [];
        for (let i = batch + 1; i <= Math.min(batch + 30, 254); i++) {
            const ip = `${subnet}.${i}`;
            checks.push(
                axios.get(`http://${ip}:8090/info`, { timeout: 800 })
                    .then(res => {
                        if (!discovered && res.data && res.data.includes('<info')) {
                            const nameMatch = res.data.match(/<n>(.*?)<\/n>/);
                            const name = nameMatch ? nameMatch[1] : 'SoundTouch';
                            console.log(`[Scan] Found speaker at ${ip}`);
                            setSpeaker(ip, name);
                        }
                    })
                    .catch(() => {})
            );
        }
        await Promise.all(checks);
    }
}

async function scanAllSubnets() {
    if (discovered) return;
    const subnets = getLocalSubnets();
    if (!subnets.length) { console.log('[Scan] No network interfaces found'); return; }
    console.log(`[Scan] mDNS found nothing — scanning subnets: ${subnets.join(', ')}`);
    await Promise.all(subnets.map(scanSubnet));
    if (!discovered) console.log('[Scan] Speaker not found — will retry in 60s');
}

// Wait 15s for mDNS, then fall back to scanning. Re-scan every 60s if still not found.
setTimeout(() => {
    if (!discovered) {
        scanAllSubnets();
        setInterval(() => { if (!discovered) scanAllSubnets(); }, 60_000);
    }
}, 15_000);

// ── URL helper ────────────────────────────────────────────────────────────────
function speakerUrl() {
    if (!speakerIp) throw new Error('Speaker not yet discovered');
    return `http://${speakerIp}:8090`;
}

// ── SPEAKER_IP env var override ───────────────────────────────────────────────
// If mDNS isn't working (e.g. Windows Firewall blocking UDP 5353), set this
// to skip discovery entirely:
//   Windows:  set SPEAKER_IP=192.168.1.x && npm start
//   Mac/Linux: SPEAKER_IP=192.168.1.x npm start
if (process.env.SPEAKER_IP) {
    console.log(`[Config] SPEAKER_IP override: ${process.env.SPEAKER_IP}`);
    setSpeaker(process.env.SPEAKER_IP, process.env.SPEAKER_NAME || 'SoundTouch');
}


// ─── Post-discovery setup ─────────────────────────────────────────────────────
// These fire AFTER the IP is confirmed — completely decoupled from discovery.

function onDiscovered() {
    connectSpeakerWs();
    fetchCapabilities();
}

function onIpChanged() {
    connectSpeakerWs();
    fetchCapabilities();
}


// ─── Speaker WebSocket bridge (port 8080) ─────────────────────────────────────
// Subscribes to the speaker's own push events so we react instantly to
// changes from the physical remote, the Bose app, etc.

let speakerWs          = null;
let speakerWsReady     = false;
let speakerWsTarget    = null; // IP the current socket was opened to

function connectSpeakerWs() {
    if (!speakerIp) return;

    // Don't reconnect if already connected to the current IP
    if (speakerWsTarget === speakerIp && speakerWsReady) return;

    if (speakerWs) {
        speakerWs.removeAllListeners();
        try { speakerWs.terminate(); } catch {}
        speakerWs = null;
    }

    const target = speakerIp;
    speakerWsTarget = target;
    console.log(`[SpeakerWS] Connecting to ws://${target}:8080`);

    const ws = new WebSocket(`ws://${target}:8080`, 'gabbo');
    speakerWs = ws;

    ws.on('open', () => {
        console.log('[SpeakerWS] Connected');
        speakerWsReady = true;
    });

    ws.on('message', async data => {
        const xml = data.toString();
        if (xml.includes('nowPlayingUpdated') || xml.includes('volumeUpdated')) {
            broadcastStatus();
        }
        if (xml.includes('bassUpdated')) {
            broadcastEq();
        }
        if (xml.includes('sourcesUpdated')) {
            broadcastSources();
        }
        if (xml.includes('infoUpdated')) {
            // Device name changed — re-fetch and broadcast
            try {
                const info = await axios.get(`${speakerUrl()}/info`, { timeout: 3000 });
                const nameMatch = info.data.match(/<name>(.*?)<\/name>/);
                if (nameMatch) {
                    speakerName = nameMatch[1];
                    saveCache(speakerIp, speakerName);
                    broadcast({ type: 'info', name: speakerName });
                    console.log(`[Info] Device name updated: ${speakerName}`);
                }
            } catch {}
        }
    });

    ws.on('error', err => {
        // Log but don't rethrow — the 'close' event will handle retry
        console.error('[SpeakerWS] Error:', err.message);
        speakerWsReady = false;
    });

    ws.on('close', () => {
        speakerWsReady = false;
        if (speakerWsTarget !== target) return; // IP changed, new socket already created
        console.log('[SpeakerWS] Disconnected — retrying in 10s');
        setTimeout(() => {
            if (speakerIp && speakerWsTarget === target) connectSpeakerWs();
        }, 10_000);
    });
}

// Fallback poll: fires if speaker WS is down, and a slow heartbeat even when up
setInterval(() => { if (!speakerWsReady) broadcastStatus(); }, 3_000);
setInterval(broadcastStatus, 15_000);


// ─── Capabilities cache ───────────────────────────────────────────────────────
// Fetched once on discovery. Tells the EQ endpoints what the speaker supports.

let caps = {
    hasBass:         false,
    hasToneControls: false,
    hasDspControls:  false,
    bassMin: -9, bassMax: 9, bassDefault: 0
};

async function fetchCapabilities() {
    try {
        const url = speakerUrl();
        const [capsRes, bassRes] = await Promise.all([
            axios.get(`${url}/capabilities`,     { timeout: 3000 }),
            axios.get(`${url}/bassCapabilities`, { timeout: 3000 })
        ]);

        const ex = (tag, xml) => { const m = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`)); return m ? m[1] : null; };

        caps.hasToneControls = capsRes.data.includes('audioproducttonecontrols');
        caps.hasDspControls  = capsRes.data.includes('audiodspcontrols');
        caps.hasBass         = ex('bassAvailable', bassRes.data) === 'true';
        caps.bassMin         = Number(ex('bassMin',     bassRes.data) ?? -9);
        caps.bassMax         = Number(ex('bassMax',     bassRes.data) ?? 9);
        caps.bassDefault     = Number(ex('bassDefault', bassRes.data) ?? 0);

        console.log(`[Caps] Bass:${caps.hasBass} Tone:${caps.hasToneControls} DSP:${caps.hasDspControls}`);
    } catch (err) {
        console.error('[Caps] Fetch failed:', err.message);
    }
}


// ─── Broadcast helpers ────────────────────────────────────────────────────────

const browserClients = new Set();

function broadcast(payload) {
    const msg = JSON.stringify(payload);
    browserClients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    });
}

async function broadcastStatus() {
    try { broadcast({ type: 'status', ...await getStatus() }); } catch {}
}

async function broadcastEq() {
    try { broadcast({ type: 'eq', ...await getEq() }); } catch {}
}

async function broadcastSources() {
    try { broadcast({ type: 'sources', sources: await getSources() }); } catch {}
}


// ─── Helpers ──────────────────────────────────────────────────────────────────

const XML_H = { headers: { 'Content-Type': 'application/xml' } };

async function sendKey(key) {
    const url = `${speakerUrl()}/key`;
    await axios.post(url, `<key state="press"   sender="Gabbo">${key}</key>`, XML_H);
    await axios.post(url, `<key state="release" sender="Gabbo">${key}</key>`, XML_H);
}

function ex(xml, tag) {
    // (?=[\s>/]) ensures tag name ends at a boundary, so <art> won't match <artist>
    const m = xml.match(new RegExp(`<${tag}(?=[\\s>/])[^>]*>(.*?)<\\/${tag}>`, 's'));
    return m ? m[1].trim() : '';
}
function attr(xml, tag, a) {
    const m = xml.match(new RegExp(`<${tag}[^>]*\\s${a}="([^"]*)"`));
    return m ? m[1] : '';
}

function parseStatus(nowXml, volXml) {
    const track       = ex(nowXml, 'track');
    const artist      = ex(nowXml, 'artist');
    const album       = ex(nowXml, 'album');
    const status      = ex(nowXml, 'playStatus');
    const stationName = ex(nowXml, 'stationName');

    const volM  = volXml.match(/<actualvolume>(.*?)<\/actualvolume>/);
    const volume = volM ? Number(volM[1]) : 0;

    // Extract Bluetooth device name — attribute order varies, so search the whole ContentItem tag
    let bluetoothDevice = null;
    const btTagMatch = nowXml.match(/<ContentItem[^>]*source="BLUETOOTH"[^>]*>/);
    if (btTagMatch) {
        const acctMatch = btTagMatch[0].match(/sourceAccount="([^"]+)"/);
        if (acctMatch && acctMatch[1]) bluetoothDevice = acctMatch[1];
    }

    let source = 'unknown', wifiType = null;
    if      (nowXml.includes('AUX IN'))           source = 'aux';
    else if (nowXml.includes('RADIO_STREAMING')) { source = 'wifi'; wifiType = 'radio'; }
    else if (nowXml.includes('spotify:'))        { source = 'wifi'; wifiType = 'spotify'; }
    else if (nowXml.includes('AirPlay'))         { source = 'wifi'; wifiType = 'airplay'; }
    else if (nowXml.includes('BLUETOOTH') || track || artist) source = 'bluetooth';

    // Extract album art URL — only when image is confirmed present
    const artStatusM = nowXml.match(/artImageStatus="([^"]*)"/);
    const artUrl = (artStatusM && artStatusM[1] === 'IMAGE_PRESENT') ? ex(nowXml, 'art') : null;

    return { source, wifiType, track, artist, album, stationName, bluetoothDevice, artUrl, status, volume };
}

async function getStatus() {
    try {
        const url = speakerUrl();
        const [np, vol] = await Promise.all([
            axios.get(`${url}/now_playing`),
            axios.get(`${url}/volume`)
        ]);
        return parseStatus(np.data, vol.data);
    } catch {
        return { error: speakerIp ? 'Speaker offline' : 'Speaker not yet discovered' };
    }
}

async function getSources() {
    const r = await axios.get(`${speakerUrl()}/sources`);
    const items = [];
    const re = /<sourceItem\s([^>]*)>(.*?)<\/sourceItem>/gs;
    let m;
    while ((m = re.exec(r.data)) !== null) {
        const a = n => { const x = m[1].match(new RegExp(`${n}="([^"]*)"`)); return x ? x[1] : ''; };
        items.push({ source: a('source'), sourceAccount: a('sourceAccount'), status: a('status'), label: m[2].trim() });
    }
    return items;
}

async function getEq() {
    const url = speakerUrl();
    const result = { bass: null, treble: null, dsp: null };

    if (caps.hasBass || caps.hasToneControls) {
        try {
            if (caps.hasToneControls) {
                const r   = await axios.get(`${url}/audioproducttonecontrols`);
                const xml = r.data;
                result.bass   = { value: Number(attr(xml,'bass','value')),   min: Number(attr(xml,'bass','minValue')),   max: Number(attr(xml,'bass','maxValue')),   step: Number(attr(xml,'bass','step'))   };
                result.treble = { value: Number(attr(xml,'treble','value')), min: Number(attr(xml,'treble','minValue')), max: Number(attr(xml,'treble','maxValue')), step: Number(attr(xml,'treble','step')) };
            } else if (caps.hasBass) {
                const r = await axios.get(`${url}/bass`);
                result.bass = { value: Number(ex(r.data,'actualbass')), min: caps.bassMin, max: caps.bassMax, step: 1 };
            }
        } catch {}
    }

    if (caps.hasDspControls) {
        try {
            const r  = await axios.get(`${url}/audiodspcontrols`);
            const mm = r.data.match(/audiomode="([^"]*)"/);
            const sm = r.data.match(/supportedaudiomodes="([^"]*)"/);
            result.dsp = {
                mode:      mm ? mm[1] : null,
                supported: sm ? sm[1].split('|') : []
            };
        } catch {}
    }

    return result;
}

// Cache stations at startup (let so we can mutate on POST /stations)
let stations = JSON.parse(fs.readFileSync('stations.json'));


// ─── Playback Controls ────────────────────────────────────────────────────────

const keyRoute = (key, msg) => async (req, res) => {
    try { await sendKey(key); res.send(msg); }
    catch (err) { console.error(`[${key}]`, err.message); res.status(502).send('Error'); }
};

app.get('/power',     keyRoute('POWER',      'Power toggled'));
app.get('/mute', async (req, res) => {
    try {
        const volRes = await axios.get(`${speakerUrl()}/volume`, { timeout: 3000 });
        const isMuted = volRes.data.includes('<muteenabled>true</muteenabled>');
        const newMute = !isMuted;
        await axios.post(`${speakerUrl()}/volume`,
            `<volume><muteenabled>${newMute}</muteenabled></volume>`, XML_H);
        res.send(newMute ? 'Muted' : 'Unmuted');
    } catch (err) { console.error('/mute:', err.message); res.status(502).send('Error'); }
});
app.get('/play',      keyRoute('PLAY',       'Playing'));
app.get('/pause',     keyRoute('PAUSE',      'Paused'));
app.get('/playpause', keyRoute('PLAY_PAUSE', 'Toggled'));
app.get('/next',      keyRoute('NEXT_TRACK', 'Next'));
app.get('/prev',      keyRoute('PREV_TRACK', 'Prev'));

app.get('/repeat/:mode', async (req, res) => {
    const map = { one: 'REPEAT_ONE', all: 'REPEAT_ALL', off: 'REPEAT_OFF' };
    const key = map[req.params.mode.toLowerCase()];
    if (!key) return res.status(400).send('Use: one, all, off');
    try { await sendKey(key); res.send(`Repeat: ${req.params.mode}`); }
    catch (err) { res.status(502).send('Error'); }
});

app.get('/shuffle/:mode', async (req, res) => {
    const map = { on: 'SHUFFLE_ON', off: 'SHUFFLE_OFF' };
    const key = map[req.params.mode.toLowerCase()];
    if (!key) return res.status(400).send('Use: on, off');
    try { await sendKey(key); res.send(`Shuffle: ${req.params.mode}`); }
    catch (err) { res.status(502).send('Error'); }
});


// ─── Volume ───────────────────────────────────────────────────────────────────

app.get('/volume/:level', async (req, res) => {
    const level = parseInt(req.params.level, 10);
    if (isNaN(level) || level < 0 || level > 100)
        return res.status(400).send('Volume must be 0–100');
    try {
        await axios.post(`${speakerUrl()}/volume`, `<volume>${level}</volume>`, XML_H);
        res.send(`Volume: ${level}`);
    } catch (err) { res.status(502).send('Error'); }
});


// ─── Sources ──────────────────────────────────────────────────────────────────

app.get('/sources', async (req, res) => {
    try { res.json(await getSources()); }
    catch (err) { console.error('/sources:', err.message); res.status(502).send('Error'); }
});

app.post('/source', async (req, res) => {
    const { source, sourceAccount } = req.body;
    if (!source) return res.status(400).send('source required');
    let xml;
    if      (source === 'BLUETOOTH') xml = `<ContentItem source="BLUETOOTH"></ContentItem>`;
    else if (source === 'AUX')       xml = `<ContentItem source="AUX" sourceAccount="${sourceAccount || 'AUX'}"></ContentItem>`;
    else {
        const acct = sourceAccount ? ` sourceAccount="${sourceAccount}"` : '';
        xml = `<ContentItem source="${source}"${acct}></ContentItem>`;
    }
    try {
        await axios.post(`${speakerUrl()}/select`, xml, XML_H);
        res.send(`Source: ${source}`);
    } catch (err) { console.error('/source:', err.message); res.status(502).send('Error'); }
});


// ─── EQ ───────────────────────────────────────────────────────────────────────

app.get('/eq', async (req, res) => {
    try { res.json(await getEq()); }
    catch (err) { console.error('/eq:', err.message); res.status(502).send('Error'); }
});

app.post('/eq/bass', async (req, res) => {
    const val = parseInt(req.body.value, 10);
    if (isNaN(val)) return res.status(400).send('value required');
    try {
        // Use tone controls if available, fall back to /bass
        if (caps.hasToneControls) {
            await axios.post(`${speakerUrl()}/audioproducttonecontrols`,
                `<audioproducttonecontrols><bass value="${val}" /></audioproducttonecontrols>`, XML_H);
        } else {
            await axios.post(`${speakerUrl()}/bass`, `<bass>${val}</bass>`, XML_H);
        }
        res.send(`Bass: ${val}`);
    } catch (err) { res.status(502).send('Error'); }
});

app.post('/eq/treble', async (req, res) => {
    const val = parseInt(req.body.value, 10);
    if (isNaN(val)) return res.status(400).send('value required');
    try {
        await axios.post(`${speakerUrl()}/audioproducttonecontrols`,
            `<audioproducttonecontrols><treble value="${val}" /></audioproducttonecontrols>`, XML_H);
        res.send(`Treble: ${val}`);
    } catch (err) { res.status(502).send('Error'); }
});

app.post('/eq/mode', async (req, res) => {
    const { mode } = req.body;
    if (!mode) return res.status(400).send('mode required');
    try {
        await axios.post(`${speakerUrl()}/audiodspcontrols`,
            `<audiodspcontrols audiomode="${mode}" />`, XML_H);
        res.send(`Mode: ${mode}`);
    } catch (err) { res.status(502).send('Error'); }
});


// ─── Presets ──────────────────────────────────────────────────────────────────

app.get('/presets', async (req, res) => {
    try { res.send((await axios.get(`${speakerUrl()}/presets`)).data); }
    catch (err) { res.status(502).send('Error'); }
});

app.get('/preset/:num', async (req, res) => {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 6) return res.status(400).send('Preset 1–6');
    try { await sendKey(`PRESET_${num}`); res.send(`Preset ${num}`); }
    catch (err) { res.status(502).send('Error'); }
});


// ─── Status & Discovery ───────────────────────────────────────────────────────

// Proxy album art images through our server so the browser can draw them to
// canvas without CORS issues (needed for dominant colour extraction)
app.get('/art-proxy', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('url required');
    try {
        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        res.set('Content-Type', r.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(Buffer.from(r.data));
    } catch { res.status(502).send('Could not fetch art'); }
});

app.get('/discovery', (req, res) => res.json({ discovered, name: speakerName, ip: speakerIp }));
app.get('/status',    async (req, res) => res.json(await getStatus()));

app.post('/name', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).send('name is required');
    const trimmed = name.trim();
    try {
        await axios.post(`${speakerUrl()}/name`, `<name>${trimmed}</name>`, XML_H);
        speakerName = trimmed;
        saveCache(speakerIp, speakerName);
        broadcast({ type: 'info', name: speakerName });
        res.json({ name: speakerName });
    } catch (err) { console.error('/name:', err.message); res.status(502).send('Error'); }
});


// ─── Stations / Radio ─────────────────────────────────────────────────────────

app.get('/stations', (req, res) => res.json(stations));

// Add a new radio station
app.post('/stations', (req, res) => {
    const { name, url } = req.body;
    if (!name || !url) return res.status(400).send('name and url are required');
    try {
        new URL(url); // validate URL
    } catch {
        return res.status(400).send('Invalid URL');
    }
    stations.push({ name: name.trim(), url: url.trim() });
    try {
        fs.writeFileSync('stations.json', JSON.stringify(stations, null, 2));
        res.json({ id: stations.length - 1, name: name.trim(), url: url.trim() });
    } catch (err) {
        res.status(500).send('Could not save stations');
    }
});

// Delete a radio station by index
app.delete('/stations/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0 || id >= stations.length) return res.status(404).send('Not found');
    stations.splice(id, 1);
    try {
        fs.writeFileSync('stations.json', JSON.stringify(stations, null, 2));
        res.send('Deleted');
    } catch {
        res.status(500).send('Could not save stations');
    }
});

app.get('/station-data/:id', (req, res) => {
    const s = stations[req.params.id];
    if (!s) return res.status(404).send('Not found');
    res.json({ name: s.name, imageUrl: '', streamUrl: s.url });
});

app.get('/radio/:id', async (req, res) => {
    const s = stations[req.params.id];
    if (!s) return res.status(404).send('Not found');
    const location = `http://${req.headers.host}/station-data/${req.params.id}`;
    const xml = `<ContentItem source="LOCAL_INTERNET_RADIO" type="stationurl" location="${location}" sourceAccount=""><itemName>${s.name}</itemName></ContentItem>`;
    try {
        await axios.post(`${speakerUrl()}/select`, xml, XML_H);
        res.send('Playing');
    } catch (err) { res.status(502).send('Radio Error'); }
});


// ─── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = app.listen(3000, () => console.log('SoundTouch Server running on port 3000'));
const wss = new WebSocket.Server({ server });

wss.on('connection', async ws => {
    browserClients.add(ws);
    ws.on('close', () => browserClients.delete(ws));
    // Send current state immediately on connect
    try {
        const [status, eq, sources] = await Promise.all([getStatus(), getEq(), getSources()]);
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'status',  ...status  }));
            ws.send(JSON.stringify({ type: 'eq',       ...eq      }));
            ws.send(JSON.stringify({ type: 'sources',  sources    }));
        }
    } catch {}
});