// Camera / microphone "in use" indicator for Windows.
// Windows keeps, per app, when the camera and microphone were last used, under
//   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{webcam|microphone}\...
// An app that is using the device right now has LastUsedTimeStart set and LastUsedTimeStop = 0. This only READS those
// values with reg.exe: it never records audio or video and cannot see what an app does with the device.
// Apps that crash while recording can leave a Stop of 0 behind, so a "start" older than 12 hours is ignored.
const { execFile } = require('child_process');

const BASE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\';
const FILETIME_EPOCH = 116444736000000000n;                       // 1601 -> 1970, in 100 ns ticks
const STALE_MS = 12 * 3600 * 1000;

// `reg query <key> /s` text -> is any app using it right now?
function parseInUse(text, now = Date.now()) {
  let start = null, stop = null, used = false;
  const flush = () => {
    if (start != null && stop === 0n && start > 0n) {
      const startMs = Number((start - FILETIME_EPOCH) / 10000n);
      if (now - startMs < STALE_MS) used = true;
    }
    start = null; stop = null;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('HKEY_')) { flush(); continue; }           // a new app's key
    const m = /^(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+0x([0-9a-fA-F]+)$/.exec(line);
    if (!m) continue;
    try { const v = BigInt('0x' + m[2]); if (m[1] === 'LastUsedTimeStart') start = v; else stop = v; } catch { /* ignore a malformed value */ }
  }
  flush();
  return used;
}

function query(kind) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', BASE + kind, '/s'], { windowsHide: true, timeout: 3000, maxBuffer: 1 << 20 }, (err, stdout) => {
      resolve(err && !stdout ? false : parseInUse(stdout || ''));    // missing key (no app ever used it) is just "not in use"
    });
  });
}

// onChange({ camera, mic }) is called only when something changes. Returns { stop() }.
function watch(onChange, { intervalMs = 3000 } = {}) {
  if (process.platform !== 'win32') return { stop() {} };
  let last = '', timer = null, busy = false, stopped = false;
  async function tick() {
    if (busy || stopped) return; busy = true;
    try {
      const [camera, mic] = await Promise.all([query('webcam'), query('microphone')]);
      const key = camera + ':' + mic;
      if (key !== last && !stopped) { last = key; onChange({ camera, mic }); }
    } finally { busy = false; }
  }
  tick(); timer = setInterval(tick, intervalMs);
  return { stop() { stopped = true; clearInterval(timer); } };
}

module.exports = { parseInUse, watch };
