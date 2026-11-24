// Run with a scratch USERPROFILE so ~/.dyisland/notify.json is not the real one.
const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { spawn } = require('child_process');
const P = ROOT + '/';
const notify = require(P + 'notify.js');
const { createApprovals } = require(P + 'approvals.js');

let changes = 0;
const approvals = createApprovals({ waitMs: 600, onChange: () => changes++ });
let server;
const hook = (payload) => new Promise((resolve) => {
  const c = spawn(process.execPath, [P + 'approve-hook.js'], { env: process.env });
  let out = ''; c.stdout.on('data', (d) => out += d);
  c.on('close', (code) => resolve({ code, out }));
  c.stdin.end(JSON.stringify(payload));
  hook.last = c;
});
const ok = (m) => console.log('PASS ' + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // unit: describe() shortens and summarises
  const d = notify.describe({ session_id: 's1', cwd: 'C:\\Users\\me\\proj', tool_name: 'Bash', tool_input: { command: 'x'.repeat(1000), description: 'do it' } });
  assert.strictEqual(d.project, 'proj'); assert.ok(d.detail.length <= 240); assert.strictEqual(d.extra, 'do it'); ok('describe: Bash command shortened, project from cwd');
  const e = notify.describe({ session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'C:\\a\\b\\c\\d\\file.tsx' } });
  assert.strictEqual(e.detail, '.../c/d/file.tsx'); ok('describe: file path shown as the last three parts');
  assert.ok(notify.describe({ tool_name: 'Weird', tool_input: { a: 1 } }).detail.includes('"a"')); assert.strictEqual(notify.describe({}).tool, 'Tool'); ok('describe: unknown tool and empty payload');

  server = notify.start({
    onApprove: (info, respond) => approvals.add(info, respond),
    onApproveCancel: (id) => approvals.cancel(id),
    onNotice() {}, onActivity() {},
  });
  await sleep(500);

  // allow
  let p = hook({ session_id: 's1', cwd: 'C:\\p\\site', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  await sleep(300); assert.strictEqual(approvals.count(), 1); const it = approvals.list()[0]; assert.strictEqual(it.tool, 'Bash'); assert.strictEqual(it.detail, 'npm test');
  approvals.answer(it.id, 'allow'); let r = await p;
  assert.strictEqual(r.code, 0); assert.deepStrictEqual(JSON.parse(r.out), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }); ok('Allow prints the allow decision');
  // deny
  p = hook({ session_id: 's1', tool_name: 'Edit', tool_input: { file_path: 'a.txt' } }); await sleep(300);
  approvals.answer(approvals.list()[0].id, 'deny'); r = await p;
  const dj = JSON.parse(r.out).hookSpecificOutput.decision; assert.strictEqual(dj.behavior, 'deny'); assert.ok(dj.message); ok('Deny prints the deny decision with a message');
  // ask in terminal -> silent
  p = hook({ session_id: 's1', tool_name: 'Bash', tool_input: { command: 'ls' } }); await sleep(300);
  approvals.answer(approvals.list()[0].id, 'ask'); r = await p; assert.strictEqual(r.out, ''); assert.strictEqual(r.code, 0); ok('"Ask in terminal" prints nothing, exit 0');
  // no answer: gives up on its own (600 ms) -> silent, never allow
  p = hook({ session_id: 's2', tool_name: 'Bash', tool_input: { command: 'rm -rf x' } }); r = await p;
  assert.strictEqual(r.out, ''); assert.strictEqual(r.code, 0); assert.strictEqual(approvals.count(), 0); ok('no answer in time: nothing printed, request removed');
  // hook killed while waiting -> request removed
  p = hook({ session_id: 's3', tool_name: 'Bash', tool_input: { command: 'sleep' } }); await sleep(250); assert.strictEqual(approvals.count(), 1);
  hook.last.kill(); await p; await sleep(250); assert.strictEqual(approvals.count(), 0); ok('hook process gone: request removed, no stale card');
  // garbage / bad answers
  assert.strictEqual(approvals.answer(999, 'allow'), false); ok('answering an unknown id is a no-op');
  // limit: only 8 open at once
  const a2 = createApprovals({ max: 2, waitMs: 5000 }); const noop = () => {};
  assert.ok(a2.add({ session: 'x' }, noop)); assert.ok(a2.add({ session: 'x' }, noop)); assert.strictEqual(a2.add({ session: 'x' }, noop), null); a2.askAll(); assert.strictEqual(a2.count(), 0); ok('queue is capped; askAll empties it');
  // wrong token / wrong path are refused (the server needs the token header)
  const http = require('http'); const cfg = JSON.parse(require('fs').readFileSync(require('path').join(process.env.USERPROFILE, '.dyisland', 'notify.json'), 'utf8'));
  const status = await new Promise((res) => { const q = http.request({ host: '127.0.0.1', port: cfg.port, path: '/approve', method: 'POST', headers: { 'x-island-token': 'bad' } }, (x) => { x.resume(); res(x.statusCode); }); q.end('{}'); });
  assert.strictEqual(status, 401); ok('wrong token is refused');
  // island not running: hook exits silently and fast
  server.stop(); await sleep(200);
  const t0 = Date.now(); r = await hook({ session_id: 's4', tool_name: 'Bash', tool_input: {} }); assert.strictEqual(r.out, ''); assert.ok(Date.now() - t0 < 2000); ok('island not running: silent and immediate');
  console.log('all approval checks passed'); process.exit(0);
})().catch((e) => { console.error(e); try { server && server.stop(); } catch {} process.exit(1); });
