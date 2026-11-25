// Layout matrix: the island at its smallest and biggest open size, on every screen edge, with every motion mode. On each page it checks that nothing
// sticks out of the page area, and that the toast and the volume HUD stay inside the window. Screenshots go to test/.build/shots/matrix-*.png.
// Run with:  npm run test:ui   (part of it)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shots = path.join(__dirname, '.build', 'shots');
fs.mkdirSync(shots, { recursive: true });
app.disableHardwareAcceleration();
app.setPath('userData', path.join(__dirname, '.build', 'userdata-matrix'));
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONFIGS = [
  { name: 'top-min-calm', edge: 'top', w: 416, h: 232, motion: 'calm' },
  { name: 'top-max-exp', edge: 'top', w: 640, h: 340, motion: 'expressive' },
  { name: 'top-default-off', edge: 'top', w: 520, h: 264, motion: 'off' },
  { name: 'left-default-exp', edge: 'left', w: 520, h: 264, motion: 'expressive' },
  { name: 'right-min-exp', edge: 'right', w: 416, h: 232, motion: 'expressive' },
];
const PAGES = ['home', 'music', 'weather', 'timer', 'usage', 'clipboard'];

app.on('window-all-closed', () => { /* the next configuration opens a new window: do not quit between them */ });
app.whenReady().then(async () => {
  for (const c of CONFIGS) {
    const side = c.edge !== 'top';
    const w = new BrowserWindow({ x: -4000, y: 0, width: 736, height: side ? 520 : 376, show: true, frame: false, backgroundColor: '#202020', skipTaskbar: true, webPreferences: { backgroundThrottling: false } });
    const log = (m) => errors.push(`[${c.name}] ${m}`);
    w.webContents.on('console-message', (e) => { if (e.level === 'error' || e.level === 3) log('console: ' + e.message); });
    const ev = (code) => w.webContents.executeJavaScript(code);
    const shot = async (n) => { try { fs.writeFileSync(path.join(shots, `matrix-${c.name}-${n}.png`), (await w.webContents.capturePage()).toPNG()); } catch (e) { log('screenshot ' + n + ': ' + e.message); } };
    const patch = { motion: c.motion, size: { open: { w: c.w, h: c.h } }, hiddenTabs: [], clipboard: { enabled: true }, home: { first: 'events', second: 'music' } };
    for (let tries = 0; tries < 3; tries++) { try { await w.loadFile(path.join(root, 'index.html'), { search: `edge=${c.edge}&events=1&clip=1&art=square&working=1&s=${encodeURIComponent(JSON.stringify(patch))}` }); break; } catch (e) { if (tries === 2) throw e; await sleep(800); } }
    await sleep(700);
    await ev("document.querySelector('#wrap').dispatchEvent(new MouseEvent('click', { bubbles: true }))"); await sleep(900);
    for (const p of PAGES) {
      await ev(`document.querySelector('.nav [data-go="${p}"]').click()`); await sleep(c.motion === 'off' ? 300 : 800);
      // everything visible on the page must lie inside the page area (and the page area inside the island)
      const bad = await ev(`(() => {
        const pages = document.querySelector('.pages').getBoundingClientRect(), isl = document.querySelector('#island').getBoundingClientRect(), out = [];
        const pg = document.querySelector('.page.active');
        for (const el of pg.querySelectorAll('*')) {
          if (el.closest('[hidden]') || ['use', 'path', 'circle', 'rect', 'g', 'defs', 'symbol'].includes(el.localName)) continue;
          const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
          if (el.closest('.cal-grid, .u-spark, .spark') && !el.matches('.cal-grid, .spark')) continue;
          const t = 4;                                   // (the big clock and the city button overhang their box by 3-4 px by design; a cover under its slow zoom by 3)
          if (r.left < pages.left - t || r.right > pages.right + t || r.top < pages.top - t || r.bottom > pages.bottom + t) out.push((el.id ? '#' + el.id : el.localName + '.' + String(el.className).split(' ')[0]) + ' ' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + ' not in ' + [pages.left, pages.top, pages.right, pages.bottom].map(Math.round).join(','));
        }
        if (pages.left < isl.left || pages.right > isl.right || pages.bottom > isl.bottom) out.push('the page area is outside the island');
        return out.slice(0, 6);
      })()`);
      for (const b of bad) log(`page ${p}: ${b}`);
      if (['music', 'timer', 'clipboard', 'home'].includes(p)) await shot(p);
    }
    // the weather picker at this size
    await ev("document.querySelector('.nav [data-go=weather]').click()"); await sleep(500);
    await ev("document.querySelector('#w-city').click(); { const i = document.querySelector('#w-input'); i.value = 'Spring'; i.dispatchEvent(new Event('input', { bubbles: true })); }"); await sleep(600);
    const sugOk = await ev("(() => { const s = document.querySelector('#w-sug').getBoundingClientRect(), p = document.querySelector('.pages').getBoundingClientRect(); return s.height > 20 && s.bottom <= p.bottom + 2 && s.right <= p.right + 2; })()");
    if (!sugOk) log('the city suggestions do not fit in the weather page');
    await shot('weather-picker');
    await ev("document.querySelector('#w-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); await sleep(200);
    // close it, then a toast and the volume HUD must stay inside the window
    await ev("window.__hotkey(false)"); await sleep(c.motion === 'off' ? 300 : 900);
    await ev("window.__notice({ kind: 'attention', title: 'Claude needs you', sub: 'Claude needs your permission to use Bash', session: 's1' })"); await sleep(c.motion === 'off' ? 300 : 900);
    const inWin = (sel) => ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 100; })()`);
    if (!(await inWin('#wrap'))) log('the toast is not inside the window');
    await shot('toast');
    await sleep(8300);
    await ev("window.__volume({ pct: 30, init: true }); window.__volume({ pct: 62, mute: false })"); await sleep(c.motion === 'off' ? 300 : 700);
    if (!(await ev("document.querySelector('#wrap').dataset.hud === '1'"))) log('the volume HUD did not show');
    if (!(await inWin('#wrap'))) log('the volume HUD is not inside the window');
    await shot('hud');
    w.destroy(); await sleep(600);
  }
  console.log(errors.length ? 'UI MATRIX FAILED:\n  ' + errors.join('\n  ') : `UI MATRIX PASSED (${CONFIGS.length} configurations x ${PAGES.length} pages, toast and HUD)`);
  app.exit(errors.length ? 1 : 0);
});
setTimeout(() => { console.log('matrix test timed out'); app.exit(2); }, 240000);
