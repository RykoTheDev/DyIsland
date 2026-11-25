const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, net, globalShortcut, powerSaveBlocker, clipboard, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.setName('DyIsland');
app.setAppUserModelId('com.dyisland.app');

// Smoke-test mode (test/main-smoke.js): its own data folder (so its own single-instance lock), no windows shown, no autostart entry, no global
// shortcuts, and any uncaught error ends the process with a failure. Never set by the app itself.
const SMOKE = process.env.DYISLAND_SMOKE === '1' && !!process.env.DYISLAND_USERDATA;
if (SMOKE) { app.setPath('userData', process.env.DYISLAND_USERDATA); process.on('uncaughtException', (e) => { console.error('UNCAUGHT ' + (e && e.stack || e)); process.exit(3); }); }

const { getUsage } = require('./usage');
const { getLimits } = require('./limits');
const notify = require('./notify');
const { createSessions } = require('./sessions');
const { createApprovals } = require('./approvals');
const privacy = require('./privacy');
const { createStore, sanitize, DEFAULTS } = require('./settingsStore');
const updaterModule = require('./main/updater');
const { checkHooks } = require('./setupcheck');
const { computeVisibility } = require('./visibility');
const placement = require('./placement');
const dnsSwitch = require('./dns-switch');
const { execFile } = require('child_process');
let notifyServer = null;
const sessions = createSessions();                      // which Claude Code sessions are working (10 min timeout each)

// The island window is a FIXED size, big enough for the largest island (Settings caps the open size at 640x340) plus the
// notch ears and the spring overshoot. The island morphs inside it with CSS; we never resize the window while animating.
// (see placement.js: WIN_W 736 x WIN_H 376 at the top edge, 736 x 520 on the left/right edge)

// Settings window: a floating card under the island, with a 16px transparent margin around it for the shadow.
const SET_W = 496;
const SET_MARGIN = 16;
const SET_GAP = 8;

// One island window per chosen monitor. `win` is the lead island (the primary monitor's if it has one): legacy single-window code uses it.
let win, settings, tray, media, mediaRestarts = 0, settingsHiddenAt = 0, store, updater = null;
const islands = [];                                  // { win, display, lead, near, nearUntil, lastGaze }

// Only one DyIsland at a time (matters with autostart: launching it by hand must not stack a second island)
if (!app.requestSingleInstanceLock()) { app.exit(0); return; }   // stop NOW: a quit() would still let this copy start up and take over the hook port file

// Helper scripts are run by OTHER programs (PowerShell, node), which cannot read inside app.asar: the packager unpacks them (see package.json) and we point at the unpacked copy
const unpacked = (...p) => path.join(__dirname, ...p).replace(/app\.asar(?=[\\/])/, 'app.asar.unpacked');

// ---- hardening: our windows never navigate away or open new windows, and only OUR windows may call the IPC handlers
const rawHandle = ipcMain.handle.bind(ipcMain), rawOn = ipcMain.on.bind(ipcMain);
const isOurs = (e) => !!e && !!e.sender && (islands.some((i) => alive(i.win) && i.win.webContents === e.sender) || (alive(settings) && settings.webContents === e.sender));
ipcMain.handle = (ch, fn) => rawHandle(ch, (e, ...a) => (isOurs(e) ? fn(e, ...a) : null));
ipcMain.on = (ch, fn) => rawOn(ch, (e, ...a) => { if (isOurs(e)) fn(e, ...a); });
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (ev) => ev.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// ---- helpers shared by everything below
const run = (file, args, timeout = 4000) => new Promise((resolve) => { try { execFile(file, args, { windowsHide: true, timeout }, (err, stdout) => resolve({ ok: !err, out: String(stdout || '') })); } catch { resolve({ ok: false, out: '' }); } });
const alive = (w) => w && !w.isDestroyed();
const send = (w, channel, ...args) => { if (alive(w)) w.webContents.send(channel, ...args); };
const broadcast = (channel, ...args) => { for (const isl of islands) send(isl.win, channel, ...args); };     // to every island window
const islandOfSender = (sender) => islands.find((i) => alive(i.win) && i.win.webContents === sender);
const infoOf = (isl) => ({ edge: store.get().placement.edge, lead: !!isl.lead, index: islands.indexOf(isl), count: islands.length });

// Last 100 events DyIsland received, in ~/.dyisland/events.log. If Claude Code is not sending anything, this stays empty.
function logEvent(line) {
  try {
    const f = path.join(os.homedir(), '.dyisland', 'events.log');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    let prev = '';
    try { prev = fs.readFileSync(f, 'utf8'); } catch { /* first event */ }
    const lines = (prev + `${new Date().toISOString()} ${line}\n`).split('\n').filter(Boolean).slice(-100);
    fs.writeFileSync(f, lines.join('\n') + '\n');
  } catch { /* logging must never affect the island */ }
}

// One effective "do not disturb": your own switch, or (Settings > Alerts > Quiet during calls) the camera / microphone being in use.
// Derived, never written back, so the end of a call cannot clear a Do not disturb you turned on yourself.
const dndNow = () => { const c = store.get(); return !!c.quiet.dnd || (!!c.meetings.dnd && !!(privState.camera || privState.mic)); };

// ---- system helper (system.ps1): volume, keyboard-focus hand-back, Bluetooth connect toasts. One process for all three.
const sys = require('./main/system').create({
  unpacked, logEvent,
  bluetooth: true,
  onNotification: (n) => mirrorNotification(n),
  onVolume: (v) => broadcast('system:volume', v),
  onBluetooth: (e) => { if (e.state !== 'connected' || !store || !store.get().devices.toasts || dndNow()) return; logEvent('bluetooth connected: ' + e.name); broadcast('notice:show', { kind: 'done', tone: 'info', duration: 4, title: e.name, sub: 'Bluetooth connected' }); },
});

// A Windows notification from another app, shown on the island (Settings > Alerts, opt-in). Only app + title + text, kept for the length of the toast; never logged.
function mirrorNotification(n) {
  if (!store) return;
  const c = store.get().notifications;
  if (!c.mirror || dndNow()) return;
  const only = c.apps.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (only.length && !only.some((x) => n.app.toLowerCase().includes(x))) return;
  if (/^dyisland$/i.test(n.app)) return;
  if (!n.title && !n.body) return;
  logEvent('mirrored a Windows notification');
  broadcast('notice:show', { kind: 'done', tone: 'info', duration: 5, title: (n.app && n.title ? n.app + ': ' + n.title : n.title || n.app), sub: n.body || n.app });
}

// ---- windows
function createIsland(display) {
  const edge = store.get().placement.edge;
  const bounds = placement.windowBounds(display.bounds, edge);
  const w = new BrowserWindow({
    ...bounds,
    title: 'DyIsland',
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required', // timer chime
    },
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setIgnoreMouseEvents(true, { forward: true }); // click-through by default
  const isl = { win: w, display, lead: false, near: false, nearUntil: 0, lastGaze: '' };
  islands.push(isl);
  w.loadFile('index.html');
  w.once('ready-to-show', () => {
    try { w.setBounds(placement.windowBounds(isl.display.bounds, store.get().placement.edge)); } catch { /* ignore */ }   // again: a monitor with another DPI scale can size a new window wrongly
    if (windowShouldShow(isl)) w.showInactive();
  });
  w.webContents.on('did-finish-load', () => {
    lastWorking = ''; pushWorking();
    send(w, 'clipboard:list', clip.items()); send(w, 'approvals:state', approvals.list()); send(w, 'privacy:state', privState);
    send(w, 'window:info', infoOf(isl)); send(w, 'awake:state', blockerId !== null);
    { const mr = mediaReplay(); if (mr) send(w, 'media:update', mr); }
    { const lv = sys.last(); if (lv) send(w, 'system:volume', { ...lv, init: true }); }
    eventsMod.refresh();                                                                        // (a new window gets the list; cheap when no link is set)
    if (lastTimerState) send(w, 'timer:state', lastTimerState);                   // (the page settles a timer that already ran out quietly, see timers.js)
    applyWindowVisibility();
  });
  w.webContents.on('render-process-gone', (_e, d) => {      // the page died: hand the mouse back, drop open requests, load it again
    logEvent('island page gone: ' + (d && d.reason));
    try { w.setIgnoreMouseEvents(true, { forward: true }); } catch { /* ignore */ }
    approvals.askAll();
    setTimeout(() => { if (alive(w)) { try { w.webContents.reload(); } catch { /* ignore */ } } }, 1000);
  });
  w.on('unresponsive', () => {
    logEvent('island page not responding');
    try { w.setIgnoreMouseEvents(true, { forward: true }); } catch { /* ignore */ }
    setTimeout(() => { if (alive(w) && !w.webContents.isDestroyed()) { try { w.webContents.reload(); } catch { /* ignore */ } } }, 10000);
  });
  w.on('close', (ev) => { if (!app.isQuitting && !isl.destroying) ev.preventDefault(); });   // Alt+F4 must not remove the island
  w.on('closed', () => { const i = islands.indexOf(isl); if (i >= 0) islands.splice(i, 1); if (win === w) win = (islands.find((x) => x.lead) || islands[0] || {}).win; });
  return isl;
}
function destroyIsland(isl) {
  isl.destroying = true;
  const i = islands.indexOf(isl); if (i >= 0) islands.splice(i, 1);
  if (alive(isl.win)) { try { isl.win.destroy(); } catch { /* gone */ } }
}
// Make the set of island windows match Settings (edge + monitor) and the monitors that are plugged in right now.
function syncIslands() {
  if (!app.isReady() || !store) return;
  const cfg = store.get().placement;
  const want = placement.pickDisplays(screen.getAllDisplays(), screen.getPrimaryDisplay().id, cfg.monitor);
  if (!want.length) return;
  for (const isl of [...islands]) if (!want.some((d) => d.id === isl.display.id)) destroyIsland(isl);
  want.forEach((d, i) => {
    let isl = islands.find((x) => x.display.id === d.id);
    if (!isl) isl = createIsland(d);
    isl.display = d; isl.lead = i === 0;
    if (alive(isl.win)) {                                      // only touch the window when something moved (this runs on every settings change)
      try {
        const nb = placement.windowBounds(d.bounds, cfg.edge), cb = isl.win.getBounds();
        if (cb.x !== nb.x || cb.y !== nb.y || cb.width !== nb.width || cb.height !== nb.height) isl.win.setBounds(nb);
      } catch { /* ignore */ }
    }
  });
  islands.sort((a, b) => (b.lead ? 1 : 0) - (a.lead ? 1 : 0));
  win = (islands.find((x) => x.lead) || islands[0] || {}).win;
  for (const isl of islands) { const info = infoOf(isl), key = JSON.stringify(info); if (isl.infoKey !== key) { isl.infoKey = key; send(isl.win, 'window:info', info); } }
  if (alive(settings)) { const nb = settingsBounds(), cb = settings.getBounds(); if (cb.x !== nb.x || cb.y !== nb.y || cb.width !== nb.width || cb.height !== nb.height) settings.setBounds(nb); }
  applyWindowVisibility();
  const dkey = want.map((d) => d.id).join() + '|' + cfg.edge + '|' + screen.getAllDisplays().map((d) => d.id + ':' + d.bounds.x + ',' + d.bounds.y + ',' + d.bounds.width + ',' + d.bounds.height).join(';');
  if (dkey !== syncIslands.lastKey) { syncIslands.lastKey = dkey; send(settings, 'displays:changed'); }       // only when the monitors or the choice changed
}
ipcMain.handle('window:info', (e) => { const isl = islandOfSender(e.sender); return isl ? infoOf(isl) : { edge: 'top', lead: true, index: 0, count: 1 }; });
ipcMain.handle('displays:list', () => ({ monitors: placement.monitorLabels(screen.getAllDisplays(), screen.getPrimaryDisplay().id), active: islands.map((i) => String(i.display.id)) }));

// The settings card sits under the island at its OPEN height (top edge), or beside it past the settings button (left/right edge).
function settingsBounds() {
  const lead = (settingsAnchor && islands.includes(settingsAnchor) ? settingsAnchor : null) || islands.find((i) => i.lead) || islands[0];
  const d = lead ? lead.display : screen.getPrimaryDisplay();
  const cfg = store.get();
  const live = (lead && lead.liveOpen) || { w: 0, h: 0 };
  return placement.settingsBounds(d, cfg.placement.edge, Math.max(cfg.size.open.w, live.w), Math.max(cfg.size.open.h, live.h), { width: SET_W, margin: SET_MARGIN, gap: SET_GAP });
}

let dialogOpen = false;
function createSettings() {
  settings = new BrowserWindow({
    ...settingsBounds(),
    title: 'DyIsland settings',
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settings.setAlwaysOnTop(true, 'screen-saver');
  settings.loadFile('settings.html');
  settings.on('close', (ev) => { if (!app.isQuitting) { ev.preventDefault(); hideSettings(); } });   // Alt+F4 hides it (and tells the island), never destroys it
  settings.on('blur', () => { if (!dialogOpen) hideSettings(); });                 // click anywhere else and it goes away (not while a file dialog is open)
}

function hideSettings() {
  if (dialogOpen || !alive(settings) || !settings.isVisible()) return;                // never hide it under an open file dialog
  settings.hide();
  settingsHiddenAt = Date.now();
  broadcast('settings:state', false);
}
let settingsAnchor = null;                                      // the island whose gear opened the card: the card appears on ITS monitor and edge
function showSettings(anchor) {
  if (!anyIslandShown()) return;                              // never over a full-screen game (only islands on that monitor hide)
  settingsAnchor = anchor && islands.includes(anchor) ? anchor : null;
  if (!alive(settings)) createSettings();
  settings.setBounds(settingsBounds());
  settings.show();
  settings.moveTop();
  settings.focus();
  send(settings, 'settings:state', true);                     // replays the card's entrance animation
  send((settingsAnchor || islands.find((i) => i.lead) || islands[0] || {}).win, 'settings:state', true);   // only the island it belongs to is "settings open"
}
function toggleSettings(anchor) {
  if (alive(settings) && settings.isVisible()) return hideSettings();
  if (Date.now() - settingsHiddenAt < 250) return;            // the same click that just blurred (and hid) it
  showSettings(anchor);
}
// The island tells us how big its open size is for the page on screen; the settings card is placed from the larger of that and the saved size
ipcMain.on('island:size', (e, sz) => { const isl = islandOfSender(e.sender); if (!isl || !sz) return; const w = Math.round(Number(sz.w)), h = Math.round(Number(sz.h)); if (w >= 300 && w <= 700 && h >= 150 && h <= 400) { isl.liveOpen = { w, h }; if (alive(settings) && settings.isVisible()) settings.setBounds(settingsBounds()); } });
ipcMain.on('settings:toggle', (e) => toggleSettings(islandOfSender(e.sender)));
ipcMain.on('settings:close', hideSettings);

// ---- Settings store + live apply
ipcMain.handle('settings:get', () => store.get());
ipcMain.handle('settings:set', (_e, patch) => store.set(patch));
ipcMain.handle('settings:reset', () => store.reset());
ipcMain.handle('settings:defaults', () => JSON.parse(JSON.stringify(DEFAULTS)));       // for "reset this section"

// ---- Export / import: a plain JSON file of the settings (nothing secret is in it). Import is validated like any other change.
async function withDialog(fn) {
  dialogOpen = true;
  try { return await fn(); }
  catch (e) { return { ok: false, error: 'Something went wrong with that file' }; }
  finally { dialogOpen = false; if (alive(settings) && settings.isVisible()) settings.focus(); }
}
ipcMain.handle('settings:export', () => withDialog(async () => {
  const r = await dialog.showSaveDialog(settings, { title: 'Export DyIsland settings', defaultPath: path.join(app.getPath('documents'), 'dyisland-settings.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const out = JSON.parse(JSON.stringify(store.get())); if (out.events) out.events.url = '';
  if (out.google) { out.google.clientId = ''; out.google.clientSecret = ''; }          // the calendar link is a secret address: it never goes into a file you might share
  fs.writeFileSync(r.filePath, JSON.stringify(out, null, 2));
  return { ok: true, file: path.basename(r.filePath) };
}));
ipcMain.handle('settings:import', () => withDialog(async () => {
  const r = await dialog.showOpenDialog(settings, { title: 'Import DyIsland settings', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  const file = r.filePaths[0];
  if (fs.statSync(file).size > 200 * 1024) return { ok: false, error: 'That file is too big to be a settings file' };
  let raw; try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return { ok: false, error: 'That file is not valid JSON' }; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(DEFAULTS).some((k) => Object.prototype.hasOwnProperty.call(raw, k))) return { ok: false, error: 'That file does not look like DyIsland settings' };   // e.g. the wrong .json picked
  // An export leaves the calendar link and the Google client out (empty): importing it must not erase the ones you have
  if (raw.events && typeof raw.events === 'object' && !raw.events.url) delete raw.events.url;
  if (raw.google && typeof raw.google === 'object') { if (!raw.google.clientId) delete raw.google.clientId; if (!raw.google.clientSecret) delete raw.google.clientSecret; }
  store.set(raw);                                            // merged onto what you have, anything invalid falls back to its default
  return { ok: true, file: path.basename(file) };
}));

// ---- "Take me to Claude": click a toast, a session row or "Ask in terminal" and the window that session runs in comes to the front.
// A small persistent PowerShell helper (focus.ps1) walks up from the session's process to the terminal / editor / Claude app that owns a window.
let focusProc = null, focusBuf = '', focusSeq = 0;
const focusWait = new Map();                                      // request id -> resolve
function startFocusHelper() {
  if (focusProc) return focusProc;
  let p;
  try { p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', unpacked('focus.ps1'), '-OwnPid', String(process.pid)], { windowsHide: true }); } catch { return null; }
  focusProc = p;
  p.on('error', () => { if (focusProc === p) focusProc = null; });
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (chunk) => {
    focusBuf += chunk; let i;
    while ((i = focusBuf.indexOf('\n')) >= 0) {
      const line = focusBuf.slice(0, i).trim(); focusBuf = focusBuf.slice(i + 1);
      const m = /^(\d+) (OK|FLASH|FAIL) ?(.*)$/.exec(line);
      if (m && focusWait.has(m[1])) { const done = focusWait.get(m[1]); focusWait.delete(m[1]); done({ ok: m[2] !== 'FAIL', how: m[2].toLowerCase(), detail: m[3] }); continue; }
      const an = /^(\d+) ANCHOR (OK|NONE) (\d+)(?: (\d+))?$/.exec(line);                       // the answer to ANCHOR
      if (an && focusWait.has(an[1])) { const done = focusWait.get(an[1]); focusWait.delete(an[1]); done({ ok: an[2] === 'OK', how: an[2] === 'OK' ? 'anchor' : 'none', detail: an[3] + (an[4] ? ' ' + an[4] : '') }); }
    }
  });
  p.on('close', () => { if (focusProc === p) focusProc = null; for (const done of focusWait.values()) done({ ok: false, how: 'fail', detail: 'helper stopped' }); focusWait.clear(); });
  return p;
}
// Find (once per session, while the hook that reported it is still alive) the window the session runs in, and remember that window's process.
const needAnchor = (id) => { const i = sessionInfo.get(String(id)); return !!i && !i.anchor && (i.tries || 0) < 3; };
function anchorSession(a) {
  noteSession(a.id, a.pid, a.project);
  if (!needAnchor(a.id)) return null;
  const info = sessionInfo.get(String(a.id)); info.tries = (info.tries || 0) + 1;
  return focusRequest(a.pid, info.project, 'ANCHOR').then((r) => {
    const m = /^(\d+)(?: (\d+))?$/.exec(r.detail || '');
    if (r.how === 'anchor' && m) { info.anchor = Number(m[1]); info.top = Number(m[2] || 0); }
    else if (r.how === 'none' && m) info.top = Number(m[1]) || info.top || 0;
    logEvent('anchored session ' + String(a.id).slice(0, 8) + ' -> ' + (info.anchor ? 'window process found' : 'no window yet'));
  }).catch(() => {});
}
function focusRequest(pid, project, verb = 'FOCUS') {
  return new Promise((resolve) => {
    const p = startFocusHelper(); if (!p || !p.stdin.writable) return resolve({ ok: false, how: 'fail', detail: 'no helper' });
    const id = String(++focusSeq);
    const timer = setTimeout(() => { if (focusWait.delete(id)) resolve({ ok: false, how: 'fail', detail: 'timeout' }); }, 12000);   // the first request also waits for PowerShell to start
    focusWait.set(id, (r) => { clearTimeout(timer); resolve(r); });
    try { p.stdin.write(verb + ' ' + id + ' ' + pid + ' ' + String(project || '').replace(/[^\w .\-]/g, '').slice(0, 60) + '\n'); } catch { focusWait.delete(id); clearTimeout(timer); resolve({ ok: false, how: 'fail', detail: 'write failed' }); }
  });
}
ipcMain.handle('claude:focus', async (_e, session) => {
  const key = typeof session === 'string' ? session.slice(0, 128) : '';
  let info = key ? (sessionInfo.get(key) || [...sessionInfo.entries()].find(([k]) => k.startsWith(key))?.[1]) : null;   // the Claude tab passes the short 8-character id
  if (!info) info = [...sessionInfo.values()].sort((a, b) => b.at - a.at)[0];                                          // unknown session: the most recent one
  if (!info) return { ok: false, how: 'fail', detail: 'no session known' };
  const target = info.anchor || info.top || info.pid;                                    // the window's process found at the first event, else whatever we know
  const r = await focusRequest(target, info.project);
  logEvent('focus claude pid=' + target + ' -> ' + r.how + (r.detail ? ' (' + r.detail + ')' : ''));
  return r;
});

const eventsMod = require('./main/events').create({ ipcMain, store: { get: () => store.get() }, broadcast, logEvent });
const googleMod = require('./main/google').create({ app, safeStorage: require('electron').safeStorage, shell: require('electron').shell, net, store: { get: () => store.get() }, broadcast, logEvent, setExtraEvents: (l) => eventsMod.setExtra(l) });
ipcMain.handle('google:state', () => googleMod.state());
ipcMain.handle('google:connect', () => googleMod.connect());
ipcMain.handle('google:disconnect', () => googleMod.disconnect());
ipcMain.on('google:open', (_e, what) => { const u = { mail: 'https://mail.google.com/', calendar: 'https://calendar.google.com/', tasks: 'https://tasks.google.com/' }[what]; if (u) require('electron').shell.openExternal(u); });
const dns = require('./main/dns').create({ ipcMain, run, unpacked, logEvent });
const dnsStatus = dns.status;
require('./main/dnsp').create({ ipcMain, run, unpacked, logEvent, store: { get: () => store.get() } });

// ---- Setup check: is everything in place? (shown in Settings)
let lastClaudeEventAt = 0;
const claudeConfigDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
async function runSetupCheck() {
  const rows = [];
  const cfg = store.get();
  let claudeSettings = null;
  try { claudeSettings = JSON.parse(fs.readFileSync(path.join(claudeConfigDir(), 'settings.json'), 'utf8')); } catch (e) { claudeSettings = e && e.code === 'ENOENT' ? null : { __error: true }; }
  rows.push(...checkHooks(claudeSettings, { approvalsEnabled: cfg.approvals.enabled, exists: (p) => { try { if (/app\.asar(?![.\w])/i.test(String(p))) return false; /* inside the archive: plain node cannot run it */ const q = String(p).replace(/%([^%]+)%/g, (_m, v) => process.env[v] || _m).replace(/^(~|\$HOME)(?=[\\/])/, os.homedir()); return fs.existsSync(q); } catch { return false; } } }));
  const ago = lastClaudeEventAt ? Math.max(0, Math.round((Date.now() - lastClaudeEventAt) / 60000)) : -1;
  rows.push({ id: 'events', label: 'Events from Claude Code', state: ago >= 0 ? 'ok' : 'warn', detail: ago >= 0 ? (ago < 1 ? 'Heard from Claude Code just now' : 'Last heard from Claude Code ' + ago + ' min ago') : 'Nothing received since DyIsland started. Start a new Claude Code session after adding the hooks' });
  let listener = false; try { const n = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dyisland', 'notify.json'), 'utf8')); listener = Number.isInteger(n.port); } catch { /* not there */ }
  rows.push({ id: 'listener', label: 'Island listener', state: listener ? 'ok' : 'bad', detail: listener ? 'Listening on this PC for Claude Code and the dyisland command' : 'Not listening: Claude Code cannot reach the island' });
  const hk = hotkeyState, hs = hotkeyState.settings || { accelerator: '', ok: true };
  const keyRow = (id, label, k) => ({ id, label, state: !k.accelerator ? 'off' : k.ok ? 'ok' : 'bad', detail: !k.accelerator ? 'Off' : k.ok ? k.accelerator.replace(/\+/g, ' + ') : 'Another app is using ' + k.accelerator.replace(/\+/g, ' + ') });
  rows.push(keyRow('hotkey', 'Island shortcut', hk), keyRow('settingsKey', 'Settings shortcut', hs));
  rows.push({ id: 'privacy', label: 'Camera and microphone dot', state: !cfg.privacy.dot ? 'off' : privWatch ? 'ok' : 'warn', detail: !cfg.privacy.dot ? 'Off' : privWatch ? 'Watching ' + (privState.camera || privState.mic ? '(in use right now)' : '(nothing in use)') : 'Not running' });
  rows.push({ id: 'fullscreen', label: 'Full-screen detection', state: !cfg.hideInFullscreen ? 'off' : (fsProc && !fsProc.killed ? 'ok' : 'warn'), detail: !cfg.hideInFullscreen ? 'Off' : (fsProc && !fsProc.killed ? 'Watching every monitor' : 'Helper not running: the island simply stays visible') });
  { const d = await dnsStatus(); const word = { on: 'NextDNS is on', off: 'NextDNS is off (automatic DNS)', mixed: 'Some connections on, some off', custom: 'DNS was changed by hand', absent: 'The saved connection is not active right now' }[d.state];
    rows.push({ id: 'dns', label: 'NextDNS switch', state: d.state === 'notinstalled' || d.state === 'unsupported' ? 'off' : (d.state === 'on' || d.state === 'off') ? 'ok' : 'warn', detail: word ? 'Set up. ' + word : 'Not set up (optional): Settings > DNS' }); }
  rows.push({ id: 'autostart', label: 'Start with Windows', state: getAutostart() ? 'ok' : 'off', detail: getAutostart() ? 'On' : 'Off (turn it on from the tray menu)' });
  return rows;
}
ipcMain.handle('status:get', () => runSetupCheck());

function onSettingsChanged(s) {
  syncIslands();                                               // edge or monitor may have changed
  broadcast('settings:changed', s);
  send(settings, 'settings:changed', s);
  if (alive(settings)) settings.setBounds(settingsBounds());   // the open height moved
  syncHotkey(); syncClipboard(); syncPolling(); syncFullscreenWatch(); applyWindowVisibility(); syncApprovals(); syncPrivacy();
  sys.setFlags({ bluetooth: s.devices.toasts, notifications: s.notifications.mirror });
  eventsMod.sync(); googleMod.sync();
}

// ---- Start with Windows
// Packaged app: the exe registers itself. Dev run (npm start): register electron.exe with this folder as its argument.
const loginOpts = () => ({ name: 'DyIsland', ...(app.isPackaged ? {} : { path: process.execPath, args: [app.getAppPath()] }) });
const getAutostart = () => { try { return app.getLoginItemSettings(loginOpts()).openAtLogin; } catch { return false; } };
const setAutostart = (on) => { try { app.setLoginItemSettings({ ...loginOpts(), openAtLogin: !!on }); } catch { /* not supported here */ } };
function initAutostart() {
  // Turn it on once per build location (dev run vs packaged exe), recorded by executable path. Otherwise the tray
  // checkbox is the user's choice and is never overridden.
  const flag = path.join(app.getPath('userData'), 'autostart-initialized');
  let registeredFor = '';
  try { registeredFor = fs.readFileSync(flag, 'utf8'); } catch { /* first run */ }
  if (registeredFor === process.execPath) return;
  setAutostart(true);
  try { fs.writeFileSync(flag, process.execPath); } catch { /* retry next launch */ }
}

// ---- Full-screen apps: hide the whole window over them. FAIL OPEN: if the helper is missing, dead or unsure, the island stays visible.
let fsProc = null, fsActive = false, fsRestarts = 0, fsPoint = null;       // fsPoint: the top-left of the monitor the full-screen window is on, in screen pixels (null = unknown: the main monitor)
let pausedUntil = 0, pauseTimer = null;                        // "Pause the island for an hour" (runtime only, never saved)
const isPaused = () => Date.now() < pausedUntil;
// Full-screen is detected on the PRIMARY monitor only, so it hides only islands that live there.
// Is the full-screen window on this display? The helper reports pixels, displays are in DIPs: convert before comparing.
function fsOnDisplay(d) {
  if (!fsPoint) return d.id === screen.getPrimaryDisplay().id;
  try { const p = screen.screenToDipPoint(fsPoint); return Math.abs(p.x - d.bounds.x) <= 2 && Math.abs(p.y - d.bounds.y) <= 2; } catch { return d.id === screen.getPrimaryDisplay().id; }
}
const windowShouldShow = (isl) => computeVisibility({ hideInFullscreen: store.get().hideInFullscreen, fullscreen: fsActive && (!isl || fsOnDisplay(isl.display)), paused: isPaused() }).window && !SMOKE;
const anyIslandShown = () => islands.some((i) => windowShouldShow(i));
function pauseIsland(minutes) {
  const m = Math.max(1, Math.min(480, Math.round(Number(minutes)) || 60));
  pausedUntil = Date.now() + m * 60000;
  clearTimeout(pauseTimer); pauseTimer = setTimeout(resumeIsland, m * 60000 + 200);
  logEvent('island paused for ' + m + ' min');
  applyWindowVisibility(); syncApprovals(); buildTrayMenu();
}
function resumeIsland() {
  if (!pausedUntil) return;
  pausedUntil = 0; clearTimeout(pauseTimer); pauseTimer = null;
  logEvent('island resumed');
  for (const isl of islands) { if (alive(isl.win)) { try { isl.win.setIgnoreMouseEvents(true, { forward: true }); } catch { /* ignore */ } } }   // click-through again until the pointer is on the island
  applyWindowVisibility(); buildTrayMenu();
}
ipcMain.on('app:pause', (_e, minutes) => pauseIsland(minutes));
ipcMain.on('app:restart', () => { logEvent('restart requested'); app.relaunch(); app.quit(); });
ipcMain.on('app:quit', () => { logEvent('quit requested'); app.quit(); });
function applyWindowVisibility() {
  for (const isl of islands) {
    const w = isl.win; if (!alive(w)) continue;
    if (windowShouldShow(isl)) { if (!w.isVisible() && !w.webContents.isLoading()) w.showInactive(); }
    else if (w.isVisible()) { try { w.setIgnoreMouseEvents(true, { forward: true }); } catch { /* ignore */ } w.hide(); }
  }
  const home = (settingsAnchor && islands.includes(settingsAnchor) ? settingsAnchor : null) || islands.find((i) => i.lead) || islands[0];
  if (!home || !windowShouldShow(home)) hideSettings();                      // the card follows the island it belongs to
}
function setFullscreen(v, pt) {
  const key = (p) => (p ? p.x + ',' + p.y : '');
  if (fsActive === v && key(fsPoint) === key(v ? pt : null)) return;
  fsActive = v; fsPoint = v && pt ? pt : null;
  logEvent('fullscreen ' + (v ? 'ON: island hidden' : 'off: island shown'));
  applyWindowVisibility(); syncApprovals();
}
let fsBeat = 0;
function startFullscreenWatch() {
  if (fsProc) return;
  let p;
  try {
    p = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', unpacked('fullscreen.ps1'), '-OwnPid', String(process.pid)],
      { windowsHide: true });
  } catch { return; }
  fsProc = p; fsBeat = Date.now();
  // Every callback below belongs to THIS process. If it has been stopped or replaced, whatever it still says must change nothing:
  // a late "1" from a killed helper must not hide the island, and its exit must not orphan or restart a newer helper.
  const mine = () => p === fsProc;
  let buf = '';
  p.on('error', () => { if (!mine()) return; fsProc = null; setFullscreen(false); });
  p.stderr.setEncoding('utf8');
  p.stderr.on('data', (d) => { if (mine()) logEvent('fullscreen helper stderr: ' + String(d).slice(0, 200).replace(/\s+/g, ' ')); });
  p.stdout.setEncoding('utf8');
  p.stdout.on('data', (chunk) => {
    if (!mine()) return;
    fsRestarts = 0; fsBeat = Date.now();
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      let fm;
      if (line === '0') setFullscreen(false);
      else if (line === '1') setFullscreen(true);
      else if ((fm = /^1 (-?\d+) (-?\d+)$/.exec(line))) setFullscreen(true, { x: Number(fm[1]), y: Number(fm[2]) });
    }
  });
  p.on('close', () => {                                    // 'close' fires after the last stdout data, unlike 'exit'
    if (!mine()) return;                                   // stopped or replaced on purpose
    fsProc = null;
    setFullscreen(false);                                  // it died: fail open
    if (!app.isQuitting && store.get().hideInFullscreen && fsRestarts++ < 3) setTimeout(syncFullscreenWatch, 3000);   // re-reads the setting first
  });
}
function stopFullscreenWatch() { const p = fsProc; fsProc = null; if (p) { try { p.kill(); } catch { /* gone */ } } setFullscreen(false); }
function syncFullscreenWatch() { if (store.get().hideInFullscreen) startFullscreenWatch(); else stopFullscreenWatch(); }
// The helper repeats its state about every 10 s. 30 s of silence means it is hung: do not trust it, show the island, start fresh.
setInterval(() => {
  if (!fsProc || Date.now() - fsBeat < 30000) return;
  logEvent('fullscreen helper silent for 30 s: failing open and restarting it');
  stopFullscreenWatch();
  setTimeout(syncFullscreenWatch, 2000);
}, 5000);

// ---- Pointer watching: auto-hide needs to know when the pointer touches the top centre; the mascot wants to look at the pointer
const HOT_W = 240;                                         // the hot zone: this wide, centred on the docked edge, touching the very edge
let pollTimer = null;
function pollCursor() {
  const p = screen.getCursorScreenPoint();
  const edge = store.get().placement.edge;
  for (const isl of islands) {
    const b = isl.display.bounds;
    if (placement.nearDock(p, b, edge, HOT_W / 2)) {
      if (!isl.nearSince) isl.nearSince = Date.now();
      if (!isl.shared) isl.shared = placement.sharedEdge(isl.display, edge, screen.getAllDisplays());
      if (!isl.shared || Date.now() - isl.nearSince >= 250) isl.nearUntil = Date.now() + 700;   // lingers so a shaky pointer does not flicker it; a shared edge needs a pause (crossing to the next monitor must not pop it up)
    } else { isl.nearSince = 0; isl.shared = undefined; }
    const isNear = Date.now() < isl.nearUntil;
    if (isNear !== isl.near) { isl.near = isNear; send(isl.win, 'env:near', isNear); }
    if (isl.watching) {
      const dp = placement.dockPoint(b, edge);
      const nx = Math.round(Math.max(-1, Math.min(1, (p.x - dp.x) / 500)) * 20) / 20;
      const ny = Math.round(Math.max(-1, Math.min(1, (p.y - dp.y) / 300)) * 20) / 20;
      const key = nx + ',' + ny;
      if (key !== isl.lastGaze) { isl.lastGaze = key; send(isl.win, 'cursor:gaze', { nx, ny }); }
    }
  }
}
function syncPolling() {
  const need = store.get().autoHide || islands.some((i) => i.watching);
  if (need && !pollTimer) pollTimer = setInterval(pollCursor, 90);
  else if (!need && pollTimer) { clearInterval(pollTimer); pollTimer = null; for (const isl of islands) { if (isl.near) { isl.near = false; send(isl.win, 'env:near', false); } } }
}
ipcMain.on('mascot:watch', (e, on) => { const isl = islandOfSender(e.sender); if (!isl) return; isl.watching = !!on; if (!isl.watching) isl.lastGaze = ''; syncPolling(); });

// ---- Global hotkey (opens the island, or hides it again). register() can return false when another app owns the key.
let hotkeyState = { accelerator: '', ok: false };
let hotkeyWant = false;                                        // what the next press asks every island to do (open / close), so they cannot drift out of step
function syncHotkey() {
  const cfg = store.get(), want = cfg.hotkey, wantS = cfg.settingsHotkey;
  const attempt = want + '|' + wantS;
  if (attempt === hotkeyState.attempt) return;                 // same shortcuts as last time (working or not): do not drop, re-take and log on every slider tick
  try { globalShortcut.unregisterAll(); } catch { /* none registered */ }
  let ok = false, okS = false;
  if (want) {
    try { ok = globalShortcut.register(want, () => { if (isPaused()) return resumeIsland(); hotkeyWant = !hotkeyWant; for (const isl of islands) if (windowShouldShow(isl)) send(isl.win, 'hotkey:toggle', hotkeyWant); }); } catch { ok = false; }
  }
  if (wantS) {
    try { okS = globalShortcut.register(wantS, () => { if (isPaused()) resumeIsland(); toggleSettings(null); }); } catch { okS = false; }
  }
  hotkeyState = { accelerator: want, ok: !want || ok, settings: { accelerator: wantS, ok: !wantS || okS }, attempt };
  if (want && !ok) logEvent('hotkey ' + want + ' could not be registered (another app uses it?)');
  if (wantS && !okS) logEvent('settings hotkey ' + wantS + ' could not be registered (another app uses it?)');
  send(settings, 'hotkey:status', hotkeyState);
}
ipcMain.handle('hotkey:status', () => hotkeyState);

// ---- Keep the PC awake (runtime toggle, deliberately not saved: it always starts off)
let blockerId = null;
ipcMain.handle('awake:set', (_e, on) => {
  if (on && blockerId === null) blockerId = powerSaveBlocker.start('prevent-display-sleep');
  else if (!on && blockerId !== null) { powerSaveBlocker.stop(blockerId); blockerId = null; }
  broadcast('awake:state', blockerId !== null);
  return blockerId !== null;
});
ipcMain.handle('awake:get', () => blockerId !== null);
// The timer lives in each island's page: starting it on one monitor relays its state to the others
let lastTimerState = null;                                      // remembered so a new or rebuilt island window picks the timer up
ipcMain.on('timer:sync', (e, st) => { lastTimerState = st; for (const isl of islands) if (alive(isl.win) && isl.win.webContents !== e.sender) send(isl.win, 'timer:state', st); });

const clip = require('./main/clipboard').create({ ipcMain, store: { get: () => store.get() }, broadcast, dataDir: () => app.getPath('userData'), paste: () => sys.paste(!!islands.some((i) => alive(i.win) && i.win.isFocused())) });
const syncClipboard = clip.sync;

// ---- Permission requests from Claude Code (approve-hook.js): the island asks, you answer. Never answers by itself.
let apprCounts = new Map();
function syncApprovalSessions() {                         // keep each session's "needs approval" status in step with the open requests
  const nowC = new Map();
  for (const a of approvals.list()) { const e = nowC.get(a.session) || { n: 0, project: a.project }; e.n++; nowC.set(a.session, e); }
  for (const [id, e] of nowC) for (let i = (apprCounts.get(id) || { n: 0 }).n; i < e.n; i++) sessions.approval(id, true, e);
  for (const [id, e] of apprCounts) for (let i = (nowC.get(id) || { n: 0 }).n; i < e.n; i++) sessions.approval(id, false);
  apprCounts = nowC; pushWorking();
}
const approvals = createApprovals({
  waitMs: 30000,
  onChange: () => { broadcast('approvals:state', approvals.list()); syncApprovalSessions(); },
});
// ---- Camera / microphone in use: a dot on the island (reads the Windows privacy registry, never the device itself)
let privWatch = null, privState = { camera: false, mic: false };
function syncPrivacy() {
  const on = store.get().privacy.dot || store.get().meetings.dnd;                  // the call-aware Do not disturb needs the same watcher
  if (on && !privWatch) privWatch = privacy.watch((s) => { privState = s; broadcast('privacy:state', s); if (store.get().meetings.dnd) syncApprovals(); });
  else if (!on && privWatch) { privWatch.stop(); privWatch = null; privState = { camera: false, mic: false }; broadcast('privacy:state', privState); }
}
function syncApprovals() {
  const a = store.get().approvals;
  approvals.setWait(a.wait * 1000);
  if (!a.enabled || dndNow() || !anyIslandShown()) approvals.askAll();     // off, or the island is hidden behind a full-screen app: back to the terminal prompt
}
ipcMain.on('approve:answer', (_e, id, behavior) => { if (approvals.answer(id, behavior)) logEvent(`approval ${id}: ${behavior}`); });
ipcMain.handle('approve:list', () => approvals.list());
// Settings > Claude Code: copy the hooks block (with the right paths) so it can be pasted into ~/.claude/settings.json
ipcMain.handle('hooks:copy', async () => {
  const cmd = (f) => 'node "' + unpacked(f) + '"';
  const h = (f) => [{ hooks: [{ type: 'command', command: cmd(f) }] }];
  const hooks = {
    UserPromptSubmit: h('hook.js'), Stop: h('hook.js'), Notification: h('hook.js'), SessionEnd: h('hook.js'),
    PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('hook.js') }] }],
    PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: cmd('approve-hook.js'), timeout: 130 }] }],
  };
  try { await clipboard.writeText(JSON.stringify({ hooks }, null, 2)); return true; } catch { return false; }
});

// Settings > Apps > Coding agents: the lines to paste into another agent's own config (built here so they carry the real install paths)
const agentSetup = require('./main/agent-setup');
ipcMain.handle('agents:list', () => agentSetup.AGENTS.map((a) => ({ id: a.id, name: a.name, where: a.where, note: a.note })));
ipcMain.handle('agents:copy', async (_e, id) => {
  if (!agentSetup.AGENTS.some((a) => a.id === id)) return false;
  try { await clipboard.writeText(agentSetup.snippet(id, unpacked('agent-hook.js'), unpacked('dyisland.cmd'))); return true; } catch { return false; }
});

// ---- "Claude is working": session state lives here, the island just draws it
let lastWorking = '';
function pushWorking() {
  const st = sessions.state();                         // also drops sessions silent for 10 minutes
  const key = JSON.stringify(st);
  if (key === lastWorking) return;
  lastWorking = key;
  broadcast('working:state', st);
}
// Which process each Claude Code session runs under (for "take me to Claude"). Memory only, trimmed, never shown anywhere.
const sessionInfo = new Map();                                  // session id -> { pid, project, at }
function noteSession(id, pid, project) {
  if (!id || !Number.isInteger(pid) || pid < 5) return;
  const old = sessionInfo.get(String(id)) || {};
  sessionInfo.set(String(id), { ...old, pid, project: String(project || '').slice(0, 60), at: Date.now() });
  if (sessionInfo.size > 50) { const oldest = [...sessionInfo.entries()].sort((a, b) => a[1].at - b[1].at)[0]; sessionInfo.delete(oldest[0]); }
}
function onActivity(a) {
  noteSession(a.id, a.pid, a.project);
  lastClaudeEventAt = Date.now();
  if (a.type === 'start' || a.type === 'end' || a.type === 'gone') approvals.cancelSession(a.id);   // a new prompt or the end of a turn means any open request was settled elsewhere
  if (a.type === 'start') sessions.start(a.id, a);
  else if (a.type === 'touch') sessions.touch(a.id, a);
  else if (a.type === 'wait') sessions.wait(a.id, a);
  else if (a.type === 'end') sessions.end(a.id);
  else if (a.type === 'gone') sessions.end(a.id, { gone: true });
  pushWorking();
  const st = sessions.state();
  logEvent(`${a.type} session=${String(a.id).slice(0, 8)} -> working=${st.working} sessions=${st.count}`);
}

// ---- Mouse capture: island captures clicks, the rest of the window passes them through
ipcMain.on('island:capture', (e, capture) => {
  const isl = islandOfSender(e.sender); if (!isl) return;
  if (capture) isl.win.setIgnoreMouseEvents(false);
  else isl.win.setIgnoreMouseEvents(true, { forward: true });
});

// ---- Keyboard: the window is unfocusable, so focus it only while a text field is being edited
// The system helper tracks, all the time, the last window with the keyboard that is not ours. When the island lets go it asks for that window to get the
// focus back (the helper does nothing if you already went elsewhere). The window turns unfocusable again a moment later; a quick "on" after an "off" wins.
const inputTimers = new WeakMap();
ipcMain.on('island:input', (e, on) => {
  const isl = islandOfSender(e.sender); if (!isl) return;
  clearTimeout(inputTimers.get(isl.win));
  if (on) { isl.win.setFocusable(true); isl.win.focus(); }
  else {
    if (BrowserWindow.getFocusedWindow() === isl.win) sys.fgRestore();       // only if the island itself holds the focus: Settings is in this process too and must keep it
    inputTimers.set(isl.win, setTimeout(() => { if (alive(isl.win)) { try { isl.win.setFocusable(false); } catch { /* gone */ } } }, 160));
  }
});
ipcMain.on('volume:set', (_e, pct) => sys.setVolume(pct));
ipcMain.on('volume:mute', (_e, m) => sys.setMute(!!m));
// ---- App shortcuts (Home card): the list is in the settings (validated there); launching takes an INDEX into it, never a path from the page
const iconCache = new Map();
ipcMain.handle('apps:icons', async () => {
  const out = [];
  for (const a of store.get().shortcuts.apps) {
    let url = iconCache.get(a.path);
    if (!url) { try { url = (await app.getFileIcon(a.path, { size: 'normal' })).toDataURL(); } catch { url = ''; } if (url) iconCache.set(a.path, url); }
    out.push(url);
  }
  return out;
});
// Only programs chosen with the file picker (below) may launch: a path put into the settings some other way is listed but never started
const approvedFile = () => path.join(app.getPath('userData'), 'approved-apps.json');
const approvedApps = () => { try { const l = JSON.parse(fs.readFileSync(approvedFile(), 'utf8')); return Array.isArray(l) ? l.map((x) => String(x).toLowerCase()) : []; } catch { return []; } };
ipcMain.on('apps:open', (_e, i) => { const a = store.get().shortcuts.apps[Number(i)]; if (a && approvedApps().includes(a.path.toLowerCase())) shell.openPath(a.path).then((err) => { if (err) logEvent('could not open a shortcut: ' + String(err).slice(0, 80)); }); });
ipcMain.handle('apps:pick', () => withDialog(async () => {
  const r = await dialog.showOpenDialog(settings, { title: 'Pick a program or shortcut', properties: ['openFile'], filters: [{ name: 'Programs and shortcuts', extensions: ['exe', 'lnk', 'url', 'appref-ms'] }] });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  const cur = store.get().shortcuts.apps;
  try { fs.writeFileSync(approvedFile(), JSON.stringify([...new Set([...approvedApps(), r.filePaths[0].toLowerCase()])])); } catch { /* unwritable: it will be listed but not launch */ }
  const next = store.set({ shortcuts: { apps: [...cur, { name: path.basename(r.filePaths[0]).replace(/\.[^.]+$/, ''), path: r.filePaths[0] }] } });
  return { ok: next.shortcuts.apps.length > cur.length };
}));
// Quick tiles that open something on this PC. The page sends a NAME; what each name does is fixed here (nothing from the page reaches a command line).
const { shell } = require('electron');
ipcMain.on('quick:run', (_e, k) => {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  if (k === 'snip') shell.openExternal('ms-screenclip:');
  else if (k === 'night') shell.openExternal('ms-settings:nightlight');
  else if (k === 'calc') shell.openExternal('calculator:');
  else if (k === 'lock') execFile(path.join(ps, 'rundll32.exe'), ['user32.dll,LockWorkStation'], { windowsHide: true }, () => {});
});

// ---- Now playing: a persistent PowerShell helper talks to the Windows media session
// The log lives in the user's data folder: the install folder (Program Files, inside app.asar) is read-only, so a log there was silently lost
// The helper only prints when something changed, so a window that opens later (a new monitor, a reloaded page) needs the last state and the cover replayed
let lastMedia = null, lastArt = { key: '', art: '' };
function noteMedia(m) {
  if (!m || typeof m !== 'object') return;
  if (m.none) { lastMedia = null; lastArt = { key: '', art: '' }; return; }
  if (typeof m.art === 'string' && m.art) lastArt = { key: m.key, art: m.art };
  lastMedia = { ...m, art: undefined };
}
const mediaReplay = () => (lastMedia ? { ...lastMedia, ...(lastArt.key === lastMedia.key && lastArt.art ? { art: lastArt.art } : {}) } : null);
const mediaLogFile = () => path.join(os.homedir(), '.dyisland', 'media.log');
function startMedia() {
  try { fs.mkdirSync(path.dirname(mediaLogFile()), { recursive: true }); const lf = mediaLogFile(); if (fs.statSync(lf).size > 64 * 1024) fs.writeFileSync(lf, ''); } catch { /* no log yet */ }
  media = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', unpacked('media.ps1'), '-LogFile', mediaLogFile()],
    { windowsHide: true }
  );
  let buf = '';
  media.stdout.setEncoding('utf8');
  media.on('error', () => { restartMedia(); /* spawn failure: retried later; the rest of the app keeps working */ });
  media.stdin.on('error', () => { /* EPIPE while the helper exits */ });
  // PowerShell's own errors (e.g. a WinRT type that failed to load) go to media.log instead of disappearing
  let stderrChunks = 0;
  media.stderr.setEncoding('utf8');
  media.stderr.on('data', (d) => {
    if (stderrChunks++ >= 8) return;
    try { fs.appendFileSync(mediaLogFile(), `${new Date().toISOString()} stderr: ${String(d).slice(0, 600)}\n`); } catch { /* unwritable folder */ }
  });
  media.stdout.on('data', (chunk) => {
    mediaRestarts = 0;                                  // it is alive and talking
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { const m = JSON.parse(line); noteMedia(m); broadcast('media:update', m); } catch { /* ignore partial line */ }
    }
  });
  const restartMedia = () => {
    media = null;
    if (app.isQuitting) return;
    if (mediaRestarts++ < 3) setTimeout(startMedia, 2000);
    else setTimeout(() => { mediaRestarts = 0; startMedia(); }, 5 * 60 * 1000);       // after a few quick failures, try again every 5 minutes
  };
  media.on('exit', restartMedia);
}

ipcMain.on('media:cmd', (_e, cmd, arg) => {
  if (!media || !media.stdin.writable) return;
  const ok = ['toggle', 'play', 'pause', 'next', 'prev', 'seek', 'shuffle', 'repeat'];
  if (!ok.includes(cmd)) return;
  const n = cmd === 'seek' ? ' ' + Number(arg) : '';
  media.stdin.write(cmd + n + '\n');
});

require('./main/weather').register({ ipcMain, run, unpacked });

// ---- Usage: token totals from local Claude Code logs, limits (% left) via Claude Code's saved login
ipcMain.handle('usage:get', async () => {
  try { return await getUsage(); } catch { return { found: false }; }
});
ipcMain.handle('limits:get', async () => {
  try { return await getLimits(); } catch { return { ok: false, reason: 'unavailable' }; }
});

// 16x16 teal dot, drawn from raw pixels so there is no image file or hand-written PNG to get wrong
function trayIcon() {
  // the app icon (assets/icon.png ships inside the app); a plain teal dot if it cannot be read
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png'));
    if (!img.isEmpty()) return img.resize({ width: 32, height: 32, quality: 'best' });      // Windows scales 32 px down for 100% and keeps it sharp at 200%
  } catch { /* fall through */ }
  const s = 16, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    const a = d <= 6.5 ? 255 : d <= 7.5 ? Math.round(255 * (7.5 - d)) : 0;
    const i = (y * s + x) * 4, k = a / 255;                                 // premultiplied alpha
    buf[i] = Math.round(0xC9 * k); buf[i + 1] = Math.round(0xDB * k); buf[i + 2] = Math.round(0x53 * k); buf[i + 3] = a;   // BGRA of #53DBC9
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}

function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'DyIsland ' + app.getVersion(), enabled: false },
    { type: 'separator' },
    { label: 'Settings', click: () => { if (isPaused()) resumeIsland(); showSettings(null); } },
    isPaused()
      ? { label: 'Resume island', click: () => resumeIsland() }
      : { label: 'Pause island for 1 hour', click: () => pauseIsland(60) },
    { label: 'Start with Windows', type: 'checkbox', checked: getAutostart(), click: (item) => setAutostart(item.checked) },
    { type: 'separator' },
    ...(updater && updater.state().state === 'ready' ? [{ label: 'Install update and restart', click: () => updater.installNow() }] : [{ label: 'Check for updates', click: () => updater && updater.check().then(() => buildTrayMenu()) }]),
    { label: 'Restart DyIsland', click: () => { app.relaunch(); app.quit(); } },
    { label: 'Exit DyIsland', click: () => app.quit() },
  ]));
}
function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('DyIsland ' + app.getVersion());
  buildTrayMenu();
}

app.whenReady().then(() => {
  setTimeout(() => { try { startFocusHelper(); } catch { /* optional */ } }, 4000);           // warm up the window-finder so the first Claude event is not slowed by PowerShell starting
  const { powerMonitor } = require('electron');
  for (const ev of ['resume', 'unlock-screen']) powerMonitor.on(ev, () => { fsBeat = Date.now(); });   // the helper slept too: its silence is not a hang
  store = createStore(path.join(app.getPath('userData'), 'settings.json'));
  store.onChange(onSettingsChanged);
  if (!SMOKE) initAutostart();
  updater = updaterModule.create({ app, store, logEvent, notify: (n) => { broadcast('notice:show', n); buildTrayMenu(); } }); updater.start();
  syncIslands();
  createSettings();
  createTray();
  startMedia();
  sys.setFlags({ bluetooth: store.get().devices.toasts, notifications: store.get().notifications.mirror }); sys.start();
  eventsMod.sync(); googleMod.sync();
  // Claude Code hooks (hook.js) post here; each notice becomes a toast on the island
  notifyServer = notify.start({
    onNotice: (n) => { lastClaudeEventAt = Date.now(); if (dndNow()) { logEvent(`toast held back (do not disturb): ${n.title}`); return; } logEvent(`toast ${n.kind}: ${n.title}`); broadcast('notice:show', n); },
    onActivity,
    anchor: (a) => anchorSession(a),
    onApprove: (info, respond) => {
      lastClaudeEventAt = Date.now();
      anchorSession({ id: info.session, pid: info.pid, project: info.project });         // (the hook waits for the answer, so it is alive while this resolves)
      if (!store.get().approvals.enabled || dndNow() || !anyIslandShown()) return null;        // null: Claude Code shows its own prompt
      const id = approvals.add(info, respond);
      if (id != null) logEvent(`approval ${id} asked: ${info.tool} (${info.project})`);
      return id;
    },
    onApproveCancel: (id) => approvals.cancel(id),
  });
  setInterval(pushWorking, 5000);                       // lets timed-out sessions clear without any new event
  if (!SMOKE) syncHotkey();
  syncClipboard(); syncPolling(); syncFullscreenWatch(); syncApprovals(); syncPrivacy();
  if (SMOKE) {
    let loaded = 0;
    const done = () => { console.log('SMOKE-OK islands=' + islands.length + ' media=' + (media ? 'spawned' : 'none')); app.quit(); };
    for (const isl of islands) isl.win.webContents.once('did-finish-load', () => { if (++loaded >= islands.length) setTimeout(done, 3500); });
    setTimeout(() => { console.log('SMOKE-TIMEOUT'); app.exit(4); }, 25000);
  }
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, () => syncIslands());   // a monitor was plugged in, removed or changed
});

app.on('before-quit', () => {
  app.isQuitting = true;
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  if (notifyServer) notifyServer.stop();
  if (privWatch) privWatch.stop();
  if (fsProc) { try { fsProc.kill(); } catch { /* gone */ } }
  if (focusProc) { try { focusProc.kill(); } catch { /* gone */ } }
  sys.stop();
  if (media) { try { media.stdin.end(); media.kill(); } catch { /* already gone */ } }
  if (store) store.flush();
});
app.on('window-all-closed', () => app.quit());
