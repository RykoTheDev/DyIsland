// Settings window logic. Every control is bound to a path in the settings object (data-bind="size.open.w").
// A change goes to the main process, which validates it, saves it and broadcasts the result to the island and back here.
(() => {
  const api = window.islandAPI;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  const patchOf = (path, value) => {
    const keys = path.split('.'); const out = {}; let cur = out;
    keys.forEach((k, i) => { if (i === keys.length - 1) cur[k] = value; else { cur[k] = {}; cur = cur[k]; } });
    return out;
  };

  let S = null, sendTimer = 0, pending = null;
  // Sliders fire many times a second: merge the patches and send at most one every 40 ms (the island resizes live)
  const merge = (a, b) => { const o = { ...a }; for (const k of Object.keys(b)) o[k] = a[k] && b[k] && typeof a[k] === 'object' && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(a[k], b[k]) : b[k]; return o; };
  function send(patch) {
    pending = pending ? merge(pending, patch) : patch;
    if (!sendTimer) sendTimer = setTimeout(() => { const p = pending; pending = null; sendTimer = 0; Promise.resolve(api.setSettings(p)).then((s) => { if (s && s.theme) render(s); }).catch(() => {}); }, 40);
  }

  // ---------------------------------------------------------------- render the current settings into the controls
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function render(s) {
    S = s;
    document.documentElement.dataset.motion = reduceMotion.matches ? 'off' : (s.motion || 'expressive');   // the sheet obeys Settings > Animations too
    buildMonitors(s);
    { const n = $('#sideNote'); if (n) n.hidden = !s.placement || s.placement.edge === 'top'; }       // the resting island lies on its side on a side edge
    if (window.DyTheme) window.DyTheme.apply(s.theme);
    for (const el of $$('[data-bind]')) {
      const v = get(s, el.dataset.bind);
      if (el.matches('input[type="checkbox"]')) el.checked = !!v;
      else if (el.matches('input[type="range"]')) { if (document.activeElement !== el) el.value = v; }
      else if (el.matches('select')) el.value = v;
      else if (el.matches('input[type="text"], input[type="date"]')) { if (document.activeElement !== el) el.value = v == null ? '' : v; }
      else if (el.classList.contains('seg')) for (const b of $$('button', el)) b.setAttribute('aria-checked', String(b.dataset.v === String(v)));
    }
    for (const o of $$('[data-out]')) o.textContent = get(s, o.dataset.out) + (o.dataset.unit || '');
    for (const r of $$('[data-needs]')) r.classList.toggle('off', !get(s, r.dataset.needs));
    renderSwatches(s); renderThemes(s); renderTabs(s);
    refreshDropdowns(); renderDnspSettings(s); renderAppList(s);
  }

  // ---------------------------------------------------------------- monitors (Position)
  let monitorList = [], activeMonitors = [];
  function buildMonitors(cur) {
    const sel = $('#monitorSel'); if (!sel) return;
    const want = cur && cur.placement ? cur.placement.monitor : 'primary';
    const opts = [['primary', 'Main monitor'], ...(monitorList.length > 1 ? [['all', 'All monitors (one island on each)']] : []), ...monitorList.map((m) => [m.id, m.label])];
    if (want !== 'primary' && want !== 'all' && !opts.some(([v]) => v === want)) opts.push([want, 'Monitor not connected (using the main one)']);
    if (want === 'all' && monitorList.length <= 1) opts.push(['all', 'All monitors']);
    const key = JSON.stringify(opts);
    if (sel.dataset.key !== key) { sel.replaceChildren(...opts.map(([v, t]) => { const o = document.createElement('option'); o.value = v; o.textContent = t; return o; })); sel.dataset.key = key; }
    sel.value = want;                                          // rebuilding the options resets the selection: put it back
    const note = $('#monitorNote');
    if (note) note.textContent = monitorList.length > 1 ? (want === 'all' ? 'One island per monitor. Full-screen hiding only applies to the main monitor' : want === 'primary' ? 'Pick which monitor shows the island' : 'Full-screen hiding only applies to the main monitor') : 'Only one monitor is connected';
  }
  async function loadMonitors() {
    try { const r = await Promise.resolve(api.displays && api.displays()); if (r && Array.isArray(r.monitors)) { monitorList = r.monitors; activeMonitors = r.active || []; } } catch { /* keep the old list */ }
    buildMonitors(S);
  }
  api.onDisplaysChanged && api.onDisplaysChanged(loadMonitors);

  // ---------------------------------------------------------------- controls
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-bind]'); if (!el) return;
    if (el.matches('input[type="checkbox"]')) {
      const patch = patchOf(el.dataset.bind, el.checked);
      if (el.dataset.bind === 'clipboard.enabled' && S) {                           // the Clipboard tab follows the feature on and off
        const hidden = new Set(S.hiddenTabs); if (el.checked) hidden.delete('clipboard'); else hidden.add('clipboard');
        patch.hiddenTabs = [...hidden];
      }
      send(patch);
    } else if (el.matches('select, input[type="text"], input[type="date"]')) send(patchOf(el.dataset.bind, el.value));
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('input[type="range"][data-bind]'); if (!el) return;
    const out = $(`[data-out="${el.dataset.bind}"]`); if (out) out.textContent = el.value + (out.dataset.unit || '');
    send(patchOf(el.dataset.bind, Number(el.value)));
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button'); if (!b) return;
    const seg = b.closest('.seg'); send(patchOf(seg.dataset.bind, b.dataset.v));
  });

  // Color style (variant) buttons come from presets.js
  $('#variants').replaceChildren(...window.DyPresets.VARIANTS.map((v) => {
    const b = document.createElement('button'); b.setAttribute('role', 'radio'); b.dataset.v = v.id; b.textContent = v.name; return b;
  }));

  // Swatches: each is the preset's seed colour, previewed in its own dark/light primary
  function renderSwatches(s) {
    const box = $('#swatches');
    if (!box.children.length) {
      box.replaceChildren(...window.DyPresets.PRESETS.map((p) => {
        const b = document.createElement('button'); b.className = 'swatch'; b.setAttribute('role', 'radio'); b.dataset.id = p.id; b.dataset.seed = p.seed;
        b.title = p.name; b.setAttribute('aria-label', p.name);
        b.style.background = p.seed;
        b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
        b.addEventListener('click', () => { $('#hex').classList.remove('bad'); $('#hexNote').textContent = 'Any color you like'; send({ theme: { seed: p.seed, preset: p.id } }); });
        return b;
      }));
    }
    for (const b of $$('.swatch', box)) b.setAttribute('aria-checked', String(s.theme.seed.toUpperCase() === b.dataset.seed.toUpperCase()));
    const hex = $('#hex');
    if (document.activeElement !== hex) hex.value = s.theme.seed;
    $('#hexDot').style.background = s.theme.seed;
  }
  // Named themes (Nord, Catppuccin, ...): a chip showing the theme's own background and accents, in the current light/dark
  function renderThemes(s) {
    const box = $('#themes'), THEMES = window.DyPresets.THEMES;
    if (!box.children.length) {
      box.replaceChildren(...THEMES.map((t) => {
        const b = document.createElement('button'); b.className = 'theme-chip'; b.setAttribute('role', 'radio'); b.dataset.id = t.id;
        b.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span class="tname">' + t.name + '</span>';
        b.addEventListener('click', () => { $('#hex').classList.remove('bad'); $('#hexNote').textContent = 'Any color you like'; send({ theme: { seed: t.dark.p, preset: t.id } }); });
        return b;
      }));
    }
    const dark = window.DyTheme.resolveDark(s.theme.mode);
    for (const b of $$('.theme-chip', box)) {
      const t = THEMES.find((x) => x.id === b.dataset.id), pal = dark ? t.dark : t.light;
      b.style.setProperty('--tb', pal.bg); b.style.setProperty('--tf', pal.fg);
      [...b.querySelectorAll('.dots i')].forEach((d, i) => { d.style.background = [pal.p, pal.s, pal.t][i]; });
      b.setAttribute('aria-checked', String(s.theme.preset === t.id));
    }
    $('#variantField').classList.toggle('off', THEMES.some((t) => t.id === s.theme.preset));   // a named theme brings its own colours
  }
  $('#hex').addEventListener('input', (e) => {
    let v = e.target.value.trim(); if (v && v[0] !== '#') v = '#' + v;
    const ok = /^#[0-9a-fA-F]{6}$/.test(v);
    e.target.classList.toggle('bad', !!v && !ok);
    $('#hexNote').textContent = ok || !v ? 'Any color you like' : 'Six hex digits, like 1FB5A5';
    if (ok) send({ theme: { seed: v.toUpperCase(), preset: 'custom' } });
  });

  // ---------------------------------------------------------------- tabs: drag to reorder, arrows, on/off
  const TAB_META = { home: ['Home', 'i-home'], music: ['Music', 'i-music'], weather: ['Weather', 'i-cloud'], timer: ['Timer', 'i-timer'], usage: ['Usage', 'i-chart'], clipboard: ['Clipboard', 'i-clip'] };
  const list = $('#tabList');
  function commitOrder() {
    const order = $$('.tab-row', list).map((r) => r.dataset.id);
    if (S && order.join() === S.tabs.join()) return;                                  // dropped where it started
    send({ tabs: order });
  }
  function renderTabs(s) {
    if (list.querySelector('.dragging')) return;                                     // do not rebuild under the user's hand
    const f = document.activeElement, keep = f && list.contains(f) ? { id: f.closest('.tab-row').dataset.id, move: f.dataset.move, cb: f.matches('input') } : null;
    list.replaceChildren(...s.tabs.map((id, i) => {
      const [name, icon] = TAB_META[id];
      const on = !s.hiddenTabs.includes(id);
      const locked = id === 'clipboard' && !s.clipboard.enabled;                    // switched on under Everyday
      const li = document.createElement('li'); li.className = 'tab-row' + (on ? '' : ' off') + (locked ? ' locked' : ''); li.dataset.id = id; li.draggable = true;
      li.innerHTML = `
        <span class="tab-grip" aria-hidden="true"><svg width="24" height="24"><use href="#i-drag"/></svg></span>
        <span class="tab-ico"><svg width="24" height="24"><use href="#${icon}"/></svg></span>
        <span class="tab-name">${name}</span>
        <button class="mini-btn sl" data-move="-1" aria-label="Move ${name} up" ${i === 0 ? 'disabled' : ''}><svg width="20" height="20"><use href="#i-up"/></svg></button>
        <button class="mini-btn sl" data-move="1" aria-label="Move ${name} down" ${i === s.tabs.length - 1 ? 'disabled' : ''}><svg width="20" height="20"><use href="#i-down"/></svg></button>
        <label class="switch"><input type="checkbox" ${on ? 'checked' : ''} ${locked ? 'disabled title="Turn on clipboard history under Everyday first"' : ''} aria-label="Show ${name}"><i><svg width="16" height="16"><use href="#i-check"/></svg></i></label>`;
      return li;
    }));
    if (keep) {                                                                       // a rebuild must not drop keyboard focus
      const row = $(`.tab-row[data-id="${keep.id}"]`, list);
      const t = row && (keep.cb ? $('input', row) : $(`[data-move="${keep.move}"]`, row));
      if (t && !t.disabled) t.focus(); else if (row) { const alt = $('.mini-btn:not(:disabled)', row); if (alt) alt.focus(); }
    }
  }
  list.addEventListener('click', (e) => {
    const m = e.target.closest('[data-move]'); if (!m) return;
    const row = m.closest('.tab-row'); const d = Number(m.dataset.move);
    const sib = d < 0 ? row.previousElementSibling : row.nextElementSibling; if (!sib) return;
    if (d < 0) list.insertBefore(row, sib); else list.insertBefore(sib, row);
    commitOrder();
  });
  list.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type="checkbox"]'); if (!cb) return;
    const id = cb.closest('.tab-row').dataset.id;
    send({ hiddenTabs: $$('.tab-row', list).filter((r) => !$('input', r).checked).map((r) => r.dataset.id) });
  });
  let dragging = null;
  list.addEventListener('dragstart', (e) => { dragging = e.target.closest('.tab-row'); if (!dragging) return; dragging.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragging.dataset.id); } catch { /* ignore */ } });
  list.addEventListener('dragover', (e) => {
    if (!dragging) return; e.preventDefault();
    const over = e.target.closest('.tab-row'); if (!over || over === dragging) return;
    const r = over.getBoundingClientRect();
    list.insertBefore(dragging, e.clientY < r.top + r.height / 2 ? over : over.nextElementSibling);
  });
  list.addEventListener('dragend', () => { if (!dragging) return; dragging.classList.remove('dragging'); dragging = null; commitOrder(); });
  list.addEventListener('drop', (e) => e.preventDefault());

  // ---------------------------------------------------------------- hotkey status, resets, close
  const note = $('#hotkeyNote');
  const keyNote = $('#settingsKeyNote');
  const showHotkey = (st) => { note.hidden = !st || st.ok !== false; keyNote.hidden = !st || !st.settings || st.settings.ok !== false; };
  Promise.resolve(api.hotkeyStatus && api.hotkeyStatus()).then(showHotkey).catch(() => {});
  api.onHotkeyStatus && api.onHotkeyStatus(showHotkey);

  $('#copyHooks').addEventListener('click', async () => {
    const ok = await Promise.resolve(api.copyHooks && api.copyHooks()).catch(() => false);
    const n = $('#hooksNote'); n.hidden = false; n.textContent = ok ? 'Copied. Paste it into ~/.claude/settings.json (merge it into an existing "hooks" block)' : 'Could not copy';
  });
  $('#resetSizes').addEventListener('click', () => send({ size: { idle: { w: 148, h: 32 }, open: { w: 520, h: 264 } } }));
  const resetAll = $('#resetAll'); let armed = 0;
  resetAll.addEventListener('click', () => {
    if (!armed) { armed = setTimeout(() => { armed = 0; resetAll.classList.remove('confirm'); resetAll.textContent = 'Reset all settings'; }, 4000); resetAll.classList.add('confirm'); resetAll.textContent = 'Tap again to reset everything'; return; }
    clearTimeout(armed); armed = 0; resetAll.classList.remove('confirm'); resetAll.textContent = 'Reset all settings'; api.resetSettings();
  });
  $('#close').addEventListener('click', () => api.closeSettings());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.closeSettings(); });
  api.onSettingsState((open) => {                                                    // replay the entrance each time it is shown
    if (!open) return;
    const sheet = $('.sheet'); sheet.style.animation = 'none'; void sheet.offsetWidth; sheet.style.animation = '';
  });

  // ---------------------------------------------------------------- search: hides rows (and whole groups) that do not match
  const searchBox = $('#q');
  function applyFilter() {
    const q = searchBox.value.trim().toLowerCase();
    let shown = 0;
    for (const g of $$('.group')) {
      const tEl = g.querySelector('.g-title'), title = ((tEl && tEl.firstChild ? tEl.firstChild.textContent : '') || '').toLowerCase();      // the title text only, not its Reset button
      const items = [...g.children].filter((c) => !c.classList.contains('g-title'));
      if (!q) { items.forEach((c) => c.removeAttribute('data-filtered')); g.removeAttribute('data-filtered'); shown++; continue; }
      const titleHit = title.includes(q);
      let any = false;
      for (const c of items) {
        if (c.hidden) { c.toggleAttribute('data-filtered', true); continue; }       // a hint that is hidden on purpose never counts as a match
        const hit = titleHit || c.textContent.toLowerCase().includes(q) || [...c.querySelectorAll('[aria-label], [title], [placeholder]')].some((e) => ((e.getAttribute('aria-label') || '') + (e.title || '') + (e.getAttribute('placeholder') || '')).toLowerCase().includes(q));
        c.toggleAttribute('data-filtered', !hit); if (hit) any = true;
      }
      g.toggleAttribute('data-filtered', !any); if (any) shown++;
    }
    $('#noMatch').hidden = shown > 0 || !q;
  }
  searchBox.addEventListener('input', applyFilter);
  searchBox.addEventListener('keydown', (e) => { if (e.key === 'Escape' && searchBox.value) { searchBox.value = ''; applyFilter(); e.stopPropagation(); } });
  document.addEventListener('keydown', (e) => { if ((e.ctrlKey && e.key.toLowerCase() === 'f') || (e.key === '/' && document.activeElement === document.body)) { e.preventDefault(); searchBox.focus(); searchBox.select(); } });

  // ---------------------------------------------------------------- Settings tabs: the long list is split into five pages (a search looks through all of them)
  const STABS = [
    ['appearance', 'Look', ['g-look', 'g-display']],
    ['layout', 'Layout', ['g-pos', 'g-size', 'g-home', 'g-tabs']],
    ['alerts', 'Alerts', ['g-alerts']],
    ['apps', 'Apps', ['g-claude', 'g-agents', 'g-google', 'g-dnsp', 'g-dns', 'g-clip', 'g-clip2']],
    ['system', 'System', ['g-keys', 'g-region', 'g-check', 'g-backup']],
  ];
  let activeStab = 'appearance';
  try { const v = localStorage.getItem('settings.tab'); if (STABS.some((t) => t[0] === v)) activeStab = v; } catch { /* private mode */ }
  const stabOf = (g) => { const id = g.getAttribute('aria-labelledby') || ''; const hit = STABS.find((t) => t[2].includes(id)); return hit ? hit[0] : 'system'; };
  function applyStab() {
    const searching = !!$('#q').value.trim();
    for (const g of $$('.group')) g.toggleAttribute('data-stab-hidden', !searching && stabOf(g) !== activeStab);
    for (const b of $$('#stabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === activeStab && !searching));
    const sc = $('#scroll'); if (sc) sc.scrollTop = 0;
  }
  { const bar = $('#stabs');
    for (const [id, label] of STABS) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'stab sl'; b.dataset.tab = id; b.setAttribute('role', 'tab'); b.textContent = label;
      b.addEventListener('click', () => { activeStab = id; try { localStorage.setItem('settings.tab', id); } catch { /* ignore */ } $('#q').value = ''; applyFilter(); applyStab(); });
      bar.appendChild(b);
    }
    $('#q').addEventListener('input', applyStab);
    applyStab();
  }

  // ---------------------------------------------------------------- dropdowns: the native pop-up list is replaced by one that matches the rest of the sheet
  const ddInit = new WeakSet();
  function closeDropdowns(except) { for (const d of $$('.dd.open')) if (d !== except) { d.classList.remove('open'); d.querySelector('.dd-btn').setAttribute('aria-expanded', 'false'); } }
  function buildDropdown(sel) {
    const dd = document.createElement('div'); dd.className = 'dd';
    const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn sl'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', sel.getAttribute('aria-label') || 'Choose');
    const text = document.createElement('span'); text.className = 'dd-text';
    btn.append(text); btn.insertAdjacentHTML('beforeend', '<svg class="dd-chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>');
    const list = document.createElement('ul'); list.className = 'dd-list'; list.setAttribute('role', 'listbox');
    dd.append(btn, list); sel.after(dd); sel.classList.add('dd-native');
    const fill = () => {
      list.replaceChildren(...[...sel.options].map((o) => { const li = document.createElement('li'); li.setAttribute('role', 'option'); li.dataset.v = o.value; li.textContent = o.textContent; li.setAttribute('aria-selected', String(o.value === sel.value)); return li; }));
      const cur = sel.options[sel.selectedIndex]; text.textContent = cur ? cur.textContent : '';
    };
    const open = () => { closeDropdowns(dd); fill(); dd.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
      const r = dd.getBoundingClientRect(); dd.classList.toggle('up', window.innerHeight - r.bottom < 220 && r.top > 220);
      const on = list.querySelector('[aria-selected="true"]'); if (on) on.scrollIntoView({ block: 'nearest' }); };
    btn.addEventListener('click', () => (dd.classList.contains('open') ? closeDropdowns() : open()));
    list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (!li) return; sel.value = li.dataset.v; sel.dispatchEvent(new Event('change', { bubbles: true })); fill(); closeDropdowns(); btn.focus(); });
    dd.addEventListener('keydown', (e) => {
      const opts = [...list.children], i = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true');
      if (e.key === 'Escape' && dd.classList.contains('open')) { closeDropdowns(); btn.focus(); e.stopPropagation(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!dd.classList.contains('open')) { open(); return; } const n = Math.max(0, Math.min(opts.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); opts.forEach((o, k) => o.setAttribute('aria-selected', String(k === n))); opts[n].scrollIntoView({ block: 'nearest' }); }
      else if ((e.key === 'Enter' || e.key === ' ') && dd.classList.contains('open') && i >= 0) { e.preventDefault(); sel.value = opts[i].dataset.v; sel.dispatchEvent(new Event('change', { bubbles: true })); fill(); closeDropdowns(); btn.focus(); }
    });
    new MutationObserver(fill).observe(sel, { childList: true });          // the monitor list is rebuilt when screens change
    sel._ddFill = fill; fill();
  }
  function refreshDropdowns() {
    for (const sel of $$('select.select')) { if (!ddInit.has(sel)) { ddInit.add(sel); buildDropdown(sel); } else sel._ddFill(); }
  }
  document.addEventListener('mousedown', (e) => { if (!e.target.closest('.dd')) closeDropdowns(); });
  refreshDropdowns();

  // ---------------------------------------------------------------- reset one section (tap twice)
  const SECTIONS = {
    'g-look': ['theme', 'motion'],
    'g-display': ['openOn', 'autoHide', 'hideInFullscreen', 'mascot', 'split', 'privacy'],
    'g-pos': ['placement'],
    'g-size': ['size'],
    'g-home': ['home'],
    'g-tabs': ['tabs', 'hiddenTabs'],
    'g-alerts': ['quiet', 'usage', 'battery'],
    'g-keys': ['hotkey', 'settingsHotkey'],
    'g-clip': ['clipboard'],
    'g-region': ['units', 'calendar'],
    'g-claude': ['approvals', 'agents'],
    'g-dns': ['dns'],
  };
  for (const [id, keys] of Object.entries(SECTIONS)) {
    const h = document.getElementById(id); if (!h) continue;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sec-reset sl'; b.textContent = 'Reset'; b.setAttribute('aria-label', 'Reset ' + h.textContent + ' to defaults');
    let timer = 0;
    b.addEventListener('click', async () => {
      if (!b.classList.contains('confirm')) { b.classList.add('confirm'); b.textContent = 'Tap again'; timer = setTimeout(() => { b.classList.remove('confirm'); b.textContent = 'Reset'; }, 3000); return; }
      clearTimeout(timer); b.classList.remove('confirm'); b.textContent = 'Reset';
      const defaults = await Promise.resolve(api.settingsDefaults());
      const patch = {}; for (const k of keys) if (defaults && k in defaults) patch[k] = defaults[k];
      if (patch.hiddenTabs && S && S.clipboard.enabled) patch.hiddenTabs = patch.hiddenTabs.filter((t) => t !== 'clipboard');   // the Clipboard tab follows the feature
      send(patch);
    });
    h.appendChild(b);
  }

  // ---------------------------------------------------------------- setup check
  const STATE_WORD = { ok: 'Working', warn: 'Check', bad: 'Problem', off: 'Off' };
  async function runCheck() {
    const list = $('#chkList'); $('#recheck').disabled = true;
    let rows = []; try { rows = await Promise.resolve(api.setupStatus()); } catch { rows = []; }
    list.replaceChildren(...(Array.isArray(rows) ? rows : []).map((r) => {
      const d = document.createElement('div'); d.className = 'chk'; d.dataset.state = r.state; d.setAttribute('role', 'listitem');
      const dot = document.createElement('i'); dot.className = 'chk-dot'; dot.setAttribute('aria-hidden', 'true');
      const t = document.createElement('div'); t.className = 'chk-text';
      const b = document.createElement('b'); b.textContent = String(r.label || '') + ' · ' + (STATE_WORD[r.state] || '');
      const sp = document.createElement('span'); sp.textContent = String(r.detail || '');
      t.append(b, sp); d.append(dot, t); return d;
    }));
    $('#recheck').disabled = false;
  }
  $('#recheck').addEventListener('click', runCheck);
  api.onSettingsState((open) => { if (open) { runCheck(); loadMonitors(); } });
  runCheck(); loadMonitors();

  // ---------------------------------------------------------------- Google
  const GSTATE = { off: 'Not connected.', ok: 'Connected.', 'needs-id': 'Connected, but the client ID is missing.', error: 'Connected, but the last refresh failed' };
  async function refreshGoogle(note) {
    let r = null; try { r = await Promise.resolve(api.googleState && api.googleState()); } catch { /* ignore */ }
    const st = r && r.status || 'off', el = $('#googleState'); if (!el) return;
    el.textContent = note || ((GSTATE[st] || '') + (st === 'error' && r.error ? ': ' + r.error : '') + (st === 'ok' ? ' ' + r.mail.unread + ' unread.' : ''));
    $('#googleConnect').disabled = st !== 'off' && st !== 'needs-id'; $('#googleDisconnect').disabled = st === 'off';
  }
  $('#googleConnect').addEventListener('click', async () => { $('#googleState').textContent = 'Finish the sign-in in your browser...'; let r = null; try { r = await api.googleConnect(); } catch { /* ignore */ } refreshGoogle(r && !r.ok ? (r.error || 'Could not connect.') : ''); });
  $('#googleDisconnect').addEventListener('click', async () => { try { await api.googleDisconnect(); } catch { /* ignore */ } refreshGoogle(); });
  api.onGoogle && api.onGoogle(() => refreshGoogle());
  refreshGoogle();

  // ---------------------------------------------------------------- Coding agents: copy the setup lines for each
  Promise.resolve(api.agentsList && api.agentsList()).then((list) => {
    const box = $('#agentList'); if (!box || !Array.isArray(list)) return;
    box.replaceChildren(...list.map((a) => {
      const row = document.createElement('div'); row.className = 'agent-row';
      const t = document.createElement('span'); t.className = 'agent-t'; const b = document.createElement('b'); b.textContent = a.name; const sm = document.createElement('small'); sm.textContent = a.where + ' · ' + a.note; t.append(b, sm);
      const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'tonal-btn sl'; btn.textContent = 'Copy setup';
      btn.addEventListener('click', async () => { let ok = false; try { ok = await api.agentsCopy(a.id); } catch { /* ignore */ } const n = $('#agentNote'); n.hidden = false; n.textContent = ok ? a.name + ' setup copied. ' + a.note + ' (' + a.where + ').' : 'Could not copy that.'; });
      row.append(t, btn); return row;
    }));
  }).catch(() => {});

  // ---------------------------------------------------------------- App shortcuts list
  let appIcons = [];
  async function renderAppList(s) {
    const box = $('#appList'); if (!box || !s || !s.shortcuts) return;
    try { const ic = await Promise.resolve(api.appIcons && api.appIcons()); if (Array.isArray(ic)) appIcons = ic; } catch { /* no icons */ }
    box.replaceChildren(...s.shortcuts.apps.map((a, i) => {
      const row = document.createElement('div'); row.className = 'app-row';
      const im = document.createElement('img'); im.alt = ''; if (appIcons[i]) im.src = appIcons[i];
      const t = document.createElement('span'); t.textContent = a.name; t.title = a.path;
      const x = document.createElement('button'); x.type = 'button'; x.className = 'app-x sl'; x.setAttribute('aria-label', 'Remove ' + a.name); x.innerHTML = '<svg width="16" height="16"><use href="#i-close"/></svg>';
      x.addEventListener('click', () => send({ shortcuts: { apps: s.shortcuts.apps.filter((_, k) => k !== i) } }));
      row.append(im, t, x); return row;
    }));
    $('#appAdd').disabled = s.shortcuts.apps.length >= 8;
  }
  $('#appAdd').addEventListener('click', async () => { try { await api.pickApp(); } catch { /* ignore */ } });

  // ---------------------------------------------------------------- DNS providers (Cloudflare, Google, AdGuard, your own)
  let dnspPresets = [], dnspBuilt = false;
  function renderDnspSettings(s) {
    const box = $('#dnspPresets'); if (!box || !s || !s.dnsp) return;
    if (!dnspBuilt && dnspPresets.length) {
      dnspBuilt = true;
      box.replaceChildren(...dnspPresets.map((p) => {
        const l = document.createElement('label'); l.className = 'dnsp-p';
        const c = document.createElement('input'); c.type = 'checkbox'; c.dataset.preset = p.id;
        const t = document.createElement('span'); const b = document.createElement('b'); b.textContent = p.name; const sm = document.createElement('small'); sm.textContent = p.note || '';
        t.append(b, sm); l.append(c, t); return l;
      }));
    }
    for (const c of $$('#dnspPresets input[data-preset]')) c.checked = s.dnsp.presets.includes(c.dataset.preset);
    for (const row of $$('#dnspCustom .dnsp-c')) { const v = s.dnsp.custom[Number(row.dataset.i)] || {}; for (const inp of $$('input', row)) if (document.activeElement !== inp) inp.value = v[inp.dataset.f] || ''; }
  }
  function sendDnsp() {
    const presets = $$('#dnspPresets input[data-preset]').filter((c) => c.checked).map((c) => c.dataset.preset);
    const custom = $$('#dnspCustom .dnsp-c').map((row) => Object.fromEntries($$('input', row).map((i) => [i.dataset.f, i.value.trim()]))).filter((c) => c.name || c.v4a);
    send({ dnsp: { presets, custom } });
  }
  document.addEventListener('change', (e) => { if (e.target.closest('#dnspPresets, #dnspCustom')) sendDnsp(); });
  const DNSP_TEXT = { notinstalled: 'Not installed yet. Pick providers above, then press Install.', auto: 'Installed. DNS is Automatic (your ISP / router).', profile: 'Installed. Using', custom: 'Installed, but your DNS was changed by hand.', mixed: 'Installed. Your connections use different DNS right now.', absent: 'Installed, but the saved connection is not active right now.', unsupported: 'Not available on this system.' };
  async function refreshDnsp() {
    let r = null; try { r = await Promise.resolve(api.dnspStatus && api.dnspStatus()); } catch { /* ignore */ }
    const st = r && r.state || 'notinstalled', box = $('#dnspNow'); if (!box) return;
    const cur = r && r.profiles ? r.profiles.find((p) => p.id === r.id) : null;
    $('#dnspState').textContent = (DNSP_TEXT[st] || '') + (st === 'profile' && cur ? ' ' + cur.name + '.' : '');
    box.replaceChildren(...(r && r.profiles ? [{ id: 'auto', name: 'Automatic' }, ...r.profiles] : []).map((p) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'dnsp-use sl'; b.textContent = p.name;
      b.setAttribute('aria-pressed', String((p.id === 'auto' && st === 'auto') || (r.id === p.id && st === 'profile')));
      b.addEventListener('click', async () => { box.querySelectorAll('button').forEach((x) => { x.disabled = true; }); try { await api.dnspUse(p.id); } catch { /* ignore */ } refreshDnsp(); });
      return b;
    }));
  }
  $('#dnspInstall').addEventListener('click', async () => { sendDnsp(); await new Promise((r) => setTimeout(r, 120)); $('#dnspState').textContent = 'Waiting for Windows approval and the setup window...'; try { await api.dnspSetup(); } catch { /* ignore */ } setTimeout(refreshDnsp, 1500); });
  $('#dnspRemove').addEventListener('click', async () => { try { await api.dnspRemove(); } catch { /* ignore */ } setTimeout(refreshDnsp, 1500); });
  Promise.resolve(api.dnspPresets && api.dnspPresets()).then((l) => { if (Array.isArray(l)) { dnspPresets = l; renderDnspSettings(S); } }).catch(() => {});
  refreshDnsp();
  api.onSettingsState((open) => { if (open) refreshDnsp(); });

  // ---------------------------------------------------------------- NextDNS switch
  const DNS_TEXT = { on: 'Set up. NextDNS is ON.', off: 'Set up. NextDNS is OFF (automatic DNS from your ISP).', notinstalled: 'Not set up yet. Click Set up (Windows asks for approval once).', custom: 'Set up, but DNS was changed by hand. The tile restores NextDNS.', mixed: 'Set up. Some connections are on, some off.', unencrypted: 'Set up. The NextDNS servers are in place but their encrypted-DNS setting is missing: click the tile to restore it.', absent: 'Set up, but the saved connection is not active right now.', unsupported: 'Only available on Windows.' };
  async function refreshDnsState() {
    const el = $('#dnsState'); if (!el || !api.dnsStatus) return;
    let st = 'notinstalled'; try { const r = await Promise.resolve(api.dnsStatus()); if (r && r.state) st = r.state; } catch { /* keep */ }
    el.textContent = DNS_TEXT[st] || 'Unknown';
    $('#dnsSetup').textContent = st === 'notinstalled' ? 'Set up' : 'Set up again';
    $('#dnsRemove').disabled = st === 'notinstalled';
  }
  $('#dnsSetup').addEventListener('click', async () => { await Promise.resolve(api.dnsSetup()); setTimeout(refreshDnsState, 4000); });
  $('#dnsRemove').addEventListener('click', async () => { await Promise.resolve(api.dnsRemove()); setTimeout(refreshDnsState, 4000); });
  api.onSettingsState((open) => { if (open) refreshDnsState(); });
  refreshDnsState();

  // ---------------------------------------------------------------- backup and app
  const bkNote = $('#bkNote');
  const say = (text) => { bkNote.hidden = !text; bkNote.textContent = text || ''; };
  $('#exportBtn').addEventListener('click', async () => { const r = await Promise.resolve(api.exportSettings()); if (r && r.ok) say('Saved as ' + r.file); else if (r && !r.canceled) say((r && r.error) || 'Could not save'); });
  $('#importBtn').addEventListener('click', async () => { const r = await Promise.resolve(api.importSettings()); if (r && r.ok) say('Imported ' + r.file); else if (r && !r.canceled) say((r && r.error) || 'Could not import'); });
  $('#restartBtn').addEventListener('click', () => api.restartApp());
  const quitBtn = $('#quitBtn'); let quitT = 0, quitAt = 0;
  quitBtn.addEventListener('click', () => {
    if (quitBtn.classList.contains('confirm') && Date.now() - quitAt < 500) return;                       // that was the same double-click
    if (!quitBtn.classList.contains('confirm')) { quitAt = Date.now(); quitBtn.classList.add('confirm'); quitBtn.textContent = 'Tap again to quit'; quitT = setTimeout(() => { quitBtn.classList.remove('confirm'); quitBtn.textContent = 'Quit DyIsland'; }, 3000); return; }
    clearTimeout(quitT); api.quitApp();
  });

  api.onSettings(render);
  Promise.resolve(api.getSettings()).then(render);
})();
