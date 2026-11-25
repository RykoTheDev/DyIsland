// File shelf: files and folders you park on the island and drag out later. Only the LIST is kept (paths, saved in the app's data folder);
// the files themselves stay where they are, so a moved or deleted file shows as `missing`. Paths only ever come from a drop or a picker in main.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function create({ store, dataDir, broadcast = () => {}, startDrag = () => {} }) {
  const cfg = () => store.get().shelf;
  const file = () => path.join(dataDir(), 'shelf.json');
  let items = [];
  try { const raw = JSON.parse(fs.readFileSync(file(), 'utf8')); if (Array.isArray(raw)) items = raw.filter((x) => x && typeof x.path === 'string' && path.isAbsolute(x.path)).map((x) => ({ id: String(x.id), name: String(x.name), path: x.path, size: Number(x.size) || 0, isDir: !!x.isDir, addedAt: Number(x.addedAt) || 0 })).slice(0, 40); } catch { /* nothing parked yet */ }

  const save = () => { try { fs.mkdirSync(dataDir(), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(items)); } catch { /* read-only disk: the shelf still works for this run */ } };
  const view = () => items.map((x) => ({ ...x, missing: !fs.existsSync(x.path) }));
  const push = () => { const v = view(); broadcast('shelf:list', v); return v; };

  function add(paths) {
    if (!cfg().enabled) return view();
    for (const p of Array.isArray(paths) ? paths : []) {
      if (typeof p !== 'string' || !path.isAbsolute(p) || items.some((x) => x.path.toLowerCase() === p.toLowerCase())) continue;
      let st; try { st = fs.statSync(p); } catch { continue; }
      items.unshift({ id: crypto.randomUUID(), name: path.basename(p) || p, path: p, size: st.isDirectory() ? 0 : st.size, isDir: st.isDirectory(), addedAt: Date.now() });
    }
    items = items.slice(0, cfg().max);
    save(); return push();
  }
  const remove = (id) => { items = items.filter((x) => x.id !== String(id)); save(); return push(); };
  const clear = () => { items = []; save(); return push(); };
  // the list shrinks to the new limit when the setting changes
  const sync = () => { if (items.length > cfg().max) { items = items.slice(0, cfg().max); save(); push(); } };
  function dragOut(sender, id) {
    const it = items.find((x) => x.id === String(id));
    if (!it || !fs.existsSync(it.path)) return false;
    try { startDrag(sender, it.path); return true; } catch { return false; }
  }
  return { list: view, add, remove, clear, sync, dragOut, push };
}

module.exports = { create };
