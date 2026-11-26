// Only active when the page is opened in a plain browser (no Electron preload).
// Lets you preview the UI with fake media + weather data.
if (!window.islandAPI) {
  document.documentElement.classList.add('preview');
  const start = performance.now();
  let status = 'Playing', pos = 41;
  // Preview only. ?art=square | wide | tall draws a real cover of that shape (a ring in the middle, so any stretching shows
  // up as an oval, and a marker in each corner, so cropping is visible). ?art=bad sends data that cannot be decoded.
  const ARTQ = new URLSearchParams(location.search).get('art');
  function drawCover(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    const bg = g.createLinearGradient(0, 0, w, h); bg.addColorStop(0, '#1f7a6e'); bg.addColorStop(1, '#0d3b52');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const r = Math.min(w, h) * 0.32;
    g.lineWidth = Math.min(w, h) * 0.08; g.strokeStyle = '#f2c14e';
    g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2); g.stroke();                      // a true circle: oval = distorted
    g.fillStyle = '#ffffff'; const m = Math.min(w, h) * 0.1;
    for (const [x, y] of [[0, 0], [w - m, 0], [0, h - m], [w - m, h - m]]) g.fillRect(x, y, m, m);   // corner markers
    return c.toDataURL('image/png');
  }
  const ART = ARTQ === 'square' || ARTQ === 'ok' ? drawCover(300, 300)
    : ARTQ === 'wide' ? drawCover(480, 270)
    : ARTQ === 'tall' ? drawCover(270, 480)
    : ARTQ === 'array' ? [drawCover(300, 300), null]                 // the suspected helper bug: ["data:...", null]
    : ARTQ === 'bad' ? 'data:image/jpeg;base64,AAAAAAAAAAAA' : '';
  let listener = () => {};
  const send = () => listener({
    title: 'Paper Sky', artist: 'Lumen Coast', status, shuffle: false, repeat: 'None', app: 'Spotify.exe',
    pos: pos + (status === 'Playing' ? (performance.now() - start) / 1000 : 0), dur: 193, key: 'paper-sky',
    ...(ART ? { art: ART } : {}),
  });
  const hours = Array.from({ length: 48 }, (_, i) => `2026-11-24T${String(i % 24).padStart(2, '0')}:00`);
  // ---- settings (preview): defaults mirror settingsStore.js. ?theme=dark|light, ?s={json patch}, window.__settings(patch) from tests
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const merge = (a, b) => { const o = { ...a }; for (const k of Object.keys(b)) o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; return o; };
  const DEFAULT_SETTINGS = {
    motion: 'expressive', placement: { edge: 'top', monitor: 'primary' }, dns: { tile: true }, quiet: { dnd: false, mute: false }, settingsHotkey: '', openOn: 'click', autoHide: false, hideInFullscreen: true,
    theme: { mode: 'auto', variant: 'vibrant', seed: '#1FB5A5', preset: 'teal' },
    size: { idle: { w: 148, h: 32 }, open: { w: 520, h: 264 }, adaptive: true },
    tabs: ['home', 'music', 'weather', 'timer', 'usage', 'clipboard', 'localsend'], hiddenTabs: ['clipboard', 'localsend'],
    mascot: { enabled: true, delay: 8 }, hotkey: 'Control+Alt+Space', clipboard: { enabled: false, max: 12, images: false, paste: false, persistPins: false },
    battery: { warn: true }, units: { temp: 'c', clock: 'auto' }, calendar: { weekStart: 'auto' }, usage: { forecast: true, resetAlert: true }, approvals: { enabled: true, wait: 30 }, agents: { quietAlert: false }, split: { enabled: true, lead: 'auto' }, privacy: { dot: true }, music: { artColors: true }, shortcuts: { apps: [{ name: 'Notepad', path: 'C:\\Windows\\notepad.exe' }, { name: 'Calculator', path: 'C:\\Windows\\System32\\calc.exe' }] }, dnsp: { presets: [], custom: [] }, google: { clientId: '', clientSecret: '', calendar: true, tasks: true, mail: true, mailToast: true }, events: { url: '' }, notifications: { mirror: false, apps: '' }, hud: { volume: true }, devices: { toasts: true, charger: true, battery: true, lowAt: 15 }, localsend: { enabled: false, receive: false, alias: '', saveDir: '', autoAccept: false }, drop: { enabled: true }, shelf: { enabled: true, max: 12 }, captures: { enabled: false }, downloads: { enabled: false }, network: { enabled: false, host: '1.1.1.1', vpnAlerts: true }, focus: { sync: false }, notes: { enabled: false, hotkey: 'Control+Alt+N', file: '' }, urltools: { enabled: true, shorten: false }, mixer: { enabled: false }, meetings: { dnd: false }, updates: { check: true }, home: { calendar: true, side: 'left', first: 'weather', second: 'music', countdown: { label: '', date: '' } },
  };
  const qs = new URLSearchParams(location.search);
  let settings = DEFAULT_SETTINGS;
  try { if (qs.get('s')) settings = merge(settings, JSON.parse(qs.get('s'))); } catch (e) { /* ignore a bad preview override */ }
  if (qs.get('theme')) settings = merge(settings, { theme: { mode: qs.get('theme') } });
  const settingsListeners = [];
  window.__settings = (patch) => { settings = merge(settings, patch); settingsListeners.forEach((cb) => cb(settings)); return settings; };
  const TINY = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="54"><rect width="96" height="54" fill="#2a7f74"/><circle cx="48" cy="27" r="14" fill="#f2c14e"/></svg>');
  let clipItems = qs.get('clip') ? [
    { id: 1, kind: 'text', text: 'npm run build:theme', pinned: true }, { id: 2, kind: 'image', thumb: TINY, pinned: false },
    { id: 3, kind: 'text', text: 'https://example.com/a/long/link/that/keeps/going', pinned: false }, { id: 4, kind: 'text', text: 'Meeting moved to 15:30', pinned: false }, { id: 5, kind: 'text', text: 'Ctrl+Alt+Space', pinned: false }] : [];

  const clipCbs = [];
  window.__mixer = (l) => { mixer = l; };
  const nDev = Number(qs.get('ls') || 0);
  let lsDevices = [{ id: 'd1', alias: 'Pixel 8', deviceModel: 'Pixel 8', deviceType: 'mobile' }, { id: 'd2', alias: 'Studio PC', deviceModel: 'Windows', deviceType: 'desktop' }, { id: 'd3', alias: 'Browser tab', deviceModel: 'Chrome', deviceType: 'web' }].slice(0, nDev);
  let shelf = qs.get('shelf') ? [{ id: 1, name: 'invoice-nov.pdf', path: 'C:\f\invoice-nov.pdf', size: 482113, isDir: false, addedAt: 1, missing: false }, { id: 2, name: 'Assets', path: 'C:\f\Assets', size: 0, isDir: true, addedAt: 2, missing: false }] : [];
  let netState = { online: true, ip: '192.168.1.42', vpn: !!qs.get('vpn'), vpnName: qs.get('vpn') ? 'WireGuard' : '', pingMs: 23, host: '1.1.1.1' };
  let mixer = qs.get('mixer') ? [{ pid: 101, name: 'Spotify', volume: 62, mute: false }, { pid: 202, name: 'Chrome', volume: 100, mute: false }, { pid: 303, name: 'Discord', volume: 35, mute: true }] : [];
  window.islandAPI = {
    // ---- 3.0 features (preview). ?ls=0|1|2|3 fake LocalSend devices, ?shelf=1 two parked files, ?net=1, ?mixer=1. Hooks: window.__drop(bool), __lsDevices(list), __lsProgress(p), __lsIncoming(m), __lsReceived(p),
    // __shelf(list), __captureNew(c), __downloads(list), __network(n), __noteOpen(), __focus({system}), __clip(list). Calls are recorded in window.__lsSent, __lsAnswered, __shelfAdded, __mixerSet, __notes ...
    pathForFile(f) { return f && (f.path || f.name) ? 'C:/Users/me/' + (f.name || 'file.bin') : ''; },
    onDropArmed(cb) { window.__drop = cb; },
    async localsendDevices() { return lsDevices; }, onLocalsendDevices(cb) { window.__lsDevices = (l) => { lsDevices = l; cb(l); }; },
    async localsendSend(id, paths) { (window.__lsSent = window.__lsSent || []).push([id, paths]); return window.__lsSendResult || { ok: true, sessionId: 's' + (window.__lsSent.length) }; },
    onLocalsendProgress(cb) { window.__lsProgress = cb; }, async localsendCancel(sid) { (window.__lsCancelled = window.__lsCancelled || []).push(sid); return true; },
    onLocalsendIncoming(cb) { window.__lsIncoming = cb; }, async localsendRespond(id, ok) { (window.__lsAnswered = window.__lsAnswered || []).push([id, ok]); return true; },
    onLocalsendReceived(cb) { window.__lsReceived = cb; }, async localsendStatus() { return { running: true, port: 53317, receiving: !!settings.localsend.receive }; }, async localsendOpenFolder() { window.__lsFolder = true; return true; },
    async shelfList() { return shelf; }, onShelf(cb) { window.__shelf = (l) => { shelf = l; cb(l); }; },
    async shelfAdd(paths) { (window.__shelfAdded = window.__shelfAdded || []).push(paths); shelf = [...shelf, ...paths.map((p, i) => ({ id: Date.now() + i, name: String(p).split(/[\/]/).pop(), path: p, size: 12345, isDir: false, addedAt: Date.now(), missing: false }))]; if (window.__shelf) window.__shelf(shelf); return shelf; },
    async shelfRemove(id) { shelf = shelf.filter((x) => x.id !== id); if (window.__shelf) window.__shelf(shelf); return shelf; }, async shelfClear() { shelf = []; if (window.__shelf) window.__shelf(shelf); return shelf; },
    shelfDragOut(id) { (window.__shelfDrag = window.__shelfDrag || []).push(id); },
    async capturesList() { return []; }, onCaptures() {}, onCaptureNew(cb) { window.__captureNew = cb; }, captureDragOut(id) { window.__capDrag = id; }, async captureToShelf(id) { window.__capShelf = id; return true; }, async captureDismiss(id) { window.__capDismiss = id; return true; },
    async captureStart(kind) { (window.__capStart = window.__capStart || []).push(kind); return { ok: true }; },
    async downloadsList() { return []; }, onDownloads(cb) { window.__downloads = cb; },
    async networkStatus() { return netState; }, onNetwork(cb) { window.__network = (n) => { netState = n; cb(n); }; },
    onNoteOpen(cb) { window.__noteOpen = cb; }, async noteAdd(text) { (window.__notes = window.__notes || []).push(text); return window.__noteResult || { ok: true, file: 'C:\Users\me\notes.md' }; }, async noteOpenFile() { window.__noteFile = true; return true; },
    onFocusMode(cb) { window.__focus = cb; }, async urlOpen(u) { (window.__urlOpened = window.__urlOpened || []).push(u); return true; }, async urlShorten(u) { window.__shortened = u; return window.__shortenResult || { ok: true, url: 'https://is.gd/abc123' }; },
    async mixerList() { window.__mixer = (l) => { mixer = l; }; return mixer; }, async mixerSet(pid, volume, mute) { (window.__mixerSet = window.__mixerSet || []).push([pid, volume, mute]); mixer = mixer.map((a) => (a.pid === pid ? { ...a, volume: volume == null ? a.volume : volume, mute: mute == null ? a.mute : !!mute } : a)); return true; },
    async clipboardSearch(q) { return clipItems.filter((x) => x.kind === 'text' && x.text.toLowerCase().includes(String(q).toLowerCase())); },
    capture() {}, input(v) { window.__input = v; }, reportSize(sz) { window.__size = sz; },
    onVolume(cb) { window.__volume = cb; },
    // Preview only: ?events=1 shows a few events; window.__events({ list, status }) drives it. window.__opened collects the ids opened.
    onEvents(cb) { window.__events = cb; if (new URLSearchParams(location.search).get('events')) { const t = Date.now(); setTimeout(() => cb({ status: 'ok', list: [
      { id: 'a', title: 'Design review', start: t + 4 * 60000, end: t + 34 * 60000, allDay: false, location: '', link: 'https://meet.google.com/abc-defg-hij' },
      { id: 'b', title: 'Lunch with Sam', start: t + 86400000 + 3600000, end: t + 86400000 + 7200000, allDay: false, location: 'Cafe', link: '' },
      { id: 'tk', title: 'File report', start: new Date(new Date().getFullYear(), new Date().getMonth(), 28).getTime(), end: new Date(new Date().getFullYear(), new Date().getMonth(), 28).getTime(), allDay: true, location: 'My tasks', link: '', kind: 'task' },
      { id: 'c', title: 'Holiday', start: new Date(new Date().getFullYear(), new Date().getMonth(), 28).getTime(), end: new Date(new Date().getFullYear(), new Date().getMonth(), 29).getTime(), allDay: true, location: '', link: '' } ] }), 300); } },
    // Preview only: ?google=1 shows a connected account with mail and a task; window.__google({...}) drives it
    onGoogle(cb) { window.__google = cb; if (new URLSearchParams(location.search).get('google')) setTimeout(() => cb({ status: 'ok', error: '', mail: { unread: 7, latest: [{ id: 'm1', from: 'Sam Lee', subject: 'Lunch on Friday?' }, { id: 'm2', from: 'GitHub', subject: 'New sign-in to your account' }] } }), 400); },
    async refreshData() { return { ok: true, at: Date.now() }; },
    async googleState() { return { status: new URLSearchParams(location.search).get('google') ? 'ok' : 'off', mail: { unread: 0, latest: [] }, error: '' }; },
    async googleConnect() { window.__googleConnect = true; return { ok: true }; }, async googleDisconnect() { window.__googleDisconnect = true; return { ok: true }; }, googleOpen(w) { window.__googleOpen = w; },
    async eventsGet() { return { list: [], status: 'off' }; }, openEvent(id) { (window.__opened = window.__opened || []).push(id); }, setVolume(p) { window.__volSet = p; }, setMute(m) { window.__muted = m; }, quick(k) { (window.__quick = window.__quick || []).push(k); },
    getSettings: async () => settings,
    setSettings: async (patch) => window.__settings(patch),
    resetSettings: async () => { settings = DEFAULT_SETTINGS; settingsListeners.forEach((cb) => cb(settings)); return settings; },
    onSettings(cb) { settingsListeners.push(cb); },
    onNear(cb) { window.__near = cb; },
    mascotWatch() {}, onGaze(cb) { window.__gaze = cb; },
    onHotkey(cb) { window.__hotkey = cb; },
    hotkeyStatus: async () => ({ accelerator: settings.hotkey, ok: true }), onHotkeyStatus() {},
    setKeepAwake: async (v) => !!v,
    clipboardList: async () => clipItems, onClipboard(cb) { clipCbs.push(cb); window.__clip = (l) => clipCbs.forEach((f) => f(l)); },
    clipboardCopy: async (id) => { window.__copied = id; return true; }, clipboardPaste: async (id) => { window.__pasted = id; return true; },
    clipboardPin: async (id) => { clipItems = clipItems.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)); clipItems = [...clipItems.filter((x) => x.pinned), ...clipItems.filter((x) => !x.pinned)]; if (window.__clip) window.__clip(clipItems); return true; },
    clipboardClear: async () => { clipItems = clipItems.filter((x) => x.pinned); if (window.__clip) window.__clip(clipItems); return true; },
    media(cmd) { (window.__mediaCmds = window.__mediaCmds || []).push(cmd);
      if (cmd === 'toggle') { status = status === 'Playing' ? 'Paused' : 'Playing'; }
      setTimeout(send, 50);
    },
    // Preview only. ?limits=ok (default) real limits, ?limits=expired / nocreds / unavailable, ?usage=none for no local data
    async limits() {
      const k = new URLSearchParams(location.search).get('limits') || 'ok';
      if (k !== 'ok' && k !== 'low' && k !== 'crit') return { ok: false, reason: k };
      return {
        ok: true,
        five: { pct: k === 'low' ? 91 : k === 'crit' ? 97 : 42, resetsAt: new Date(Date.now() + 2 * 3600e3 + 10 * 60e3).toISOString() },
        week: { pct: 18, resetsAt: new Date(Date.now() + 3 * 86400e3 + 4 * 3600e3).toISOString() },
        opus: { pct: 9, resetsAt: null }, sonnet: null,
      };
    },
    // Preview only: ?working=1 (one session, 1:23 in), ?working=2 (two sessions). window.__work(state) drives it from tests.
    onWorking(cb) {
      window.__work = cb;
      const w = Number(new URLSearchParams(location.search).get('working'));
      if (w) setTimeout(() => cb({ working: true, since: Date.now() - 83000, count: w }), 600);
    },
    toggleSettings() {}, closeSettings() {}, onSettingsState() {},
    // Preview only: ?approve=1|2 opens that many permission requests; window.__approvals(list) drives it; answers land in window.__answered
    onApprovals(cb) {
      let open = [];
      window.__approvals = (l) => { open = l; cb(l); };
      window.__answered = [];
      this.__answer = (id, behavior) => { window.__answered.push([id, behavior]); open = open.filter((x) => x.id !== id); cb(open); };
      const n = Number(new URLSearchParams(location.search).get('approve'));
      const all = [{ id: 1, project: 'website', tool: 'Bash', detail: 'npm run build && rm -rf dist/cache', extra: 'Build the site' }, { id: 2, project: 'api', tool: 'Edit', detail: '.../src/pages/pricing.tsx' }];
      if (n) setTimeout(() => { open = all.slice(0, n); cb(open); }, 600);
    },
    // Preview only: ?priv=cam|mic|both; window.__priv({camera, mic}) drives it
    onPrivacy(cb) { window.__priv = cb; const p = new URLSearchParams(location.search).get('priv'); if (p) setTimeout(() => cb({ camera: p === 'cam' || p === 'both', mic: p === 'mic' || p === 'both' }), 400); },
    // Preview only: ?edge=left|right puts the island on that screen edge; window.__info({edge, lead, count}) drives it
    async windowInfo() { return { edge: new URLSearchParams(location.search).get('edge') || settings.placement.edge, lead: true, index: 0, count: 1 }; },
    onWindowInfo(cb) { window.__info = cb; settingsListeners.push((st) => cb({ edge: new URLSearchParams(location.search).get('edge') || st.placement.edge, lead: true, index: 0, count: 1 })); },
    async displays() { return { monitors: [{ id: '1', primary: false, label: 'Monitor 1 \u00b7 1920\u00d71080 \u00b7 left of main' }, { id: '2', primary: true, label: 'Monitor 2 (main) \u00b7 2560\u00d71440' }], active: ['2'] }; },
    onDisplaysChanged() {},
    onAwake(cb) { window.__awake = cb; }, async awakeGet() { return false; },
    timerSync(st) { window.__timerOut = st; }, onTimer(cb) { window.__timerIn = cb; },
    async focusClaude(session) { window.__focused = session || '(latest)'; return { ok: window.__focusOk !== false, how: 'process' }; },
    // Preview only: ?dns=on|off|notinstalled|custom sets the NextDNS state; window.__dnsState drives it
    async dnsStatus() { return { state: window.__dnsState || new URLSearchParams(location.search).get('dns') || 'on' }; },
    async dnsToggle() { const cur = window.__dnsState || new URLSearchParams(location.search).get('dns') || 'on'; window.__dnsState = cur === 'on' ? 'off' : 'on'; window.__dnsToggled = (window.__dnsToggled || 0) + 1; return { state: window.__dnsState }; },
    // Preview only: ?dnsp=installed pretends the provider switch is set up
    async appIcons() { const ic = (c) => 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="' + c + '"/></svg>'); return [ic('#3b7ddd'), ic('#2a9d8f')]; },
    openApp(i) { (window.__apps = window.__apps || []).push(i); }, async pickApp() { window.__picked = true; return { ok: true }; },
    async dnspPresets() { return [{ id: 'cloudflare', name: 'Cloudflare', note: 'Fast and private' }, { id: 'google', name: 'Google', note: 'Public DNS' }, { id: 'adguard', name: 'AdGuard', note: 'Blocks ads and trackers' }]; },
    async dnspStatus() { const on = new URLSearchParams(location.search).get('dnsp'); if (!on) return { state: 'notinstalled', profiles: [], id: '' }; const cur = window.__dnspId || ''; return { state: cur ? 'profile' : 'auto', id: cur, profiles: [{ id: 'cloudflare', name: 'Cloudflare', slot: 1 }, { id: 'google', name: 'Google', slot: 2 }, { id: 'adguard', name: 'AdGuard', slot: 3 }] }; },
    async dnspUse(which) { window.__dnspId = which === 'auto' ? '' : which; return this.dnspStatus(); },
    async dnspSetup() { window.__dnspSetup = true; return { ok: true }; }, async dnspRemove() { window.__dnspRemove = true; return { ok: true }; },
    async dnsSetup() { window.__dnsSetup = true; return { ok: true }; },
    async dnsRemove() { window.__dnsRemove = true; return { ok: true }; },
    // Preview only: settings tools
    async settingsDefaults() { return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); },
    async exportSettings() { window.__exported = true; return { ok: true, file: 'dyisland-settings.json' }; },
    async importSettings() { window.__imported = true; return { ok: true, file: 'dyisland-settings.json' }; },
    async setupStatus() {
      return [
        { id: 'hooks', label: 'Claude Code hooks', state: 'ok', detail: 'Prompt, stop, notification and session-end hooks are in place' },
        { id: 'heartbeat', label: 'Long-task heartbeat', state: 'warn', detail: 'Optional PostToolUse hook missing: a task longer than 10 minutes drops off' },
        { id: 'approvals', label: 'Approve from the island', state: 'bad', detail: 'PermissionRequest hook has the wrong shape' },
        { id: 'events', label: 'Events from Claude Code', state: 'ok', detail: 'Heard from Claude Code just now' },
        { id: 'hotkey', label: 'Island shortcut', state: 'ok', detail: 'Control + Alt + Space' },
        { id: 'settingsKey', label: 'Settings shortcut', state: 'off', detail: 'Off' },
      ];
    },
    pauseIsland(m) { window.__paused = m; }, restartApp() { window.__restart = true; }, quitApp() { window.__quit = true; },
    async approvals() { return []; },
    approve(id, behavior) { this.__answer(id, behavior); },
    async agentsList() { return [{ id: 'gemini', name: 'Gemini CLI', where: '~/.gemini/settings.json', note: 'Merge the hooks block' }, { id: 'codex', name: 'Codex CLI', where: '~/.codex/config.toml', note: 'Add this line' }]; },
    async agentsCopy(id) { window.__agentCopied = id; return true; },
    async copyHooks() { return true; },
    // Preview only: ?notice=done or ?notice=attention shows a toast after a moment
    noticeOpen(id) { window.__noticeOpened = id; },
    onNotice(cb) {
      window.__notice = cb;
      const k = new URLSearchParams(location.search).get('notice');
      if (k) setTimeout(() => cb(k === 'attention'
        ? { kind: 'attention', title: 'Claude needs you', sub: 'Claude needs your permission to use Bash', session: 'sess-abc' }
        : { kind: 'done', title: 'Claude finished', sub: 'DyIsland', session: 'sess-abc' }), 900);
    },
    async usage() {
      if (new URLSearchParams(location.search).get('usage') === 'none') return { found: false };
      return { found: true, today: 1840000, todayMsgs: 212, five: 920000, week: 9600000,
        days: [420000, 1100000, 760000, 2300000, 1500000, 1680000, 1840000], dayLetters: ['W', 'T', 'F', 'S', 'S', 'M', 'T'], topModel: 'Opus' };
    },
    // ?media=none: nothing playing (the island is idle, so the mascot can appear)
    onMedia(cb) { listener = cb; setTimeout(send, 200); setInterval(send, 1000); if (qs.get('media') === 'none') listener = () => {}, setTimeout(() => cb({ none: true }), 200); },
    async weatherSearch(text) {
      const q = String(text || '').trim(); if (q.length < 2) return [];
      return [{ name: q, admin1: 'England', cc: 'GB', lat: 51.5, lon: -0.12 }, { name: q, admin1: 'Ontario', cc: 'CA', lat: 42.98, lon: -81.25 }, { name: q + ' Heights', admin1: 'Ohio', cc: 'US', lat: 41.5, lon: -81.6 }];
    },
    async weatherLocate() { return window.__noLocation ? { error: 'unavailable' } : { lat: 51.5, lon: -0.12 }; },
    async weather(where) {
      const city = where && typeof where === 'object' ? where.name : where;
      window.__weatherAsked = where;
      if (!city) return { error: 'no-city' };
      const days = Array.from({ length: 5 }, (_, i) => '2026-11-' + String(24 + i));
      return {
        daily: { time: days, weather_code: [61, 3, 2, 0, 71], temperature_2m_max: [15, 13, 12, 16, 3], temperature_2m_min: [9, 8, 6, 7, -1], precipitation_probability_max: [70, 20, 10, 0, 60] },
        place: city, country: 'GB',
        current: { temperature_2m: 14.6, apparent_temperature: 12.9, relative_humidity_2m: 71, weather_code: 61, wind_speed_10m: 17.3, is_day: 1, time: '2026-11-24T08:00' },
        hourly: {
          time: hours,
          temperature_2m: hours.map((_, i) => 12 + Math.round(4 * Math.sin(i / 4))),
          weather_code: hours.map((_, i) => [61, 3, 2, 0, 1][i % 5]),
          is_day: hours.map((_, i) => (i % 24 >= 7 && i % 24 <= 17 ? 1 : 0)),
          precipitation_probability: hours.map((_, i) => (i * 7) % 90),
        },
      };
    },
  };
  try { if (!localStorage.getItem('island.city')) localStorage.setItem('island.city', 'London'); } catch (e) { /* ignore */ }
}
