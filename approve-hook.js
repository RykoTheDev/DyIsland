#!/usr/bin/env node
// Claude Code PermissionRequest hook: asks the island whether to allow a tool call.
//
// What happens:
//  - The island shows "Claude Code needs approval" with Allow / Deny. Your answer is printed as the hook decision.
//  - If you choose "Ask in terminal", the island is not running, it is hidden behind a full-screen app, approvals are
//    switched off, or you do not answer in time: this prints NOTHING and exits 0, so Claude Code shows its normal prompt.
//  - It never allows anything by itself: no answer is never "allow".
//
// Add to ~/.claude/settings.json (Settings > Claude Code in the island can copy this for you):
//   "hooks": { "PermissionRequest": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<path>\\approve-hook.js\"" }] }] }
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const bail = () => process.exit(0);                              // no decision: Claude Code asks as usual
process.on('uncaughtException', bail);
setTimeout(bail, 125000);                                        // the island itself gives up long before this

const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', run);
process.stdin.on('error', bail);

function run() {
  try {
    let cfg, p;
    try { cfg = Object(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dyisland', 'notify.json'), 'utf8'))); } catch { return bail(); }
    try { p = Object(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { return bail(); }
    const port = Number(cfg.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^[0-9a-f]{16,128}$/i.test(String(cfg.token))) return bail();
    // Only a few short fields are sent: a big Write/Edit payload would exceed the island's size limit and skip approval
    const input = p.tool_input && typeof p.tool_input === 'object' ? p.tool_input : {};
    const small = {}; let cut = false;                       // cut = something was left out: the island must say so (and not offer Allow)
    const keys = Object.keys(input);
    if (keys.length > 8) cut = true;
    for (const k of keys.slice(0, 8)) {
      const v = input[k];
      if (typeof v === 'string') { if (v.length > 4000) cut = true; small[k] = v.slice(0, 4000); }
      else if (v === null || typeof v !== 'object') small[k] = v;
      else { const j = String(JSON.stringify(v)); if (j.length > 1000) cut = true; small[k] = j.slice(0, 1000); }
    }
    const nonce = crypto.randomBytes(16).toString('hex');   // the island proves it holds the token by answering with an HMAC of this
    const body = JSON.stringify({ session_id: p.session_id, cwd: p.cwd, tool_name: p.tool_name, tool_input: small, cut, pid: process.pid });
    const req = http.request(
      { host: '127.0.0.1', port, path: '/approve', method: 'POST', timeout: 125000,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-island-token': String(cfg.token), 'x-island-nonce': nonce } },
      (res) => {
        // Whoever answers must prove it is the island (it alone knows the token): a stale notify.json pointing at some other
        // program on that port must never produce an "allow".
        const want = crypto.createHmac('sha256', String(cfg.token)).update(nonce).digest('hex');
        const got = String(res.headers['x-island-proof'] || '');
        const same = got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
        if (!same) { res.resume(); return bail(); }
        const out = [];
        res.on('data', (c) => out.push(c));
        res.on('end', () => {
          if (res.statusCode !== 200) return bail();
          let r; try { r = JSON.parse(Buffer.concat(out).toString('utf8')); } catch { return bail(); }
          if (r.behavior === 'allow') decide({ behavior: 'allow' });
          else if (r.behavior === 'deny') decide({ behavior: 'deny', message: 'Denied from the DyIsland island' });
          else bail();
        });
      }
    );
    req.on('error', bail); req.on('timeout', () => { req.destroy(); bail(); });
    req.end(body);
  } catch { bail(); }
}

function decide(decision) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } }), () => process.exit(0));
}
