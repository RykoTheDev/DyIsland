(() => {
  const api = window.islandAPI;
  // Working / timer now live in the status chip under the island. Set to true to also let them take over the pill again.
  const PILL_SHOWS_STATUS = false;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem('island.' + k); return v === null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('island.' + k, v); } catch { /* ignore */ } },
  };

  // ---------------------------------------------------------------- settings: the live copy (the store itself lives in main)
  const FALLBACK = {
    motion: 'expressive', placement: { edge: 'top', monitor: 'primary' }, dns: { tile: true }, quiet: { dnd: false, mute: false }, openOn: 'click', autoHide: false, hideInFullscreen: true,
    theme: { mode: 'auto', variant: 'vibrant', seed: '#1FB5A5', preset: 'teal' },
    size: { idle: { w: 148, h: 32 }, open: { w: 520, h: 264 } },
    tabs: ['home', 'music', 'weather', 'timer', 'usage', 'clipboard', 'agents'], hiddenTabs: ['clipboard'],
    mascot: { enabled: true, delay: 8 }, clipboard: { enabled: false, max: 12 }, battery: { warn: true },
    units: { temp: 'c', clock: 'auto' }, calendar: { weekStart: 'auto' }, usage: { forecast: true, resetAlert: true }, approvals: { enabled: true, wait: 30 }, agents: { quietAlert: false }, split: { enabled: true, lead: 'auto' },
    privacy: { dot: true },
    home: { calendar: true, side: 'left', first: 'weather', second: 'music', countdown: { label: '', date: '' } },
  };
  let S = FALLBACK;
  let timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  let lastWeather = null, cal = null, lastDay = '';
  // pointer / visibility / mascot state, declared up here because the first clock tick already runs the code that reads it
  let lastHm = '', near = false, hoverFlag = false, hotkeyReveal = false, hotkeyTimer = 0, idleSince = Date.now(), eyesOn = false, happyNext = true;

  // ---------------------------------------------------------------- elements (easing curves live in styles.css)
  const wrap = $('#wrap');
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

  // ---------------------------------------------------------------- open / close
  // The content entrance plays only when the island was fully collapsed. Re-entering mid-close
  // keeps the content as it is, so a quick hover in and out never makes anything jump.
  let closeTimer = 0, settleTimer = 0, animTimer = 0, settled = true, editing = false, pinned = false, pinTimer = 0, settingsOpen = false;
  const isOpen = () => wrap.classList.contains('open');
  function animatePage(p) {
    clearTimeout(animTimer);
    p.classList.remove('anim'); void p.offsetWidth; p.classList.add('anim');
    animTimer = setTimeout(() => p.classList.remove('anim'), 600);
  }
  function open() {
    clearTimeout(closeTimer); clearTimeout(settleTimer);
    dismissNotices();                                      // hovering means you have seen it
    if (isOpen()) return;
    if (settled) animatePage($('.page.active'));
    settled = false;
    wrap.classList.add('open');
  }
  function close(force) {
    if (typeof hideTray === 'function') hideTray();
    if (!force && approvalList.length && wrap.dataset.page === 'approve') return;     // an open request keeps the card up until it is answered
    wrap.classList.remove('open'); api.capture(wrap.matches(':hover'));      // click-through again, unless the pointer is still on it (no mouseenter will fire to take it back)
    noteActivity();                                        // idling starts when the island closes, not when the hover began
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settled = true; }, 300);
  }

  // "On click" (the default): the pointer only wakes the island (so it can be clicked); a click opens it. "On hover": hovering opens it.
  wrap.addEventListener('mouseenter', () => { hoverFlag = true; api.capture(true); if (isOpen()) clearTimeout(closeTimer); if (!approvalList.length) pinned = false; if (!(eyesOn && S.openOn === 'click')) noteActivity(); if (S.openOn === 'hover' && !wrap.classList.contains('has-notice')) open(); updateVisibility(); });
  // Toast about a Claude session ("needs you" / "finished"): a click goes to the window that session runs in
  function openClaudeFor(session) {
    Promise.resolve(api.focusClaude && api.focusClaude(session)).then((r) => {
      if (!r || !r.ok) pushNotice({ kind: 'attention', title: "Couldn't find Claude's window", sub: 'Open it yourself; it did not match a terminal or the app' });
    }).catch(() => {});
  }
  wrap.addEventListener('click', (e) => {
    if (wrap.classList.contains('has-notice') && !isOpen() && e.target.closest('.notice') && shownNotice && shownNotice.session) {
      dismissNotices(); openClaudeFor(shownNotice.session); return;
    }
    if (S.openOn === 'hover' || isOpen()) return;
    const hit = e.target.closest('.stchip'), k = hit && hit.dataset.kind;           // clicking a status chip lands on its page
    if (k === 'limit') go('usage'); else if (k === 'timer') go('timer'); else if (k === 'approve') go('approve');
    open(); updateVisibility();
  });
  // Open and meant to stay open: an alert/hotkey pin, typing in the city box, or a permission card that is waiting for an answer
  const keepOpen = () => editing || pinned || (approvalList.length > 0 && wrap.dataset.page === 'approve');
  wrap.addEventListener('mouseleave', () => {
    hoverFlag = false; updateVisibility();
    if (keepOpen() || settingsOpen) { api.capture(false); return; }      // stays open, but the pointer is gone: let clicks through to what is underneath
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, 240);
  });

  // ---------------------------------------------------------------- pages
  function go(name) {
    const vis = visibleTabs();
    if (name !== 'approve' && !vis.includes(name)) name = vis[0] || 'home';        // a tab you switched off in Settings can never be opened (the approval card is not a tab)
    { const order = [...visibleTabs(), 'approve'], from = order.indexOf(wrap.dataset.page), to = order.indexOf(name); wrap.dataset.dir = from >= 0 && to >= 0 && to < from ? 'back' : 'fwd'; }   // pages slide the way you travelled
    if (name === 'approve') apprLockUntil = Date.now() + 500;                       // a click meant for the page you just left must not answer a request
    $$('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === name));
    $$('.nav [data-tab-btn]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.go === name)));
    wrap.dataset.page = name;
    animatePage($('#p-' + name));
    if (name === 'usage') { const b = $('#u-big'); if (b) b.dataset.v = '0'; loadUsage(); }       // the percentage counts up each time you arrive
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (t) go(t.dataset.go);
  });

  // ---------------------------------------------------------------- state (declared early: the clock reads it)
  let mediaState = null;
  let work = { working: false, since: 0, count: 0 };      // Claude Code sessions working right now (computed in main)
  let approvalList = [], apprLockUntil = 0;                                   // open permission requests from Claude Code
  let limitWarn = null;                                   // { name, left, level } when a usage limit is about to run out
  // the two status chips (the second one appears in Split view), made up here because the first clock tick draws them
  const chip = $('#chip');
  const chip2 = chip.cloneNode(true); chip2.id = 'chip2'; chip2.querySelectorAll('[id]').forEach((e) => e.removeAttribute('id')); chip.after(chip2);
  let satIndex = 0;                                       // which item the status circle shows when several are active
  const timer = { total: Number(store.get('timer', 300)), left: 0, running: false, endAt: 0 };
  timer.left = timer.total;

  // ---------------------------------------------------------------- clock
  function tickClock() {
    const d = new Date();
    const parts = timeFmt.formatToParts(d);
    const dayKey = d.toDateString();
    if (dayKey !== lastDay) { const rolled = !!lastDay; lastDay = dayKey; if (cal) cal.resetToToday(); if (rolled) { try { renderCountdown(); } catch { /* not built yet */ } } }       // the calendar rolls over at midnight
    const hm = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
    const period = (parts.find((p) => p.type === 'dayPeriod') || {}).value || '';
    if (hm !== lastHm) {                                    // the minute rolled over: the digits spring in
      if (lastHm) { const t = $('#h-time'); t.classList.remove('tick'); void t.offsetWidth; t.classList.add('tick'); }
      lastHm = hm;
    }
    $('#h-time').textContent = hm;
    $('#h-period').textContent = period;
    if (wrap.dataset.mode !== 'timer') $('.c-time').textContent = hm + (period ? ' ' + period : '');   // the clock, unless the pill is showing the timer
    renderWork();                                           // ticks the elapsed time once a second
    if (wrap.dataset.page === 'agents' && isOpen()) renderAgents();
    renderSat();
    $('#h-date').textContent = d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  }
  tickClock(); setInterval(tickClock, 1000);

  // ---------------------------------------------------------------- Claude working: elapsed time of the most recent session
  function renderWork() {
    if (!work.working) return;
    const s = Math.max(0, Math.floor((Date.now() - work.since) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    $('.c-work').textContent = h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
    $('.c-count').textContent = work.count > 1 ? '×' + work.count : '';
  }

  // ---------------------------------------------------------------- status chip: a small squircle floating under the island
  // Shows one of these, and cycles through them every 4 s when several are active:
  //   limit  a usage limit is about to run out   "5-hour limit  9% left"      amber bar (red when critical) = what is left
  //   work   Claude is working                   "Claude working  3:12"        sliding bar, elapsed time of the newest session
  //   timer  a timer is running                  "Timer  4:32"                 bar = time left
  function clockText(s) {                                   // 4:32, or 1:04:32 past an hour
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }
  function satItems() {
    const items = [];
    if (approvalList.length) items.push('approve');
    if (limitWarn) items.push('limit');
    if (work.working) items.push('work');
    if (timer.running) items.push('timer');
    return items;
  }
  // Which items the chips show. With two or more things going on and Split on, two chips sit side by side (the "lead" first);
  // with three, the second chip rotates through the rest. Otherwise one chip rotates through everything.
  function orderedItems() {
    const items = satItems(), lead = S.split.lead;
    return lead !== 'auto' && items.includes(lead) ? [lead, ...items.filter((k) => k !== lead)] : items;
  }
  function fillChip(el, kind) {                              // returns true when it just appeared or changed
    const labelEl = el.querySelector('.chip-label'), valueEl = el.querySelector('.chip-value'), bar = el.querySelector('.chip-bar i');
    let label = '', value = '', level = '', fill = '';       // fill: bar width in %, '' lets the sliding animation apply
    if (kind === 'approve') {
      label = approvalList.length > 1 ? `Claude asks ×${approvalList.length}` : 'Claude asks';
      value = 'Approve'; level = 'warn';
    } else if (kind === 'work') {
      label = work.count > 1 ? `Claude working ×${work.count}` : 'Claude working';
      value = clockText((Date.now() - work.since) / 1000);
    } else if (kind === 'timer') {
      label = 'Timer';
      value = clockText(Math.ceil(timer.left));
      fill = String(timer.total ? Math.max(0, Math.min(100, (timer.left / timer.total) * 100)) : 0);
    } else {
      label = `${limitWarn.name} limit`;
      value = `${limitWarn.left}% left`;
      level = limitWarn.level;
      fill = String(limitWarn.left);                         // the bar is what is left
    }
    const changed = el.dataset.kind !== kind || !el.classList.contains('on');
    if (labelEl.textContent !== label) labelEl.textContent = label;
    valueEl.textContent = value;
    bar.style.width = fill ? fill + '%' : '';
    el.dataset.kind = kind; el.dataset.level = level;
    el.setAttribute('aria-label', `${label} ${value}`); el.title = `${label} ${value}`;
    el.classList.add('on');
    return changed;
  }
  function renderSat() {
    const items = orderedItems();
    const split = S.split.enabled && items.length >= 2;
    const shown = !items.length ? [] : split ? [items[0], items[1 + (satIndex % (items.length - 1))]] : [items[satIndex % items.length]];
    wrap.dataset.split = split ? '2' : '1';
    [chip, chip2].forEach((el, i) => {
      if (i >= shown.length) { el.classList.remove('on'); el.dataset.kind = ''; return; }
      if (fillChip(el, shown[i]) && !isOpen()) { el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }   // no pop-in while hidden behind the open island
    });
  }
  setInterval(() => { const n = satItems().length; if (n > 2 || (n === 2 && !S.split.enabled)) { satIndex++; renderSat(); } }, 4000);
  // Hovering the chip opens the island (it is inside #wrap), and the open island covers the chip, so a click could
  // never reach it. Switch to the matching page on hover instead.
  // Once the pop-in has played, drop the class: otherwise it replays (and cancels the delayed fade-in) whenever the island closes
  for (const el of [chip, chip2]) {
    el.addEventListener('animationend', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('swap'); });
    el.addEventListener('mouseenter', () => {
      if (S.openOn !== 'hover') return;                                              // in click mode the click does this
      const k = el.dataset.kind;
      if (k === 'limit') go('usage'); else if (k === 'timer') go('timer'); else if (k === 'approve') go('approve');
    });
  }

  // Limit warning: poll the same limits the Usage tab uses (main caches them for a minute, so this is cheap).
  // Warn when 15% or less is left in the 5-hour or weekly window; stay warning until it recovers past 20%.
  async function pollLimits() {
    try {
      const l = await api.limits();
      if (!l || !l.ok) { limitWarn = null; renderSat(); return; }
      const worst = [['5-hour', l.five], ['Weekly', l.week]]
        .filter(([, x]) => x)
        .map(([name, x]) => ({ name, left: Math.max(0, Math.round(100 - x.pct)) }))
        .sort((a, b) => a.left - b.left)[0];
      const threshold = limitWarn ? 20 : 15;                               // hysteresis: no flicker around the line
      limitWarn = worst && worst.left <= threshold ? { ...worst, level: worst.left <= 5 ? 'crit' : 'warn' } : null;
      renderSat();
      checkPace(l);
    } catch { /* keep the previous state */ }
  }

  // Pace: tells you when a window is on course to run out before it resets, and when a limit has reset.
  const paceSeen = {};                                    // per window: { pct, warnedFor (resetsAt) }
  const WIN_NAME = { five: '5-hour', week: 'Weekly' };
  function paceText(kind, f) {                            // "5-hour limit runs out about 16:40", "Weekly limit runs out about Tue 14:00"
    const when = new Date(f.runOutAt);
    const clock = timeFmt.format(when);
    const day = f.runOutAt - Date.now() > 12 * 3600e3 ? when.toLocaleDateString([], { weekday: 'short' }) + ' ' : '';
    return `${WIN_NAME[kind]} limit runs out about ${day}${clock}`;
  }
  function checkPace(l) {
    for (const kind of ['five', 'week']) {
      const x = l[kind]; if (!x) continue;
      const seen = paceSeen[kind] || (paceSeen[kind] = { pct: null, warnedFor: 0 });
      const resetMs = Date.parse(x.resetsAt) || 0;
      if (S.usage.resetAlert && window.DyPace.didReset(seen.pct, x.pct)) pushNotice({ kind: 'done', title: `${WIN_NAME[kind]} limit reset`, sub: 'Claude is fresh again' });
      seen.pct = x.pct;
      const f = window.DyPace.forecast(x, window.DyPace.WINDOWS[kind]);
      if (S.usage.forecast && f && f.willRunOut && Math.abs(resetMs - seen.warnedFor) > 10 * 60000 && f.runOutAt - Date.now() > 60000) {
        seen.warnedFor = resetMs;                         // once per window (the reset time can wobble a little between polls)
        pushNotice({ kind: 'attention', title: 'Claude will run out', sub: paceText(kind, f) });
      }
    }
  }
  pollLimits();
  setInterval(pollLimits, 3 * 60 * 1000);

  // ---------------------------------------------------------------- mode (what the compact pill shows)
  function updateMode() {
    const base = mediaState && mediaState.status === 'Playing' ? 'media' : 'idle';
    // With PILL_SHOWS_STATUS the pill is taken over by Claude working, then a running timer. Otherwise the circle shows them.
    const mode = PILL_SHOWS_STATUS ? (work.working ? 'work' : timer.running ? 'timer' : base) : base;
    if (wrap.dataset.mode !== mode) noteActivity();          // only a real change counts as activity (this runs every second)
    wrap.dataset.mode = mode;
    wrap.dataset.multi = String(mode === 'work' && work.count > 1);
    renderWork();
    renderSat();
    $('.bars').classList.toggle('live', mode === 'media');
  }

  // ---------------------------------------------------------------- music
  const els = {
    title: $('#m-title'), artist: $('#m-artist'), cur: $('#m-cur'), dur: $('#m-dur'),
    img: $('#m-img'), note: $('#m-note'), art: $('#m-art'),
    play: $('#m-play'), playI: $('#m-play-i'), prev: $('#m-prev'), next: $('#m-next'),
    hTitle: $('#h-mu-t'), hArtist: $('#h-mu-a'), hArt: $('#h-mu-art'),
  };
  let art = '', lastKey = '', mediaAt = 0, mediaErr = '';
  let hImg = null;                                        // home art <img>, built once, only its src changes
  const hNote = els.hArt.firstElementChild.cloneNode(true);
  // A cover that fails to decode must never show the browser's broken-image icon: drop it and show the music note
  function badArt(e) { if (!art || (e && e.target && e.target.src !== art)) return; art = ''; renderMedia(); }   // ignore a late error from an older image
  els.img.addEventListener('error', badArt);

  function renderMedia() {
    const m = mediaState;
    const has = !!(m && m.title);
    const playing = has && m.status === 'Playing';
    els.title.textContent = has ? m.title : 'Nothing playing';
    els.artist.textContent = has ? (m.artist || 'Unknown artist') : (mediaErr ? 'Helper error: ' + mediaErr : 'Start music in any player');
    els.artist.title = els.artist.textContent;
    els.hTitle.textContent = has ? m.title : 'Nothing playing';
    els.hArtist.textContent = has ? (m.artist || 'Music') : 'Music';
    els.playI.setAttribute('href', playing ? '#i-pause' : '#i-play');
    els.play.dataset.playing = String(playing);
    [els.play, els.prev, els.next].forEach((b) => { b.disabled = !has; });
    const showArt = has && art;
    els.img.hidden = !showArt; els.note.style.display = showArt ? 'none' : '';
    if (showArt) els.img.src = art;
    // small art tile on home
    if (showArt) {
      if (!hImg) { hImg = document.createElement('img'); hImg.alt = ''; hImg.addEventListener('error', badArt); }
      if (hImg.src !== art) hImg.src = art;
      if (els.hArt.firstChild !== hImg) els.hArt.replaceChildren(hImg);
    } else if (els.hArt.firstChild === hImg || !els.hArt.firstChild) {
      els.hArt.replaceChildren(hNote.cloneNode(true));
    }
    updateMode();
  }

  api.onMedia((m) => {
    mediaErr = m.err || '';
    if (m.none) { mediaState = null; art = ''; lastKey = ''; renderMedia(); return; }
    if (typeof m.art === 'string' && m.art) art = m.art;     // only a real string: an array would stringify into a broken data URL
    if (m.key !== lastKey) {
      if (!m.art) art = '';
      lastKey = m.key;
      els.art.classList.remove('art-swap'); void els.art.offsetWidth; els.art.classList.add('art-swap');   // wobble on track change
      const mt = document.querySelector('.m-text'); if (mt) { mt.classList.remove('txt-swap'); void mt.offsetWidth; mt.classList.add('txt-swap'); }   // and the title slides in
    }
    mediaState = m; mediaAt = performance.now();
    renderMedia();
  });

  const curPos = () => {
    const m = mediaState; if (!m) return 0;
    const p = m.pos + (m.status === 'Playing' ? (performance.now() - mediaAt) / 1000 : 0);
    return m.dur > 0 ? Math.min(p, m.dur) : p;
  };

  els.play.addEventListener('click', () => api.media('toggle'));
  els.prev.addEventListener('click', () => api.media('prev'));
  els.next.addEventListener('click', () => api.media('next'));

  // Wavy progress (the signature): active part waves while playing, flattens when paused
  const cv = $('#wave'), ctx = cv.getContext('2d');
  let amp = 0, phase = 0, lastT = 0;
  function drawWave(t) {
    if (document.documentElement.dataset.motion === 'off') { /* keep the last frame still */ if (cv.width) return; }
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
    const m = mediaState, playing = m && m.status === 'Playing';
    amp += ((playing ? 3 : 0) - amp) * Math.min(1, dt * 8);
    phase += dt * 5;
    const frac = m && m.dur > 0 ? curPos() / m.dur : 0;
    const x = 4 + frac * (w - 8), cy = h / 2;
    ctx.lineCap = 'round'; ctx.lineWidth = 4;
    const css = getComputedStyle(document.documentElement);
    // remaining track
    ctx.strokeStyle = css.getPropertyValue('--md-sys-color-outline-variant');
    ctx.beginPath(); ctx.moveTo(Math.min(w - 4, x + 6), cy); ctx.lineTo(w - 4, cy); ctx.stroke();
    // played wave
    ctx.strokeStyle = css.getPropertyValue('--md-sys-color-primary');
    ctx.beginPath();
    for (let px = 4; px <= x - 4; px += 1) {
      const y = cy + Math.sin(px / 5 - phase) * amp;
      px === 4 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    if (x - 4 < 4) ctx.moveTo(4, cy);
    ctx.stroke();
    // handle
    ctx.fillStyle = css.getPropertyValue('--md-sys-color-primary');
    ctx.beginPath(); ctx.roundRect(x - 2, cy - 8, 4, 16, 2); ctx.fill();
    els.cur.textContent = fmt(curPos()); els.dur.textContent = fmt(m ? m.dur : 0);
  }
  cv.addEventListener('click', (e) => {
    const m = mediaState; if (!m || !(m.dur > 0)) return;
    const r = cv.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left - 4) / (r.width - 8)));
    api.media('seek', f * m.dur);
    mediaState.pos = f * m.dur; mediaAt = performance.now();
  });
  function frame(t) {
    if (isOpen() && wrap.dataset.page === 'music' && !document.hidden) { drawWave(t); requestAnimationFrame(frame); }
    else setTimeout(() => requestAnimationFrame(frame), 250);                 // nothing to draw: wake four times a second, not at the display rate
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- weather
  const WX = (code, day) => {
    if (code === 0) return day ? ['w-sun', 'Clear'] : ['w-moon', 'Clear'];
    if (code <= 2) return ['w-partly', 'Partly cloudy'];
    if (code === 3) return ['w-cloud', 'Overcast'];
    if (code <= 48) return ['w-fog', 'Fog'];
    if (code <= 57) return ['w-rain', 'Drizzle'];
    if (code <= 67) return ['w-rain', 'Rain'];
    if (code <= 77) return ['w-snow', 'Snow'];
    if (code <= 82) return ['w-rain', 'Showers'];
    if (code <= 86) return ['w-snow', 'Snow showers'];
    return ['w-storm', 'Thunderstorm'];
  };
  // Hour labels follow the 12/24-hour setting ("14" or "2p")
  const hourLabel = (hh) => (timeFmt.resolvedOptions().hour12 ? `${hh % 12 || 12}${hh < 12 ? 'a' : 'p'}` : pad(hh));
  const deg = (n) => Math.round(S.units.temp === 'f' ? (n * 9) / 5 + 32 : n) + '°';    // the API gives Celsius
  let city = store.get('city', '');
  const wEl = {
    city: $('#w-city'), cityT: $('#w-city-t'), input: $('#w-input'), icon: $('#w-icon'), temp: $('#w-temp'),
    cond: $('#w-cond'), feels: $('#w-feels'), hum: $('#w-hum'), wind: $('#w-wind'), hours: $('#w-hours'),
    hIcon: $('#h-wx-i'), hT: $('#h-wx-t'), hC: $('#h-wx-c'),
  };

  function renderWeather(w) {
    if (!w || w.error) {
      const msg = { 'no-city': 'Add a city to see the weather', 'not-found': 'City not found', offline: 'Weather unavailable offline' }[w && w.error] || 'Weather unavailable';
      wEl.cond.textContent = msg; wEl.temp.textContent = '--';
      wEl.feels.textContent = wEl.hum.textContent = wEl.wind.textContent = '--';
      wEl.hours.replaceChildren();
      wEl.icon.setAttribute('href', '#w-cloud'); wEl.hIcon.setAttribute('href', '#w-cloud');
      wEl.hT.textContent = city ? '--' : 'Set city';
      wEl.hC.textContent = !city ? 'Weather' : (w && w.error === 'not-found' ? 'City not found' : 'Offline');
      $('.c-temp').textContent = ''; $('.c-wx').classList.remove('on');
      return;
    }
    const c = w.current, day = c.is_day === 1;
    const [icon, text] = WX(c.weather_code, day);
    wEl.cityT.textContent = w.place; wEl.icon.setAttribute('href', '#' + icon);
    wEl.temp.textContent = deg(c.temperature_2m); wEl.cond.textContent = text;
    wEl.feels.textContent = deg(c.apparent_temperature);
    wEl.hum.textContent = Math.round(c.relative_humidity_2m) + '%';
    wEl.wind.textContent = S.units.temp === 'f' ? Math.round(c.wind_speed_10m * 0.621) + ' mph' : Math.round(c.wind_speed_10m) + ' km/h';
    $('#h-wx').dataset.wx = icon;
    wEl.hIcon.setAttribute('href', '#' + icon); wEl.hT.textContent = deg(c.temperature_2m); wEl.hC.textContent = text;
    $('.c-wx use').setAttribute('href', '#' + icon); $('.c-wx').classList.add('on'); $('.c-temp').textContent = deg(c.temperature_2m);

    const h = w.hourly; let i = h.time.indexOf(c.time.slice(0, 13) + ':00'); if (i < 0) i = 0;
    wEl.hours.innerHTML = '';
    for (let k = 0; k < 5; k++) {
      const j = i + k * 2 + 0; if (j >= h.time.length) break;
      const [ic] = WX(h.weather_code[j], h.is_day[j] === 1);
      const d = document.createElement('div'); d.className = 'hour' + (k === 0 ? ' now' : '');
      d.innerHTML = `<span class="label-medium">${k === 0 ? 'Now' : hourLabel(Number(h.time[j].slice(11, 13)))}</span><svg class="i" width="20" height="20"><use href="#${ic}"/></svg><span class="label-medium">${deg(h.temperature_2m[j])}</span>`;
      d.style.setProperty('--n', String(k)); wEl.hours.appendChild(d);
    }
  }
  window.addEventListener('storage', (e) => { if (e.key === 'island.city' && e.newValue && e.newValue !== city) { city = e.newValue; loadWeather(); } });   // another island changed the city
  async function loadWeather() {
    wEl.cityT.textContent = city || 'Set city';
    lastWeather = await api.weather(city);
    renderWeather(lastWeather);
  }
  loadWeather(); setInterval(loadWeather, 15 * 60 * 1000);

  // City editing: the window is unfocusable, so we ask main to make it focusable while typing
  function beginEdit() {
    editing = true; api.input(true);
    wEl.city.hidden = true; wEl.input.hidden = false; wEl.input.value = city; wEl.input.focus(); wEl.input.select();
  }
  function endEdit(save) {
    if (!editing) return;
    editing = false; api.input(false);
    wEl.input.hidden = true; wEl.city.hidden = false;
    if (save && wEl.input.value.trim() && wEl.input.value.trim() !== city) { city = wEl.input.value.trim(); store.set('city', city); loadWeather(); }
    // The pointer may have left while typing: close now, or the island would stay open and keep blocking clicks
    if (!wrap.matches(':hover') && !pinned) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 280); }
  }
  wEl.city.addEventListener('click', beginEdit);
  wEl.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') endEdit(true); if (e.key === 'Escape') endEdit(false); });
  wEl.input.addEventListener('blur', () => endEdit(true));

  // ---------------------------------------------------------------- timer
  const tEl = { time: $('#t-time'), ring: $('#t-ring'), start: $('#t-start'), startI: $('#t-start-i'), startL: $('#t-start-l'), chips: $$('#t-chips .chip'), c: $('.c-time') };
  // The timer is shared between islands (one per monitor): the state travels with an absolute end time
  function pushTimer() { try { api.timerSync && api.timerSync({ total: timer.total, left: timer.left, running: timer.running, endAt: timer.endAt }); } catch { /* single island */ } }
  function applyTimerState(t) {
    if (!t || !Number.isFinite(t.total) || !Number.isFinite(t.left) || t.total < 0 || t.total > 86400) return;
    timer.total = t.total; timer.running = !!t.running; timer.endAt = Number(t.endAt) || 0;
    timer.left = timer.running ? Math.max(0, (timer.endAt - Date.now()) / 1000) : Math.max(0, Math.min(t.total, t.left));
    store.set('timer', timer.total);
    tEl.chips.forEach((o) => o.setAttribute('aria-pressed', String(Number(o.dataset.min) * 60 === timer.total)));
    renderTimer(); updateMode();
  }
  api.onTimer && api.onTimer(applyTimerState);
  function renderTimer() {
    const t = Math.ceil(timer.left);                       // ceil: the last second reads 00:01, not 00:00
    tEl.time.textContent = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    tEl.ring.style.strokeDashoffset = String(100 * (1 - (timer.total ? timer.left / timer.total : 0)));
    tEl.start.dataset.running = String(timer.running);
    tEl.startI.setAttribute('href', timer.running ? '#i-pause' : '#i-play');
    tEl.startL.textContent = timer.running ? 'Pause' : (timer.left < timer.total && timer.left > 0 ? 'Resume' : 'Start');
    if (timer.running && wrap.dataset.mode === 'timer') $('.c-time').textContent = tEl.time.textContent;   // only when the pill is in timer mode
  }
  function chime() {
    if (S.quiet.mute || S.quiet.dnd || !isLead) return;        // muted, do not disturb, or another monitor's island chimes
    try {
      const ac = new AudioContext();
      [880, 1175].forEach((f, i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.frequency.value = f; o.connect(g); g.connect(ac.destination);
        const t0 = ac.currentTime + i * 0.18;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
        o.start(t0); o.stop(t0 + 0.55);
      });
      setTimeout(() => ac.close(), 1200);
    } catch { /* audio unavailable */ }
  }
  function alertDone() {
    if (approvalList.length) { chime(); wrap.classList.remove('alert'); void wrap.offsetWidth; wrap.classList.add('alert'); return; }   // a permission card is waiting: never replace it
    chime(); go('timer'); open(); pinned = true;
    wrap.classList.remove('alert'); void wrap.offsetWidth; wrap.classList.add('alert');
    clearTimeout(pinTimer); pinTimer = setTimeout(() => { pinned = false; if (!wrap.matches(':hover') && !editing) close(); }, 6000);
  }
  setInterval(() => {
    if (!timer.running) return;
    timer.left = Math.max(0, (timer.endAt - Date.now()) / 1000);
    if (timer.left <= 0) { timer.running = false; timer.left = 0; renderTimer(); updateMode(); alertDone(); return; }
    renderTimer();
  }, 250);
  tEl.start.addEventListener('click', () => {
    if (timer.running) { timer.running = false; }
    else {
      if (timer.left <= 0) timer.left = timer.total;
      timer.endAt = Date.now() + timer.left * 1000; timer.running = true;
    }
    renderTimer(); updateMode(); pushTimer();
  });
  $('#t-reset').addEventListener('click', () => { timer.running = false; timer.left = timer.total; renderTimer(); updateMode(); pushTimer(); });
  tEl.chips.forEach((c) => {
    c.setAttribute('aria-pressed', String(Number(c.dataset.min) * 60 === timer.total));
    c.addEventListener('click', () => {
      timer.total = Number(c.dataset.min) * 60; timer.left = timer.total; timer.running = false; store.set('timer', timer.total);
      tEl.chips.forEach((o) => o.setAttribute('aria-pressed', String(o === c)));
      renderTimer(); updateMode(); pushTimer();
    });
  });
  // ---------------------------------------------------------------- usage
  // Limits (% left) come from Claude Code's saved login, token totals from its local logs. Both are read in main.
  // Three views in one page: plan (limits + token total), local (tokens only), empty.
  const uPage = $('#p-usage');
  const uEl = {
    label: $('#u-label'), big: $('#u-big'), sub: $('#u-sub'), hint: $('#u-hint'), pace: $('#u-pace'), bars: $('#u-bars'), emptyText: $('#u-empty-text'),
    t: [1, 2, 3].map((n) => ({ l: $('#u-t' + n + 'l'), v: $('#u-t' + n) })),
    f5: $('#u-f5'), fw: $('#u-fw'), p5: $('#u-p5'), pw: $('#u-pw'),
  };
  const tok = (n) => n < 1000 ? String(n) : n < 1e6 ? (n / 1000).toFixed(n < 1e4 ? 1 : 0) + 'K' : (n / 1e6).toFixed(n < 1e7 ? 2 : 1) + 'M';
  const setTile = (i, label, value) => { uEl.t[i].l.textContent = label; uEl.t[i].v.textContent = value; };
  const inTime = (iso) => {                                   // "2h 10m", "3d 4h", "12m"
    const ms = Date.parse(iso) - Date.now(); if (!iso || !(ms > 0)) return '--';
    const m = Math.round(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m % 60}m` : `${m}m`;
  };
  const pct = (x) => x ? Math.round(x.pct) + '%' : '--';

  const HINTS = {
    nocreds: 'Sign in to Claude Code to see limits',
    expired: 'Login expired. Open Claude Code to refresh',
    unavailable: 'Limits unavailable right now',
  };
  const left = (x) => x ? Math.max(0, Math.round(100 - x.pct)) : null;     // utilization is % used; we show % LEFT
  const leftText = (x) => x ? left(x) + '%' : '--';

  // Numbers count up to their value (Expressive only); otherwise they just appear
  function countTo(el, to, suffix) {
    cancelAnimationFrame(el._raf);
    const from = Number.parseFloat(el.dataset.v);
    el.dataset.v = Number.isFinite(to) ? String(to) : '';
    if (!Number.isFinite(to)) { el.textContent = '--'; return; }
    const start = Number.isFinite(from) ? from : 0;
    if (document.documentElement.dataset.motion !== 'expressive' || start === to) { el.textContent = to + suffix; return; }
    const t0 = performance.now(), dur = 560;
    el.textContent = Math.round(start) + suffix;
    clearTimeout(el._fin); el._fin = setTimeout(() => { if (el.dataset.v === String(to)) el.textContent = to + suffix; }, dur + 120);   // never stuck mid-count (frames can be throttled)
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(start + (to - start) * e) + suffix;
      if (k < 1) el._raf = requestAnimationFrame(step);
    };
    el._raf = requestAnimationFrame(step);
  }
  // l = limits ({five, week, ...}), u = local token usage or null
  function renderPlan(l, u) {
    uPage.dataset.view = 'plan';
    uEl.label.textContent = '5-hour left';
    countTo(uEl.big, l.five ? left(l.five) : NaN, '%');
    uEl.sub.textContent = l.five && l.five.resetsAt ? 'Resets in ' + inTime(l.five.resetsAt) : '';
    uEl.hint.textContent = l.stale ? 'Showing last known limits' : '';
    const pf = [['five', l.five], ['week', l.week]].map(([k, x]) => [k, S.usage.forecast ? window.DyPace.forecast(x, window.DyPace.WINDOWS[k]) : null]).find(([, f]) => f && f.willRunOut && f.runOutAt - Date.now() > 0);
    uEl.pace.textContent = pf ? paceText(pf[0], pf[1]) : '';
    setTile(0, 'Week left', leftText(l.week));
    setTile(1, 'Resets', l.week ? inTime(l.week.resetsAt) : '--');
    setTile(2, 'Tokens 7d', u ? tok(u.week) : '--');                        // just the total, no breakdown
    const sp = $('#u-spark');                                               // ...plus a tiny bar per day
    if (u && Array.isArray(u.days) && u.days.length) {
      const max = Math.max(...u.days, 1);
      sp.replaceChildren(...u.days.map((d, n) => { const b = document.createElement('i'); b.style.setProperty('--n', String(n)); b.style.height = Math.max(2, Math.round(20 * d / max)) + 'px'; return b; }));
    } else sp.replaceChildren();
    uEl.f5.style.width = (left(l.five) || 0) + '%'; uEl.p5.textContent = leftText(l.five);
    uEl.fw.style.width = (left(l.week) || 0) + '%'; uEl.pw.textContent = leftText(l.week);
  }

  function stopCount(el) { cancelAnimationFrame(el._raf); clearTimeout(el._fin); }
  function renderEmpty(why) {
    stopCount(uEl.big);
    uPage.dataset.view = 'empty';
    uEl.label.textContent = 'Claude usage'; uEl.big.textContent = '--'; uEl.sub.textContent = ''; uEl.hint.textContent = ''; uEl.pace.textContent = '';
    uEl.emptyText.textContent = why === 'expired' ? 'Claude Code login expired. Open Claude Code to refresh it' : 'No Claude Code usage found';
  }

  function renderLocal(u, why) {
    stopCount(uEl.big);
    uPage.dataset.view = 'local';
    uEl.hint.textContent = HINTS[why] || ''; uEl.pace.textContent = '';
    uEl.label.textContent = 'Claude Code today';
    setTile(0, 'Last 5 h', tok(u.five)); setTile(1, '7 days', tok(u.week)); setTile(2, 'Top model', u.topModel || '--');
    uEl.big.textContent = tok(u.today);
    uEl.sub.textContent = `tokens, ${u.todayMsgs} ${u.todayMsgs === 1 ? 'message' : 'messages'}`;
    const max = Math.max(...u.days, 1);
    uEl.bars.replaceChildren(...u.days.map((d, i) => {
      const col = document.createElement('div'); col.className = 'u-col' + (i === u.days.length - 1 ? ' today' : ''); col.style.setProperty('--n', String(i));
      const bar = document.createElement('div'); bar.className = 'u-bar'; bar.style.height = Math.max(4, Math.round(32 * d / max)) + 'px';
      const lbl = document.createElement('span'); lbl.className = 'label-medium'; lbl.textContent = u.dayLetters[i] || '';
      col.append(bar, lbl);
      return col;
    }));
  }
  let usageSeq = 0;
  async function loadUsage() {
    const seq = ++usageSeq;                                       // overlapping calls: only the newest one may render
    try {
      const [lim, loc] = await Promise.all([api.limits(), api.usage()]);
      if (seq !== usageSeq) return;
      const local = loc && loc.found ? loc : null;
      if (lim && lim.ok) return renderPlan(lim, local);           // real limits: % left plus the token total
      if (local) return renderLocal(local, lim && lim.reason);    // no limits available: tokens only, with a hint why
      renderEmpty(lim && lim.reason);
    } catch { if (seq === usageSeq) renderEmpty(); }
  }
  setInterval(() => { if (isOpen() && wrap.dataset.page === 'usage') loadUsage(); }, 60000);

  // ---------------------------------------------------------------- notices (Claude finished / needs you, via hook.js)
  const nEl = { root: $('#notice'), icon: $('#n-icon'), title: $('#n-title'), sub: $('#n-sub') };
  const noticeQueue = [];
  let shownNotice = null;                                // the toast on screen (its session is where a click goes)
  let noticeShowing = false, noticeTimer = 0, noticeGap = 0;
  function showNextNotice() {
    clearTimeout(noticeGap);
    if (isOpen() || editing) { noticeGap = setTimeout(showNextNotice, 1000); return; }     // never on top of the open island
    const n = noticeQueue.shift();
    if (!n) { noticeShowing = false; wrap.classList.remove('has-notice'); return; }
    noticeShowing = true; noteActivity(); shownNotice = n;
    if (n.kind === 'done') happyNext = true;                // the mascot is pleased when it comes back
    nEl.root.dataset.kind = n.kind; nEl.root.dataset.tone = n.tone || '';
    nEl.icon.setAttribute('href', n.tone === 'error' ? '#i-warn' : n.kind === 'attention' ? '#i-bell' : '#i-check');
    nEl.title.textContent = n.title; nEl.sub.textContent = n.sub;
    wrap.classList.remove('alert'); void wrap.offsetWidth; wrap.classList.add('alert');     // small wobble
    wrap.classList.add('has-notice');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { wrap.classList.remove('has-notice'); noticeGap = setTimeout(showNextNotice, 500); }, n.duration ? n.duration * 1000 : n.kind === 'attention' ? 8000 : 5000);
  }
  function dismissNotices() {
    noticeQueue.length = 0; noticeShowing = false;
    clearTimeout(noticeTimer); clearTimeout(noticeGap);
    wrap.classList.remove('has-notice');
  }
  function pushNotice(n) {
    if (!n || typeof n.title !== 'string') return;
    if (S.quiet.dnd) return;                                   // do not disturb
    noticeQueue.push({ kind: n.kind === 'attention' ? 'attention' : 'done', tone: ['success', 'warning', 'error', 'info'].includes(n.tone) ? n.tone : '', duration: Number(n.duration) || 0, title: n.title, sub: String(n.sub || ''), session: typeof n.session === 'string' ? n.session.slice(0, 128) : '' });
    if (noticeQueue.length > 5) noticeQueue.shift();
    if (!noticeShowing) showNextNotice();
  }
  api.onNotice(pushNotice);

  // ---------------------------------------------------------------- Claude sessions tab
  $('#ag-list').addEventListener('click', (e) => { const r = e.target.closest('.ag-row[data-sid]'); if (r) openClaudeFor(r.dataset.sid); });
  const STATUS_TEXT = { approval: 'Approve', waiting: 'Needs you', working: 'Working', quiet: 'Quiet', done: 'Done' };
  const ago = (ms) => { const m = Math.floor(ms / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.floor(m / 60) + 'h ago'; };
  function renderAgents() {
    const list = work.list || [], box = $('#ag-list');
    $('#ag-empty').hidden = list.length > 0; box.hidden = list.length === 0;
    const rows = Math.max(1, Math.floor(($('.pages').clientHeight - 32 + 4) / 36));              // as many 32px rows as fit under the header
    const shown = list.slice(0, rows);
    const busy = list.filter((x) => x.status !== 'done').length;
    $('#ag-count').textContent = !list.length ? '' : (busy ? busy + ' active' : 'all done') + (list.length > shown.length ? ' · +' + (list.length - shown.length) + ' more' : '');
    const now = Date.now();
    const sig = shown.map((x) => x.id + ':' + x.status).join();
    if (box.dataset.sig === sig) {                                            // same rows: only the times change
      [...box.children].forEach((row, n) => { const x = shown[n]; row.lastChild.textContent = x.status === 'done' ? ago(now - x.since) : clockText((now - x.since) / 1000); });
      return;
    }
    box.dataset.sig = sig;
    box.replaceChildren(...shown.map((x, n) => {
      const row = document.createElement('div'); row.className = 'ag-row'; row.dataset.st = x.status; if (x.id) row.dataset.sid = x.id; row.title = 'Open the window this session runs in'; row.style.setProperty('--n', String(n));
      const st = document.createElement('span'); st.className = 'ag-st'; st.textContent = STATUS_TEXT[x.status] || x.status;
      const name = document.createElement('span'); name.className = 'ag-name'; name.textContent = x.project || 'Claude Code';
      const t = document.createElement('span'); t.className = 'ag-time';
      t.textContent = x.status === 'done' ? ago(now - x.since) : clockText((now - x.since) / 1000);
      row.append(st, name, t); return row;
    }));
  }
  // A working session that has gone silent (only known when the heartbeat hook is on): tell once per session
  const quietTold = new Set();
  function checkQuiet() {
    const quiet = (work.list || []).filter((x) => x.status === 'quiet');
    for (const x of quiet) {
      const key = x.id + ':' + x.since;
      if (quietTold.has(key)) continue;
      quietTold.add(key);
      if (S.agents.quietAlert) pushNotice({ kind: 'attention', title: 'Claude has gone quiet', sub: (x.project || 'A session') + ' has not reported for a while' });
    }
    if (quietTold.size > 50) quietTold.clear();
  }

  // ---------------------------------------------------------------- Camera / microphone in use
  const privEl = $('#priv');
  api.onPrivacy((s) => {
    const cam = !!(s && s.camera), mic = !!(s && s.mic);
    privEl.querySelector('.p-cam').hidden = !cam; privEl.querySelector('.p-mic').hidden = !mic;
    privEl.hidden = !(cam || mic);
    const what = cam && mic ? 'Camera and microphone in use' : cam ? 'Camera in use' : mic ? 'Microphone in use' : '';
    privEl.setAttribute('aria-label', what); privEl.title = what;
  });

  // ---------------------------------------------------------------- Claude Code permission requests (approve-hook.js)
  // The island opens by itself on the request and stays open until it is answered. The answer goes back to the hook.
  // After the list changes, buttons ignore clicks for half a second, so a double-click can never answer the NEXT request unseen.
  let apprPrevPage = 'home', apprWasOpen = false;
  const apEl = { title: $('#ap-title'), count: $('#ap-count'), tool: $('#ap-tool'), proj: $('#ap-proj'), detail: $('#ap-detail'), extra: $('#ap-extra') };
  function renderApproval() {
    const a = approvalList[0]; if (!a) return;
    apEl.tool.textContent = a.tool || 'Tool';
    apEl.proj.textContent = a.project || '';
    apEl.detail.textContent = a.detail || '(no details)';
    apEl.detail.title = a.detail || '';
    $('#ap-allow').disabled = true;                                           // until the text is measured (below)
    apEl.extra.textContent = a.extra || '';
    const measure = () => {                                             // a command longer than the card shows: say so, and do not offer Allow for it
      if (approvalList[0] !== a) return;
      const cut = apEl.detail.scrollHeight > apEl.detail.clientHeight + 1;
      const hidden = cut || apEl.detail.textContent.endsWith('…');
      $('.ap-card').classList.toggle('cut', hidden); $('#ap-ask').textContent = hidden ? 'Read in terminal' : 'Ask in terminal';
      $('#ap-allow').disabled = hidden;                                          // Allow only for what you can read in full
    };
    measure(); setTimeout(measure, 450);                                 // now, and again once the island has finished opening
    apEl.count.textContent = approvalList.length > 1 ? `· 1 of ${approvalList.length}` : '';
  }
  function setApprovals(list) {
    const before = approvalList.map((x) => x.id).join(), had = approvalList.length;
    approvalList = (Array.isArray(list) ? list : []).filter((x) => x && typeof x.id === 'number').slice(0, 8)
      .map((x) => ({ id: x.id, session: typeof x.session === 'string' ? x.session : '', project: String(x.project || ''), tool: String(x.tool || ''), detail: String(x.detail || ''), extra: String(x.extra || '') }));
    if (approvalList.map((x) => x.id).join() === before) return;
    renderSat();
    if (approvalList.length) {
      apprLockUntil = Date.now() + 500;
      renderApproval();
      if (!had) { apprWasOpen = isOpen() && wrap.dataset.page !== 'approve'; apprPrevPage = wrap.dataset.page === 'approve' ? 'home' : wrap.dataset.page; chime(); }
      if (approvalList.length > had) { wrap.classList.remove('alert'); void wrap.offsetWidth; wrap.classList.add('alert'); dismissNotices(); noteActivity(); go('approve'); clearTimeout(pinTimer); open(); updateVisibility(); }
    } else {
      if (wrap.dataset.page === 'approve') go(apprPrevPage);
      if (!wrap.matches(':hover') && !editing && !pinned) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 500); }       // nobody is on it: it was only open for the request
      updateVisibility();
    }
  }
  api.onApprovals(setApprovals);
  Promise.resolve(api.approvals && api.approvals()).then((l) => { if (l && l.length) setApprovals(l); }).catch(() => {});
  for (const [id, behavior] of [['ap-allow', 'allow'], ['ap-deny', 'deny'], ['ap-ask', 'ask']]) {
    $('#' + id).addEventListener('click', () => {
      const a = approvalList[0]; if (!a || Date.now() < apprLockUntil) return;
      api.approve(a.id, behavior);
      if (behavior === 'ask') openClaudeFor(a.session);                          // "Ask in terminal": and take me to that terminal
    });
  }

  api.onWorking((s) => {
    if (!s || typeof s.since !== 'number') return;
    work = { working: !!s.working, since: s.since, count: Number(s.count) || 0, list: Array.isArray(s.list) ? s.list : [] };
    checkQuiet();
    renderAgents();
    updateMode();
  });

  // ---------------------------------------------------------------- settings button (the window itself is created in main)
  const gear = $('#settings-btn');
  gear.addEventListener('click', () => api.toggleSettings());
  api.onSettingsState((open) => {
    settingsOpen = open;
    gear.setAttribute('aria-pressed', String(open));
    if (open) { clearTimeout(closeTimer); return; }
    if (!wrap.matches(':hover') && !editing) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 280); }
  });

  // ---------------------------------------------------------------- Quick actions tray (hover or right-click the settings button)
  const tray = $('#qtray');
  let trayOpenT = 0, trayCloseT = 0, quitArm = 0;
  const THEME_NEXT = { auto: 'light', light: 'dark', dark: 'auto' }, THEME_NAME = { auto: 'Auto', light: 'Light', dark: 'Dark' };
  function renderTray() {
    const q = (k) => tray.querySelector('[data-q="' + k + '"]');
    const set = (k, on) => q(k).setAttribute('aria-checked', String(!!on));
    set('awake', awakeBtn.getAttribute('aria-pressed') === 'true'); set('dnd', S.quiet.dnd); set('mute', S.quiet.mute);
    q('theme').querySelector('.ql').textContent = 'Theme: ' + THEME_NAME[S.theme.mode];
    q('clip').hidden = !S.clipboard.enabled;
    q('dns').hidden = !S.dns.tile; setDnsTile();
    q('dnd').querySelector('.ql').textContent = S.quiet.dnd ? 'Disturb me' : 'Do not disturb';
    gear.toggleAttribute('data-dnd', !!S.quiet.dnd);
  }
  // NextDNS tile: its state comes from the main process (registry read, no rights needed)
  let dnsState = 'notinstalled', dnsBusyUi = false;
  const DNS_LABEL = { on: 'NextDNS on', off: 'NextDNS off', notinstalled: 'Set up DNS', custom: 'DNS: custom', mixed: 'DNS: mixed', unencrypted: 'NextDNS: no DoH', absent: 'DNS: no link', failed: 'DNS: failed', busy: 'Switching...' };
  function setDnsTile() {
    const t = tray.querySelector('[data-q="dns"]'); if (!t) return;
    const st = dnsBusyUi ? 'busy' : dnsState;
    t.querySelector('.ql').textContent = DNS_LABEL[st] || 'DNS';
    t.setAttribute('aria-checked', String(st === 'on'));
    t.title = st === 'notinstalled' ? 'Set up the DNS switch (asks for administrator approval once)' : st === 'custom' ? 'DNS was changed by hand. Click to restore NextDNS' : 'Turn NextDNS on or off';
  }
  async function refreshDns() {
    if (!S.dns.tile || !api.dnsStatus) return;
    try { const r = await api.dnsStatus(); if (r && typeof r.state === 'string') dnsState = r.state; } catch { /* keep the last state */ }
    setDnsTile();
  }
  function showTray() { clearTimeout(trayCloseT); if (!isOpen() || settingsOpen) return; refreshDns(); renderTray(); tray.hidden = false; void tray.offsetWidth; tray.classList.add('show'); }
  function hideTray() { clearTimeout(trayOpenT); clearTimeout(trayCloseT); tray.classList.remove('show'); quitArm = 0; tray.querySelector('[data-q="quit"]').classList.remove('armed'); tray.querySelector('[data-q="quit"] .ql').textContent = 'Quit'; trayCloseT = setTimeout(() => { if (!tray.classList.contains('show')) tray.hidden = true; }, 300); }
  gear.addEventListener('mouseenter', () => { clearTimeout(trayCloseT); trayOpenT = setTimeout(showTray, 350); });
  gear.addEventListener('mouseleave', () => { clearTimeout(trayOpenT); trayCloseT = setTimeout(hideTray, 280); });
  tray.addEventListener('mouseenter', () => clearTimeout(trayCloseT));
  tray.addEventListener('mouseleave', () => { trayCloseT = setTimeout(hideTray, 280); });
  gear.addEventListener('contextmenu', (e) => { e.preventDefault(); showTray(); });
  gear.addEventListener('click', () => { clearTimeout(trayOpenT); hideTray(); });          // opening Settings: the tray gets out of the way
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tray.classList.contains('show')) hideTray(); });
  tray.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const k = b.dataset.q;
    if (k === 'awake') toggleAwake();
    else if (k === 'dnd') api.setSettings({ quiet: { dnd: !S.quiet.dnd } });
    else if (k === 'mute') api.setSettings({ quiet: { mute: !S.quiet.mute } });
    else if (k === 'theme') api.setSettings({ theme: { mode: THEME_NEXT[S.theme.mode] } });
    else if (k === 'clip') api.clipboardClear();
    else if (k === 'dns') {
      if (dnsBusyUi) return;
      if (dnsState === 'notinstalled') { api.dnsSetup(); return; }                  // one-time setup: Windows asks for approval
      dnsBusyUi = true; setDnsTile();
      Promise.resolve(api.dnsToggle()).then((r) => { if (r && typeof r.state === 'string') dnsState = r.state; }).catch(() => {}).finally(() => { dnsBusyUi = false; setDnsTile(); });
    }
    else if (k === 'pause') { hideTray(); pinned = false; close(true); api.capture(false); api.pauseIsland(60); }
    else if (k === 'restart') api.restartApp();
    else if (k === 'quit') {                                                      // tap twice: the second tap within 3 s quits
      if (quitArm && Date.now() - quitArm < 500) return;                           // the second half of a double-click
      if (!quitArm) { quitArm = Date.now(); b.classList.add('armed'); b.querySelector('.ql').textContent = 'Tap again'; setTimeout(() => { if (quitArm && Date.now() - quitArm >= 2900) { quitArm = 0; b.classList.remove('armed'); b.querySelector('.ql').textContent = 'Quit'; } }, 3000); }
      else api.quitApp();
    }
  });

  // ---------------------------------------------------------------- Which edge and monitor this island window lives on
  let isLead = false;                                      // the lead island plays the chimes (so several monitors do not chime in chorus)
  function applyWindowInfo(info) {
    if (!info) return;
    const edge = ['top', 'left', 'right'].includes(info.edge) ? info.edge : 'top';
    document.documentElement.dataset.edge = edge;
    isLead = info.lead !== false;
    hideTray();
  }
  Promise.resolve(api.windowInfo && api.windowInfo()).then(applyWindowInfo).catch(() => {});
  api.onWindowInfo && api.onWindowInfo(applyWindowInfo);

  // ---------------------------------------------------------------- Settings applied live: size, theme, tabs, units
  function visibleTabs() { return S.tabs.filter((t) => !S.hiddenTabs.includes(t)); }
  let appliedNavKey = '';
  function rebuildNav() {
    const vis = DyTabs.buildNav($('.nav'), S.tabs, S.hiddenTabs, wrap.dataset.page);
    if (!vis.includes(wrap.dataset.page) && wrap.dataset.page !== 'approve') go(vis[0] || 'home');       // the approval card is not a tab: do not knock it away
  }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionMode = () => (reduceMotion.matches ? 'off' : S.motion || 'expressive');
  function applyMotion() { document.documentElement.dataset.motion = motionMode(); }
  reduceMotion.addEventListener('change', applyMotion);
  function applySettings(s) {
    if (!s || !s.size) return;
    S = s;
    const r = document.documentElement.style;
    applyMotion();
    r.setProperty('--idle-w', s.size.idle.w + 'px'); r.setProperty('--idle-h', s.size.idle.h + 'px');
    r.setProperty('--open-w', s.size.open.w + 'px'); r.setProperty('--open-h', s.size.open.h + 'px');
    if (window.DyTheme) window.DyTheme.apply(s.theme);
    const o = { hour: 'numeric', minute: '2-digit' };
    if (s.units.clock === '12') o.hour12 = true; else if (s.units.clock === '24') o.hour12 = false;
    timeFmt = new Intl.DateTimeFormat(undefined, o);
    const navKey = JSON.stringify([s.tabs, s.hiddenTabs]);
    if (navKey !== appliedNavKey) { appliedNavKey = navKey; rebuildNav(); }
    if (cal) cal.render();
    tickClock();
    if (lastWeather) renderWeather(lastWeather);
    renderClipboard(cbItems);
    applyHome();
    renderTray();
    syncMascot(); updateVisibility();
  }

  // ---------------------------------------------------------------- Home layout (Settings > Home): calendar, and up to two cards
  const cdEl = { card: $('#h-cd'), t: $('#h-cd-t'), l: $('#h-cd-l') };
  function renderCountdown() {
    const { label, date } = S.home.countdown;
    cdEl.l.textContent = label || 'Countdown';
    if (!date) { cdEl.t.textContent = 'Set a date'; return; }
    const [y, m, d] = date.split('-').map(Number);
    const n = Math.round((new Date(y, m - 1, d) - new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())) / 86400000);   // calendar days, DST-safe via rounding
    cdEl.t.textContent = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 ? n + ' days' : n === -1 ? 'Yesterday' : -n + ' days ago';
  }
  cdEl.card.addEventListener('click', () => { if (!S.home.countdown.date) api.toggleSettings(); });
  function applyHome() {
    const home = $('#p-home'), h = S.home;
    home.dataset.cal = h.calendar ? 'on' : 'off'; home.dataset.side = h.side;
    const cards = { weather: $('#h-wx'), music: $('#h-mu'), countdown: cdEl.card };
    Object.values(cards).forEach((el) => { el.hidden = true; delete el.dataset.slot; });
    [h.first, h.second].forEach((id, i) => { const el = cards[id]; if (!el) return; el.hidden = false; el.dataset.slot = String(i + 1); el.style.order = String(i); });
    renderCountdown();
  }
  setInterval(renderCountdown, 5 * 60 * 1000);

  // ---------------------------------------------------------------- Home: calendar, battery, keep-awake
  cal = window.DyCalendar.mount($('#h-cal'), { getWeekStart: () => S.calendar.weekStart });

  const battEl = { chip: $('#h-batt'), icon: $('#h-batt-i'), text: $('#h-batt-t') };
  let battWarned = false;
  function renderBattery(b) {
    const pct = Math.round(b.level * 100);
    const noBattery = b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity;   // a desktop PC reports "full and plugged in"
    battEl.chip.hidden = noBattery;
    battEl.text.textContent = pct + '%';
    battEl.icon.setAttribute('href', b.charging ? '#i-bolt' : '#i-batt');
    battEl.chip.classList.toggle('low', !b.charging && pct <= 15);
    battEl.chip.title = b.charging ? 'Charging' : 'On battery';
    if (!b.charging && pct <= 15 && !battWarned && S.battery.warn) { battWarned = true; pushNotice({ kind: 'attention', title: 'Battery low', sub: pct + '% left. Plug in soon' }); }
    if (b.charging || pct > 20) battWarned = false;
  }
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const u = () => renderBattery(b);
      b.addEventListener('levelchange', u); b.addEventListener('chargingchange', u); u();
    }).catch(() => { /* no battery info on this machine */ });
  }

  const awakeBtn = $('#h-awake');
  async function toggleAwake() {
    const want = awakeBtn.getAttribute('aria-pressed') !== 'true';
    const on = await api.setKeepAwake(want);
    awakeBtn.setAttribute('aria-pressed', String(!!on));
    awakeBtn.title = on ? 'Keeping the PC awake (click to stop)' : 'Keep the PC awake';
    renderTray();
  }
  awakeBtn.addEventListener('click', toggleAwake);
  function showAwake(on) { awakeBtn.setAttribute('aria-pressed', String(!!on)); awakeBtn.title = on ? 'Keeping the PC awake (click to stop)' : 'Keep the PC awake'; renderTray(); }
  api.onAwake && api.onAwake(showAwake);
  Promise.resolve(api.awakeGet && api.awakeGet()).then((on) => { if (on) showAwake(true); }).catch(() => {});

  // ---------------------------------------------------------------- Clipboard history tab (opt-in)
  const cb = { list: $('#cb-list'), empty: $('#cb-empty'), clear: $('#cb-clear') };
  let cbItems = [], copiedText = '', copiedUntil = 0;
  function renderClipboard(list) {
    cbItems = Array.isArray(list) ? list : [];
    const room = Math.max(1, Math.floor(($('.pages').clientHeight - 32 + 4) / 32));          // 28px rows, 4px gap, under a 24px header
    cb.list.replaceChildren(...cbItems.slice(0, room).map((t, i) => {
      const b = document.createElement('button'); b.className = 'cb-item sl' + (t === copiedText && Date.now() < copiedUntil ? ' copied' : ''); b.dataset.i = String(i); b.style.setProperty('--n', String(i)); b.title = t.slice(0, 300);
      const s = document.createElement('span'); s.textContent = t.replace(/\s+/g, ' ').trim() || '(blank)';
      b.append(s); return b;
    }));
    cb.empty.hidden = cbItems.length > 0; cb.list.hidden = cbItems.length === 0;
  }
  cb.list.addEventListener('click', async (e) => {
    const b = e.target.closest('.cb-item'); if (!b) return;
    const text = cbItems[Number(b.dataset.i)];
    copiedText = text; copiedUntil = Date.now() + 1200;                         // remembered by text: the list is rebuilt when the copy lands
    if (await api.clipboardCopy(Number(b.dataset.i))) { renderClipboard(cbItems); setTimeout(() => renderClipboard(cbItems), 1250); }
  });
  cb.clear.addEventListener('click', () => api.clipboardClear());
  api.onClipboard(renderClipboard);

  // ---------------------------------------------------------------- Auto-hide (see visibility.js) and the global hotkey
  function updateVisibility() {
    const v = window.DyVisibility.computeVisibility({
      autoHide: S.autoHide, hideInFullscreen: false, fullscreen: false,           // full-screen hiding is done by main, on the whole window
      near, hovering: hoverFlag, open: isOpen(), settingsOpen,
      toast: wrap.classList.contains('has-notice'), alert: pinned, hotkeyReveal,
    });
    wrap.classList.toggle('autohidden', !v.island);
  }
  setInterval(updateVisibility, 120);
  api.onNear((v) => { near = v; updateVisibility(); });
  api.onHotkey((wantOpen) => {
    clearTimeout(hotkeyTimer);
    if (typeof wantOpen === 'boolean' && wantOpen === isOpen()) { if (wantOpen) { /* already open: just keep it up a while */ } else return; }
    if (typeof wantOpen === 'boolean' ? !wantOpen : isOpen()) { if (editing) endEdit(false); hotkeyReveal = false; pinned = false; close(true); updateVisibility(); return; }   // pressed again: close it (and let go of the keyboard if the city box had it)
    hotkeyReveal = true; pinned = true; noteActivity(); open(); updateVisibility();
    hotkeyTimer = setTimeout(() => { hotkeyReveal = false; pinned = false; if (!wrap.matches(':hover') && !editing) close(); updateVisibility(); }, 8000);
  });

  // ---------------------------------------------------------------- Mascot: cylinder eyes while the island idles
  const mascot = window.DyMascot.create($('#mascot'));
  function noteActivity() { idleSince = Date.now(); }
  const isNight = () => { const h = new Date().getHours(); return h >= 23 || h < 6; };
  // Clicking the eyes pets them (and does not open the island); a click anywhere else on the pill still opens it
  function eyesHit(e) {
    const r = [...document.querySelectorAll('#mascot .eye')].map((x) => x.getBoundingClientRect());
    if (!r.length) return false;
    const l = Math.min(...r.map((b) => b.left)) - 10, rt = Math.max(...r.map((b) => b.right)) + 10, t = Math.min(...r.map((b) => b.top)) - 8, b2 = Math.max(...r.map((b) => b.bottom)) + 8;
    return e.clientX >= l && e.clientX <= rt && e.clientY >= t && e.clientY <= b2;
  }
  wrap.addEventListener('click', (e) => {
    if (!eyesOn || isOpen() || !eyesHit(e) || mascot.isStill()) return;       // static eyes (reduced motion / Animations off): a click just opens the island
    e.stopImmediatePropagation();                                                  // registered first on the wrap: runs before the open handler
    mascot.pet();                                                                  // no noteActivity(): that would switch the eyes off at once
  }, true);
  function syncMascot() {
    const want = S.mascot.enabled && wrap.dataset.mode === 'idle' && satItems().length === 0 && !isOpen() && !document.hidden
      && !wrap.classList.contains('has-notice') && !wrap.classList.contains('autohidden')
      && Date.now() - idleSince >= S.mascot.delay * 1000;
    if (want && !eyesOn) {
      eyesOn = true; wrap.dataset.eyes = 'on'; mascot.setNight(isNight()); mascot.start(); api.mascotWatch(true);
      if (happyNext) { happyNext = false; mascot.react('happy'); }
    } else if (!want && eyesOn) {
      eyesOn = false; delete wrap.dataset.eyes; mascot.stop(); api.mascotWatch(false);
    }
  }
  setInterval(syncMascot, 500);
  api.onGaze((g) => { if (g) mascot.lookAt(g.nx, g.ny); });

  applySettings(FALLBACK);
  Promise.resolve(api.getSettings()).then(applySettings).catch(() => { /* keep the built-in defaults */ });
  api.onSettings(applySettings);
  Promise.resolve(api.clipboardList && api.clipboardList()).then(renderClipboard).catch(() => {});

  renderTimer(); renderMedia();
})();
