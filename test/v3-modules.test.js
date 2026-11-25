// 3.0 modules without Electron: shelf, drag detection, captures, downloads, network, focus mode, notes, link tools, mixer parsing, new settings.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sanitize, DEFAULTS } = require('../settingsStore');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyv3-'));
const settings = (o) => ({ get: () => sanitize(Object.assign({ shelf: { enabled: true } }, o || {})) });

(async () => {
  // ---- settings: defaults, bounds, nothing risky on by default
  const d = sanitize({});
  assert.strictEqual(d.localsend.enabled, false); assert.strictEqual(d.localsend.receive, false);
  assert.strictEqual(d.captures.enabled, false); assert.strictEqual(d.downloads.enabled, false); assert.strictEqual(d.network.enabled, false);
  assert.strictEqual(d.notes.enabled, false); assert.strictEqual(d.mixer.enabled, false); assert.strictEqual(d.focus.sync, false);
  assert.strictEqual(d.urltools.shorten, false, 'shortening sends the link to another service: opt-in');
  assert.strictEqual(d.shelf.enabled, false, 'the shelf starts off like the Send tab');
  assert.deepStrictEqual(sanitize(DEFAULTS), d, 'defaults are a fixed point');
  assert.strictEqual(sanitize({ shelf: { max: 9999 } }).shelf.max, 40);
  assert.strictEqual(sanitize({ shelf: { max: 0 } }).shelf.max, 3);
  assert.strictEqual(sanitize({ localsend: { enabled: 'yes' } }).localsend.enabled, false, 'only real booleans count');
  assert.ok(!/[\u0000-\u001f]/.test(sanitize({ localsend: { alias: 'a\u0000b\nc' } }).localsend.alias));

  // ---- shelf
  const sdir = path.join(tmp, 'shelf'); const f1 = path.join(tmp, 'one.txt'), f2 = path.join(tmp, 'two.txt'), dir1 = path.join(tmp, 'folder');
  fs.writeFileSync(f1, 'hello'); fs.writeFileSync(f2, 'x'); fs.mkdirSync(dir1);
  let broadcasts = 0, dragged = [];
  const mk = (o) => require('../main/shelf').create({ store: settings(o), dataDir: () => sdir, broadcast: () => { broadcasts++; }, startDrag: (s, p) => dragged.push(p) });
  let sh = mk();
  sh.add([f1, f2, dir1, f1, 'relative.txt', path.join(tmp, 'nope.txt'), 42]);
  let l = sh.list();
  assert.deepStrictEqual(l.map((x) => x.name), ['folder', 'two.txt', 'one.txt'], 'newest first; duplicates, relative and missing paths ignored');
  assert.strictEqual(l[0].isDir, true); assert.strictEqual(l[2].size, 5);
  assert.deepStrictEqual(mk().list().map((x) => x.name), ['folder', 'two.txt', 'one.txt'], 'survives a restart');
  assert.ok(broadcasts > 0);
  assert.strictEqual(sh.dragOut({}, l[2].id), true); assert.deepStrictEqual(dragged, [f1]);
  fs.unlinkSync(f2); assert.strictEqual(sh.list().find((x) => x.name === 'two.txt').missing, true);
  assert.strictEqual(sh.dragOut({}, l[1].id), false, 'a missing file is not dragged');
  sh.remove(l[0].id); assert.strictEqual(sh.list().length, 2);
  sh.clear(); assert.strictEqual(sh.list().length, 0);
  assert.strictEqual(mk({ shelf: { enabled: false } }).add([f1]).length, 0, 'off means nothing is added');
  const small = mk({ shelf: { max: 3 } }); small.add([f1]); small.add([dir1]); small.add([tmp]); small.add([sdir]);
  assert.ok(small.list().length <= 3, 'limit holds');

  // ---- drag detection
  const dw = require('../main/dropwatch');
  const b = { x: 0, y: 0, width: 1920, height: 1080 };
  const z = dw.zone(b, 'top', 400, 200);
  assert.strictEqual(z.width, 480); assert.strictEqual(z.y, 0); assert.ok(dw.inside({ x: 960, y: 10 }, z)); assert.ok(!dw.inside({ x: 10, y: 10 }, z));
  const zl = dw.zone(b, 'left', 400, 200); assert.strictEqual(zl.x, 0); const zr = dw.zone(b, 'right', 400, 200); assert.strictEqual(zr.x + zr.width, 1920);
  let m = dw.createMachine();
  m.button(true, false, 1000);
  assert.strictEqual(m.step(true, 1050), null, 'too soon to tell a drag from a click');
  assert.strictEqual(m.step(true, 1200), 'arm'); assert.ok(m.isArmed());
  m.button(false, true, 1300);
  assert.strictEqual(m.step(true, 1500), null); assert.strictEqual(m.step(true, 1700), 'disarm', 'disarms after the drop was delivered');
  m = dw.createMachine(); m.button(true, true, 0);
  assert.strictEqual(m.step(true, 500), null, 'a press that started inside the zone never arms');
  m = dw.createMachine(); m.button(true, false, 0);
  assert.strictEqual(m.step(false, 500), null, 'dragging elsewhere never arms');
  m = dw.createMachine(); m.button(true, false, 0); m.step(true, 300);
  assert.strictEqual(m.step(false, 400), null); assert.strictEqual(m.step(false, 1200), 'disarm', 'leaving the zone disarms');
  m = dw.createMachine(); m.button(true, false, 0); m.step(true, 300); assert.strictEqual(m.reset(), true); assert.ok(!m.isArmed());

  // ---- captures
  const cdir = path.join(tmp, 'caps'); fs.mkdirSync(cdir);
  const old = path.join(cdir, 'old.png'); fs.writeFileSync(old, 'old'); const past = new Date(Date.now() - 3600e3); fs.utimesSync(old, past, past);
  const lists = [], news = [];
  const cap = require('../main/captures').create({ dirs: () => [cdir], onList: (x) => lists.push(x), onNew: (x) => news.push(x) });
  cap.start(); cap._tick();
  assert.strictEqual(cap.list().length, 0, 'what was there before is not news');
  const fresh = path.join(cdir, 'shot.png'); fs.writeFileSync(fresh, 'a'); fs.writeFileSync(path.join(cdir, 'notes.txt'), 'x');
  cap._tick(); assert.strictEqual(news.length, 0, 'not ready until the size settles'); cap._tick();
  assert.strictEqual(news.length, 1); assert.strictEqual(news[0].kind, 'image'); assert.strictEqual(cap.find(news[0].id).path, fresh);
  fs.writeFileSync(path.join(cdir, 'clip.mp4'), 'v'); cap._tick(); cap._tick();
  assert.deepStrictEqual(cap.list().map((x) => x.kind), ['video', 'image']);
  cap.dismiss(news[0].id); assert.strictEqual(cap.list().length, 1);
  cap.stop(); assert.strictEqual(cap.running(), false); assert.strictEqual(cap.list().length, 0);

  // ---- downloads
  const ddir = path.join(tmp, 'dl'); fs.mkdirSync(ddir);
  let clock = Date.now(), done = [], dl;
  dl = require('../main/downloads').create({ dir: () => ddir, now: () => clock, onDone: (x) => done.push(x.name) });
  fs.writeFileSync(path.join(ddir, 'big.zip.crdownload'), '12345'); fs.writeFileSync(path.join(ddir, 'plain.txt'), 'x');
  dl._tick();
  assert.deepStrictEqual(dl.list().map((x) => [x.name, x.bytes, x.state]), [['big.zip', 5, 'downloading']]);
  fs.appendFileSync(path.join(ddir, 'big.zip.crdownload'), '678'); dl._tick(); assert.strictEqual(dl.list()[0].bytes, 8);
  fs.renameSync(path.join(ddir, 'big.zip.crdownload'), path.join(ddir, 'big.zip')); dl._tick();
  assert.deepStrictEqual(done, ['big.zip']); assert.strictEqual(dl.list()[0].state, 'done');
  clock += 7000; dl._tick(); assert.strictEqual(dl.list().length, 0, 'done entries leave after a few seconds');
  fs.writeFileSync(path.join(ddir, 'ghost.part'), 'z'); fs.rmSync(path.join(ddir, 'ghost.part')); dl._tick(); assert.strictEqual(done.length, 1, 'a cancelled download is not "done"');
  const stale = path.join(ddir, 'stale.crdownload'); fs.writeFileSync(stale, 'z'); const long = new Date(Date.now() - 3600e3); fs.utimesSync(stale, long, long);
  dl._tick(); assert.strictEqual(dl.list().length, 0, 'an old leftover is not a download');

  // ---- network
  const N = require('../main/network');
  const a4 = (address, internal) => ({ family: 'IPv4', address, internal: !!internal });
  assert.deepStrictEqual(N.parseIfaces({ 'Wi-Fi': [a4('192.168.1.5')], Loopback: [a4('127.0.0.1', true)] }), { ip: '192.168.1.5', vpn: false, vpnName: '' });
  const v = N.parseIfaces({ 'Wi-Fi': [a4('192.168.1.5')], 'ProtonVPN': [a4('10.2.0.2')] });
  assert.strictEqual(v.vpn, true); assert.strictEqual(v.vpnName, 'ProtonVPN'); assert.strictEqual(v.ip, '192.168.1.5', 'the VPN adapter is not the machine address');
  assert.strictEqual(N.parseIfaces({ 'Ethernet': [a4('169.254.3.3')] }).ip, '', 'link-local means no network');
  assert.strictEqual(N.parseIfaces(null).ip, '');
  const srv = require('net').createServer((s) => s.end()).listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  const ms = await N.tcpPing('127.0.0.1', srv.address().port, 2000); assert.ok(typeof ms === 'number' && ms >= 0);
  srv.close(); assert.strictEqual(await N.tcpPing('127.0.0.1', 1, 500), null, 'nothing listening is offline');

  // ---- focus mode
  const F = require('../main/focusmode');
  assert.strictEqual(F.parseDnd('    NOC_GLOBAL_SETTING_TOASTS_ENABLED    REG_DWORD    0x0'), true);
  assert.strictEqual(F.parseDnd('    NOC_GLOBAL_SETTING_TOASTS_ENABLED    REG_DWORD    0x1'), false);
  assert.strictEqual(F.parseDnd('ERROR: The system was unable to find the specified registry key'), null);
  let dnd = false; const ch = [];
  const fm = F.create({ onChange: (x) => ch.push(x), readDnd: async () => dnd, intervalMs: 20 });
  fm.start(); await new Promise((r) => setTimeout(r, 90)); dnd = true; await new Promise((r) => setTimeout(r, 90)); fm.stop();
  assert.ok(ch.includes(true), 'a change is reported'); assert.ok(ch.length <= 2, 'only changes are reported, not every look: ' + ch);

  // ---- notes
  const Nt = require('../main/notes'); const dt = new Date(2026, 0, 5, 9, 7);
  assert.strictEqual(Nt.formatLine('  buy milk\nand eggs ', dt), '- 2026-01-05 09:07  buy milk and eggs\n');
  assert.strictEqual(Nt.formatLine('   \n ', dt), ''); assert.strictEqual(Nt.formatLine(null), '');
  assert.strictEqual(Nt.formatLine('a\u0000b', dt), '- 2026-01-05 09:07  ab\n');
  assert.ok(Nt.formatLine('x'.repeat(5000), dt).length < 2100);
  const nf = path.join(tmp, 'deep', 'dir', 'notes.md');
  assert.strictEqual(Nt.append(nf, 'one', dt).ok, true); assert.strictEqual(Nt.append(nf, 'two', dt).ok, true);
  assert.strictEqual(fs.readFileSync(nf, 'utf8'), '- 2026-01-05 09:07  one\n- 2026-01-05 09:07  two\n');
  fs.writeFileSync(nf, 'no newline at end'); Nt.append(nf, 'three', dt); assert.strictEqual(fs.readFileSync(nf, 'utf8').split('\n').length, 3, 'a file without a final newline is not glued to');
  assert.strictEqual(Nt.append(nf, '  ', dt).ok, false);
  assert.strictEqual(Nt.append(path.join(nf, 'x'), 'bad', dt).ok, false, 'a path that cannot be written reports an error');

  // ---- link tools
  const U = require('../main/urltools');
  assert.strictEqual(U.cleanUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1');
  for (const bad of ['javascript:alert(1)', 'file:///C:/x', 'ms-msdt:/x', 'example.com', 'https://a.com/\nx', '', null, 'https://a.com/' + 'x'.repeat(3000)]) assert.strictEqual(U.cleanUrl(bad), '', String(bad).slice(0, 30));
  const fake = (text, okv = true) => async () => ({ ok: okv, text: async () => text });
  assert.deepStrictEqual(await U.shorten('https://example.com/long', fake('https://is.gd/abc123')), { ok: true, url: 'https://is.gd/abc123' });
  assert.strictEqual((await U.shorten('https://example.com', fake('https://evil.example/x'))).ok, false, 'only an is.gd link is trusted back');
  assert.strictEqual((await U.shorten('https://example.com', fake('Error: Please enter a valid URL', true))).ok, false);
  assert.strictEqual((await U.shorten('javascript:1', fake('https://is.gd/a'))).ok, false);
  assert.strictEqual((await U.shorten('https://example.com', async () => { throw new Error('offline'); })).ok, false);
  let seenUrl = ''; await U.shorten('https://example.com/a%20b&c=d', async (u) => { seenUrl = u; return { ok: true, text: async () => 'x' }; });
  assert.ok(seenUrl.startsWith('https://is.gd/create.php?format=simple&url=https%3A%2F%2Fexample.com%2Fa%2520b%26c%3Dd'), seenUrl);

  // ---- mixer output parsing
  const M = require('../main/mixer');
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  assert.deepStrictEqual(M.parseMix(enc([{ pid: 4, name: 'chrome', volume: 55.4, mute: false }, { pid: 0, name: 'System sounds', volume: 100, mute: true }])), [{ pid: 4, name: 'chrome', volume: 55, mute: false }, { pid: 0, name: 'System sounds', volume: 100, mute: true }]);
  assert.strictEqual(M.parseMix(enc({ pid: 7, name: 'solo', volume: 20, mute: false })).length, 1, 'PowerShell turns a one item list into an object');
  assert.deepStrictEqual(M.parseMix(enc([{ pid: 'x', name: 'bad' }, { pid: 1, name: 5 }, null])), []);
  assert.strictEqual(M.parseMix(enc([{ pid: 1, name: 'a\u0007b', volume: 900 }]))[0].volume, 100);
  assert.strictEqual(M.parseMix(enc([{ pid: 1, name: 'a\u0007b', volume: 5 }]))[0].name, 'ab');
  assert.deepStrictEqual(M.parseMix('%%%not base64'), []);
  const mx = M.create({ unpacked: () => 'x' }); assert.deepStrictEqual(await mx.set(-1, 5, null), { ok: false }); assert.deepStrictEqual(await mx.set('abc', 5, null), { ok: false }); mx.stop();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('PASS v3 modules');
})().catch((e) => { console.error(e); process.exit(1); });
