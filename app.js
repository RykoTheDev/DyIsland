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
    tabs: ['home', 'music', 'weather', 'timer', 'usage', 'clipboard', 'localsend'], hiddenTabs: ['clipboard', 'localsend'],
    mascot: { enabled: true, delay: 8 }, clipboard: { enabled: false, max: 12 }, battery: { warn: true },
    units: { temp: 'c', clock: 'auto' }, calendar: { weekStart: 'auto' }, usage: { forecast: true, resetAlert: true }, approvals: { enabled: true, wait: 30 }, agents: { quietAlert: false }, split: { enabled: true, lead: 'auto' },
    privacy: { dot: true },
    home: { calendar: true, side: 'left', first: 'weather', second: 'music', countdown: { label: '', date: '' } },
  };
  let S = FALLBACK;
  let timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  let lastWeather = null, cal = null, lastDay = '';
  // pointer / visibility / mascot state, declared up here because the first clock tick already runs the code that reads it
  let evList = [], evByDay = new Map();                    // calendar events from the link in Settings (main reads and parses it)
  let privNow = { camera: false, mic: false };            // camera / microphone in use right now
  let lastHm = '', near = false, hoverFlag = false, hotkeyReveal = false, hotkeyTimer = 0, idleSince = Date.now(), eyesOn = false, happyNext = true;

  // ---------------------------------------------------------------- elements (easing curves live in styles.css)
  const wrap = $('#wrap');
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

  // ---------------------------------------------------------------- the keyboard
  // The island window never takes the keyboard by itself. It asks for it (api.input) while the hotkey has opened it or the city box is being typed in,
  // and lets go again when the last reason is gone: main then hands the focus back to the window you were in.
  const keyHold = new Set();
  function grabKeys(why) { if (keyHold.has(why)) return; const was = keyHold.size; keyHold.add(why); if (!was) api.input(true); }
  function releaseKeys(why) { if (!keyHold.delete(why)) return; if (!keyHold.size) api.input(false); }

  // ---------------------------------------------------------------- open / close
  // The content entrance plays only when the island was fully collapsed. Re-entering mid-close
  // keeps the content as it is, so a quick hover in and out never makes anything jump.
  let vtActive = false;
  let closeTimer = 0, settleTimer = 0, animTimer = 0, settled = true, editing = false, pinned = false, pinTimer = 0, settingsOpen = false;
  const isOpen = () => wrap.classList.contains('open');
  // Do not disturb = your own switch, or (Settings > Alerts > Quiet during calls) the camera / microphone being in use. Never written back to the settings.
  const isDnd = () => !!S.quiet.dnd || !!(S.meetings && S.meetings.dnd && (privNow.camera || privNow.mic));
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
    markMailSeen(); tickAgo(); refreshStale();
  }
  function close(force) {
    if (typeof hideTray === 'function') hideTray();
    if (!force && approvalList.length && wrap.dataset.page === 'approve') return;     // an open request keeps the card up until it is answered
    wrap.classList.remove('open'); releaseKeys('hotkey'); api.capture(wrap.matches(':hover'));      // click-through again, unless the pointer is still on it (no mouseenter will fire to take it back)
    noteActivity();                                        // idling starts when the island closes, not when the hover began
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settled = true; }, 300);
  }

  // "On click" (the default): the pointer only wakes the island (so it can be clicked); a click opens it. "On hover": hovering opens it.
  // Hover mode waits ~110 ms of dwell before it opens, so a pointer only passing over the pill does not pop it open
  let hoverT = 0;
  wrap.addEventListener('mouseenter', () => {
    if (!isOpen()) mascot.react('curious');
    hoverFlag = true; api.capture(true); if (isOpen()) clearTimeout(closeTimer); if (!approvalList.length) pinned = false; if (!(eyesOn && S.openOn === 'click')) noteActivity();
    if (S.openOn === 'hover' && !wrap.classList.contains('has-notice') && !isOpen()) { clearTimeout(hoverT); hoverT = setTimeout(() => { if (hoverFlag && !isOpen()) { open(); updateVisibility(); } }, 110); }
    updateVisibility();
  });
  // Toast about a Claude session ("needs you" / "finished"): a click goes to the window that session runs in
  function openClaudeFor(session) {
    Promise.resolve(api.focusClaude && api.focusClaude(session)).then((r) => {
      if (!r || !r.ok) pushNotice({ kind: 'attention', title: "Couldn't find Claude's window", sub: 'Open it yourself; it did not match a terminal or the app' });
    }).catch(() => {});
  }
  wrap.addEventListener('click', (e) => {
    if (Date.now() - swipedAt < 450) return;                  // that click was the end of a flick that dismissed a toast
    if (wrap.classList.contains('has-notice') && !isOpen() && e.target.closest('.notice') && shownNotice && shownNotice.session) {
      dismissNotices(); openClaudeFor(shownNotice.session); return;
    }
    if (wrap.classList.contains('has-notice') && !isOpen() && e.target.closest('.notice') && shownNotice && shownNotice.act) {     // a mirrored Windows notification: open the app that sent it
      const a = shownNotice.act; dismissNotices(); if (api.noticeOpen) api.noticeOpen(a); return;
    }
    if (S.openOn === 'hover' || isOpen()) return;
    const hit = e.target.closest('.stchip'), k = hit && hit.dataset.kind;           // clicking a status chip lands on its page
    if (k === 'event') { const ev = evList.find((x) => x.id === hit.dataset.ev); if (ev && ev.link) { api.openEvent(ev.id); return; } go('home'); }
    else if (k === 'limit') go('usage'); else if (k === 'timer') go('timer'); else if (k === 'approve') go('approve');
    open(); updateVisibility();
  });
  // Open and meant to stay open: an alert/hotkey pin, typing in the city box, or a permission card that is waiting for an answer
  const keepOpen = () => editing || pinned || (approvalList.length > 0 && wrap.dataset.page === 'approve');
  wrap.addEventListener('mouseleave', () => {
    if (vtActive) return;                                    // a view transition is running: its overlay is not the pointer leaving
    hoverFlag = false; clearTimeout(hoverT); updateVisibility();
    if (keepOpen() || settingsOpen) { api.capture(false); return; }      // stays open, but the pointer is gone: let clicks through to what is underneath
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, 240);
  });

  // Mouse gestures on the closed pill: middle-click plays / pauses, right-click opens it with the quick actions
  wrap.addEventListener('auxclick', (e) => { if (e.button === 1 && !isOpen()) { e.preventDefault(); api.media('toggle'); } });
  wrap.addEventListener('contextmenu', (e) => { if (isOpen()) return; e.preventDefault(); open(); updateVisibility(); setTimeout(() => { if (isOpen()) showTray(); }, 480); });
  // Mouse wheel over the tab bar switches tabs
  let wheelAt = 0;
  document.addEventListener('wheel', (e) => {
    if (!isOpen() || !e.target.closest || !e.target.closest('.nav') || Math.abs(e.deltaY) < 4 || Date.now() - wheelAt < 170 || wrap.dataset.page === 'approve') return;
    wheelAt = Date.now(); stepTab(e.deltaY > 0 ? 1 : -1);
  }, { passive: true });

  // ---------------------------------------------------------------- pages
  const EXTRA_PAGES = ['approve', 'network', 'mixer'];            // pages that are not tabs: they open from a card, a tray tile or an alert
  function go(name) {
    const vis = visibleTabs();
    if (!EXTRA_PAGES.includes(name) && !vis.includes(name)) name = vis[0] || 'home';        // a tab you switched off in Settings can never be opened (the approval card is not a tab)
    { const order = [...visibleTabs(), ...EXTRA_PAGES], from = order.indexOf(wrap.dataset.page), to = order.indexOf(name); wrap.dataset.dir = from >= 0 && to >= 0 && to < from ? 'back' : 'fwd'; }   // pages slide the way you travelled
    if (name === 'approve') apprLockUntil = Date.now() + 500;                       // a click meant for the page you just left must not answer a request
    $$('.page').forEach((p) => p.classList.toggle('active', p.dataset.page === name));
    $$('.nav [data-tab-btn]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.go === name)));
    wrap.dataset.page = name;
    if (!EXTRA_PAGES.includes(name)) store.set('lastTab', name);
    applyPageSize();
    animatePage($('#p-' + name));
    if (name === 'usage') { const b = $('#u-big'); if (b) b.dataset.v = '0'; loadUsage(); }
    if (window.DyFeat) window.DyFeat.onPage(name);       // the percentage counts up each time you arrive
  }
  // The Home cards fly their icon or cover into the page they open (View Transitions API: the cover really travels, instead of two pages cross-fading).
  // The browser puts a screenshot layer over the page while it runs, so mouse-leave is ignored until it ends (vtActive).
  const vtOK = () => typeof document.startViewTransition === 'function' && document.documentElement.dataset.motion === 'expressive' && isOpen();
  function goShared(name, srcEl, dstFn) {
    if (!vtOK() || !srcEl) return go(name);
    vtActive = true;
    srcEl.style.viewTransitionName = 'shared';
    let dst = null;
    const t = document.startViewTransition(() => { srcEl.style.viewTransitionName = ''; go(name); dst = dstFn(); if (dst) dst.style.viewTransitionName = 'shared'; });
    const end = () => { if (dst) dst.style.viewTransitionName = ''; srcEl.style.viewTransitionName = ''; vtActive = false; hoverFlag = wrap.matches(':hover'); if (!wrap.matches(':hover') && !keepOpen() && !settingsOpen) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 240); } };
    t.finished.then(end, end);
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-go]');
    if (!t) return;
    if (t.id === 'h-mu' && t.dataset.go === 'music') goShared('music', $('#h-mu-art'), () => $('#m-art'));
    else if (t.id === 'h-wx' && t.dataset.go === 'weather') goShared('weather', $('#h-wx .tile'), () => $('#w-icon').closest('svg'));
    else go(t.dataset.go);
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
  let slots = [window.DyTimers.create(300), window.DyTimers.create(300), window.DyTimers.create(300)], cur = 0;   // the three timers and the one on the Timer page (set up in the timers section)
  const anyRunning = () => slots.some((s) => s.running);
  // what the status chip shows: the countdown that ends first (or the stopwatch), and how many are running
  function chipTimer() {
    const now = Date.now(), run = slots.filter((s) => s.running);
    if (!run.length) return null;
    const down = run.filter((s) => s.mode !== 'stopwatch').sort((x, y) => window.DyTimers.seconds(x, now) - window.DyTimers.seconds(y, now));
    return { s: down[0] || run[0], n: run.length, now };
  }

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
    if (anyRunning()) items.push('timer');
    if (soonEvent()) items.push('event');
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
    } else if (kind === 'event') {
      const ev = soonEvent(), mins = ev ? Math.max(0, Math.ceil((ev.start - Date.now()) / 60000)) : 0;
      label = ev ? ev.title.slice(0, 22) : 'Event'; value = mins <= 0 ? 'now' : 'in ' + mins + ' min';
      level = mins <= 5 ? 'warn' : ''; fill = String(Math.max(4, Math.min(100, 100 - (mins / 15) * 100)));
      el.dataset.ev = ev ? ev.id : '';
    } else if (kind === 'timer') {
      const ct = chipTimer();
      if (ct) {
        const s = ct.s, TMc = window.DyTimers;
        label = ct.n > 1 ? 'Timers \u00d7' + ct.n : s.mode === 'pomodoro' ? (s.phase === 'focus' ? 'Focus' : 'Break') : s.mode === 'stopwatch' ? 'Stopwatch' : 'Timer';
        value = clockText(s.mode === 'stopwatch' ? TMc.seconds(s, ct.now) : Math.ceil(TMc.seconds(s, ct.now)));
        fill = String(Math.round(TMc.fraction(s, ct.now) * 100));
      }
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
    const mode = PILL_SHOWS_STATUS ? (work.working ? 'work' : anyRunning() ? 'timer' : base) : base;
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
    shuf: $('#m-shuf'), rep: $('#m-rep'),
    hTitle: $('#h-mu-t'), hArtist: $('#h-mu-a'), hArt: $('#h-mu-art'),
  };
  let art = '', lastKey = '', mediaAt = 0, mediaErr = '';
  els.artPrev = $('#m-img-prev');
  const wasHidden = (el) => el.hidden;
  els.img.addEventListener('animationend', () => { els.artPrev.hidden = true; });
  // ---- The island takes its colours from the cover of what is playing (Settings > Display). Local to this page: nothing is saved or broadcast.
  // Not under a named theme (Nord, Catppuccin...): those keep their own palette.
  let artSeed = null, artSeedFor = '';
  function seedFromArt(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas'); c.width = c.height = 32;
          const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 32, 32);
          const px = g.getImageData(0, 0, 32, 32).data, bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
          for (let i = 0; i < px.length; i += 4) {
            const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), d = mx - mn;
            if (px[i + 3] < 200 || mx < 0.2 || mx > 0.97 || d / mx < 0.25) continue;                 // skip near-black, near-white and grey pixels
            const h = d === 0 ? 0 : mx === r ? ((gg - b) / d + 6) % 6 : mx === gg ? (b - r) / d + 2 : (r - gg) / d + 4;
            const bin = bins[Math.min(23, Math.floor((h / 6) * 24))], w = (d / mx) * (d / mx) + 0.05;   // the more colourful, the more it counts
            bin.w += w; bin.r += r * 255 * w; bin.g += gg * 255 * w; bin.b += b * 255 * w;
          }
          const idx = bins.map((x, i) => i).sort((a, b) => bins[b].w - bins[a].w);
          const best = bins[idx[0]];
          if (best.w < 0.6) return resolve(null);                                                        // a grey cover: no glow
          const hexOf = (x) => { const h2 = (v) => Math.round(v / x.w).toString(16).padStart(2, '0'); return ('#' + h2(x.r) + h2(x.g) + h2(x.b)).toUpperCase(); };
          const far = idx.slice(1).find((i) => Math.min(Math.abs(i - idx[0]), 24 - Math.abs(i - idx[0])) >= 3 && bins[i].w > best.w * 0.2);   // a second colour from another part of the colour wheel
          resolve([hexOf(best), far !== undefined ? hexOf(bins[far]) : hexOf(best)]);
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  const glowEl = $('#m-glow');
  try { for (const n of ['--art1', '--art2']) CSS.registerProperty({ name: n, syntax: '<color>', inherits: false, initialValue: 'transparent' }); } catch { /* already registered, or an old engine: the glow just changes without fading */ }
  async function applyArtGlow() {
    const on = !!(S.music && S.music.artColors) && !!art && !!mediaState && !!mediaState.title;
    let cols = null;
    if (on) {
      if (artSeedFor !== art) { artSeedFor = art; artSeed = null; const want = art; const r = await seedFromArt(want); if (art !== want) return; artSeed = r; }
      cols = artSeed;
    }
    if (cols) { glowEl.style.setProperty('--art1', cols[0]); glowEl.style.setProperty('--art2', cols[1]); wrap.dataset.glow = '1'; }
    else delete wrap.dataset.glow;
  }
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
    const hasShuf = has && (m.shuffle === true || m.shuffle === false), hasRep = has && !!m.repeat;
    els.shuf.hidden = !hasShuf; els.shuf.setAttribute('aria-pressed', String(m && m.shuffle === true));
    els.rep.hidden = !hasRep; els.rep.dataset.mode = (m && m.repeat) || 'None'; els.rep.setAttribute('aria-pressed', String(hasRep && m.repeat !== 'None'));
    els.rep.title = hasRep ? 'Repeat: ' + (m.repeat === 'List' ? 'all' : m.repeat === 'Track' ? 'one' : 'off') : '';
    els.art.title = has && m.app ? 'Playing in ' + String(m.app).replace(/\.exe$/i, '').split('!').pop().split('.').pop().replace(/_.*$/, '') : '';
    els.play.dataset.playing = String(playing);
    [els.play, els.prev, els.next].forEach((b) => { b.disabled = !has; });
    const showArt = has && art;
    els.img.hidden = !showArt; els.note.style.display = showArt ? 'none' : '';
    if (showArt && els.img.getAttribute('src') !== art) {      // a new cover fades in over the old one
      const old = els.img.getAttribute('src');
      if (old && !wasHidden(els.img)) { els.artPrev.src = old; els.artPrev.hidden = false; }
      els.img.src = art; els.img.classList.remove('fade-in'); void els.img.offsetWidth; els.img.classList.add('fade-in');
    }
    applyArtGlow();
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
  els.shuf.addEventListener('click', () => api.media('shuffle'));
  els.rep.addEventListener('click', () => api.media('repeat'));
  els.next.addEventListener('click', () => api.media('next'));

  // Wavy progress (the signature): active part waves while playing, flattens when paused
  const cv = $('#wave'), ctx = cv.getContext('2d');
  let amp = 0, phase = 0, lastT = 0, waveVer = -1, waveTrack = '', waveFill = '';   // theme colours are read once per theme change, not every frame
  let waveSec = '';
  function themeCols() {
    const ver = window.DyTheme ? window.DyTheme.version : 0;
    if (ver !== waveVer || !waveFill) {                      // the inline value is the TARGET colour (the computed one is mid-fade)
      const rs = document.documentElement.style, css = getComputedStyle(document.documentElement); waveVer = ver;
      const pick = (k) => rs.getPropertyValue(k) || css.getPropertyValue(k);
      waveTrack = pick('--md-sys-color-outline-variant'); waveFill = pick('--md-sys-color-primary'); waveSec = pick('--md-sys-color-secondary-container');
    }
  }
  // The timer ring and the usage bars: Material 3 Expressive wavy progress (wavy.js). The wave flows while something is running and flattens when it stops.
  const wavy = { phase: 0, last: 0, ampT: 0 };
  function sizeCanvas(cv) {
    const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { g, w, h };
  }
  function drawWavy(t) {
    const dt = Math.min(0.05, (t - wavy.last) / 1000 || 0); wavy.last = t;
    const moving = document.documentElement.dataset.motion !== 'off';
    const page = wrap.dataset.page;
    if (moving && (page !== 'timer' || (slots[cur] && slots[cur].running))) wavy.phase += dt * 4;        // the timer ring only flows while it runs
    themeCols();
    if (page === 'timer' && window.DyWavy) {
      const s = slots[cur], run = s.running;
      wavy.ampT += ((run ? 3.6 : 2.6) - wavy.ampT) * Math.min(1, dt * 8);
      const { g, w, h } = sizeCanvas(tEl.cv);
      window.DyWavy.ring(g, Math.min(w, h), { frac: window.DyTimers.fraction(s, Date.now()), amp: moving ? wavy.ampT : 2.4, phase: wavy.phase, color: waveFill, track: waveSec, thickness: 8, waves: 12 });
    } else if (page === 'usage' && window.DyWavy) {
      for (const cv of $$('.u-cv')) {
        const src = $('#' + cv.dataset.src), frac = src ? (parseFloat(src.style.width) || 0) / 100 : 0;
        const { g, w, h } = sizeCanvas(cv); if (!w) continue;
        window.DyWavy.line(g, w, h, { frac, amp: moving ? 3 : 2.4, phase: wavy.phase, color: waveFill, track: waveSec, thickness: 4, wavelength: 18 });
      }
    }
  }
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
    themeCols();
    // remaining track
    ctx.strokeStyle = waveTrack;
    ctx.beginPath(); ctx.moveTo(Math.min(w - 4, x + 6), cy); ctx.lineTo(w - 4, cy); ctx.stroke();
    // played wave
    ctx.strokeStyle = waveFill;
    ctx.beginPath();
    for (let px = 4; px <= x - 4; px += 1) {
      const y = cy + Math.sin(px / 5 - phase) * amp;
      px === 4 ? ctx.moveTo(px, y) : ctx.lineTo(px, y);
    }
    if (x - 4 < 4) ctx.moveTo(4, cy);
    ctx.stroke();
    // handle
    ctx.fillStyle = waveFill;
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
  // The draw loop only exists while there is something to draw (island open on a page with a wave). Opening, switching page or showing the window starts it again; collapsed it asks for no frames and sets no timers.
  let frameOn = false;
  function frame(t) {
    const pg = wrap.dataset.page;
    if (isOpen() && !document.hidden && (pg === 'music' || pg === 'timer' || pg === 'usage')) { if (pg === 'music') drawWave(t); else drawWavy(t); requestAnimationFrame(frame); }
    else frameOn = false;
  }
  function kickFrame() { if (!frameOn) { frameOn = true; requestAnimationFrame(frame); } }
  new MutationObserver(kickFrame).observe(wrap, { attributes: true, attributeFilter: ['class', 'data-page'] });
  document.addEventListener('visibilitychange', kickFrame);
  kickFrame();

  // ---------------------------------------------------------------- volume: the HUD on the closed island, the wheel / arrows on the music page
  let vol = { pct: -1, mute: false }, hudT = 0, volChipT = 0;
  const volHref = () => (vol.mute || vol.pct === 0 ? '#i-mute' : '#i-volume');
  const volChip = { box: $('#m-vol'), icon: $('#m-vol-i'), text: $('#m-vol-t') };
  function showVolChip() {
    volChip.icon.setAttribute('href', volHref()); volChip.text.textContent = vol.mute ? 'Muted' : vol.pct + '%';
    volChip.box.hidden = false; clearTimeout(volChipT); volChipT = setTimeout(() => { volChip.box.hidden = true; }, 1200);
  }
  function showHud() {
    if (isOpen() || editing || wrap.classList.contains('autohidden') && !S.autoHide) return;
    if (wrap.classList.contains('has-notice') && wrap.dataset.hud !== '1') return;                // a real toast keeps the stage
    shownNotice = null;                                                                             // the HUD is not a toast: a click on it must never take you to an old toast's Claude window
    nEl.root.dataset.kind = 'hud'; nEl.root.dataset.tone = '';
    nEl.icon.setAttribute('href', volHref()); nEl.title.textContent = vol.mute ? 'Muted' : 'Volume'; nEl.sub.textContent = vol.mute ? '' : vol.pct + '%';
    nEl.root.style.setProperty('--v', String(vol.mute ? 0 : vol.pct));
    wrap.dataset.hud = '1'; wrap.classList.add('has-notice'); updateVisibility();
    clearTimeout(hudT);
    hudT = setTimeout(() => { if (wrap.dataset.hud === '1') { delete wrap.dataset.hud; wrap.classList.remove('has-notice'); updateVisibility(); } }, 1600);
  }
  api.onVolume && api.onVolume((v) => {
    if (!v || !Number.isFinite(v.pct)) return;
    const changed = vol.pct !== v.pct || vol.mute !== !!v.mute;
    vol = { pct: v.pct, mute: !!v.mute };
    if (v.init || !changed) return;                                    // the value at start-up is not news
    if (isOpen() && wrap.dataset.page === 'music') showVolChip();
    else if (S.hud && S.hud.volume) { showHud(); mascot.react('curious'); }
  });
  function nudgeVolume(d) {
    if (vol.pct < 0) return;
    vol = { pct: Math.max(0, Math.min(100, vol.pct + d)), mute: false };
    api.setVolume(vol.pct); showVolChip();
  }
  wrap.addEventListener('wheel', (e) => {                              // scroll over the closed pill = volume (the HUD answers)
    if (isOpen() || Math.abs(e.deltaY) < 4 || vol.pct < 0 || (wrap.classList.contains('has-notice') && wrap.dataset.hud !== '1')) return;
    e.stopPropagation(); e.preventDefault();
    vol = { pct: Math.max(0, Math.min(100, vol.pct + (e.deltaY < 0 ? 4 : -4))), mute: false };
    api.setVolume(vol.pct); if (S.hud && S.hud.volume) showHud();
  }, { capture: true, passive: false });
  $('#p-music').addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) < 4) return; nudgeVolume(e.deltaY < 0 ? 4 : -4); }, { passive: true });

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
  let cityGeo = null;                                      // { name, lat, lon } of the place picked from the list (or found by "Use my location"); null = just the typed text
  try { const g = JSON.parse(store.get('cityGeo', 'null')); if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon) && g.name === city) cityGeo = g; } catch { /* none saved */ }
  const whereNow = () => (cityGeo ? { name: cityGeo.name, lat: cityGeo.lat, lon: cityGeo.lon } : city);
  let wView = store.get('wview', 'hours') === 'days' ? 'days' : 'hours';
  const wEl = {
    city: $('#w-city'), cityT: $('#w-city-t'), input: $('#w-input'), icon: $('#w-icon'), temp: $('#w-temp'),
    cond: $('#w-cond'), hilo: $('#w-hilo'), feels: $('#w-feels'), hum: $('#w-hum'), wind: $('#w-wind'), hours: $('#w-hours'),
    hIcon: $('#h-wx-i'), hT: $('#h-wx-t'), hC: $('#h-wx-c'), sug: $('#w-sug'),
  };
  const tdeg = (n) => Math.round(S.units.temp === 'f' ? (n * 9) / 5 + 32 : n);
  // Next hours (every other hour) or next days: click the strip to switch
  function renderForecast(w) {
    const box = wEl.hours; box.replaceChildren(); box.dataset.view = wView;
    const c = w.current, h = w.hourly;
    box.title = wView === 'days' ? 'Click for the next hours' : (w.daily ? 'Click for the next days' : '');
    if (wView === 'days' && w.daily && Array.isArray(w.daily.time)) {
      const dd = w.daily;
      for (let k = 0; k < Math.min(5, dd.time.length); k++) {
        const [ic] = WX(dd.weather_code[k], true);
        const day = k === 0 ? 'Today' : new Date(dd.time[k] + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
        const rain = dd.precipitation_probability_max ? dd.precipitation_probability_max[k] : null;
        const el = document.createElement('div'); el.className = 'hour' + (k === 0 ? ' now' : '');
        el.title = day + ': ' + tdeg(dd.temperature_2m_max[k]) + '° / ' + tdeg(dd.temperature_2m_min[k]) + '°' + (rain != null ? ', ' + rain + '% chance of rain' : '');
        el.innerHTML = '<span class="label-medium"></span><svg class="i" width="20" height="20"><use href="#' + ic + '"/></svg><span class="label-medium"></span>';
        el.children[0].textContent = day; el.children[2].textContent = tdeg(dd.temperature_2m_max[k]) + '°/' + tdeg(dd.temperature_2m_min[k]) + '°';
        el.style.setProperty('--n', String(k)); box.appendChild(el);
      }
      return;
    }
    let i = h.time.indexOf(c.time.slice(0, 13) + ':00'); if (i < 0) i = 0;
    for (let k = 0; k < 5; k++) {
      const j = i + k * 2; if (j >= h.time.length) break;
      const [ic] = WX(h.weather_code[j], h.is_day[j] === 1);
      const d = document.createElement('div'); d.className = 'hour' + (k === 0 ? ' now' : '');
      d.innerHTML = `<span class="label-medium">${k === 0 ? 'Now' : hourLabel(Number(h.time[j].slice(11, 13)))}</span><svg class="i" width="20" height="20"><use href="#${ic}"/></svg><span class="label-medium">${deg(h.temperature_2m[j])}</span>`;
      if (h.precipitation_probability && h.precipitation_probability[j] != null) d.title = h.precipitation_probability[j] + '% chance of rain';
      d.style.setProperty('--n', String(k)); box.appendChild(d);
    }
  }
  wEl.hours.addEventListener('click', () => { if (!lastWeather || !lastWeather.daily) return; wView = wView === 'days' ? 'hours' : 'days'; store.set('wview', wView); renderForecast(lastWeather); animatePage($('#p-weather')); });

  function renderWeather(w) {
    if (!w || w.error) {
      const msg = { 'no-city': 'Add a city to see the weather', 'not-found': 'City not found', offline: 'Weather unavailable offline' }[w && w.error] || 'Weather unavailable';
      wEl.cond.textContent = msg; wEl.temp.textContent = '--'; wEl.hilo.textContent = '';
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
    wEl.hilo.textContent = w.daily && Array.isArray(w.daily.time) && w.daily.temperature_2m_max ? 'H ' + tdeg(w.daily.temperature_2m_max[0]) + '°  L ' + tdeg(w.daily.temperature_2m_min[0]) + '°' : '';
    wEl.hum.textContent = Math.round(c.relative_humidity_2m) + '%';
    wEl.wind.textContent = S.units.temp === 'f' ? Math.round(c.wind_speed_10m * 0.621) + ' mph' : Math.round(c.wind_speed_10m) + ' km/h';
    $('#h-wx').dataset.wx = icon;
    wEl.hIcon.setAttribute('href', '#' + icon); wEl.hT.textContent = deg(c.temperature_2m); wEl.hC.textContent = text;
    $('.c-wx use').setAttribute('href', '#' + icon); $('.c-wx').classList.add('on'); $('.c-temp').textContent = deg(c.temperature_2m);

    const h = w.hourly; let i = h.time.indexOf(c.time.slice(0, 13) + ':00'); if (i < 0) i = 0;
    if (h.precipitation_probability) { const pp = Math.max(...h.precipitation_probability.slice(i, i + 3).filter((x) => x != null), 0); if (pp >= 20) wEl.cond.textContent = text + ' · ' + pp + (/rain|drizzle|shower|thunder/i.test(text) ? '%' : '% rain'); }
    renderForecast(w);
  }
  window.addEventListener('storage', (e) => {                          // another island changed the city
    if (e.key === 'island.city' && e.newValue && e.newValue !== city) {
      city = e.newValue; cityGeo = null;
      try { const g = JSON.parse(store.get('cityGeo', 'null')); if (g && g.name === city && Number.isFinite(g.lat) && Number.isFinite(g.lon)) cityGeo = g; } catch { /* none */ }
      loadWeather();
    }
  });
  let wxSeq = 0, lastWxCity = '';
  async function loadWeather() {
    const seq = ++wxSeq;                                              // overlapping calls (timer, open, R, the button): only the newest may render
    wEl.cityT.textContent = city || 'Set city';
    const w = await api.weather(whereNow());
    if (seq !== wxSeq) return true;
    const failed = !w || (w.error && w.error !== 'no-city' && w.error !== 'not-found');
    if (failed && lastWeather && lastWeather.current && lastWxCity === city) { mark('weather', false); return false; }       // keep the last good forecast on screen
    lastWeather = w; lastWxCity = city; renderWeather(w);
    const ok = !!(w && !w.error); mark('weather', ok || !!(w && w.error === 'no-city')); return ok;
  }
  loadWeather(); setInterval(loadWeather, 15 * 60 * 1000);

  // ---------------------------------------------------------------- Refresh: the buttons, R, the tray tile, and a reload on open when the data is stale
  const FRESH = { weather: 0, usage: 0, data: 0 }, ERR = { weather: false, usage: false, data: false }, STALE_MS = 5 * 60000, busy = new Set(), ATT = { weather: 0, usage: 0, data: 0 };
  function mark(k, ok) { ERR[k] = !ok; if (ok) FRESH[k] = Date.now(); tickAgo(); }          // a source counts as fresh only when its fetch really worked
  const agoText = (t) => { if (!t) return ''; const m = Math.floor((Date.now() - t) / 60000); return m < 1 ? 'Updated just now' : m < 60 ? 'Updated ' + m + 'm ago' : 'Updated ' + Math.floor(m / 60) + 'h ago'; };
  function tickAgo() {
    for (const [k, id] of [['weather', '#w-ago'], ['usage', '#u-ago']]) {
      const el = $(id); if (!el) continue;
      el.textContent = ERR[k] ? 'Failed. Retry' : agoText(FRESH[k]); el.toggleAttribute('data-err', ERR[k]);
    }
    const mt = FRESH.data ? agoText(FRESH.data) : '';
    for (const id of ['#h-rf', '#h-ev-rf']) { const b = $(id); if (b) b.title = ERR.data ? 'Could not refresh. Retry' : 'Refresh' + (mt ? ' (' + mt.toLowerCase() + ')' : ''); }
  }
  setInterval(() => { if (isOpen()) tickAgo(); }, 30000);
  const JOBS = { weather: () => loadWeather(), usage: () => loadUsage(), data: async () => { const r = api.refreshData ? await api.refreshData() : { ok: true }; mark('data', !!(r && r.ok)); return !!(r && r.ok); } };
  async function runRefresh(kinds, btns = []) {
    kinds = kinds.filter((k) => !busy.has(k)); if (!kinds.length) return;
    kinds.forEach((k) => { busy.add(k); ATT[k] = Date.now(); }); btns.forEach((b) => { b.classList.add('spinning'); b.removeAttribute('data-err'); });
    await Promise.all([...kinds.map((k) => JOBS[k]().catch(() => { mark(k, false); })), new Promise((r) => setTimeout(r, 600))]);
    kinds.forEach((k) => busy.delete(k)); btns.forEach((b) => { b.classList.remove('spinning'); b.toggleAttribute('data-err', kinds.some((k) => ERR[k])); });
    tickAgo();
  }
  const refreshHome = (btns) => runRefresh(['weather', 'data'], btns);
  function refreshStale() { const t = Date.now(), k = ['weather', 'data'].filter((x) => t - FRESH[x] > STALE_MS && t - ATT[x] > 60000); if (k.length) runRefresh(k); }
  $('#w-rf').addEventListener('click', () => runRefresh(['weather'], [$('#w-rf')]));
  $('#u-rf').addEventListener('click', () => runRefresh(['usage'], [$('#u-rf')]));
  for (const id of ['#h-rf', '#h-ev-rf']) {
    const b = $(id), act = (e) => { e.stopPropagation(); e.preventDefault(); refreshHome([$('#h-rf'), $('#h-ev-rf')]); };
    b.addEventListener('click', act); b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') act(e); });
  }

  // City editing: the window is unfocusable, so we ask main to make it focusable while typing
  // The city box suggests real places (so "Springfield" can be the right one) and has a "Use my location" row.
  let sugItems = [], sugIdx = -1, sugT = 0, sugSeq = 0;
  const LOC_ROW = { loc: true };
  const placeLabel = (p) => [p.name, p.admin1, p.cc].filter(Boolean).join(', ');
  function renderSuggestions() {
    const rows = [...sugItems, LOC_ROW];
    wEl.sug.hidden = false; wEl.input.setAttribute('aria-expanded', 'true');
    wEl.sug.replaceChildren(...rows.map((p, n) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'w-sug-i sl' + (p.loc ? ' loc' : ''); b.setAttribute('role', 'option'); b.dataset.n = String(n);
      b.setAttribute('aria-selected', String(n === sugIdx));
      if (p.loc) { b.innerHTML = '<svg class="i" width="14" height="14"><use href="#i-pin"/></svg><span>Use my location</span>'; b.title = 'Asks Windows where this PC is, and sends only those coordinates to Open-Meteo for the forecast'; }
      else { const s = document.createElement('span'); s.textContent = placeLabel(p); b.append(s); }
      return b;
    }));
    const sel = wEl.sug.querySelector('[aria-selected="true"]'); if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  wEl.input.addEventListener('input', () => {
    clearTimeout(sugT); const q = wEl.input.value.trim(), seq = ++sugSeq;
    if (q.length < 2) { sugItems = []; sugIdx = -1; renderSuggestions(); return; }
    sugT = setTimeout(async () => { try { const r = await api.weatherSearch(q); if (seq === sugSeq && editing) { sugItems = Array.isArray(r) ? r.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) : []; sugIdx = sugItems.length ? 0 : -1; renderSuggestions(); } } catch { /* offline: plain text still works */ } }, 220);
  });
  async function pickRow(p) {
    if (p && p.loc) {
      let r = null; try { r = await api.weatherLocate(); } catch { /* none */ }
      if (!r || !Number.isFinite(r.lat)) { wEl.input.value = ''; wEl.input.placeholder = 'Location unavailable. Type a city'; sugItems = []; sugIdx = -1; renderSuggestions(); return; }
      return endEdit(true, { name: 'My location', lat: r.lat, lon: r.lon });
    }
    endEdit(true, p);
  }
  wEl.sug.addEventListener('mousedown', (e) => e.preventDefault());           // keep the box focused: a blur would close it before the click lands
  wEl.sug.addEventListener('click', (e) => { const b = e.target.closest('.w-sug-i'); if (!b) return; const rows = [...sugItems, LOC_ROW]; pickRow(rows[Number(b.dataset.n)]); });
  function beginEdit() {
    editing = true; grabKeys('edit');
    sugItems = []; sugIdx = -1; wEl.input.placeholder = 'City';
    $('#p-weather').dataset.editing = '1';
    wEl.city.hidden = true; wEl.input.hidden = false; wEl.input.value = city; wEl.input.focus(); wEl.input.select();
    renderSuggestions();
  }
  function endEdit(save, picked) {
    if (!editing) return;
    editing = false; releaseKeys('edit'); clearTimeout(sugT); sugSeq++;
    delete $('#p-weather').dataset.editing; wEl.sug.hidden = true; wEl.sug.replaceChildren(); wEl.input.setAttribute('aria-expanded', 'false');
    wEl.input.hidden = true; wEl.city.hidden = false;
    if (save && picked) { cityGeo = { name: picked.name, lat: picked.lat, lon: picked.lon }; store.set('cityGeo', JSON.stringify(cityGeo)); city = picked.name; store.set('city', city); loadWeather(); }
    else if (save && wEl.input.value.trim() && wEl.input.value.trim() !== city) { city = wEl.input.value.trim(); cityGeo = null; store.set('cityGeo', 'null'); store.set('city', city); loadWeather(); }
    // The pointer may have left while typing: close now, or the island would stay open and keep blocking clicks
    if (!wrap.matches(':hover') && !pinned) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 280); }
  }
  wEl.city.addEventListener('click', beginEdit);
  wEl.input.addEventListener('keydown', (e) => {
    const rows = [...sugItems, LOC_ROW], n = rows.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugIdx = e.key === 'ArrowDown' ? (sugIdx + 1) % n : (sugIdx <= 0 ? n - 1 : sugIdx - 1); renderSuggestions(); return; }
    if (e.key === 'Enter') { const p = sugIdx >= 0 ? rows[sugIdx] : null; if (p) pickRow(p); else endEdit(true); }
    if (e.key === 'Escape') endEdit(false);
  });
  wEl.input.addEventListener('blur', () => endEdit(true));

  // ---------------------------------------------------------------- timers
  // timers.js holds the logic (timer / repeat / pomodoro / stopwatch, three slots); this part draws it. Running timers carry an absolute end time, so every
  // island window agrees and a reloaded page picks them up again.
  const TM = window.DyTimers;
  const MODE_LABEL = { timer: 'Timer', repeat: 'Repeat', pomodoro: 'Pomodoro', stopwatch: 'Stopwatch' };
  const tEl = { cv: $('#t-ring-cv'), time: $('#t-time'), start: $('#t-start'), startI: $('#t-start-i'), startL: $('#t-start-l'), chips: $$('#t-chips .chip'), chipsBox: $('#t-chips'), mode: $('#t-mode'), modeL: $('#t-mode-l'), slots: $$('#t-slots [data-slot]'), input: $('#t-input') };
  try {                                                                      // saved settings of the three timers (never a running state: that comes from the other islands or from main)
    const raw = JSON.parse(store.get('timers', 'null')), legacy = Number(store.get('timer', 300)) || 300;
    slots = [0, 1, 2].map((i) => TM.normalize(raw && raw.slots && raw.slots[i] ? { ...raw.slots[i], running: false } : null, Date.now(), i === 0 ? legacy : 300));
    cur = raw && Number.isInteger(raw.cur) ? Math.max(0, Math.min(2, raw.cur)) : 0;
  } catch { /* defaults */ }
  const slot = () => slots[cur];
  const saveSlots = () => store.set('timers', JSON.stringify({ cur, slots: slots.map((s) => ({ mode: s.mode, total: s.total, phase: s.phase, round: s.round })) }));
  function pushTimer() { try { api.timerSync && api.timerSync({ cur, slots }); } catch { /* single island */ } }
  function applyTimerState(t) {
    if (!t || !Array.isArray(t.slots)) return;
    slots = [0, 1, 2].map((i) => TM.normalize(t.slots[i], Date.now(), 300));
    if (Number.isInteger(t.cur) && t.cur >= 0 && t.cur < 3) cur = t.cur;
    saveSlots(); renderTimer(); updateMode(); renderSat();
  }
  api.onTimer && api.onTimer(applyTimerState);
  let editingTime = false;
  function renderTimer() {
    const s = slot(), now = Date.now(), secs = TM.seconds(s, now);
    if (!editingTime) tEl.time.textContent = TM.clock(s.mode === 'stopwatch' ? Math.floor(secs) : Math.ceil(secs));     // ceil: the last second reads 00:01, not 00:00
    tEl.start.dataset.running = String(s.running);
    tEl.startI.setAttribute('href', s.running ? '#i-pause' : '#i-play');
    tEl.startL.textContent = s.running ? 'Pause' : (secs > 0 && (s.mode === 'stopwatch' || secs < TM.span(s)) ? 'Resume' : 'Start');
    tEl.modeL.textContent = s.mode === 'pomodoro' ? (s.phase === 'focus' ? 'Focus' : s.phase === 'long' ? 'Long break' : 'Break') + ' ' + s.round + '/' + TM.POMO.rounds : MODE_LABEL[s.mode];
    tEl.chipsBox.hidden = !(s.mode === 'timer' || s.mode === 'repeat');
    tEl.chips.forEach((c) => c.setAttribute('aria-pressed', String(Number(c.dataset.min) * 60 === s.total)));
    tEl.slots.forEach((b, i) => { b.setAttribute('aria-selected', String(i === cur)); b.dataset.run = String(slots[i].running); });
    tEl.time.dataset.edit = (s.mode === 'timer' || s.mode === 'repeat') && !s.running ? 'yes' : 'no';
  }
  function chime() {
    if (S.quiet.mute || isDnd() || !isLead) return;            // muted, do not disturb, or another monitor's island chimes
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
  function alertDone(i) {
    cur = i; renderTimer();
    if (approvalList.length) { chime(); wrap.classList.remove('alert'); void wrap.offsetWidth; wrap.classList.add('alert'); return; }   // a permission card is waiting: never replace it
    chime(); go('timer'); open(); pinned = true;
    wrap.classList.remove('alert'); void wrap.offsetWidth; wrap.classList.add('alert');
    clearTimeout(pinTimer); pinTimer = setTimeout(() => { pinned = false; if (!wrap.matches(':hover') && !editing) close(); }, 6000);
  }
  // A timer ended: a plain one opens the Timer page; repeat and pomodoro only chime and toast (they would otherwise open it all day)
  function timerEvent(i, ev) {
    const s = slots[i], n = 'Timer ' + (i + 1);
    if (s.mode === 'pomodoro') {
      chime();
      pushNotice(ev === 'done' ? { kind: 'done', tone: 'success', title: 'Pomodoro finished', sub: TM.POMO.rounds + ' rounds done', duration: 6 }
        : { kind: 'done', tone: 'info', title: s.phase === 'focus' ? 'Back to focus' : s.phase === 'long' ? 'Long break' : 'Break time', sub: Math.round(TM.span(s) / 60) + ' min \u00b7 round ' + s.round + ' of ' + TM.POMO.rounds, duration: 5 });
    } else if (s.mode === 'repeat') { mascot.react('bounce'); chime(); pushNotice({ kind: 'done', tone: 'info', title: n + ' went off', sub: 'Starting again', duration: 3 }); }
    else alertDone(i);
  }
  setInterval(() => {
    const now = Date.now(); let changed = false;
    slots.forEach((s, i) => { if (!s.running) return; const ev = TM.tick(s, now); if (ev) { timerEvent(i, ev); changed = true; } });
    if (changed) { updateMode(); renderSat(); }
    if (changed || (slots.some((s) => s.running) && isOpen() && wrap.dataset.page === 'timer')) renderTimer();
  }, 250);
  const changedTimer = () => { saveSlots(); renderTimer(); updateMode(); renderSat(); pushTimer(); };
  tEl.start.addEventListener('click', () => { const s = slot(); if (s.running) TM.pause(s, Date.now()); else TM.start(s, Date.now()); changedTimer(); });
  $('#t-reset').addEventListener('click', () => { TM.reset(slot()); changedTimer(); });
  tEl.chips.forEach((c) => c.addEventListener('click', () => { TM.setTotal(slot(), Number(c.dataset.min) * 60); changedTimer(); }));
  tEl.mode.addEventListener('click', () => { const s = slot(); TM.setMode(s, TM.MODES[(TM.MODES.indexOf(s.mode) + 1) % TM.MODES.length]); changedTimer(); });
  tEl.slots.forEach((b) => b.addEventListener('click', () => { cur = Number(b.dataset.slot); saveSlots(); renderTimer(); }));
  // The wheel over the ring sets the length (1 min a notch, 5 with Shift); clicking the time lets you type it ("25", "7:30", "90s", "1h15m")
  $('.ring').addEventListener('wheel', (e) => {
    const s = slot(); if ((s.mode !== 'timer' && s.mode !== 'repeat') || s.running || Math.abs(e.deltaY) < 4) return;
    TM.setTotal(s, Math.max(60, s.total + (e.deltaY < 0 ? 1 : -1) * 60 * (e.shiftKey ? 5 : 1))); changedTimer();
  }, { passive: true });
  function beginTimeEdit() {
    const s = slot(); if ((s.mode !== 'timer' && s.mode !== 'repeat') || s.running || editingTime) return;
    editingTime = true; editing = true; grabKeys('timer-edit');
    tEl.time.hidden = true; tEl.input.hidden = false; tEl.input.value = String(Math.round(s.total / 60)); tEl.input.focus(); tEl.input.select();
  }
  function endTimeEdit(save) {
    if (!editingTime) return;
    editingTime = false; editing = false; releaseKeys('timer-edit');
    tEl.input.hidden = true; tEl.time.hidden = false;
    const sec = save ? TM.parseDuration(tEl.input.value) : null;
    if (sec) TM.setTotal(slot(), sec);
    changedTimer();
    if (!wrap.matches(':hover') && !pinned) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 280); }
  }
  tEl.time.addEventListener('click', beginTimeEdit);
  tEl.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') endTimeEdit(true); else if (e.key === 'Escape') endTimeEdit(false); });
  tEl.input.addEventListener('blur', () => endTimeEdit(true));
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
      if (seq !== usageSeq) return true;
      const local = loc && loc.found ? loc : null;
      mark('usage', true);
      if (lim && lim.ok) { renderPlan(lim, local); return true; }          // real limits: % left plus the token total
      if (local) { renderLocal(local, lim && lim.reason); return true; }   // no limits available: tokens only, with a hint why
      renderEmpty(lim && lim.reason); return true;
    } catch { if (seq === usageSeq) { mark('usage', false); renderEmpty(); } return false; }
  }
  setInterval(() => { if (isOpen() && wrap.dataset.page === 'usage') loadUsage(); }, 60000);

  // ---------------------------------------------------------------- notices (Claude finished / needs you, via hook.js)
  const nEl = { root: $('#notice'), icon: $('#n-icon'), title: $('#n-title'), sub: $('#n-sub'), bar: $('#notice .n-bar'), more: $('#notice .n-more') };
  // Flick a toast up (or scroll up on it) to send it away. The click that ends the gesture must not open Claude or the island.
  let swipeY = null, swipedAt = 0;
  function updateMore() { nEl.more.hidden = noticeQueue.length === 0; nEl.more.textContent = '+' + noticeQueue.length; }
  function dismissCurrent() {
    swipedAt = Date.now(); clearTimeout(noticeTimer); wrap.classList.remove('has-notice'); shownNotice = null;
    clearTimeout(noticeGap); noticeGap = setTimeout(showNextNotice, 350);
  }
  nEl.root.addEventListener('pointerdown', (e) => { swipeY = e.clientY; });
  nEl.root.addEventListener('pointermove', (e) => { if (swipeY !== null && e.buttons && swipeY - e.clientY > 14) { swipeY = null; dismissCurrent(); } });
  nEl.root.addEventListener('pointerup', () => { swipeY = null; });
  nEl.root.addEventListener('wheel', (e) => { if (e.deltaY < -10 && wrap.classList.contains('has-notice')) dismissCurrent(); }, { passive: true });
  const noticeQueue = [];
  let shownNotice = null;                                // the toast on screen (its session is where a click goes)
  let noticeShowing = false, noticeTimer = 0, noticeGap = 0;
  function showNextNotice() {
    clearTimeout(noticeGap);
    if (isOpen() || editing) { noticeGap = setTimeout(showNextNotice, 1000); return; }     // never on top of the open island
    const n = noticeQueue.shift();
    if (!n) { noticeShowing = false; wrap.classList.remove('has-notice'); return; }
    clearTimeout(hudT); delete wrap.dataset.hud;                        // a toast replaces a volume HUD that is still up
    noticeShowing = true; noteActivity(); shownNotice = n;
    const ms = n.duration ? n.duration * 1000 : n.kind === 'attention' ? 8000 : 5000;
    nEl.root.style.setProperty('--toast-ms', ms + 'ms');
    nEl.bar.style.animation = 'none'; void nEl.bar.offsetWidth; nEl.bar.style.animation = '';           // the line restarts for every toast
    updateMore();
    if (n.kind === 'done') happyNext = true;                // the mascot is pleased when it comes back
    else if (n.kind === 'attention') mascot.react('surprise');
    nEl.root.dataset.kind = n.kind; nEl.root.dataset.tone = n.tone || '';
    nEl.icon.setAttribute('href', n.icon || (n.tone === 'error' ? '#i-warn' : n.kind === 'attention' ? '#i-bell' : '#i-check'));
    nEl.title.textContent = n.title; nEl.sub.textContent = n.sub;
    wrap.classList.remove('alert'); void wrap.offsetWidth; wrap.classList.add('alert');     // small wobble
    wrap.classList.add('has-notice');
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { wrap.classList.remove('has-notice'); shownNotice = null; noticeGap = setTimeout(showNextNotice, 500); }, n.duration ? n.duration * 1000 : n.kind === 'attention' ? 8000 : 5000);
  }
  function dismissNotices() {
    noticeQueue.length = 0; noticeShowing = false; shownNotice = null;
    clearTimeout(noticeTimer); clearTimeout(noticeGap);
    wrap.classList.remove('has-notice');
  }
  function pushNotice(n) {
    if (!n || typeof n.title !== 'string') return;
    if (isDnd()) return;                                       // do not disturb
    noticeQueue.push({ kind: n.kind === 'attention' ? 'attention' : 'done', tone: ['success', 'warning', 'error', 'info'].includes(n.tone) ? n.tone : '', duration: Number(n.duration) || 0, icon: /^#i-[a-z]{2,12}$/.test(n.icon || '') ? n.icon : '', title: n.title, sub: String(n.sub || ''), session: typeof n.session === 'string' ? n.session.slice(0, 128) : '', act: typeof n.act === 'string' && /^n\d{1,9}$/.test(n.act) ? n.act : '' });
    if (noticeQueue.length > 5) noticeQueue.shift();
    if (!noticeShowing) showNextNotice(); else updateMore();
  }
  api.onNotice(pushNotice);

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
  function renderPriv() {
    const show = S.privacy.dot !== false, cam = show && privNow.camera, mic = show && privNow.mic;          // the watcher also runs for "Quiet during calls": the dot is its own setting
    privEl.querySelector('.p-cam').hidden = !cam; privEl.querySelector('.p-mic').hidden = !mic;
    privEl.hidden = !(cam || mic);
    const what = cam && mic ? 'Camera and microphone in use' : cam ? 'Camera in use' : mic ? 'Microphone in use' : '';
    privEl.setAttribute('aria-label', what); privEl.title = what;
  }
  api.onPrivacy((s) => { privNow = { camera: !!(s && s.camera), mic: !!(s && s.mic) }; renderPriv(); renderTray(); });

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

  // ---------------------------------------------------------------- Shape tokens: every polygon has 96 vertices, so clip-path morphs between any two of them
  (function shapes() {
    const N = 96, pt = (x, y) => (50 + 50 * x).toFixed(2) + '% ' + (50 + 50 * y).toFixed(2) + '%';
    const poly = (f) => 'polygon(' + Array.from({ length: N }, (_, i) => { const a = (2 * Math.PI * i) / N; return f(Math.cos(a), Math.sin(a), a); }).join(',') + ')';
    const sup = (n) => (c, s) => pt(Math.sign(c) * Math.pow(Math.abs(c), 2 / n), Math.sign(s) * Math.pow(Math.abs(s), 2 / n));
    const lobes = (k, base, amp) => (c, s, a) => { const r = base + amp * Math.cos(k * a); return pt(c * r, s * r); };
    const r = document.documentElement.style;
    r.setProperty('--poly-circle', poly(sup(2))); r.setProperty('--poly-pill', poly(sup(3))); r.setProperty('--poly-squircle', poly(sup(5)));
    r.setProperty('--poly-cookie', poly(lobes(12, .93, .07))); r.setProperty('--poly-burst', poly(lobes(8, .86, .14)));
  })();

  // ---------------------------------------------------------------- Quick actions tray (hover or right-click the settings button)
  const tray = $('#qtray');
  let trayOpenT = 0, trayCloseT = 0;
  function renderTray() {
    const q = (k) => tray.querySelector('[data-q="' + k + '"]');
    const set = (k, on) => q(k).setAttribute('aria-checked', String(!!on));
    set('awake', awakeBtn.getAttribute('aria-pressed') === 'true'); set('dnd', S.quiet.dnd); set('mute', S.quiet.mute);
    const st = (k, text) => { const e = q(k).querySelector('.qs'); if (e) e.textContent = text; };
    st('awake', awakeBtn.getAttribute('aria-pressed') === 'true' ? 'On' : 'Off'); st('dnd', S.quiet.dnd ? 'On' : 'Off'); st('mute', S.quiet.mute ? 'On' : 'Off');
    q('clip').hidden = !S.clipboard.enabled;
    q('note').hidden = !(S.notes && S.notes.enabled);
    q('net').hidden = !(S.network && S.network.enabled); q('mixer').hidden = !(S.mixer && S.mixer.enabled);
    q('dns').hidden = !S.dns.tile; setDnsTile(); setDnspTile();
    { const f = S.focus && S.focus.sync; q('dnd').querySelector('.ql').textContent = f ? 'Focus mode' : 'Do not disturb'; }
    gear.toggleAttribute('data-dnd', isDnd());
  }
  // NextDNS tile: its state comes from the main process (registry read, no rights needed)
  let dnsState = 'notinstalled', dnsBusyUi = false;
  const DNS_LABEL = { on: 'On', off: 'Off', notinstalled: 'Set up', custom: 'Custom', mixed: 'Mixed', unencrypted: 'No DoH', absent: 'No link', failed: 'Failed', busy: 'Switching...' };
  function setDnsTile() {
    const t = tray.querySelector('[data-q="dns"]'); if (!t) return;
    const st = dnsBusyUi ? 'busy' : dnsState;
    t.querySelector('.qs').textContent = DNS_LABEL[st] || 'DNS';
    t.setAttribute('aria-checked', String(st === 'on'));
    t.title = st === 'notinstalled' ? 'Set up the DNS switch (asks for administrator approval once)' : st === 'custom' ? 'DNS was changed by hand. Click to restore NextDNS' : 'Turn NextDNS on or off';
  }
  // DNS providers: one tile that steps through Automatic and the providers you installed
  let dnspSt = { state: 'notinstalled', id: '', profiles: [] }, dnspBusy = false;
  function setDnspTile() {
    const t = tray.querySelector('[data-q="dnsp"]'); if (!t) return;
    const has = dnspSt.profiles && dnspSt.profiles.length > 0;
    t.hidden = !has; if (!has) return;
    const cur = dnspSt.profiles.find((p) => p.id === dnspSt.id);
    t.querySelector('.qs').textContent = dnspBusy ? 'Switching...' : dnspSt.state === 'profile' && cur ? cur.name : dnspSt.state === 'auto' ? 'Auto' : dnspSt.state === 'custom' ? 'Custom' : dnspSt.state === 'mixed' ? 'Mixed' : 'DNS';
    t.setAttribute('aria-checked', String(dnspSt.state === 'profile'));
    t.title = 'Click to switch to the next DNS provider (Automatic, ' + dnspSt.profiles.map((p) => p.name).join(', ') + ')';
  }
  async function refreshDnsp() { try { const r = await api.dnspStatus(); if (r && typeof r.state === 'string') dnspSt = r; } catch { /* keep */ } setDnspTile(); }
  async function cycleDnsp() {
    if (dnspBusy || !dnspSt.profiles.length) return;
    const order = ['auto', ...dnspSt.profiles.map((p) => p.id)], at = dnspSt.state === 'profile' ? order.indexOf(dnspSt.id) : 0;
    dnspBusy = true; setDnspTile();
    try { const r = await api.dnspUse(order[(at + 1) % order.length]); if (r && typeof r.state === 'string' && Array.isArray(r.profiles)) dnspSt = r; } catch { /* keep */ }
    dnspBusy = false; setDnspTile();
  }
  async function refreshDns() {
    if (!S.dns.tile || !api.dnsStatus) return;
    try { const r = await api.dnsStatus(); if (r && typeof r.state === 'string') dnsState = r.state; } catch { /* keep the last state */ }
    setDnsTile();
  }
  function trayFade() { const m = tray.scrollHeight > tray.clientHeight + 1; tray.classList.toggle('fade-top', m && tray.scrollTop > 2); tray.classList.toggle('fade-bot', m && tray.scrollTop + tray.clientHeight < tray.scrollHeight - 2); }
  tray.addEventListener('scroll', trayFade, { passive: true });
  function showTray() { clearTimeout(trayCloseT); if (!isOpen() || settingsOpen) return; refreshDns(); refreshDnsp(); renderTray(); tray.hidden = false; void tray.offsetWidth; trayFade(); tray.classList.add('show'); }
  function hideTray() { try { trayBtn.setAttribute('aria-pressed', 'false'); } catch { /* not built yet */ } clearTimeout(trayOpenT); clearTimeout(trayCloseT); tray.classList.remove('show'); trayCloseT = setTimeout(() => { if (!tray.classList.contains('show')) tray.hidden = true; }, 300); }
  // The quick actions have their own round button under the gear: a click opens them, another click (or anywhere else, or Esc) closes them
  const trayBtn = $('#tray-btn');
  trayBtn.addEventListener('click', () => { if (tray.classList.contains('show')) hideTray(); else showTray(); trayBtn.setAttribute('aria-pressed', String(tray.classList.contains('show'))); });
  document.addEventListener('click', (e) => { if (tray.classList.contains('show') && !e.target.closest('.qtray, #tray-btn')) { hideTray(); trayBtn.setAttribute('aria-pressed', 'false'); } });
  gear.addEventListener('click', () => { hideTray(); trayBtn.setAttribute('aria-pressed', 'false'); });          // opening Settings: the tray gets out of the way
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tray.classList.contains('show')) hideTray(); });
  tray.addEventListener('click', (e) => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const k = b.dataset.q;
    if (k === 'awake') toggleAwake();
    else if (k === 'dnd') api.setSettings({ quiet: { dnd: !S.quiet.dnd } });
    else if (k === 'mute') api.setSettings({ quiet: { mute: !S.quiet.mute } });
    else if (k === 'clip') api.clipboardClear();
    else if (k === 'note' || k === 'net' || k === 'mixer') { hideTray(); if (window.DyFeat) window.DyFeat.tray(k); }
    else if (k === 'refresh') {
      const s = b.querySelector('.qs'), was = 'Weather, mail, calendar'; s.textContent = 'Refreshing...';
      runRefresh(['weather', 'data']).then(() => { s.textContent = ERR.weather || ERR.data ? 'Could not refresh' : 'Updated'; setTimeout(() => { s.textContent = was; }, 2000); });
    }
    else if (k === 'lock') { api.quick(k); hideTray(); }
    else if (k === 'dnsp') cycleDnsp();
    else if (k === 'dns') {
      if (dnsBusyUi) return;
      if (dnsState === 'notinstalled') { api.dnsSetup(); return; }                  // one-time setup: Windows asks for approval
      dnsBusyUi = true; setDnsTile();
      Promise.resolve(api.dnsToggle()).then((r) => { if (r && typeof r.state === 'string') dnsState = r.state; }).catch(() => {}).finally(() => { dnsBusyUi = false; setDnsTile(); });
    }
    else if (k === 'pause') { hideTray(); pinned = false; close(true); api.capture(false); api.pauseIsland(60); }
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
  // The Share tab (nearby devices plus the shelf) exists while LocalSend or the shelf is on
  const featureOn = (t) => (t === 'localsend' ? !!((S.localsend && S.localsend.enabled) || (S.shelf && S.shelf.enabled !== false)) : true);
  const offTabs = () => [...S.hiddenTabs, ...S.tabs.filter((t) => !featureOn(t))];
  function visibleTabs() { const off = offTabs(); return S.tabs.filter((t) => !off.includes(t)); }
  // Each page can open the island a little differently: the timer is compact, the music page roomier (Settings > Island size > "Fit the size to the page").
  // Never outside the limits Settings allows. Main is told the live size, so the settings card never lands on top of the island.
  const PAGE_LIMITS = { w: [416, 640], h: [232, 340] };
  function pageSize(name) {
    const o = S.size.open, adapt = S.size.adaptive !== false;
    const fit = (w, h) => ({ w: Math.max(PAGE_LIMITS.w[0], Math.min(PAGE_LIMITS.w[1], w)), h: Math.max(PAGE_LIMITS.h[0], Math.min(PAGE_LIMITS.h[1], h)) });
    if (adapt && name === 'timer') return fit(o.w - 56, o.h);
    if (adapt && name === 'music') return fit(o.w + 24, o.h + 16);
    return { w: o.w, h: o.h };
  }
  let sentSize = '';
  function applyPageSize() {
    const sz = pageSize(wrap.dataset.page);
    wrap.style.setProperty('--ow', sz.w + 'px'); wrap.style.setProperty('--oh', sz.h + 'px');
    const key = sz.w + 'x' + sz.h;
    if (key !== sentSize) { sentSize = key; try { api.reportSize && api.reportSize(sz); } catch { /* single island */ } }
  }
  let appliedNavKey = '';
  function rebuildNav() {
    const vis = DyTabs.buildNav($('.nav'), S.tabs, offTabs(), wrap.dataset.page);
    if (!vis.includes(wrap.dataset.page) && !EXTRA_PAGES.includes(wrap.dataset.page)) go(vis[0] || 'home');       // the approval card is not a tab: do not knock it away
  }
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionMode = () => (reduceMotion.matches ? 'off' : S.motion || 'expressive');
  // Expressive motion uses real spring curves (spring.js sampled into linear() easings); Calm keeps the plain tokens.css curves.
  const SPRING_VARS = ['--ease-open', '--ease-close', '--ease-press', '--spring', '--spring-soft', '--d-open', '--d-close', '--d-item'];
  function applyMotion() {
    const root = document.documentElement, m = motionMode();
    root.dataset.motion = m;
    if (m === 'expressive' && window.DySpring) {
      const o = window.DySpring.easing(0.66, 24), c = window.DySpring.easing(0.92, 27), p = window.DySpring.easing(0.6, 28), set = (k, v) => root.style.setProperty(k, v);
      set('--ease-open', o.css); set('--d-open', o.ms + 'ms');
      set('--ease-close', c.css); set('--d-close', c.ms + 'ms');
      set('--ease-press', p.css); set('--spring', p.css); set('--spring-soft', p.css); set('--d-item', Math.min(p.ms, 320) + 'ms');
    } else for (const k of SPRING_VARS) root.style.removeProperty(k);
  }
  reduceMotion.addEventListener('change', applyMotion);
  function applySettings(s) {
    if (!s || !s.size) return;
    S = s;
    const r = document.documentElement.style;
    applyMotion();
    r.setProperty('--idle-w', s.size.idle.w + 'px'); r.setProperty('--idle-h', s.size.idle.h + 'px');
    r.setProperty('--open-w', s.size.open.w + 'px'); r.setProperty('--open-h', s.size.open.h + 'px');
    applyPageSize();
    if (window.DyTheme) window.DyTheme.apply(s.theme);
    applyArtGlow();
    const o = { hour: 'numeric', minute: '2-digit' };
    if (s.units.clock === '12') o.hour12 = true; else if (s.units.clock === '24') o.hour12 = false;
    timeFmt = new Intl.DateTimeFormat(undefined, o);
    const navKey = JSON.stringify([s.tabs, s.hiddenTabs, featureOn('localsend')]);
    if (navKey !== appliedNavKey) { appliedNavKey = navKey; rebuildNav(); }
    if (cal) cal.render();
    tickClock();
    if (lastWeather) renderWeather(lastWeather);
    renderClipboard(cbItems);
    applyHome();
    renderTray(); renderPriv();
    if (window.DyFeat) window.DyFeat.onSettings(s);
    syncMascot(); updateVisibility();
  }

  // ---------------------------------------------------------------- Calendar events: the Home card, the dots on the calendar, the "starting soon" chip
  const evEl = { card: $('#h-ev'), t: $('#h-ev-t'), l: $('#h-ev-l') };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const evWhen = (ev) => {
    const s = new Date(ev.start), now = new Date(), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (ev.allDay) return sameDay(s, now) ? 'Today' : sameDay(s, tomorrow) ? 'Tomorrow' : s.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    if (ev.start <= Date.now()) return 'Now';
    const mins = Math.round((ev.start - Date.now()) / 60000);
    if (mins < 60) return 'in ' + mins + ' min';
    return (sameDay(s, now) ? '' : sameDay(s, tomorrow) ? 'Tomorrow ' : s.toLocaleDateString([], { weekday: 'short' }) + ' ') + timeFmt.format(s);
  };
  // the next timed event that starts within 15 minutes (or has just started): this is what the chip shows
  function soonEvent() {
    const t = Date.now();
    return evList.find((e) => !e.allDay && e.end > t && e.start - t <= 15 * 60000 && t - e.start < 10 * 60000) || null;
  }
  function renderEvents() {
    evByDay = new Map();
    for (const e of evList) {
      const d = new Date(e.start), k = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      if (!evByDay.has(k)) evByDay.set(k, []);
      evByDay.get(k).push(e.kind === 'task' ? '\u2610 ' + e.title : e.allDay ? e.title : timeFmt.format(d) + '  ' + e.title);
    }
    const next = evList.find((e) => e.kind !== 'task' && e.end > Date.now()) || null;
    evEl.t.textContent = next ? next.title : (S.events && S.events.url ? 'Nothing coming up' : 'Add a calendar');
    evEl.l.textContent = next ? evWhen(next) : 'Next event';
    evEl.card.dataset.live = String(!!next && next.start <= Date.now() + 15 * 60000);
    evEl.card.title = next && next.link ? 'Join: ' + next.title : '';
    if (cal) cal.render();
    renderSat();
  }
  evEl.card.addEventListener('click', () => { const next = evList.find((e) => e.kind !== 'task' && e.end > Date.now()); if (next && next.link) api.openEvent(next.id); else if (!(S.events && S.events.url)) api.toggleSettings(); });
  api.onEvents && api.onEvents((r) => { evList = r && Array.isArray(r.list) ? r.list.filter((e) => e && typeof e.title === 'string' && Number.isFinite(e.start)) : []; renderEvents(); });
  Promise.resolve(api.eventsGet && api.eventsGet()).then((r) => { if (r && Array.isArray(r.list) && r.list.length) { evList = r.list; renderEvents(); } }).catch(() => {});
  setInterval(() => { if (evList.length) renderEvents(); }, 30 * 1000);                                    // "in 12 min" keeps counting

  // Pointing at a date with something on it shows what (events, and tasks marked with a box)
  const calTip = $('#cal-tip');
  document.addEventListener('mouseover', (e) => {
    const d = e.target.closest && e.target.closest('.cal-day[data-tip]');
    if (!d) { calTip.hidden = true; return; }
    const pg = $('.pages').getBoundingClientRect(), r = d.getBoundingClientRect(), box = wrap.getBoundingClientRect();
    calTip.textContent = d.dataset.tip; calTip.hidden = false;
    const w = calTip.offsetWidth, h = calTip.offsetHeight;
    let x = r.left - box.left + r.width / 2 - w / 2; x = Math.max(pg.left - box.left, Math.min(pg.right - box.left - w, x));
    let y = r.top - box.top - h - 6; if (y < pg.top - box.top - 8) y = r.bottom - box.top + 6;
    calTip.style.left = x + 'px'; calTip.style.top = y + 'px';
  });
  document.addEventListener('mouseleave', () => { calTip.hidden = true; });

  // Gmail card (Google): unread count and the latest sender; a click opens Gmail
  let gSt = { status: 'off', mail: { unread: 0, latest: [] } }, mailIdx = 0, mailSeen = -1;
  function markMailSeen() { const m = gSt.mail; if ((gSt.status === 'ok' || gSt.status === 'error') && m) mailSeen = m.unread; wrap.dataset.mail = ''; }     // opening the island = you have seen it (a static dot: nothing loops while collapsed)
  setInterval(() => { const l = (gSt.mail && gSt.mail.latest) || []; if (isOpen() && wrap.dataset.page === 'home' && l.length > 1) { mailIdx++; renderMail(); } }, 5000);
  function renderMail() {
    const t = $('#h-mail-t'), l = $('#h-mail-l'), ok = gSt.status === 'ok' || gSt.status === 'error', m = gSt.mail || { unread: 0, latest: [] };
    if (!ok && gSt.status !== 'needs-id') { t.textContent = 'Gmail'; l.textContent = 'Connect in Settings'; return; }
    t.textContent = m.unread === 0 ? 'Inbox zero' : m.unread + ' unread';
    const x = m.latest && m.latest.length ? m.latest[mailIdx % m.latest.length] : null;                  // the line cycles through the latest senders while the island is open
    l.textContent = x ? (x.from ? x.from + ': ' : '') + x.subject : (m.unread ? 'Open Gmail' : 'All caught up');
    if (ok) { if (mailSeen < 0 || m.unread < mailSeen) mailSeen = m.unread; wrap.dataset.mail = m.unread > mailSeen ? 'new' : ''; }
    $('#h-mail').title = (m.latest || []).map((x) => x.from + ' - ' + x.subject).join('\n');
  }
  $('#h-mail').addEventListener('click', () => { if (gSt.status === 'off') api.toggleSettings(); else api.googleOpen('mail'); });
  api.onGoogle && api.onGoogle((g) => { if (g && typeof g.status === 'string') { gSt = g; renderMail(); } });
  Promise.resolve(api.googleState && api.googleState()).then((g) => { if (g && typeof g.status === 'string') { gSt = g; renderMail(); } }).catch(() => {});

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
    const cards = { weather: $('#h-wx'), music: $('#h-mu'), countdown: cdEl.card, events: evEl.card, apps: $('#h-apps'), mail: $('#h-mail') };
    Object.values(cards).forEach((el) => { el.hidden = true; delete el.dataset.slot; });
    [h.first, h.second].forEach((id, i) => { const el = cards[id]; if (!el) return; el.hidden = false; el.dataset.slot = String(i + 1); el.style.order = String(i); });
    renderCountdown(); renderEvents(); renderApps();
  }
  // App shortcuts card: one click opens the program (the page sends only the position in the saved list)
  let appIcons = [], appKey = '';
  async function renderApps() {
    const box = $('#h-apps'), list = (S.shortcuts && S.shortcuts.apps) || [];
    const key = JSON.stringify(list.map((a) => a.path));
    if (key !== appKey) { appKey = key; try { const ic = await api.appIcons(); if (Array.isArray(ic)) appIcons = ic; } catch { appIcons = []; } }
    if (!list.length) { const b = document.createElement('button'); b.className = 'app-btn app-add sl'; b.textContent = 'Add app shortcuts'; b.addEventListener('click', () => api.toggleSettings()); box.replaceChildren(b); return; }
    box.replaceChildren(...list.map((a, i) => {
      const b = document.createElement('button'); b.className = 'app-btn sl'; b.title = a.name; b.setAttribute('aria-label', 'Open ' + a.name);
      if (appIcons[i]) { const im = document.createElement('img'); im.alt = ''; im.src = appIcons[i]; b.append(im); } else b.textContent = a.name.slice(0, 2);
      b.addEventListener('click', () => api.openApp(i)); return b;
    }));
  }
  setInterval(renderCountdown, 5 * 60 * 1000);

  // ---------------------------------------------------------------- Home: calendar, battery, keep-awake
  cal = window.DyCalendar.mount($('#h-cal'), { getWeekStart: () => S.calendar.weekStart, getEvents: (isoDay) => evByDay.get(isoDay) || null });

  const battEl = { chip: $('#h-batt'), icon: $('#h-batt-i'), text: $('#h-batt-t') };
  let battWarned = false, battPrev = null;
  function renderBattery(b) {
    const pct = Math.round(b.level * 100);
    const noBattery = b.charging && b.level === 1 && b.chargingTime === 0 && b.dischargingTime === Infinity;   // a desktop PC reports "full and plugged in"
    battEl.chip.hidden = noBattery;
    battEl.text.textContent = pct + '%';
    battEl.icon.setAttribute('href', b.charging ? '#i-bolt' : '#i-batt');
    battEl.chip.classList.toggle('low', !b.charging && pct <= 15);
    battEl.chip.title = b.charging ? 'Charging' : 'On battery';
    battPrev = b.charging;   // the charger and low-battery toasts come from main (devices.*), not here
    if (!b.charging && pct <= ((S.devices && S.devices.lowAt) || 15) && !battWarned) { mascot.react('sad'); battWarned = true; }
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
  const cb = { list: $('#cb-list'), empty: $('#cb-empty'), clear: $('#cb-clear'), q: $('#cb-q') };
  let cbItems = [], copiedId = -1, copiedUntil = 0, cbQuery = '';
  function renderClipboard(list) {
    cbItems = Array.isArray(list) ? list.filter((x) => x && Number.isInteger(x.id) && (x.kind === 'text' || x.kind === 'image')) : [];
    const words = cbQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const shown = words.length ? cbItems.filter((x) => x.kind === 'text' && words.every((w) => String(x.text).toLowerCase().includes(w))) : cbItems;
    let budget = $('.pages').clientHeight - 32 + 4;                                       // under a 24px header and an 8px gap; rows are 28px (44px for a picture) plus 4px
    const rows = [];
    for (const x of shown) { const h = x.kind === 'image' ? 48 : 32; if (budget < h && rows.length) break; budget -= h; rows.push(x); }
    cb.list.replaceChildren(...rows.map((x, i) => {
      const row = document.createElement('div'); row.className = 'cb-row'; row.style.setProperty('--n', String(i));
      const b = document.createElement('button'); b.className = 'cb-item sl' + (x.kind === 'image' ? ' img' : '') + (x.id === copiedId && Date.now() < copiedUntil ? ' copied' : ''); b.dataset.id = String(x.id); b.style.setProperty('--n', String(i));
      if (x.kind === 'image') { const im = document.createElement('img'); im.alt = 'Copied picture'; im.src = String(x.thumb || ''); b.append(im); b.title = 'A copied picture'; }
      else { const s = document.createElement('span'); s.textContent = String(x.text).replace(/\s+/g, ' ').trim() || '(blank)'; b.append(s); b.title = String(x.text).slice(0, 300); }
      const pin = document.createElement('button'); pin.className = 'cb-pin sl'; pin.dataset.pin = String(x.id); pin.setAttribute('aria-pressed', String(!!x.pinned)); pin.setAttribute('aria-label', x.pinned ? 'Unpin' : 'Pin'); pin.title = x.pinned ? 'Unpin' : 'Pin to the top';
      pin.innerHTML = '<svg class="i" width="14" height="14"><use href="#i-keep"/></svg>';
      row.append(b, pin); return row;
    }));
    const none = shown.length === 0;
    cb.empty.hidden = !none; cb.list.hidden = none;
    cb.empty.textContent = cbItems.length ? 'Nothing matches that' : (S.clipboard && S.clipboard.images ? 'Copy text or a picture and it shows up here' : 'Copy something and it shows up here');
  }
  // how many rows fit depends on the page height, which changes while the island opens/resizes: redo the count whenever it changes
  if (typeof ResizeObserver === 'function') {
    let cbH = -1, cbRaf = 0;
    new ResizeObserver(() => {
      const h = $('.pages').clientHeight; if (h === cbH) return; cbH = h;
      cancelAnimationFrame(cbRaf); cbRaf = requestAnimationFrame(() => renderClipboard(cbItems));
    }).observe($('.pages'));
  }
  cb.list.addEventListener('click', async (e) => {
    const pin = e.target.closest('.cb-pin');
    if (pin) { api.clipboardPin(Number(pin.dataset.pin)); return; }
    const b = e.target.closest('.cb-item'); if (!b) return;
    const id = Number(b.dataset.id);
    copiedId = id; copiedUntil = Date.now() + 1200;                              // remembered by id: the list is rebuilt when the copy lands
    const ok = await (S.clipboard && S.clipboard.paste && api.clipboardPaste ? api.clipboardPaste(id) : api.clipboardCopy(id));
    if (ok) { renderClipboard(cbItems); setTimeout(() => renderClipboard(cbItems), 1250); }
  });
  cb.clear.addEventListener('click', () => api.clipboardClear());
  // the search box: the window takes the keyboard while it has the focus
  cb.q.addEventListener('focus', () => { editing = true; grabKeys('clip-search'); });
  cb.q.addEventListener('blur', () => { editing = false; releaseKeys('clip-search'); if (!wrap.matches(':hover') && !pinned) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 280); } });
  cb.q.addEventListener('input', () => { cbQuery = cb.q.value; renderClipboard(cbItems); });
  cb.q.addEventListener('keydown', (e) => { if (e.key === 'Escape') { cb.q.value = ''; cbQuery = ''; renderClipboard(cbItems); cb.q.blur(); } });
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
  setInterval(() => { if (S.autoHide || wrap.classList.contains('autohidden')) updateVisibility(); }, 120);   // nothing can be auto-hidden with the setting off: do not wake up for it
  api.onNear((v) => { near = v; updateVisibility(); });
  function armHotkeyTimer() {
    clearTimeout(hotkeyTimer);
    hotkeyTimer = setTimeout(() => { hotkeyReveal = false; pinned = false; if (!wrap.matches(':hover') && !editing) close(); updateVisibility(); }, 8000);
  }
  // Keys while the island has the keyboard (opened with the shortcut): arrows or 1-9 switch tabs, Space plays and pauses, Up / Down is the volume, Esc closes
  function stepTab(d) { const vis = visibleTabs(), cur = vis.indexOf(wrap.dataset.page); if (cur < 0) return; go(vis[(cur + d + vis.length) % vis.length]); }
  document.addEventListener('keydown', (e) => {
    if (!isOpen() || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target && e.target.matches && e.target.matches('input, textarea, select')) return;          // typing in the city box
    if (editing) return;
    if (hotkeyReveal) armHotkeyTimer();                                                                  // using the keys keeps it open
    const page = wrap.dataset.page;
    if (e.key === 'ArrowRight' && page !== 'approve') { e.preventDefault(); stepTab(1); }
    else if (e.key === 'ArrowLeft' && page !== 'approve') { e.preventDefault(); stepTab(-1); }
    else if (/^[1-9]$/.test(e.key) && page !== 'approve') { const vis = visibleTabs(), t = vis[Number(e.key) - 1]; if (t) { e.preventDefault(); go(t); } }
    else if ((e.key === 'r' || e.key === 'R') && !e.repeat && ['home', 'weather', 'usage'].includes(page)) { e.preventDefault(); if (page === 'weather') runRefresh(['weather'], [$('#w-rf')]); else if (page === 'usage') runRefresh(['usage'], [$('#u-rf')]); else refreshHome([$('#h-rf'), $('#h-ev-rf')]); }
    else if (e.key === 'Escape' && !tray.classList.contains('show')) { if (editing) return; hotkeyReveal = false; pinned = false; close(true); updateVisibility(); }
    else if ((e.key === ' ' || e.key === 'MediaPlayPause') && page === 'music' && !(e.target && e.target.closest && e.target.closest('button'))) { e.preventDefault(); api.media('toggle'); }
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && page === 'music') { e.preventDefault(); nudgeVolume(e.key === 'ArrowUp' ? 5 : -5); }
  });
  api.onHotkey((wantOpen) => {
    clearTimeout(hotkeyTimer);
    if (typeof wantOpen === 'boolean' && wantOpen === isOpen()) { if (wantOpen) { /* already open: just keep it up a while */ } else return; }
    if (typeof wantOpen === 'boolean' ? !wantOpen : isOpen()) { if (editing) endEdit(false); hotkeyReveal = false; pinned = false; close(true); updateVisibility(); return; }   // pressed again: close it (and let go of the keyboard if the city box had it)
    hotkeyReveal = true; pinned = true; noteActivity(); open(); updateVisibility(); grabKeys('hotkey');
    armHotkeyTimer();
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
  setInterval(() => { if (S.mascot.enabled || eyesOn) syncMascot(); }, 500);        // no mascot, no checking
  api.onGaze((g) => { if (g) mascot.lookAt(g.nx, g.ny); });

  // What features.js (LocalSend, shelf, capture chip, network, mixer...) needs from this file
  window.DyHost = { go, open, close, pushNotice, grabKeys, releaseKeys, isOpen, wrap, $, settings: () => S, hovered: () => wrap.matches(':hover'),
    pin(v) { pinned = !!v; if (v) clearTimeout(closeTimer); }, hold(v) { editing = !!v; }, page: () => wrap.dataset.page, noteActivity, visibleTabs,
    settle() { if (!wrap.matches(':hover') && !editing && !pinned) { clearTimeout(closeTimer); closeTimer = setTimeout(close, 700); } updateVisibility(); }, update: () => updateVisibility() };
  applySettings(FALLBACK);
  Promise.resolve(api.getSettings()).then((s) => { applySettings(s); const t = store.get('lastTab', 'home'); if (t !== 'home' && wrap.dataset.page !== 'approve' && visibleTabs().includes(t)) go(t); }).catch(() => { /* keep the built-in defaults */ });
  api.onSettings(applySettings);
  Promise.resolve(api.clipboardList && api.clipboardList()).then(renderClipboard).catch(() => {});

  renderTimer(); renderMedia();
})();
