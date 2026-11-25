// Real main + real preload + real renderer: seeds a settings file with the Send and Shelf features on, starts the app (hidden, isolated like
// main-smoke) and reads the tab buttons from the page. Run with:  node test/main-tabs.js  (needs Electron; unset ELECTRON_RUN_AS_NODE)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const electron = require('electron');
const run = (settings) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyisland-tabs-'));
  const ud = path.join(tmp, 'userdata'); fs.mkdirSync(ud, { recursive: true });
  if (settings) fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(settings));
  const expr = "new Promise((r) => setTimeout(() => r({ api: typeof window.islandAPI === 'object' && ['pathForFile','localsendDevices','shelfList','onDropArmed','onShelf'].every((k) => typeof window.islandAPI[k] === 'function'), tabs: [...document.querySelectorAll('[data-tab-btn]')].map((b) => b.dataset.go) }), 500))";
  const env = { ...process.env, DYISLAND_SMOKE: '1', DYISLAND_USERDATA: ud, DYISLAND_SMOKE_EVAL: expr, USERPROFILE: tmp, HOME: tmp };
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [root], { cwd: root, encoding: 'utf8', timeout: 60000, env });
  const out = String(r.stdout || '') + String(r.stderr || '');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
  const m = /SMOKE-EVAL (.*)/.exec(out);
  return { ok: /SMOKE-OK/.test(out) && !/UNCAUGHT|SMOKE-TIMEOUT/.test(out), eval: m ? JSON.parse(m[1]) : null, out };
};
const fail = (m, o) => { console.error('MAIN TABS FAILED: ' + m + (o ? '\n' + o.split('\n').slice(-15).join('\n') : '')); process.exit(1); };
const on = run({ localsend: { enabled: true }, shelf: { enabled: true }, hiddenTabs: [] });
if (!on.ok || !on.eval) fail('app did not start or no page result', on.out);
if (!on.eval.api) fail('preload API incomplete');
if (!on.eval.tabs.includes('localsend') || on.eval.tabs.includes('shelf')) fail('tabs missing with features on: ' + on.eval.tabs);
const off = run(null);
if (!off.ok || !off.eval) fail('default run failed', off.out);
if (off.eval.tabs.includes('localsend')) fail('tabs visible with features off: ' + off.eval.tabs);
console.log('MAIN TABS PASSED: on=[' + on.eval.tabs + '] default=[' + off.eval.tabs + ']');
