const assert = require('assert');
const T = require('../timers.js');
const t0 = 1_000_000_000_000;

// ---- typed durations
const d = T.parseDuration;
assert.strictEqual(d('25'), 1500); assert.strictEqual(d('7'), 420); assert.strictEqual(d('1.5'), 90);
assert.strictEqual(d('25:30'), 1530); assert.strictEqual(d('1:30:00'), 5400); assert.strictEqual(d('0:45'), 45);
assert.strictEqual(d('90s'), 90); assert.strictEqual(d('45m'), 2700); assert.strictEqual(d('1h'), 3600); assert.strictEqual(d('1h30m'), 5400); assert.strictEqual(d('1.5h'), 5400); assert.strictEqual(d(' 10 min '), 600);
for (const bad of ['', 'abc', '0', '-5', '25:99', '25h', '99999', '1:2:3:4']) assert.strictEqual(d(bad), null, 'rejects ' + JSON.stringify(bad));

// ---- timer: counts down, pauses, resumes, ends
let s = T.create(60);
T.start(s, t0); assert(s.running && s.endAt === t0 + 60000);
assert.strictEqual(T.tick(s, t0 + 10000), null); assert(Math.abs(s.left - 50) < 1e-6);
T.pause(s, t0 + 20000); assert(!s.running && Math.abs(s.left - 40) < 1e-6);
T.start(s, t0 + 100000); assert.strictEqual(s.endAt, t0 + 140000, 'resume continues from what was left');
assert.strictEqual(T.tick(s, t0 + 140000), 'done'); assert(!s.running && s.left === 0);
T.start(s, t0 + 150000); assert.strictEqual(s.left, 60, 'starting a finished timer starts it over');
assert(Math.abs(T.fraction(s, t0 + 150000 + 15000) - 0.75) < 1e-9, 'the ring is what is left');

// ---- repeat: starts over by itself, every time
s = T.setMode(T.create(30), 'repeat'); T.start(s, t0);
assert.strictEqual(T.tick(s, t0 + 30000), 'done'); assert(s.running && s.endAt === t0 + 60000);
assert.strictEqual(T.tick(s, t0 + 95000), 'done', 'several cycles missed (the PC slept): one event, still running'); assert(s.running && s.endAt === t0 + 120000);

// asleep for hours: still exactly one event, and the next end is in the future
s = T.setMode(T.create(60), 'repeat'); T.start(s, t0);
assert.strictEqual(T.tick(s, t0 + 8 * 3600e3), 'done'); assert(s.endAt > t0 + 8 * 3600e3 && s.endAt <= t0 + 8 * 3600e3 + 60000); assert.strictEqual(T.tick(s, t0 + 8 * 3600e3 + 1000), null, 'no burst on the next tick');

// ---- pomodoro: 4 x (25 focus + 5 break), the last break is 15, then it stops
s = T.setMode(T.create(300), 'pomodoro'); assert.strictEqual(s.left, 1500);
T.start(s, t0); let now = t0; const seen = [];
for (let i = 0; i < 20; i++) {
  now = s.endAt; const ev = T.tick(s, now); if (!ev) break; seen.push(ev + ':' + s.phase + ':' + s.round); if (ev === 'done') break;
}
assert.deepStrictEqual(seen, ['phase:short:1', 'phase:focus:2', 'phase:short:2', 'phase:focus:3', 'phase:short:3', 'phase:focus:4', 'phase:long:4', 'done:focus:1'], seen.join(' '));
assert(!s.running, 'the cycle ends by stopping');
// chained from the previous end time: a late tick still lands on the right phase
s = T.setMode(T.create(300), 'pomodoro'); T.start(s, t0); T.tick(s, t0 + 1500000 + 100); assert.strictEqual(s.phase, 'short'); assert.strictEqual(s.endAt, t0 + 1500000 + 300000);

// ---- stopwatch
s = T.setMode(T.create(300), 'stopwatch'); assert.strictEqual(T.seconds(s, t0), 0);
T.start(s, t0); assert.strictEqual(T.tick(s, t0 + 5000), null); assert.strictEqual(Math.round(T.seconds(s, t0 + 65000)), 65);
T.pause(s, t0 + 70000); assert.strictEqual(Math.round(T.seconds(s, t0 + 999999)), 70, 'paused: stays put');
T.start(s, t0 + 100000); assert.strictEqual(Math.round(T.seconds(s, t0 + 110000)), 80, 'resumed: keeps adding');
T.reset(s); assert.strictEqual(T.seconds(s, t0 + 110000), 0);

// ---- state from storage / another window is checked, and an overdue timer settles quietly
let n = T.normalize({ mode: 'timer', total: 'x', left: -5, running: true, endAt: t0 - 1000 }, t0, 300);
assert(!n.running && n.left === 0, 'a timer that already ran out is finished, not alarming');
n = T.normalize({ mode: 'bogus', total: 999999999, running: false }, t0, 300); assert.strictEqual(n.mode, 'timer'); assert(n.total <= 86400);
n = T.normalize(null, t0, 600); assert.strictEqual(n.total, 600);
n = T.normalize({ mode: 'timer', total: 600, left: 100, running: true, endAt: t0 + 30000 }, t0, 300); assert(n.running && Math.abs(n.left - 30) < 1e-6);
assert.strictEqual(T.clock(65), '01:05'); assert.strictEqual(T.clock(3725), '1:02:05');
console.log('PASS timers: durations, timer, repeat, pomodoro, stopwatch, normalize');
