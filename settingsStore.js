// DyIsland settings: defaults, validation (everything is clamped or falls back), and a small JSON-file store.
// Pure Node, no Electron imports, so it can be tested on its own. A corrupt or hand-edited file can never break the app:
// anything invalid falls back to its default and the bad file is kept next to it as settings.json.corrupt.
const fs = require('fs');
const path = require('path');

const EDGES = ['top', 'left', 'right'];
const TAB_IDS = ['home', 'music', 'weather', 'timer', 'usage', 'clipboard', 'agents'];
const HOTKEYS = ['Control+Alt+Space', 'Control+Alt+D', 'Control+Alt+I', 'Control+Shift+Space', ''];   // '' = off
const SETTINGS_HOTKEYS = ['Control+Alt+F10', 'Control+Alt+F9', 'Control+Alt+,', ''];   // no letters: on many keyboards AltGr is Ctrl+Alt and would steal a typed letter                    // opens the settings window ('' = off)
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
  size: { idle: { w: 148, h: 32 }, open: { w: 520, h: 264 } },
  tabs: TAB_IDS.slice(),                           // order of the tab buttons in the expanded island
  hiddenTabs: ['clipboard'],                       // tabs that exist but are switched off
  mascot: { enabled: true, delay: 8 },             // eyes appear after `delay` seconds of idling
  hotkey: 'Control+Alt+Space',
  settingsHotkey: '',                              // opens Settings from anywhere (off until you pick one)
  quiet: { dnd: false, mute: false },              // do not disturb (no toasts, no approval cards, no chimes) / just mute the chimes
  clipboard: { enabled: false, max: 12 },          // clipboard history is opt-in and kept in memory only
  battery: { warn: true },
  units: { temp: 'c', clock: 'auto' },
  calendar: { weekStart: 'auto' },
  privacy: { dot: true },                          // a dot on the island while the camera or microphone is in use
  home: { calendar: true, side: 'left', first: 'weather', second: 'music', countdown: { label: '', date: '' } },   // what the Home page shows
  split: { enabled: true, lead: 'auto' },          // show two status chips side by side when two things are happening; which leads
  agents: { quietAlert: false },                  // tell me when a Claude session has gone quiet
  approvals: { enabled: true, wait: 30 },          // answer Claude Code permission prompts on the island (needs the hook); seconds to wait
  usage: { forecast: true, resetAlert: true },     // pace warning and limit-reset alert
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

function sanitizePlacement(p) {
  const r = isObj(p) ? p : {}, d = DEFAULTS.placement;
  const m = typeof r.monitor === 'number' ? String(r.monitor) : r.monitor;
  return { edge: oneOf(r.edge, EDGES, d.edge), monitor: m === 'primary' || m === 'all' || (typeof m === 'string' && /^\d{1,15}$/.test(m)) ? m : d.monitor };
}

const CARDS = ['weather', 'music', 'countdown', 'none'];
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
  const usable = tabs.filter((t) => t !== 'clipboard' || clipOn);                      // the Clipboard tab only counts while history is on
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
    },
    battery: { warn: bool(isObj(r.battery) ? r.battery.warn : undefined, d.battery.warn) },
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

module.exports = { DEFAULTS, LIMITS, TAB_IDS, HOTKEYS, SETTINGS_HOTKEYS, sanitize, deepMerge, createStore };
