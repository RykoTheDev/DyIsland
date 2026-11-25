// Regression tests for what the independent review found (each of these failed before the fix).
const assert = require('assert');
const Module = require('module');
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? { net: {} } : orig.call(this, r, ...a); };

(async () => {
  // 1. "Use my location": the coordinates line is parsed
  const h = {}; require('../main/weather.js').register({ ipcMain: { handle: (c, f) => { h[c] = f; } }, run: async () => ({ ok: true, out: '52.5200 13.4050\r\n' }), unpacked: (x) => x });
  assert.deepStrictEqual(await h['weather:locate'](), { lat: 52.52, lon: 13.405 });
  h['weather:locate'] = null; const h2 = {}; require('../main/weather.js').register({ ipcMain: { handle: (c, f) => { h2[c] = f; } }, run: async () => ({ ok: true, out: 'FAIL\r\n' }), unpacked: (x) => x });
  assert.deepStrictEqual(await h2['weather:locate'](), { error: 'unavailable' });

  // 5. a repeating event that started years ago still shows up
  const { parseEvents } = require('../main/ics.js');
  const NOW = Date.parse('2026-11-25T09:00:00Z');
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:old@t', 'DTSTART:20140101T100000Z', 'DTEND:20140101T103000Z', 'RRULE:FREQ=DAILY', 'SUMMARY:Daily since 2014', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:hr@t', 'DTSTART:20260101T000000Z', 'DTEND:20260101T001500Z', 'RRULE:FREQ=HOURLY', 'SUMMARY:Hourly', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const ev = parseEvents(ics, { now: NOW, days: 3 });
  assert(ev.some((e) => e.title === 'Daily since 2014'), 'a daily event from 2014 appears');
  assert(ev.some((e) => e.title === 'Hourly'), 'an hourly event from this year appears');

  // 6. DNS: addresses Windows would refuse are refused here, and custom entries are never silently dropped
  const D = require('../dns-profiles.js');
  for (const bad of ['1:2', ':::', '1::2::3', '12345::1']) assert(!D.isV6(bad), 'refuses ' + bad);
  for (const good of ['2606:4700:4700::1111', '::1', '2a10:50c0::ad1:ff']) assert(D.isV6(good), 'accepts ' + good);
  const { sanitize } = require('../settingsStore.js');
  const all = D.PRESETS.map((p) => p.id);
  const d = sanitize({ dnsp: { presets: all, custom: [{ name: 'Mine', v4a: '10.0.0.9' }] } }).dnsp;
  assert(d.presets.length + d.custom.length <= D.MAX_PROFILES && d.custom.length === 1, 'the custom entry is kept and the presets give way');
  assert.strictEqual(D.buildProfiles(d).length, d.presets.length + d.custom.length, 'everything saved is installed');

  // 9. no scripts as app shortcuts
  assert.strictEqual(sanitize({ shortcuts: { apps: [{ path: 'C:\\Users\\a\\Downloads\\x.bat' }, { path: 'C:\\a\\b.cmd' }, { path: 'C:\\a\\b.exe' }] } }).shortcuts.apps.length, 1);

  // 4. Google: twenty settings changes make one sync, and two refreshes never overlap
  const G = require('../main/google.js'), fs = require('fs'), os = require('os'), path = require('path');
  let n = 0, running = 0, maxRunning = 0;
  const fake = async (url) => { n++; running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 15)); running--;
    const json = (b) => ({ ok: true, status: 200, json: async () => b });
    if (/token/.test(url)) return json({ access_token: 'AT', expires_in: 3600 }); if (/calendarList/.test(url)) return json({ items: [] }); if (/tasks\/v1\/users/.test(url)) return json({ items: [] });
    if (/labels\/INBOX/.test(url)) return json({ messagesUnread: 0 }); if (/messages\?q=/.test(url)) return json({ messages: [] }); return json({}); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyi-r-'));
  const ss = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('e:' + s), decryptString: (b) => String(b).replace(/^e:/, '') };
  fs.writeFileSync(path.join(dir, 'google-token.bin'), ss.encryptString(JSON.stringify({ refresh: 'RT' })));
  const g = G.create({ app: { getPath: () => dir }, safeStorage: ss, shell: {}, net: {}, store: { get: () => ({ google: { clientId: 'c', clientSecret: 's', calendar: true, tasks: true, mail: true, mailToast: true } }) }, broadcast: () => {}, logEvent: () => {}, setExtraEvents: () => {}, fetchFn: fake });
  for (let i = 0; i < 20; i++) g.sync();
  await new Promise((r) => setTimeout(r, 400));
  assert(n <= 8, 'twenty settings changes make one sync, not twenty (' + n + ' requests)'); assert.strictEqual(maxRunning, 1, 'requests never overlap');

  // 10. a repeat timer after a long sleep: one event (see timers.test.js), and clipboard pins do not outlive the history
  console.log('PASS review fixes: location parsing, long-running repeats, DNS list rules, no script shortcuts, Google sync flood');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
