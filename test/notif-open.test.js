// A click on a mirrored Windows notification: the app id is checked, the renderer only sends back a notice id,
// and Snipping Tool opens the fresh screenshot (an old one never).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const N = require('../main/notif-open');

// app ids
assert.ok(N.aumidOk('Microsoft.ScreenSketch_8wekyb3d8bbwe!App'));
assert.ok(N.aumidOk('com.squirrel.Discord.Discord'));
assert.ok(N.aumidOk('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'));
for (const bad of ['', 'ab', '"calc"', 'x" & calc', '/select,C:\\x', '-x', 'a/../b', 'a..b', ' lead', 'trail ', 'a\nb', 'x'.repeat(201), null, 42]) assert.ok(!N.aumidOk(bad), String(bad));
assert.ok(N.isSnippingTool('Microsoft.ScreenSketch_8wekyb3d8bbwe!App'));
assert.ok(!N.isSnippingTool('com.squirrel.Discord.Discord'));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const old = path.join(dir, 'old.png'), fresh = path.join(dir, 'fresh.png');
  fs.writeFileSync(old, 'x'); fs.writeFileSync(fresh, 'y'); fs.writeFileSync(path.join(dir, 'notes.txt'), 'z');
  const t = Date.now();
  fs.utimesSync(old, new Date(t - 3600e3), new Date(t - 3600e3));
  fs.utimesSync(fresh, new Date(t - 2000), new Date(t - 2000));
  assert.strictEqual(N.newestShot(dir, t), fresh);
  assert.strictEqual(N.newestShot(dir, t + 3600e3), null, 'a screenshot from long before the toast is not this one');
  { // two quick captures: each toast opens its own, not simply the newest
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-')), A = path.join(d2, 'A.png'), B = path.join(d2, 'B.png');
    fs.writeFileSync(A, 'a'); fs.writeFileSync(B, 'b');
    fs.utimesSync(A, new Date(t - 20000), new Date(t - 20000)); fs.utimesSync(B, new Date(t), new Date(t));
    assert.strictEqual(N.newestShot(d2, t - 19000), A);
    assert.strictEqual(N.newestShot(d2, t + 500), B);
    assert.strictEqual(N.newestShot(d2, t + 60000), null, 'a capture a minute before a "copied to clipboard" toast is not it');
  }
  assert.strictEqual(N.newestShot(path.join(dir, 'missing'), t), null);

  const calls = [];
  const shell = { openExternal: async (u) => { calls.push(['ext', u]); }, openPath: async (p) => { calls.push(['path', p]); return ''; } };
  const execFile = (f, args) => calls.push(['exec', f, args]);
  let now = t;
  const m = N.create({ shell, execFile, screenshotsDir: () => dir, now: () => now, max: 3 });

  assert.strictEqual(m.remember('"bad"'), '', 'an unusable id gives no click action');
  assert.strictEqual(m.remember('Windows.SystemToast.SecurityAndMaintenance'), '', "Windows' own senders are not apps: no click action");
  assert.ok(N.isSystemSender('Windows.ActionCenter.UrgentNotification') && !N.isSystemSender('Microsoft.WindowsStore_8wekyb3d8bbwe!App'));
  const d = m.remember('com.squirrel.Discord.Discord');
  assert.ok(/^n\d+$/.test(d));
  assert.strictEqual(await m.open('n999'), false, 'an unknown id does nothing');
  assert.strictEqual(await m.open(d), true);
  assert.deepStrictEqual(calls.pop(), ['exec', 'explorer.exe', ['shell:AppsFolder\\com.squirrel.Discord.Discord']]);

  const s = m.remember('Microsoft.ScreenSketch_8wekyb3d8bbwe!App');
  await m.open(s);
  const c = calls.pop();
  assert.strictEqual(c[0], 'ext'); assert.ok(c[1].startsWith('ms-screensketch:edit?') && c[1].includes(encodeURIComponent(fresh)));

  // no Snipping Tool protocol: the default viewer
  shell.openExternal = async () => { throw new Error('no handler'); };
  await m.open(s);
  assert.deepStrictEqual(calls.pop(), ['path', fresh]);
  // and when the viewer fails too: the app
  shell.openPath = async (p) => { calls.push(['path', p]); return 'no viewer'; };
  await m.open(s);
  assert.deepStrictEqual(calls.pop(), ['exec', 'explorer.exe', ['shell:AppsFolder\\Microsoft.ScreenSketch_8wekyb3d8bbwe!App']]);

  // a toast long after the last screenshot (saving is off): Snipping Tool itself opens
  now = t + 3600e3; const s2 = m.remember('Microsoft.ScreenSketch_8wekyb3d8bbwe!App');
  await m.open(s2);
  assert.deepStrictEqual(calls.pop(), ['exec', 'explorer.exe', ['shell:AppsFolder\\Microsoft.ScreenSketch_8wekyb3d8bbwe!App']]);

  // only the last few are kept
  m.remember('a.b.c'); m.remember('a.b.d');
  assert.ok(m._map.size <= 3 && !m._map.has(d));
  console.log('notif-open ok');
})().catch((e) => { console.error(e); process.exit(1); });
