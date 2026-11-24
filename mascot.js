// The mascot: two cylinder (capsule) eyes that live in the pill while the island is idle.
// They wander, follow the pointer, blink (sometimes twice), get sleepy after a long idle, and react to news.
// Driven by timers and CSS transitions only (no frame loop), and fully static under prefers-reduced-motion.
(function () {
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // static eyes: the system asks for less motion, or Settings > Animations is Off
  const still = { get matches() { return reduced.matches || document.documentElement.dataset.motion === 'off'; } };

  function create(el) {
    let running = false, timers = new Set(), gazeUntil = 0, sleepyTimer = 0, night = false;
    const set = (x, y) => { el.style.setProperty('--gx', x.toFixed(1) + 'px'); el.style.setProperty('--gy', y.toFixed(1) + 'px'); };
    const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };      // finished timers leave the set: it cannot grow all night
    const flag = (name, ms) => { el.classList.add(name); later(() => el.classList.remove(name), ms); };

    function blink() {
      if (!running) return;
      flag('blink', 150);
      if (Math.random() < 0.2) later(() => flag('blink', 150), 260);          // the occasional double blink
      later(blink, rand(2200, 5500));
    }
    function wander() {
      if (!running) return;
      if (Date.now() > gazeUntil) {                                           // the pointer has priority over idle wandering
        const spots = [[0, 0], [-6, 0], [6, 0], [-5, -2], [5, -2], [0, 2], [0, 0]];
        const [x, y] = spots[Math.floor(Math.random() * spots.length)];
        set(x, y);
      }
      later(wander, rand(1200, 3400));
    }

    return {
      start() {
        if (running) return; running = true; el.classList.remove('sleepy'); set(0, 0);
        if (still.matches) return;                                            // static eyes
        later(blink, rand(900, 2200)); later(wander, rand(600, 1600));
        sleepyTimer = setTimeout(() => el.classList.add('sleepy'), night ? 6000 : 60000);    // drowsy after a minute of nothing
      },
      stop() { running = false; timers.forEach(clearTimeout); timers = new Set(); clearTimeout(sleepyTimer); el.classList.remove('sleepy', 'blink', 'happy', 'surprise', 'pet'); },
      // nx, ny in -1..1 (pointer direction from the island): eyes slide toward it
      lookAt(nx, ny) {
        if (!running || still.matches) return;
        gazeUntil = Date.now() + 2500;
        set(Math.max(-1, Math.min(1, nx)) * 7, Math.max(-1, Math.min(1, ny)) * 3);
        if (el.classList.contains('sleepy')) this.react('surprise');
      },
      isStill() { return still.matches; },
      // Late at night the eyes get drowsy after a few seconds instead of a minute
      setNight(v) { night = !!v; },
      // Click on the eyes: a happy squish
      pet() {
        if (!running || still.matches) return;
        this.react('happy'); flag('pet', 480);
      },
      react(kind) {                                                         // 'happy' | 'surprise'
        if (!running || still.matches) return;
        el.classList.remove('sleepy');
        clearTimeout(sleepyTimer); sleepyTimer = setTimeout(() => el.classList.add('sleepy'), night ? 6000 : 60000);
        flag(kind, kind === 'happy' ? 1800 : 700);
      },
    };
  }

  window.DyMascot = { create };
})();
