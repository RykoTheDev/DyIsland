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
    title: 'Paper Sky', artist: 'Lumen Coast', status,
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
    size: { idle: { w: 148, h: 32 }, open: { w: 520, h: 264 } },
    tabs: ['home', 'music', 'weather', 'timer', 'usage', 'clipboard', 'agents'], hiddenTabs: ['clipboard'],
    mascot: { enabled: true, delay: 8 }, hotkey: 'Control+Alt+Space', clipboard: { enabled: false, max: 12 },
    battery: { warn: true }, units: { temp: 'c', clock: 'auto' }, calendar: { weekStart: 'auto' }, usage: { forecast: true, resetAlert: true }, approvals: { enabled: true, wait: 30 }, agents: { quietAlert: false }, split: { enabled: true, lead: 'auto' }, privacy: { dot: true }, home: { calendar: true, side: 'left', first: 'weather', second: 'music', countdown: { label: '', date: '' } },
  };
  const qs = new URLSearchParams(location.search);
  let settings = DEFAULT_SETTINGS;
  try { if (qs.get('s')) settings = merge(settings, JSON.parse(qs.get('s'))); } catch (e) { /* ignore a bad preview override */ }
  if (qs.get('theme')) settings = merge(settings, { theme: { mode: qs.get('theme') } });
  const settingsListeners = [];
  window.__settings = (patch) => { settings = merge(settings, patch); settingsListeners.forEach((cb) => cb(settings)); return settings; };
  let clipItems = qs.get('clip') ? ['npm run build:theme', 'https://example.com/a/long/link/that/keeps/going', 'Meeting moved to 15:30', 'Ctrl+Alt+Space'] : [];

  window.islandAPI = {
    capture() {}, input() {},
    getSettings: async () => settings,
    setSettings: async (patch) => window.__settings(patch),
    resetSettings: async () => { settings = DEFAULT_SETTINGS; settingsListeners.forEach((cb) => cb(settings)); return settings; },
    onSettings(cb) { settingsListeners.push(cb); },
    onNear(cb) { window.__near = cb; },
    mascotWatch() {}, onGaze(cb) { window.__gaze = cb; },
    onHotkey(cb) { window.__hotkey = cb; },
    hotkeyStatus: async () => ({ accelerator: settings.hotkey, ok: true }), onHotkeyStatus() {},
    setKeepAwake: async (v) => !!v,
    clipboardList: async () => clipItems, onClipboard(cb) { window.__clip = cb; },
    clipboardCopy: async () => true, clipboardClear: async () => { clipItems = []; if (window.__clip) window.__clip([]); return true; },
    media(cmd) {
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
    async copyHooks() { return true; },
    // Preview only: ?notice=done or ?notice=attention shows a toast after a moment
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
    async weather(city) {
      if (!city) return { error: 'no-city' };
      return {
        place: city, country: 'GB',
        current: { temperature_2m: 14.6, apparent_temperature: 12.9, relative_humidity_2m: 71, weather_code: 61, wind_speed_10m: 17.3, is_day: 1, time: '2026-11-24T08:00' },
        hourly: {
          time: hours,
          temperature_2m: hours.map((_, i) => 12 + Math.round(4 * Math.sin(i / 4))),
          weather_code: hours.map((_, i) => [61, 3, 2, 0, 1][i % 5]),
          is_day: hours.map((_, i) => (i % 24 >= 7 && i % 24 <= 17 ? 1 : 0)),
        },
      };
    },
  };
  try { if (!localStorage.getItem('island.city')) localStorage.setItem('island.city', 'London'); } catch (e) { /* ignore */ }
}
