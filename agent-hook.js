#!/usr/bin/env node
// Hook adapter for coding agents other than Claude Code (Gemini CLI, Qwen Code, Codex CLI, OpenCode, ...). Each tool reports what it is doing in its own words;
// this turns that into the same small event the island already understands (working / finished / needs you) and forwards it. Always exits 0 and prints nothing,
// so it can never get in the agent's way (also when the island is not running).
//   node agent-hook.js --agent gemini        the agent's hook JSON arrives on stdin (Gemini CLI, Qwen Code, Claude-style hooks)
//   node agent-hook.js --agent codex '<json>'  Codex CLI passes its notification as one JSON argument
// Settings > Apps > Coding agents has a "Copy setup" button per agent that gives you the lines to add to that agent's own config.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EVENTS = {                                           // how each agent names things -> the island's (Claude Code style) event names
  UserPromptSubmit: 'UserPromptSubmit', BeforeAgent: 'UserPromptSubmit', 'agent-turn-start': 'UserPromptSubmit', 'session.busy': 'UserPromptSubmit', 'session.status.busy': 'UserPromptSubmit',
  Stop: 'Stop', AfterAgent: 'Stop', 'agent-turn-complete': 'Stop', 'session.idle': 'Stop', 'turn.complete': 'Stop',
  Notification: 'Notification', 'permission.asked': 'Notification', 'approval-requested': 'Notification', 'permission.updated': 'Notification',
  SessionEnd: 'SessionEnd', 'session.deleted': 'SessionEnd',
  BeforeTool: 'PostToolUse', AfterTool: 'PostToolUse', PreToolUse: 'PostToolUse', PostToolUse: 'PostToolUse', 'tool.execute.after': 'PostToolUse',
};
const str = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : undefined);

// payload: whatever the agent sent (object); returns the body for the island, or null when it is nothing we know
function normalize(payload, agent) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const props = p.properties && typeof p.properties === 'object' ? p.properties : {};
  const raw = p.hook_event_name || p.event || p.type || p.event_type;
  const ev = EVENTS[String(raw || '')];
  if (!ev) return null;
  const label = String(agent || p.agent || '').toLowerCase().replace(/[^a-z0-9 ._-]/g, '').slice(0, 20);
  return {
    hook_event_name: ev, agent: label || undefined,
    session_id: str(p.session_id || p['thread-id'] || p.thread_id || p.sessionID || props.sessionID || props.sessionId, 128),
    cwd: str(p.cwd || props.cwd, 500),
    message: str(p.message || p['last-assistant-message'] || props.message, 500),
  };
}

function main() {
  const bail = () => process.exit(0);
  process.on('uncaughtException', bail);
  setTimeout(bail, 2800);
  const args = process.argv.slice(2);
  const ai = args.indexOf('--agent'), agent = ai >= 0 ? args[ai + 1] : '';
  const argJson = args.filter((a, i) => a.trim().startsWith('{') && i !== ai + 1).pop();           // Codex: the JSON is an argument
  const chunks = [];
  const go = () => {
    let cfg, payload = {};
    try { cfg = Object(JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dyisland', 'notify.json'), 'utf8'))); } catch { return bail(); }
    try { payload = JSON.parse(argJson || Buffer.concat(chunks).toString('utf8') || '{}'); } catch { payload = {}; }
    const body0 = normalize(payload, agent);
    const port = Number(cfg.port);
    if (!body0 || !Number.isInteger(port) || port < 1 || port > 65535 || !/^[0-9a-f]{16,128}$/i.test(String(cfg.token))) return bail();
    const body = JSON.stringify({ ...body0, pid: process.pid });
    const req = http.request({ host: '127.0.0.1', port, path: '/notify', method: 'POST', timeout: 2300, headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-island-token': String(cfg.token) } }, (res) => { res.resume(); res.on('end', bail); });
    req.on('error', bail); req.on('timeout', () => { req.destroy(); bail(); });
    req.end(body);
  };
  if (argJson) return go();
  process.stdin.on('data', (c) => chunks.push(c)); process.stdin.on('end', go); process.stdin.on('error', bail);
}

if (require.main === module) main();
module.exports = { normalize, EVENTS };
