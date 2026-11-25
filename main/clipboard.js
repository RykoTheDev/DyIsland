// Clipboard history (opt-in). Kept in memory and gone when you quit. Two opt-in extras change that, and each says so in Settings:
//   - "Remember images": copied pictures are kept (memory only, never written to disk) as a thumbnail plus the picture itself, 5 at most.
//   - "Keep pinned text between runs": pinned TEXT is saved in the app's data folder (pins.json). Nothing else ever is.
// Text is 2000 characters per item at most. Anything a password manager marks as sensitive is never recorded.
const { clipboard } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const L = require('./clip-list');

function create({ ipcMain, store, broadcast, dataDir, paste }) {
  let clipTimer = null, items = [], lastClip = '', seq = 0, pinsLoaded = false, lastImgAt = 0;
  const cfg = () => store.get().clipboard;
  // A short signature instead of keeping a copy of the whole clipboard around between polls
  const sigOf = (t) => { t = typeof t === 'string' ? t : ''; return 't:' + t.length + ':' + t.slice(0, 256) + t.slice(-64); };
  const pinsFile = () => path.join(dataDir(), 'pins.json');
  const send = () => broadcast('clipboard:list', L.view(items));

  // ---- pinned text on disk (only with "Keep pinned text between runs")
  function savePins() {
    try {
      if (!cfg().persistPins) return;
      fs.mkdirSync(path.dirname(pinsFile()), { recursive: true });
      fs.writeFileSync(pinsFile(), JSON.stringify(items.filter((x) => x.pinned && x.kind === 'text').map((x) => x.text)));
    } catch { /* read-only disk: pins still work for this run */ }
  }
  function loadPins() {
    if (pinsLoaded || !cfg().persistPins) return;
    pinsLoaded = true;
    try {
      const raw = JSON.parse(fs.readFileSync(pinsFile(), 'utf8'));
      if (Array.isArray(raw)) for (const t of raw.slice(0, L.MAX_PINS).reverse()) if (typeof t === 'string' && t) items = L.togglePin(L.add(items, { id: ++seq, kind: 'text', sig: sigOf(t.slice(0, 2000)), text: t.slice(0, 2000) }, cfg().max), seq, cfg().max);
    } catch { /* no pins saved yet */ }
  }
  function dropPinsFile() { pinsLoaded = false; try { fs.rmSync(pinsFile(), { force: true }); } catch { /* not there */ } }

  // In Electron 45 every clipboard call returns a Promise: it has to be awaited (a Promise is truthy and is not a string)
  async function clipIsSensitive() {
    // Windows password managers mark what they copy so clipboard managers skip it. Best effort: honour the marker if Electron can see it.
    try {
      for (const fmt of ['ExcludeClipboardContentFromMonitorProcessing', 'Clipboard Viewer Ignore']) if ((await clipboard.has(fmt)) === true) return true;
      return false;
    } catch { return false; }
  }
  const imageCount = () => items.filter((x) => x.kind === 'image').length;
  let busy = false;
  async function poll() {
    if (busy) return; busy = true;
    try {
      let t = '';
      try { t = await clipboard.readText(); } catch { return; }
      if (typeof t === 'string' && t) {                       // never let an odd clipboard value crash the main process
        const sig = sigOf(t);
        if (sig === lastClip) return;
        lastClip = sig;
        if (await clipIsSensitive()) return;
        if (!clipTimer) return;                                // switched off while we were reading
        const text = t.slice(0, 2000);
        items = L.add(items, { id: ++seq, kind: 'text', sig: sigOf(text), text }, cfg().max);
        send();
        return;
      }
      if (!cfg().images) return;
      if (lastClip.startsWith('i:') && Date.now() - lastImgAt < 4000) return;       // a picture that has not changed: do not decode it again every second
      lastImgAt = Date.now();
      let img; try { img = await clipboard.readImage(); } catch { return; }
      if (!img || img.isEmpty()) return;
      const { width, height } = img.getSize();
      if (!width || !height || width * height > 25e6) return;  // a huge picture is not worth holding on to
      const small = img.resize({ width: 24, height: 24 });
      const sig = 'i:' + width + 'x' + height + ':' + crypto.createHash('sha1').update(small.toBitmap()).digest('hex');
      if (sig === lastClip) return;
      lastClip = sig;
      if (await clipIsSensitive() || !clipTimer) return;
      const thumb = img.resize({ width: Math.min(192, width) }).toDataURL();
      items = L.add(items, { id: ++seq, kind: 'image', sig, thumb, image: img }, cfg().max);
      let n = imageCount();                                    // at most 5 pictures are held
      for (let i = items.length - 1; i >= 0 && n > 5; i--) if (items[i].kind === 'image' && !items[i].pinned) { items.splice(i, 1); n--; }
      send();
    } catch { /* never let a clipboard hiccup become an uncaught exception */ } finally { busy = false; }
  }
  function sync() {
    const c = cfg();
    if (c.enabled && !clipTimer) {
      lastClip = '';
      loadPins();
      clipTimer = setInterval(poll, 1000);
      Promise.resolve(clipboard.readText()).then((t) => { if (!lastClip) lastClip = sigOf(t); }).catch(() => {});   // what is already there is not recorded
      send();
    } else if (!c.enabled && clipTimer) { clearInterval(clipTimer); clipTimer = null; items = []; pinsLoaded = false; dropPinsFile(); send(); }          // history off: nothing of it stays on disk
    else if (c.enabled) {
      loadPins();
      const loose = items.filter((x) => !x.pinned).slice(0, c.max); items = [...items.filter((x) => x.pinned), ...loose];
      if (!c.images) items = items.filter((x) => x.kind !== 'image');
      send();
    }
    if (!c.persistPins && sync.hadPins) dropPinsFile();       // switching the option off removes what it saved
    sync.hadPins = !!c.persistPins;
  }

  async function copyItem(id) {
    const it = items.find((x) => x.id === Number(id));
    if (!it) return false;
    try {
      if (it.kind === 'image') await clipboard.writeImage(it.image); else await clipboard.writeText(it.text);
      lastClip = it.sig; items = L.touch(items, it.id); send(); return true;
    } catch { return false; }
  }
  ipcMain.handle('clipboard:list', () => L.view(items));
  ipcMain.handle('clipboard:copy', (_e, id) => copyItem(id));
  // Click-to-paste (opt-in): copy it, then send Ctrl+V to the window that has the keyboard
  ipcMain.handle('clipboard:paste', async (_e, id) => { if (!cfg().paste) return false; const ok = await copyItem(id); if (ok && paste) setTimeout(paste, 60); return ok; });
  ipcMain.handle('clipboard:pin', (_e, id) => { items = L.togglePin(items, Number(id), cfg().max); savePins(); send(); return true; });
  ipcMain.handle('clipboard:clear', () => { items = L.clearUnpinned(items); send(); return true; });   // pinned items stay: unpin them to remove them

  return { sync, items: () => L.view(items) };
}

module.exports = { create };
