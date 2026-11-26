// A click on a mirrored Windows notification on the island. Windows lets a listener read a toast's text and which app sent it, but not
// what the toast does when clicked (its launch arguments stay with the app), so the island opens the app that sent it instead.
// Snipping Tool is the special case: its "screenshot" toast is about a file DyIsland can find, so the newest screenshot opens in Snipping Tool.
// The renderer only ever sends back a notice id; the app id is the one WE read from Windows, and it is checked before it reaches explorer.exe.
const fs = require('fs');
const path = require('path');

// AppUserModelIDs: packaged ("Microsoft.ScreenSketch_8wekyb3d8bbwe!App"), desktop ("com.squirrel.Discord.Discord") or a known-folder path
// ("{1AC14E77-...}\WindowsPowerShell\v1.0\powershell.exe"). No quotes, no spaces at the ends, no "..", nothing explorer could read as a switch.
function aumidOk(id) {
  return typeof id === 'string' && id.length >= 3 && id.length <= 200 && /^[A-Za-z0-9{][A-Za-z0-9._!{}\\ -]*$/.test(id) && !id.includes('..') && id.trim() === id;
}
// Windows' own senders (security, Bluetooth pairing, AutoPlay, updates) are not apps in shell:AppsFolder: explorer would just open a folder window
const isSystemSender = (id) => /^Windows\./i.test(id || '');
const isSnippingTool = (id) => /^Microsoft\.ScreenSketch_[a-z0-9]+!App$/i.test(id || '');

// The newest image in the Screenshots folder, if it was written around the time of the toast (Snipping Tool can be set not to save,
// and then the newest file there is an old one: opening that would be wrong)
// Of those, the one written closest to the toast (two quick captures each open their own), leaning to files written just before it.
function newestShot(dir, at, beforeMs = 30000, afterMs = 10000) {
  let best = null;
  let names = []; try { names = fs.readdirSync(dir); } catch { return null; }
  for (const n of names) {
    if (!/\.(png|jpe?g|gif|bmp|webp)$/i.test(n)) continue;
    const p = path.join(dir, n);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (!st.isFile()) continue;
    const d = st.mtimeMs - at;
    if (d < -beforeMs || d > afterMs) continue;
    if (!best || Math.abs(d) < Math.abs(best.d)) best = { p, d };
  }
  return best ? best.p : null;
}

function create({ shell, execFile, screenshotsDir, logEvent = () => {}, now = () => Date.now(), max = 20 }) {
  const map = new Map();                                    // notice id -> { aumid, at }
  let seq = 0;
  function remember(aumid) {
    if (!aumidOk(aumid) || isSystemSender(aumid)) return '';
    const id = 'n' + (++seq);
    map.set(id, { aumid, at: now() });
    while (map.size > max) map.delete(map.keys().next().value);
    return id;
  }
  const launch = (aumid) => execFile('explorer.exe', ['shell:AppsFolder\\' + aumid], { windowsHide: true }, () => { /* explorer exits 1 even when it worked */ });
  async function open(id) {
    const n = map.get(String(id || ''));
    if (!n) return false;
    if (isSnippingTool(n.aumid)) {
      const shot = newestShot(screenshotsDir(), n.at);
      if (shot) {
        try { await shell.openExternal('ms-screensketch:edit?source=DyIsland&isTemporary=false&filePath=' + encodeURIComponent(shot)); logEvent('opened a screenshot from a notification'); return true; }
        catch { const err = await shell.openPath(shot); if (!err) return true; }       // no Snipping Tool protocol: the default image viewer (and if that fails too, the app)
      }
    }
    launch(n.aumid); logEvent('opened the app of a notification');
    return true;
  }
  return { remember, open, _map: map };
}

module.exports = { create, aumidOk, isSnippingTool, isSystemSender, newestShot };
