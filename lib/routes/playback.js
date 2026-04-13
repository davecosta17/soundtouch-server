'use strict';

const axios  = require('axios');
const router = require('express').Router();
const state  = require('../state');
const { XML_H, speakerUrl, sendKey, getEq, getSources, getStatus } = require('../helpers');
const { broadcast } = require('../speaker');

// ─── Playback ─────────────────────────────────────────────────────────────────

const keyRoute = (key, msg) => async (req, res) => {
    try { await sendKey(key); res.send(msg); }
    catch (err) { console.error(`[${key}]`, err.message); res.status(502).send('Error'); }
};

router.get('/power',     keyRoute('POWER',      'Power toggled'));
router.get('/play',      keyRoute('PLAY',       'Playing'));
router.get('/pause',     keyRoute('PAUSE',      'Paused'));
router.get('/playpause', keyRoute('PLAY_PAUSE', 'Toggled'));
router.get('/next',      keyRoute('NEXT_TRACK', 'Next'));
router.get('/prev',      keyRoute('PREV_TRACK', 'Prev'));

router.get('/mute', async (req, res) => {
    try {
        const volRes  = await axios.get(`${speakerUrl()}/volume`, { timeout: 3000 });
        const isMuted = volRes.data.includes('<muteenabled>true</muteenabled>');
        await axios.post(`${speakerUrl()}/volume`,
            `<volume><muteenabled>${!isMuted}</muteenabled></volume>`, XML_H);
        res.send(!isMuted ? 'Muted' : 'Unmuted');
    } catch (err) { console.error('/mute:', err.message); res.status(502).send('Error'); }
});

router.get('/repeat/:mode', async (req, res) => {
    const map = { one: 'REPEAT_ONE', all: 'REPEAT_ALL', off: 'REPEAT_OFF' };
    const key = map[req.params.mode.toLowerCase()];
    if (!key) return res.status(400).send('Use: one, all, off');
    try { await sendKey(key); res.send(`Repeat: ${req.params.mode}`); }
    catch { res.status(502).send('Error'); }
});

router.get('/shuffle/:mode', async (req, res) => {
    const map = { on: 'SHUFFLE_ON', off: 'SHUFFLE_OFF' };
    const key = map[req.params.mode.toLowerCase()];
    if (!key) return res.status(400).send('Use: on, off');
    try { await sendKey(key); res.send(`Shuffle: ${req.params.mode}`); }
    catch { res.status(502).send('Error'); }
});

// ─── Volume ───────────────────────────────────────────────────────────────────

router.get('/volume/:level', async (req, res) => {
    const level = parseInt(req.params.level, 10);
    if (isNaN(level) || level < 0 || level > 100)
        return res.status(400).send('Volume must be 0–100');
    try {
        await axios.post(`${speakerUrl()}/volume`, `<volume>${level}</volume>`, XML_H);
        res.send(`Volume: ${level}`);
    } catch { res.status(502).send('Error'); }
});

// ─── Sources ──────────────────────────────────────────────────────────────────

router.get('/sources', async (req, res) => {
    try { res.json(await getSources()); }
    catch (err) { console.error('/sources:', err.message); res.status(502).send('Error'); }
});

router.post('/source', async (req, res) => {
    const { source, sourceAccount, location } = req.body;
    if (!source) return res.status(400).send('source required');
    let xml;
    if (source === 'BLUETOOTH') {
        xml = `<ContentItem source="BLUETOOTH"></ContentItem>`;
    } else if (source === 'AUX') {
        xml = `<ContentItem source="AUX" sourceAccount="${sourceAccount || 'AUX'}"></ContentItem>`;
    } else if (location) {
        const acct = sourceAccount ? ` sourceAccount="${sourceAccount}"` : '';
        xml = `<ContentItem source="${source}" location="${location}"${acct} isPresetable="false"></ContentItem>`;
    } else {
        const acct = sourceAccount ? ` sourceAccount="${sourceAccount}"` : '';
        xml = `<ContentItem source="${source}"${acct}></ContentItem>`;
    }
    try {
        await axios.post(`${speakerUrl()}/select`, xml, XML_H);
        res.send(`Source: ${source}`);
    } catch (err) { console.error('/source:', err.message); res.status(502).send('Error'); }
});

// ─── EQ ───────────────────────────────────────────────────────────────────────

router.get('/eq', async (req, res) => {
    try { res.json(await getEq()); }
    catch (err) { console.error('/eq:', err.message); res.status(502).send('Error'); }
});

router.post('/eq/bass', async (req, res) => {
    const val = parseInt(req.body.value, 10);
    if (isNaN(val)) return res.status(400).send('value required');
    try {
        if (state.caps.hasToneControls) {
            await axios.post(`${speakerUrl()}/audioproducttonecontrols`,
                `<audioproducttonecontrols><bass value="${val}" /></audioproducttonecontrols>`, XML_H);
        } else {
            await axios.post(`${speakerUrl()}/bass`, `<bass>${val}</bass>`, XML_H);
        }
        res.send(`Bass: ${val}`);
    } catch { res.status(502).send('Error'); }
});

router.post('/eq/treble', async (req, res) => {
    const val = parseInt(req.body.value, 10);
    if (isNaN(val)) return res.status(400).send('value required');
    try {
        await axios.post(`${speakerUrl()}/audioproducttonecontrols`,
            `<audioproducttonecontrols><treble value="${val}" /></audioproducttonecontrols>`, XML_H);
        res.send(`Treble: ${val}`);
    } catch { res.status(502).send('Error'); }
});

router.post('/eq/mode', async (req, res) => {
    const { mode } = req.body;
    if (!mode) return res.status(400).send('mode required');
    try {
        await axios.post(`${speakerUrl()}/audiodspcontrols`,
            `<audiodspcontrols audiomode="${mode}" />`, XML_H);
        res.send(`Mode: ${mode}`);
    } catch { res.status(502).send('Error'); }
});

// ─── Presets ──────────────────────────────────────────────────────────────────

router.get('/presets', async (req, res) => {
    try { res.send((await axios.get(`${speakerUrl()}/presets`)).data); }
    catch { res.status(502).send('Error'); }
});

router.get('/preset/:num', async (req, res) => {
    const num = parseInt(req.params.num, 10);
    if (isNaN(num) || num < 1 || num > 6) return res.status(400).send('Preset 1–6');
    try { await sendKey(`PRESET_${num}`); res.send(`Preset ${num}`); }
    catch { res.status(502).send('Error'); }
});

// ─── Status & Discovery ───────────────────────────────────────────────────────

router.get('/art-proxy', async (req, res) => {
    const url = req.query.url;
    if (!url) return res.status(400).send('url required');
    try {
        const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        res.set('Content-Type', r.headers['content-type'] || 'image/jpeg');
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(Buffer.from(r.data));
    } catch { res.status(502).send('Could not fetch art'); }
});

router.get('/discovery', (req, res) =>
    res.json({ discovered: state.discovered, name: state.speakerName, ip: state.speakerIp }));

router.get('/status', async (req, res) => res.json(await getStatus()));

router.post('/name', async (req, res) => {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).send('name is required');
    const trimmed = name.trim();
    try {
        await axios.post(`${speakerUrl()}/name`, `<n>${trimmed}</n>`, XML_H);
        state.speakerName = trimmed;
        const { saveCache } = require('../discovery');
        saveCache(state.speakerIp, state.speakerName);
        broadcast({ type: 'info', name: state.speakerName });
        res.json({ name: state.speakerName });
    } catch (err) { console.error('/name:', err.message); res.status(502).send('Error'); }
});

module.exports = router;