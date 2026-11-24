// One place that decides whether the island is visible. Pure, loaded by both the renderer and the tests.
//   fullscreen wins over everything: a game must never get an overlay, not even from a toast or the hotkey.
//   auto-hide only hides the island itself; anything that needs your attention (a toast, a finished timer, an open
//   settings window, the pointer on it) reveals it.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DyVisibility = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function computeVisibility(s) {
    if (s.paused) return { window: false, island: false, reason: 'paused' };          // "Pause the island": gone until it is resumed
    const hideForFullscreen = !!(s.hideInFullscreen && s.fullscreen);
    if (hideForFullscreen) return { window: false, island: false, reason: 'fullscreen' };
    if (!s.autoHide) return { window: true, island: true, reason: 'always' };
    const reveal = !!(s.near || s.hovering || s.open || s.settingsOpen || s.toast || s.alert || s.hotkeyReveal);
    return { window: true, island: reveal, reason: reveal ? 'revealed' : 'auto-hidden' };
  }
  return { computeVisibility };
});
