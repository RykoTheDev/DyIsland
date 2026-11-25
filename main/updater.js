// Self-update from GitHub Releases (electron-updater). Only the installed build (NSIS setup) can update itself: the portable zip and a dev run
// ("npm start") report "not available". The installer is per-machine, so Windows asks for administrator approval when an update is installed.
function create({ app, store, logEvent, notify }) {
  let updater = null, state = { state: 'idle', version: '' };
  const set = (s) => { state = { ...state, ...s }; };
  function load() {
    if (updater) return updater;
    if (!app.isPackaged || process.env.DYISLAND_SMOKE === '1') return null;                 // a dev run has no update feed
    try {
      ({ autoUpdater: updater } = require('electron-updater'));
      updater.autoDownload = true;                                                          // downloads quietly; nothing installs until you quit or restart
      updater.autoInstallOnAppQuit = true;
      updater.logger = { info: (m) => logEvent('update: ' + m), warn: (m) => logEvent('update warn: ' + m), error: (m) => logEvent('update error: ' + m), debug() {} };
      updater.on('update-available', (i) => set({ state: 'downloading', version: i && i.version || '' }));
      updater.on('update-not-available', () => set({ state: 'current' }));
      updater.on('error', () => set({ state: 'error' }));
      updater.on('update-downloaded', (i) => {
        set({ state: 'ready', version: i && i.version || state.version });
        notify({ kind: 'done', tone: 'info', duration: 8, title: 'Update ready', sub: 'DyIsland ' + state.version + ' installs when you quit it' });
      });
    } catch (e) { logEvent('updater unavailable: ' + (e && e.message)); updater = null; }
    return updater;
  }
  async function check() {
    if (!store.get().updates.check) return state;
    const u = load(); if (!u) { set({ state: 'unavailable' }); return state; }
    set({ state: 'checking' });
    try { await u.checkForUpdates(); } catch { set({ state: 'error' }); }
    return state;
  }
  function start() {
    setTimeout(check, 45 * 1000);                                                           // not during startup
    setInterval(check, 6 * 3600 * 1000);
  }
  return { start, check, state: () => state, installNow: () => { if (updater && state.state === 'ready') { logEvent('installing the update now'); updater.quitAndInstall(false, true); return true; } return false; } };
}

module.exports = { create };
