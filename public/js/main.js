import { connectWS }                              from './ws.js';
import { fetchSpeakerName, startRename,
         cancelRename, commitRename,
         openDrawer, closeDrawer,
         toggleWifiPopover, closeWifiPopover,
         switchSpotify, openRadioDrawer,
         dismissUpNext }                           from './ui.js';
import { togglePlay, handleBluetoothTab,
         switchSource, onVolumeInput,
         setVolume, toggleMute }                   from './playback.js';
import { spSeek, toggleShuffle, cycleRepeat,
         toggleLike, openQueueDrawer,
         closeQueueDrawer, closeQueueConfirm,
         executeSkip, openSpWizard, closeSpWizard,
         spWizardNext, spWizardBack,
         copyRedirectUri, spSaveCredentials,
         spAuthorise }                             from './spotify.js';
import { rbSearch, addStation,
         initDragHandlers }                        from './radio.js';

// ── Event bindings ─────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

    // Top bar
    document.querySelector('[title="Menu"]')
        ?.addEventListener('click', openDrawer);
    document.getElementById('btnPower')
        ?.addEventListener('click', () => fetch('/power'));
    document.getElementById('speakerName')
        ?.addEventListener('click', startRename);
    document.getElementById('nameInput')
        ?.addEventListener('keydown', e => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') cancelRename();
        });
    document.getElementById('nameInput')
        ?.addEventListener('blur', cancelRename);

    // Drawer
    document.getElementById('drawerOverlay')
        ?.addEventListener('click', closeDrawer);
    document.querySelector('.drawer-close')
        ?.addEventListener('click', () => closeDrawer());

    // Transport
    document.getElementById('btnPlay')
        ?.addEventListener('click', togglePlay);
    document.querySelector('[title="Previous"]')
        ?.addEventListener('click', () => fetch('/prev'));
    document.querySelector('[title="Next"]')
        ?.addEventListener('click', () => fetch('/next'));
    document.getElementById('btnShuffle')
        ?.addEventListener('click', toggleShuffle);
    document.getElementById('btnRepeat')
        ?.addEventListener('click', cycleRepeat);

    // Volume
    document.getElementById('muteBtn')
        ?.addEventListener('click', toggleMute);
    document.getElementById('volumeSlider')
        ?.addEventListener('input',  e => onVolumeInput(e.target.value));
    document.getElementById('volumeSlider')
        ?.addEventListener('change', e => setVolume(e.target.value));

    // Source tabs
    document.getElementById('tabBluetooth')
        ?.addEventListener('click', handleBluetoothTab);
    document.getElementById('tabAux')
        ?.addEventListener('click', () => switchSource('AUX', 'AUX'));
    document.getElementById('tabWifi')
        ?.addEventListener('click', toggleWifiPopover);

    // Wi-Fi popover
    document.querySelector('.wifi-popover-item.spotify')
        ?.addEventListener('click', switchSpotify);
    document.querySelector('.wifi-popover-item.radio')
        ?.addEventListener('click', openRadioDrawer);

    // Spotify progress bar (seek)
    document.getElementById('spBarRow')
        ?.addEventListener('click', spSeek);

    // Heart / queue icons
    document.getElementById('btnHeart')
        ?.addEventListener('click', toggleLike);
    document.getElementById('btnQueue')
        ?.addEventListener('click', openQueueDrawer);

    // Queue drawer
    document.getElementById('queueOverlay')
        ?.addEventListener('click', closeQueueDrawer);
    document.querySelector('.queue-drawer-close')
        ?.addEventListener('click', () => closeQueueDrawer());
    document.getElementById('queueConfirmOk')
        ?.addEventListener('click', executeSkip);
    document.querySelector('.queue-confirm-btn.cancel')
        ?.addEventListener('click', closeQueueConfirm);

    // Up Next flyout
    document.getElementById('upnextFlyout')
        ?.addEventListener('click', dismissUpNext);

    // Radio stations add form
    document.querySelector('.btn-add-station')
        ?.addEventListener('click', addStation);
    document.getElementById('rbSearchBtn')
        ?.addEventListener('click', rbSearch);
    document.getElementById('rbSearchInput')
        ?.addEventListener('keydown', e => { if (e.key === 'Enter') rbSearch(); });

    // Spotify setup wizard
    document.getElementById('spWizardOverlay')
        ?.addEventListener('click', e => { if (e.target === document.getElementById('spWizardOverlay')) closeSpWizard(); });
    document.querySelector('.sp-wizard-close')
        ?.addEventListener('click', closeSpWizard);

    // Wizard step buttons (wired by id since they're always in DOM)
    const wizardBtns = {
        spStep0: [['primary', spWizardNext], ['secondary', closeSpWizard]],
        spStep1: [['primary', () => { window.open('https://developer.spotify.com/dashboard','_blank'); spWizardNext(); }],
                  ['secondary', spWizardNext]],
        spStep2: [['primary', spSaveCredentials], ['secondary', spWizardBack]],
        spStep3: [['primary', spAuthorise],       ['secondary', spWizardBack]],
    };
    Object.entries(wizardBtns).forEach(([stepId, btns]) => {
        const step = document.getElementById(stepId);
        if (!step) return;
        btns.forEach(([cls, fn], i) => {
            step.querySelectorAll('.sp-wizard-btn')[i]?.addEventListener('click', fn);
        });
    });
    document.querySelector('.sp-copy-btn')
        ?.addEventListener('click', copyRedirectUri);
    document.getElementById('spSaveBtn')
        ?.addEventListener('click', spSaveCredentials);

    // Drag handlers (delegated via list)
    initDragHandlers();

    // Boot
    connectWS();
    fetchSpeakerName();
});