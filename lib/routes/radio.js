'use strict';

const fs     = require('fs');
const axios  = require('axios');
const router = require('express').Router();
const { XML_H, speakerUrl, getServerIp, boseStationJson, proxyIfHttps } = require('../helpers');

// ─── Stations data ────────────────────────────────────────────────────────────

let stations = JSON.parse(fs.readFileSync('stations.json'));

function saveStations() {
    fs.writeFileSync('stations.json', JSON.stringify(stations, null, 2));
}

// ─── Saved stations CRUD ──────────────────────────────────────────────────────

router.get('/stations', (req, res) => res.json(stations));

router.post('/stations', (req, res) => {
    const { name, url, favicon } = req.body;
    if (!name || !url) return res.status(400).send('name and url are required');
    try { new URL(url); } catch { return res.status(400).send('Invalid URL'); }
    const station = { name: name.trim(), url: url.trim() };
    if (favicon) station.favicon = favicon.trim();
    stations.push(station);
    try { saveStations(); res.json({ id: stations.length - 1, ...station }); }
    catch { res.status(500).send('Could not save stations'); }
});

router.put('/stations', (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).send('Expected array');
    stations.length = 0;
    req.body.forEach(s => stations.push(s));
    try { saveStations(); res.json(stations); }
    catch { res.status(500).send('Could not save stations'); }
});

router.delete('/stations/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id) || id < 0 || id >= stations.length) return res.status(404).send('Not found');
    stations.splice(id, 1);
    try { saveStations(); res.send('Deleted'); }
    catch { res.status(500).send('Could not save stations'); }
});

// ─── Radio playback ───────────────────────────────────────────────────────────

router.get('/radio/:id', async (req, res) => {
    const s = stations[req.params.id];
    if (!s) return res.status(404).send('Not found');
    const imageUrl    = proxyIfHttps(s.favicon || '', `${getServerIp()}:3000`);
    const stationData = Buffer.from(JSON.stringify({ name: s.name, imageUrl, streamUrl: s.url })).toString('base64');
    const location    = `http://${getServerIp()}:3000/orion/station?data=${stationData}`;
    const xml = `<ContentItem source="LOCAL_INTERNET_RADIO" type="stationurl" location="${location}" sourceAccount=""><itemName>${s.name}</itemName></ContentItem>`;
    try { await axios.post(`${speakerUrl()}/select`, xml, XML_H); res.send('Playing'); }
    catch { res.status(502).send('Radio Error'); }
});

// ─── Preset store ─────────────────────────────────────────────────────────────

router.post('/preset/store', async (req, res) => {
    const { num, name, url } = req.body;
    if (!num || !name || !url) return res.status(400).send('num, name, url required');
    if (num < 1 || num > 6) return res.status(400).send('num must be 1–6');
    try {
        const safeName    = (name || '').replace(/[<>&"]/g, '');
        const stationData = Buffer.from(JSON.stringify({ name: safeName, imageUrl: '', streamUrl: url })).toString('base64');
        const location    = `http://${getServerIp()}:3000/orion/station?data=${stationData}`;
        const xml = `<preset id="${num}"><ContentItem source="LOCAL_INTERNET_RADIO" type="stationurl" location="${location}" sourceAccount="" isPresetable="true"><itemName>${safeName}</itemName></ContentItem></preset>`;
        await axios.post(`${speakerUrl()}/storePreset`, xml, XML_H);
        res.send('Stored');
    } catch (err) { console.error('[preset/store]', err.message); res.status(502).send('Store failed'); }
});

// ─── Metadata endpoints (speaker fetches these) ───────────────────────────────

router.get('/orion/station', (req, res) => {
    try {
        const data      = JSON.parse(Buffer.from(req.query.data, 'base64').toString('utf8'));
        const streamUrl = data.streamUrl;
        if (!streamUrl) return res.status(400).send('no streamUrl in data');
        res.json(boseStationJson(data.name, streamUrl, data.imageUrl || ''));
    } catch (err) { console.error('[Orion] Decode error:', err.message); res.status(400).send('bad data'); }
});

router.get('/radio/stream-data', (req, res) => {
    const { url, name, imageUrl } = req.query;
    if (!url) return res.status(400).send('url required');
    res.json(boseStationJson(name || 'Radio', url, imageUrl || ''));
});

router.get('/station-data/:id', (req, res) => {
    const s = stations[req.params.id];
    if (!s) return res.status(404).send('Not found');
    const imageUrl = proxyIfHttps(s.favicon || '', `${getServerIp()}:3000`);
    res.json(boseStationJson(s.name, s.url, imageUrl));
});

// ─── HTTPS stream proxy ───────────────────────────────────────────────────────

router.get('/radio/stream-proxy', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('url required');
    try {
        const upstream = await axios.get(url, {
            responseType: 'stream', timeout: 10000, maxRedirects: 5,
            headers: { 'User-Agent': 'Mozilla/5.0', 'Icy-MetaData': '0' },
        });
        res.setHeader('Content-Type', upstream.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Transfer-Encoding', 'chunked');
        upstream.data.pipe(res);
        upstream.data.on('error', () => res.end());
        req.on('close', () => upstream.data.destroy());
    } catch (err) { console.error(`[StreamProxy] Error: ${err.message}`); res.status(502).send('Stream proxy error'); }
});

// ─── Radio Browser ────────────────────────────────────────────────────────────

const RB_BASE   = 'https://all.api.radio-browser.info/json';
const RB_AGENT  = { 'User-Agent': 'SpeakerRemote/1.0' };
const RB_PARAMS = { hidebroken: true, lastcheckok: 1, order: 'clickcount', reverse: true, limit: 10 };

function mapStation(s) {
    return {
        name:        s.name,
        streamUrl:   s.url_resolved || s.url,
        bitrate:     s.bitrate  || null,
        codec:       s.codec    || null,
        country:     s.country  || null,
        language:    s.language || null,
        tags:        s.tags     || null,
        favicon:     s.favicon  || null,
        stationuuid: s.stationuuid,
    };
}

router.get('/radio-browser/search', async (req, res) => {
    const q       = (req.query.q      || '').trim();
    const country = (req.query.country || '').trim().toUpperCase();
    if (!q) return res.status(400).send('q is required');
    try {
        const params = { ...RB_PARAMS, name: q };
        if (country) params.countrycodeexact = country;
        const r = await axios.get(`${RB_BASE}/stations/search`, { params, headers: RB_AGENT, timeout: 8000 });
        res.json((r.data || []).map(mapStation));
    } catch (err) {
        console.error('[RadioBrowser] Error:', err.message);
        res.status(502).send('Radio Browser search failed');
    }
});

router.get('/radio-browser/country', async (req, res) => {
    const code = (req.query.code || '').toUpperCase().trim();
    if (!code) return res.status(400).send('code required');
    try {
        const r = await axios.get(`${RB_BASE}/stations/bycountrycodeexact/${code}`,
            { params: RB_PARAMS, headers: RB_AGENT, timeout: 8000 });
        res.json((r.data || []).map(mapStation));
    } catch (err) {
        console.error('[RadioBrowser/country]', err.message);
        res.status(502).send('Country fetch failed');
    }
});

router.post('/radio-browser/play', async (req, res) => {
    const { streamUrl, name, favicon } = req.body;
    if (!streamUrl) return res.status(400).send('streamUrl required');
    try {
        const safeName    = (name || 'Radio').replace(/[<>&"]/g, '');
        const safeStream  = streamUrl.startsWith('https://')
            ? `http://${getServerIp()}:3000/radio/stream-proxy?url=${encodeURIComponent(streamUrl)}`
            : streamUrl;
        const safeImage   = proxyIfHttps(favicon || '', `${getServerIp()}:3000`);
        const stationData = Buffer.from(JSON.stringify({ name: safeName, imageUrl: safeImage, streamUrl: safeStream })).toString('base64');
        const location    = `http://${getServerIp()}:3000/orion/station?data=${stationData}`;
        const xml = `<ContentItem source="LOCAL_INTERNET_RADIO" type="stationurl" location="${location}" sourceAccount=""><itemName>${safeName}</itemName></ContentItem>`;
        await axios.post(`${speakerUrl()}/select`, xml, XML_H);
        res.send('Playing');
    } catch (err) { console.error('[RadioBrowser/play]', err.message); res.status(502).send('Playback failed'); }
});

module.exports = router;