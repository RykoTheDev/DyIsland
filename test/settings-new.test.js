// The settings added in this round: defaults, validation, and that a hand-edited file cannot sneak something in.
const assert = require('assert');
const { sanitize, DEFAULTS } = require('../settingsStore.js');

const d = sanitize({});
assert.deepStrictEqual(d.updates, { check: true });
assert.deepStrictEqual(d.music, { artColors: true });
assert.deepStrictEqual(d.hud, { volume: true });
assert.deepStrictEqual(d.devices, { toasts: true, charger: true, battery: true, lowAt: 15 });
assert.deepStrictEqual(d.meetings, { dnd: false }, 'call-aware Do not disturb is opt-in');
assert.deepStrictEqual(d.notifications, { mirror: false, apps: '' }, 'mirroring Windows notifications is opt-in');
assert.deepStrictEqual(d.events, { url: '' });
assert.deepStrictEqual(d.clipboard, { enabled: false, max: 12, images: false, paste: false, persistPins: false }, 'every clipboard extra is off by default');
assert.strictEqual(d.size.adaptive, true);
assert.deepStrictEqual(sanitize(DEFAULTS), d, 'sanitize(DEFAULTS) is a fixed point');

// the calendar link: https only (webcal becomes https), nothing else survives
assert.strictEqual(sanitize({ events: { url: 'webcal://cal.example.com/a.ics' } }).events.url, 'https://cal.example.com/a.ics');
for (const bad of ['http://cal.example.com/a.ics', 'file:///c:/secret.ics', 'javascript:alert(1)', 'ftp://x/y.ics', 'https://a b.ics', 'x'.repeat(700), 42, null, {}]) assert.strictEqual(sanitize({ events: { url: bad } }).events.url, '', 'refuses ' + String(bad).slice(0, 30));

// the notification app filter is plain short text; wrong types fall back
assert.deepStrictEqual(sanitize({ notifications: { mirror: true, apps: 'Slack,' + String.fromCharCode(0) + ' Outlook' + String.fromCharCode(10) } }).notifications.apps.split(',').map((x) => x.trim()), ['Slack', 'Outlook'], 'control characters are replaced');
assert.strictEqual(sanitize({ notifications: { mirror: 'yes', apps: 5 } }).notifications.mirror, false, 'not a boolean: default');
assert.strictEqual(sanitize({ notifications: { apps: 5 } }).notifications.apps, '');
assert.strictEqual(sanitize({ notifications: { apps: 'a'.repeat(500) } }).notifications.apps.length, 200);

// booleans only
assert.strictEqual(sanitize({ clipboard: { images: 'true', paste: 1, persistPins: {} } }).clipboard.images, false);
assert.strictEqual(sanitize({ size: { adaptive: 'no' } }).size.adaptive, true);
// the Next event card is an allowed home card, and the same card twice is still refused
assert.strictEqual(sanitize({ home: { first: 'events', second: 'music' } }).home.first, 'events');
assert.strictEqual(sanitize({ home: { first: 'events', second: 'events' } }).home.second, 'none');
console.log('PASS settings added this round: defaults, opt-ins off, calendar link rules, filters, types');

// The Send and Shelf tabs survive sanitize (a store round trip), stay hidden while their feature is off and show once it is on.
{
  const { TAB_IDS } = require('../settingsStore.js');
  assert.ok(TAB_IDS.includes('localsend') && !TAB_IDS.includes('shelf'), 'one merged Share tab, no shelf tab');
  const off = sanitize({});
  assert.ok(off.tabs.includes('localsend') && !off.tabs.includes('shelf'), 'ids are kept in the order');
  assert.ok(off.hiddenTabs.includes('localsend') && !off.hiddenTabs.includes('shelf'), 'hidden by default');
  const on = sanitize({ localsend: { enabled: true }, shelf: { enabled: true }, hiddenTabs: [] });
  assert.deepStrictEqual(on.hiddenTabs.filter((t) => t === 'localsend'), [], 'shown when the features are on');
  const sticky = sanitize({ shelf: { enabled: false }, hiddenTabs: [] });
  assert.ok(sticky.hiddenTabs.includes('localsend'), 'both features off is hidden even if the list says otherwise');
  assert.ok(!sanitize({ shelf: { enabled: true }, hiddenTabs: [] }).hiddenTabs.includes('localsend'), 'shelf alone keeps the Share tab visible');
  assert.ok(!sanitize({ localsend: { enabled: true }, hiddenTabs: [] }).hiddenTabs.includes('localsend'), 'localsend alone keeps the Share tab visible');
  const old = sanitize({ tabs: ['home', 'shelf', 'localsend', 'music'], hiddenTabs: ['localsend', 'clipboard'], shelf: { enabled: true } });
  assert.ok(!old.tabs.includes('shelf') && !old.hiddenTabs.includes('shelf'), 'a stored shelf id is dropped');
  assert.ok(!old.hiddenTabs.includes('localsend'), 'a user with a visible Shelf tab keeps the merged tab');
  assert.ok(sanitize({ tabs: ['shelf'], hiddenTabs: ['shelf'] }).hiddenTabs.every((t) => t !== 'shelf'), 'a hidden shelf id is dropped silently');
  assert.ok(!('battery' in sanitize({ battery: { warn: false } })), 'the unused battery.warn key is gone');
  const rt = sanitize(JSON.parse(JSON.stringify(on)));
  assert.deepStrictEqual(rt.tabs, on.tabs); assert.deepStrictEqual(rt.hiddenTabs, on.hiddenTabs);
  assert.deepStrictEqual(sanitize({}).devices, { toasts: true, charger: true, battery: true, lowAt: 15 });
  assert.strictEqual(sanitize({ devices: { lowAt: 999 } }).devices.lowAt, 50);
}
