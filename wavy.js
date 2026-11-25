// Material 3 Expressive wavy progress, drawn on a canvas (a CSS mask tile left seams and notches where the tiles met). Two shapes:
//   line(ctx, w, h, o)  a wavy bar: the finished part waves, a gap, then a plain track with a dot at the end
//   ring(ctx, size, o)  the same bent into a circle (the timer)
// o: { frac 0..1, amp (px), phase (radians), color, track, thickness }. Pure drawing: no DOM, so it is easy to reason about and test.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DyWavy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

  function line(ctx, w, h, o) {
    const th = o.thickness || 4, r = th / 2, cy = h / 2, amp = Math.max(0, Math.min(o.amp || 0, h / 2 - r - 0.5)), lambda = o.wavelength || 18;
    const frac = clamp01(o.frac), gap = th * 1.5, span = w - th;
    const x1 = r + span * frac;                                    // where the finished part ends
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = th;
    if (frac > 0.004) {
      ctx.strokeStyle = o.color; ctx.beginPath();
      const end = Math.max(r, x1 - (frac < 0.995 ? gap / 2 : 0));
      for (let x = r; x <= end + 0.01; x += 1) {
        const ramp = Math.min(1, (x - r) / 10, (end - x) / 10 + 0.0001);    // the wave eases in and out at its ends: no hook at the cap
        const y = cy + Math.sin(((x - r) / lambda) * Math.PI * 2 - (o.phase || 0)) * amp * Math.max(0, ramp < 0 ? 0 : ramp);
        x === r ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      if (end <= r) ctx.lineTo(r + 0.01, cy);
      ctx.stroke();
    }
    if (frac < 0.995) {
      const start = Math.max(r, x1 + (frac > 0.004 ? gap / 2 : 0));
      if (start < w - r - 4) { ctx.strokeStyle = o.track; ctx.beginPath(); ctx.moveTo(start, cy); ctx.lineTo(w - r - 4, cy); ctx.stroke(); }
      ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(w - r, cy, 2, 0, Math.PI * 2); ctx.fill();     // the dot at the end of the track
    }
  }

  function ring(ctx, size, o) {
    const th = o.thickness || 8, c = size / 2, base = c - th / 2 - Math.max(2, o.amp || 0) - 1, waves = o.waves || 12;
    const frac = clamp01(o.frac), amp = Math.max(0, o.amp || 0), gapA = Math.min(0.5, (th * 1.5) / base);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = th;
    const a0 = -Math.PI / 2, sweep = Math.PI * 2 * frac;
    if (frac > 0.004) {
      ctx.strokeStyle = o.color; ctx.beginPath();
      const end = frac >= 0.995 ? sweep : Math.max(0.001, sweep - gapA / 2);
      const steps = Math.max(8, Math.ceil(end / 0.02));
      for (let i = 0; i <= steps; i++) {
        const t = (end * i) / steps, ramp = frac >= 0.995 ? 1 : Math.min(1, t / 0.18, (end - t) / 0.18 + 0.0001);
        const rr = base + Math.sin(waves * t - (o.phase || 0)) * amp * Math.max(0, ramp);
        const x = c + Math.cos(a0 + t) * rr, y = c + Math.sin(a0 + t) * rr;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    if (frac < 0.995) {
      ctx.strokeStyle = o.track; ctx.beginPath();
      ctx.arc(c, c, base, a0 + sweep + (frac > 0.004 ? gapA / 2 : 0), a0 + Math.PI * 2 - (frac > 0.004 ? gapA / 2 : 0));
      ctx.stroke();
    }
  }
  return { line, ring };
});
