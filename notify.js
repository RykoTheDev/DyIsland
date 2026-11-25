// Local notification endpoint: lets Claude Code (via hook.js) show a toast on the island.
// Security: binds to 127.0.0.1 only, requires a random per-launch token (sent as a header, so web pages cannot
// call it: custom headers trigger a CORS preflight we never answer), checks the Host header, and caps the body size.
// The port and token are written to ~/.dyisland/notify.json so hook.js can find them.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFERRED_PORT = 47391;
const FILE = path.join(os.homedir(), '.dyisland', 'notify.json');
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);
// Control and direction-override characters can disguise what a command says: they are dropped, and line breaks are shown as a visible mark
const plain = (v) => String(v == null ? '' : v).replace(/\r?\n/g, ' \u21b5 ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g, '');
const clipE = (s, n) => { const t = clip(s, n + 1); return t.length > n ? t.slice(0, n - 1) + '…' : t; };   // shows a … when something was cut

// the agent that sent it (agent-hook.js adds a short plain name); Claude Code's own hook sends none
const whoOf = (p) => { const a = String(p.agent || '').toLowerCase().replace(/[^a-z0-9 ._-]/g, '').slice(0, 20); return a ? a[0].toUpperCase() + a.slice(1) : 'Claude'; };
const pidOf = (p) => (Number.isInteger(p.pid) && p.pid > 4 && p.pid < 4194304 ? p.pid : 0);
const idOf = (p) => (typeof p.session_id === 'string' && p.session_id ? p.session_id.slice(0, 128) : 'default');

// Turn a Claude Code hook payload (or a custom { title, message, kind }) into
//   notice:   a toast to show, and/or
//   activity: a change to which sessions are working ('start' | 'touch' | 'end')
function parse(p) {
  const project = p.cwd ? path.basename(String(p.cwd)) : '';
  const ev = p.hook_event_name;
  const out = {};
  if (ev === 'UserPromptSubmit') {
    out.activity = { type: 'start', id: idOf(p), project: clip(project, 60), pid: pidOf(p) };
  } else if (ev === 'Stop') {
    out.activity = { type: 'end', id: idOf(p), pid: pidOf(p) };
    out.notice = { kind: 'done', title: whoOf(p) + ' finished', sub: clip(project || 'Task complete', 80), session: idOf(p) };
  } else if (ev === 'SessionEnd') {
    out.activity = { type: 'gone', id: idOf(p), pid: pidOf(p) };
  } else if (ev === 'PreToolUse' || ev === 'PostToolUse') {
    out.activity = { type: 'touch', id: idOf(p), project: clip(project, 60), pid: pidOf(p) };            // heartbeat only: keeps a long task from timing out
  } else if (ev === 'Notification') {
    out.activity = { type: 'wait', id: idOf(p), project: clip(project, 60), pid: pidOf(p) };
    out.notice = { kind: 'attention', title: whoOf(p) + ' needs you', sub: clip(p.message || project || 'Waiting for input', 120), session: idOf(p) };
  } else if (typeof p.title === 'string' && p.title) {
    const tone = ['success', 'warning', 'error', 'info'].includes(p.tone) ? p.tone : (p.kind === 'attention' ? 'warning' : 'success');
    const secs = Number(p.duration);
    out.notice = { kind: tone === 'warning' || tone === 'error' ? 'attention' : 'done', tone, title: clip(p.title, 40), sub: clip(typeof p.message === 'string' ? p.message : '', 120) };
    if (Number.isFinite(secs) && secs >= 1) out.notice.duration = Math.min(30, secs);
  }
  return out.notice || out.activity ? out : null;
}

// What the island shows for a permission request. Everything here is untrusted text from a tool call: it is shortened and
// only ever drawn with textContent.
function describe(p) {
  const cutByHook = p.cut === true;                       // approve-hook.js left something out (too long, or too many fields)
  const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
  const tool = clip(p.tool_name, 40) || 'Tool';
  const file = (v) => { const norm = path.posix.normalize(plain(v).split('\\').join('/')); const parts = norm.split('/').filter(Boolean); return clipE(parts.length > 3 ? '.../' + parts.slice(-3).join('/') : parts.join('/'), 200); };   // the END of the path is what matters: split first, clip after
  let detail = '', extra = '';
  if (tool === 'Bash' || tool === 'PowerShell') { detail = clipE(plain(input.command), 240); extra = clipE(plain(input.description), 100); }
  else if (/^(Edit|Write|MultiEdit|NotebookEdit|Read)$/.test(tool)) { detail = file(input.file_path || input.notebook_path); }
  else if (tool === 'WebFetch') { detail = clipE(plain(input.url), 200); }
  else if (tool === 'WebSearch') { detail = clipE(plain(input.query), 200); }
  else { try { detail = clipE(plain(JSON.stringify(input)), 200); } catch { detail = ''; } }
  if (cutByHook && !detail.endsWith('\u2026')) detail += ' \u2026';                 // something was left out: say so, so Allow is not offered
  return { session: idOf(p), pid: pidOf(p), project: p.cwd ? path.basename(String(p.cwd)).slice(0, 60) : '', tool, detail, extra };
}

// handlers: { onNotice(n), onActivity({ type, id }), onApprove(info, respond) -> id, onApproveCancel(id) }
function start(handlers) {
  const token = crypto.randomBytes(24).toString('hex');
  const tokenBuf = Buffer.from(token);
  let port = PREFERRED_PORT;

  // A permission request from approve-hook.js. The reply is held open until the island answers (or gives up).
  function approve(req, res, parts, done) {
    let p; try { p = Object(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')); } catch { return done(400); }
    let info; try { info = describe(p); } catch { return done(400); }              // a hostile body must not become an uncaught exception
    let id = null;
    const nonce = /^[0-9a-f]{16,64}$/i.test(String(req.headers['x-island-nonce'] || '')) ? String(req.headers['x-island-nonce']) : '';   // no nonce: no proof, so approve-hook.js will not trust the answer
    const respond = (behavior) => {
      if (res.writableEnded) return;
      res.statusCode = 200; res.setHeader('content-type', 'application/json');
      if (nonce) res.setHeader('x-island-proof', crypto.createHmac('sha256', token).update(nonce).digest('hex'));
      res.end(JSON.stringify({ behavior: behavior === 'allow' || behavior === 'deny' ? behavior : 'ask' }));
    };
    res.on('close', () => { if (!res.writableEnded && id != null && handlers.onApproveCancel) handlers.onApproveCancel(id); });   // the hook went away
    id = handlers.onApprove ? handlers.onApprove(info, respond) : null;
    if (id == null) respond('ask');
  }

  const server = http.createServer((req, res) => {
    const done = (code) => { res.statusCode = code; res.end(); };
    const host = String(req.headers.host || '');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return done(403);   // blocks DNS rebinding
    if (req.method !== 'POST' || (req.url !== '/notify' && req.url !== '/approve')) return done(404);
    const sent = Buffer.from(String(req.headers['x-island-token'] || ''));
    if (sent.length !== tokenBuf.length || !crypto.timingSafeEqual(sent, tokenBuf)) return done(401);

    const parts = []; let size = 0;
    const cap = req.url === '/approve' ? 65536 : 8192;
    req.on('data', (c) => { size += c.length; if (size > cap) { done(413); req.destroy(); } else parts.push(c); });
    req.on('end', () => {
      if (res.writableEnded) return;
      if (req.url === '/approve') return approve(req, res, parts, done);
      try {
        const r = parse(Object(JSON.parse(Buffer.concat(parts).toString('utf8') || '{}')));
        if (r && r.activity && handlers.onActivity) handlers.onActivity(r.activity);   // state first, then the toast
        if (r && r.notice && handlers.onNotice) handlers.onNotice(r.notice);
        // The first event of a session: keep the hook alive a moment while the island finds the window the session runs in (the hook's
        // parent shell exits right after the hook, so this is the only time to walk up the process tree). Later events answer at once.
        const anchoring = r && r.activity && r.activity.pid && handlers.anchor ? handlers.anchor(r.activity) : null;
        if (anchoring) Promise.race([anchoring, new Promise((x) => setTimeout(x, 1800))]).then(() => done(204), () => done(204));
        else done(r ? 204 : 400);
      } catch { done(400); }
    });
  });

  const publish = () => {
    port = server.address().port;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ port, token }), { mode: 0o600 });
    } catch { /* hook.js will simply find nothing and stay silent */ }
  };
  // Any failure on the preferred port (in use, or reserved by Hyper-V/WSL which gives EACCES) falls back to a random port
  server.on('error', () => { if (port === PREFERRED_PORT) { port = 0; server.listen(0, '127.0.0.1', publish); } });
  server.listen(PREFERRED_PORT, '127.0.0.1', publish);

  return {
    stop() {
      try {
        server.close();
        // only remove the file if it still describes this instance
        if (JSON.parse(fs.readFileSync(FILE, 'utf8')).token === token) fs.rmSync(FILE, { force: true });
      } catch { /* already gone */ }
    },
  };
}

module.exports = { start, parse, describe };
