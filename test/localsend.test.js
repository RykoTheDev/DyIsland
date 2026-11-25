// LocalSend: path safety, folder walking, device list rules, and a real send between two instances over HTTPS on this machine.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const L = require('../main/localsend');
const selfcert = require('../main/selfcert');
const out = []; const ok = (n) => out.push('PASS ' + n);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyls-'));

(async () => {
  // ---- names from the other device can never leave the save folder
  {
    const s = L.safeRel;
    assert.strictEqual(s('a.txt'), 'a.txt');
    assert.strictEqual(s('../../Windows/evil.dll'), path.join('Windows', 'evil.dll'));
    assert.strictEqual(s('C:\\Windows\\x.txt'), path.join('C_', 'Windows', 'x.txt'));
    assert.strictEqual(s('/etc/passwd'), path.join('etc', 'passwd'));
    assert.strictEqual(s('..'), ''); assert.strictEqual(s(''), ''); assert.strictEqual(s(null), '');
    assert.strictEqual(s('dir/CON.txt'), path.join('dir', '_CON.txt'));
    assert.strictEqual(s('bad<name>?.txt'), 'bad_name__.txt');
    assert.strictEqual(s('trailing. '), 'trailing');
    ok('safeRel strips traversal, drive letters, reserved names, illegal characters');
  }
  // ---- certificate
  {
    const c = selfcert.generate(); const x = new crypto.X509Certificate(c.cert);
    assert.strictEqual(x.fingerprint256.replace(/:/g, '').toLowerCase(), c.fingerprint); assert.ok(x.verify(x.publicKey));
    const f = path.join(tmp, 'cert.json'); const a = selfcert.load(f), b = selfcert.load(f); assert.strictEqual(a.fingerprint, b.fingerprint);
    ok('self-signed certificate is valid and persists');
  }
  // ---- folder walking
  const src = path.join(tmp, 'src'); fs.mkdirSync(path.join(src, 'photos', 'sub'), { recursive: true });
  fs.writeFileSync(path.join(src, 'photos', 'a.txt'), 'hello'); fs.writeFileSync(path.join(src, 'photos', 'sub', 'b.png'), crypto.randomBytes(3 * 1024 * 1024)); fs.writeFileSync(path.join(src, 'photos', 'empty.bin'), '');
  fs.writeFileSync(path.join(src, 'single.txt'), 'single');
  {
    const f = L.collect([path.join(src, 'photos'), path.join(src, 'single.txt'), 'relative/nope', path.join(src, 'missing')]);
    assert.deepStrictEqual(f.map((x) => x.fileName).sort(), ['photos/a.txt', 'photos/empty.bin', 'photos/sub/b.png', 'single.txt']);
    assert.ok(f.every((x) => x.id && x.fileType)); ok('folders are walked into files with forward-slash relative paths');
  }
  // ---- two instances: B receives, A sends
  const mk = (name, extra = {}) => {
    const st = { v: { localsend: { enabled: true, receive: true, alias: name, saveDir: path.join(tmp, name + '-save'), autoAccept: false, ...extra } } };
    const ev = { devices: [], progress: [], incoming: [], received: [] };
    const inst = L.create({ store: { get: () => st.v }, dataDir: () => path.join(tmp, name), defaultSaveDir: () => path.join(tmp, name + '-dl'), port: 0, multicast: false,
      onDevices: (l) => ev.devices.push(l), onProgress: (p) => ev.progress.push(p), onIncoming: (i) => ev.incoming.push(i), onReceived: (r) => ev.received.push(r) });
    return { inst, ev, st };
  };
  const A = mk('alice'), B = mk('bob');
  await A.inst.sync(); await B.inst.sync();
  assert.ok(B.inst.status().receiving && B.inst._port() > 0); ok('receiver starts and reports its port');
  const wait = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 25)); } };
  const seeB = () => A.inst._addDevice({ alias: 'Bob', deviceModel: 'x', deviceType: 'desktop', fingerprint: B.inst.fingerprint, port: B.inst._port(), protocol: 'https' }, '127.0.0.1');
  {
    assert.strictEqual(A.inst._addDevice({ fingerprint: A.inst.fingerprint, port: 1 }, '1.1.1.1'), null);   // ourselves
    assert.strictEqual(A.inst._addDevice({ fingerprint: 'zz', port: 1 }, '1.1.1.1'), null);
    assert.strictEqual(A.inst._addDevice({ fingerprint: 'AB'.repeat(32), port: 99999 }, '1.1.1.1'), null);
    const d = seeB(); assert.strictEqual(d.id, B.inst.fingerprint); assert.deepStrictEqual(A.inst.devices().map((x) => x.alias), ['Bob']);
    assert.deepStrictEqual(Object.keys(A.inst.devices()[0]).sort(), ['alias', 'deviceModel', 'deviceType', 'id', 'ip', 'port']);
    ok('device list ignores ourselves and bad announcements, and has the contract shape');
  }
  {
    A.inst._sweep(); assert.strictEqual(A.inst.devices().length, 1);
    const realNow = Date.now; Date.now = () => realNow() + 80000; A.inst._sweep(); Date.now = realNow;
    assert.strictEqual(A.inst.devices().length, 0); seeB(); ok('devices expire after 75 s without an answer');
  }
  {                                                                                   // decline
    const r = await A.inst.send(B.inst.fingerprint, [path.join(src, 'single.txt')]); assert.ok(r.ok);
    try { await wait(() => B.ev.incoming.length === 1); } catch (e) { console.error(JSON.stringify(A.ev.progress)); throw e; }
    assert.strictEqual(B.ev.incoming[0].alias, 'alice'); assert.deepStrictEqual(B.ev.incoming[0].files, [{ name: 'single.txt', size: 6 }]);
    B.inst.respond(B.ev.incoming[0].id, false);
    await wait(() => A.ev.progress.some((p) => p.state === 'declined'));
    assert.ok(!fs.existsSync(path.join(tmp, 'bob-save', 'single.txt'))); ok('declined transfer reports declined and writes nothing');
  }
  {                                                                                   // accept, folder + file
    const n0 = B.ev.incoming.length;
    const r = await A.inst.send(B.inst.fingerprint, [path.join(src, 'photos'), path.join(src, 'single.txt')]); assert.ok(r.ok);
    await wait(() => B.ev.incoming.length === n0 + 1);
    B.inst.respond(B.ev.incoming[n0].id, true);
    await wait(() => A.ev.progress.some((p) => p.sessionId === r.sessionId && p.state === 'done'));
    const mine = A.ev.progress.filter((p) => p.sessionId === r.sessionId);
    assert.strictEqual(mine[0].state, 'waiting'); assert.ok(mine.some((p) => p.state === 'sending'));
    const last = mine[mine.length - 1]; assert.strictEqual(last.sentBytes, last.totalBytes); assert.strictEqual(last.totalBytes, 5 + 3 * 1024 * 1024 + 6);
    const dir = path.join(tmp, 'bob-save');
    assert.strictEqual(fs.readFileSync(path.join(dir, 'photos', 'a.txt'), 'utf8'), 'hello');
    assert.strictEqual(fs.statSync(path.join(dir, 'photos', 'sub', 'b.png')).size, 3 * 1024 * 1024);
    assert.ok(Buffer.compare(fs.readFileSync(path.join(dir, 'photos', 'sub', 'b.png')), fs.readFileSync(path.join(src, 'photos', 'sub', 'b.png'))) === 0);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'single.txt'), 'utf8'), 'single'); assert.ok(fs.existsSync(path.join(dir, 'photos', 'empty.bin')));
    assert.ok(!fs.readdirSync(path.join(dir, 'photos')).some((f) => f.endsWith('.part')));
    await wait(() => B.ev.received.some((x) => x.state === 'done')); ok('accepted folder + file arrive intact with their sub-folders, progress reaches 100%');
  }
  {                                                                                   // a hostile sender cannot write outside, or without a token
    const https = require('https'); const me = selfcert.generate();
    const call = (p, body, q) => new Promise((resolve, reject) => { const b = Buffer.from(JSON.stringify(body || {})); const r = https.request({ host: '127.0.0.1', port: B.inst._port(), method: 'POST', path: '/api/localsend/v2/' + p + (q || ''), rejectUnauthorized: false, key: me.key, cert: me.cert, agent: false, headers: { 'content-type': 'application/json', 'content-length': b.length } }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); }); r.on('error', reject); r.end(b); });
    const info = { alias: 'evil', version: '2.0', fingerprint: me.fingerprint.toUpperCase(), port: 1, protocol: 'https' };
    assert.strictEqual((await call('prepare-upload', { info: { ...info, fingerprint: 'AA'.repeat(32) }, files: { f: { id: 'f', fileName: 'x', size: 1 } } })).status, 403);
    assert.strictEqual((await call('prepare-upload', { info, files: {} })).status, 400);
    assert.strictEqual((await call('upload', {}, '?sessionId=a&fileId=b&token=c')).status, 403);
    assert.strictEqual((await call('upload', {}, '')).status, 400);
    const n0 = B.ev.incoming.length;
    const p = call('prepare-upload', { info, files: { f: { id: 'f', fileName: '..\\..\\escape.txt', size: 1 } } });
    await wait(() => B.ev.incoming.length === n0 + 1);
    assert.strictEqual((await call('prepare-upload', { info, files: { f: { id: 'f', fileName: 'y', size: 1 } } })).status, 409);   // one at a time
    assert.strictEqual(B.ev.incoming[n0].files[0].name, 'escape.txt'); B.inst.respond(B.ev.incoming[n0].id, false);
    assert.strictEqual((await p).status, 403); assert.ok(!fs.existsSync(path.join(tmp, 'escape.txt')));
    ok('receiver rejects wrong fingerprints, bad bodies, bad tokens, a second session, and path traversal');
  }
  {                                                                                   // toggles
    B.st.v.localsend.receive = false; await B.inst.sync(); assert.ok(!B.inst.status().receiving);
    A.st.v.localsend.enabled = false; await A.inst.sync(); assert.deepStrictEqual(await A.inst.send('x', [src]), { ok: false, error: 'LocalSend is off' }); assert.strictEqual(A.inst.devices().length, 0);
    ok('turning the switches off stops the receiver and discovery');
  }
  A.inst.stop(); B.inst.stop();
  console.log(out.join('\n')); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error(out.join('\n')); console.error(e); process.exit(1); });
