// Spring physics as a CSS easing. A damped spring from 0 to 1 is sampled into a linear() easing, so a CSS transition really overshoots,
// swings back and settles like a spring instead of following one fixed bezier curve. Pure (no DOM), loaded by the page and the tests.
//   zeta   damping ratio: < 1 overshoots (0.6 = lively, 0.9 = barely), >= 1 never overshoots
//   omega  natural frequency in rad/s: higher = faster (24 settles in about 0.4 s)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DySpring = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const at = (zeta, omega, t) => {                                       // position of the spring at time t (seconds), 0 -> 1
    if (zeta >= 1) return 1 - (1 + omega * t) * Math.exp(-omega * t);
    const wd = omega * Math.sqrt(1 - zeta * zeta), a = zeta * omega;
    return 1 - Math.exp(-a * t) * (Math.cos(wd * t) + (a / wd) * Math.sin(wd * t));
  };
  // The time after which the spring stays within 0.2% of its target
  function settleSeconds(zeta, omega) {
    let last = 0;
    for (let t = 0; t < 3; t += 0.004) if (Math.abs(at(zeta, omega, t) - 1) > 0.002) last = t;
    return Math.min(3, last + 0.004);
  }
  function easing(zeta, omega, stops) {
    const n = Math.max(8, Math.min(80, stops || 40)), T = settleSeconds(zeta, omega), pts = [];
    for (let i = 0; i <= n; i++) {
      const v = i === n ? 1 : i === 0 ? 0 : at(zeta, omega, (T * i) / n);
      pts.push(Math.round(v * 10000) / 10000);
    }
    return { css: 'linear(' + pts.join(', ') + ')', ms: Math.ceil((T * 1000) / 10) * 10, peak: Math.max(...pts) };
  }
  return { at, easing, settleSeconds };
});
