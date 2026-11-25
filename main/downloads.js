// Download progress: watches the Downloads folder for the partial files browsers write (.crdownload for Chrome/Edge/Brave, .part for Firefox,
// .opdownload for Opera, .download for Safari-like names) and reports how many bytes they hold. Browsers do not say how big the whole file will
// be, so there is no percentage, only bytes and growth. A download is "done" when the partial file turns into the real file.
const fs = require('fs');
const path = require('path');

const PARTIAL = /\.(crdownload|part|opdownload|download)$/i;
const DONE_KEEP_MS = 6000, STALL_MS = 30000;

function create({ dir, onList = () => {}, onDone = () => {}, intervalMs = 1000, now = Date.now }) {
  let timer = null;
  const live = new Map();                            // partial file name -> { id, name, bytes, grew }
  const finished = [];                               // { id, name, bytes, until }
  let seq = 0, last = '';

  function tick() {
    let names = []; try { names = fs.readdirSync(dir()); } catch { /* no Downloads folder */ }
    const t = now(), seen = new Set();
    for (const n of names) {
      if (!PARTIAL.test(n)) continue;
      let st; try { st = fs.statSync(path.join(dir(), n)); } catch { continue; }
      if (!st.isFile()) continue;
      seen.add(n);
      const cur = live.get(n), name = n.replace(PARTIAL, '');
      if (!cur) { if (t - st.mtimeMs < STALL_MS) live.set(n, { id: 'd' + (++seq), name, bytes: st.size, grew: t }); }   // an old leftover that is not growing is not a download
      else { if (st.size !== cur.bytes) cur.grew = t; cur.bytes = st.size; }
    }
    for (const [n, cur] of live) {
      if (seen.has(n)) { if (t - cur.grew > 10 * 60 * 1000) live.delete(n); continue; }              // 10 min without growth: give up on it
      live.delete(n);
      const real = path.join(dir(), cur.name);
      if (fs.existsSync(real)) { finished.push({ id: cur.id, name: cur.name, bytes: cur.bytes, until: t + DONE_KEEP_MS }); try { onDone({ name: cur.name }); } catch { /* ignore */ } }
    }
    while (finished.length && finished[0].until <= t) finished.shift();
    const v = view(), s = JSON.stringify(v);
    if (s !== last) { last = s; onList(v); }
  }
  const view = () => [
    ...[...live.values()].map((x) => ({ id: x.id, name: x.name, bytes: x.bytes, state: 'downloading' })),
    ...finished.map((x) => ({ id: x.id, name: x.name, bytes: x.bytes, state: 'done' })),
  ];
  return {
    start() { if (!timer) { timer = setInterval(tick, intervalMs); tick(); } },
    stop() { clearInterval(timer); timer = null; live.clear(); finished.length = 0; last = ''; onList([]); },
    list: view, _tick: tick,
  };
}

module.exports = { create, PARTIAL };
