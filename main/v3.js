// DyIsland 3.0 features, wired to Electron: LocalSend, file shelf, drag detection, quick capture, download progress, network status,
// focus-mode sync, quick note, link tools, per-app volume and charger alerts. Every feature has its own module (tested without Electron);
// this file only connects them to the windows and the IPC channels listed in IPC_CONTRACT.md. Each one follows a setting and does nothing when it is off.
const path = require('path');

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function create({ app, ipcMain, store, broadcast, send, islands, alive, screen, shell, globalShortcut, nativeImage, net, logEvent, dndNow, unpacked, placement }) {
  const S = () => store.get();
  const userData = () => app.getPath('userData');
  const notice = (n) => { if (!dndNow()) broadcast('notice:show', { kind: 'done', tone: 'info', duration: 4, ...n }); };
  const iconFor = async (p) => { try { const i = await app.getFileIcon(p, { size: 'small' }); if (i && !i.isEmpty()) return i; } catch { /* fall through */ } return nativeImage.createFromDataURL('data:image/png;base64,' + PIXEL); };
  const startDrag = (sender, p) => { iconFor(p).then((icon) => { try { sender.startDrag({ file: p, icon }); } catch (e) { logEvent('drag out failed: ' + String(e && e.message).slice(0, 80)); } }); };
  const strArray = (v, n = 5000) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length < 1000).slice(0, n) : []);

  // ---- LocalSend
  const localsend = require('./localsend').create({
    store, dataDir: userData, defaultSaveDir: () => path.join(app.getPath('downloads'), 'LocalSend'), logEvent,
    onDevices: (l) => broadcast('localsend:devices', l),
    onProgress: (p) => broadcast('localsend:progress', p),
    onIncoming: (i) => broadcast(i.closed ? 'localsend:incoming-closed' : 'localsend:incoming', i.closed ? i.id : i),
    onReceived: (r) => broadcast('localsend:received', r),
  });
  ipcMain.handle('localsend:devices', () => localsend.devices());
  ipcMain.handle('localsend:send', (_e, deviceId, paths) => localsend.send(String(deviceId || ''), strArray(paths)));
  ipcMain.on('localsend:cancel', (_e, sid) => localsend.cancel(String(sid || '')));
  ipcMain.on('localsend:respond', (_e, id, accept) => localsend.respond(String(id || ''), accept === true));
  ipcMain.handle('localsend:status', () => localsend.status());
  ipcMain.on('localsend:open-folder', () => { shell.openPath(localsend.status().saveDir).catch(() => {}); });

  // ---- File shelf
  const shelf = require('./shelf').create({ store, dataDir: userData, broadcast, startDrag });
  ipcMain.handle('shelf:list', () => shelf.list());
  ipcMain.handle('shelf:add', (_e, paths) => shelf.add(strArray(paths, 200)));
  ipcMain.handle('shelf:remove', (_e, id) => shelf.remove(String(id || '')));
  ipcMain.handle('shelf:clear', () => shelf.clear());
  ipcMain.on('shelf:dragout', (e, id) => shelf.dragOut(e.sender, id));

  // ---- Quick capture (screenshots and recordings)
  const captures = require('./captures').create({
    dirs: () => [path.join(app.getPath('pictures'), 'Screenshots'), path.join(app.getPath('videos'), 'Captures')],
    thumb: (p) => { const i = nativeImage.createFromPath(p); return i.isEmpty() ? '' : i.resize({ width: 96 }).toDataURL(); },
    onList: (l) => broadcast('captures:list', l),
    onNew: (it) => broadcast('captures:new', it),
  });
  ipcMain.handle('captures:list', () => captures.list());
  ipcMain.on('captures:dragout', (e, id) => { const c = captures.find(id); if (c) startDrag(e.sender, c.path); });
  ipcMain.handle('captures:to-shelf', (_e, id) => { const c = captures.find(id); return shelf.add(c ? [c.path] : []); });
  ipcMain.handle('captures:dismiss', (_e, id) => captures.dismiss(id));

  // ---- Download progress
  const downloads = require('./downloads').create({
    dir: () => app.getPath('downloads'),
    onList: (l) => broadcast('downloads:update', l),
    onDone: (d) => notice({ title: d.name.slice(0, 60), sub: 'Download complete' }),
  });
  ipcMain.handle('downloads:list', () => downloads.list());

  // ---- Network / VPN
  const network = require('./network').create({
    store, onStatus: (s) => broadcast('network:status', s),
    onVpnChange: (s) => notice({ title: s.vpn ? 'VPN connected' : 'VPN disconnected', sub: s.vpn ? s.vpnName : 'Your traffic is not protected', tone: s.vpn ? 'info' : 'warn' }),
  });
  ipcMain.handle('network:status', () => network.status());

  // ---- Focus mode (Windows Do not disturb -> the island's)
  const focus = require('./focusmode').create({
    onChange: (on) => { if (S().quiet.dnd !== on) store.set({ quiet: { dnd: on } }); broadcast('focus:state', { system: on }); },
  });

  // ---- Quick note
  const notes = require('./notes');
  const notesFile = () => S().notes.file || path.join(app.getPath('documents'), 'DyIsland', 'notes.md');
  ipcMain.handle('note:add', (_e, text) => (S().notes.enabled ? notes.append(notesFile(), text) : { ok: false, error: 'Quick notes are off' }));
  ipcMain.on('note:open-file', () => { shell.openPath(notesFile()).catch(() => {}); });
  const notesKey = () => (S().notes.enabled ? S().notes.hotkey : '');
  function registerNotes() {
    const k = notesKey(); if (!k) return true;
    try { return globalShortcut.register(k, () => { for (const isl of islands()) if (alive(isl.win) && isl.win.isVisible()) send(isl.win, 'note:open'); }); } catch { return false; }
  }

  // ---- Link tools
  const urltools = require('./urltools');
  ipcMain.handle('url:open', async (_e, url) => { const u = urltools.cleanUrl(url); if (!S().urltools.enabled || !u) return { ok: false }; try { await shell.openExternal(u); return { ok: true }; } catch { return { ok: false }; } });
  ipcMain.handle('url:shorten', (_e, url) => (S().urltools.enabled && S().urltools.shorten ? urltools.shorten(url, (u, o) => net.fetch(u, o)) : { ok: false, error: 'Shortening is off' }));

  // ---- Per-app volume
  const mixer = require('./mixer').create({ unpacked, logEvent });
  ipcMain.handle('mixer:list', () => (S().mixer.enabled ? mixer.list() : []));
  ipcMain.handle('mixer:set', (_e, pid, volume, mute) => (S().mixer.enabled ? mixer.set(pid, volume, mute) : { ok: false }));

  // ---- Charger toasts (the battery percentage comes from the system helper)
  let lastAc = null;
  let lowShown = false;
  function onPower({ ac, pct }) {
    const lc = S().devices;
    if (lc.toasts && lc.battery && Number.isFinite(pct)) {
      if (!ac && pct <= lc.lowAt && !lowShown) { lowShown = true; notice({ title: 'Battery low', sub: pct + '% left. Plug in soon.', tone: 'warn' }); }
      if (ac || pct > lc.lowAt + 5) lowShown = false;
    }
    const was = lastAc; lastAc = ac;
    if (was === null || was === ac || !S().devices.toasts || !S().devices.charger) return;
    logEvent('charger ' + (ac ? 'plugged in' : 'unplugged'));
    notice({ title: ac ? 'Charger connected' : 'Charger unplugged', sub: ac ? 'Charging' : 'Running on battery' });
  }

  // ---- Drag detection: see dropwatch.js
  const dw = require('./dropwatch');
  let dragTimer = null, buttonDown = false;
  const dropWanted = () => S().drop.enabled && (S().localsend.enabled || S().shelf.enabled);
  const zoneOf = (isl) => dw.zone(isl.display.bounds, S().placement.edge, S().size.open.w, S().size.open.h);
  function setArmed(isl, on) {
    isl.dropArmed = on;
    if (!alive(isl.win)) return;
    try { if (on) isl.win.setIgnoreMouseEvents(false); else if (!isl.wantCapture) isl.win.setIgnoreMouseEvents(true, { forward: true }); } catch { /* window gone */ }
    send(isl.win, 'drop:armed', on);
  }
  function dragTick() {
    const p = screen.getCursorScreenPoint(), now = Date.now();
    for (const isl of islands()) {
      if (!isl.drop) isl.drop = dw.createMachine();
      const r = isl.drop.step(dw.inside(p, zoneOf(isl)), now);
      if (r === 'arm' && alive(isl.win) && isl.win.isVisible()) setArmed(isl, true);
      else if (r === 'arm') isl.drop.reset();
      else if (r === 'disarm') setArmed(isl, false);
    }
    if (!buttonDown && !islands().some((i) => i.drop && i.drop.isArmed())) { clearInterval(dragTimer); dragTimer = null; }
  }
  function onMouse(down) {
    if (!dropWanted()) return;
    buttonDown = down;
    const p = screen.getCursorScreenPoint(), now = Date.now();
    for (const isl of islands()) { if (!isl.drop) isl.drop = dw.createMachine(); isl.drop.button(down, dw.inside(p, zoneOf(isl)), now); }
    if (!dragTimer) dragTimer = setInterval(dragTick, 60);
  }
  function stopDrag() { clearInterval(dragTimer); dragTimer = null; buttonDown = false; for (const isl of islands()) if (isl.drop && isl.drop.reset()) setArmed(isl, false); }

  // ---- Everything follows the settings
  function sync() {
    const c = S();
    localsend.sync().catch((e) => logEvent('localsend: ' + String(e && e.message).slice(0, 80)));
    shelf.sync();
    if (c.captures.enabled) captures.start(); else if (captures.running()) captures.stop();
    if (c.downloads.enabled) downloads.start(); else downloads.stop();
    if (c.network.enabled) network.start(); else network.stop();
    if (c.focus.sync) focus.start(); else focus.stop();
    if (!c.mixer.enabled) mixer.stop();
    if (!dropWanted()) stopDrag();
  }
  const sysFlags = () => ({ power: S().devices.toasts && (S().devices.charger || S().devices.battery), mouse: dropWanted() });

  return {
    sync, sysFlags, onPower, onMouse, notesKey, registerNotes,
    stop() { localsend.stop(); captures.stop(); downloads.stop(); network.stop(); focus.stop(); mixer.stop(); stopDrag(); },
    _parts: { localsend, shelf, captures, downloads, network, focus },
  };
}

module.exports = { create };
