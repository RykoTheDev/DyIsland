// DyIsland 3.0 features, renderer side: LocalSend, the file shelf, capture / download / link chips, quick note, network and mixer pages.
// Talks to the main process only through window.islandAPI (see IPC_CONTRACT.md) and to app.js only through window.DyHost.
// Every call into the API is guarded: a missing channel (older main, plain-browser preview) just leaves that feature quiet.
(() => {
  const api = window.islandAPI, H = window.DyHost;
  if (!api || !H) return;
  const $ = (s, r = document) => r.querySelector(s);
  const wrap = H.wrap;
  const call = (name, ...a) => { try { return typeof api[name] === 'function' ? Promise.resolve(api[name](...a)) : Promise.resolve(undefined); } catch (e) { return Promise.resolve(undefined); } };
  const on = (name, cb) => { try { if (typeof api[name] === 'function') api[name](cb); } catch (e) { /* feature stays quiet */ } };
  const S = () => H.settings();
  const flag = (k, sub, dflt) => { const o = S()[k]; return o && o[sub] !== undefined ? !!o[sub] : dflt; };
  const lsOn = () => flag('localsend', 'enabled', false);
  const shelfOn = () => flag('shelf', 'enabled', true);
  const bytes = (n) => { n = Number(n) || 0; return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB' : (n / 1073741824).toFixed(1) + ' GB'; };
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const icon = (id, size = 20) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'i'); s.setAttribute('width', size); s.setAttribute('height', size); s.setAttribute('aria-hidden', 'true'); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', id); s.append(u); return s; };
  const hasFiles = (e) => !!(e.dataTransfer && e.dataTransfer.types && [...e.dataTransfer.types].includes('Files'));
  const pathsOf = (dt) => [...((dt && dt.files) || [])].map((f) => { try { return api.pathForFile ? api.pathForFile(f) : ''; } catch (e) { return ''; } }).filter(Boolean);

  // ================================================================ the feature chip (capture, download, link, note, focus)
  // One chip under the island. A short-lived message (ms) shows on top of a sticky one (a download in progress) and gives it back afterwards.
  const fc = { root: $('#fchip'), icon: $('#fc-icon'), title: $('#fc-title'), sub: $('#fc-sub'), actions: $('#fc-actions'), bar: $('#fc-bar') };
  let fcTemp = null, fcSticky = null, fcTimer = 0, fcHide = 0;
  function fcRender(o) {
    clearTimeout(fcHide);
    if (!o) { fc.root.classList.remove('on'); fcHide = setTimeout(() => { if (!fc.root.classList.contains('on')) { fc.root.hidden = true; fc.root.dataset.kind = ''; } }, 400); return; }
    fc.root.hidden = false; fc.root.dataset.kind = o.kind || ''; fc.root.dataset.tone = o.tone || '';
    fc.icon.setAttribute('href', o.icon || '#i-check');
    fc.title.textContent = o.title || ''; fc.sub.textContent = o.sub || ''; fc.sub.hidden = !o.sub;
    fc.actions.replaceChildren(...(o.actions || []).map((a) => {
      const b = el('button', 'fc-btn sl'); b.type = 'button'; if (a.icon) b.append(icon(a.icon, 16)); b.append(el('span', '', a.label)); b.title = a.title || a.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); a.run(); if (a.close !== false) fcClose(); }); return b;
    }));
    fc.bar.parentElement.hidden = o.progress == null;
    fc.bar.parentElement.classList.toggle('ind', o.progress === 'ind');
    fc.bar.style.width = typeof o.progress === 'number' ? Math.round(Math.max(0, Math.min(1, o.progress)) * 100) + '%' : '';
    fc.root.draggable = !!o.drag; fc.root.classList.toggle('drag', !!o.drag); fc.root._drag = o.drag || null;
    void fc.root.offsetWidth; fc.root.classList.add('on');
  }
  function fcShowNow() { fcRender(fcTemp || fcSticky); }
  function fcFlash(o, ms) {                                                       // a message for ms milliseconds
    if (H.dnd && H.dnd()) return;
    fcTemp = o; clearTimeout(fcTimer); fcShowNow();
    fcTimer = setTimeout(() => { fcTemp = null; fcShowNow(); }, ms || 5000);
  }
  function fcClose() { clearTimeout(fcTimer); fcTemp = null; fcShowNow(); }
  fc.root.addEventListener('dragstart', (e) => { if (fc.root._drag) { e.preventDefault(); fc.root._drag(); } });
  fc.root.addEventListener('mouseenter', () => clearTimeout(fcTimer));
  fc.root.addEventListener('mouseleave', () => { if (fcTemp) { clearTimeout(fcTimer); fcTimer = setTimeout(() => { fcTemp = null; fcShowNow(); }, 2500); } });
  fc.root.addEventListener('click', (e) => { if (!e.target.closest('.fc-btn') && fcTemp && !fcTemp.drag) fcClose(); });

  // ================================================================ LocalSend
  const ls = { devices: [], xfers: new Map(), incoming: [], seq: 0 };
  const lsEl = { page: $('#p-localsend'), title: $('#ls-title'), count: $('#ls-count'), devs: $('#ls-devs'), empty: $('#ls-empty'), xfers: $('#ls-xfers'), card: $('#ls-in'), t: $('#ls-in-t'), s: $('#ls-in-s') };
  const DEV_ICON = { mobile: '#i-phone', desktop: '#i-desktop', web: '#i-web', headless: '#i-laptop', server: '#i-laptop' };
  const cleanName = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').slice(0, 60);

  // The Share page: device tiles on top (LocalSend), transfers, the shelf as the park area at the bottom. What shows follows the two switches.
  function layoutShare() {
    const ls_ = lsOn(), sh_ = shelfOn(), n = ls.devices.length;
    lsEl.page.dataset.ls = ls_ ? '1' : '0'; lsEl.page.dataset.shelf = sh_ ? '1' : '0'; lsEl.page.dataset.tiles = ls_ && n ? '1' : '0';
    lsEl.title.textContent = ls_ ? 'Share' : 'Shelf';
    lsEl.devs.style.setProperty('--cols', String(n <= 4 ? Math.max(1, n) : n <= 6 ? 3 : 4));
    lsEl.devs.dataset.n = String(n);
    lsEl.devs.dataset.cols = lsEl.devs.style.getPropertyValue('--cols');
  }
  let devSig = '';
  function renderDevices() {
    const list = ls.devices;
    const sig = JSON.stringify(list.map((d) => [d.id, d.alias, d.deviceModel, d.deviceType]));
    if (sig === devSig && lsEl.devs.children.length === list.length) { layoutShare(); return; }      // same devices: keep the tiles (a rebuild would drop the drag highlight)
    devSig = sig;
    lsEl.count.textContent = list.length ? plural(list.length, 'device') + ' nearby' : 'Looking for devices';
    const chips = list.map((d) => {
      const b = el('button', 'ls-dev sl'); b.type = 'button'; b.dataset.id = d.id;
      b.append(icon(DEV_ICON[d.deviceType] || '#i-laptop', 36));
      const t = el('span', 'ls-dev-t'); t.append(el('span', 'ls-dev-a', cleanName(d.alias) || 'Unknown'), el('span', 'ls-dev-m', cleanName(d.deviceModel || d.deviceType || '')));
      b.append(t); b.setAttribute('aria-label', 'Send to ' + cleanName(d.alias)); b.title = 'Drop files here to send them to ' + (cleanName(d.alias) || 'this device'); return b;
    });
    lsEl.devs.replaceChildren(...chips);
    lsEl.empty.hidden = list.length > 0;
    layoutShare();
  }
  // compact tiles (icon and text in a row) once the area is short: a transfer card is showing, or the island is small
  try { new ResizeObserver(() => { const h = lsEl.devs.clientHeight; if (h > 0) { if (h < 104) lsEl.devs.dataset.compact = '1'; else delete lsEl.devs.dataset.compact; } }).observe(lsEl.devs); } catch (e) { /* no ResizeObserver */ }
  function setDevices(list) { ls.devices = (Array.isArray(list) ? list : []).filter((d) => d && typeof d.id === 'string').slice(0, 24); renderDevices(); }

  const STATE_TEXT = { waiting: 'Waiting for them to accept', sending: 'Sending', done: 'Sent', declined: 'Declined', error: 'Failed', receiving: 'Receiving' };
  const aliasOf = (id) => { const d = ls.devices.find((x) => x.id === id); return d ? cleanName(d.alias) : 'device'; };
  function upsertXfer(key, patch) {
    let x = ls.xfers.get(key);
    if (!x) { x = { key, state: 'waiting', sent: 0, total: 0, shown: 0, dir: 'out', alias: '', at: Date.now() }; ls.xfers.set(key, x); }
    Object.assign(x, patch);
    if (ls.xfers.size > 6) { const first = [...ls.xfers.values()].find((v) => !isActive(v)); if (first) ls.xfers.delete(first.key); }
    renderXfers(); startLoop(); return x;
  }
  const isActive = (x) => x.state === 'waiting' || x.state === 'sending' || x.state === 'receiving';
  function renderXfers() {
    const rows = [...ls.xfers.values()].sort((a, b) => b.at - a.at).slice(0, 3).map((x) => {
      let row = lsEl.xfers.querySelector('[data-key="' + CSS.escape(x.key) + '"]');
      if (!row) {
        row = el('div', 'ls-x'); row.dataset.key = x.key;
        const tile = el('span', 'ls-x-tile'); tile.append(icon('#i-send', 18));
        const txt = el('span', 'ls-x-text'); txt.append(el('span', 'title-medium ls-x-t'), el('span', 'label-medium ls-x-s'));
        const cv = el('canvas', 'ls-x-cv'); cv.setAttribute('aria-hidden', 'true');
        const btn = el('button', 'ls-x-btn sl'); btn.type = 'button'; btn.append(icon('#i-cancel', 16));
        btn.addEventListener('click', () => {
          if (isActive(x)) { if (x.sid) api.localsendCancel && api.localsendCancel(x.sid); x.state = 'error'; x.err = 'Cancelled'; x.cancelled = true; }
          else ls.xfers.delete(x.key);
          renderXfers();
        });
        row.append(tile, txt, cv, btn);
      }
      row.dataset.state = x.state;
      row.querySelector('.ls-x-t').textContent = (x.dir === 'in' ? 'From ' : 'To ') + (x.alias || 'device');
      const pct = x.total > 0 ? Math.round((x.sent / x.total) * 100) : 0;
      row.querySelector('.ls-x-s').textContent = x.cancelled ? 'Cancelled' : x.state === 'error' && x.err ? x.err : x.state === 'sending' || x.state === 'receiving' ? STATE_TEXT[x.state] + ' ' + pct + '%  ' + bytes(x.sent) + ' of ' + bytes(x.total) : x.state === 'done' && x.total ? 'Sent ' + bytes(x.total) : STATE_TEXT[x.state] || x.state;
      const b = row.querySelector('.ls-x-btn'); b.setAttribute('aria-label', isActive(x) ? 'Cancel' : 'Dismiss'); b.title = isActive(x) ? 'Cancel' : 'Dismiss';
      row.querySelector('.ls-x-tile use').setAttribute('href', x.state === 'done' ? '#i-check' : x.state === 'declined' || x.state === 'error' ? '#i-warn' : x.dir === 'in' ? '#i-download' : '#i-send');
      return row;
    });
    const cur = [...lsEl.xfers.children];                                          // touch the DOM only when the set or order changed: re-inserting a row restarts its entry animation and blanks the bar
    if (cur.length !== rows.length || rows.some((r, i) => r !== cur[i])) lsEl.xfers.replaceChildren(...rows);
    lsEl.xfers.hidden = rows.length === 0;
    wrap.dataset.xfer = rows.length ? '1' : '';
    lsEl.page.dataset.xfer = rows.length ? '1' : '';
  }

  // wavy progress on each transfer card
  let raf = 0, last = 0, phase = 0;
  const col = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  function drawXfers(t) {
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016; last = t; phase += dt * 5;
    const reduce = document.documentElement.dataset.motion === 'off';
    let live = false;
    for (const row of lsEl.xfers.children) {
      const x = ls.xfers.get(row.dataset.key); const cv = row.querySelector('canvas'); if (!x || !cv) continue;
      const r = cv.getBoundingClientRect(); if (!r.width) continue;
      const dpr = window.devicePixelRatio || 1, w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      const target = x.state === 'done' ? 1 : x.total > 0 ? x.sent / x.total : (x.state === 'waiting' ? 0.06 : 0);
      x.shown += (target - x.shown) * (reduce ? 1 : 0.18);                       // eases toward the real value instead of jumping
      const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, r.width, r.height);
      const bad = x.state === 'error' || x.state === 'declined';
      if (bad) continue;                                                           // a failed or declined transfer shows no bar (the leftover cap read as a stray dot)
      const moving = x.state === 'sending' || x.state === 'receiving' || x.state === 'waiting';
      window.DyWavy.line(g, r.width, r.height, { frac: x.state === 'waiting' ? 0.06 + 0.04 * Math.sin(phase / 2) : x.shown, amp: moving && !reduce ? 3 : 0, phase: reduce ? 0 : phase, thickness: 4, wavelength: 16,
        color: col(bad ? '--md-sys-color-error' : '--md-sys-color-primary'), track: col('--md-sys-color-outline-variant') });
      if (moving) live = true;
    }
    raf = 0;
    if (live || lsEl.xfers.children.length) { if (H.isOpen() && H.page() === 'localsend') raf = requestAnimationFrame(drawXfers); else last = 0; }
  }
  function startLoop() { if (!raf && H.isOpen() && H.page() === 'localsend' && window.DyWavy) raf = requestAnimationFrame(drawXfers); }

  async function sendTo(deviceId, paths) {
    if (!paths.length) return;
    const tmp = 'tmp:' + (++ls.seq);
    const x = upsertXfer(tmp, { deviceId, alias: aliasOf(deviceId), state: 'waiting', sent: 0, total: 0, shown: 0, dir: 'out', at: Date.now() });
    H.go('localsend');
    const r = await call('localsendSend', deviceId, paths);
    if (!r || r.ok === false) { upsertXfer(x.sid || tmp, { state: 'error', err: (r && r.error) || 'Could not send' }); return; }
    if (r.sessionId && !x.sid) {                                                   // the real id: the progress events from here on use it
      if (ls.xfers.has(r.sessionId)) { ls.xfers.delete(tmp); } else { ls.xfers.delete(tmp); x.key = r.sessionId; x.sid = r.sessionId; ls.xfers.set(r.sessionId, x); }
      renderXfers();
    }
  }
  on('onLocalsendProgress', (p) => {
    if (!p || typeof p.sessionId !== 'string') return;
    let key = p.sessionId;
    if (!ls.xfers.has(key)) { const tmp = [...ls.xfers.values()].find((v) => !v.sid && v.deviceId === p.deviceId && v.dir === 'out'); if (tmp) { ls.xfers.delete(tmp.key); tmp.key = key; tmp.sid = key; ls.xfers.set(key, tmp); } }
    const old = ls.xfers.get(key);
    if (old && old.cancelled) return;
    upsertXfer(key, { sid: key, deviceId: p.deviceId, alias: (old && old.alias) || aliasOf(p.deviceId), dir: 'out', sent: Number(p.sentBytes) || 0, total: Number(p.totalBytes) || 0,
      state: ['waiting', 'sending', 'done', 'declined', 'error'].includes(p.state) ? p.state : 'sending', err: p.state === 'error' ? cleanName(p.error) || 'Failed' : '' });
    if (p.state === 'done') { const k = key; setTimeout(() => { const v = ls.xfers.get(k); if (v && v.state === 'done') { ls.xfers.delete(k); renderXfers(); } }, 7000); }
  });
  on('onLocalsendReceived', (p) => {
    if (!p || typeof p.id !== 'string') return;
    const key = 'in:' + p.id;
    upsertXfer(key, { dir: 'in', alias: cleanName(p.alias), sent: Number(p.receivedBytes) || 0, total: Number(p.totalBytes) || 0, state: p.state === 'done' ? 'done' : p.state === 'error' ? 'error' : 'receiving', err: p.state === 'error' ? 'Failed' : '' });
    if (p.state === 'done') setTimeout(() => { const v = ls.xfers.get(key); if (v && v.state === 'done') { ls.xfers.delete(key); renderXfers(); } }, 7000);
  });

  // a drop on a device tile sends to it; a drop anywhere else on the page parks the files on the shelf (nothing happens when the shelf is off)
  function parkFiles(paths) {
    if (!paths.length || !shelfOn()) return;
    call('shelfAdd', paths).then((l) => { if (Array.isArray(l)) renderShelf(l); });
    fcFlash({ kind: 'shelf', icon: '#i-shelf', title: 'Parked on the shelf', sub: plural(paths.length, 'item') }, 3000);
  }

  // incoming transfer card
  function renderIncoming() {
    const n = ls.incoming[0];
    lsEl.card.hidden = !n; wrap.dataset.incoming = n ? '1' : '';
    if (!n) return;
    const names = n.files.map((f) => cleanName(f.name));
    const total = n.files.reduce((a, f) => a + (Number(f.size) || 0), 0);
    lsEl.t.textContent = n.alias + ' wants to send ' + (n.files.length === 1 ? names[0] : plural(n.files.length, 'file'));
    lsEl.s.textContent = bytes(total) + (n.files.length > 1 ? ' - ' + names.slice(0, 2).join(', ') + (n.files.length > 2 ? ' and more' : '') : '') + (ls.incoming.length > 1 ? '  (+' + (ls.incoming.length - 1) + ' more)' : '');
    lsEl.card.classList.remove('pop'); void lsEl.card.offsetWidth; lsEl.card.classList.add('pop');
  }
  on('onLocalsendIncoming', (m) => {
    if (!m || typeof m.id !== 'string') return;
    if (m.closed) { ls.incoming = ls.incoming.filter((n) => n.id !== m.id); renderIncoming(); if (!ls.incoming.length) H.settle(); return; }   // the sender gave up, or the request timed out
    ls.incoming.push({ id: m.id, alias: cleanName(m.alias) || 'Someone', files: (Array.isArray(m.files) ? m.files : []).slice(0, 200).filter((f) => f && typeof f.name === 'string') });
    if (ls.incoming.length > 5) ls.incoming.shift();
    renderIncoming();
    if (H.dnd && H.dnd()) return;                                                  // do not disturb: the card waits on the Send tab
    const asked = ls.incoming[ls.incoming.length - 1];
    if (lsOn()) { H.go('localsend'); H.pin(true); H.open(); H.update(); }
    else H.pushNotice({ kind: 'attention', icon: '#i-download', title: asked.alias + ' wants to send files', sub: plural(asked.files.length, 'file') });
  });
  function answer(accept) {
    const n = ls.incoming.shift(); if (!n) return;
    call('localsendRespond', n.id, !!accept); renderIncoming();
    if (!ls.incoming.length) H.settle();
  }
  $('#ls-in-yes').addEventListener('click', () => answer(true));
  $('#ls-in-no').addEventListener('click', () => answer(false));

  // ================================================================ file shelf
  const sh = { items: [] };
  const shEl = { list: $('#sh-list'), count: $('#sh-count'), clear: $('#sh-clear'), zone: $('#sh-zone'), hint: $('#sh-hint') };
  function renderShelf(list) {
    sh.items = (Array.isArray(list) ? list : []).filter((x) => x && x.id != null && typeof x.name === 'string').slice(0, 40);
    const max = (S().shelf && S().shelf.max) || 12;
    shEl.count.textContent = sh.items.length ? sh.items.length + ' / ' + max : '';
    shEl.clear.hidden = !sh.items.length;
    shEl.zone.dataset.n = String(sh.items.length);
    shEl.hint.textContent = shEl.zone.classList.contains('over') ? 'Release to park' : sh.items.length ? 'Park more' : 'Drop here to park';
    shEl.list.replaceChildren(...sh.items.map((x, i) => {
      const row = el('div', 'sh-row'); row.draggable = !x.missing; row.dataset.id = String(x.id); row.style.setProperty('--n', String(i));
      if (x.missing) row.classList.add('missing');
      row.title = x.missing ? 'The file is gone from its folder' : 'Drag it out to drop it somewhere else';
      const t = el('span', 'sh-tile'); t.append(icon(x.isDir ? '#i-folder' : '#i-file', 18));
      const txt = el('span', 'sh-text'); txt.append(el('span', 'sh-name', cleanName(x.name)), el('span', 'label-medium sh-size', x.missing ? 'Missing' : x.isDir ? 'Folder' : bytes(x.size)));
      const rm = el('button', 'sh-rm sl'); rm.type = 'button'; rm.dataset.rm = String(x.id); rm.setAttribute('aria-label', 'Remove ' + cleanName(x.name)); rm.title = 'Remove from the shelf'; rm.append(icon('#i-cancel', 14));
      row.append(t, txt, rm); return row;
    }));
    shEl.list.hidden = !sh.items.length;
  }
  shEl.list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.sh-row'); if (!row) return;
    e.preventDefault();                                                           // main starts the real file drag
    api.shelfDragOut && api.shelfDragOut(isNaN(Number(row.dataset.id)) ? row.dataset.id : Number(row.dataset.id));
  });
  shEl.list.addEventListener('click', (e) => { const b = e.target.closest('.sh-rm'); if (b) call('shelfRemove', isNaN(Number(b.dataset.rm)) ? b.dataset.rm : Number(b.dataset.rm)).then((l) => { if (Array.isArray(l)) renderShelf(l); }); });
  shEl.clear.addEventListener('click', () => call('shelfClear').then((l) => renderShelf(Array.isArray(l) ? l : [])));
  on('onShelf', renderShelf);

  // ================================================================ drag and drop onto the island
  // main raises drop:armed when a drag comes near; only a drag that carries files (dragenter) turns the drop UI on
  let armed = false, active = false, offT = 0;
  function activate() {
    if (active) return;
    const page = lsOn() || shelfOn() ? 'localsend' : '';
    if (!page || flag('drop', 'enabled', true) === false) return;
    clearTimeout(offT); active = true; wrap.dataset.drop = '1';
    H.go(page); H.pin(true); H.open(); api.capture && api.capture(true); H.update();
  }
  function clearOver() { document.querySelectorAll('.ls-dev.over, .sh-zone.over').forEach((n) => n.classList.remove('over')); shEl.hint.textContent = sh.items.length ? 'Park more' : 'Drop here to park'; }
  function deactivate() {
    clearTimeout(offT);
    offT = setTimeout(() => {
      if (!active && !wrap.dataset.drop) return;
      active = false; delete wrap.dataset.drop;
      clearOver();
      H.pin(false); H.settle();
    }, 350);
  }
  on('onDropArmed', (v) => { armed = !!v; if (!armed) deactivate(); });
  document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); activate(); } });
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    clearTimeout(offT); activate();
    const chip = e.target.closest && e.target.closest('.ls-dev');
    document.querySelectorAll('.ls-dev.over').forEach((n) => { if (n !== chip) n.classList.remove('over'); });
    if (chip) chip.classList.add('over');
    const park = !chip && shelfOn() && !!(e.target.closest && e.target.closest('#p-localsend'));       // the empty area of the Share tab, anywhere not on a tile
    shEl.zone.classList.toggle('over', park); if (park) shEl.hint.textContent = 'Release to park';
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget && active) deactivate(); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    const paths = pathsOf(e.dataTransfer), page = H.page();
    const chip = e.target.closest && e.target.closest('.ls-dev');
    clearOver();
    if (paths.length && page === 'localsend') { if (chip && lsOn()) sendTo(chip.dataset.id, paths); else parkFiles(paths); }
    deactivate();
  });

  // ================================================================ screenshots and recordings
  on('onCaptureNew', (c) => {
    if (!c || c.id == null || !flag('captures', 'enabled', false)) return;
    const vid = c.kind === 'video';
    const actions = [];
    if (shelfOn()) actions.push({ label: 'Shelf', icon: '#i-shelf', title: 'Put it on the shelf', run: () => call('captureToShelf', c.id) });
    actions.push({ label: 'Dismiss', run: () => call('captureDismiss', c.id) });
    fcFlash({ kind: 'capture', icon: vid ? '#i-rec' : '#i-camera', title: vid ? 'Recording saved' : 'Screenshot saved', sub: 'Drag this chip into any app  ' + bytes(c.size), actions, drag: () => api.captureDragOut && api.captureDragOut(c.id) }, 9000);
  });

  // ================================================================ downloads
  let dlList = [];
  on('onDownloads', (list) => {
    if (!flag('downloads', 'enabled', false)) return;
    dlList = (Array.isArray(list) ? list : []).filter((d) => d && typeof d.name === 'string');
    const run = dlList.filter((d) => d.state === 'downloading'), done = dlList.filter((d) => d.state === 'done');
    if (run.length) {
      const d = run[0], total = run.reduce((a, x) => a + (Number(x.bytes) || 0), 0);
      fcSticky = { kind: 'download', icon: '#i-download', title: run.length > 1 ? plural(run.length, 'download') + ' running' : cleanName(d.name), sub: bytes(total) + (d.app ? '  ' + cleanName(d.app) : ''), progress: 'ind' };
    } else if (done.length) {
      fcSticky = { kind: 'download', tone: 'done', icon: '#i-check', title: 'Download finished', sub: cleanName(done[0].name), progress: 1 };
      setTimeout(() => { if (fcSticky && fcSticky.tone === 'done') { fcSticky = null; fcShowNow(); } }, 4500);
    } else fcSticky = null;
    fcShowNow();
  });

  // ================================================================ copied links
  const TRACK = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_eid|mc_cid|igshid|yclid|_hsenc|_hsmi|ref_src|si)$/i;
  function cleanUrl(u) { try { const x = new URL(u); let hit = false; for (const k of [...x.searchParams.keys()]) if (TRACK.test(k)) { x.searchParams.delete(k); hit = true; } return hit ? x.toString() : ''; } catch (e) { return ''; } }
  const copyText = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } };
  let urlSeen = null;
  on('onClipboard', (list) => {
    const items = Array.isArray(list) ? list : [];
    const ids = new Set(items.map((x) => x && x.id));
    if (urlSeen === null) { urlSeen = ids; return; }                                // the list present at start-up is not news
    const fresh = items.find((x) => x && x.kind === 'text' && !urlSeen.has(x.id)); urlSeen = ids;
    if (!fresh || !flag('urltools', 'enabled', true) || H.isOpen()) return;
    const text = String(fresh.text || '').trim();
    if (!/^https?:\/\/[^\s]+$/i.test(text) || text.length > 1500) return;
    let host = text; try { const u = new URL(text); host = u.hostname.replace(/^www\./, ''); } catch (e) { return; }
    const clean = cleanUrl(text), actions = [{ label: 'Open', icon: '#i-open', run: () => call('urlOpen', text) }];
    if (clean) actions.push({ label: 'Clean', icon: '#i-link', title: 'Copy it again without tracking parameters', run: async () => { const ok = await copyText(clean); fcFlash({ kind: 'url', tone: ok ? '' : 'error', icon: ok ? '#i-check' : '#i-warn', title: ok ? 'Copied without tracking' : 'Could not copy', sub: ok ? host : '' }, 2500); }, close: false });
    if (flag('urltools', 'shorten', false)) actions.push({ label: 'Shorten', icon: '#i-link', title: 'Shorten with is.gd (an outside service)', run: async () => { const r = await call('urlShorten', text); const ok = r && r.ok && r.url && await copyText(r.url); fcFlash({ kind: 'url', tone: ok ? '' : 'error', icon: ok ? '#i-check' : '#i-warn', title: ok ? 'Short link copied' : 'Could not shorten', sub: ok ? r.url : (r && r.error) || '' }, 3000); }, close: false });
    fcFlash({ kind: 'url', icon: '#i-link', title: host, sub: text.replace(/^https?:\/\//i, '').slice(0, 60), actions }, 7000);
  });

  // ================================================================ quick note
  const qn = { root: $('#qnote'), input: $('#qnote-in') };
  let qnOpen = false;
  function noteShow() {
    if (qnOpen || !flag('notes', 'enabled', false)) return;
    qnOpen = true; qn.root.hidden = false; void qn.root.offsetWidth; qn.root.classList.add('on');
    H.grabKeys('note'); H.hold(true); api.capture && api.capture(true);
    qn.input.value = ''; setTimeout(() => qn.input.focus(), 30);
  }
  function noteHide() {
    if (!qnOpen) return; qnOpen = false; qn.root.classList.remove('on'); setTimeout(() => { if (!qnOpen) qn.root.hidden = true; }, 300);
    H.releaseKeys('note'); H.hold(false); api.capture && api.capture(H.hovered()); H.settle();
  }
  qn.input.addEventListener('keydown', async (e) => {
    if (e.key === 'Escape') { e.preventDefault(); noteHide(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault(); e.stopPropagation();
    const text = qn.input.value.trim(); if (!text) { noteHide(); return; }
    qn.root.classList.add('busy'); qn.input.disabled = true;
    const r = await call('noteAdd', text);
    qn.root.classList.remove('busy'); qn.input.disabled = false; noteHide();
    const ok = r && r.ok;
    fcFlash(ok ? { kind: 'note', icon: '#i-check', title: 'Note saved', sub: text.length > 50 ? text.slice(0, 50) + '...' : text, actions: [{ label: 'Open file', icon: '#i-open', run: () => call('noteOpenFile') }] }
      : { kind: 'note', tone: 'error', icon: '#i-warn', title: 'Could not save the note', sub: (r && r.error) || '' }, ok ? 4000 : 6000);
  });
  qn.input.addEventListener('blur', () => setTimeout(noteHide, 120));
  on('onNoteOpen', noteShow);

  // ================================================================ focus mode (follows the Windows Do not disturb switch)
  let focusPrev = null;
  on('onFocusMode', (f) => {
    const sys = !!(f && f.system);
    if (focusPrev !== null && focusPrev !== sys && flag('focus', 'sync', false)) fcFlash({ kind: 'focus', icon: '#i-focus', title: sys ? 'Focus mode on' : 'Focus mode off', sub: sys ? 'Windows Do not disturb is on' : 'Notifications are back' }, 3500);
    focusPrev = sys;
  });

  // ================================================================ network page
  const nw = { ip: $('#nw-ip'), ping: $('#nw-ping'), vpn: $('#nw-vpn'), state: $('#nw-state'), note: $('#nw-note') };
  function renderNet(n) {
    if (!n || typeof n !== 'object') return;
    nw.state.textContent = n.online === false ? 'Offline' : 'Online'; nw.state.dataset.on = String(n.online !== false);
    nw.ip.textContent = n.online === false ? '--' : String(n.ip || '--');
    const ms = Number(n.pingMs);
    nw.ping.textContent = n.pingMs == null || !Number.isFinite(ms) ? (n.online === false ? '--' : 'No reply') : Math.round(ms) + ' ms';
    nw.ping.dataset.level = n.pingMs == null || !Number.isFinite(ms) ? (n.online === false ? '' : 'bad') : ms < 60 ? 'good' : ms < 150 ? 'ok' : 'bad';
    nw.vpn.textContent = n.vpn ? (n.vpnName ? cleanName(n.vpnName) : 'On') : 'Off'; nw.vpn.dataset.level = n.vpn ? 'good' : '';
    nw.note.textContent = n.host ? 'Ping measured to ' + cleanName(n.host) + ' every 10 seconds' : '';
  }
  on('onNetwork', renderNet);

  // ================================================================ volume mixer page
  const mx = { list: $('#mx-list'), empty: $('#mx-empty'), items: [], drag: false, timer: 0, sendT: 0 };
  function renderMixer(list) {
    if (mx.drag) return;                                                           // never rebuild a slider while it is being dragged
    mx.items = (Array.isArray(list) ? list : []).filter((a) => a && Number.isFinite(Number(a.pid))).slice(0, 8);
    mx.empty.hidden = mx.items.length > 0; mx.list.hidden = !mx.items.length;
    mx.list.replaceChildren(...mx.items.map((a) => {
      const row = el('div', 'mx-row'); row.dataset.pid = String(a.pid);
      const name = el('span', 'mx-name', cleanName(a.name) || 'App ' + a.pid);
      const mute = el('button', 'mx-mute sl'); mute.type = 'button'; mute.setAttribute('aria-pressed', String(!!a.mute)); mute.setAttribute('aria-label', (a.mute ? 'Unmute ' : 'Mute ') + cleanName(a.name)); mute.append(icon(a.mute ? '#i-mute' : '#i-volume', 18));
      const r = el('input', 'mx-range'); r.type = 'range'; r.min = '0'; r.max = '100'; r.step = '1'; r.value = String(Math.round(Number(a.volume) || 0)); r.setAttribute('aria-label', cleanName(a.name) + ' volume'); r.style.setProperty('--v', r.value + '%');
      const v = el('output', 'label-medium mx-v', r.value + '%');
      row.append(mute, name, r, v); return row;
    }));
  }
  const refreshMixer = () => call('mixerList').then(renderMixer);
  mx.list.addEventListener('input', (e) => {
    const r = e.target.closest('.mx-range'); if (!r) return; const row = r.closest('.mx-row'), pid = Number(row.dataset.pid), v = Number(r.value);
    r.style.setProperty('--v', v + '%'); row.querySelector('.mx-v').textContent = v + '%';
    const item = mx.items.find((a) => a.pid === pid); if (item) item.volume = v;
    clearTimeout(mx.sendT); mx.sendT = setTimeout(() => call('mixerSet', pid, v, undefined), 40);
  });
  mx.list.addEventListener('pointerdown', (e) => { if (e.target.closest('.mx-range')) mx.drag = true; });
  window.addEventListener('pointerup', () => { if (mx.drag) { mx.drag = false; setTimeout(refreshMixer, 150); } });
  mx.list.addEventListener('click', (e) => {
    const b = e.target.closest('.mx-mute'); if (!b) return; const row = b.closest('.mx-row'), pid = Number(row.dataset.pid), item = mx.items.find((a) => a.pid === pid); if (!item) return;
    item.mute = !item.mute; call('mixerSet', pid, item.volume, item.mute); mx.drag = false; renderMixer(mx.items);
  });
  mx.list.addEventListener('wheel', (e) => {                                      // scroll over a row to adjust it (same habit as the music page)
    const r = e.target.closest('.mx-row') && e.target.closest('.mx-row').querySelector('.mx-range'); if (!r) return;
    e.preventDefault(); r.value = String(Math.max(0, Math.min(100, Number(r.value) + (e.deltaY < 0 ? 5 : -5)))); r.dispatchEvent(new Event('input', { bubbles: true }));
  }, { passive: false });

  // ================================================================ page arrival, tray, settings
  function onPage(name) {
    if (name === 'localsend') { if (lsOn()) call('localsendDevices').then((l) => { if (Array.isArray(l)) setDevices(l); }); if (shelfOn()) call('shelfList').then((l) => { if (Array.isArray(l)) renderShelf(l); }); renderXfers(); startLoop(); }
    if (name === 'network') call('networkStatus').then(renderNet);
    if (name === 'mixer') refreshMixer();
    clearInterval(mx.timer); if (name === 'mixer') mx.timer = setInterval(() => { if (H.isOpen() && H.page() === 'mixer') refreshMixer(); }, 2000);
  }
  function tray(k) {
    if (k === 'note') noteShow();
    else if (k === 'net') { H.go('network'); H.open(); H.update(); }
    else if (k === 'mixer') { H.go('mixer'); H.open(); H.update(); }
  }
  let firstSettings = true;
  function onSettings() {
    renderDevices();
    if (firstSettings) { firstSettings = false; if (lsOn()) call('localsendDevices').then((l) => { if (Array.isArray(l)) setDevices(l); }); if (shelfOn()) call('shelfList').then((l) => { if (Array.isArray(l)) renderShelf(l); }); }
    if (!lsOn() && !shelfOn() && H.page() === 'localsend') H.go('home');
  }
  on('onLocalsendDevices', setDevices);
  // opening the island on a page whose animation loop is idle: start it again
  new MutationObserver(() => { if (wrap.classList.contains('open')) startLoop(); }).observe(wrap, { attributes: true, attributeFilter: ['class'] });

  window.DyFeat = { onPage, onSettings, tray, fcFlash, sendTo, state: { ls, sh, mx } };
  renderDevices(); renderXfers(); renderShelf([]);
  onSettings();
})();
