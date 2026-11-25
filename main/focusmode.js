// Focus mode / Do not disturb sync (opt-in): follows the Windows 11 "Do not disturb" switch in the notification centre.
// That switch turns notification banners off, stored as HKCU\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings
// value NOC_GLOBAL_SETTING_TOASTS_ENABLED (0 = banners off). Windows has no public API for Focus Assist; this is the value the switch flips,
// and it is read only. When it changes, the island's own Do not disturb (quiet.dnd) follows it, one way: Windows -> island.
const { execFile } = require('child_process');

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings';

// `reg query` text -> true (do not disturb is on) | false | null (value not present: Windows never wrote it, so banners are on)
function parseDnd(text) {
  const m = /NOC_GLOBAL_SETTING_TOASTS_ENABLED\s+REG_DWORD\s+0x([0-9a-fA-F]+)/.exec(String(text));
  return m ? parseInt(m[1], 16) === 0 : null;
}

function read() {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', KEY, '/v', 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'], { windowsHide: true, timeout: 3000 }, (err, out) => resolve(err ? false : parseDnd(out) === true));
  });
}

function create({ onChange, intervalMs = 4000, readDnd = read }) {
  let timer = null, last = null, busy = false;
  async function tick() {
    if (busy) return; busy = true;
    try { const v = await readDnd(); if (!timer) return; if (v !== last) { const was = last; last = v; if (was !== null || v) onChange(v); } } finally { busy = false; }   // (starting with Windows already off is a change; starting on is not)
  }
  return { start() { if (!timer) { last = null; timer = setInterval(tick, intervalMs); tick(); } }, stop() { clearInterval(timer); timer = null; last = null; }, state: () => !!last, _tick: tick };
}

module.exports = { create, parseDnd, read };
