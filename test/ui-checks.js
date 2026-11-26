// Feature checks for test/ui-smoke.js (they run after the tab tour, with the island open on the last tab).
module.exports = async ({ ev, check, sleep, shot }) => {
  const go = async (tab) => { await ev(`document.querySelector('.nav [data-go="${tab}"]').click()`); await sleep(500); };

  // ---- Weather: the city picker, the location row, and the hours / days switch
  await go('weather');
  await ev("document.querySelector('#w-city').click()");
  await ev("(() => { const i = document.querySelector('#w-input'); i.value = 'Spring'; i.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(600);
  await check('city picker lists places and the location row', "document.querySelectorAll('#w-sug .w-sug-i').length >= 3 && !!document.querySelector('#w-sug .w-sug-i.loc')");
  await shot('weather-picker');
  await ev("document.querySelector('#w-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
  await ev("document.querySelector('#w-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))");
  await sleep(500);
  await check('picking a place asks for its coordinates', "!!window.__weatherAsked && typeof window.__weatherAsked === 'object' && Number.isFinite(window.__weatherAsked.lat)");
  await check('the city box closed', "document.querySelector('#w-input').hidden === true");
  await ev("document.querySelector('#w-hours').click()");
  await sleep(400);
  await check('next days view shows five days', "document.querySelector('#w-hours').dataset.view === 'days' && document.querySelectorAll('#w-hours .hour').length === 5");
  await shot('weather-days');
  await check('the tab bar is a floating capsule and the selected tab is a pill', "(() => { const n = document.querySelector('.nav'), b = n.querySelector('[aria-selected=true]'); return parseFloat(getComputedStyle(n).paddingTop) >= 2 && parseFloat(getComputedStyle(n).borderTopLeftRadius) >= 20 && n.getBoundingClientRect().height === 40 && parseFloat(getComputedStyle(b).borderTopLeftRadius) >= 16 || [getComputedStyle(n).paddingTop, getComputedStyle(n).borderTopLeftRadius, n.getBoundingClientRect().height, getComputedStyle(b).borderTopLeftRadius].join(); })()");
  await check('weather hero shows high and low and every weather block is inside the page', "(() => { const p = document.querySelector('#p-weather').getBoundingClientRect(); const ok = [...document.querySelectorAll('#p-weather .w-now, #p-weather .w-stats, #p-weather .w-hours')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= p.left - 1 && r.right <= p.right + 1 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1; }); return ok && /H \\d+/.test(document.querySelector('#w-hilo').textContent); })()");
  await ev("document.querySelector('#w-hours').click()");
  await sleep(300);
  await check('back to the hours view', "document.querySelector('#w-hours').dataset.view === 'hours'");
};

// ---- Page sizes and spring easing
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  const go = async (tab) => { await ev(`document.querySelector('.nav [data-go="${tab}"]').click()`); await sleep(900); };
  const w = () => ev("Math.round(document.querySelector('#wrap').getBoundingClientRect().width)");
  await go('home'); const home = await w();
  await go('timer'); const timer = await w();
  await go('music'); const music = await w();
  if (!(timer < home)) ctx.errors.push('the timer should open smaller than home: ' + timer + ' vs ' + home);
  if (!(music > home)) ctx.errors.push('the music page should open bigger than home');
  if ([home, timer, music].join() !== '520,464,544') ctx.errors.push('sizes: ' + [home, timer, music].join());
  await check('spring easing is in use (Expressive)', "getComputedStyle(document.documentElement).getPropertyValue('--ease-open').trim().startsWith('linear(')");
  await check('the island reported its size', "!!window.__size && window.__size.w === 544");
  await shot('music-roomy');
  await ev("window.__settings({ motion: 'calm' })"); await sleep(200);
  await check('Calm goes back to the plain curves', "getComputedStyle(document.documentElement).getPropertyValue('--ease-open').trim().startsWith('cubic-bezier')");
  await ev("window.__settings({ motion: 'expressive', size: { adaptive: false } })"); await sleep(500);
  await check('with "fit the size" off the music page is the normal size', "Math.round(document.querySelector('#wrap').getBoundingClientRect().width) === 520");
  await ev("window.__settings({ size: { adaptive: true } })"); await go('home');
})(module.exports);

// ---- Cover colours, toast extras
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot, errors } = ctx;
  await ev("window.__settings({ music: { artColors: false } })"); await sleep(400);
  const glowOff = await ev("document.querySelector('#wrap').dataset.glow || ''");
  await ev("window.__settings({ music: { artColors: true } })"); await sleep(900);
  const glowOn = await ev("document.querySelector('#wrap').dataset.glow || ''");
  const c1 = await ev("document.querySelector('#m-glow').style.getPropertyValue('--art1')");
  if (glowOff || glowOn !== '1' || !/^#[0-9A-F]{6}$/.test(c1)) errors.push('the cover glow should switch with its setting and carry the cover colour (off=' + glowOff + ', on=' + glowOn + ', ' + c1 + ')');
  const primBefore = await ev("document.documentElement.style.getPropertyValue('--md-sys-color-primary')");
  await ev("window.__settings({ theme: { preset: 'nord' } })"); await sleep(300);
  await ev("window.__settings({ theme: { preset: 'teal' } })"); await sleep(300);
  const primAfter = await ev("document.documentElement.style.getPropertyValue('--md-sys-color-primary')");
  if (primBefore !== primAfter) errors.push('the cover must not recolour the island theme');
  await ev("document.querySelector('.nav [data-go=music]').click()"); await sleep(800);
  await check('the glow layer is visible in the Music tab only', "getComputedStyle(document.querySelector('#m-glow')).opacity === '1'");
  await shot('music-glow');
  await ev("document.querySelector('.nav [data-go=home]').click()"); await sleep(900);
  await check('and gone in the other tabs', "getComputedStyle(document.querySelector('#m-glow')).opacity === '0'");
  // toasts: the drain line and the +N badge, and a flick dismisses one
  await ev("window.__hotkey(false)"); await sleep(700);
  await ev("window.__notice({ kind: 'done', title: 'First', sub: 'one' }); window.__notice({ kind: 'attention', title: 'Second', sub: 'two' }); window.__notice({ kind: 'done', title: 'Third', sub: 'three' })");
  await sleep(700);
  await check('a toast is showing with a +2 badge', "document.querySelector('#wrap').classList.contains('has-notice') && !document.querySelector('#notice .n-more').hidden && document.querySelector('#notice .n-more').textContent === '+2'");
  await check('the drain line is animating', "getComputedStyle(document.querySelector('#notice .n-bar')).animationName === 'n-drain'");
  await shot('toast');
  await ev("(() => { const n = document.querySelector('#notice'); n.dispatchEvent(new PointerEvent('pointerdown', { clientY: 40, bubbles: true })); n.dispatchEvent(new PointerEvent('pointermove', { clientY: 10, buttons: 1, bubbles: true })); })()");
  await sleep(900);
  await check('flicking up showed the next toast', "document.querySelector('#n-title').textContent === 'Second'");
  await ev("window.__hotkey(true)"); await sleep(600);
})(module.exports);

// ---- Volume HUD, keyboard, call-aware Do not disturb, music extras
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot, errors } = ctx;
  await ev("window.__hotkey(false)"); await sleep(700);
  await ev("window.__volume({ pct: 40, mute: false, init: true })"); await sleep(100);
  await check('the start-up volume does not pop a HUD', "!document.querySelector('#wrap').classList.contains('has-notice')");
  await ev("window.__volume({ pct: 55, mute: false })"); await sleep(500);
  await check('a volume change shows the HUD', "document.querySelector('#wrap').dataset.hud === '1' && document.querySelector('#n-sub').textContent === '55%' && document.querySelector('#notice').style.getPropertyValue('--v') === '55'");
  await shot('volume-hud');
  await sleep(2000);
  await check('the HUD goes away by itself', "!document.querySelector('#wrap').classList.contains('has-notice')");
  // do not disturb during a call (derived, not saved)
  await ev("window.__settings({ meetings: { dnd: true } })");
  await ev("window.__priv({ camera: true, mic: false })"); await sleep(300);
  await ev("window.__notice({ kind: 'done', title: 'During a call', sub: 'x' })"); await sleep(600);
  await check('toasts are held back while the camera is on', "!document.querySelector('#wrap').classList.contains('has-notice')");
  await ev("window.__priv({ camera: false, mic: false })"); await sleep(300);
  await ev("window.__notice({ kind: 'done', title: 'After the call', sub: 'y' })"); await sleep(600);
  await check('toasts come back when the call ends', "document.querySelector('#wrap').classList.contains('has-notice') && document.querySelector('#n-title').textContent === 'After the call'");
  await ev("window.__settings({ meetings: { dnd: false } })"); await sleep(6000);
  // a mirrored Windows notification carries an action id: a click hands it to main (which opens the app) instead of opening the island
  await ev("window.__noticeOpened = undefined; window.__notice({ kind: 'done', tone: 'info', title: 'Snipping Tool: Screenshot copied', sub: 'Select here to mark up', act: 'n7' })"); await sleep(700);
  await ev("document.querySelector('.notice').click()"); await sleep(300);
  await check('clicking a mirrored notification opens its app, not the island', "window.__noticeOpened === 'n7' && !document.querySelector('#wrap').classList.contains('open')");
  await ev("window.__notice({ kind: 'done', title: 'Bad', sub: 'x', act: 'calc.exe' })"); await sleep(700);
  await ev("window.__noticeOpened = undefined; document.querySelector('.notice').click()"); await sleep(300);
  await check('a notice with a malformed action id is not sent to main', "window.__noticeOpened === undefined");
  await ev("if (document.querySelector('#wrap').classList.contains('open')) window.DyHost.close(true)"); await sleep(500);
  // keyboard: the shortcut opens the island AND takes the keyboard; keys work; Esc gives it back
  await ev("window.__input = undefined; window.__hotkey(true)"); await sleep(700);
  await check('opening with the shortcut asks for the keyboard', "window.__input === true");
  await ev("document.querySelector('.nav [data-go=home]').click()"); await sleep(300);
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))"); await sleep(300);
  await check('the right arrow goes to the next tab', "document.querySelector('#wrap').dataset.page === 'music'");
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true }))"); await sleep(300);
  await check('the number keys pick a tab', "document.querySelector('#wrap').dataset.page === 'weather'");
  await ev("document.querySelector('.nav [data-go=music]').click()"); await sleep(300);
  await ev("window.__volume({ pct: 50, mute: false, init: true }); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))"); await sleep(200);
  await check('the up arrow raises the volume on the music page', "window.__volSet === 55 && !document.querySelector('#m-vol').hidden");
  await ev("window.__volSet = undefined; document.querySelector('#p-music').dispatchEvent(new WheelEvent('wheel', { deltaY: 100, bubbles: true }))"); await sleep(100);
  await check('the wheel on the music page lowers the volume', "window.__volSet === 51");
  await check('shuffle and repeat buttons show when the player supports them', "!document.querySelector('#m-shuf').hidden && !document.querySelector('#m-rep').hidden");
  await check('the player name is the cover tooltip', "document.querySelector('#m-art').title === 'Playing in Spotify'");
  await shot('music-extras');
  await ev("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"); await sleep(700);
  await check('Escape closes the island and lets go of the keyboard', "!document.querySelector('#wrap').classList.contains('open') && window.__input === false");
})(module.exports);

// ---- Calendar events: card, dots, chip
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  await ev("window.__hotkey(true)"); await sleep(600);
  await ev("window.__settings({ home: { first: 'events', second: 'music' } }); document.querySelector('.nav [data-go=home]').click()"); await sleep(700);
  await check('the Next event card shows the next event and when', "document.querySelector('#h-ev-t').textContent === 'Design review' && /^in [34] min$/.test(document.querySelector('#h-ev-l').textContent)");
  await check('calendar days with events have a dot', "document.querySelectorAll('.cal-day.has-ev').length >= 1");
  await shot('home-events');
  await ev("window.__opened = []; document.querySelector('#h-ev').click()"); await sleep(100);
  await check('clicking the card opens the meeting link by id', "window.__opened.join() === 'a'");
  await ev("window.__hotkey(false)"); await sleep(900);
  await check('a "starting soon" chip appears for an event within 15 minutes', "document.querySelector('#chip').classList.contains('on') && document.querySelector('#chip').dataset.kind === 'event' && /in [34] min/.test(document.querySelector('#chip .chip-value').textContent)");
  await shot('event-chip');
  await ev("window.__settings({ home: { first: 'weather', second: 'music' } })");
})(module.exports);

// ---- Timers: modes, typed time, wheel, three slots, stopwatch
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  await ev("window.__hotkey(true)"); await sleep(600);
  await ev("document.querySelector('.nav [data-go=timer]').click()"); await sleep(600);
  await check('the timer starts as a 5 minute timer', "document.querySelector('#t-time').textContent === '05:00' && document.querySelector('#t-mode-l').textContent === 'Timer'");
  // type a time
  await ev("document.querySelector('#t-time').click()"); await sleep(100);
  await check('clicking the time opens the box and asks for the keyboard', "!document.querySelector('#t-input').hidden && window.__input === true");
  await ev("(() => { const i = document.querySelector('#t-input'); i.value = '7:30'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()"); await sleep(200);
  await check('7:30 typed gives 07:30', "document.querySelector('#t-time').textContent === '07:30' && document.querySelector('#t-input').hidden");
  await ev("document.querySelector('#t-time').click(); { const i = document.querySelector('#t-input'); i.value = 'nonsense'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }"); await sleep(200);
  await check('nonsense is ignored', "document.querySelector('#t-time').textContent === '07:30'");
  // the wheel
  await ev("document.querySelector('.ring').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }))"); await sleep(100);
  await check('the wheel adds a minute', "document.querySelector('#t-time').textContent === '08:30'");
  // modes
  await ev("document.querySelector('#t-mode').click()"); await sleep(150);
  await check('the mode button goes to Repeat', "document.querySelector('#t-mode-l').textContent === 'Repeat'");
  await ev("document.querySelector('#t-mode').click()"); await sleep(150);
  await check('then Pomodoro, with 25:00 and the round', "document.querySelector('#t-mode-l').textContent === 'Focus 1/4' && document.querySelector('#t-time').textContent === '25:00' && document.querySelector('#t-chips').hidden");
  await shot('timer-pomodoro');
  await ev("document.querySelector('#t-mode').click()"); await sleep(150);
  await check('then Stopwatch', "document.querySelector('#t-mode-l').textContent === 'Stopwatch' && document.querySelector('#t-time').textContent === '00:00'");
  await ev("document.querySelector('#t-start').click()"); await sleep(1300);
  await check('the stopwatch counts up', "/^00:0[1-2]$/.test(document.querySelector('#t-time').textContent) && document.querySelector('#t-start-l').textContent === 'Pause'");
  // a second timer runs next to it
  await ev("document.querySelector('#t-slots [data-slot=\"1\"]').click()"); await sleep(200);
  await check('slot 2 is its own timer (5 min, not running)', "document.querySelector('#t-time').textContent === '05:00' && document.querySelector('#t-start-l').textContent === 'Start' && document.querySelector('#t-slots [data-slot=\"0\"]').dataset.run === 'true'");
  await ev("document.querySelector('#t-start').click()"); await sleep(300);
  await ev("window.__hotkey(false)"); await sleep(900);
  await check('the chip counts both running timers', "document.querySelector('#chip').dataset.kind === 'timer' && /Timers .?2/.test(document.querySelector('#chip .chip-label').textContent)");
  await shot('timer-chip');
  // clean up: stop both, back to timers
  await ev("window.__hotkey(true)"); await sleep(500);
  await ev("document.querySelector('#t-start').click(); document.querySelector('#t-slots [data-slot=\"0\"]').click(); document.querySelector('#t-start').click(); document.querySelector('#t-mode').click(); document.querySelector('#t-mode').click(); document.querySelector('#t-mode').click(); document.querySelector('#t-reset').click()"); await sleep(300);
  await ev("window.__hotkey(false)"); await sleep(500);
})(module.exports);

// ---- Clipboard: pins, picture, search, paste
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  await ev("window.__hotkey(true)"); await sleep(500);
  await ev("document.querySelector('.nav [data-go=clipboard]').click()"); await sleep(600);
  await check('the clipboard lists text, a picture and a pinned item first', "document.querySelectorAll('#cb-list .cb-row').length >= 3 && !!document.querySelector('#cb-list .cb-item.img img') && document.querySelector('#cb-list .cb-row .cb-pin').getAttribute('aria-pressed') === 'true'");
  await shot('clipboard');
  await ev("(() => { const q = document.querySelector('#cb-q'); q.value = 'meeting'; q.dispatchEvent(new Event('input', { bubbles: true })); })()"); await sleep(200);
  await check('search narrows the list (pictures drop out)', "document.querySelectorAll('#cb-list .cb-row').length === 1 && document.querySelector('#cb-list .cb-item').textContent.includes('Meeting')");
  await ev("(() => { const q = document.querySelector('#cb-q'); q.value = 'zzz'; q.dispatchEvent(new Event('input', { bubbles: true })); })()"); await sleep(200);
  await check('no match says so', "document.querySelector('#cb-empty').textContent === 'Nothing matches that' && !document.querySelector('#cb-empty').hidden");
  await ev("(() => { const q = document.querySelector('#cb-q'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); })()"); await sleep(200);
  await ev("document.querySelectorAll('#cb-list .cb-pin')[2].click()"); await sleep(300);
  await check('pinning moves an item to the top', "document.querySelectorAll('#cb-list .cb-pin')[0].getAttribute('aria-pressed') === 'true' && document.querySelectorAll('#cb-list .cb-pin')[1].getAttribute('aria-pressed') === 'true'");
  await ev("window.__copied = undefined; window.__pasted = undefined; document.querySelectorAll('#cb-list .cb-item')[2].click()"); await sleep(300);
  await check('with Click to paste off, a click only copies', "window.__copied !== undefined && window.__pasted === undefined");
  await ev("window.__settings({ clipboard: { paste: true } }); document.querySelectorAll('#cb-list .cb-item')[2].click()"); await sleep(300);
  await check('with Click to paste on, a click pastes', "window.__pasted !== undefined");
  await ev("document.querySelector('#cb-clear').click()"); await sleep(300);
  await check('Clear keeps the pinned items', "document.querySelectorAll('#cb-list .cb-row').length === 2");
  await ev("window.__settings({ clipboard: { paste: false } }); window.__hotkey(false)"); await sleep(500);
})(module.exports);

// ---- View transitions: a Home card flies its cover / icon into its page, and leaves nothing behind
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  await ev("window.__hotkey(true)"); await sleep(600);
  await ev("document.querySelector('.nav [data-go=home]').click()"); await sleep(700);
  await ev("window.__settings({ home: { first: 'weather', second: 'music' } })"); await sleep(300);
  await ev("document.querySelector('#h-mu').click()"); await sleep(2500);
  await check('the music card opens the music page (shared-element transition)', "document.querySelector('#wrap').dataset.page === 'music' && document.querySelector('#wrap').classList.contains('open')");
  await check('the transition names are cleared afterwards', "document.querySelector('#h-mu-art').style.viewTransitionName === '' && document.querySelector('#m-art').style.viewTransitionName === ''");
  await ev("document.querySelector('.nav [data-go=home]').click()"); await sleep(700);
  await ev("document.querySelector('#h-wx').click()"); await sleep(2500);
  await check('the weather card opens the weather page', "document.querySelector('#wrap').dataset.page === 'weather' && document.querySelector('#wrap').classList.contains('open')");
  await check('the weather icon names are cleared', "!document.querySelector('#h-wx .tile').style.viewTransitionName && !document.querySelector('#w-icon').closest('svg').style.viewTransitionName");
  await ev("window.__hotkey(false)"); await sleep(600);
})(module.exports);

// ---- Quick actions button and the DNS provider tile
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  await ev("window.__hotkey(true)"); await sleep(600);
  await check('the quick actions are closed until you press their button', "!document.querySelector('#qtray').classList.contains('show')");
  await ev("document.querySelector('#settings-btn').dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))"); await sleep(600);
  await check('hovering the gear no longer opens them', "!document.querySelector('#qtray').classList.contains('show')");
  await ev("document.querySelector('#tray-btn').click()"); await sleep(700);
  await check('the button under the gear opens them', "document.querySelector('#qtray').classList.contains('show') && document.querySelector('#tray-btn').getAttribute('aria-pressed') === 'true'");
  await check('the DNS provider tile shows Automatic', "!document.querySelector('[data-q=dnsp]').hidden && document.querySelector('[data-q=dnsp] .qs').textContent === 'Auto'");
  await shot('quick-actions');
  await check('the removed tiles are gone from the tray', "['theme', 'snip', 'night', 'calc', 'sysmute', 'rec', 'restart', 'quit'].every((k) => !document.querySelector('.qtile[data-q=' + k + ']'))");
  await check('the tray scrolls and stays inside the window', "(() => { const t = document.querySelector('#qtray'), r = t.getBoundingClientRect(); const ok = getComputedStyle(t).overflowY === 'auto' && r.bottom <= innerHeight && r.top >= 0; const last = [...t.querySelectorAll('.qtile:not([hidden])')].pop(); last.scrollIntoView({ block: 'nearest' }); const lr = last.getBoundingClientRect(); return ok && lr.bottom <= t.getBoundingClientRect().bottom + 1; })()");
  await check('tray panel is two columns, tiles equal, panel inside the window', "(() => { const t = document.querySelector('#qtray'), pr = t.getBoundingClientRect(); const ts = [...t.querySelectorAll('.qtile:not([hidden])')]; const rs = ts.map((x) => x.getBoundingClientRect()); const xs = new Set(rs.map((r) => Math.round(r.left))); const w = new Set(rs.map((r) => Math.round(r.width))), h = new Set(rs.map((r) => Math.round(r.height))); return pr.left >= 0 && pr.right <= innerWidth && pr.top >= 0 && pr.bottom <= innerHeight && xs.size === 2 && w.size === 1 && h.size === 1 && getComputedStyle(t).gridTemplateColumns.split(' ').length === 2; })()");
  await check('tray tiles have an icon circle, a label and a state line, with no truncated label', "[...document.querySelectorAll('#qtray .qtile:not([hidden])')].every((x) => x.querySelector('.qic') && x.querySelector('.ql').textContent && x.querySelector('.qs').textContent && x.querySelector('.ql').scrollWidth <= x.querySelector('.ql').clientWidth) || [...document.querySelectorAll('#qtray .ql')].filter((l) => l.scrollWidth > l.clientWidth).map((l) => l.textContent + ':' + l.scrollWidth + '>' + l.clientWidth).join()");
  await check('active tile uses the primary container with a stadium radius', "(() => { const a = document.querySelector('#qtray .qtile[aria-checked=true]'); return !a || parseFloat(getComputedStyle(a).borderTopLeftRadius) >= 24; })()");
  await shot('tray-qs');
  await ev("document.querySelector('[data-q=dnsp]').click()"); await sleep(400);
  await check('one click goes to the first provider', "document.querySelector('[data-q=dnsp] .qs').textContent === 'Cloudflare'");
  await ev("document.querySelector('[data-q=dnsp]').click()"); await sleep(300);
  await ev("document.querySelector('[data-q=dnsp]').click()"); await sleep(300);
  await ev("document.querySelector('[data-q=dnsp]').click()"); await sleep(300);
  await check('and round to Automatic again', "document.querySelector('[data-q=dnsp] .qs').textContent === 'Auto'");
  await ev("document.querySelector('#tray-btn').click()"); await sleep(500);
  await check('pressing the button again closes them', "!document.querySelector('#qtray').classList.contains('show')");
  await ev("window.__hotkey(false)"); await sleep(500);
  // design pass: platform support, spring tokens, and nothing loops while the island is collapsed
  await check('the real window supports linear(), @property and corner-shape', "CSS.supports('transition-timing-function', 'linear(0, 0.5, 1)') && typeof CSSPropertyRule === 'function' && CSS.supports('corner-shape', 'squircle')");
  await check('spring tokens are defined as CSS variables', "['--spring', '--spring-soft', '--ease-press', '--d-item', '--d-fx', '--d-open', '--ease-open'].every((v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim())");
  await sleep(1200);
  await check('no infinite animation runs while the island is collapsed', "(() => { const open = document.querySelector('#wrap').classList.contains('open'); const loops = document.getAnimations().filter((a) => a.playState === 'running' && a.animationName !== 'eq' && a.effect && a.effect.getComputedTiming().iterations === Infinity); window.__loops = loops.map((a) => a.animationName + ' on ' + (a.effect.target ? (a.effect.target.id || String(a.effect.target.className && a.effect.target.className.baseVal !== undefined ? a.effect.target.className.baseVal : a.effect.target.className)) : '?')); return open || loops.length === 0 || window.__loops.join(); })()");
  await check('shape tokens exist and every polygon has 96 vertices', "['circle', 'pill', 'squircle', 'cookie', 'burst'].every((n) => getComputedStyle(document.documentElement).getPropertyValue('--poly-' + n).split(',').length === 96)");
  await check('theme colours are registered properties, so a theme change cross-fades', "CSS.supports('color', 'var(--md-sys-color-primary)') && (() => { const r = document.createElement('div'); document.body.appendChild(r); r.style.cssText = 'color: var(--md-sys-color-primary)'; const ok = getComputedStyle(r).color.startsWith('rgb'); r.remove(); return ok; })()");
  // idle: chips (work loader, approve pulse, privacy ping) shown while collapsed, plus requestAnimationFrame counted
  await ev("(() => { const c = document.querySelector('#chip'); c.dataset.kind = 'work'; c.dataset.level = ''; c.classList.add('on'); })()");
  await ev("window.__priv({ camera: true, mic: true })"); await sleep(900);
  await ev("window.__raf = 0; if (!window.__rafWrapped) { window.__rafWrapped = true; const o = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (fn) => { window.__raf++; return o(fn); }; } 0");
  await sleep(1500);
  await check('collapsed with the work chip and the privacy chip showing: no infinite animation runs', "(() => { const loops = document.getAnimations().filter((a) => a.playState === 'running' && a.animationName !== 'eq' && a.effect && a.effect.getComputedTiming().iterations === Infinity); window.__loops2 = loops.map((a) => a.animationName); return document.querySelector('#wrap').classList.contains('open') || loops.length === 0 || window.__loops2.join(); })()");
  await ev("document.querySelector('#chip').dataset.kind = 'approve'"); await sleep(900);
  await check('and with the approve chip showing', "(() => { const loops = document.getAnimations().filter((a) => a.playState === 'running' && a.animationName !== 'eq' && a.effect && a.effect.getComputedTiming().iterations === Infinity); return document.querySelector('#wrap').classList.contains('open') || loops.length === 0 || loops.map((a) => a.animationName).join(); })()");
  await check('collapsed: no requestAnimationFrame calls in 1.5 s', "window.__raf === 0 || window.__raf");
  await ev("window.__priv({ camera: false, mic: false }); document.querySelector('#chip').dataset.kind = ''; document.querySelector('#chip').classList.remove('on')"); await sleep(300);
})(module.exports);

// ---- App shortcuts card on Home
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  await ev("window.__hotkey(true)"); await sleep(500);
  await ev("window.__settings({ home: { first: 'apps', second: 'weather' } }); document.querySelector('.nav [data-go=home]').click()"); await sleep(800);
  await check('the App shortcuts card shows one button per app', "document.querySelectorAll('#h-apps .app-btn').length === 2 && !!document.querySelector('#h-apps .app-btn img')");
  await shot('home-apps');
  await ev("window.__apps = []; document.querySelectorAll('#h-apps .app-btn')[1].click()"); await sleep(100);
  await check('a click opens that shortcut by its position', "window.__apps.join() === '1'");
  await ev("window.__settings({ home: { first: 'weather', second: 'music' } }); window.__hotkey(false)"); await sleep(500);
})(module.exports);

// ---- Calendar tooltip with events and tasks, Gmail card
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  await ev("window.__hotkey(true)"); await sleep(500);
  await ev("window.__settings({ home: { first: 'mail', second: 'events' } }); document.querySelector('.nav [data-go=home]').click()"); await sleep(900);
  await check('the Gmail card shows the unread count and one of the latest senders (it cycles)', "document.querySelector('#h-mail-t').textContent === '7 unread' && /^(Sam Lee: Lunch on Friday\?|GitHub: )/.test(document.querySelector('#h-mail-l').textContent)");
  await ev("window.__googleOpen = ''; document.querySelector('#h-mail').click()"); await sleep(100);
  await check('clicking it opens Gmail', "window.__googleOpen === 'mail'");
  await ev("(() => { const d = [...document.querySelectorAll('.cal-day[data-tip]')].find((x) => x.dataset.tip.includes('File report')); d.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); })()"); await sleep(200);
  await check('pointing at a date shows its events and tasks', "!document.querySelector('#cal-tip').hidden && document.querySelector('#cal-tip').textContent.includes('File report') && document.querySelector('#cal-tip').textContent.includes('Holiday')");
  await shot('calendar-tip');
  await ev("window.__settings({ home: { first: 'weather', second: 'music' } }); window.__hotkey(false)"); await sleep(500);
})(module.exports);

// ---- The Previous button works (review finding: a cover-image variable had taken its name)
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep } = ctx;
  await ev("window.__hotkey(true)"); await sleep(500);
  await ev("document.querySelector('.nav [data-go=music]').click()"); await sleep(700);
  await ev("window.__mediaCmds = []; document.querySelector('#m-prev').click(); document.querySelector('#m-next').click(); document.querySelector('#m-play').click()"); await sleep(100);
  await check('previous, next and play each send their command', "window.__mediaCmds.join() === 'prev,next,toggle'");
  await ev("window.__hotkey(false)"); await sleep(400);
})(module.exports);

// ---- 3.0 features: LocalSend, shelf, drop, chips, note, network, mixer
module.exports = ((prev) => async (ctx) => {
  await prev(ctx);
  const { ev, check, sleep, shot } = ctx;
  const drag = (type, target, name) => `(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], '${name || 'a.txt'}')); const t = ${target}; t.dispatchEvent(new DragEvent('${type}', { bubbles: true, cancelable: true, dataTransfer: dt })); })()`;
  const go = async (page) => { await ev(`window.DyHost.go('${page}')`); await sleep(500); };
  await ev("window.__settings({ localsend: { enabled: true, receive: true }, hiddenTabs: [], captures: { enabled: true }, downloads: { enabled: true }, network: { enabled: true }, mixer: { enabled: true }, notes: { enabled: true }, focus: { sync: true } })"); await sleep(400);
  await ev("window.__hotkey(false)"); await sleep(300);
  await ev("window.__hotkey(true)"); await sleep(600);
  await check('one Share tab replaces the Send and Shelf tabs', "!!document.querySelector('.nav [data-go=localsend]') && !document.querySelector('.nav [data-go=shelf]') && document.querySelector('.nav [data-go=localsend]').textContent.trim() === 'Share'");
  await check('the new tray tiles show when their features are on', "['note', 'net', 'mixer'].every((k) => !document.querySelector('.qtile[data-q=' + k + ']').hidden)");

  // LocalSend: devices, a drop on a chip, progress, cancel, the incoming card
  await go('localsend');
  await ev("window.__lsDevices([{ id: 'd1', alias: 'Pixel 8', deviceType: 'mobile' }, { id: 'd2', alias: 'Studio PC', deviceType: 'desktop' }])"); await sleep(200);
  await check('nearby devices show as tiles (no Park on shelf chip)', "document.querySelectorAll('#ls-devs .ls-dev').length === 2 && !document.querySelector('#ls-devs [data-id=__shelf]') && document.querySelector('#ls-devs .ls-dev').textContent.includes('Pixel 8')");
  await ev(drag('dragenter', "document.body")); await sleep(300);
  await check('a file drag opens the drop UI', "document.querySelector('#wrap').dataset.drop === '1'");
  await ev(drag('drop', "document.querySelector('#ls-devs .ls-dev[data-id=d2]')")); await sleep(400);
  await check('dropping on a chip sends to that device', "window.__lsSent && window.__lsSent.length === 1 && window.__lsSent[0][0] === 'd2' && window.__lsSent[0][1].length === 1");
  await check('the transfer card starts in the waiting state', "document.querySelector('#ls-xfers .ls-x').dataset.state === 'waiting'");
  await ev("window.__lsProgress({ sessionId: 's1', deviceId: 'd2', state: 'sending', sentBytes: 50, totalBytes: 100 })"); await sleep(300);
  await check('progress updates the card', "document.querySelector('#ls-xfers .ls-x').dataset.state === 'sending' && document.querySelector('#ls-xfers .ls-x-s').textContent.includes('50%')");
  await shot('localsend-sending');
  // a real transfer sends progress 30-60 times a second: the card, its bar and the canvas must be the same nodes throughout, never re-created or restarted
  await ev("(() => { const r = document.querySelector('#ls-xfers .ls-x'); window.__x0 = { row: r, cv: r.querySelector('canvas'), w: r.querySelector('canvas').getBoundingClientRect().width, rw: r.getBoundingClientRect().width, bad: 0, anim: 0, n: 0 }; let sent = 50; window.__xt = setInterval(() => { sent = Math.min(99, sent + 0.5); window.__lsProgress({ sessionId: 's1', deviceId: 'd2', state: 'sending', sentBytes: sent, totalBytes: 100 }); const rr = document.querySelector('#ls-xfers .ls-x'), cv = rr && rr.querySelector('canvas'); const x = window.__x0; x.n++; x.ws = x.ws || {}; x.ws[Math.round(cv.getBoundingClientRect().width)] = (x.ws[Math.round(cv.getBoundingClientRect().width)] || 0) + 1; x.same = (rr === x.row && cv === x.cv); if (rr !== x.row || cv !== x.cv || Math.abs(cv.getBoundingClientRect().width - x.w) > 6) x.bad++; if (rr && rr.getAnimations().length) x.anim++; }, 16); })()"); await sleep(1200);
  await ev("clearInterval(window.__xt)");
  await check('60 Hz progress keeps the same card and canvas nodes', "window.__x0.n > 40 && window.__x0.bad === 0");
  await check('60 Hz progress never restarts the card animation', "window.__x0.anim === 0 && getComputedStyle(document.querySelector('#ls-xfers .ls-x')).opacity === '1'");
  await check('the progress bar fills the card width and stays visible', "window.__x0.w > 0.8 * window.__x0.rw && window.__x0.w > 200 && document.querySelector('#ls-xfers canvas').getBoundingClientRect().height >= 10");
  await check('the bar has painted pixels (not blank)', "(() => { const c = document.querySelector('#ls-xfers canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return true; return false; })()");
  await ev("document.querySelector('#ls-xfers .ls-x-btn').click()"); await sleep(200);
  await check('cancel tells main', "(window.__lsCancelled || []).includes('s1')");
  await ev("window.__lsProgress({ sessionId: 's2', deviceId: 'd1', state: 'declined', sentBytes: 0, totalBytes: 100 })"); await sleep(200);
  await check('a declined transfer says so', "[...document.querySelectorAll('#ls-xfers .ls-x')].some((r) => r.dataset.state === 'declined')");
  await ev("window.__lsDevices([{ id: 'd1', alias: 'Pixel 8', deviceType: 'mobile' }])"); await sleep(150);
  await ev(drag('drop', "document.querySelector('#p-localsend')", 'b.txt')); await sleep(400);
  await check('with exactly one device a drop on the empty area parks it, it does not send', "window.__lsSent.length === 1 && window.__shelfAdded.length === 1");
  await ev("window.__lsDevices([{ id: 'd1', alias: 'Pixel 8', deviceType: 'mobile' }, { id: 'd2', alias: 'Studio PC', deviceType: 'desktop' }])"); await sleep(150);
  await ev(drag('drop', "document.querySelector('#p-localsend')", 'c.txt')); await sleep(300);
  await check('with several devices a drop on the empty area parks it too', "window.__lsSent.length === 1 && window.__shelfAdded.length === 2");
  await ev("window.__lsIncoming({ id: 'in1', alias: 'Mia Laptop', files: [{ name: 'trip.jpg', size: 2400000 }, { name: 'notes.txt', size: 900 }] })"); await sleep(400);
  await check('an incoming transfer shows Accept and Decline', "!document.querySelector('#ls-in').hidden && document.querySelector('#ls-in-t').textContent.includes('Mia Laptop')");
  await shot('localsend-incoming');
  await ev("document.querySelector('#ls-in-yes').click()"); await sleep(200);
  await check('Accept answers main and hides the card', "JSON.stringify(window.__lsAnswered) === '[[\"in1\",true]]' && document.querySelector('#ls-in').hidden");
  await ev("window.__lsIncoming({ id: 'in2', alias: 'Mia Laptop', files: [{ name: 'a.zip', size: 10 }] })"); await sleep(200);
  await ev("document.querySelector('#ls-in-no').click()"); await sleep(200);
  await check('Decline answers main with false', "window.__lsAnswered[1][1] === false");
  await ev("window.__lsIncoming({ id: 'in3', alias: 'Sam', files: [{ name: 'x.bin', size: 5 }] })"); await sleep(150);
  await ev("window.__lsIncoming({ id: 'in3', closed: true })"); await sleep(200);
  await check('a withdrawn request removes the card', "document.querySelector('#ls-in').hidden");

  // Shelf
  await ev("window.__shelf([{ id: 1, name: 'invoice.pdf', path: 'C:/f/invoice.pdf', size: 482113, isDir: false, addedAt: 1, missing: false }, { id: 2, name: 'Assets', path: 'C:/f/Assets', size: 0, isDir: true, addedAt: 2, missing: false }])");
  await go('localsend');
  await check('the shelf lists parked files', "document.querySelectorAll('#sh-list .sh-row').length === 2 && document.querySelector('#sh-count').textContent.startsWith('2')");
  await ev("document.querySelector('#sh-list .sh-row').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))"); await sleep(100);
  await check('dragging a row out calls shelfDragOut', "JSON.stringify(window.__shelfDrag) === '[1]'");
  await ev(drag('drop', "document.querySelector('#sh-zone')", 'd.txt')); await sleep(300);
  await check('dropping on the shelf adds the file', "window.__shelfAdded.length === 3 && document.querySelectorAll('#sh-list .sh-row').length === 3");
  await shot('shelf');
  await ev("document.querySelector('#sh-list .sh-rm').click()"); await sleep(300);
  await check('remove drops one row', "document.querySelectorAll('#sh-list .sh-row').length === 2");
  await ev("document.querySelector('#sh-clear').click()"); await sleep(300);
  await check('Clear empties the shelf', "document.querySelectorAll('#sh-list .sh-row').length === 0 && document.querySelector('#sh-clear').hidden");

  // Share tab: drag highlight and the tile grid for 1, 2, 3 and 7 devices
  const reopen = async () => { await ev("window.DyHost.go('localsend'); window.DyHost.pin(true); window.DyHost.open(); window.DyHost.update()"); await sleep(700); };
  await ev("for (let i = 0; i < 4; i++) document.querySelectorAll('#ls-xfers .ls-x-btn').forEach((b) => b.click())"); await reopen();
    await ev(drag('dragover', "document.querySelector('#ls-devs .ls-dev')")); await sleep(150);
  await check('dragging over a tile highlights only the tile', "document.querySelector('#ls-devs .ls-dev').classList.contains('over') && !document.querySelector('#sh-zone').classList.contains('over')");
  await ev(drag('dragover', "document.querySelector('#ls-title')")); await sleep(150);
  await check('dragging over the empty area highlights the whole park area', "!document.querySelector('#ls-devs .ls-dev.over') && document.querySelector('#sh-zone').classList.contains('over') && document.querySelector('#sh-hint').textContent === 'Release to park'");
  await shot('share-park-hot');
  await ev(drag('drop', "document.querySelector('#ls-title')", 'e.txt')); await sleep(500); await reopen();
  const names = ['Pixel 8', 'Studio PC', 'Lounge TV', 'iPad', 'Work laptop', 'Steam Deck', 'Garage Pi'];
  const devs = (n) => '[' + names.slice(0, n).map((a, i) => "{ id: 'g" + i + "', alias: '" + a + "', deviceModel: 'Model " + i + "', deviceType: '" + ['mobile', 'desktop', 'web', 'mobile', 'desktop', 'headless', 'server'][i] + "' }").join(',') + ']';
  for (const n of [1, 2, 3, 7]) {
    await ev('window.__lsDevices(' + devs(n) + ')'); await reopen();
    await check('Share shows ' + n + ' device tile(s) that fit the area and share the space equally', "(() => { const c = document.querySelector('#ls-devs'), cr = c.getBoundingClientRect(), tiles = [...c.querySelectorAll('.ls-dev')], z = document.querySelector('#sh-zone').getBoundingClientRect(), pg = document.querySelector('#p-localsend').getBoundingClientRect(); if (tiles.length !== " + n + ") return false; const r0 = tiles[0].getBoundingClientRect(); const same = tiles.every((x) => { const r = x.getBoundingClientRect(); return Math.abs(r.width - r0.width) < 1.5 && Math.abs(r.height - r0.height) < 1.5; }); const inside = tiles.every((x) => { const r = x.getBoundingClientRect(); return r.left >= cr.left - 1 && r.right <= cr.right + 1 && r.top >= cr.top - 1 && r.width > 60 && r.height >= 40; }); const noX = c.scrollWidth <= c.clientWidth + 1; const fitsY = " + (n === 7 ? 'true' : 'c.scrollHeight <= c.clientHeight + 1') + "; return same && inside && noX && fitsY && cr.bottom <= z.top + 1 && cr.top >= pg.top - 1 && cr.height > 60; })()");
    await shot('share-' + n + '-devices');
  }
  await check('seven tiles scroll inside their area instead of overflowing the page', "(() => { const c = document.querySelector('#ls-devs'); return getComputedStyle(c).overflowY === 'auto' && c.scrollHeight >= c.clientHeight; })()");
  // devices plus active transfers: everything stays inside the page, nothing is clipped, the bar spans the card
  const fitJs = "(() => { const pg = document.querySelector('#p-localsend').getBoundingClientRect(), inside = (e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.top >= pg.top - 1 && r.bottom <= pg.bottom + 1 && r.left >= pg.left - 1 && r.right <= pg.right + 1); }; const parts = ['#ls-devs', '#ls-xfers', '#sh-zone']; const ok = parts.every((s) => [...document.querySelectorAll(s)].every(inside)) && document.querySelectorAll('#ls-xfers .ls-x').length === NX; const clip = [...document.querySelectorAll('#p-localsend .ls-dev-a, #p-localsend .ls-x-t, #p-localsend .ls-x-s, #p-localsend .sh-hint')].filter((e) => e.getBoundingClientRect().width && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)).length; const nav = document.querySelector('.nav').getBoundingClientRect(); const zone = document.querySelector('#sh-zone').getBoundingClientRect(); const bars = [...document.querySelectorAll('#ls-xfers .ls-x')].every((x) => { const cv = x.querySelector('canvas').getBoundingClientRect(), r = x.getBoundingClientRect(); return cv.width > r.width * 0.8; }); return ok && clip === 0 && bars && zone.bottom <= nav.top + 1; })()";
  for (const nd of [1, 3]) for (const nx of [1, 3]) {
    await ev('window.__lsDevices(' + devs(nd) + ')');
    for (let i = 0; i < nx; i++) await ev("window.__lsProgress({ sessionId: 'fit" + i + "', deviceId: 'g0', state: 'sending', sentBytes: " + (30 + i * 20) + ", totalBytes: 100 })");
    await reopen(); await sleep(300);
    await check('Share with ' + nd + ' device(s) and ' + nx + ' transfer(s) fits the page with nothing clipped', fitJs.replace('NX', String(nx)));
    await shot('share-' + nd + 'dev-' + nx + 'xfer');
    await ev("for (let i = 0; i < 5; i++) document.querySelectorAll('#ls-xfers .ls-x-btn').forEach((b) => b.click())"); await sleep(200);
  }
  await ev("window.__lsDevices([])"); await reopen();
  await check('with nothing parked the icon and label sit in the middle of the park zone', "(() => { const z = document.querySelector('#sh-zone'); if (z.dataset.n !== '0') return true; const zr = z.getBoundingClientRect(), a = z.querySelector('.sh-bar svg').getBoundingClientRect(), b = document.querySelector('#sh-hint').getBoundingClientRect(); const cx = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2, cy = (Math.min(a.top, b.top) + Math.max(a.bottom, b.bottom)) / 2; return Math.abs(cx - (zr.left + zr.width / 2)) < 6 && Math.abs(cy - (zr.top + zr.height / 2)) < 6; })()");
  await check('with no devices the park area fills the tab', "(() => { const z = document.querySelector('#sh-zone').getBoundingClientRect(), pg = document.querySelector('#p-localsend').getBoundingClientRect(); return z.height > 60 && z.bottom <= pg.bottom + 1; })()");
  await shot('share-no-devices');
  await ev("window.__settings({ shelf: { enabled: false } })"); await sleep(400);
  await ev("window.__lsDevices(" + devs(2) + ")"); await reopen();
  await check('with the shelf off only the tiles show, and a drop on the empty area does nothing', "getComputedStyle(document.querySelector('#sh-zone')).display === 'none'");
  const parked = await ev('(window.__shelfAdded || []).length');
  await ev(drag('drop', "document.querySelector('#ls-title')", 'f.txt')); await sleep(500); await reopen();
  await check('nothing is parked while the shelf is off', '(window.__shelfAdded || []).length === ' + parked);
  await ev("window.__settings({ shelf: { enabled: true } })"); await sleep(300);
  await ev("window.__settings({ localsend: { enabled: false } })"); await reopen();
  await check('with LocalSend off the Share tab turns into the shelf alone', "getComputedStyle(document.querySelector('#ls-devs')).display === 'none' && document.querySelector('#ls-title').textContent === 'Shelf' && document.querySelector('#sh-zone').getBoundingClientRect().height > 60");
  await shot('share-shelf-only');
  await ev("window.__settings({ localsend: { enabled: true } })"); await sleep(300);

  // Network and mixer pages
  await ev("window.__network({ online: true, ip: '10.0.0.7', vpn: true, vpnName: 'WireGuard', pingMs: 31, host: '1.1.1.1' })");
  await go('network');
  await check('the network page shows IP, ping and VPN', "document.querySelector('#nw-ip').textContent === '10.0.0.7' && document.querySelector('#nw-ping').textContent === '31 ms' && document.querySelector('#nw-vpn').textContent === 'WireGuard'");
  await shot('network');
  await ev("window.__mixer([{ pid: 1, name: 'Spotify', volume: 60, mute: false }, { pid: 2, name: 'Chrome', volume: 100, mute: true }])");
  await go('mixer');
  await check('the mixer lists apps with a slider each', "document.querySelectorAll('#mx-list .mx-row').length === 2 && document.querySelector('#mx-empty').hidden");
  await ev("(() => { const r = document.querySelector('#mx-list .mx-range'); r.value = '30'; r.dispatchEvent(new Event('input', { bubbles: true })); })()"); await sleep(250);
  await check('moving a slider sets that app volume', "window.__mixerSet.some((c) => c[0] === 1 && c[1] === 30)");
  await ev("document.querySelectorAll('#mx-list .mx-mute')[0].click()"); await sleep(150);
  await check('the mute button mutes it', "window.__mixerSet.some((c) => c[0] === 1 && c[2] === true)");
  await shot('mixer');

  // Chips: capture, download, link, note, focus (the island is closed so they float under it)
  await ev("window.__hotkey(false)"); await sleep(500);
  await ev("window.__captureNew({ id: 'c1', kind: 'image', name: 'shot.png', path: 'C:/s/shot.png', size: 204800, at: 1 })"); await sleep(500);
  await check('a new screenshot shows a chip that can be dragged out', "document.querySelector('#fchip').classList.contains('on') && document.querySelector('#fchip').dataset.kind === 'capture' && document.querySelector('#fchip').draggable");
  await ev("document.querySelector('#fchip').dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true }))"); await sleep(100);
  await check('dragging the capture chip calls captureDragOut', "window.__capDrag === 'c1'");
  await shot('capture-chip');
  await ev("document.querySelector('#fchip .fc-btn:last-child').click()"); await sleep(500);
  await check('Dismiss closes the chip and tells main', "window.__capDismiss === 'c1' && !document.querySelector('#fchip').classList.contains('on')");
  await ev("window.__downloads([{ id: 'x', name: 'setup.exe', bytes: 5242880, state: 'downloading', app: 'Chrome' }])"); await sleep(400);
  await check('a running download shows a progress chip', "document.querySelector('#fchip').dataset.kind === 'download' && document.querySelector('#fchip').classList.contains('on') && !document.querySelector('.fc-bar').hidden");
  await shot('download-chip');
  await ev("window.__downloads([])"); await sleep(500);
  await check('the download chip goes away when nothing runs', "!document.querySelector('#fchip').classList.contains('on')");
  await ev("window.__clip([{ id: 90, kind: 'text', text: 'hello', pinned: false }])"); await sleep(100);
  await ev("window.__clip([{ id: 91, kind: 'text', text: 'https://example.com/page?utm_source=x&id=4', pinned: false }, { id: 90, kind: 'text', text: 'hello', pinned: false }])"); await sleep(500);
  await check('a copied link shows Open and Clean', "document.querySelector('#fchip').dataset.kind === 'url' && [...document.querySelectorAll('#fchip .fc-btn')].map((b) => b.textContent).join() === 'Open,Clean'");
  await shot('url-chip');
  await ev("document.querySelector('#fchip .fc-btn').click()"); await sleep(200);
  await check('Open sends the link to main', "window.__urlOpened && window.__urlOpened[0].startsWith('https://example.com/page')");
  await ev("window.__noteOpen()"); await sleep(500);
  await check('the quick-note box opens and takes focus', "!document.querySelector('#qnote').hidden && document.querySelector('#qnote').classList.contains('on') && document.activeElement.id === 'qnote-in'");
  await shot('note');
  await check('the quick-note box sits inside the window', "(() => { const r = document.querySelector('#qnote').getBoundingClientRect(); return r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && r.height > 30; })()");
  await ev("document.querySelector('#qnote-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))"); await sleep(500);
  await ev("(() => { const w = document.querySelector('#wrap'); w.classList.add('open'); w.style.setProperty('--oh', '340px'); w.style.setProperty('--ow', '640px'); })()"); await sleep(700);
  await ev("window.__noteOpen()"); await sleep(600);
  await check('the quick-note box stays inside the window with the biggest open island', "(() => { const r = document.querySelector('#qnote').getBoundingClientRect(), n = document.querySelector('#qnote-in').getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0 && r.left >= 0 && r.right <= innerWidth && n.bottom <= innerHeight && n.height >= 30; })()");
  await shot('note-open');
  await ev("document.querySelector('#qnote-in').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); const w = document.querySelector('#wrap'); w.classList.remove('open'); w.style.removeProperty('--oh'); w.style.removeProperty('--ow');"); await sleep(500);
  await ev("window.__noteOpen()"); await sleep(500);
  await ev("(() => { const i = document.querySelector('#qnote-in'); i.value = 'buy milk'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); })()"); await sleep(600);
  await check('Enter saves the note and shows feedback', "window.__notes[0] === 'buy milk' && document.querySelector('#fchip').dataset.kind === 'note' && document.querySelector('#fc-title').textContent === 'Note saved' && !document.querySelector('#qnote').classList.contains('on')");
  await ev("window.__focus({ system: false })"); await ev("window.__focus({ system: true })"); await sleep(500);
  await check('turning Windows focus on shows a chip', "document.querySelector('#fchip').dataset.kind === 'focus' && document.querySelector('#fc-title').textContent === 'Focus mode on'");
  await shot('focus-chip');
  await sleep(4000);

  // A file drag turns the island into the drop zone and puts it back afterwards
  await ev("window.__drop(true)"); await ev(drag('dragenter', "document.body")); await sleep(500);
  await check('the island opens on a file drag', "document.querySelector('#wrap').classList.contains('open') && document.querySelector('#wrap').dataset.page === 'localsend'");
  await ev("window.__drop(false)"); await sleep(900);
  await check('and settles when the drag ends', "!document.querySelector('#wrap').dataset.drop");
  await ev("window.__hotkey(false)"); await sleep(400);
  await ev("window.__settings({ localsend: { enabled: false, receive: false }, shelf: { enabled: false }, captures: { enabled: false }, downloads: { enabled: false }, network: { enabled: false }, mixer: { enabled: false }, notes: { enabled: false }, focus: { sync: false } })"); await sleep(300);
  await check('switching LocalSend and the shelf off hides the Share tab again', "!document.querySelector('.nav [data-go=localsend]')");
})(module.exports);
