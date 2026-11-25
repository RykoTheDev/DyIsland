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
  await check('the DNS provider tile shows Automatic', "!document.querySelector('[data-q=dnsp]').hidden && document.querySelector('[data-q=dnsp] .ql').textContent === 'DNS: Auto'");
  await shot('quick-actions');
  await ev("document.querySelector('[data-q=dnsp]').click()"); await sleep(400);
  await check('one click goes to the first provider', "document.querySelector('[data-q=dnsp] .ql').textContent === 'Cloudflare'");
  await ev("document.querySelector('[data-q=dnsp]').click()"); await sleep(300);
  await ev("document.querySelector('[data-q=dnsp]').click()"); await sleep(300);
  await ev("document.querySelector('[data-q=dnsp]').click()"); await sleep(300);
  await check('and round to Automatic again', "document.querySelector('[data-q=dnsp] .ql').textContent === 'DNS: Auto'");
  await ev("document.querySelector('#tray-btn').click()"); await sleep(500);
  await check('pressing the button again closes them', "!document.querySelector('#qtray').classList.contains('show')");
  await ev("window.__hotkey(false)"); await sleep(500);
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
  await check('the Gmail card shows the unread count and the latest sender', "document.querySelector('#h-mail-t').textContent === '7 unread' && document.querySelector('#h-mail-l').textContent === 'Sam Lee: Lunch on Friday?'");
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
