// Main-process smoke test: starts the real app (main.js) the way `npm start` does, but isolated (see SMOKE in main.js): temp data folder,
// temp home (so the hook port file and logs are not the real ones), hidden windows. Passes when every island page loads and nothing throws.
// Run with:  npm run test:main   (needs Electron; not part of `npm test`)
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dyisland-smoke-'));
const electron = require('electron');                                  // (the path of electron.exe)
const r = spawnSync(electron, [root], { cwd: root, encoding: 'utf8', timeout: 60000, env: { ...process.env, DYISLAND_SMOKE: '1', DYISLAND_USERDATA: path.join(tmp, 'userdata'), USERPROFILE: tmp, HOME: tmp } });
const out = String(r.stdout || '') + String(r.stderr || '');
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temp folder */ }
const ok = /SMOKE-OK/.test(out) && !/UNCAUGHT|SMOKE-TIMEOUT/.test(out) && r.status === 0;
console.log(ok ? 'MAIN SMOKE PASSED: ' + (out.match(/SMOKE-OK.*/) || [''])[0] : 'MAIN SMOKE FAILED (exit ' + r.status + '):\n' + out.split('\n').slice(-25).join('\n'));
process.exit(ok ? 0 : 1);
