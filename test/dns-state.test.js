const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert'); const D = require(ROOT + '/dns-switch.js');
const G = '{12345678-ABCD-1234-ABCD-1234567890AB}';
const cfg = { adapters: [{ alias: 'Ethernet', guid: G, v4: ['45.90.28.139', '45.90.30.139'], v6: [], doh: [{ ip: '45.90.28.139', template: 'https://dns.nextdns.io/abc123', flags: '0x11', kind: 'QWord' }] }] };
const cur = (extra) => ({ [G]: { v4: ['45.90.30.139', '45.90.28.139'], v6: [], ...extra } });
assert.strictEqual(D.decideState(cfg, cur({ dohOk: true })), 'on');
assert.strictEqual(D.decideState(cfg, cur({ dohOk: false })), 'unencrypted');
assert.strictEqual(D.decideState(cfg, cur({})), 'on');                                   // could not read the DoH setting: do not guess
assert.strictEqual(D.decideState(cfg, { [G]: { v4: [], v6: [], dohOk: false } }), 'off');
console.log('PASS state: unencrypted is reported only when the servers are right but the encrypted-DNS setting is missing');
// a BOM-prefixed config (PowerShell 5.1 -Encoding UTF8) must still parse after the strip main.js does
const txt = '\uFEFF' + JSON.stringify(cfg); assert.ok(D.validateConfig(JSON.parse(txt.replace(/^\uFEFF/, '')))); assert.throws(() => JSON.parse(txt));
console.log('PASS a config with a byte-order mark parses once it is stripped (and would not without)');
