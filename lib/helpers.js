'use strict';

const os    = require('os');
const axios = require('axios');
const state = require('./state');

const XML_H = { headers: { 'Content-Type': 'application/xml' } };

// ─── Network helpers ──────────────────────────────────────────────────────────

function speakerUrl() {
    if (!state.speakerIp) throw new Error('Speaker not yet discovered');
    return `http://${state.speakerIp}:8090`;
}

// Returns the server's LAN IP that the speaker can reach.
// Prefers the interface on the same subnet as the speaker.
// Skips link-local and Windows hotspot/ICS adapters.
function getServerIp() {
    const ifaces = os.networkInterfaces();
    const candidates = [];
    for (const name of Object.values(ifaces)) {
        for (const iface of name) {
            if (iface.family !== 'IPv4' || iface.internal) continue;
            const ip = iface.address;
            if (ip.startsWith('169.254.'))    continue; // link-local
            if (ip.startsWith('192.168.137.')) continue; // Windows ICS/hotspot
            candidates.push(ip);
        }
    }
    if (state.speakerIp) {
        const subnet = state.speakerIp.split('.').slice(0, 3).join('.');
        const match  = candidates.find(ip => ip.startsWith(subnet));
        if (match) return match;
    }
    return candidates[0] || '127.0.0.1';
}

// ─── XML helpers ──────────────────────────────────────────────────────────────

function decodeXmlEntities(s) {
    return s.replace(/&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&amp;/g,  '&')
            .replace(/&lt;/g,   '<')
            .replace(/&gt;/g,   '>');
}

// Extract inner text of a tag — boundary check prevents <art> matching <artist>
function ex(xml, tag) {
    const m = xml.match(new RegExp(`<${tag}(?=[\\s>/])[^>]*>(.*?)<\\/${tag}>`, 's'));
    return m ? decodeXmlEntities(m[1].trim()) : '';
}

function attr(xml, tag, a) {
    const m = xml.match(new RegExp(`<${tag}[^>]*\\s${a}="([^"]*)"`));
    return m ? m[1] : '';
}

// ─── Speaker key press ────────────────────────────────────────────────────────

async function sendKey(key) {
    const url = `${speakerUrl()}/key`;
    await axios.post(url, `<key state="press"   sender="Gabbo">${key}</key>`, XML_H);
    await axios.post(url, `<key state="release" sender="Gabbo">${key}</key>`, XML_H);
}

// ─── Bose station JSON format ─────────────────────────────────────────────────

function boseStationJson(name, streamUrl, imageUrl = '') {
    return {
        audio: { hasPlaylist: false, isRealtime: true, streamUrl },
        imageUrl,
        name,
        streamType: 'liveRadio',
    };
}

// Proxy HTTPS URLs through server — speaker firmware can't connect to HTTPS audio
function proxyIfHttps(url, host) {
    if (!url) return '';
    return url.startsWith('https://')
        ? `http://${host}/radio/stream-proxy?url=${encodeURIComponent(url)}`
        : url;
}

// ─── Status parsing ───────────────────────────────────────────────────────────

function parseStatus(nowXml, volXml) {
    const track       = ex(nowXml, 'track');
    const artist      = ex(nowXml, 'artist');
    const album       = ex(nowXml, 'album');
    const status      = ex(nowXml, 'playStatus');
    const stationName = ex(nowXml, 'stationName');

    const volM   = volXml.match(/<actualvolume>(.*?)<\/actualvolume>/);
    const volume = volM ? Number(volM[1]) : 0;
    const muted  = volXml.includes('<muteenabled>true</muteenabled>');

    let bluetoothDevice = null;
    if (nowXml.includes('source="BLUETOOTH"')) {
        bluetoothDevice = stationName || null;
        if (!bluetoothDevice) {
            const btTagMatch = nowXml.match(/<ContentItem[^>]*source="BLUETOOTH"[^>]*>/);
            if (btTagMatch) {
                const acctMatch = btTagMatch[0].match(/sourceAccount="([^"]+)"/);
                if (acctMatch?.[1]) bluetoothDevice = acctMatch[1];
            }
        }
    }

    let source = 'unknown', wifiType = null;
    if      (nowXml.includes('AUX IN'))           source = 'aux';
    else if (nowXml.includes('RADIO_STREAMING')) { source = 'wifi'; wifiType = 'radio'; }
    else if (nowXml.includes('spotify:'))        { source = 'wifi'; wifiType = 'spotify'; }
    else if (nowXml.includes('AirPlay'))         { source = 'wifi'; wifiType = 'airplay'; }
    else if (nowXml.includes('BLUETOOTH') || track || artist) source = 'bluetooth';

    const artStatusM = nowXml.match(/artImageStatus="([^"]*)"/);
    const artUrl = (artStatusM?.[1] === 'IMAGE_PRESENT') ? ex(nowXml, 'art') : null;

    return { source, wifiType, track, artist, album, stationName, bluetoothDevice, artUrl, status, volume, muted };
}

async function getStatus() {
    try {
        const url = speakerUrl();
        const [np, vol] = await Promise.all([
            axios.get(`${url}/now_playing`),
            axios.get(`${url}/volume`),
        ]);
        return parseStatus(np.data, vol.data);
    } catch {
        return { error: state.speakerIp ? 'Speaker offline' : 'Speaker not yet discovered' };
    }
}

async function getSources() {
    const r = await axios.get(`${speakerUrl()}/sources`);
    const items = [];
    const re = /<sourceItem\s([^>]*)>(.*?)<\/sourceItem>/gs;
    let m;
    while ((m = re.exec(r.data)) !== null) {
        const a = n => { const x = m[1].match(new RegExp(`${n}="([^"]*)"`)); return x ? x[1] : ''; };
        const label = m[2].trim().replace(/<[^>]*>/g, '').trim() || a('source');
        items.push({ source: a('source'), sourceAccount: a('sourceAccount'), status: a('status'), label });
    }
    return items;
}

async function getEq() {
    const url    = speakerUrl();
    const { caps } = state;
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
                supported: sm ? sm[1].split('|') : [],
            };
        } catch {}
    }

    return result;
}

module.exports = {
    XML_H, speakerUrl, getServerIp,
    decodeXmlEntities, ex, attr,
    sendKey, boseStationJson, proxyIfHttps,
    parseStatus, getStatus, getSources, getEq,
};