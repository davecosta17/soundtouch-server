'use strict';

// ─── Shared server state ───────────────────────────────────────────────────────
// All mutable state lives here so modules can import and mutate it safely.

const state = {
    // Speaker discovery
    speakerIp:        null,
    speakerName:      null,
    discovered:       false,
    wsFailCount:      0,
    httpFailCount:    0,

    // Speaker WebSocket
    speakerWs:        null,
    speakerWsReady:   false,
    speakerWsTarget:  null,

    // Capabilities (fetched once on discovery)
    caps: {
        hasBass:         false,
        hasToneControls: false,
        hasDspControls:  false,
        bassMin:   -9,
        bassMax:    9,
        bassDefault: 0,
    },

    // Browser WebSocket clients
    browserClients: new Set(),

    // Spotify
    spPollInterval: null,
};

module.exports = state;