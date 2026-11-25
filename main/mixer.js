// Per-app volume: talks to mixer.ps1, one PowerShell process that starts on first use and ends after a minute of silence.
const { spawn } = require('child_process');

function parseMix(b64) {
  try {
    const arr = JSON.parse(Buffer.from(String(b64), 'base64').toString('utf8'));
    const list = Array.isArray(arr) ? arr : [arr];
    return list.filter((x) => x && Number.isInteger(x.pid) && typeof x.name === 'string').slice(0, 30)
      .map((x) => ({ pid: x.pid, name: x.name.replace(/[\u0000-\u001f]/g, '').slice(0, 60), volume: Math.max(0, Math.min(100, Math.round(Number(x.volume) || 0))), mute: !!x.mute }));
  } catch { return []; }
}

function create({ unpacked, logEvent = () => {}, idleMs = 60000 }) {
  let proc = null, buf = '', queue = [], idle = null;
  function start() {
    if (proc) return true;
    let p; try { p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', unpacked('mixer.ps1'), '-OwnPid', String(process.pid)], { windowsHide: true }); } catch { return false; }
    proc = p; buf = '';
    p.on('error', () => { if (proc === p) { proc = null; flush(null); } });
    p.stdin.on('error', () => {});
    p.stderr.setEncoding('utf8'); p.stderr.on('data', (d) => logEvent('mixer helper stderr: ' + String(d).slice(0, 200).replace(/\s+/g, ' ')));
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (c) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); const w = queue.shift(); if (w) { clearTimeout(w.t); w.resolve(line); } } });
    p.on('close', () => { if (proc === p) proc = null; flush(null); });
    return true;
  }
  function flush(v) { const q = queue; queue = []; for (const w of q) { clearTimeout(w.t); w.resolve(v); } }
  function ask(line) {
    return new Promise((resolve) => {
      if (!start()) return resolve(null);
      clearTimeout(idle); idle = setTimeout(stop, idleMs);
      const w = { resolve, t: setTimeout(() => { const i = queue.indexOf(w); if (i >= 0) queue.splice(i, 1); resolve(null); }, 8000) };
      queue.push(w);
      try { proc.stdin.write(line + '\n'); } catch { resolve(null); }
    });
  }
  function stop() { clearTimeout(idle); const p = proc; proc = null; flush(null); if (p) { try { p.stdin.end(); p.kill(); } catch { /* gone */ } } }
  return {
    async list() { const r = await ask('LIST'); const m = r && /^MIX ([A-Za-z0-9+/=]+)$/.exec(r); return m ? parseMix(m[1]) : []; },
    async set(pid, volume, mute) {
      const p = Math.round(Number(pid)); if (!Number.isInteger(p) || p < 0 || p > 4294967295) return { ok: false };
      const v = volume == null ? '-' : String(Math.max(0, Math.min(100, Math.round(Number(volume)) || 0)));
      const m = mute === true ? '1' : mute === false ? '0' : '-';
      return { ok: (await ask('SET ' + p + ' ' + v + ' ' + m)) === 'OK' };
    },
    stop,
  };
}

module.exports = { create, parseMix };
