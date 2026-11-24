// DNS switch: lets the island turn your NextDNS (Windows DNS-over-HTTPS) setup on and off, and show which it is.
//
// How it works, and why it is built this way:
//  * Changing DNS needs administrator rights. DyIsland itself never runs as admin. Instead, a ONE-TIME elevated setup
//    (dns/dns-setup.ps1, which you run and approve yourself) copies a tiny script into C:\ProgramData\DyIsland\dns (writable
//    only by administrators), records your NextDNS settings there, and creates two scheduled tasks, "DyIsland DNS On" and
//    "DyIsland DNS Off", that only YOUR user may start. The island just starts a task. The task runs the fixed script with a
//    fixed mode, so nothing the island (or anything else running as you) sends can change what it does.
//  * "Off" puts the adapter back on automatic DNS (your ISP's / router's). "On" restores exactly what was saved at setup.
//  * Reading the current state needs no rights: the static DNS servers of each adapter are in the registry.
// This file is the pure part (config validation, registry parsing, state decision) so it can be tested without Windows.
const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const GUID = /^\{[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\}$/;
const TEMPLATE = /^https:\/\/(?:[A-Za-z0-9-]+\.)*nextdns\.io(?::\d{1,5})?\/[A-Za-z0-9._~/-]{0,128}$/;   // encrypted DNS may only point at NextDNS
const FLAGS = /^(?:0[xX][0-9A-Fa-f]{1,16}|\d{1,19})$/;
const TASK_ON = 'DyIsland DNS On', TASK_OFF = 'DyIsland DNS Off';

function isIPv6(s) { return typeof s === 'string' && s.length <= 45 && /^[0-9A-Fa-f:.]+$/.test(s) && s.includes(':') && (s.match(/::/g) || []).length <= 1; }

// config.json as written by dns-setup.ps1: { adapters: [ { alias, guid, v4: [...], v6: [...] } ] }. Anything odd => null (treated as "not set up").
function validateConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.adapters) || !raw.adapters.length || raw.adapters.length > 16) return null;
  const adapters = [];
  for (const a of raw.adapters) {
    if (!a || typeof a !== 'object' || !GUID.test(String(a.guid))) return null;
    const v4 = (Array.isArray(a.v4) ? a.v4 : []).map(String), v6 = (Array.isArray(a.v6) ? a.v6 : []).map(String);
    if (v4.length > 8 || v6.length > 8 || v4.some((x) => !IPV4.test(x)) || v6.some((x) => !isIPv6(x))) return null;
    if (!v4.length && !v6.length) return null;
    // optional: the encrypted-DNS (DoH) entries Windows keeps per server. Each must belong to a saved address and point at NextDNS.
    const doh = [];
    for (const d of (Array.isArray(a.doh) ? a.doh : [])) {
      if (!d || typeof d !== 'object') return null;
      const ip = String(d.ip);
      if (!v4.includes(ip) && !v6.includes(ip)) return null;
      if (!TEMPLATE.test(String(d.template)) || !FLAGS.test(String(d.flags)) || !['QWord', 'DWord'].includes(String(d.kind))) return null;
      doh.push({ ip, template: String(d.template), flags: String(d.flags), kind: String(d.kind) });
    }
    if (doh.length > 16) return null;
    adapters.push({ alias: String(a.alias || '').slice(0, 80), guid: String(a.guid), v4, v6, doh });
  }
  return { adapters };
}

// `reg query <key> /v NameServer` output -> list of addresses (empty when DNS is automatic / the value is missing)
function parseNameServer(text) {
  const m = /NameServer\s+REG_SZ\s*(.*)/i.exec(String(text || ''));
  if (!m) return [];
  return m[1].split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}

const same = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

// current: { [guid]: { v4: [...], v6: [...] } } as read from the registry (only for adapters that exist).
// -> 'on' (every adapter is set to the saved servers), 'unencrypted' (on, but the encrypted-DNS settings are missing), 'off' (every adapter is on automatic DNS), 'mixed' (some of each),
//    'custom' (something else, e.g. you changed DNS by hand), 'absent' (none of the saved adapters is here right now)
function decideState(config, current) {
  const cfg = validateConfig(config);
  if (!cfg) return 'notinstalled';
  let on = 0, off = 0, other = 0, seen = 0, noDoh = 0;
  for (const a of cfg.adapters) {
    const cur = current && current[a.guid];
    if (!cur) continue;
    seen++;
    const c4 = (cur.v4 || []).filter((x) => IPV4.test(x)), c6 = (cur.v6 || []).filter(isIPv6);
    if (same(c4, a.v4) && same(c6, a.v6)) { on++; if (a.doh && a.doh.length && cur.dohOk === false) noDoh++; }
    else if (!c4.length && !c6.length) off++;
    else other++;
  }
  if (!seen) return 'absent';
  if (other) return 'custom';
  if (on && off) return 'mixed';
  if (on && noDoh) return 'unencrypted';
  return on ? 'on' : 'off';
}

module.exports = { validateConfig, parseNameServer, decideState, TASK_ON, TASK_OFF, GUID, IPV4 };
