const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const D = require(ROOT + '/dns-switch.js');
const ok = (m) => console.log('PASS ' + m);
const G1 = '{12345678-ABCD-1234-ABCD-1234567890AB}', G2 = '{22345678-ABCD-1234-ABCD-1234567890AB}';
const cfg = { adapters: [{ alias: 'Ethernet', guid: G1, v4: ['45.90.28.10', '45.90.30.10'], v6: ['2a07:a8c0::ab:cdef', '2a07:a8c1::ab:cdef'] }] };

assert.ok(D.validateConfig(cfg)); ok('a good config is accepted');
for (const bad of [null, {}, { adapters: [] }, { adapters: [{ guid: 'nope', v4: ['1.1.1.1'] }] }, { adapters: [{ guid: G1, v4: ['999.1.1.1'] }] }, { adapters: [{ guid: G1, v4: ['1.1.1.1; calc'] }] }, { adapters: [{ guid: G1, v4: [], v6: [] }] }, { adapters: [{ guid: G1, v6: ['not an ip'] }] }, { adapters: [{ guid: G1, v4: ['1.1.1.1'], v6: ['::1::2'] }] }, { adapters: Array(20).fill({ guid: G1, v4: ['1.1.1.1'] }) }])
  assert.strictEqual(D.validateConfig(bad), null);
ok('odd, hostile or oversized configs are rejected (they are never passed on to anything)');

assert.deepStrictEqual(D.parseNameServer('\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\...\r\n    NameServer    REG_SZ    45.90.28.10,45.90.30.10\r\n'), ['45.90.28.10', '45.90.30.10']);
assert.deepStrictEqual(D.parseNameServer('    NameServer    REG_SZ    \r\n'), []); assert.deepStrictEqual(D.parseNameServer('ERROR: The system was unable to find the specified registry key or value.'), []); assert.deepStrictEqual(D.parseNameServer(null), []);
assert.deepStrictEqual(D.parseNameServer('    NameServer    REG_SZ    2a07:a8c0::ab:cdef 2a07:a8c1::ab:cdef'), ['2a07:a8c0::ab:cdef', '2a07:a8c1::ab:cdef']); ok('registry text parsing (set, empty, missing, IPv6, junk)');

const onNow = { [G1]: { v4: ['45.90.30.10', '45.90.28.10'], v6: ['2a07:a8c1::ab:cdef', '2a07:a8c0::ab:cdef'] } };
assert.strictEqual(D.decideState(cfg, onNow), 'on'); ok('saved servers in any order: on');
assert.strictEqual(D.decideState(cfg, { [G1]: { v4: [], v6: [] } }), 'off'); ok('automatic DNS: off');
assert.strictEqual(D.decideState(cfg, { [G1]: { v4: ['8.8.8.8'], v6: [] } }), 'custom'); ok('a different static DNS: custom (the tile will not pretend it is on or off)');
assert.strictEqual(D.decideState(cfg, { [G1]: { v4: ['45.90.28.10', '45.90.30.10'], v6: [] } }), 'custom'); ok('only part of the saved servers: custom');
assert.strictEqual(D.decideState(cfg, {}), 'absent'); assert.strictEqual(D.decideState(cfg, { [G2]: { v4: [], v6: [] } }), 'absent'); ok('saved adapter not present (cable unplugged): absent');
assert.strictEqual(D.decideState(null, onNow), 'notinstalled'); assert.strictEqual(D.decideState({ adapters: [{ guid: 'x' }] }, onNow), 'notinstalled'); ok('no or invalid config: not installed');
const two = { adapters: [cfg.adapters[0], { alias: 'Wi-Fi', guid: G2, v4: ['45.90.28.10'], v6: [] }] };
assert.strictEqual(D.decideState(two, { ...onNow, [G2]: { v4: [], v6: [] } }), 'mixed'); assert.strictEqual(D.decideState(two, { ...onNow, [G2]: { v4: ['45.90.28.10'], v6: [] } }), 'on'); ok('two adapters: mixed, and on');
assert.strictEqual(D.decideState(two, { [G1]: { v4: [], v6: [] } }), 'off'); ok('one saved adapter missing is ignored if the others agree');
