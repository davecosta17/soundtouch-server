// ── Shared UI state ───────────────────────────────────────────────────────────

export const state = {
    isPlaying:      false,
    currentSource:  null,
    isMuted:        false,
    allSources:     [],
    lastArtUrl:     null,
    nameFetched:    false,

    // Spotify progress
    spDurationMs:   0,
    spProgressMs:   0,
    spIsPlaying:    false,
    spTickInterval: null,

    // Shuffle / repeat
    shuffleOn:  false,
    repeatMode: 'off',

    // Liked songs
    currentTrackId: null,
    isLiked:        false,

    // Spotify setup
    spStatus:     { connected: false, hasClientId: false },
    spWizardStep: 0,
    spServerIp:   window.location.hostname,

    // Queue
    queueData:         [],
    queueConfirmSkips: 0,
    upnextTimer:       null,
    upnextShown:       false,
    lastNextTrack:     null,

    // Stations / presets
    stationsData: [],
    presetsData:  Array(6).fill(null),

    // Radio browser
    rbData:      [],
    rbActiveIdx: null,

    // Country browse
    detectedCountryCode: null,
    selectedCountryCode: null,

    // Drag-to-reorder
    dragSrcIdx:  null,
    dragGhost:   null,
    dragOffsetY: 0,
    dragOffsetX: 0,
};