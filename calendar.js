// Month calendar for the Home page. The date maths is pure (and tested); mount() draws it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DyCalendar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  // ISO weekday of a date: 1 = Monday ... 7 = Sunday
  const isoWeekday = (d) => ((d.getDay() + 6) % 7) + 1;

  // First day of the week as an ISO weekday (1..7). 'auto' asks the locale (the US starts on Sunday, most of Europe on Monday).
  function resolveFirstDay(setting, locale) {
    if (setting === 'mon') return 1;
    if (setting === 'sun') return 7;
    if (setting === 'sat') return 6;
    try {
      const l = new Intl.Locale(locale || (typeof navigator !== 'undefined' ? navigator.language : 'en-US'));
      const info = typeof l.getWeekInfo === 'function' ? l.getWeekInfo() : l.weekInfo;
      if (info && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay;
    } catch { /* fall through */ }
    return 1;
  }

  // Always 6 rows x 7 columns, so the card never changes height from month to month.
  // Built with new Date(y, m, d + i) so a daylight-saving change cannot skip or repeat a day.
  function monthGrid(year, month, firstDay) {
    const first = new Date(year, month, 1);
    const offset = (isoWeekday(first) - firstDay + 7) % 7;
    const weeks = [];
    for (let w = 0; w < 6; w++) {
      const row = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(year, month, 1 - offset + w * 7 + i);
        row.push({ iso: iso(d), day: d.getDate(), inMonth: d.getMonth() === month, weekday: isoWeekday(d) });
      }
      weeks.push(row);
    }
    return weeks;
  }

  function weekdayLabels(firstDay, locale) {
    const out = [];
    const base = new Date(2024, 0, 1);                       // a Monday
    for (let i = 0; i < 7; i++) {
      const d = new Date(2024, 0, 1 + ((firstDay - 1 + i) % 7));
      out.push(d.toLocaleDateString(locale || undefined, { weekday: 'narrow' }));
    }
    return out;
  }

  // ---- DOM ----
  function mount(el, { getWeekStart, getEvents }) {
    const view = { y: new Date().getFullYear(), m: new Date().getMonth() };
    el.innerHTML = `
      <div class="cal-head">
        <span class="cal-title" aria-live="polite"></span>
        <span class="cal-nav">
          <button class="cal-btn sl" data-act="prev" aria-label="Previous month"><svg class="i" width="16" height="16" viewBox="0 0 24 24"><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg></button>
          <button class="cal-btn sl" data-act="today" aria-label="Back to today"><svg class="i" width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/></svg></button>
          <button class="cal-btn sl" data-act="next" aria-label="Next month"><svg class="i" width="16" height="16" viewBox="0 0 24 24"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg></button>
        </span>
      </div>
      <div class="cal-dow"></div>
      <div class="cal-grid"></div>`;
    const title = el.querySelector('.cal-title'), dow = el.querySelector('.cal-dow'), grid = el.querySelector('.cal-grid');

    function render() {
      const fd = resolveFirstDay(getWeekStart());
      const today = iso(new Date());
      title.textContent = new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: 'long', year: new Date().getFullYear() === view.y ? undefined : 'numeric' });
      dow.replaceChildren(...weekdayLabels(fd).map((l) => { const s = document.createElement('span'); s.textContent = l; return s; }));
      const cells = [];
      for (const week of monthGrid(view.y, view.m, fd)) for (const c of week) {
        const s = document.createElement('span');
        s.className = 'cal-day' + (c.inMonth ? '' : ' out') + (c.iso === today ? ' today' : '') + (c.weekday >= 6 ? ' weekend' : '');
        s.textContent = String(c.day); s.style.setProperty('--n', String(cells.length));
        if (c.iso === today) s.setAttribute('aria-current', 'date');
        const evs = getEvents ? getEvents(c.iso) : null;                      // the titles of what is on that day (for the dot and its tooltip)
        if (evs && evs.length) { s.classList.add('has-ev'); s.dataset.tip = evs.slice(0, 6).join('\n') + (evs.length > 6 ? '\n+' + (evs.length - 6) + ' more' : ''); s.dataset.iso = c.iso; }
        cells.push(s);
      }
      grid.replaceChildren(...cells);
    }
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'prev') { view.m--; if (view.m < 0) { view.m = 11; view.y--; } }
      else if (b.dataset.act === 'next') { view.m++; if (view.m > 11) { view.m = 0; view.y++; } }
      else { view.y = new Date().getFullYear(); view.m = new Date().getMonth(); }
      grid.classList.remove('flip-fwd', 'flip-back'); void grid.offsetWidth;
      if (b.dataset.act !== 'today') grid.classList.add(b.dataset.act === 'prev' ? 'flip-back' : 'flip-fwd');   // the month slides the way you went
      render();
    });
    render();
    return { render, resetToToday() { view.y = new Date().getFullYear(); view.m = new Date().getMonth(); render(); } };
  }

  return { monthGrid, resolveFirstDay, weekdayLabels, isoWeekday, mount };
});
