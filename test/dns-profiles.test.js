const assert = require('assert');
const D = require('../dns-profiles.js');

// every preset is valid on its own
for (const p of D.PRESETS) assert(D.checkProfile(p), 'preset ' + p.id + ' passes its own checks');
// choosing presets + a custom provider
const list = D.buildProfiles({ presets: ['cloudflare', 'google', 'nope', 'google'], custom: [{ name: 'My DNS', v4a: '10.0.0.53', v4b: '10.0.0.54', doh: 'https://dns.example.com/dns-query' }] });
assert.deepStrictEqual(list.map((x) => x.id), ['cloudflare', 'google', 'custom1'], 'unknown and repeated ones are dropped, custom ones get ids');
assert.strictEqual(list[2].doh, 'https://dns.example.com/dns-query');
// refusals
const bad = (c) => D.buildProfiles({ presets: [], custom: [c] }).length === 0;
assert(bad({ name: 'x', v4a: '999.1.1.1' }), 'not an address');
assert(bad({ name: 'x', v4a: '127.0.0.1' }), 'loopback would break the connection');
assert(bad({ name: 'x', v4a: '0.0.0.0' }));
assert(bad({ name: '', v4a: '8.8.8.8' }), 'a name is needed');
assert(bad({ name: 'x' }), 'at least one address');
assert(bad({ name: 'x', v4a: '8.8.8.8', doh: 'http://dns.example.com/dns-query' }), 'DoH must be https');
assert(bad({ name: 'x', v4a: '8.8.8.8', doh: 'https://dns.example.com/a b' }));
assert(bad({ name: 'x', v4a: '8.8.8.8', doh: 'https://user@dns.example.com/' }));
assert(bad({ name: 'x', v4a: '8.8.8.8; calc' }));
assert(bad({ name: 'x', v6a: 'not:ipv6:::::' }));
assert.strictEqual(D.buildProfiles({ presets: D.PRESETS.map((p) => p.id), custom: [] }).length, D.MAX_PROFILES, 'at most 8');

// state from the registry
const G1 = '{11111111-2222-3333-4444-555555555555}', G2 = '{66666666-7777-8888-9999-000000000000}';
const cfg = { adapters: [{ alias: 'Wi-Fi', guid: G1 }, { alias: 'Ethernet', guid: G2 }], profiles: list };
assert.deepStrictEqual(D.decideState(null, {}), { state: 'notinstalled', id: '' });
assert.deepStrictEqual(D.decideState(cfg, {}), { state: 'absent', id: '' });
assert.deepStrictEqual(D.decideState(cfg, { [G1]: { v4: [], v6: [] } }), { state: 'auto', id: '' });
assert.deepStrictEqual(D.decideState(cfg, { [G1]: { v4: ['8.8.4.4', '8.8.8.8'], v6: ['2001:4860:4860::8888', '2001:4860:4860::8844'] } }), { state: 'profile', id: 'google' });
assert.deepStrictEqual(D.decideState(cfg, { [G1]: { v4: ['1.1.1.1', '1.0.0.1'], v6: ['2606:4700:4700::1111', '2606:4700:4700::1001'] }, [G2]: { v4: [], v6: [] } }), { state: 'mixed', id: '' });
assert.deepStrictEqual(D.decideState(cfg, { [G1]: { v4: ['9.9.9.9'], v6: [] } }), { state: 'custom', id: '' });
// a config that was edited into nonsense is "not installed", never trusted
assert.strictEqual(D.decideState({ adapters: [{ guid: 'x' }], profiles: list }, {}).state, 'notinstalled');
assert.strictEqual(D.decideState({ adapters: cfg.adapters, profiles: [{ id: 'a', name: 'a', v4: ['1.1.1.1; rm'] }] }, {}).state, 'notinstalled');
console.log('PASS dns profiles: presets, custom entries, refusals, state detection');
