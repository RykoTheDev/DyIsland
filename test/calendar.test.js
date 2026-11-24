const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { monthGrid, resolveFirstDay, isoWeekday } = require(ROOT + '/calendar.js');
const out = []; const ok = (n) => out.push('PASS ' + n);

// November 2026 starts on a Sunday; the 24th is a Tuesday
let g = monthGrid(2026, 10, 1);                                     // weeks start Monday
assert.strictEqual(g.length, 6); assert.ok(g.every((r) => r.length === 7)); ok('always 6 weeks x 7 days');
assert.strictEqual(g[0][0].iso, '2026-10-26'); assert.strictEqual(g[0][0].inMonth, false); assert.strictEqual(g[0][6].iso, '2026-11-01'); assert.strictEqual(g[0][6].inMonth, true);
ok('Monday-first: Nov 1 2026 (a Sunday) is the last cell of the first row');
g = monthGrid(2026, 10, 7);                                         // Sunday first
assert.strictEqual(g[0][0].iso, '2026-11-01'); assert.strictEqual(g[0][0].inMonth, true); ok('Sunday-first: Nov 1 is the first cell');
const flat = g.flat(); assert.strictEqual(flat.filter((c) => c.inMonth).length, 30); assert.strictEqual(new Set(flat.map((c) => c.iso)).size, 42); ok('30 days in November, 42 distinct dates');
assert.strictEqual(flat.find((c) => c.iso === '2026-11-24').weekday, 2); ok('Nov 24 2026 is a Tuesday');

// Every row must run consecutive days, including across month ends and leap years
for (const [y, m] of [[2024, 1], [2025, 1], [2026, 11], [2026, 0], [2027, 2]]) for (const fd of [1, 6, 7]) {
  const cells = monthGrid(y, m, fd).flat();
  for (let i = 1; i < cells.length; i++) {
    const a = new Date(cells[i - 1].iso + 'T12:00:00'), b = new Date(cells[i].iso + 'T12:00:00');
    assert.strictEqual(Math.round((b - a) / 86400000), 1, `${y}-${m} fd${fd} gap at ${i}`);
  }
  assert.strictEqual(cells.filter((c) => c.inMonth).length, new Date(y, m + 1, 0).getDate());
}
ok('consecutive days everywhere (leap Feb 2024, Dec -> Jan, various week starts)');

// DST: US spring-forward 2026-03-08 and fall-back 2026-11-01 must not skip or repeat a date
process.env.TZ = 'America/New_York';
for (const [y, m] of [[2026, 2], [2026, 10]]) { const c = monthGrid(y, m, 7).flat(); assert.strictEqual(new Set(c.map((x) => x.iso)).size, 42); }
ok('daylight-saving changes do not skip or repeat a date');

assert.strictEqual(resolveFirstDay('mon'), 1); assert.strictEqual(resolveFirstDay('sun'), 7); assert.strictEqual(resolveFirstDay('sat'), 6);
assert.strictEqual(resolveFirstDay('auto', 'en-US'), 7); assert.strictEqual(resolveFirstDay('auto', 'en-GB'), 1); assert.strictEqual(resolveFirstDay('auto', 'ar-EG'), 6);
ok('week start: explicit settings, and the locale for auto (US Sunday, UK Monday, Egypt Saturday)');
assert.strictEqual(isoWeekday(new Date(2026, 10, 1)), 7); ok('isoWeekday: Sunday = 7');
console.log(out.join('\n')); console.log(out.length + ' checks passed');
