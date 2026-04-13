'use strict';

const fs      = require('fs');
const axios   = require('axios');
const router  = require('express').Router();
const spotify = require('../spotify');
const { getServerIp } = require('../helpers');

// ─── Setup ────────────────────────────────────────────────────────────────────

router.post('/setup/spotify', (req, res) => {
    const { clientId, clientSecret } = req.body;
    if (!clientId || !clientSecret) return res.status(400).send('clientId and clientSecret required');
    try {
        const redirectUri  = `http://${getServerIp()}:3000/spotify/callback`;
        const envContent   = [
            `SPOTIFY_CLIENT_ID=${clientId.trim()}`,
            `SPOTIFY_CLIENT_SECRET=${clientSecret.trim()}`,
            `SPOTIFY_REDIRECT_URI=${redirectUri}`,
        ].join('\n') + '\n';
        fs.writeFileSync('.env', envContent);
        spotify.config.clientId     = clientId.trim();
        spotify.config.clientSecret = clientSecret.trim();
        spotify.config.redirectUri  = redirectUri;
        res.json({ ok: true, redirectUri });
    } catch (err) {
        console.error('[Setup/Spotify]', err.message);
        res.status(500).send('Could not write .env');
    }
});

// ─── OAuth ────────────────────────────────────────────────────────────────────

router.get('/spotify/login', (req, res) => {
    if (!spotify.config.clientId) return res.status(500).send('SPOTIFY_CLIENT_ID not set');
    const redirectUri = spotify.config.redirectUri || `http://${getServerIp()}:3000/spotify/callback`;
    const params = new URLSearchParams({
        response_type: 'code',
        client_id:     spotify.config.clientId,
        scope:         spotify.SP_SCOPES,
        redirect_uri:  redirectUri,
    });
    res.redirect('https://accounts.spotify.com/authorize?' + params);
});

router.get('/spotify/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.status(400).send('No code returned from Spotify');
    const redirectUri = spotify.config.redirectUri || `http://${getServerIp()}:3000/spotify/callback`;
    try {
        const r = await axios.post('https://accounts.spotify.com/api/token',
            new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
            {
                headers: {
                    'Content-Type':  'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(`${spotify.config.clientId}:${spotify.config.clientSecret}`).toString('base64'),
                },
            });
        spotify.saveSpTokens({
            access_token:  r.data.access_token,
            refresh_token: r.data.refresh_token,
            expires_at:    Date.now() + r.data.expires_in * 1000,
        });
        console.log('[Spotify] Authorised successfully');
        res.send('<h2>Spotify connected. You can close this tab.</h2>');
    } catch (err) {
        console.error('[Spotify] Auth error:', err.response?.data || err.message);
        res.status(502).send('Spotify auth failed: ' + (err.response?.data?.error_description || err.message));
    }
});

router.get('/spotify/status', (req, res) =>
    res.json({ connected: !!spotify.spTokens(), hasClientId: !!spotify.config.clientId }));

// ─── Playback control ─────────────────────────────────────────────────────────

router.post('/spotify/seek', async (req, res) => {
    const { position_ms } = req.body;
    if (position_ms === undefined) return res.status(400).send('position_ms required');
    const token = await spotify.getSpAccessToken();
    if (!token) return res.status(401).send('Not authenticated with Spotify');
    try {
        await axios.put(`https://api.spotify.com/v1/me/player/seek?position_ms=${Math.round(position_ms)}`, {},
            { headers: { Authorization: 'Bearer ' + token } });
        res.send('OK');
    } catch (err) { console.error('[Spotify/seek]', err.response?.data || err.message); res.status(502).send('Seek failed'); }
});

// ─── Queue ────────────────────────────────────────────────────────────────────

router.get('/spotify/queue', async (req, res) => {
    const token = await spotify.getSpAccessToken();
    if (!token) return res.status(401).send('Not authenticated with Spotify');
    try {
        const r     = await axios.get('https://api.spotify.com/v1/me/player/queue',
            { headers: { Authorization: 'Bearer ' + token }, timeout: 5000 });
        const queue = (r.data?.queue || []).slice(0, 10).map(t => ({
            name:   t.name,
            artist: t.artists?.map(a => a.name).join(', ') || '',
            artUrl: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || '',
            uri:    t.uri,
        }));
        res.json(queue);
    } catch (err) { console.error('[Spotify/queue]', err.response?.data || err.message); res.status(502).send('Queue fetch failed'); }
});

// ─── Liked songs ──────────────────────────────────────────────────────────────

router.get('/spotify/liked', async (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).send('id required');
    const token = await spotify.getSpAccessToken();
    if (!token) return res.status(401).send('Not authenticated');
    try {
        const r = await axios.get(`https://api.spotify.com/v1/me/tracks/contains?ids=${id}`,
            { headers: { Authorization: 'Bearer ' + token }, timeout: 3000 });
        res.json({ liked: r.data?.[0] === true });
    } catch (err) { console.error('[Spotify/liked]', err.response?.data || err.message); res.status(502).send('Failed'); }
});

router.post('/spotify/like', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).send('id required');
    const token = await spotify.getSpAccessToken();
    if (!token) return res.status(401).send('Not authenticated');
    try {
        await axios.put(`https://api.spotify.com/v1/me/tracks?ids=${id}`, {},
            { headers: { Authorization: 'Bearer ' + token } });
        res.send('Liked');
    } catch { res.status(502).send('Failed'); }
});

router.delete('/spotify/like', async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).send('id required');
    const token = await spotify.getSpAccessToken();
    if (!token) return res.status(401).send('Not authenticated');
    try {
        await axios.delete(`https://api.spotify.com/v1/me/tracks?ids=${id}`,
            { headers: { Authorization: 'Bearer ' + token }, data: { ids: [id] } });
        res.send('Unliked');
    } catch { res.status(502).send('Failed'); }
});

module.exports = router;