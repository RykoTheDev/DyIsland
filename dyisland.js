#!/usr/bin/env node
// dyisland: put a message on the island from any terminal, script or CI job.
//
//   dyisland notify "Deploy finished" [--message "to production"] [--tone success|warning|error|info] [--duration 8]
//   dyisland run -- npm run build          runs the command, then tells the island how it went
//
// The island listens on this PC only (127.0.0.1) and the request carries a token that lives in ~/.dyisland/notify.json,
// so web pages cannot send to it. If the island is not running, "notify" says so and exits 1; "run" still runs your command
// and exits with ITS exit code, so putting `dyisland run --` in front of a command never changes whether it passes.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TONES = ['success', 'warning', 'error', 'info'];

function post(body) {
  return new Promise((resolve) => {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dyisland', 'notify.json'), 'utf8')); } catch { return resolve('The island is not running (no ~/.dyisland/notify.json)'); }
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: Number(cfg.port), path: '/notify', method: 'POST', timeout: 2000,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-island-token': String(cfg.token) } },
      (res) => { res.resume(); res.on('end', () => resolve(res.statusCode === 204 ? null : 'The island refused the message (' + res.statusCode + ')')); });
    req.on('error', () => resolve('Could not reach the island (is DyIsland running?)'));
    req.on('timeout', () => { req.destroy(); resolve('The island did not answer'); });
    req.end(data);
  });
}

function parseFlags(args) {
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else out[a.slice(2)] = args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[++i] : true;
    } else out._.push(a);
  }
  return out;
}

const fmtTime = (ms) => { const s = Math.round(ms / 1000); return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };

// A real program (.exe) is started directly, with its arguments exactly as typed (no shell to mangle quotes, %VARS% or newlines).
// Only .cmd / .bat files (npm, npx, ...) need cmd.exe; those go through it as one quoted string.
function resolveWin(cmd) {
  const exts = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const hasExt = /\.[A-Za-z0-9]{1,4}$/.test(cmd);
  const dirs = /[\\/]/.test(cmd) ? [''] : (process.env.PATH || '').split(';').filter(Boolean);
  for (const d of dirs) for (const e of hasExt ? [''] : exts) { const f = d ? path.join(d, cmd + e) : cmd + e; try { if (fs.statSync(f).isFile()) return f; } catch { /* next */ } }
  return null;
}
function launch(argv) {
  if (process.platform !== 'win32') return spawn(argv[0], argv.slice(1), { stdio: 'inherit' });
  const found = resolveWin(argv[0]);
  if (found && !/\.(cmd|bat)$/i.test(found)) return spawn(found, argv.slice(1), { stdio: 'inherit' });
  const q = (a) => (/^[A-Za-z0-9_@+=:,./\\-]+$/.test(a) ? a : '"' + a.replace(/"/g, '""').replace(/%/g, '%%') + '"');
  return spawn(argv.map(q).join(' '), { stdio: 'inherit', shell: true });
}

function usage() {
  console.log('Usage:\n  dyisland notify "Title" [--message "text"] [--tone success|warning|error|info] [--duration seconds]\n  dyisland run -- <command> [args...]');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'notify') {
    const f = parseFlags(rest);
    const title = f._.join(' ').trim();
    if (!title) { usage(); return 2; }
    if (f.tone !== undefined && !TONES.includes(f.tone)) { console.error('--tone must be one of: ' + TONES.join(', ')); return 2; }
    const err = await post({ title, message: typeof f.message === 'string' ? f.message : '', tone: f.tone || 'success', duration: f.duration !== undefined ? Number(f.duration) : undefined });
    if (err) { console.error('dyisland: ' + err); return 1; }
    return 0;
  }
  if (cmd === 'run') {
    const i = rest.indexOf('--');
    const argv = i >= 0 ? rest.slice(i + 1) : rest;
    if (!argv.length) { usage(); return 2; }
    const started = Date.now();
    const code = await new Promise((resolve) => {
      const child = launch(argv);
      child.on('error', (e) => { console.error('dyisland: could not start ' + argv[0] + ': ' + e.message); resolve(127); });
      child.on('close', (c, sig) => resolve(c == null ? (sig ? 1 : 0) : c));
    });
    const name = argv.slice(0, 3).join(' ').slice(0, 30);
    const err = await post({ title: code === 0 ? 'Done: ' + name : 'Failed: ' + name, message: (code === 0 ? 'took ' : 'exit code ' + code + ', ') + fmtTime(Date.now() - started), tone: code === 0 ? 'success' : 'error', duration: code === 0 ? 5 : 10 });
    if (err) console.error('dyisland: ' + err);
    return code;                                                   // always the command's own exit code
  }
  usage();
  return cmd ? 2 : 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
