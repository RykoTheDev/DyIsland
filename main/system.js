// The system helper (system.ps1): one PowerShell process for the master volume, the keyboard-focus hand-back and Bluetooth connect toasts.
// Fails soft: if the helper cannot start, the island just has no volume HUD / no focus hand-back.
const { spawn } = require('child_process');

function create({ unpacked, logEvent, onVolume, onBluetooth, onNotification, onPower, onMouse, bluetooth, notifications, power, mouse }) {
  let proc = null, buf = '', restarts = 0, stopped = false, wantBt = !!bluetooth, wantNotif = !!notifications, wantPower = !!power, wantMouse = !!mouse, last = null, timer = null;

  function start() {
    if (proc || stopped) return;
    let p;
    try {
      p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', unpacked('system.ps1'), '-OwnPid', String(process.pid), ...(wantBt ? ['-Bluetooth'] : []), ...(wantNotif ? ['-Notifications'] : []), ...(wantPower ? ['-Power'] : []), ...(wantMouse ? ['-Mouse'] : [])], { windowsHide: true });
    } catch { return; }
    proc = p; buf = '';
    p.on('error', () => { if (proc === p) proc = null; });
    p.stdin.on('error', () => { /* EPIPE while the helper exits */ });
    p.stderr.setEncoding('utf8'); p.stderr.on('data', (d) => logEvent('system helper stderr: ' + String(d).slice(0, 200).replace(/\s+/g, ' ')));
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (chunk) => {
      if (proc !== p) return;
      restarts = 0; buf += chunk; let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        let m;
        if ((m = /^(VOLINIT|VOL) (\d{1,3}) ([01])$/.exec(line))) { last = { pct: Number(m[2]), mute: m[3] === '1', init: m[1] === 'VOLINIT' }; onVolume(last); }
        else if ((m = /^LMB ([01])$/.exec(line))) { if (onMouse) onMouse(m[1] === '1'); }
        else if ((m = /^PWR (\d{1,3}) ([01])$/.exec(line))) { if (onPower) onPower({ pct: Number(m[1]), ac: m[2] === '1' }); }
        else if ((m = /^BT (connected|gone) (.{1,80})$/.exec(line))) onBluetooth({ state: m[1], name: m[2] });
        else if ((m = /^NOTIF ([A-Za-z0-9+/=]{1,6000})$/.exec(line))) {
          try {                                                   // what other apps put in their notifications is untrusted: parsed as plain data, cut short, control characters out
            const o = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')), c = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n);
            if (onNotification) onNotification({ app: c(o.app, 40), aumid: c(o.aumid, 200), title: c(o.title, 90), body: c(o.body, 160) });
          } catch { /* not a notification we can read */ }
        }
      }
    });
    p.on('close', () => {
      if (proc !== p) return;
      proc = null;
      if (!stopped && restarts++ < 3) timer = setTimeout(start, 3000);
    });
  }
  const send = (line) => { if (proc && proc.stdin.writable) { try { proc.stdin.write(line + '\n'); } catch { /* helper gone */ } } };
  function stop() { stopped = true; clearTimeout(timer); const p = proc; proc = null; if (p) { try { p.stdin.end(); p.kill(); } catch { /* gone */ } } }
  // The watchers that are switched on are chosen when the helper starts: a change restarts it (about a second)
  function setFlags({ bluetooth: bt, notifications: nt, power: pw, mouse: ms }) {
    bt = !!bt; nt = !!nt; pw = !!pw; ms = !!ms;
    if (bt === wantBt && nt === wantNotif && pw === wantPower && ms === wantMouse) return;
    wantBt = bt; wantNotif = nt; wantPower = pw; wantMouse = ms;
    const p = proc; proc = null; if (p) { try { p.kill(); } catch { /* gone */ } }
    restarts = 0; start();
  }
  return {
    start, stop, setFlags,
    last: () => last,
    setVolume: (pct) => { const n = Math.round(Number(pct)); if (Number.isFinite(n)) send('VOLSET ' + Math.max(0, Math.min(100, n))); },
    setMute: (m) => send('VOLMUTE ' + (m ? 1 : 0)),
    fgRestore: () => send('FGRESTORE'),
    paste: (islandHasFocus) => send(islandHasFocus ? 'PASTE 1' : 'PASTE 0'),
  };
}

module.exports = { create };
