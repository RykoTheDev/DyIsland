// Simulated tests for the working indicator. Run with USERPROFILE pointed at a scratch folder.
const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PROJECT = ROOT + '';
const { createSessions } = require(PROJECT + '/sessions.js');
const notify = require(PROJECT + '/notify.js');
const results = [];
const ok = (name) => results.push('PASS ' + name);

// ---------- unit: sessions with a fake clock ----------
{
  let t = 0;
  const s = createSessions({ now: () => t });
  assert.deepStrictEqual(s.state(), { working: false, since: 0, count: 0, list: [] });

  s.start('A'); t = 1000;
  assert.strictEqual(s.state().working, true);
  s.end('A');
  assert.strictEqual(s.state().working, false); ok('single session: on after prompt, off after Stop');
}
{
  let t = 0;
  const s = createSessions({ now: () => t });
  s.start('A'); t = 1000; s.start('B'); t = 2000;
  let st = s.state();
  assert.strictEqual(st.count, 2); assert.strictEqual(st.since, 1000);            // most recent active session's start
  s.end('A');
  st = s.state();
  assert.strictEqual(st.working, true); assert.strictEqual(st.count, 1);          // stays on after one stops
  s.end('B');
  assert.strictEqual(s.state().working, false); ok('two sessions: stays on after one stops, off only when both ended');
}
{
  let t = 0;
  const s = createSessions({ now: () => t });
  s.start('A'); t = 5000; s.start('B'); s.end('B');
  assert.strictEqual(s.state().since, 0); ok('elapsed falls back to the older session when the newest ends');
}
{
  let t = 0;
  const s = createSessions({ now: () => t });
  s.start('A'); t = 5 * 60000; s.start('B');
  t = 10 * 60000 - 1; assert.strictEqual(s.state().count, 2);
  t = 10 * 60000;     let st = s.state();                                          // A has been silent for exactly 10 min
  assert.strictEqual(st.count, 1); assert.strictEqual(st.since, 5 * 60000);
  t = 15 * 60000 - 1; assert.strictEqual(s.state().working, true);
  t = 15 * 60000;     assert.strictEqual(s.state().working, false); ok('timeout is per session: A clears at 10 min, B at 15 min');
}
{
  let t = 0;
  const s = createSessions({ now: () => t });
  s.start('A');                                                                    // Esc pressed: Stop never arrives
  t = 10 * 60000 - 1; assert.strictEqual(s.state().working, true);
  t = 10 * 60000;     assert.strictEqual(s.state().working, false); ok('Esc interruption: indicator clears after 10 min with no events');
}
{
  let t = 0;
  const s = createSessions({ now: () => t });
  s.start('A'); t = 500000; s.touch('A'); s.touch('ghost');
  t = 1000000; assert.strictEqual(s.state().working, true);                        // 500s after the touch
  t = 1100000; assert.strictEqual(s.state().working, false);
  s.start('A'); t += 1000; s.start('A');
  assert.strictEqual(s.state().count, 1); ok('touch refreshes the timeout; unknown ids ignored; same-session prompt does not duplicate');
}
{
  let t = 0;
  const s = createSessions({ now: () => t });
  s.start('A'); t = 4000; s.start('A');
  assert.strictEqual(s.state().since, 4000); ok('a new prompt in the same session restarts its elapsed time');
}

// ---------- integration: real hook.js -> real notify.js server -> sessions ----------
let clock = 0;
const sessions = createSessions({ now: () => clock });
const notices = [], activity = [];
const server = notify.start({
  onActivity: (a) => { activity.push(a.type + ':' + a.id); if (a.type === 'start') sessions.start(a.id, a); else if (a.type === 'touch') sessions.touch(a.id, a); else if (a.type === 'wait') sessions.wait(a.id, a); else if (a.type === 'gone') sessions.end(a.id, { gone: true }); else sessions.end(a.id); },
  onNotice: (n) => notices.push(n.title + ' | ' + n.sub),
});

setTimeout(() => {
  const hook = (payload) => spawnSync('node', [PROJECT + '/hook.js'], { input: JSON.stringify(payload), encoding: 'utf8' });
  const run = (name, payload) => { const r = hook(payload); assert.strictEqual(r.status, 0, name + ' exit'); assert.strictEqual(r.stdout + r.stderr, '', name + ' silent'); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    run('prompt s1', { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: 'C:/proj/one' });
    clock = 1000;
    run('prompt s2', { hook_event_name: 'UserPromptSubmit', session_id: 's2', cwd: 'C:/proj/two' });
    await wait(300);
    { const st = sessions.state(); assert.deepStrictEqual({ working: st.working, since: st.since, count: st.count }, { working: true, since: 1000, count: 2 }); }
    assert.deepStrictEqual(notices, []); ok('UserPromptSubmit x2 via hook: indicator on, no toast');

    run('stop s1', { hook_event_name: 'Stop', session_id: 's1', cwd: 'C:/proj/one' });
    await wait(300);
    assert.strictEqual(sessions.state().working, true); assert.strictEqual(sessions.state().count, 1);
    assert.deepStrictEqual(notices, ['Claude finished | one']); ok('Stop s1: toast shown, indicator still on for s2');

    run('notification s2', { hook_event_name: 'Notification', session_id: 's2', cwd: 'C:/proj/two', message: 'needs permission' });
    await wait(300);
    assert.strictEqual(notices[1], 'Claude needs you | needs permission'); assert.strictEqual(sessions.state().working, true);
    ok('Notification: attention toast unchanged, session stays active');

    run('stop s2', { hook_event_name: 'Stop', session_id: 's2', cwd: 'C:/proj/two' });
    await wait(300);
    assert.strictEqual(sessions.state().working, false);
    assert.strictEqual(notices[2], 'Claude finished | two'); ok('Stop s2: indicator off, toast shown');

    run('prompt s3', { hook_event_name: 'UserPromptSubmit', session_id: 's3' });
    run('end s3', { hook_event_name: 'SessionEnd', session_id: 's3' });
    await wait(300);
    assert.strictEqual(sessions.state().working, false); assert.strictEqual(notices.length, 3);
    ok('SessionEnd: clears the session, no toast');

    // long task: a heartbeat on tool calls keeps a session alive past 10 minutes; an unknown session is not created by one
    run('prompt long', { hook_event_name: 'UserPromptSubmit', session_id: 'long' });
    await wait(200);
    clock += 9 * 60000; run('tool', { hook_event_name: 'PostToolUse', session_id: 'long' }); await wait(200);
    clock += 9 * 60000; assert.strictEqual(sessions.state().working, true);      // 18 min after the prompt, 9 after the heartbeat
    clock += 2 * 60000; assert.strictEqual(sessions.state().working, false);     // 11 min of silence: gone
    run('tool ghost', { hook_event_name: 'PostToolUse', session_id: 'ghost' }); await wait(200);
    assert.strictEqual(sessions.state().working, false); ok('PostToolUse heartbeat keeps a long task on, never starts a session');

    run('prompt s4', { hook_event_name: 'UserPromptSubmit', session_id: 's4' });   // interrupted with Esc: no Stop
    await wait(300);
    assert.strictEqual(sessions.state().working, true);
    clock += 10 * 60000;
    assert.strictEqual(sessions.state().working, false); ok('simulated timeout through the real pipeline: indicator clears after 10 min');

    // custom toasts are posted straight to the server (hook.js only forwards Claude Code hook fields, as before)
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dyisland', 'notify.json'), 'utf8'));
    const status = await new Promise((resolve) => {
      const http = require('http');
      const q = http.request({ host: '127.0.0.1', port: cfg.port, path: '/notify', method: 'POST',
        headers: { 'content-type': 'application/json', 'x-island-token': cfg.token } }, (res) => { res.resume(); resolve(res.statusCode); });
      q.end(JSON.stringify({ title: 'Build done', message: 'all green' }));
    });
    await wait(200);
    assert.strictEqual(status, 204); assert.strictEqual(notices[3], 'Build done | all green'); ok('custom toast (direct POST) unchanged');

    run('no session id', { hook_event_name: 'UserPromptSubmit' });
    await wait(300);
    assert.deepStrictEqual(activity.slice(-1), ['start:default']); ok('missing session_id falls back to one shared key');

    console.log(results.join('\n'));
    console.log('activity log:', activity.join(', '));
    server.stop();
    setTimeout(() => process.exit(0), 200);
  })().catch((e) => { console.log(results.join('\n')); console.log('FAIL', e.message); server.stop(); setTimeout(() => process.exit(1), 200); });
}, 400);
