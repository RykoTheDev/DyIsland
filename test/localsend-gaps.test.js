// LocalSend gaps: sha256 is sent and checked (422 + no file on a mismatch), a sender cancel reaches a receiver that is still asking,
// and a receiver /cancel without a sessionId ends the waiting prepare-upload and closes the prompt.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const L = require('../main/localsend');
const selfcert = require('../main/selfcert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyls-gaps-'));
const API = '/api/localsend/v2';
const out = []; const ok = (n) => out.push('PASS ' + n);

(async () => {
  const mk = (name, extra = {}) => {
    const st = { v: { localsend: { enabled: true, receive: true, alias: name, saveDir: path.join(tmp, name + '-save'), autoAccept: false, ...extra } } };
    const ev = { progress: [], incoming: [], closed: [], received: [] };
    const inst = L.create({ store: { get: () => st.v }, dataDir: () => path.join(tmp, name), defaultSaveDir: () => path.join(tmp, name + '-dl'), port: 0, multicast: false,
      onProgress: (p) => ev.progress.push(p), onIncoming: (i) => (i.closed ? ev.closed.push(i.id) : ev.incoming.push(i)), onReceived: (r) => ev.received.push(r) });
    return { inst, ev };
  };
  const wait = async (fn, ms = 8000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };
  const A = mk('alice'), B = mk('bob', { autoAccept: true }), C = mk('carol');
  await A.inst.sync(); await B.inst.sync(); await C.inst.sync();
  const see = (to) => A.inst._addDevice({ alias: 'x', deviceType: 'desktop', fingerprint: to.inst.fingerprint, port: to.inst._port(), protocol: 'https' }, '127.0.0.1');
  see(B); see(C);
  const src = path.join(tmp, 'src'); fs.mkdirSync(src);
  const body = crypto.randomBytes(200000); fs.writeFileSync(path.join(src, 'data.bin'), body);
  const sha = crypto.createHash('sha256').update(body).digest('hex');

  const me = selfcert.generate(), myFp = me.fingerprint.toUpperCase();
  const call = (port, p, bodyObj, q, raw) => new Promise((resolve, reject) => {
    const b = raw || Buffer.from(bodyObj === undefined ? '' : JSON.stringify(bodyObj));
    const r = https.request({ host: '127.0.0.1', port, method: 'POST', path: API + '/' + p + (q || ''), rejectUnauthorized: false, key: me.key, cert: me.cert, agent: false,
      headers: { 'content-length': b.length, 'content-type': raw ? 'application/octet-stream' : 'application/json' } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* none */ } resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject); r.end(b);
  });
  const info = { alias: 'mallory', version: '2.0', deviceType: 'mobile', fingerprint: myFp, port: 53317, protocol: 'https' };

  // ---- 1a. our sender announces the real sha256 of each file
  {
    const seen = []; const orig = https.request;
    https.request = function (opts, cb) {
      const r = orig.call(this, opts, cb);
      if (/prepare-upload/.test(opts.path || '')) { const e = r.end.bind(r); r.end = (d, ...a) => { if (d) seen.push(String(d)); return e(d, ...a); }; }
      return r;
    };
    const r = await A.inst.send(B.inst.fingerprint, [path.join(src, 'data.bin')]); assert.ok(r.ok);
    await wait(() => A.ev.progress.some((p) => p.state === 'done'));
    https.request = orig;
    assert.strictEqual(Object.values(JSON.parse(seen.join('')).files)[0].sha256, sha);
    assert.ok(fs.readFileSync(path.join(tmp, 'bob-save', 'data.bin')).equals(body));
    ok('sender announces the real sha256 and a matching file is stored');
  }

  // ---- 1b. receiver: wrong sha256 -> 422 and nothing kept; right one (any case) -> 200; none announced -> no check
  {
    const prep = (h, name) => call(B.inst._port(), 'prepare-upload', { info, files: { f1: { id: 'f1', fileName: name, size: body.length, fileType: 'application/octet-stream', sha256: h } } });
    const up = (r) => call(B.inst._port(), 'upload', undefined, '?sessionId=' + r.json.sessionId + '&fileId=f1&token=' + r.json.files.f1, body);
    let r = await prep('0'.repeat(64), 'checked.bin'); assert.strictEqual(r.status, 200);
    let u = await up(r); assert.strictEqual(u.status, 422);
    const left = fs.readdirSync(path.join(tmp, 'bob-save')).filter((n) => /checked/.test(n));
    assert.deepStrictEqual(left, [], 'no file and no .part left');
    u = await up(r); assert.strictEqual(u.status, 403, 'the session ended with the corrupt file');
    r = await prep(sha.toUpperCase(), 'checked.bin'); u = await up(r); assert.strictEqual(u.status, 200);
    assert.ok(fs.readFileSync(path.join(tmp, 'bob-save', 'checked.bin')).equals(body));
    ok('wrong sha256 gives 422 and keeps nothing; the right one is accepted in any case');
    r = await prep(null, 'unchecked.bin'); u = await up(r); assert.strictEqual(u.status, 200);
    ok('no sha256 announced means no check');
  }

  // ---- 2. sender cancel while the receiver is still deciding reaches it
  {
    const r = await A.inst.send(C.inst.fingerprint, [path.join(src, 'data.bin')]); assert.ok(r.ok);
    await wait(() => C.ev.incoming.length === 1);
    A.inst.cancel(r.sessionId);
    await wait(() => C.ev.closed.length >= 1);
    assert.strictEqual(C.ev.closed[0], C.ev.incoming[0].id, 'the prompt is closed');
    assert.strictEqual(C.inst.respond(C.ev.incoming[0].id, true), false, 'nothing left to answer');
    assert.ok(A.ev.progress.some((p) => p.sessionId === r.sessionId && p.error === 'Cancelled'));
    ok('sender cancel while the receiver is asking closes its prompt');
    const r2 = await A.inst.send(C.inst.fingerprint, [path.join(src, 'data.bin')]);
    await wait(() => C.ev.incoming.length === 2);
    C.inst.respond(C.ev.incoming[1].id, true);
    await wait(() => A.ev.progress.some((p) => p.sessionId === r2.sessionId && p.state === 'done'));
    ok('the receiver takes the next transfer afterwards');
  }

  // ---- 3. receiver /cancel without sessionId ends the waiting prepare-upload
  {
    const before = C.ev.incoming.length;
    const waiting = call(C.inst._port(), 'prepare-upload', { info, files: { f1: { id: 'f1', fileName: 'x.txt', size: 1, fileType: 'text/plain' } } });
    await wait(() => C.ev.incoming.length === before + 1);
    const c = await call(C.inst._port(), 'cancel'); assert.strictEqual(c.status, 200);
    const r = await Promise.race([waiting, new Promise((_, rej) => setTimeout(() => rej(new Error('prepare-upload still hangs')), 4000))]);
    assert.strictEqual(r.status, 403);
    await wait(() => C.ev.closed.includes(C.ev.incoming[before].id));
    assert.strictEqual(C.inst.respond(C.ev.incoming[before].id, true), false);
    ok('/cancel without sessionId answers the waiting request and closes the prompt');
    assert.strictEqual((await call(C.inst._port(), 'cancel')).status, 200); ok('/cancel with nothing pending is harmless');
  }

  A.inst.stop(); B.inst.stop(); C.inst.stop();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
  console.log(out.join('\n'));
})().catch((e) => { console.error(out.join('\n')); console.error(e); process.exit(1); });
