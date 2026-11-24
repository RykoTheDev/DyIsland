const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const P = require(ROOT + '/placement.js');
const ok = (m) => console.log('PASS ' + m);
const d1 = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const d2 = { id: 2, bounds: { x: 1920, y: -200, width: 2560, height: 1440 }, workArea: { x: 1920, y: -200, width: 2560, height: 1400 } };
const dL = { id: 3, bounds: { x: -1280, y: 100, width: 1280, height: 1024 } };
const all = [d1, d2, dL];

assert.deepStrictEqual(P.pickDisplays(all, 1, 'primary').map((d) => d.id), [1]);
assert.deepStrictEqual(P.pickDisplays(all, 1, 'all').map((d) => d.id), [1, 2, 3]); ok('primary / all (primary leads)');
assert.deepStrictEqual(P.pickDisplays(all, 1, '2').map((d) => d.id), [2]);
assert.deepStrictEqual(P.pickDisplays(all, 1, '99').map((d) => d.id), [1]); ok('a specific monitor, and an unplugged one falls back to primary');
assert.deepStrictEqual(P.pickDisplays(all, 2, 'all').map((d) => d.id), [2, 1, 3]); ok('primary is whichever Windows says');
assert.deepStrictEqual(P.pickDisplays([], 1, 'all'), []); assert.deepStrictEqual(P.pickDisplays(null, 1, 'x'), []); ok('no displays: empty, no throw');

assert.deepStrictEqual(P.windowBounds(d1.bounds, 'top'), { x: 592, y: 0, width: 736, height: 376 });
assert.deepStrictEqual(P.windowBounds(d1.bounds, 'left'), { x: 0, y: 280, width: 736, height: 520 });
assert.deepStrictEqual(P.windowBounds(d1.bounds, 'right'), { x: 1184, y: 280, width: 736, height: 520 });
assert.deepStrictEqual(P.windowBounds(d2.bounds, 'top'), { x: 1920 + 912, y: -200, width: 736, height: 376 }); ok('window bounds per edge, including a monitor with a negative origin');
assert.deepStrictEqual(P.windowBounds(dL.bounds, 'right'), { x: -1280 + 1280 - 736, y: 100 + 252, width: 736, height: 520 }); ok('monitor left of primary (negative x)');
const tiny = { x: 0, y: 0, width: 600, height: 400 }; const tb = P.windowBounds(tiny, 'left'); assert.ok(tb.width <= 600 && tb.height <= 400); ok('a small screen never gets a bigger window');

let s = P.settingsBounds(d1, 'top', 520, 264); assert.deepStrictEqual(s, { x: 712, y: 264 + 8 - 16, width: 496, height: 680 });
s = P.settingsBounds(d1, 'left', 520, 264); assert.ok(s.x === 520 + 48 + 8 - 16 && s.y >= 0 && s.y + s.height <= 1040);
s = P.settingsBounds(d1, 'right', 520, 264); assert.ok(s.x + s.width - 16 === 1920 - 520 - 48 - 8); ok('settings card: under (top), beside past the button (left/right)');
s = P.settingsBounds({ bounds: { x: 0, y: 0, width: 800, height: 500 } }, 'left', 640, 340); assert.ok(s.x >= 0 && s.x + s.width <= 800 && s.height <= 500); ok('settings card clamps on a small screen');

assert.ok(P.nearDock({ x: 960, y: 2 }, d1.bounds, 'top')); assert.ok(!P.nearDock({ x: 960, y: 30 }, d1.bounds, 'top')); assert.ok(!P.nearDock({ x: 100, y: 2 }, d1.bounds, 'top'));
assert.ok(P.nearDock({ x: 1, y: 540 }, d1.bounds, 'left')); assert.ok(!P.nearDock({ x: 1, y: 100 }, d1.bounds, 'left')); assert.ok(!P.nearDock({ x: 50, y: 540 }, d1.bounds, 'left'));
assert.ok(P.nearDock({ x: 1919, y: 540 }, d1.bounds, 'right')); assert.ok(!P.nearDock({ x: 1, y: 540 }, d1.bounds, 'right')); ok('hot zone per edge');
assert.deepStrictEqual(P.dockPoint(d1.bounds, 'left'), { x: 0, y: 540 }); assert.deepStrictEqual(P.dockPoint(d1.bounds, 'top'), { x: 960, y: 0 }); ok('dock point');
assert.ok(P.insideRect({ x: 2000, y: 0 }, d2.bounds) && !P.insideRect({ x: 2000, y: 0 }, d1.bounds)); ok('insideRect');
const labels = P.monitorLabels(all, 1); assert.strictEqual(labels.length, 3); assert.ok(/main/.test(labels.find((l) => l.id === '1').label)); assert.ok(/left of main/.test(labels.find((l) => l.id === '3').label)); assert.ok(/right of main/.test(labels.find((l) => l.id === '2').label)); assert.strictEqual(labels[0].id, '3'); ok('picker labels: numbered left to right, main marked, position named');
{ const a = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, b = { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }, c = { id: 3, bounds: { x: 0, y: -1080, width: 1920, height: 1080 } };
  assert.ok(P.sharedEdge(a, 'right', [a, b])); assert.ok(P.sharedEdge(b, 'left', [a, b])); assert.ok(!P.sharedEdge(a, 'left', [a, b])); assert.ok(!P.sharedEdge(a, 'top', [a, b]));
  assert.ok(P.sharedEdge(a, 'top', [a, c])); assert.ok(!P.sharedEdge(a, 'top', [a])); assert.ok(!P.sharedEdge(a, 'right', [a, { id: 9, bounds: { x: 1920, y: 2000, width: 100, height: 100 } }])); ok('shared-edge detection (another monitor right behind the docked edge)'); }
