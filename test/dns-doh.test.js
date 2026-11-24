const ROOT = require('path').resolve(__dirname, '..').replace(/\\/g, '/');   // the repo folder
const assert = require('assert');
const D = require(ROOT + '/dns-switch.js');
const G1 = '{12345678-ABCD-1234-ABCD-1234567890AB}';
const base = (doh) => ({ adapters: [{ alias: 'Ethernet', guid: G1, v4: ['45.90.28.139', '45.90.30.139'], v6: [], doh }] });
const good = { ip: '45.90.28.139', template: 'https://dns.nextdns.io/abc123', flags: '0x11', kind: 'QWord' };
assert.ok(D.validateConfig(base([good]))); assert.ok(D.validateConfig(base([]))); assert.ok(D.validateConfig(base(undefined)));
assert.ok(D.validateConfig(base([{ ...good, flags: '17', kind: 'DWord' }])));
for (const bad of [{ ...good, template: 'https://evil.example/abc123' }, { ...good, template: 'https://dns.nextdns.io.evil.example/x' }, { ...good, template: 'http://dns.nextdns.io/x' }, { ...good, template: 'https://dns.nextdns.io/x y' }, { ...good, template: 'https://dns.nextdns.io/../x\nrm' }, { ...good, ip: '8.8.8.8' }, { ...good, flags: 'zz' }, { ...good, kind: 'String' }])
  assert.strictEqual(D.validateConfig(base([bad])), null, JSON.stringify(bad));
console.log('PASS encrypted-DNS entries: only NextDNS templates for saved addresses are accepted; a tampered config is rejected');
