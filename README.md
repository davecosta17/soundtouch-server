# Speaker Remote

> **Disclaimer:** This is an unofficial personal project and is not affiliated with, endorsed by, or in any way associated with Bose Corporation. SoundTouch and Bose are trademarks of Bose Corporation. This tool is intended for personal use only to control your own speaker on your own network.

A self-hosted Node.js server that replaces Bose's cloud dependency for SoundTouch speakers. Built ahead of Bose's cloud shutdown in early 2026, it gives you full local control over your speaker from any browser on your network — no Bose account, no internet connection required for core functionality.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Requirements](#requirements)
3. [Project Structure](#project-structure)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Spotify Integration](#spotify-integration)
7. [Running the Server](#running-the-server)
8. [Using the Web Interface](#using-the-web-interface)
9. [How Discovery Works](#how-discovery-works)
10. [How Radio Stations Work](#how-radio-stations-work)
11. [API Reference](#api-reference)
12. [WebSocket Events](#websocket-events)
13. [Troubleshooting](#troubleshooting)

---

## What This Does

The Bose SoundTouch Web API runs entirely over your local network on port 8090. This server acts as a bridge between that API and a web-based remote control you can open on any phone, tablet, or computer on the same network.

**Core features:**
- Play, pause, skip, repeat, shuffle, and control volume
- Switch between Bluetooth, AUX, and Wi-Fi sources via a tab bar
- Real-time updates via WebSocket — no polling required
- Album art display with dynamic background colour extraction
- Mute state sync, power button illumination, and active source indicator
- Rename the speaker from the UI
- Install as a PWA on your home screen (Android and iOS)

**Radio:**
- Search and play from Radio Browser's open directory of 30,000+ stations with live stream verification
- Save stations with logos to a local list
- All radio metadata served locally — no Bose cloud dependency

**Spotify Connect (requires Spotify Developer credentials):**
- Real-time progress bar with seek support
- Shuffle and repeat state sync — buttons illuminate to reflect actual state
- Liked Songs heart icon — tap to like or unlike the current track
- Queue drawer — view up to 10 upcoming tracks, tap to skip to any of them
- "Up Next" flyout — slides in from the top 20 seconds before the track ends
- All Spotify features require a one-time OAuth authorisation (see [Spotify Integration](#spotify-integration))


---

## Requirements

- **Node.js** v18 or later — [nodejs.org](https://nodejs.org)
- A **Bose SoundTouch** speaker connected to your local Wi-Fi network
- The server machine must be on the **same network** as the speaker (same router — not a guest network or separate VLAN)
- **Spotify Premium** (optional) — required for Spotify Connect features

---

## Project Structure

```
soundtouch-server/
├── server.js               # Entry point — Express setup, WebSocket server, boots everything
├── package.json            # Dependencies
├── .env                    # Spotify credentials — not in repo, create from .env.example
├── .env.example            # Template for .env
├── stations.json           # Saved radio stations (created automatically if missing)
├── speaker-cache.json      # Auto-generated — not in repo, stores last known speaker IP
├── spotify-tokens.json     # Auto-generated — not in repo, stores Spotify OAuth tokens
├── lib/
│   ├── state.js            # All shared mutable server state
│   ├── helpers.js          # XML parsing, speaker URL, status parsing, helpers
│   ├── discovery.js        # mDNS queries, subnet scanner, IP cache
│   ├── speaker.js          # Speaker WebSocket bridge, capabilities, broadcast
│   ├── spotify.js          # Token management, progress poller
│   └── routes/
│       ├── playback.js     # Playback, volume, EQ, sources, presets, status routes
│       ├── radio.js        # Stations, radio browser, stream proxy, preset store
│       └── spotify.js      # OAuth, queue, liked songs, setup routes
└── public/
    ├── index.html          # Web interface — HTML structure only
    ├── manifest.json       # PWA manifest
    ├── sw.js               # Service worker for offline support
    ├── css/
    │   └── style.css       # All styles
    ├── js/
    │   ├── state.js        # Shared UI state (ES module)
    │   ├── ws.js           # WebSocket connection and message routing
    │   ├── ui.js           # Art mode, background, marquee, rename, drawer
    │   ├── playback.js     # Transport, volume, mute, source switching
    │   ├── spotify.js      # Progress, seek, liked songs, queue, setup wizard
    │   ├── radio.js        # Stations, presets, drag-reorder, radio browser
    │   └── main.js         # Event binding and app boot
    └── icons/
        ├── icon-192.png    # PWA icon
        └── icon-512.png    # PWA icon
```

Files excluded from the repository for security: `.env`, `spotify-tokens.json`, `speaker-cache.json`, `node_modules/`.

---

## Installation

**1. Clone or download the project**

```bash
git clone https://github.com/davecosta17/soundtouch-server.git
cd soundtouch-server
```

**2. Install dependencies**

```bash
npm install
```

This installs five packages:
- `express` — HTTP server and static file serving
- `axios` — HTTP client for speaker and Spotify API calls
- `ws` — WebSocket server (browser ↔ server) and client (server ↔ speaker)
- `multicast-dns` — mDNS querying for automatic speaker discovery
- `dotenv` — loads Spotify credentials from `.env`

**3. Create a stations.json file**

Create an empty `stations.json` in the project root to start, or pre-populate it:

```json
[
  {
    "name": "BBC World Service",
    "url": "http://stream.live.vc.bbcmedia.co.uk/bbc_world_service"
  }
]
```

You can add and remove stations directly from the web interface at any time.

**4. Configure Spotify (optional)**

Copy `.env.example` to `.env` and fill in your credentials. See [Spotify Integration](#spotify-integration) for the full setup steps.

---

## Configuration

### Automatic speaker discovery (recommended)

No configuration needed. On first run the server sends mDNS queries every 5 seconds to find the speaker. Once found, the IP is saved to `speaker-cache.json` and reused on every subsequent start — the cache is validated with a quick ping before being trusted.

### Manual IP override (if mDNS is blocked)

mDNS uses UDP multicast on port 5353. On some Windows machines, Windows Firewall blocks this. If the server prints `[mDNS] Querying...` indefinitely, set the IP manually:

**Windows:**
```cmd
set SPEAKER_IP=192.168.1.x
npm start
```

**Mac / Linux:**
```bash
SPEAKER_IP=192.168.1.x npm start
```

Replace `192.168.1.x` with your speaker's actual IP, found in your router's connected devices list.

### Subnet scanning fallback

If mDNS fails and no `SPEAKER_IP` is set, the server waits 15 seconds then scans all detected local subnets in parallel batches of 30, probing port 8090 with an 800ms timeout. Rescans every 60 seconds until the speaker is found.

---

## Spotify Integration

Spotify features (progress bar, queue, liked songs, shuffle/repeat sync) require a Spotify Developer app and a one-time authorisation.

**1. Create a Spotify Developer app**

Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create a new app. Under Settings, add the following Redirect URI:

```
http://127.0.0.1:3000/spotify/callback
```

Note: Spotify requires the loopback IP `127.0.0.1` — `localhost` is not permitted as of April 2025.

**2. Configure .env**

Copy `.env.example` to `.env` and fill in your credentials:

```
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/spotify/callback
```

**3. Authorise the app**

Start the server, then open the following URL **in a browser on the machine running the server** (not from your phone):

```
http://127.0.0.1:3000/spotify/login
```

This redirects to Spotify's authorisation page. Grant permission and you'll be redirected back. The server saves your tokens to `spotify-tokens.json` automatically. You only need to do this once — tokens refresh automatically every hour.

**4. Verify**

Open `http://localhost:3000/spotify/status` — it should return `{ "connected": true }`.

---

## Running the Server

```bash
npm start
```

On a successful start you should see something like:

```
SoundTouch Server running on port 3000
[mDNS] Querying for _soundtouch._tcp.local…
[Cache] Last known IP: 192.168.1.169 — validating…
[Cache] Confirmed — speaker still at 192.168.1.169
[Discovery] Speaker "SOUNDWAVE" found at 192.168.1.169
[SpeakerWS] Connecting to ws://192.168.1.169:8080
[SpeakerWS] Connected
[Caps] Bass:true Tone:false DSP:false
```

Open **http://localhost:3000** in a browser on the server machine, or **http://[server-ip]:3000** from any other device on the same network.

---

## Using the Web Interface

### Main screen

The interface adapts based on what's playing:

**Art mode** — when album art is available (Spotify Connect, some radio stations), the art fills the screen as a large square image. The background colour is dynamically extracted from the art. Below the art, the track name scrolls horizontally if too long. The artist, album, heart icon (Spotify only), and queue icon (Spotify only) sit in a row below the track name.

**Card mode** — when no art is available (Bluetooth, AUX, standby), a frosted glass card shows the track title, artist, and album.

Both modes share the same bottom section: source label or Spotify progress bar, transport controls, volume slider with mute toggle, and source tabs.

### Top bar

Hamburger menu (left) | speaker name (centre, tap to rename) | power button (right). The power button glows blue when the speaker is active on any source.

### Source tabs

Three tabs at the bottom switch the active input:

- **Bluetooth** — connects to the last paired device
- **AUX** — switches to the AUX input
- **Wi-Fi** — opens a small popover with two options: Spotify Connect and Radio

The active tab glows blue.

### Transport controls

Laid out as: shuffle | previous | play/pause | next | repeat

Shuffle and repeat illuminate blue when active. Repeat cycles off → all → one → off. During Spotify playback both buttons reflect actual Spotify state and update within 2 seconds if changed from another device.

### Spotify progress bar

Replaces the source label during Spotify playback. Shows elapsed time left, total duration right. Tap to seek.

### Heart icon (Spotify only)

Left of artist/album info. Faintly visible when not liked, glows blue when liked. Tap to toggle. Optimistic update — reverts if the API call fails.

### Queue icon (Spotify only)

Right of artist/album info. Opens a right-side drawer showing up to 10 upcoming tracks. Tap any track to skip to it — a confirmation dialog shows how many tracks will be skipped.

### Up Next flyout

Slides down from the top of the screen 20 seconds before the current track ends. Shows the next track's art, name, and artist. Auto-dismisses after 5 seconds or tap to dismiss early.

### Hamburger drawer

Contains one section — **Radio Stations**. Search bar at the top queries Radio Browser's directory. Results show station logo, name, country, codec, and bitrate (live-verified only). Tap a result to expand Play Now / Save options. Saved stations appear below with logos. Tap to play, × to remove. Add stations manually via the form at the bottom.

### Renaming the speaker

Tap the speaker name in the top bar. An inline text field appears. Press Enter to save or Esc to cancel. The name persists after a reboot.

### Installing as a PWA

**Android (Chrome):** tap the three-dot menu → "Add to Home Screen" or "Install app".

**iOS (Safari):** tap Share → "Add to Home Screen".

The app installs under the name "Speaker Remote" and launches full-screen.

---

## How Discovery Works

The server uses three mechanisms in priority order:

1. **Cached IP** — pings the last known IP on startup with a 2.5s timeout. If it responds, discovery is complete immediately.

2. **mDNS** — PTR queries for `_soundtouch._tcp.local` every 5 seconds until found, then every 30 seconds as a heartbeat.

3. **Subnet scan** — fires after 15 seconds if mDNS fails. Scans all local subnets in parallel batches of 30 with an 800ms timeout per host. Retries every 60 seconds.

---

## How Radio Stations Work

When a station plays, the speaker fetches a metadata endpoint on our server which returns the exact JSON format Bose's cloud used:

```json
{
  "audio": { "hasPlaylist": false, "isRealtime": true, "streamUrl": "http://..." },
  "imageUrl": "",
  "name": "Station Name",
  "streamType": "liveRadio"
}
```

The speaker connects directly to `streamUrl`. HTTPS streams are automatically proxied through the server over plain HTTP since SoundTouch firmware cannot connect to HTTPS audio directly.

---

## API Reference

All endpoints on port 3000. HTTP 200 on success, 400 on bad input, 502 on speaker/Spotify unreachable.

### Playback

| Endpoint | Method | Description |
|---|---|---|
| `/power` | GET | Toggle power |
| `/play` | GET | Play |
| `/pause` | GET | Pause |
| `/playpause` | GET | Toggle play/pause |
| `/next` | GET | Next track |
| `/prev` | GET | Previous track |
| `/repeat/:mode` | GET | `one`, `all`, or `off` |
| `/shuffle/:mode` | GET | `on` or `off` |

### Volume

| Endpoint | Method | Description |
|---|---|---|
| `/volume/:level` | GET | Set volume 0–100 |
| `/mute` | GET | Toggle mute |

### Sources

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/sources` | GET | — | List all sources |
| `/source` | POST | `{ source, sourceAccount, location }` | Switch source |

### Status & Discovery

| Endpoint | Method | Description |
|---|---|---|
| `/status` | GET | Current playback state as JSON |
| `/discovery` | GET | `{ discovered, name, ip }` |

### Speaker Settings

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/name` | POST | `{ name }` | Rename speaker |

### Presets

| Endpoint | Method | Description |
|---|---|---|
| `/presets` | GET | Raw preset XML |
| `/preset/:num` | GET | Activate preset 1–6 |

### Radio Stations

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/stations` | GET | — | All saved stations |
| `/stations` | POST | `{ name, url, favicon }` | Add station |
| `/stations/:id` | DELETE | — | Remove station |
| `/radio/:id` | GET | — | Play station by index |
| `/orion/station?data=` | GET | — | Station metadata endpoint (used by speaker) |
| `/station-data/:id` | GET | — | Legacy station metadata |

### Radio Browser

| Endpoint | Method | Description |
|---|---|---|
| `/radio-browser/search?q=` | GET | Search — returns up to 10 live-verified stations |
| `/radio-browser/play` | POST | `{ streamUrl, name, favicon }` |
| `/radio/stream-proxy?url=` | GET | HTTPS→HTTP audio proxy |
| `/radio/stream-data?url=&name=` | GET | Dynamic metadata endpoint |

### Art Proxy

| Endpoint | Method | Description |
|---|---|---|
| `/art-proxy?url=` | GET | Proxy album art for canvas colour extraction |

### Spotify

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/spotify/login` | GET | — | Redirect to Spotify OAuth |
| `/spotify/callback` | GET | — | OAuth callback — saves tokens |
| `/spotify/status` | GET | — | `{ connected, hasClientId }` |
| `/spotify/seek` | POST | `{ position_ms }` | Seek in current track |
| `/spotify/queue` | GET | — | Up to 10 upcoming tracks |
| `/spotify/liked?id=` | GET | — | `{ liked: bool }` |
| `/spotify/like` | POST | `{ id }` | Save to Liked Songs |
| `/spotify/like` | DELETE | `{ id }` | Remove from Liked Songs |

---

## WebSocket Events

WebSocket on port 3000. UI connects automatically. All messages are JSON.

### Server → Browser

| `type` | Key fields | Description |
|---|---|---|
| `status` | `source, wifiType, track, artist, album, stationName, bluetoothDevice, artUrl, status, volume, muted` | Full playback state |
| `eq` | `bass, treble, dsp` | EQ state from speaker — null fields indicate unsupported controls |
| `sources` | `sources[]` | Sources list |
| `info` | `name` | Speaker renamed |
| `progress` | `progress_ms, duration_ms, is_playing, shuffle_state, repeat_state, next_track, track_id` | Spotify playback state (every 2s) |

`status`, `eq`, and `sources` are sent immediately on initial browser connection. The `eq` broadcast is sent for speaker-connected clients that implement EQ controls.

### How it works internally

The server maintains a WebSocket to the speaker on port 8080 (protocol `gabbo`). Speaker push notifications — `nowPlayingUpdated`, `volumeUpdated`, `bassUpdated`, `sourcesUpdated`, `infoUpdated` — trigger a fetch and rebroadcast to all connected browsers. A 3-second fallback poll runs when the speaker WebSocket is down. A 15-second heartbeat poll runs regardless.

During Spotify playback a separate 2-second poller hits the Spotify Web API for progress, shuffle, repeat, and track ID. A second call to `/me/player/queue` fires only when within 25 seconds of track end to populate the Up Next flyout.

---

## Troubleshooting

**Speaker not found / stays on "Connecting…"**

Windows Firewall is likely blocking UDP multicast on port 5353. Use the `SPEAKER_IP` environment variable to bypass discovery, or allow Node.js through Windows Defender Firewall → Allow an app → add `node.exe` with both Private and Public checked.

**"SPEAKER OFFLINE — RETRYING…" banner**

The browser WebSocket connection dropped. It reconnects automatically every 3 seconds. If it persists, check the server is still running.

**Album art not showing on Spotify**

Check `http://localhost:3000/status` for the `artUrl` field. If null, the speaker hasn't reported art yet — wait a moment and it should appear. Try a hard refresh (Ctrl+Shift+R) if it still doesn't show.

**Radio stations not playing**

For manually added stations, the URL must be a direct audio stream — `.mp3`, `.aac`, `.ogg`, or a path containing `/stream`. For Radio Browser results, streams are pre-verified but must be reachable from your network. If a station buffers indefinitely, try a different result for the same station.

**Spotify features not working**

Check `http://localhost:3000/spotify/status`. If `connected` is false, open `http://127.0.0.1:3000/spotify/login` in a browser on the server machine to re-authorise. If `hasClientId` is false, your `.env` file is missing or not being loaded — ensure it exists in the project root.

**Spotify progress bar not appearing**

The progress bar only shows during active Spotify Connect playback. Make sure you have started playback from the Spotify app to the speaker. The poller starts automatically once the server detects Spotify as the active source.