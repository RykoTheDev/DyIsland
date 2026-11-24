const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { forecast, didReset, WINDOWS } = require(ROOT + '/pace.js');
const H = 3600e3, now = Date.UTC(2026, 10, 24, 12, 0, 0);
const at = (ms) => new Date(ms).toISOString();
// 5h window, 2.5h in (reset in 2.5h), 80% used -> rate 32%/h -> 20% left runs out in 37.5 min
let f = forecast({ pct: 80, resetsAt: at(now + 2.5 * H) }, WINDOWS.five, now);
assert.ok(f.willRunOut); assert.ok(Math.abs(f.runOutAt - (now + 0.625 * H)) < 1000); console.log('PASS runs out before reset');
// 20% used at the half way point: fine
f = forecast({ pct: 20, resetsAt: at(now + 2.5 * H) }, WINDOWS.five, now); assert.strictEqual(f.willRunOut, false); console.log('PASS comfortable pace');
// too early (10 minutes into 5 hours) -> no forecast, even at 50% used
assert.strictEqual(forecast({ pct: 50, resetsAt: at(now + 4.8 * H) }, WINDOWS.five, now), null); console.log('PASS too early');
// nothing used / bad input
assert.strictEqual(forecast({ pct: 1, resetsAt: at(now + 2 * H) }, WINDOWS.five, now), null);
assert.strictEqual(forecast(null, WINDOWS.five, now), null);
assert.strictEqual(forecast({ pct: 50, resetsAt: 'nope' }, WINDOWS.five, now), null);
assert.strictEqual(forecast({ pct: 50, resetsAt: at(now - H) }, WINDOWS.five, now), null);
assert.strictEqual(forecast({ pct: 50, resetsAt: at(now + 9 * H) }, WINDOWS.five, now), null);   // reset further away than the window: data is odd
console.log('PASS bad input');
// already at 100
f = forecast({ pct: 100, resetsAt: at(now + 2 * H) }, WINDOWS.five, now); assert.ok(f.willRunOut && f.runOutAt === now); console.log('PASS already full');
// weekly: 3.5 days in, 60% used -> runs out in 2.33 days, before the 3.5 days left
f = forecast({ pct: 60, resetsAt: at(now + 3.5 * 24 * H) }, WINDOWS.week, now); assert.ok(f.willRunOut); console.log('PASS weekly');
assert.ok(didReset(90, 3)); assert.ok(!didReset(90, 80)); assert.ok(!didReset(30, 0)); assert.ok(!didReset(null, 0)); console.log('PASS reset detection');
