// USERPROFILE/HOME must point at a private dir. Real hook.js against the real notify server with an anchor handler.
const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { spawn } = require('child_process');
const notify = require(ROOT + '/notify.js');
const ok = (m) => console.log('PASS ' + m);
const run = (payload) => new Promise((resolve) => { const t0 = Date.now(); const c = spawn(process.execPath, [ROOT + '/hook.js']); let out = ''; c.stdout.on('data', (d) => out += d); c.on('close', (code) => resolve({ code, out, ms: Date.now() - t0 })); c.stdin.end(JSON.stringify(payload)); });
const seen = []; let mode = 'fast';
const server = notify.start({
  onActivity: (a) => seen.push(a),
  onNotice() {},
  anchor: (a) => (mode === 'none' ? null : mode === 'fast' ? new Promise((r) => setTimeout(r, 300)) : new Promise(() => {})),   // 'hang': never resolves
});
setTimeout(async () => {
  let r = await run({ hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: 'C:/p/site' });
  assert.strictEqual(r.code, 0); assert.strictEqual(r.out, ''); assert.ok(r.ms >= 280 && r.ms < 2000, 'took ' + r.ms);
  assert.ok(Number.isInteger(seen[0].pid) && seen[0].pid > 4); ok('first event: the hook waits ~0.3 s while the window is found, and reports its own pid (' + r.ms + ' ms)');
  mode = 'none'; r = await run({ hook_event_name: 'PostToolUse', session_id: 's1', cwd: 'C:/p/site' }); assert.ok(r.ms < 1200, 'took ' + r.ms); ok('later events are not delayed (' + r.ms + ' ms)');
  mode = 'hang'; r = await run({ hook_event_name: 'UserPromptSubmit', session_id: 's2', cwd: 'C:/p/other' });
  assert.strictEqual(r.code, 0); assert.ok(r.ms >= 1700 && r.ms < 2900, 'took ' + r.ms); ok('a window search that never finishes cannot wedge Claude Code: the hook is released after ~1.8 s (' + r.ms + ' ms)');
  server.stop(); process.exit(0);
}, 500);
