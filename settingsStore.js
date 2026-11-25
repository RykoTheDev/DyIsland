// DyIsland settings: defaults, validation (everything is clamped or falls back), and a small JSON-file store.
// Pure Node, no Electron imports, so it can be tested on its own. A corrupt or hand-edited file can never break the app:
// anything invalid falls back to its default and the bad file is kept next to it as settings.json.corrupt.
const fs = require('fs');
const path = require('path');
const { cleanUrl } = require('./main/ics');
const DNSP = require('./dns-profiles');

const EDGES = ['top', 'left', 'right'];
const TAB_IDS = ['home', 'music', 'weather', 'timer', 'usage', 'clipboard', 'localsend'];
const HOTKEYS = ['Control+Alt+Space', 'Control+Alt+D', 'Control+Alt+I', 'Control+Shift+Space', ''];   // '' = off
const SETTINGS_HOTKEYS = ['Control+Alt+F10', 'Control+Alt+F9', 'Control+Alt+,', ''];   // no letters: on many keyboards AltGr is Ctrl+Alt and would steal a typed letter                    // opens the settings window ('' = off)
const NOTES_HOTKEYS = ['Control+Alt+N', 'Control+Alt+J', 'Control+Alt+K', ''];
const LIMITS = {                                   // [min, max] in px; the minimums are what the pages can lay out without overflowing
  idleW: [100, 260], idleH: [24, 48],
  openW: [416, 640], openH: [232, 340],
};

const DEFAULTS = Object.freeze({
  motion: 'expressive',                            // animations: 'expressive' (springy), 'calm' (the original, simple), 'off'
  dns: { tile: true },                             // the NextDNS on/off tile in the quick actions (works once the one-time DNS setup was run)
  placement: { edge: 'top', monitor: 'primary' },   // which screen edge, and which monitor: 'primary', 'all' or a display id
  openOn: 'click',                                 // how the island expands: 'click' or 'hover'
  autoHide: false,                                 // hide the island until the pointer touches the top centre
  hideInFullscreen: true,                          // hide it over full-screen apps and games
  theme: { mode: 'auto', variant: 'vibrant', seed: '#1FB5A5', preset: 'teal' },
  size: { idle: { w: 148, h: 32 }, open: { w: 520, h: 264 }, adaptive: true },   // adaptive: some pages open the island a little smaller or bigger
  tabs: TAB_IDS.slice(),                           // order of the tab buttons in the expanded island
  hiddenTabs: ['clipboard', 'localsend'],                       // tabs that exist but are switched off
  mascot: { enabled: true, delay: 8 },             // eyes appear after `delay` seconds of idling
  hotkey: 'Control+Alt+Space',
  settingsHotkey: '',                              // opens Settings from anywhere (off until you pick one)
  quiet: { dnd: false, mute: false },              // do not disturb (no toasts, no approval cards, no chimes) / just mute the chimes
  clipboard: { enabled: false, max: 12, images: false, paste: false, persistPins: false },   // history is opt-in and kept in memory; the three extras are opt-in too
  units: { temp: 'c', clock: 'auto' },
  calendar: { weekStart: 'auto' },
  privacy: { dot: true },                          // a dot on the island while the camera or microphone is in use
  home: { calendar: true, side: 'left', first: 'weather', second: 'music', countdown: { label: '', date: '' } },   // what the Home page shows
  split: { enabled: true, lead: 'auto' },          // show two status chips side by side when two things are happening; which leads
  agents: { quietAlert: false },                  // tell me when a Claude session has gone quiet
  approvals: { enabled: true, wait: 30 },          // answer Claude Code permission prompts on the island (needs the hook); seconds to wait
  usage: { forecast: true, resetAlert: true },     // pace warning and limit-reset alert
  google: { clientId: '', clientSecret: '', calendar: true, tasks: true, mail: true, mailToast: true },   // Google Calendar / Tasks / Gmail (read-only). The client id and secret are yours (a Desktop-app OAuth client): never exported
  events: { url: '' },                             // a calendar (.ics) link for the Home card, calendar dots and the "starting soon" chip. Secret: never exported
  notifications: { mirror: false, apps: '' },     // show the Windows notifications that appear on the island (opt-in); apps: only these ("Slack, Outlook"), empty = all
  shortcuts: { apps: [] },                         // the Home page's App shortcuts card: [{ name, path }]
  dnsp: { presets: [], custom: [] },               // DNS providers to offer in the quick-actions tile (installed once, with Windows approval): preset ids + up to 2 custom ones
  hud: { volume: true },                           // show the volume on the island when it changes (the Windows pop-up still appears too)
  devices: { toasts: true, charger: true, battery: true, lowAt: 15 },   // toasts when a Bluetooth device connects, the charger is plugged in/out, the battery runs low (toasts is the master switch)
  localsend: { enabled: false, receive: false, alias: '', saveDir: '', autoAccept: false },   // LocalSend: send files to nearby devices (opens UDP 53317), and receive (HTTPS on 53317)
  drop: { enabled: true },                         // a file dragged towards the island turns the drop zone on
  shelf: { enabled: false, max: 12 },               // file shelf: files parked on the island, dragged out later
  captures: { enabled: false },                    // hold the newest screenshot / screen recording so it can be dragged out
  downloads: { enabled: false },                   // progress of browser downloads (Downloads folder, .crdownload / .part files)
  network: { enabled: false, host: '1.1.1.1', vpnAlerts: true },   // IP, ping and VPN status
  focus: { sync: false },                          // follow the Windows Do not disturb switch
  notes: { enabled: false, hotkey: 'Control+Alt+N', file: '' },   // global quick-note hotkey, appended to a notes file
  urltools: { enabled: true, shorten: false },     // actions on a copied link; shortening calls an external service (is.gd) so it is off
  mixer: { enabled: false },                       // per-app volume
  meetings: { dnd: false },                        // Do not disturb switches itself on while an app uses the camera or microphone
  music: { artColors: true },                      // the island takes its colours from the cover of what is playing (not under a named theme)
  updates: { check: true },                        // look for a new version on GitHub (the installed build only)
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, [lo, hi], fallback) => { if (v == null || v === '' || typeof v === 'boolean' || Array.isArray(v)) return fallback; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

function deepMerge(base, patch) {
  if (!isObj(base) || !isObj(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const k of Object.keys(patch)) out[k] = isObj(base[k]) && isObj(patch[k]) ? deepMerge(base[k], patch[k]) : patch[k];
  return out;
}

// the settings shortcut must differ from the island shortcut (two actions cannot share one key)
function settingsKey(v, islandKey, fallback) { const k = oneOf(v, SETTINGS_HOTKEYS, fallback); return k && k === islandKey ? '' : k; }

const cleanText = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, n) : '');
// a folder or file the user typed or picked: an absolute Windows path, no wildcards (empty = the default)
const cleanDir = (v) => { const p = cleanText(v, 260); return /^[A-Za-z]:\\[^<>"|?*]*$/.test(p) ? p.replace(/[\\/]+$/, '') : ''; };
const cleanFile = (v) => { const p = cleanText(v, 260); return /^[A-Za-z]:\\[^<>"|?*]+\.(?:md|txt)$/i.test(p) ? p : ''; };
function notesKey(v, taken, fallback) { const k = oneOf(v, NOTES_HOTKEYS, fallback); return k && taken.includes(k) ? '' : k; }

function sanitizePlacement(p) {
  const r = isObj(p) ? p : {}, d = DEFAULTS.placement;
  const m = typeof r.monitor === 'number' ? String(r.monitor) : r.monitor;
  return { edge: oneOf(r.edge, EDGES, d.edge), monitor: m === 'primary' || m === 'all' || (typeof m === 'string' && /^\d{1,15}$/.test(m)) ? m : d.monitor };
}

const CARDS = ['weather', 'music', 'countdown', 'events', 'apps', 'mail', 'none'];
// App shortcuts for the Home card: a program, shortcut or link you chose with the file picker. Absolute Windows paths to a few kinds of file only.
const APP_EXT = /\.(?:exe|lnk|url|appref-ms)$/i;                          // programs, shortcuts and links: not scripts
function sanitizeApps(v) {
  const out = [];
  for (const a of (isObj(v) && Array.isArray(v.apps) ? v.apps : []).slice(0, 8)) {
    if (!isObj(a) || typeof a.path !== 'string') continue;
    const p = a.path.trim();
    if (p.length > 260 || !/^[A-Za-z]:\\[^<>"|?*\x00-\x1f]+$/.test(p) || !APP_EXT.test(p) || out.some((x) => x.path.toLowerCase() === p.toLowerCase())) continue;
    const name = (typeof a.name === 'string' ? a.name : '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 30) || p.split('\\').pop().replace(APP_EXT, '');
    out.push({ name, path: p });
  }
  return { apps: out };
}
function sanitizeHome(h) {
  const r = isObj(h) ? h : {}, d = DEFAULTS.home, cd = isObj(r.countdown) ? r.countdown : {};
  const first = oneOf(r.first, CARDS, d.first);
  let second = oneOf(r.second, CARDS, d.second);
  if (second !== 'none' && second === first) second = 'none';                        // the same card twice makes no sense
  const date = typeof cd.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cd.date) && !Number.isNaN(Date.parse(cd.date)) ? cd.date : '';
  return {
    calendar: bool(r.calendar, d.calendar), side: oneOf(r.side, ['left', 'right'], d.side), first, second,
    countdown: { label: typeof cd.label === 'string' ? cd.label.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 40) : '', date },
  };
}

// DNS providers chosen in Settings: known preset ids, and custom entries that pass the same checks the elevated setup applies
function sanitizeDnsp(v) {
  const r = isObj(v) ? v : {};
  const presets = (Array.isArray(r.presets) ? r.presets : []).filter((id, i, a) => DNSP.PRESETS.some((p) => p.id === id) && a.indexOf(id) === i).slice(0, DNSP.MAX_PROFILES);
  const str = (x, n) => (typeof x === 'string' ? x.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, n) : '');
  const custom = [];
  for (const c of (Array.isArray(r.custom) ? r.custom : []).slice(0, 2)) {                  // (custom entries count towards the 8: presets give way)
    if (!isObj(c)) continue;
    const e = { name: str(c.name, 40), v4a: str(c.v4a, 15), v4b: str(c.v4b, 15), v6a: str(c.v6a, 39), v6b: str(c.v6b, 39), doh: str(c.doh, 200) };
    if (DNSP.buildProfiles({ presets: [], custom: [e] }).length) custom.push(e);
  }
  return { presets: presets.slice(0, Math.max(0, DNSP.MAX_PROFILES - custom.length)), custom };
}

function sanitize(raw) {
  const r = isObj(raw) ? raw : {};
  const d = DEFAULTS;
  const theme = isObj(r.theme) ? r.theme : {};
  const size = isObj(r.size) ? r.size : {};
  const idle = isObj(size.idle) ? size.idle : {};
  const open = isObj(size.open) ? size.open : {};

  let tabs = Array.isArray(r.tabs) ? r.tabs.filter((t, i, a) => TAB_IDS.includes(t) && a.indexOf(t) === i) : [];
  for (const t of TAB_IDS) if (!tabs.includes(t)) tabs.push(t);                       // new tabs from an update appear at the end
  let hidden = Array.isArray(r.hiddenTabs) ? r.hiddenTabs.filter((t, i, a) => TAB_IDS.includes(t) && a.indexOf(t) === i) : d.hiddenTabs.slice();
  const clipOn = bool(isObj(r.clipboard) ? r.clipboard.enabled : undefined, d.clipboard.enabled);
  if (!clipOn && !hidden.includes('clipboard')) hidden.push('clipboard');             // no history, no tab
  const lsOn = bool(isObj(r.localsend) ? r.localsend.enabled : undefined, d.localsend.enabled);
  const shOn = bool(isObj(r.shelf) ? r.shelf.enabled : undefined, d.shelf.enabled);
  const shareOn = lsOn || shOn;                                                        // Share tab = LocalSend + Shelf: on while either is on
  const hadShelfTab = Array.isArray(r.tabs) && r.tabs.includes('shelf') && Array.isArray(r.hiddenTabs) && !r.hiddenTabs.includes('shelf');   // pre-merge settings with a visible Shelf tab
  if (shOn && hadShelfTab) hidden = hidden.filter((t) => t !== 'localsend');
  if (!shareOn && !hidden.includes('localsend')) hidden.push('localsend');            // feature off, no tab
  const featureOn = { clipboard: clipOn, localsend: shareOn };
  const usable = tabs.filter((t) => featureOn[t] !== false);                      // the Clipboard tab only counts while history is on
  if (!usable.some((t) => !hidden.includes(t))) hidden = hidden.filter((t) => t !== usable[0]);   // never hide every tab

  return {
    motion: oneOf(r.motion, ['expressive', 'calm', 'off'], d.motion),
    dns: { tile: bool(isObj(r.dns) ? r.dns.tile : undefined, d.dns.tile) },
    placement: sanitizePlacement(r.placement),
    openOn: oneOf(r.openOn, ['click', 'hover'], d.openOn),
    autoHide: bool(r.autoHide, d.autoHide),
    hideInFullscreen: bool(r.hideInFullscreen, d.hideInFullscreen),
    theme: {
      mode: oneOf(theme.mode, ['auto', 'dark', 'light'], d.theme.mode),
      variant: oneOf(theme.variant, ['tonal', 'vibrant', 'expressive', 'neutral'], d.theme.variant),
      seed: typeof theme.seed === 'string' && /^#[0-9a-f]{6}$/i.test(theme.seed) ? theme.seed.toUpperCase() : d.theme.seed,
      preset: typeof theme.preset === 'string' ? theme.preset.slice(0, 24) : d.theme.preset,
    },
    size: {
      idle: { w: clamp(idle.w, LIMITS.idleW, d.size.idle.w), h: clamp(idle.h, LIMITS.idleH, d.size.idle.h) },
      open: { w: clamp(open.w, LIMITS.openW, d.size.open.w), h: clamp(open.h, LIMITS.openH, d.size.open.h) },
      adaptive: bool(size.adaptive, d.size.adaptive),
    },
    tabs, hiddenTabs: hidden,
    mascot: {
      enabled: bool(isObj(r.mascot) ? r.mascot.enabled : undefined, d.mascot.enabled),
      delay: clamp(isObj(r.mascot) ? r.mascot.delay : undefined, [3, 120], d.mascot.delay),
    },
    hotkey: oneOf(r.hotkey, HOTKEYS, d.hotkey),
    settingsHotkey: settingsKey(r.settingsHotkey, oneOf(r.hotkey, HOTKEYS, d.hotkey), d.settingsHotkey),
    quiet: { dnd: bool(isObj(r.quiet) ? r.quiet.dnd : undefined, d.quiet.dnd), mute: bool(isObj(r.quiet) ? r.quiet.mute : undefined, d.quiet.mute) },
    clipboard: {
      enabled: bool(isObj(r.clipboard) ? r.clipboard.enabled : undefined, d.clipboard.enabled),
      max: clamp(isObj(r.clipboard) ? r.clipboard.max : undefined, [5, 30], d.clipboard.max),
      images: bool(isObj(r.clipboard) ? r.clipboard.images : undefined, d.clipboard.images),
      paste: bool(isObj(r.clipboard) ? r.clipboard.paste : undefined, d.clipboard.paste),
      persistPins: bool(isObj(r.clipboard) ? r.clipboard.persistPins : undefined, d.clipboard.persistPins),
    },
    units: {
      temp: oneOf(isObj(r.units) ? r.units.temp : undefined, ['c', 'f'], d.units.temp),
      clock: oneOf(isObj(r.units) ? r.units.clock : undefined, ['auto', '12', '24'], d.units.clock),
    },
    privacy: { dot: bool(isObj(r.privacy) ? r.privacy.dot : undefined, d.privacy.dot) },
    home: sanitizeHome(r.home),
    split: { enabled: bool(isObj(r.split) ? r.split.enabled : undefined, d.split.enabled), lead: oneOf(isObj(r.split) ? r.split.lead : undefined, ['auto', 'approve', 'work', 'timer', 'limit'], d.split.lead) },
    agents: { quietAlert: bool(isObj(r.agents) ? r.agents.quietAlert : undefined, d.agents.quietAlert) },
    approvals: { enabled: bool(isObj(r.approvals) ? r.approvals.enabled : undefined, d.approvals.enabled), wait: clamp(isObj(r.approvals) ? r.approvals.wait : undefined, [10, 120], d.approvals.wait) },
    usage: { forecast: bool(isObj(r.usage) ? r.usage.forecast : undefined, d.usage.forecast), resetAlert: bool(isObj(r.usage) ? r.usage.resetAlert : undefined, d.usage.resetAlert) },
    google: {
      clientId: typeof (isObj(r.google) && r.google.clientId) === 'string' && /^[A-Za-z0-9._~-]{0,200}$/.test(r.google.clientId.trim()) ? r.google.clientId.trim() : '',
      clientSecret: typeof (isObj(r.google) && r.google.clientSecret) === 'string' && /^[A-Za-z0-9._~-]{0,120}$/.test(r.google.clientSecret.trim()) ? r.google.clientSecret.trim() : '',
      calendar: bool(isObj(r.google) ? r.google.calendar : undefined, d.google.calendar), tasks: bool(isObj(r.google) ? r.google.tasks : undefined, d.google.tasks),
      mail: bool(isObj(r.google) ? r.google.mail : undefined, d.google.mail), mailToast: bool(isObj(r.google) ? r.google.mailToast : undefined, d.google.mailToast),
    },
    events: { url: cleanUrl(isObj(r.events) ? r.events.url : '') },
    notifications: { mirror: bool(isObj(r.notifications) ? r.notifications.mirror : undefined, d.notifications.mirror), apps: typeof (isObj(r.notifications) && r.notifications.apps) === 'string' ? r.notifications.apps.replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 200) : '' },
    shortcuts: sanitizeApps(r.shortcuts),
    dnsp: sanitizeDnsp(r.dnsp),
    hud: { volume: bool(isObj(r.hud) ? r.hud.volume : undefined, d.hud.volume) },
    devices: {
      toasts: bool(isObj(r.devices) ? r.devices.toasts : undefined, d.devices.toasts), charger: bool(isObj(r.devices) ? r.devices.charger : undefined, d.devices.charger),
      battery: bool(isObj(r.devices) ? r.devices.battery : undefined, d.devices.battery), lowAt: clamp(isObj(r.devices) ? r.devices.lowAt : undefined, [5, 50], d.devices.lowAt),
    },
    localsend: {
      enabled: bool(isObj(r.localsend) ? r.localsend.enabled : undefined, d.localsend.enabled), receive: bool(isObj(r.localsend) ? r.localsend.receive : undefined, d.localsend.receive),
      alias: cleanText(isObj(r.localsend) ? r.localsend.alias : '', 40), saveDir: cleanDir(isObj(r.localsend) ? r.localsend.saveDir : ''),
      autoAccept: bool(isObj(r.localsend) ? r.localsend.autoAccept : undefined, d.localsend.autoAccept),
    },
    drop: { enabled: bool(isObj(r.drop) ? r.drop.enabled : undefined, d.drop.enabled) },
    shelf: { enabled: bool(isObj(r.shelf) ? r.shelf.enabled : undefined, d.shelf.enabled), max: clamp(isObj(r.shelf) ? r.shelf.max : undefined, [3, 40], d.shelf.max) },
    captures: { enabled: bool(isObj(r.captures) ? r.captures.enabled : undefined, d.captures.enabled) },
    downloads: { enabled: bool(isObj(r.downloads) ? r.downloads.enabled : undefined, d.downloads.enabled) },
    network: {
      enabled: bool(isObj(r.network) ? r.network.enabled : undefined, d.network.enabled),
      host: typeof (isObj(r.network) && r.network.host) === 'string' && /^[A-Za-z0-9.-]{1,80}$/.test(r.network.host.trim()) ? r.network.host.trim() : d.network.host,
      vpnAlerts: bool(isObj(r.network) ? r.network.vpnAlerts : undefined, d.network.vpnAlerts),
    },
    focus: { sync: bool(isObj(r.focus) ? r.focus.sync : undefined, d.focus.sync) },
    notes: {
      enabled: bool(isObj(r.notes) ? r.notes.enabled : undefined, d.notes.enabled),
      hotkey: notesKey(isObj(r.notes) ? r.notes.hotkey : undefined, [oneOf(r.hotkey, HOTKEYS, d.hotkey), settingsKey(r.settingsHotkey, oneOf(r.hotkey, HOTKEYS, d.hotkey), d.settingsHotkey)], d.notes.hotkey),
      file: cleanFile(isObj(r.notes) ? r.notes.file : ''),
    },
    urltools: { enabled: bool(isObj(r.urltools) ? r.urltools.enabled : undefined, d.urltools.enabled), shorten: bool(isObj(r.urltools) ? r.urltools.shorten : undefined, d.urltools.shorten) },
    mixer: { enabled: bool(isObj(r.mixer) ? r.mixer.enabled : undefined, d.mixer.enabled) },
    meetings: { dnd: bool(isObj(r.meetings) ? r.meetings.dnd : undefined, d.meetings.dnd) },
    music: { artColors: bool(isObj(r.music) ? r.music.artColors : undefined, d.music.artColors) },
    updates: { check: bool(isObj(r.updates) ? r.updates.check : undefined, d.updates.check) },
    calendar: { weekStart: oneOf(isObj(r.calendar) ? r.calendar.weekStart : undefined, ['auto', 'mon', 'sun', 'sat'], d.calendar.weekStart) },
  };
}

function createStore(file, { debounceMs = 250 } = {}) {
  let current = sanitize(DEFAULTS);
  const listeners = new Set();
  let timer = null;

  try {
    const text = fs.readFileSync(file, 'utf8');
    try { current = sanitize(JSON.parse(text)); }
    catch { try { fs.writeFileSync(file + '.corrupt', text); } catch { /* ignore */ } }   // keep what was there, start clean
  } catch { /* first run: defaults */ }

  const writeNow = () => {
    clearTimeout(timer); timer = null;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(current, null, 2));
      fs.renameSync(tmp, file);                                                      // atomic: never a half-written settings file
    } catch { /* read-only disk: settings still work for this run */ }
  };
  const emit = () => { for (const cb of listeners) { try { cb(current); } catch { /* a listener must not break the store */ } } };

  return {
    get: () => current,
    set(patch) {
      const next = sanitize(deepMerge(current, isObj(patch) ? patch : {}));
      if (JSON.stringify(next) === JSON.stringify(current)) return current;
      current = next;
      clearTimeout(timer); timer = setTimeout(writeNow, debounceMs);
      emit();
      return current;
    },
    reset() { current = sanitize(DEFAULTS); writeNow(); emit(); return current; },
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    flush: writeNow,
  };
}

module.exports = { NOTES_HOTKEYS, DEFAULTS, LIMITS, TAB_IDS, HOTKEYS, SETTINGS_HOTKEYS, sanitize, deepMerge, createStore };
