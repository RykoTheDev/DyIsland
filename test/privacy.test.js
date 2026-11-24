const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const { parseInUse, watch } = require(ROOT + '/privacy.js');
const ok = (m) => console.log('PASS ' + m);
const now = Date.UTC(2026, 10, 24, 12, 0, 0);
const ft = (ms) => '0x' + (BigInt(ms) * 10000n + 116444736000000000n).toString(16);
const block = (name, start, stop) => `\nHKEY_CURRENT_USER\\Software\\...\\${name}\n    LastUsedTimeStart    REG_QWORD    ${start}\n    LastUsedTimeStop    REG_QWORD    ${stop}\n`;

assert.strictEqual(parseInUse(block('a', ft(now - 60000), '0x0'), now), true); ok('start set, stop 0: in use');
assert.strictEqual(parseInUse(block('a', ft(now - 60000), ft(now - 1000)), now), false); ok('stop after start: not in use');
assert.strictEqual(parseInUse(block('a', ft(now - 60000), ft(now - 1000)) + block('b', ft(now - 5000), '0x0'), now), true); ok('one of several apps in use');
assert.strictEqual(parseInUse(block('a', ft(now - 13 * 3600e3), '0x0'), now), false); ok('stale entry (crashed app, 13 h) ignored');
assert.strictEqual(parseInUse('', now), false); assert.strictEqual(parseInUse('ERROR: The system was unable to find the specified registry key', now), false); ok('empty and error text: not in use');
assert.strictEqual(parseInUse(block('a', '0x0', '0x0'), now), false); ok('never used (start 0): not in use');
assert.strictEqual(parseInUse('HKEY_X\n    LastUsedTimeStart    REG_QWORD    0xZZZ\n    LastUsedTimeStop    REG_QWORD    0x0\n', now), false); ok('garbage value does not throw');
// real registry on this PC: must answer true/false without hanging or throwing
const w = watch((s) => { assert.strictEqual(typeof s.camera, 'boolean'); assert.strictEqual(typeof s.mic, 'boolean'); ok('real registry query answered: ' + JSON.stringify(s)); w.stop(); process.exit(0); });
setTimeout(() => { console.log('FAIL no answer from the real registry in 8s'); process.exit(1); }, 8000);
