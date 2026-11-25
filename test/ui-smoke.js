// UI smoke test: loads the island page in a real (Electron) renderer with the browser preview bridge (bridge-mock.js, because
// there is no preload here), opens it, visits every tab, and fails on any console error or uncaught exception.
// Screenshots go to test/.build/shots/. Run with:  npm run test:ui   (needs Electron, so it is NOT part of `npm test`)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shots = path.join(__dirname, '.build', 'shots');
fs.mkdirSync(shots, { recursive: true });
app.disableHardwareAcceleration();
const userData = path.join(__dirname, '.build', 'userdata');
try { fs.rmSync(userData, { recursive: true, force: true }); } catch { /* first run */ }          // every run starts clean: saved page state (timers, city) must not leak between runs
app.setPath('userData', userData);

const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({ x: -4000, y: 0, width: 736, height: 376, show: true, frame: false, transparent: false, backgroundColor: '#202020', skipTaskbar: true, webPreferences: { backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { const lvl = e.level; if (lvl === 'error' || lvl === 3) errors.push('console: ' + e.message); });
  w.webContents.on('render-process-gone', (_e, d) => errors.push('renderer gone: ' + d.reason));
  const ev = (code) => w.webContents.executeJavaScript(code);
  const shot = async (name) => { try { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(shots, name + '.png'), img.toPNG()); } catch (e) { errors.push('screenshot ' + name + ': ' + e.message); } };
  const query = process.argv.find((a) => a.startsWith('--query=')) || '';
  await w.loadFile(path.join(root, 'index.html'), { search: query.slice(8) || 'art=square&events=1&dnsp=1&google=1&clip=1&s=' + encodeURIComponent(JSON.stringify({ hiddenTabs: [], clipboard: { enabled: true } })) });
  await sleep(700);
  const check = async (what, code, want = true) => { let got; try { got = await ev(code); } catch (e) { got = 'threw ' + e.message; } if (got !== want) errors.push(`${what}: expected ${want}, got ${got}`); };

  await check('island element exists', "!!document.querySelector('#wrap #island')");
  await shot('idle');
  await ev("document.querySelector('#wrap').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await sleep(700);
  await check('island opens on click', "document.querySelector('#wrap').classList.contains('open')");
  await shot('open-home');
  const tabs = await ev("[...document.querySelectorAll('.nav [data-go]')].map((b) => b.dataset.go)");
  for (const t of tabs) {
    await ev(`document.querySelector('.nav [data-go="${t}"]').click()`);
    await sleep(600);
    await check('tab ' + t + ' is active', `document.querySelector('#wrap').dataset.page === '${t}' && document.querySelector('#p-${t}').classList.contains('active')`);
    await shot('tab-' + t);
  }
  // the extra checks other steps register live in test/ui-checks.js (optional file, one `module.exports = async ({ ev, check, sleep, shot }) => {}`)
  try { const extra = require('./ui-checks.js'); await extra({ ev, check, sleep, shot, errors }); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') errors.push('ui-checks: ' + e.message); }
  console.log(errors.length ? 'UI SMOKE FAILED:\n  ' + errors.join('\n  ') : 'UI SMOKE PASSED (' + tabs.length + ' tabs, screenshots in test/.build/shots)');
  app.exit(errors.length ? 1 : 0);
});
setTimeout(() => { console.log('UI smoke test timed out'); app.exit(2); }, 240000);
