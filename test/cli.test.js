const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { spawn } = require('child_process');
const P = ROOT + '/';
const notify = require(P + 'notify.js');
const notices = [];
const server = notify.start({ onNotice: (n) => notices.push(n), onActivity() {} });
const ok = (m) => console.log('PASS ' + m);
const cli = (...a) => new Promise((res) => { const c = spawn(process.execPath, [P + 'dyisland.js', ...a], { env: process.env }); let stdout = '', stderr = ''; c.stdout.on('data', (d) => stdout += d); c.stderr.on('data', (d) => stderr += d); c.on('close', (status) => res({ status, stdout, stderr })); });
setTimeout(async () => {
  let r = await cli('notify', 'Deploy finished', '--message', 'to production', '--tone', 'success', '--duration', '7');
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual({ ...notices[0] }, { kind: 'done', tone: 'success', title: 'Deploy finished', sub: 'to production', duration: 7 }); ok('notify: title, message, tone, duration arrive');
  r = await cli('notify', 'Tests failed', '--tone', 'error'); assert.strictEqual(r.status, 0);
  assert.strictEqual(notices[1].kind, 'attention'); assert.strictEqual(notices[1].tone, 'error'); ok('error tone shows as attention');
  r = await cli('notify', 'x', '--tone', 'loud'); assert.strictEqual(r.status, 2); ok('bad tone is rejected, nothing sent'); assert.strictEqual(notices.length, 2);
  r = await cli('notify'); assert.strictEqual(r.status, 2); ok('no title: usage, exit 2');
  r = await cli('notify', 'big', '--duration', '999'); assert.strictEqual(notices[2].duration, 30); ok('duration is capped at 30 s');
  r = await cli('run', '--', process.execPath, '-e', 'process.exit(0)'); assert.strictEqual(r.status, 0);
  assert.strictEqual(notices[3].tone, 'success'); assert.ok(/^Done: /.test(notices[3].title)); ok('run: success toast, exit 0');
  r = await cli('run', '--', process.execPath, '-e', 'process.exit(3)'); assert.strictEqual(r.status, 3);
  assert.strictEqual(notices[4].tone, 'error'); assert.ok(/exit code 3/.test(notices[4].sub)); ok('run: failing command keeps ITS exit code (3) and shows an error toast');
  r = await cli('run', '--', 'definitely-not-a-command-xyz'); assert.notStrictEqual(r.status, 0); ok('run: a missing command fails with a non-zero code');
  r = await cli('run', '--', process.execPath, '-e', 'console.log("hello world")'); assert.ok(r.stdout.includes('hello world')); ok('run: the command output still reaches the terminal');
  server.stop();
  setTimeout(async () => { r = await cli('notify', 'nobody home'); assert.strictEqual(r.status, 1); assert.ok(/not running|Could not reach/.test(r.stderr)); ok('island not running: clear message, exit 1');
    r = await cli('run', '--', process.execPath, '-e', 'process.exit(5)'); assert.strictEqual(r.status, 5); ok('island not running: run still returns the command exit code (5)');
    console.log('all CLI checks passed'); process.exit(0); }, 300);
}, 500);
