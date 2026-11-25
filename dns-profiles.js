// DNS providers: the pure part (presets, validation, working out which one is active). No Electron, no Windows, so it can be tested.
//
// Security model (same idea as the NextDNS switch in dns-switch.js): changing DNS needs administrator rights, and DyIsland never runs as admin.
//  * Which providers can be switched to is decided ONCE, in an elevated step you approve yourself (dns/dnsp-setup.ps1 shows the list and asks y/n).
//    The list is stored in C:\ProgramData\DyIsland\dnsp\profiles.json, a folder only administrators can write to.
//  * Switching afterwards just starts a scheduled task ("DyIsland DNSP 1".."8" or "Off") that only YOUR user may start. The task runs a fixed script
//    that reads the saved list: nothing the island (or another program running as you) sends can pick other servers.
//  * Changing the list (adding a provider) asks for administrator approval again.
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6 = /^[0-9A-Fa-f:]{2,39}$/;
const DOH = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]{0,120}[A-Za-z0-9])?(?::\d{1,5})?(?:\/[A-Za-z0-9._~\/-]{0,120})?$/;
const MAX_PROFILES = 8;
const TASK_OFF = 'DyIsland DNSP Off';
const taskFor = (slot) => 'DyIsland DNSP ' + slot;

const PRESETS = [
  { id: 'cloudflare', name: 'Cloudflare', note: 'Fast and private', v4: ['1.1.1.1', '1.0.0.1'], v6: ['2606:4700:4700::1111', '2606:4700:4700::1001'], doh: 'https://cloudflare-dns.com/dns-query' },
  { id: 'cloudflare-malware', name: 'Cloudflare Security', note: 'Blocks malware', v4: ['1.1.1.2', '1.0.0.2'], v6: ['2606:4700:4700::1112', '2606:4700:4700::1002'], doh: 'https://security.cloudflare-dns.com/dns-query' },
  { id: 'cloudflare-family', name: 'Cloudflare Family', note: 'Blocks malware and adult sites', v4: ['1.1.1.3', '1.0.0.3'], v6: ['2606:4700:4700::1113', '2606:4700:4700::1003'], doh: 'https://family.cloudflare-dns.com/dns-query' },
  { id: 'google', name: 'Google', note: 'Public DNS', v4: ['8.8.8.8', '8.8.4.4'], v6: ['2001:4860:4860::8888', '2001:4860:4860::8844'], doh: 'https://dns.google/dns-query' },
  { id: 'quad9', name: 'Quad9', note: 'Blocks malicious domains', v4: ['9.9.9.9', '149.112.112.112'], v6: ['2620:fe::fe', '2620:fe::9'], doh: 'https://dns.quad9.net/dns-query' },
  { id: 'adguard', name: 'AdGuard', note: 'Blocks ads and trackers', v4: ['94.140.14.14', '94.140.15.15'], v6: ['2a10:50c0::ad1:ff', '2a10:50c0::ad2:ff'], doh: 'https://dns.adguard-dns.com/dns-query' },
  { id: 'adguard-family', name: 'AdGuard Family', note: 'Ads, trackers and adult sites', v4: ['94.140.14.15', '94.140.15.16'], v6: ['2a10:50c0::bad1:ff', '2a10:50c0::bad2:ff'], doh: 'https://family.adguard-dns.com/dns-query' },
  { id: 'opendns', name: 'OpenDNS', note: 'Cisco OpenDNS', v4: ['208.67.222.222', '208.67.220.220'], v6: ['2620:119:35::35', '2620:119:53::53'], doh: 'https://doh.opendns.com/dns-query' },
  { id: 'mullvad', name: 'Mullvad', note: 'No logging, blocks nothing', v4: ['194.242.2.2'], v6: ['2a07:e340::2'], doh: 'https://dns.mullvad.net/dns-query' },
];

const isV6 = (s) => typeof s === 'string' && IPV6.test(s) && require('net').isIPv6(s);       // the same test Windows applies in the elevated setup
const cleanName = (s) => String(s == null ? '' : s).replace(/[\x00-\x1f]/g, ' ').trim().slice(0, 40);

// One profile from anywhere (a preset id, or a custom entry) -> a checked { id, name, v4, v6, doh } or null
function checkProfile(p) {
  if (!p || typeof p !== 'object') return null;
  const v4 = (Array.isArray(p.v4) ? p.v4 : []).map((x) => String(x).trim()).filter(Boolean), v6 = (Array.isArray(p.v6) ? p.v6 : []).map((x) => String(x).trim()).filter(Boolean);
  if (v4.length > 4 || v6.length > 4 || v4.some((x) => !IPV4.test(x)) || v6.some((x) => !isV6(x)) || (!v4.length && !v6.length)) return null;
  // loopback / unspecified / broadcast would break the connection: refuse
  if (v4.some((x) => /^(?:0\.|127\.|255\.)/.test(x))) return null;
  const doh = p.doh ? String(p.doh).trim() : '';
  if (doh && !DOH.test(doh)) return null;
  const name = cleanName(p.name);
  if (!name) return null;
  const id = String(p.id || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  if (!id) return null;
  return { id, name, v4, v6, doh };
}
// The list to install from the settings: preset ids + custom entries. Duplicates (same id) are dropped; at most 8.
function buildProfiles({ presets, custom }) {
  const out = [], seen = new Set();
  for (const id of Array.isArray(presets) ? presets : []) {
    const pr = PRESETS.find((x) => x.id === id); if (!pr || seen.has(pr.id)) continue;
    const c = checkProfile(pr); if (c) { out.push(c); seen.add(c.id); }
  }
  (Array.isArray(custom) ? custom : []).forEach((x, i) => {
    const c = checkProfile({ ...x, id: 'custom' + (i + 1), v4: [x && x.v4a, x && x.v4b].filter(Boolean), v6: [x && x.v6a, x && x.v6b].filter(Boolean) });
    if (c && !seen.has(c.id)) { out.push(c); seen.add(c.id); }
  });
  return out.slice(0, MAX_PROFILES);
}
// profiles.json as written by the setup script: { version, adapters: [{alias, guid}], profiles: [...] }
const GUID = /^\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}$/;
function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.adapters) || !raw.adapters.length || raw.adapters.length > 16 || !Array.isArray(raw.profiles) || !raw.profiles.length || raw.profiles.length > MAX_PROFILES) return null;
  const adapters = [];
  for (const a of raw.adapters) { if (!a || !GUID.test(String(a.guid))) return null; adapters.push({ alias: cleanName(a.alias), guid: String(a.guid) }); }
  const profiles = [];
  for (const p of raw.profiles) { const c = checkProfile(p); if (!c) return null; profiles.push(c); }
  return { adapters, profiles };
}
const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
// current: { [guid]: { v4: [...], v6: [...] } } read from the registry. -> { state, id }
//   state: 'notinstalled' | 'absent' (none of the saved connections is here) | 'auto' (all on automatic DNS) | 'profile' (id says which) | 'mixed' | 'custom'
function decideState(config, current) {
  const cfg = validateConfig(config); if (!cfg) return { state: 'notinstalled', id: '' };
  let seen = 0, auto = 0; const hits = new Map(); let other = 0;
  for (const a of cfg.adapters) {
    const cur = current && current[a.guid]; if (!cur) continue; seen++;
    const c4 = (cur.v4 || []).filter((x) => IPV4.test(x)), c6 = (cur.v6 || []).filter(isV6);
    if (!c4.length && !c6.length) { auto++; continue; }
    const p = cfg.profiles.find((q) => same(c4, q.v4) && same(c6, q.v6));
    if (p) hits.set(p.id, (hits.get(p.id) || 0) + 1); else other++;
  }
  if (!seen) return { state: 'absent', id: '' };
  if (other) return { state: 'custom', id: '' };
  if (hits.size > 1 || (hits.size === 1 && auto)) return { state: 'mixed', id: '' };
  if (hits.size === 1) return { state: 'profile', id: [...hits.keys()][0] };
  return { state: 'auto', id: '' };
}
module.exports = { PRESETS, MAX_PROFILES, TASK_OFF, taskFor, checkProfile, buildProfiles, validateConfig, decideState, IPV4, isV6, DOH };
