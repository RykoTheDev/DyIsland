// LocalSend (protocol v2): find nearby devices, send files and folders to them, and receive files from them.
//   discovery: UDP multicast 224.0.0.167:53317, devices expire when they stop answering
//   sending:   HTTPS (self-signed) prepare-upload + upload, folders are walked into files with relative paths
//   receiving: HTTPS server on 53317, asks you on the island (or auto-accepts if you chose that)
// Behaviour follows the official app (docs/localsend-notes.md): our one certificate is both server and client certificate,
// the fingerprint is the uppercase SHA-256 of its DER bytes, and the receiver checks the client certificate against the claimed fingerprint.
const dgram = require('dgram');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const selfcert = require('./selfcert');

const GROUP = '224.0.0.167', DEFAULT_PORT = 53317, API = '/api/localsend/v2';
const EXPIRE_MS = 75000, ANNOUNCE_MS = 20000, ASK_MS = 60000, MAX_FILES = 5000, MAX_JSON = 2 * 1024 * 1024, HASH_FILE_MAX = 64 * 1024 * 1024, HASH_TOTAL_MAX = 256 * 1024 * 1024;

const MIME = { '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.zip': 'application/zip', '.json': 'application/json', '.html': 'text/html' };
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
const cleanText = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);

// A name from the other device -> a safe relative path (never absolute, never leaving the folder). '' if nothing usable is left.
function safeRel(name) {
  const bad = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
  const parts = String(name == null ? '' : name).normalize('NFC').split(/[\\/]+/)
    .map((p) => p.replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/[. ]+$/, '').slice(0, 120))
    .filter((p) => p && p !== '.' && p !== '..').map((p) => (bad.test(p) ? '_' + p : p));
  return parts.length && parts.length <= 20 ? parts.join(path.sep) : '';
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p), base = p.slice(0, p.length - ext.length);
  for (let i = 1; i < 1000; i++) { const c = base + ' (' + i + ')' + ext; if (!fs.existsSync(c)) return c; }
  return base + '-' + Date.now() + ext;
}

// Paths (files or folders) -> [{ id, fileName, size, fileType, abs }]. A folder becomes its files, named "<folder>/<sub>/<file>".
function collect(paths) {
  const out = [];
  const add = (abs, rel) => {
    if (out.length >= MAX_FILES) throw new Error('Too many files (the limit is ' + MAX_FILES + ')');
    const st = fs.statSync(abs);
    out.push({ id: crypto.randomUUID(), fileName: rel, size: st.size, fileType: mimeOf(abs), abs });
  };
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name), r = rel + '/' + e.name;
      if (e.isDirectory()) walk(abs, r); else if (e.isFile()) add(abs, r);
    }
  };
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== 'string' || !path.isAbsolute(p)) continue;
    let st; try { st = fs.lstatSync(p); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(p, path.basename(p)); else if (st.isFile()) add(p, path.basename(p));
  }
  return out;
}

function create({ store, dataDir, defaultSaveDir, onDevices = () => {}, onProgress = () => {}, onIncoming = () => {}, onReceived = () => {}, logEvent = () => {}, port = DEFAULT_PORT, multicast = true }) {
  const cfg = () => store.get().localsend;
  const id = selfcert.load(path.join(dataDir(), 'localsend-cert.json'));
  const fingerprint = id.fingerprint.toUpperCase();
  const alias = () => cfg().alias || os.hostname().slice(0, 40) || 'DyIsland';
  const saveDir = () => cfg().saveDir || defaultSaveDir();
  const info = () => ({ alias: alias(), version: '2.0', deviceModel: 'Windows', deviceType: 'desktop', fingerprint, port: boundPort, protocol: 'https', download: false });

  let sock = null, server = null, boundPort = port, announceTimer = null, sweepTimer = null, enabled = false, receiving = false, lastError = '';
  const devices = new Map();                     // fingerprint -> { id, alias, deviceModel, deviceType, ip, port, seen }
  const out = new Map();                         // sessionId -> { cancelled, req, dev, remote }
  const pending = new Map();                     // incoming id -> { resolve, timer }
  let session = null;                            // the one receiving session

  // ---- device list
  const view = () => [...devices.values()].map((d) => ({ id: d.id, alias: d.alias, deviceModel: d.deviceModel, deviceType: d.deviceType, ip: d.ip, port: d.port }));
  let lastView = '[]';
  const pushDevices = () => { const v = view(), s = JSON.stringify(v); if (s !== lastView) { lastView = s; onDevices(v); } };
  function addDevice(msg, ip) {
    if (!msg || typeof msg !== 'object') return null;
    const fp = String(msg.fingerprint || '').toUpperCase();
    const p = Number(msg.port);
    if (!/^[0-9A-F]{16,128}$/.test(fp) || fp === fingerprint || !Number.isInteger(p) || p < 1 || p > 65535 || !ip) return null;
    const d = { id: fp, alias: cleanText(msg.alias, 40) || ip, deviceModel: cleanText(msg.deviceModel, 40), deviceType: ['mobile', 'desktop', 'web', 'headless', 'server'].includes(msg.deviceType) ? msg.deviceType : 'desktop', ip, port: p, protocol: msg.protocol === 'http' ? 'http' : 'https', seen: Date.now() };
    devices.set(fp, d); pushDevices();
    return d;
  }

  // ---- HTTPS client
  function request(dev, method, pathAndQuery, { body, headers = {}, stream, track } = {}) {
    return new Promise((resolve, reject) => {
      const mod = dev.protocol === 'http' ? require('http') : https;
      const opts = { host: dev.ip, port: dev.port, method, path: pathAndQuery, headers, agent: false, key: id.key, cert: id.cert, rejectUnauthorized: false,
        // the device was found with a fingerprint: the certificate it shows now must be that one (the hostname is not checked, peers have none)
        checkServerIdentity: (_h, cert) => (cert && cert.raw && crypto.createHash('sha256').update(cert.raw).digest('hex').toUpperCase() === dev.id ? undefined : new Error('Certificate does not match the device')) };
      const req = mod.request(opts, (res) => {
        const chunks = []; let n = 0;
        res.on('data', (c) => { n += c.length; if (n < MAX_JSON) chunks.push(c); });
        res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* no body */ } resolve({ status: res.statusCode, json }); });
        res.on('error', reject);
      });
      if (track) track(req);
      req.on('error', reject);
      if (stream) stream.on('error', (e) => req.destroy(e)).pipe(req);
      else req.end(body);
    });
  }
  const postJson = (dev, p, obj, track) => { const b = Buffer.from(JSON.stringify(obj)); return request(dev, 'POST', p, { body: b, headers: { 'content-type': 'application/json', 'content-length': b.length }, track }); };
  // SHA-256 of a file, streamed (never loaded whole). Only files up to HASH_FILE_MAX are hashed, and at most HASH_TOTAL_MAX bytes per send, so a
  // send of big files does not sit reading the disk before it starts; the rest go with sha256 null (the receiver then skips the check).
  const sha256File = (abs) => new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); fs.createReadStream(abs).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex'))); });

  // ---- sending
  function emit(sessionId, deviceId, sentBytes, totalBytes, state, error) { onProgress({ sessionId, deviceId, sentBytes, totalBytes, state, ...(error ? { error } : {}) }); }
  async function send(deviceId, paths) {
    const dev = devices.get(String(deviceId));
    if (!enabled) return { ok: false, error: 'LocalSend is off' };
    if (!dev) return { ok: false, error: 'That device is no longer visible' };
    let files;
    try { files = collect(paths); } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    if (!files.length) return { ok: false, error: 'Nothing to send' };
    const sessionId = crypto.randomUUID(), total = files.reduce((a, f) => a + f.size, 0), st = { cancelled: false, req: null, dev, remote: null };
    out.set(sessionId, st);
    emit(sessionId, dev.id, 0, total, 'waiting');
    st.done = transfer(sessionId, st, dev, files, total).catch((e) => { if (!st.cancelled) { logEvent('localsend send failed: ' + cleanText(e && e.message, 80)); emit(sessionId, dev.id, st.sent || 0, total, 'error', cleanText(e && e.message, 120) || 'Failed'); } }).finally(() => out.delete(sessionId));
    return { ok: true, sessionId };
  }
  async function transfer(sessionId, st, dev, files, total) {
    let budget = HASH_TOTAL_MAX;
    for (const f of files) {
      f.sha256 = null;
      if (st.cancelled) return;
      if (f.size <= HASH_FILE_MAX && f.size <= budget) { try { f.sha256 = await sha256File(f.abs); budget -= f.size; } catch { f.sha256 = null; } }
    }
    if (st.cancelled) return;
    const fileMap = {}; for (const f of files) fileMap[f.id] = { id: f.id, fileName: f.fileName, size: f.size, fileType: f.fileType, sha256: f.sha256, preview: null };
    const r = await postJson(dev, API + '/prepare-upload', { info: info(), files: fileMap }, (rq) => { st.req = rq; });
    if (st.cancelled) return;
    if (r.status === 403) return emit(sessionId, dev.id, 0, total, 'declined');
    if (r.status === 204) return emit(sessionId, dev.id, 0, total, 'done');
    if (r.status === 409) throw new Error('The other device is busy with another transfer');
    if (r.status === 401) throw new Error('The other device asks for a PIN (not supported)');
    if (r.status !== 200 || !r.json || typeof r.json.sessionId !== 'string' || !r.json.files || typeof r.json.files !== 'object') throw new Error('Unexpected answer from the other device (' + r.status + ')');
    st.remote = r.json.sessionId;
    const wanted = files.filter((f) => typeof r.json.files[f.id] === 'string');
    const want = wanted.reduce((a, f) => a + f.size, 0);
    let sent = 0, lastEmit = 0; st.sent = 0;
    emit(sessionId, dev.id, 0, want, 'sending');
    for (const f of wanted) {
      if (st.cancelled) return;
      const rs = fs.createReadStream(f.abs);
      rs.on('data', (c) => { sent += c.length; st.sent = sent; const now = Date.now(); if (now - lastEmit > 100) { lastEmit = now; emit(sessionId, dev.id, sent, want, 'sending'); } });
      const q = '?sessionId=' + encodeURIComponent(st.remote) + '&fileId=' + encodeURIComponent(f.id) + '&token=' + encodeURIComponent(r.json.files[f.id]);
      const u = await request(dev, 'POST', API + '/upload' + q, { stream: rs, headers: { 'content-type': 'application/octet-stream', 'content-length': f.size }, track: (rq) => { st.req = rq; } });
      if (st.cancelled) return;
      if (u.status !== 200) throw new Error('Upload of ' + cleanText(path.basename(f.fileName), 40) + ' failed (' + u.status + ')');
    }
    emit(sessionId, dev.id, want, want, 'done');
  }
  function cancel(sessionId) {
    const st = out.get(String(sessionId));
    if (!st || st.cancelled) return;
    st.cancelled = true;
    try { if (st.req) st.req.destroy(); } catch { /* gone */ }
    // with a session id when the receiver already accepted; without one while it is still deciding (the receiver closes its prompt)
    request(st.dev, 'POST', API + '/cancel' + (st.remote ? '?sessionId=' + encodeURIComponent(st.remote) : '')).catch(() => {});
    emit(String(sessionId), st.dev.id, st.sent || 0, 0, 'error', 'Cancelled');
  }

  // ---- receiving
  const json = (res, code, obj) => { const b = obj == null ? '' : JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) }); res.end(b); };
  const clientFp = (req) => { try { const c = req.socket.getPeerCertificate(); return c && c.raw ? crypto.createHash('sha256').update(c.raw).digest('hex').toUpperCase() : ''; } catch { return ''; } };
  const peerIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  function readBody(req, res, cb) {
    const chunks = []; let n = 0, dead = false;
    req.on('data', (c) => { n += c.length; if (n > MAX_JSON) { dead = true; json(res, 413, null); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (dead) return; try { cb(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { json(res, 400, { message: 'Invalid body' }); } });
  }
  const sessionIdle = () => !session || (session.finished) || Date.now() - session.activity > 120000;

  function prepareUpload(req, res) {
    readBody(req, res, (body) => {
      const ci = body && body.info, fl = body && body.files;
      if (!ci || typeof ci !== 'object' || !fl || typeof fl !== 'object') return json(res, 400, { message: 'Invalid body' });
      const ids = Object.keys(fl);
      if (!ids.length) return json(res, 400, { message: 'No files provided' });
      if (ids.length > MAX_FILES) return json(res, 400, { message: 'Too many files' });
      const cfp = clientFp(req);
      if (cfp && String(ci.fingerprint || '').toUpperCase() !== cfp) return json(res, 403, { message: 'Fingerprint does not match the client certificate' });
      if (!sessionIdle() || pending.size) return json(res, 409, { message: 'Blocked by another session' });
      const files = [];
      for (const k of ids) {
        const f = fl[k], rel = f && safeRel(f.fileName), size = Number(f && f.size);
        if (!f || !rel || !Number.isFinite(size) || size < 0) return json(res, 400, { message: 'Invalid file entry' });
        files.push({ key: k, rel, size, sha256: /^[0-9a-fA-F]{64}$/.test(String(f.sha256 || '')) ? String(f.sha256).toLowerCase() : '', token: crypto.randomBytes(16).toString('hex'), done: false });
      }
      const sender = cleanText(ci.alias, 40) || peerIp(req), incomingId = crypto.randomUUID();
      let gone = false;
      res.on('close', () => { if (!res.writableFinished && !gone) { gone = true; const p = pending.get(incomingId); if (p) { clearTimeout(p.timer); pending.delete(incomingId); onIncoming({ id: incomingId, closed: true }); } } });
      const decide = (accept) => {
        if (gone) return;
        if (!accept) return json(res, 403, { message: 'Rejected' });
        const dir = saveDir();
        try { fs.mkdirSync(dir, { recursive: true }); } catch { return json(res, 500, { message: 'Cannot create the save folder' }); }
        session = { id: crypto.randomUUID(), incomingId, alias: sender, ip: peerIp(req), dir, files: new Map(files.map((f) => [f.key, f])), received: 0, total: files.reduce((a, f) => a + f.size, 0), activity: Date.now(), finished: false };
        onReceived({ id: incomingId, alias: sender, dir, files: files.length, state: 'receiving', receivedBytes: 0, totalBytes: session.total });
        json(res, 200, { sessionId: session.id, files: Object.fromEntries(files.map((f) => [f.key, f.token])) });
      };
      if (cfg().autoAccept) return decide(true);
      const timer = setTimeout(() => { if (pending.delete(incomingId)) { onIncoming({ id: incomingId, closed: true }); decide(false); } }, ASK_MS);
      pending.set(incomingId, { timer, decide, ip: peerIp(req) });
      onIncoming({ id: incomingId, alias: sender, files: files.map((f) => ({ name: f.rel.split(path.sep).join('/'), size: f.size })) });
    });
  }
  function upload(req, res, q) {
    const s = session, f = s && !s.finished && q.get('sessionId') === s.id && s.files.get(q.get('fileId'));
    if (!q.get('sessionId') || !q.get('fileId') || !q.get('token')) { req.resume(); return json(res, 400, { message: 'Missing parameters' }); }
    if (!f || f.token !== q.get('token') || f.done || peerIp(req) !== s.ip || f.active) { req.resume(); return json(res, 403, { message: 'Invalid token or IP address' }); }
    const dest = uniquePath(path.join(s.dir, f.rel)), root = path.resolve(s.dir);
    if (!path.resolve(dest).startsWith(root + path.sep)) { req.resume(); return json(res, 403, { message: 'Invalid path' }); }
    try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch { req.resume(); return json(res, 500, { message: 'Cannot create folder' }); }
    f.active = true;
    const tmp = dest + '.part', ws = fs.createWriteStream(tmp);
    let got = 0, last = 0;
    const hash = f.sha256 ? crypto.createHash('sha256') : null;
    const fail = (code) => { f.active = false; if (code === 422) { s.received -= got; s.finished = true; onReceived({ id: s.incomingId, alias: s.alias, dir: s.dir, files: s.files.size, state: 'error', receivedBytes: s.received, totalBytes: s.total }); } try { ws.destroy(); fs.rmSync(tmp, { force: true }); } catch { /* gone */ } if (!res.headersSent) json(res, code, { message: 'Failed' }); };
    req.on('data', (c) => { if (hash) hash.update(c); got += c.length; s.received += c.length; s.activity = Date.now(); const now = Date.now(); if (now - last > 150) { last = now; onReceived({ id: s.incomingId, alias: s.alias, dir: s.dir, files: s.files.size, state: 'receiving', receivedBytes: s.received, totalBytes: s.total }); } });
    req.on('aborted', () => fail(400));
    req.on('error', () => fail(400));
    ws.on('error', () => fail(500));
    ws.on('finish', () => {
      if (hash && hash.digest('hex') !== f.sha256) return fail(422);                  // what arrived is not what the sender announced: keep nothing
      try { fs.renameSync(tmp, dest); } catch { return fail(500); }
      f.done = true; f.active = false;
      const all = [...s.files.values()].every((x) => x.done);
      if (all) s.finished = true;
      onReceived({ id: s.incomingId, alias: s.alias, dir: s.dir, files: s.files.size, state: all ? 'done' : 'receiving', receivedBytes: s.received, totalBytes: s.total });
      if (all) logEvent('localsend received ' + s.files.size + ' file(s)');
      json(res, 200, null);
    });
    req.pipe(ws);
  }
  function handle(req, res) {
    const u = new URL(req.url, 'https://x'), p = u.pathname;
    if (req.method === 'GET' && p === API + '/info') return json(res, 200, info());
    if (req.method !== 'POST') return json(res, 404, { message: 'Not found' });
    if (p === API + '/register') return readBody(req, res, (b) => { const cfp = clientFp(req); if (b && (!cfp || String(b.fingerprint || '').toUpperCase() === cfp)) addDevice(b, peerIp(req)); json(res, 200, info()); });
    if (p === API + '/prepare-upload') return prepareUpload(req, res);
    if (p === API + '/upload') return upload(req, res, u.searchParams);
    if (p === API + '/cancel') {
      const s = session;
      if (s && !s.finished && (u.searchParams.get('sessionId') === s.id) && peerIp(req) === s.ip) { s.finished = true; onReceived({ id: s.incomingId, alias: s.alias, dir: s.dir, files: s.files.size, state: 'error', receivedBytes: s.received, totalBytes: s.total }); }
      // no sessionId = the sender gives up while we are still asking: answer its waiting prepare-upload and close the prompt (only for requests from that same address)
      if (!u.searchParams.get('sessionId')) for (const [k, v] of [...pending]) if (v.ip === peerIp(req)) { clearTimeout(v.timer); pending.delete(k); onIncoming({ id: k, closed: true }); v.decide(false); }
      req.resume(); return json(res, 200, null);
    }
    req.resume(); json(res, 404, { message: 'Not found' });
  }
  function respond(incomingId, accept) {
    const p = pending.get(String(incomingId));
    if (!p) return false;
    clearTimeout(p.timer); pending.delete(String(incomingId)); p.decide(!!accept);
    return true;
  }

  // ---- discovery (UDP multicast)
  function interfaces() { const l = []; for (const a of Object.values(os.networkInterfaces())) for (const i of a || []) if (i.family === 'IPv4' && !i.internal) l.push(i.address); return l; }
  function onMessage(buf, rinfo) {
    let m; try { m = JSON.parse(buf.toString('utf8')); } catch { return; }
    if (!m || typeof m !== 'object') return;
    const d = addDevice(m, rinfo.address);
    if (d && m.announce === true) {                                                     // they just came online: tell them we are here
      postJson(d, API + '/register', info()).catch(() => { announce(false, d.ip); });
    }
  }
  function announce(isAnnounce = true, unicastTo) {
    if (!sock) return;
    const msg = Buffer.from(JSON.stringify({ ...info(), announce: isAnnounce }));
    if (unicastTo) { try { sock.send(msg, DEFAULT_PORT, unicastTo); } catch { /* ignore */ } return; }
    for (const ip of interfaces()) { try { sock.setMulticastInterface(ip); sock.send(msg, DEFAULT_PORT, GROUP); } catch { /* that adapter cannot multicast */ } }
  }
  function startDiscovery() {
    if (sock || !multicast) return;
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock = s;
    s.on('error', (e) => { lastError = 'Discovery: ' + cleanText(e && e.message, 80); logEvent('localsend ' + lastError); });
    s.on('message', onMessage);
    s.bind(DEFAULT_PORT, () => {
      if (sock !== s) return;
      try { s.setMulticastTTL(1); s.setMulticastLoopback(true); } catch { /* ignore */ }
      for (const ip of interfaces()) { try { s.addMembership(GROUP, ip); } catch { /* not on this adapter */ } }
      announce(true);
    });
    announceTimer = setInterval(() => announce(true), ANNOUNCE_MS);
  }
  function stopDiscovery() {
    clearInterval(announceTimer); announceTimer = null;
    const s = sock; sock = null;
    if (s) { try { s.close(); } catch { /* closed */ } }
    devices.clear(); pushDevices();
  }
  function sweep() { const now = Date.now(); let ch = false; for (const [k, d] of devices) if (now - d.seen > EXPIRE_MS) { devices.delete(k); ch = true; } if (ch) pushDevices(); }

  function startServer() {
    if (server) return Promise.resolve();
    return new Promise((resolve) => {
      const s = https.createServer({ key: id.key, cert: id.cert, requestCert: true, rejectUnauthorized: false }, handle);
      server = s;
      s.on('tlsClientError', (e) => { if (process.env.LS_DEBUG) console.error('TLS', e.message); });
      s.on('error', (e) => { lastError = 'Receiving: ' + cleanText(e && e.code || e && e.message, 60); logEvent('localsend ' + lastError); if (server === s) { server = null; receiving = false; } resolve(); });
      s.listen(port, () => { boundPort = s.address().port; receiving = true; announce(true); resolve(); });
    });
  }
  function stopServer() { const s = server; server = null; receiving = false; for (const [k, v] of pending) { clearTimeout(v.timer); v.decide(false); pending.delete(k); } if (s) { try { s.close(); s.closeAllConnections(); } catch { /* closed */ } } }

  async function sync() {
    const c = cfg();
    if (c.enabled && !enabled) { enabled = true; lastError = ''; sweepTimer = setInterval(sweep, 5000); startDiscovery(); }
    else if (!c.enabled && enabled) { enabled = false; clearInterval(sweepTimer); stopServer(); stopDiscovery(); for (const k of [...out.keys()]) cancel(k); }
    if (enabled && c.receive && !server) await startServer();
    else if ((!enabled || !c.receive) && server) stopServer();
  }
  const status = () => ({ enabled, receiving, port: boundPort, alias: alias(), saveDir: saveDir(), ...(lastError ? { error: lastError } : {}) });

  return {
    sync, send, cancel, respond, status, fingerprint,
    devices: view, stop: () => { enabled = false; clearInterval(sweepTimer); stopServer(); stopDiscovery(); },
    _onMessage: onMessage, _addDevice: addDevice, _sweep: sweep, _port: () => boundPort,
  };
}

module.exports = { create, safeRel, collect, uniquePath, DEFAULT_PORT };
