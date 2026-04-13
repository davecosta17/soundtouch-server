import { state }            from './state.js';
import { applyStatus }      from './ui.js';
import { applyProgress }    from './spotify.js';

// ── WebSocket ─────────────────────────────────────────────────────────────────

let ws = null;

export function connectWS() {
    ws = new WebSocket(`ws://${location.host}`);

    ws.onopen  = () => document.getElementById('offlineBanner').style.display = 'none';
    ws.onclose = () => {
        document.getElementById('offlineBanner').style.display = '';
        setTimeout(connectWS, 3000);
    };

    ws.onmessage = e => {
        try {
            const msg = JSON.parse(e.data);
            if      (msg.type === 'status')   applyStatus(msg);
            else if (msg.type === 'progress') applyProgress(msg);
            else if (msg.type === 'sources')  { state.allSources = msg.sources; }
            else if (msg.type === 'info')     {
                document.getElementById('speakerName').textContent = msg.name.toUpperCase();
            }
        } catch {}
    };
}