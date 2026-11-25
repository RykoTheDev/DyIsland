// LocalSend protocol v2, seen from a plain HTTPS client (not our sender): the receiver's answers, status codes and state changes.
// Covers what test/localsend.test.js does not: register fingerprints, the server certificate matching the advertised fingerprint,
// upload token rules after acceptance, a repeated upload, and a sender cancel freeing the receiver.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const L = require('../main/localsend');
const selfcert = require('../main/selfcert');
const out = []; const ok = (n) => out.push('PASS ' + n);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyls-proto-'));
const API = '/api/localsend/v2';

(async () => {
  const st = { v: { localsend: { enabled: true, receive: true, alias: 'bob', saveDir: path.join(tmp, 'save'), autoAccept: false } } };
  const ev = { incoming: [], received: [] };
  const B = L.create({ store: { get: () => st.v }, dataDir: () => path.join(tmp, 'bob'), defaultSaveDir: () => path.join(tmp, 'dl'), port: 0, multicast: false,
    onIncoming: (i) => ev.incoming.push(i), onReceived: (r) => ev.received.push(r) });
  await B.sync();
  const port = B._port();
  assert.ok(port > 0);

  // A plain HTTPS client with its own certificate, the way a LocalSend sender presents itself.
  const me = selfcert.generate(); const myFp = me.fingerprint.toUpperCase();
  const info = { alias: 'mallory', version: '2.0', deviceType: 'mobile', fingerprint: myFp, port: 53317, protocol: 'https' };
  const call = (p, body, q = '', cert = me) => new Promise((resolve, reject) => {
    const b = Buffer.from(body === undefined ? '' : JSON.stringify(body));
    const r = https.request({ host: '127.0.0.1', port, method: 'POST', path: API + '/' + p + q, rejectUnauthorized: false, key: cert.key, cert: cert.cert, agent: false,
      headers: { 'content-type': 'application/json', 'content-length': b.length } }, (res) => {
      let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch { /* no body */ } resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject); r.end(b);
  });
  const wait = async (fn, ms = 5000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };

  // ---- the server's certificate is the one it advertises: the fingerprint is the SHA-256 of the DER bytes
  {
    const der = await new Promise((resolve, reject) => {
      const r = https.request({ host: '127.0.0.1', port, path: API + '/info', method: 'GET', rejectUnauthorized: false, agent: false }, (res) => {
        const cert = res.socket.getPeerCertificate(); let t = ''; res.on('data', (c) => { t += c; });
        res.on('end', () => resolve({ cert: cert.raw, body: JSON.parse(t) })); });
      r.on('error', reject); r.end();
    });
    assert.strictEqual(crypto.createHash('sha256').update(der.cert).digest('hex').toUpperCase(), der.body.fingerprint);
    assert.strictEqual(der.body.fingerprint, B.fingerprint);
    ok('the certificate the receiver shows hashes (SHA-256 of DER) to the fingerprint it advertises');
  }

  // ---- register: a device is listed only when its claimed fingerprint is the certificate it presented
  {
    const r1 = await call('register', { ...info, fingerprint: 'AA'.repeat(32) });
    assert.strictEqual(r1.status, 200); assert.strictEqual(r1.json.fingerprint, B.fingerprint);
    assert.ok(!B.devices().some((d) => d.id === 'AA'.repeat(32)), 'a register with a mismatching fingerprint must not be listed');
    const r2 = await call('register', info);
    assert.strictEqual(r2.status, 200);
    assert.ok(B.devices().some((d) => d.id === myFp && d.alias === 'mallory'), 'a register with the matching fingerprint must be listed');
    ok('register lists a device only when its fingerprint matches the certificate it presented');
  }

  // ---- upload rules after acceptance: token, unknown file, repeat, and cancel
  const n0 = ev.incoming.length;
  const prep = call('prepare-upload', { info, files: { f: { id: 'f', fileName: 'dir/one.txt', size: 3, fileType: 'text/plain' } } });
  await wait(() => ev.incoming.length === n0 + 1);
  B.respond(ev.incoming[n0].id, true);
  const acc = await prep;
  assert.strictEqual(acc.status, 200);
  assert.strictEqual(typeof acc.json.sessionId, 'string');
  const token = acc.json.files.f; assert.strictEqual(typeof token, 'string'); assert.ok(token.length >= 16);
  {
    const q = (fid, tok) => `?sessionId=${acc.json.sessionId}&fileId=${fid}&token=${tok}`;
    assert.strictEqual((await call('upload', undefined, q('f', 'nope'))).status, 403, 'wrong token');
    assert.strictEqual((await call('upload', undefined, q('g', token))).status, 403, 'a file that was not accepted');
    assert.strictEqual((await call('upload', undefined, q('f', token))).status, 200, 'the right token writes the file');
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'save', 'dir', 'one.txt'), 'utf8'), '');
    assert.strictEqual((await call('upload', undefined, q('f', token))).status, 403, 'the same file cannot be sent twice');
    ok('upload accepts only the token given for that file, and only once');
  }

  // ---- sender cancel: a cancel for another session is ignored, the right one frees the receiver for the next sender
  {
    const n1 = ev.incoming.length;
    // two files, so the session is still open when the sender cancels (a finished session emits no cancel)
    const p2 = call('prepare-upload', { info, files: { f: { id: 'f', fileName: 'two.txt', size: 1 }, g: { id: 'g', fileName: 'three.txt', size: 1 } } });
    await wait(() => ev.incoming.length === n1 + 1);
    B.respond(ev.incoming[n1].id, true);
    const a2 = await p2; assert.strictEqual(a2.status, 200);
    assert.strictEqual((await call('cancel', undefined, '?sessionId=not-the-session')).status, 200);
    assert.strictEqual((await call('upload', undefined, `?sessionId=${a2.json.sessionId}&fileId=f&token=${a2.json.files.f}`)).status, 200, 'a foreign cancel must not end the session');
    assert.strictEqual((await call('cancel', undefined, `?sessionId=${a2.json.sessionId}`)).status, 200);
    await wait(() => ev.received.some((r) => r.id === ev.incoming[n1].id && r.state === 'error'));
    // the slot is free again: a new sender is asked, not refused with 409
    const n2 = ev.incoming.length;
    const p3 = call('prepare-upload', { info, files: { f: { id: 'f', fileName: 'x', size: 1 } } });
    await wait(() => ev.incoming.length === n2 + 1);
    B.respond(ev.incoming[n2].id, false);
    assert.strictEqual((await p3).status, 403);
    ok('a sender cancel with the right session ends it, and a foreign cancel does not');
  }

  B.stop();
  console.log(out.join('\n')); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(0);
})().catch((e) => { console.error(out.join('\n')); console.error(e); process.exit(1); });
