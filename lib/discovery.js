'use strict';

const os    = require('os');
const fs    = require('fs');
const axios = require('axios');
const mdns  = require('multicast-dns');
const state = require('./state');

const IP_CACHE = './speaker-cache.json';

// ─── Cache ────────────────────────────────────────────────────────────────────

function saveCache(ip, name) {
    try { fs.writeFileSync(IP_CACHE, JSON.stringify({ ip, name }, null, 2)); }
    catch (err) { console.error('[Cache] Write failed:', err.message); }
}

// ─── Discovery callbacks ───────────────────────────────────────────────────────
// Populated by speaker.js after it initialises — avoids circular deps.
let onDiscovered = () => {};
let onIpChanged  = () => {};

function setCallbacks(cb) {
    onDiscovered = cb.onDiscovered;
    onIpChanged  = cb.onIpChanged;
}

// ─── setSpeaker ───────────────────────────────────────────────────────────────

function setSpeaker(ip, name) {
    const ipChanged   = ip !== state.speakerIp;
    state.speakerIp   = ip;
    state.speakerName = name ?? state.speakerName ?? 'SoundTouch';

    if (!state.discovered) {
        state.discovered = true;
        console.log(`[Discovery] ✓ Speaker "${state.speakerName}" found at ${state.speakerIp}`);
        saveCache(state.speakerIp, state.speakerName);
        onDiscovered();
    } else if (ipChanged) {
        console.log(`[Discovery] Speaker IP changed: ${state.speakerIp} → ${ip}`);
        saveCache(state.speakerIp, state.speakerName);
        onIpChanged();
    } else {
        if (!state.speakerWsReady) console.log(`[Discovery] Speaker still at ${state.speakerIp} — reconnecting WS`);
    }
}

// ─── Restart discovery after network drop ─────────────────────────────────────

function restartDiscovery() {
    console.log('[Discovery] ━━━ Network drop detected — restarting discovery ━━━');
    state.discovered     = false;
    state.wsFailCount    = 0;
    state.httpFailCount  = 0;
    state.speakerWsReady = false;

    console.log('[Discovery] Step 1 — querying mDNS every 5s…');
    const interval = setInterval(() => {
        queryMdns();
        if (state.discovered) {
            clearInterval(interval);
            console.log('[Discovery] ✓ Speaker re-found — resuming normal operation');
        }
    }, 5_000);
    queryMdns();

    setTimeout(() => {
        if (!state.discovered) {
            console.log('[Discovery] Step 2 — mDNS silent, falling back to subnet scan…');
            scanAllSubnets();
        }
    }, 8_000);
}

// ─── mDNS ─────────────────────────────────────────────────────────────────────

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
    if (!state.discovered) console.log('[mDNS] Querying for _soundtouch._tcp.local…');
    mcast.query({ questions: [{ name: '_soundtouch._tcp.local', type: 'PTR' }] });
}

// ─── Subnet scanner fallback ──────────────────────────────────────────────────

function getLocalSubnets() {
    const subnets = new Set();
    for (const iface of Object.values(os.networkInterfaces())) {
        for (const addr of iface) {
            if (addr.family === 'IPv4' && !addr.internal)
                subnets.add(addr.address.split('.').slice(0, 3).join('.'));
        }
    }
    return [...subnets];
}

async function scanSubnet(subnet) {
    console.log(`[Scan] Scanning ${subnet}.1–254…`);
    for (let batch = 0; batch < 255; batch += 30) {
        if (state.discovered) return;
        const checks = [];
        for (let i = batch + 1; i <= Math.min(batch + 30, 254); i++) {
            const ip = `${subnet}.${i}`;
            checks.push(
                axios.get(`http://${ip}:8090/info`, { timeout: 800 })
                    .then(res => {
                        if (!state.discovered && res.data?.includes('<info')) {
                            const m    = res.data.match(/<n>(.*?)<\/n>/);
                            const name = m ? m[1] : 'SoundTouch';
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
    if (state.discovered) return;
    const subnets = getLocalSubnets();
    if (!subnets.length) { console.log('[Scan] No network interfaces found'); return; }
    console.log(`[Scan] mDNS found nothing — scanning subnets: ${subnets.join(', ')}`);
    await Promise.all(subnets.map(scanSubnet));
    if (!state.discovered) console.log('[Scan] Speaker not found — will retry in 60s');
}

// ─── Cache validation ─────────────────────────────────────────────────────────

async function loadCache() {
    try {
        const cache = JSON.parse(fs.readFileSync(IP_CACHE, 'utf8'));
        if (!cache.ip) return;
        console.log(`[Cache] Last known IP: ${cache.ip} — validating…`);
        try {
            await axios.get(`http://${cache.ip}:8090/info`, { timeout: 2500 });
            setSpeaker(cache.ip, cache.name);
            console.log('[Cache] Confirmed — speaker still at', state.speakerIp);
        } catch {
            console.log('[Cache] Stale — will rediscover via mDNS');
        }
    } catch { /* no cache yet */ }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function startDiscovery() {
    queryMdns();
    const fastInterval = setInterval(() => {
        queryMdns();
        if (state.discovered) {
            clearInterval(fastInterval);
            setInterval(queryMdns, 30_000);
        }
    }, 5_000);

    loadCache();

    setTimeout(() => {
        if (!state.discovered) {
            scanAllSubnets();
            setInterval(() => { if (!state.discovered) scanAllSubnets(); }, 60_000);
        }
    }, 15_000);
}

module.exports = { setSpeaker, saveCache, setCallbacks, restartDiscovery, startDiscovery };