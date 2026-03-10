# SoundTouch Local Server

A self-hosted Node.js server that replaces Bose's cloud dependency for SoundTouch speakers. Built ahead of Bose's cloud shutdown, it gives you full local control over your speaker from any browser on your network — no Bose account, no internet connection required.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Requirements](#requirements)
3. [Project Structure](#project-structure)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Running the Server](#running-the-server)
7. [Using the Web Interface](#using-the-web-interface)
8. [How Discovery Works](#how-discovery-works)
9. [How Radio Stations Work](#how-radio-stations-work)
10. [API Reference](#api-reference)
11. [WebSocket Events](#websocket-events)
12. [Troubleshooting](#troubleshooting)

---

## What This Does

The Bose SoundTouch Web API runs entirely over your local network on port 8090. This server acts as a bridge between that API and a web-based remote control you can open on any phone, tablet, or computer on the same network.

**Features:**
- Play, pause, skip, and control volume
- Switch between Bluetooth, AUX, and Wi-Fi sources
- Browse and play recently played content
- Add and manage internet radio stations
- Album art display with dynamic background colour (Spotify, radio)
- Bass, treble, and DSP equaliser controls (capability-dependent)
- Rename the speaker
- Real-time updates via WebSocket — no polling required

---

## Requirements

- **Node.js** v18 or later — [nodejs.org](https://nodejs.org)
- A **Bose SoundTouch** speaker connected to your local Wi-Fi network
- The server PC must be on the **same network** as the speaker (same router, not a guest network or separate VLAN)

---

## Project Structure

```
soundtouch-server/
├── server.js           # Main server — all API logic, discovery, WebSocket bridge
├── package.json        # Dependencies
├── stations.json       # Radio station list (created automatically if missing)
├── speaker-cache.json  # Auto-generated — stores last known speaker IP
└── public/
    └── index.html      # Web interface — served statically by Express
```

---

## Installation

**1. Clone or download the project**

```bash
git clone https://github.com/davecosta17/soundtouch-server.git
cd soundtouch-server
```

Or download and extract the ZIP, then open a terminal in the project folder.

**2. Install dependencies**

```bash
npm install
```

This installs four packages:
- `express` — HTTP server and static file serving
- `axios` — HTTP client for speaker API calls
- `ws` — WebSocket server (browser ↔ server) and client (server ↔ speaker)
- `multicast-dns` — mDNS querying for automatic speaker discovery

**3. Create a stations.json file**

The server requires a `stations.json` file in the project root. Create one with an empty array to start, or pre-populate it:

```json
[
  {
    "name": "BBC World Service",
    "url": "http://stream.live.vc.bbcmedia.co.uk/bbc_world_service"
  },
  {
    "name": "Classic FM",
    "url": "http://media-ice.musicradio.com/ClassicFMMP3"
  }
]
```

You can also add stations directly through the web interface — no manual editing required after initial setup.

---

## Configuration

### Automatic (recommended)

No configuration needed. On first run the server sends mDNS queries every 5 seconds to find the speaker. Once found, the IP is saved to `speaker-cache.json` and reused on every subsequent start — the cache is validated with a quick ping before being trusted.

### Manual IP override (if mDNS is blocked)

mDNS uses UDP multicast on port 5353. On some Windows machines, Windows Firewall blocks this traffic. If the server prints `[mDNS] Querying...` indefinitely without finding the speaker, set the IP manually:

**Windows:**
```cmd
set SPEAKER_IP=192.168.1.x
npm start
```

**Mac / Linux:**
```bash
SPEAKER_IP=192.168.1.x npm start
```

Replace `192.168.1.x` with your speaker's actual IP address, which you can find in your router's connected devices list.

Once the server finds the speaker (either via mDNS or manual IP), it writes `speaker-cache.json` and subsequent starts will be instant.

### Subnet scanning fallback

If mDNS fails and no `SPEAKER_IP` is set, the server waits 15 seconds then scans every IP on all detected local subnets (e.g. `192.168.1.1–254`), probing port 8090 in parallel batches. This takes around 7 seconds to complete and runs every 60 seconds until the speaker is found. After discovery the cache is written and scanning stops.

---

## Running the Server

```bash
npm start
```

On a successful start you should see something like:

```
[mDNS] Querying for _soundtouch._tcp.local…
[Cache] Last known IP: 192.168.1.169 — validating…
SoundTouch Server running on port 3000
[Cache] Confirmed — speaker still at 192.168.1.169
[Discovery] Speaker "SoundTouch" found at 192.168.1.169
[SpeakerWS] Connecting to ws://192.168.1.169:8080
[SpeakerWS] Connected
[Caps] Bass:true Tone:false DSP:false
```

Open **http://localhost:3000** in a browser to access the interface. From other devices on your network, use your PC's local IP instead of `localhost`, e.g. **http://192.168.1.50:3000**.

---

## Using the Web Interface

### Main Screen

The main screen is always visible and shows:

- **Top bar** — hamburger menu (left), speaker name (centre, tap to rename), power button (right)
- **Now Playing** — when album art is available (Spotify, some radio) the art fills the screen with a dynamic background colour extracted from it. When there is no art (Bluetooth, AUX, standby) a frosted card shows the track title, artist, and album
- **Source label** — shows the active source, e.g. "Bluetooth · TV" or "Spotify Connect"
- **Elapsed timer & progress bar** — appears during playback, resets on track change
- **Transport controls** — previous, play/pause, next
- **Volume row** — mute toggle (speaker icon, left), volume slider, max volume icon (right)
- **Source tabs** — quick-switch between Bluetooth, AUX, and Wi-Fi sources

### Renaming the Speaker

Tap the speaker name at the top of the screen. An inline text field appears pre-filled with the current name. Press **Enter** to save or **Esc** to cancel. The new name is written to the speaker's memory and persists after a reboot.

### Hamburger Menu (Drawer)

Tap the hamburger icon (top left) to open the slide-in drawer. It contains four sections:

**Recently Played** — last 10 items played on the speaker regardless of source. Tap any item to resume it immediately. The list updates automatically whenever something new is played.

**Radio Stations** — your saved internet radio stations. Tap a station to play it. Use the × button to remove a station. Add new stations using the form at the bottom — enter a name and a direct stream URL (must be an `http://` or `https://` stream, not a playlist page).

**Sources** — all sources the speaker reports, with their current status (Ready / Unavailable). Tap a Ready source to switch to it. The active source is highlighted.

**EQ** — equaliser controls. Only sections supported by your speaker are shown:
- *Bass* — available on most SoundTouch models
- *Tone* (Bass + Treble) — available on models with full tone controls
- *Audio Mode* — Normal, Direct, Dialog, Night — available on soundbars

---

## How Discovery Works

The server uses three mechanisms in priority order:

1. **Cached IP** — on startup, if `speaker-cache.json` exists, it pings the cached IP's `/info` endpoint (2.5s timeout). If it responds, the speaker is considered found immediately and mDNS is skipped.

2. **mDNS** — active PTR queries are sent for `_soundtouch._tcp.local` every 5 seconds until the speaker responds. After discovery, queries slow to every 30 seconds as a heartbeat to detect IP changes.

3. **Subnet scan** — if neither of the above finds the speaker within 15 seconds, all non-loopback IPv4 subnets on the machine are scanned in parallel batches of 30, probing port 8090 with a 800ms timeout. Rescans every 60 seconds until found.

Once discovered, `speaker-cache.json` is written and reused on future starts.

---

## How Radio Stations Work

The Bose cloud previously served station stream metadata (artwork, stream URL) from `content.api.bose.io`. Since that service shuts down with the cloud, this server replaces it entirely.

When you play a radio station, the server tells the speaker to load a `LOCAL_INTERNET_RADIO` content item pointing to `http://[your-server]/station-data/[id]`. The speaker fetches that URL from your server, which returns the station's name and stream URL from your local `stations.json`. The speaker then connects directly to the stream URL.

This means radio playback works completely offline (relative to the internet) — as long as the stream itself is accessible, no Bose cloud involvement is needed.

---

## API Reference

All endpoints are on port 3000. Successful responses return HTTP 200; errors return HTTP 400 (bad input) or 502 (speaker unreachable).

### Playback

| Endpoint | Method | Description |
|---|---|---|
| `/power` | GET | Toggle power on/off |
| `/play` | GET | Play |
| `/pause` | GET | Pause |
| `/playpause` | GET | Toggle play/pause |
| `/next` | GET | Skip to next track |
| `/prev` | GET | Previous track |
| `/repeat/:mode` | GET | Set repeat — `one`, `all`, `off` |
| `/shuffle/:mode` | GET | Set shuffle — `on`, `off` |

### Volume

| Endpoint | Method | Description |
|---|---|---|
| `/volume/:level` | GET | Set volume 0–100 |
| `/mute` | GET | Toggle mute |

### Sources

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/sources` | GET | — | List all sources with status |
| `/source` | POST | `{ source, sourceAccount, location }` | Switch to a source |

### Status & Discovery

| Endpoint | Method | Description |
|---|---|---|
| `/status` | GET | Current playback status as JSON |
| `/discovery` | GET | `{ discovered, name, ip }` |

### Speaker Settings

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/name` | POST | `{ name }` | Rename the speaker |

### EQ

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/eq` | GET | — | Current EQ values (null fields = not supported) |
| `/eq/bass` | POST | `{ value }` | Set bass level |
| `/eq/treble` | POST | `{ value }` | Set treble level |
| `/eq/mode` | POST | `{ mode }` | Set DSP mode |

### Presets

| Endpoint | Method | Description |
|---|---|---|
| `/presets` | GET | Raw preset XML from speaker |
| `/preset/:num` | GET | Activate preset 1–6 |

### Recents

| Endpoint | Method | Description |
|---|---|---|
| `/recents` | GET | Last 10 played items as JSON |

### Radio Stations

| Endpoint | Method | Body | Description |
|---|---|---|---|
| `/stations` | GET | — | All stations as JSON array |
| `/stations` | POST | `{ name, url }` | Add a new station |
| `/stations/:id` | DELETE | — | Remove a station by index |
| `/radio/:id` | GET | — | Play station by index |
| `/station-data/:id` | GET | — | Station metadata (used by speaker internally) |

### Art Proxy

| Endpoint | Method | Description |
|---|---|---|
| `/art-proxy?url=...` | GET | Proxies album art through the server (avoids CORS for canvas colour extraction) |

---

## WebSocket Events

The server exposes a WebSocket on the same port as HTTP (port 3000). The browser interface connects to it automatically. All events are JSON.

### Server → Browser

| `type` | Payload | Description |
|---|---|---|
| `status` | `{ source, wifiType, track, artist, album, stationName, bluetoothDevice, artUrl, status, volume }` | Playback state update |
| `eq` | `{ bass, treble, dsp }` | EQ state update (null fields = not supported) |
| `sources` | `{ sources: [...] }` | Sources list updated |
| `recents` | `{ recents: [...] }` | Recents list updated |
| `info` | `{ name }` | Speaker name changed |

On initial browser connection, all five event types are sent immediately so the UI populates without waiting for the next change.

### How it works internally

The server maintains its own WebSocket connection to the speaker on port 8080 (protocol `gabbo`). The speaker pushes change notifications — `nowPlayingUpdated`, `volumeUpdated`, `bassUpdated`, `sourcesUpdated`, `recentsUpdated`, `infoUpdated` — which the server receives, fetches the updated data, and rebroadcasts to all connected browsers.

A 3-second fallback poll runs when the speaker WebSocket is disconnected. A 15-second heartbeat poll runs regardless to catch any missed events.

---

## Troubleshooting

**Speaker not found / stays on "Connecting…"**

The mDNS queries are firing but getting no response. This is usually Windows Firewall blocking UDP multicast on port 5353. Use the `SPEAKER_IP` environment variable to bypass discovery (see [Configuration](#configuration)). Alternatively, allow Node.js through Windows Defender Firewall → Allow an app → add `node.exe`, ticking both Private and Public.

**"SPEAKER OFFLINE — RETRYING…" banner showing even when speaker is on**

This means the browser's WebSocket connection to the server dropped. It reconnects automatically every 3 seconds. If it persists, check that the server is still running in the terminal.

**Album art not showing on Spotify**

Open `http://localhost:3000/status` and check the `artUrl` field. If it is `null`, the speaker is not reporting art (this can happen briefly at track start while the art loads). If it has a URL, try a hard refresh in the browser (Ctrl+Shift+R) to clear the cached page.

**Radio stations not playing**

The stream URL must be a direct audio stream, not a website or playlist page. URLs ending in `.mp3`, `.aac`, `.ogg`, or with `/stream` in the path typically work. The speaker connects to the stream directly, so the URL must be accessible from the speaker's network, not just the server's.

**EQ controls not showing**

EQ controls are capability-gated — the server checks `/capabilities` and `/bassCapabilities` on the speaker at startup and only exposes what it reports as supported. If no EQ controls appear in the drawer, your speaker model does not support them via the API.

**Mute state out of sync after restart**

The mute icon in the UI is initialised as unmuted on page load. If the speaker is actually muted when you open the page, the icon will be wrong until you tap it once. A future improvement would be to read the mute state from `/volume` on connect.