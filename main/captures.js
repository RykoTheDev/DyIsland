// Quick capture: holds the newest screenshots and screen recordings (Snipping Tool, Win+PrtScn, Xbox Game Bar save into Pictures\Screenshots
// and Videos\Captures) so they can be dragged straight out of the island. Only reads the folders; nothing is copied or uploaded.
// A file counts as new when it appears after the watcher started, and as ready once its size stopped changing between two looks.
const fs = require('fs');
const path = require('path');

const IMAGE = /\.(png|jpe?g|gif|bmp|webp)$/i, VIDEO = /\.(mp4|mkv|webm|mov|avi)$/i;
const MAX = 8;

function create({ dirs, thumb = () => '', onList = () => {}, onNew = () => {}, intervalMs = 1500 }) {
  let timer = null, started = 0, seq = 0;
  const known = new Map();                          // path -> { size, stable }
  let items = [];                                   // newest first
  const ids = new Map();

  const kindOf = (f) => (IMAGE.test(f) ? 'image' : VIDEO.test(f) ? 'video' : '');
  const view = () => items.filter((x) => fs.existsSync(x.path));
  function tick() {
    let changed = false;
    for (const dir of dirs()) {
      let names; try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        const kind = kindOf(n); if (!kind) continue;
        const p = path.join(dir, n);
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (!st.isFile()) continue;
        const k = known.get(p);
        if (!k) {
          known.set(p, { size: st.size, stable: st.mtimeMs < started - 2000 ? 2 : 0, fresh: st.mtimeMs >= started - 2000 });   // what was already there is not news
          continue;
        }
        if (k.stable >= 2) continue;
        if (st.size === k.size && st.size > 0) k.stable++; else { k.size = st.size; k.stable = 0; }
        if (k.stable >= 1 && k.fresh && !ids.has(p)) {
          const it = { id: String(++seq), kind, name: n, path: p, size: st.size, at: Date.now() };
          try { const t = kind === 'image' ? thumb(p) : ''; if (t) it.thumb = t; } catch { /* no preview */ }
          ids.set(p, it.id); items.unshift(it); items = items.slice(0, MAX); changed = true; k.stable = 2;
          try { onNew(it); } catch { /* a listener must not stop the watcher */ }
        }
      }
    }
    const before = items.length; items = view();
    if (changed || items.length !== before) onList(items);
  }
  return {
    start() { if (timer) return; started = Date.now(); known.clear(); timer = setInterval(tick, intervalMs); tick(); },
    stop() { clearInterval(timer); timer = null; items = []; ids.clear(); known.clear(); onList(items); },
    running: () => !!timer,
    list: () => view(),
    find: (id) => items.find((x) => x.id === String(id)),
    dismiss(id) { items = items.filter((x) => x.id !== String(id)); onList(items); return items; },
    _tick: tick, _setStarted: (t) => { started = t; },
  };
}

module.exports = { create };
