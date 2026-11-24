const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { createSessions } = require(ROOT + '/sessions.js');
let t = 0; const s = createSessions({ now: () => t });
s.start('aaaaaaaa1', { project: 'site' }); t = 1000; s.start('bbbbbbbb2', { project: 'api' });
assert.deepStrictEqual(s.list().map((x) => x.status + ':' + x.project), ['working:api', 'working:site']); console.log('PASS newest working first');
s.wait('aaaaaaaa1'); assert.strictEqual(s.list()[0].status, 'waiting'); console.log('PASS Notification: waiting floats to the top');
s.touch('aaaaaaaa1'); assert.strictEqual(s.list().find((x) => x.project === 'site').status, 'working'); console.log('PASS next tool call: back to working');
s.approval('aaaaaaaa1', true, {}); assert.strictEqual(s.list()[0].status, 'approval'); s.approval('aaaaaaaa1', false); assert.notStrictEqual(s.list()[0].status, 'approval'); console.log('PASS approval status on and off');
s.approval('ghost', true, { project: 'new' }); assert.ok(s.list().some((x) => x.project === 'new' && x.status === 'approval')); s.approval('ghost', false); console.log('PASS a request creates an unseen session');
s.end('bbbbbbbb2'); let l = s.list(); assert.strictEqual(l.find((x) => x.project === 'api').status, 'done'); assert.strictEqual(s.state().count, 2); console.log('PASS Stop: kept as done, not counted as working');
t += 16 * 60000; s.touch('aaaaaaaa1'); assert.ok(!s.list().some((x) => x.status === 'done')); console.log('PASS done entries expire after 15 min');
// quiet only with heartbeats
const q = createSessions({ now: () => t, quietMs: 300000 }); q.start('q1', { project: 'p' }); t += 400000; assert.strictEqual(q.list()[0].status, 'working'); console.log('PASS no heartbeat ever: never called quiet');
q.start('q2', { project: 'p2' }); q.touch('q2'); t += 301000; assert.strictEqual(q.list().find((x) => x.project === 'p2').status, 'quiet'); console.log('PASS heartbeat seen then silence: quiet');
q.end('q2', { gone: true }); assert.ok(!q.list().some((x) => x.project === 'p2')); console.log('PASS SessionEnd removes it entirely');
