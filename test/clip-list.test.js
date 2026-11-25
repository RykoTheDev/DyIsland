const assert = require('assert');
const L = require('../main/clip-list.js');
const t = (id, text, pinned) => ({ id, kind: 'text', sig: 't:' + text, text, pinned: !!pinned });
const ids = (l) => l.map((x) => x.id).join();

let items = [];
for (const [i, s] of ['a', 'b', 'c'].entries()) items = L.add(items, t(i + 1, s), 3);
assert.strictEqual(ids(items), '3,2,1', 'newest first');
items = L.add(items, t(4, 'd'), 3); assert.strictEqual(ids(items), '4,3,2', 'the oldest falls off at the limit');
items = L.add(items, t(5, 'c'), 3); assert.strictEqual(ids(items), '3,4,2', 'copying the same thing again moves it up (and keeps its id), no duplicate');
// pins stay on top and never fall off
items = L.togglePin(items, 2, 3); assert.strictEqual(ids(items), '2,3,4'); assert(items[0].pinned);
items = L.add(items, t(6, 'e'), 3); items = L.add(items, t(7, 'f'), 3); items = L.add(items, t(8, 'g'), 3);
assert.strictEqual(ids(items), '2,8,7,6', 'pinned first; the limit counts only the unpinned ones: ' + ids(items));
items = L.add(items, t(9, 'b'), 3); assert.strictEqual(ids(items), '2,8,7,6', 'copying a pinned item again changes nothing');
// touching an item (copying it from the list) brings it to the top of its group
items = L.touch(items, 6); assert.strictEqual(ids(items), '2,6,8,7');
items = L.touch(items, 2); assert.strictEqual(ids(items), '2,6,8,7');
// unpinning drops it into the unpinned group (at the top) and the limit applies
items = L.togglePin(items, 2, 3); assert.strictEqual(ids(items), '2,6,8', 'unpinned: at the top of the rest, the oldest fell off');
items = L.togglePin(items, 8, 3); items = L.clearUnpinned(items); assert.strictEqual(ids(items), '8', 'Clear keeps the pinned');
// at most 10 pins
let many = []; for (let i = 1; i <= 12; i++) many = L.add(many, t(i, 'x' + i), 30);
for (let i = 1; i <= 12; i++) many = L.togglePin(many, i, 30);
assert.strictEqual(many.filter((x) => x.pinned).length, L.MAX_PINS);
// images: listed with a thumbnail and no full data, hidden by a search
const img = { id: 20, kind: 'image', sig: 'i:1', thumb: 'data:image/png;base64,AAA', image: { big: true }, pinned: false };
const withImg = L.add([t(21, 'hello world'), t(22, 'Hello again')], img, 10);
const v = L.view(withImg); assert(v.find((x) => x.kind === 'image').thumb && !('image' in v.find((x) => x.kind === 'image')), 'the page never gets the full image');
assert.deepStrictEqual(L.filter(v, 'hello').map((x) => x.id), [21, 22], 'search matches text only');
assert.deepStrictEqual(L.filter(v, 'world hello').map((x) => x.id), [21], 'every word has to match, in any order');
assert.strictEqual(L.filter(v, '').length, 3);
console.log('PASS clip-list: order, limit, pins, touch, clear, images, search');
