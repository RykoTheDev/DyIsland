#!/usr/bin/env node
// Check that the running DyIsland draws things, without needing Claude Code:
//   npm run ping                 a fake "Claude is working" session for 8 seconds (the status circle should appear)
//   npm run ping -- work 20      the same for 20 seconds
//   npm run ping -- done         the "Claude finished" toast
//   npm run ping -- attention    the "Claude needs you" toast
// It talks to DyIsland exactly like hook.js does (same port file, same token), so if this works but Claude Code does
// not, the problem is Claude Code not running the hooks (start a new session after editing settings.json).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

let cfg;
try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dyisland', 'notify.json'), 'utf8')); }
catch { console.log('DyIsland is not running (no ~/.dyisland/notify.json). Start it with: npm start'); process.exit(1); }

const post = (payload) => new Promise((resolve) => {
  const body = JSON.stringify(payload);
  const r = http.request({ host: '127.0.0.1', port: cfg.port, path: '/notify', method: 'POST', timeout: 3000,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-island-token': cfg.token } },
    (res) => { res.resume(); resolve(res.statusCode); });
  r.on('error', (e) => resolve(e.code)); r.on('timeout', () => { r.destroy(); resolve('timeout'); });
  r.end(body);
});
const show = (what, code) => console.log(what.padEnd(18), '->', code, code === 204 ? '(accepted)' : '(NOT accepted: is DyIsland still running?)');

(async () => {
  const mode = process.argv[2] || 'work';
  const cwd = __dirname;
  if (mode === 'done') return show('Stop', await post({ hook_event_name: 'Stop', session_id: 'ping', cwd }));
  if (mode === 'attention') return show('Notification', await post({ hook_event_name: 'Notification', session_id: 'ping', cwd, message: 'Test from ping.js' }));
  const seconds = Math.max(1, Math.min(120, Number(process.argv[3]) || 8));
  show('UserPromptSubmit', await post({ hook_event_name: 'UserPromptSubmit', session_id: 'ping', cwd }));
  console.log(`Look at the island: a circle with a spinning arc should appear to its right for ${seconds}s...`);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  show('SessionEnd', await post({ hook_event_name: 'SessionEnd', session_id: 'ping' }));
})();
