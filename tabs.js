// The island's tabs: which exist, their labels and icons, and building the button row from the saved order.
(function () {
  const TABS = {
    home:      { label: 'Home',      icon: '#i-home' },
    music:     { label: 'Music',     icon: '#i-music' },
    weather:   { label: 'Weather',   icon: '#i-cloud' },
    timer:     { label: 'Timer',     icon: '#i-timer' },
    usage:     { label: 'Usage',     icon: '#i-chart' },
    clipboard: { label: 'Clipboard', icon: '#i-clip' },
    agents:    { label: 'Claude',    icon: '#i-agents' },
  };

  // Rebuilds the nav: the visible tabs in the saved order. (The settings button is separate: it sits outside the island.)
  function buildNav(nav, order, hidden, active) {
    const visible = order.filter((id) => TABS[id] && !hidden.includes(id));
    nav.querySelectorAll('[data-tab-btn]').forEach((b) => b.remove());
    for (const id of visible) {
      const t = TABS[id];
      const b = document.createElement('button');
      b.className = 'sl';
      b.dataset.tabBtn = '1'; b.dataset.go = id;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-label', t.label);
      b.setAttribute('aria-selected', String(id === active));
      b.innerHTML = `<svg class="i" width="20" height="20"><use href="${t.icon}"/></svg><span class="lbl">${t.label}</span>`;
      nav.appendChild(b);
    }
    return visible;
  }

  window.DyTabs = { TABS, buildNav };
})();
