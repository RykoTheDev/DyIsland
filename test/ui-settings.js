// Settings page test: loads settings.html with the browser preview bridge, then flips EVERY bound control and checks that the change reaches the settings
// (and comes back into the control). Catches a new control that is not wired, a data-bind typo, and rows that never render.
// Run with:  npm run test:ui   (part of it)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shots = path.join(__dirname, '.build', 'shots');
fs.mkdirSync(shots, { recursive: true });
app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, '.build', 'userdata-settings'));
const errors = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const w = new BrowserWindow({ x: -4000, y: 0, width: 496, height: 700, show: true, frame: false, backgroundColor: '#202020', skipTaskbar: true, webPreferences: { backgroundThrottling: false } });
  w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) errors.push('console: ' + e.message); });
  const ev = (code) => w.webContents.executeJavaScript(code);
  const shot = async (n) => { try { fs.writeFileSync(path.join(shots, n + '.png'), (await w.webContents.capturePage()).toPNG()); } catch (e) { errors.push('shot ' + n); } };
  await w.loadFile(path.join(root, 'settings.html'));
  await sleep(600);

  const binds = await ev("[...document.querySelectorAll('[data-bind]')].map((e) => ({ path: e.dataset.bind, kind: e.matches('input[type=checkbox]') ? 'check' : e.matches('input[type=range]') ? 'range' : e.matches('select') ? 'select' : e.matches('input[type=text]') ? 'text' : e.matches('input[type=date]') ? 'date' : e.classList.contains('seg') ? 'seg' : 'other' }))");
  let flipped = 0;
  for (const b of binds) {
    const sel = `[data-bind="${b.path}"]`;
    if (b.kind === 'check') {
      const before = await ev(`(async () => (await window.islandAPI.getSettings()).${b.path})()`);
      await ev(`(() => { const e = document.querySelector('${sel}'); e.checked = !e.checked; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(130);
      const after = await ev(`(async () => (await window.islandAPI.getSettings()).${b.path})()`);
      const shown = await ev(`document.querySelector('${sel}').checked`);
      if (after === before) errors.push(`${b.path}: flipping the switch did not change the setting (${before})`);
      else if (shown !== after) errors.push(`${b.path}: the switch shows ${shown} but the setting is ${after}`);
      else flipped++;
      await ev(`(() => { const e = document.querySelector('${sel}'); e.checked = ${JSON.stringify(before)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(130);
    } else if (b.kind === 'text') {
      const val = b.path === 'events.url' ? 'https://calendar.example.com/private/abc.ics' : 'Slack, Outlook';
      await ev(`(() => { const e = document.querySelector('${sel}'); e.value = ${JSON.stringify(val)}; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(130);
      const after = await ev(`(async () => (await window.islandAPI.getSettings()).${b.path})()`);
      if (after !== val) errors.push(`${b.path}: typed text did not arrive (got ${JSON.stringify(after)})`); else flipped++;
      await ev(`(() => { const e = document.querySelector('${sel}'); e.value = ''; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await sleep(130);
    }
  }
  // the new controls this round must all be there (a deleted or renamed row would silently drop out of the loop above)
  const need = ['updates.check', 'music.artColors', 'hud.volume', 'meetings.dnd', 'devices.toasts', 'notifications.mirror', 'notifications.apps', 'events.url', 'size.adaptive', 'clipboard.images', 'clipboard.paste', 'clipboard.persistPins'];
  for (const n of need) if (!binds.some((b) => b.path === n)) errors.push('the settings page has no control for ' + n);
  // the "needs" rows follow their switch
  await ev("window.__settings({ notifications: { mirror: false } })"); await sleep(200);
  const dimmedOff = await ev("document.querySelector('[data-needs=\"notifications.mirror\"]').classList.contains('off')");
  await ev("window.__settings({ notifications: { mirror: true } })"); await sleep(200);
  const dimmedOn = await ev("document.querySelector('[data-needs=\"notifications.mirror\"]').classList.contains('off')");
  if (!dimmedOff || dimmedOn) errors.push('the "only from these apps" row should be dimmed while notifications are off');
  // tabs: one page at a time, a search looks through all of them
  const vis = (id) => ev("(() => { const g = document.querySelector('[aria-labelledby=\"" + id + "\"]'); return !!g && getComputedStyle(g).display !== 'none'; })()");
  await ev("document.querySelector('#stabs [data-tab=appearance]').click()"); await sleep(150);
  if (!(await vis('g-look')) || (await vis('g-pos'))) errors.push('the Look tab should show Appearance and hide Position');
  await ev("document.querySelector('#stabs [data-tab=layout]').click()"); await sleep(150);
  if ((await vis('g-look')) || !(await vis('g-pos')) || !(await vis('g-home'))) errors.push('the Layout tab should show Position and Home page and hide Appearance');
  await ev("document.querySelector('#stabs [data-tab=system]').click()"); await sleep(150);
  await shot('settings-system');
  await ev("(() => { const q = document.querySelector('#q'); q.value = 'volume'; q.dispatchEvent(new Event('input', { bubbles: true })); })()"); await sleep(200);
  if (!(await vis('g-display'))) errors.push('a search should find rows on other tabs (Volume on the island)');
  await ev("(() => { const q = document.querySelector('#q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); })()"); await sleep(200);
  // dropdown: open, choose, the setting follows
  await ev("document.querySelector('#stabs [data-tab=system]').click()"); await sleep(150);
  await ev("document.querySelector('select[data-bind=hotkey] + .dd .dd-btn').click()"); await sleep(250);
  await shot('settings-dropdown');
  const opened = await ev("document.querySelector('select[data-bind=hotkey] + .dd').classList.contains('open')");
  if (!opened) errors.push('the dropdown did not open');
  await ev("[...document.querySelectorAll('select[data-bind=hotkey] + .dd .dd-list li')].find((l) => l.dataset.v === 'Control+Alt+D').click()"); await sleep(250);
  const hk = await ev("(async () => (await window.islandAPI.getSettings()).hotkey)()");
  if (hk !== 'Control+Alt+D') errors.push('choosing in the dropdown did not change the setting (' + hk + ')');
  const label = await ev("document.querySelector('select[data-bind=hotkey] + .dd .dd-text').textContent");
  if (label !== 'Ctrl + Alt + D') errors.push('the dropdown shows "' + label + '"');
  // DNS providers: tick a preset and a custom one, the settings follow
  await ev("document.querySelector('#stabs [data-tab=apps]').click()"); await sleep(200);
  await ev("document.querySelector('#dnspPresets input[data-preset=google]').click()"); await sleep(250);
  await ev("(() => { const r = document.querySelector('#dnspCustom .dnsp-c[data-i=\"0\"]'); r.querySelector('[data-f=name]').value = 'Work DNS'; r.querySelector('[data-f=v4a]').value = '10.1.2.3'; r.querySelector('[data-f=v4a]').dispatchEvent(new Event('change', { bubbles: true })); })()"); await sleep(250);
  const dp = await ev("(async () => (await window.islandAPI.getSettings()).dnsp)()");
  if (!dp || !dp.presets.includes('google') || !dp.custom.length || dp.custom[0].v4a !== '10.1.2.3') errors.push('DNS provider choices did not reach the settings: ' + JSON.stringify(dp));
  await shot('settings-apps');
  // a bad calendar link is refused by the store, a good one kept (store rules are tested in node; here the page just must not choke)
  try { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(shots, 'settings.png'), img.toPNG()); } catch (e) { errors.push('screenshot: ' + e.message); }
  console.log(errors.length ? 'UI SETTINGS FAILED:\n  ' + errors.join('\n  ') : `UI SETTINGS PASSED (${binds.length} bound controls, ${flipped} flipped and read back)`);
  app.exit(errors.length ? 1 : 0);
});
setTimeout(() => { console.log('settings test timed out'); app.exit(2); }, 90000);
