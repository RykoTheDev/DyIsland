const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = ROOT + '/';
const { createStore, sanitize, DEFAULTS, LIMITS } = require(P + 'settingsStore.js');
const { computeVisibility } = require(P + 'visibility.js');
const out = []; const ok = (n) => out.push('PASS ' + n);

// ---- sanitize: nothing invalid survives
{
  const s = sanitize({ size: { idle: { w: 9999, h: -5 }, open: { w: 'abc', h: 300.7 } }, theme: { mode: 'neon', seed: 'red', variant: 'x' }, tabs: ['usage', 'bogus', 'usage', 'home'], hiddenTabs: ['bogus', 'timer'], hotkey: 'Alt+F4', units: { temp: 'k' }, mascot: { delay: 99999 }, autoHide: 'yes' });
  assert.deepStrictEqual(s.size.idle, { w: LIMITS.idleW[1], h: LIMITS.idleH[0] });
  assert.deepStrictEqual(s.size.open, { w: DEFAULTS.size.open.w, h: 301 });
  assert.strictEqual(s.theme.mode, 'auto'); assert.strictEqual(s.theme.seed, DEFAULTS.theme.seed); assert.strictEqual(s.theme.variant, 'vibrant');
  assert.deepStrictEqual(s.tabs.slice(0, 2), ['usage', 'home']); assert.strictEqual(new Set(s.tabs).size, s.tabs.length); assert.ok(s.tabs.includes('clipboard'));
  assert.deepStrictEqual(s.hiddenTabs, ['timer', 'clipboard']);
  assert.strictEqual(s.hotkey, DEFAULTS.hotkey); assert.strictEqual(s.units.temp, 'c'); assert.strictEqual(s.mascot.delay, 120); assert.strictEqual(s.autoHide, false);
  ok('sanitize clamps sizes, rejects bad enums/colours/hotkeys, dedupes tabs, appends missing tabs');
}
{
  const s = sanitize({ tabs: ['home', 'music'], hiddenTabs: ['home', 'music', 'weather', 'timer', 'usage', 'clipboard'] });
  assert.ok(s.tabs.some((t) => !s.hiddenTabs.includes(t))); ok('never allows every tab to be hidden');
  assert.deepStrictEqual(sanitize(null), sanitize(undefined)); assert.deepStrictEqual(sanitize('garbage'), sanitize({})); ok('non-object input falls back to defaults');
  assert.strictEqual(DEFAULTS.autoHide, false); assert.strictEqual(DEFAULTS.hideInFullscreen, true); ok('defaults: auto-hide off, hide-in-fullscreen on');
}

// ---- store: persistence, corruption, merge, events
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyisland-'));
  const file = path.join(dir, 'settings.json');
  const a = createStore(file, { debounceMs: 5 });
  let events = 0; a.onChange(() => events++);
  a.set({ size: { open: { w: 600 } } });
  assert.strictEqual(a.get().size.open.w, 600); assert.strictEqual(a.get().size.open.h, DEFAULTS.size.open.h); ok('partial patch deep-merges, untouched keys stay');
  a.set({ size: { open: { w: 600 } } }); assert.strictEqual(events, 1); ok('no-op set does not fire change');
  a.set({ tabs: ['weather', 'home', 'music', 'timer', 'usage', 'clipboard'] });
  a.flush();
  const b = createStore(file);
  assert.deepStrictEqual(b.get(), a.get()); assert.strictEqual(b.get().tabs[0], 'weather'); ok('round-trips through disk');
  fs.writeFileSync(file, '{ this is not json');
  const c = createStore(file);
  assert.deepStrictEqual(c.get(), sanitize(DEFAULTS)); assert.ok(fs.existsSync(file + '.corrupt')); ok('corrupt file -> defaults, original kept as .corrupt');
  fs.writeFileSync(file, JSON.stringify({ size: { idle: { w: 12345 } }, theme: { mode: 'dark' } }));
  const d = createStore(file); assert.strictEqual(d.get().size.idle.w, LIMITS.idleW[1]); assert.strictEqual(d.get().theme.mode, 'dark'); ok('hand-edited out-of-range values are clamped on load');
  d.reset(); assert.deepStrictEqual(d.get(), sanitize(DEFAULTS)); ok('reset restores defaults');
}

// ---- visibility rules
{
  const base = { autoHide: false, hideInFullscreen: true, near: false, hovering: false, open: false, settingsOpen: false, toast: false, alert: false, hotkeyReveal: false, fullscreen: false };
  const v = (o) => computeVisibility({ ...base, ...o });
  assert.deepStrictEqual(v({}), { window: true, island: true, reason: 'always' }); ok('default: always visible');
  assert.strictEqual(v({ autoHide: true }).island, false); ok('auto-hide: hidden when nothing needs it');
  for (const k of ['near', 'hovering', 'open', 'settingsOpen', 'toast', 'alert', 'hotkeyReveal']) assert.strictEqual(v({ autoHide: true, [k]: true }).island, true, k);
  ok('auto-hide: pointer, hover, open island, settings, toast, timer alert and hotkey all reveal it');
  assert.strictEqual(v({ fullscreen: true }).window, false); ok('fullscreen app hides the whole window');
  assert.strictEqual(v({ fullscreen: true, toast: true, alert: true, hotkeyReveal: true, near: true }).window, false); ok('fullscreen beats toasts, alerts and the hotkey');
  assert.strictEqual(v({ fullscreen: true, hideInFullscreen: false }).window, true); ok('fullscreen hiding can be switched off');
  assert.strictEqual(v({ fullscreen: false, autoHide: true }).window, true); ok('window stays up while auto-hidden (it is click-through)');
}
console.log(out.join('\n')); console.log(out.length + ' checks passed');
