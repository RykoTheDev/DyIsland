// The mascot: two cylinder (capsule) eyes that live in the pill while the island is idle.
// They wander, follow the pointer, blink (sometimes twice), get sleepy after a long idle, and react to news.
// Driven by timers and CSS transitions only (no frame loop), and fully static under prefers-reduced-motion.
(function () {
  const rand = (a, b) => a + Math.random() * (b - a);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  // static eyes: the system asks for less motion, or Settings > Animations is Off
  const still = { get matches() { return reduced.matches || document.documentElement.dataset.motion === 'off'; } };

  function create(el) {
    const KINDS = ['wink', 'yawn', 'bounce', 'curious', 'love', 'sad', 'dizzy', 'wow'];
    const DUR = { happy: 1800, surprise: 700, wow: 900, wink: 420, yawn: 1100, bounce: 600, curious: 1400, love: 2000, sad: 2200, dizzy: 1600 };
    let pets = 0, petAt = 0;
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
    // Little bits of life every so often: a wink, a look around, a yawn, a hop
    function fun() {
      if (!running) return;
      const ready = !el.classList.contains('sleepy');
      if (ready && Date.now() > gazeUntil) {
        const k = ['wink', 'around', 'yawn', 'bounce', 'around'][Math.floor(Math.random() * 5)];
        if (k === 'around') { [[-7, 0], [7, 0], [0, -3], [0, 0]].forEach(([x, y], i) => later(() => { if (Date.now() > gazeUntil) set(x, y); }, i * 420)); }
        else flag(k, k === 'yawn' ? 1100 : k === 'wink' ? 420 : 600);
      }
      later(fun, rand(5000, 11000));
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
        later(blink, rand(900, 2200)); later(wander, rand(600, 1600)); later(fun, rand(3500, 7000));
        sleepyTimer = setTimeout(() => el.classList.add('sleepy'), night ? 6000 : 60000);    // drowsy after a minute of nothing
      },
      stop() { running = false; timers.forEach(clearTimeout); timers = new Set(); clearTimeout(sleepyTimer); el.classList.remove('sleepy', 'blink', 'happy', 'surprise', 'pet', ...KINDS); pets = 0; },
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
        pets = Date.now() - petAt < 900 ? pets + 1 : 1; petAt = Date.now();     // pet it again and again and it gets dizzy
        if (pets >= 5) { pets = 0; this.react('dizzy'); return; }
        this.react(pets === 3 ? 'love' : 'happy'); flag('pet', 480);
      },
      // 'happy' | 'surprise' | 'wow' | 'curious' | 'love' | 'sad' | 'dizzy' | 'wink' | 'bounce' | 'yawn'
      react(kind) {
        if (!running || still.matches) return;
        el.classList.remove('sleepy');
        clearTimeout(sleepyTimer); sleepyTimer = setTimeout(() => el.classList.add('sleepy'), night ? 6000 : 60000);
        for (const k of KINDS) if (k !== kind) el.classList.remove(k);
        flag(kind, DUR[kind] || 800);
      },
    };
  }

  window.DyMascot = { create };
})();
