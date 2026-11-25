const assert = require('assert');
const S = require('../spring.js');
// starts at 0, ends at 1, and a lively spring overshoots a little but not wildly
const open = S.easing(0.66, 24);
assert(open.css.startsWith('linear(0, '), 'starts at 0');
assert(open.css.endsWith(', 1)'), 'ends at 1');
assert(open.peak > 1.02 && open.peak < 1.12, 'overshoot of a 0.66 spring is a few percent, got ' + open.peak);
assert(open.ms >= 250 && open.ms <= 700, 'settles in a sensible time, got ' + open.ms);
// a heavily damped spring never overshoots
const calm = S.easing(1.1, 26);
assert(calm.peak <= 1.0001, 'critically damped / over-damped must not overshoot');
// more damping settles sooner, a higher frequency settles sooner
assert(S.settleSeconds(0.9, 24) < S.settleSeconds(0.4, 24));
assert(S.settleSeconds(0.66, 40) < S.settleSeconds(0.66, 20));
// every stop is a finite number and the list has the requested size
const pts = open.css.slice(7, -1).split(', ').map(Number);
assert(pts.length === 41 && pts.every(Number.isFinite), 'forty-one finite stops');
console.log('PASS spring: open peak ' + open.peak + ', ' + open.ms + ' ms');
