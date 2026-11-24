#!/usr/bin/env node
// Claude Code hook: tells the island something happened. Reads the hook JSON from stdin and forwards it to the island.
// Always exits 0 and prints nothing, so it can never interfere with Claude Code (also when the island is not running).
//
// Add to ~/.claude/settings.json:
//   "hooks": {
//     "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "node \"S:\\Projects\\SoftwareDev\\DyIsland\\hook.js\"" }] }],
//     "Stop":             [{ "hooks": [{ "type": "command", "command": "node \"S:\\Projects\\SoftwareDev\\DyIsland\\hook.js\"" }] }],
//     "Notification":     [{ "hooks": [{ "type": "command", "command": "node \"S:\\Projects\\SoftwareDev\\DyIsland\\hook.js\"" }] }],
//     "SessionEnd":       [{ "hooks": [{ "type": "command", "command": "node \"S:\\Projects\\SoftwareDev\\DyIsland\\hook.js\"" }] }]
//   }
//
// Optional, for tasks that run longer than 10 minutes: without any event the island drops a session after 10 minutes
// of silence (so an Esc-interrupted task cannot leave it on forever). A heartbeat on every tool call keeps long tasks on,
// at the cost of one tiny node start per tool call:
//     "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"S:\\Projects\\SoftwareDev\\DyIsland\\hook.js\"" }] }]
// (add it inside the same "hooks" object as the four above)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bail = () => process.exit(0);
process.on('uncaughtException', bail);                          // whatever goes wrong: exit 0, print nothing
setTimeout(bail, 2800);                                         // never hang Claude Code

// Hook payloads can be large (they may carry the last assistant message): keep it all, we only forward three small fields
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', send);
process.stdin.on('error', bail);

function send() {
  try {
    let cfg, payload;
    try { cfg = Object(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dyisland', 'notify.json'), 'utf8'))); } catch { return bail(); }
    try { payload = Object(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { payload = {}; }
    const port = Number(cfg.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[0-9a-f]{16,128}$/i.test(String(cfg.token))) return bail();
    const str = (v) => (typeof v === 'string' ? v.slice(0, 500) : undefined);
    const body = JSON.stringify({ hook_event_name: str(payload.hook_event_name), session_id: str(payload.session_id), cwd: str(payload.cwd), message: str(payload.message), pid: process.pid });   // the hook's own pid: alive while this request runs, so the island can walk up from it to the window this session runs in
    const req = http.request(
      { host: '127.0.0.1', port, path: '/notify', method: 'POST', timeout: 2300,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-island-token': String(cfg.token) } },
      (res) => { res.resume(); res.on('end', bail); }
    );
    req.on('error', bail); req.on('timeout', () => { req.destroy(); bail(); });
    req.end(body);
  } catch { bail(); }
}
