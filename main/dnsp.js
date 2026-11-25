// DNS providers (Cloudflare, Google, AdGuard, Quad9, your own...): read the state, start a switch task, run the elevated setup. Rules in dns-profiles.js.
// Nothing from the page is ever put into a command line except the provider list, and that goes base64 inside the elevated setup (which shows it and asks y/n).
const fs = require('fs');
const path = require('path');
const P = require('../dns-profiles');

function create({ ipcMain, run, unpacked, logEvent, store }) {
  const dir = () => path.join(process.env.ProgramData || 'C:\\ProgramData', 'DyIsland', 'dnsp');
  const IF_V4 = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\';
  const IF_V6 = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters\\Interfaces\\';
  const nameServers = (out) => { const m = /NameServer\s+REG_SZ\s*(.*)/i.exec(String(out || '')); return m ? m[1].split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean) : []; };
  function readConfig() {
    try { return P.validateConfig(JSON.parse(fs.readFileSync(path.join(dir(), 'profiles.json'), 'utf8').replace(/^\uFEFF/, ''))); } catch { return null; }
  }
  async function status() {
    if (process.platform !== 'win32') return { state: 'unsupported', profiles: [], id: '' };
    const cfg = readConfig();
    if (!cfg) return { state: 'notinstalled', profiles: [], id: '' };
    const current = {};
    for (const a of cfg.adapters) {
      if (!(await run('reg.exe', ['query', IF_V4 + a.guid])).ok) continue;                                   // that connection is not here right now
      current[a.guid] = { v4: nameServers((await run('reg.exe', ['query', IF_V4 + a.guid, '/v', 'NameServer'])).out), v6: nameServers((await run('reg.exe', ['query', IF_V6 + a.guid, '/v', 'NameServer'])).out) };
    }
    const d = P.decideState(cfg, current);
    return { state: d.state, id: d.id, profiles: cfg.profiles.map((p, i) => ({ id: p.id, name: p.name, slot: i + 1, doh: !!p.doh })) };
  }
  let busy = false;
  // which: 'auto' or a profile id (one of the saved ones). The task name comes from OUR saved list, never from the page.
  async function use(which) {
    if (busy) return { state: 'busy' };
    busy = true;
    try {
      const st = await status();
      if (st.state === 'notinstalled' || st.state === 'unsupported') return st;
      let task = P.TASK_OFF, target = 'auto';
      if (which !== 'auto') { const p = st.profiles.find((x) => x.id === which); if (!p) return st; task = P.taskFor(p.slot); target = p.id; }
      const r = await run('schtasks.exe', ['/run', '/tn', task]);
      logEvent('dns provider -> ' + target + (r.ok ? '' : ' (could not start the task)'));
      if (!r.ok) return { ...st, state: 'failed' };
      for (let i = 0; i < 10; i++) {
        await new Promise((x) => setTimeout(x, 600));
        const now = await status();
        if ((target === 'auto' && now.state === 'auto') || (target !== 'auto' && now.state === 'profile' && now.id === target)) return now;
      }
      return await status();
    } finally { busy = false; }
  }
  async function runElevated(scriptName, extraArgs) {
    const scriptB64 = Buffer.from(unpacked('dns', scriptName), 'utf8').toString('base64');
    const extra = (extraArgs || []).map((a) => ",'" + a.replace(/[^A-Za-z0-9+/=_-]/g, '') + "'").join('');           // base64 / plain words only: nothing in it can be read as code
    const cmd = "$p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + scriptB64 + "')); " +
      "try { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',('\"' + $p + '\"')" + extra + " -ErrorAction Stop; exit 0 } catch { exit 1 }";
    const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const r = await run(psExe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(cmd, 'utf16le').toString('base64')], 120000);
    return { ok: r.ok };
  }
  // Install / update: the list comes from the saved settings (presets + custom entries), is checked here, and is checked again (and shown) by the elevated script
  async function setup() {
    const c = store.get().dnsp;
    const list = P.buildProfiles({ presets: c.presets, custom: c.custom });
    if (!list.length) return { ok: false, error: 'Pick at least one provider first' };
    const b64 = Buffer.from(JSON.stringify(list), 'utf8').toString('base64');
    if (b64.length > 5800) return { ok: false, error: 'That list is too long' };
    return runElevated('dnsp-setup.ps1', ['-ProfilesB64', b64]);
  }
  ipcMain.handle('dnsp:presets', () => P.PRESETS.map((p) => ({ id: p.id, name: p.name, note: p.note })));
  ipcMain.handle('dnsp:status', () => status());
  ipcMain.handle('dnsp:use', (_e, which) => use(typeof which === 'string' ? which.slice(0, 40) : 'auto'));
  ipcMain.handle('dnsp:setup', () => setup());
  ipcMain.handle('dnsp:remove', () => runElevated('dnsp-remove.ps1'));
  return { status, use };
}

module.exports = { create };
