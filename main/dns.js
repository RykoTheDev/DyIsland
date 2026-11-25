// NextDNS on/off switch. The privileged part is two scheduled tasks created by dns/dns-setup.ps1; here we only READ the state
// (registry, no rights needed) and START a task. Nothing from the page is ever put into a command line.
const fs = require('fs');
const path = require('path');
const dnsSwitch = require('../dns-switch');

function create({ ipcMain, run, unpacked, logEvent }) {
  // ---- DNS switch (NextDNS on/off). The privileged part is two scheduled tasks created by dns/dns-setup.ps1; here we only READ the state
  // (registry, no rights needed) and START a task. Nothing from the page is ever put into a command line.
  const dnsDir = () => path.join(process.env.ProgramData || 'C:\\ProgramData', 'DyIsland', 'dns');
  const IF_V4 = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\';
  const IF_V6 = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters\\Interfaces\\';
  async function dnsStatus() {
    if (process.platform !== 'win32') return { state: 'unsupported' };
    let raw = null; try { raw = JSON.parse(fs.readFileSync(path.join(dnsDir(), 'config.json'), 'utf8').replace(/^﻿/, '')); } catch { /* not set up */ }   // (PowerShell 5.1 can write a byte-order mark: strip it)
    const cfg = dnsSwitch.validateConfig(raw);
    if (!cfg) return { state: 'notinstalled' };
    const current = {};
    for (const a of cfg.adapters) {
      if (!(await run('reg.exe', ['query', IF_V4 + a.guid])).ok) continue;            // that adapter is not here right now
      const v4 = dnsSwitch.parseNameServer((await run('reg.exe', ['query', IF_V4 + a.guid, '/v', 'NameServer'])).out);
      const v6 = dnsSwitch.parseNameServer((await run('reg.exe', ['query', IF_V6 + a.guid, '/v', 'NameServer'])).out);
      let dohOk;                                                                      // is the encrypted-DNS (DoH) setting Windows keeps for these servers still there?
      if (a.doh && a.doh.length) {
        dohOk = true;
        for (const d of a.doh) {
          const r = await run('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Dnscache\\InterfaceSpecificParameters\\' + a.guid + '\\DohInterfaceSettings\\Doh\\' + d.ip, '/v', 'DohTemplate']);
          if (!r.ok || !r.out.toLowerCase().includes(d.template.toLowerCase())) { dohOk = false; break; }
        }
      }
      current[a.guid] = { v4, v6, dohOk };
    }
    return { state: dnsSwitch.decideState(cfg, current) };
  }
  let dnsBusy = false;
  ipcMain.handle('dns:status', () => dnsStatus());
  ipcMain.handle('dns:toggle', async () => {
    if (dnsBusy) return { state: 'busy' };
    dnsBusy = true;
    try {
      const st = await dnsStatus();
      if (st.state === 'notinstalled' || st.state === 'unsupported' || st.state === 'absent') return st;
      const target = st.state === 'on' ? 'off' : 'on';                                 // anything but "on" (off, mixed, custom, unencrypted) goes to on
      const r = await run('schtasks.exe', ['/run', '/tn', target === 'on' ? dnsSwitch.TASK_ON : dnsSwitch.TASK_OFF]);
      logEvent('dns toggle -> ' + target + (r.ok ? '' : ' (could not start the task)'));
      if (!r.ok) return { state: 'failed' };
      for (let i = 0; i < 10; i++) { await new Promise((x) => setTimeout(x, 600)); const now = await dnsStatus(); if (now.state === target) return now; }
      return await dnsStatus();
    } finally { dnsBusy = false; }
  });
  // Setup / remove run the PowerShell scripts elevated: Windows shows its own approval prompt, and only the person at the screen can accept it
  async function runElevated(scriptName) {
    const scriptB64 = Buffer.from(unpacked('dns', scriptName), 'utf8').toString('base64');         // the path travels as base64: nothing in it can be read as code, whatever characters it has
    const cmd = "$p = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('" + scriptB64 + "')); " +
      "try { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe') -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',('\"' + $p + '\"') -ErrorAction Stop; exit 0 } catch { exit 1 }";
    const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const r = await run(psExe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(cmd, 'utf16le').toString('base64')], 120000);
    return { ok: r.ok };
  }
  ipcMain.handle('dns:setup', () => runElevated('dns-setup.ps1'));
  ipcMain.handle('dns:remove', () => runElevated('dns-remove.ps1'));

  return { status: dnsStatus };
}

module.exports = { create };
