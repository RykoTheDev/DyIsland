# DyIsland design reference: going wild with Material 3 Expressive

Researched 2026-11-25. "Verified" = I read it at the source linked. "Unverified" = from memory or my own reasoning, test before trusting.
Not done: m3.material.io is rendered by JavaScript, so I could not read the official spec pages as text (only confirmed they exist). Official-spec claims below come from the Android `material-components-android` docs, which link to them.

## What we already have (read from the repo, 2026-11-25)
- expressive.css: 12-lobed "cookie" mask on tiles, connected button groups with small inner corners, pill nav with flex-grow on the selected item, wavy progress drawn on canvas (wavy.js), morphing loading indicator.
- tokens.css: Google Sans Flex (fonts/google-sans-flex-latin-full-normal.woff2) with `ROND` 100 on display text and a width axis. View transitions in styles.css (`::view-transition-group(shared)`).
- vendor/dycolor.js (material-color-utilities).
So the gaps are mostly: real spring physics, press-driven width/shape change on neighbours, more shapes in the morph set, shape-per-state everywhere, tonal layering depth, and motion tokens.

## 1. Sources (real, current, read directly)

| # | Name | Link | What makes it wild | Useful for us |
|---|---|---|---|---|
| 1 | m3e (matraic), Material 3 Expressive as web components, MIT, 344 stars, pushed 2026-11-25 | https://github.com/matraic/m3e , demo https://matraic.github.io/m3e | Full expressive set in plain web tech: shape morphing component, loading indicator that cycles 7 polygons, button group, split button, FAB menu, wavy circular and linear progress, motion tokens with springs. Closest thing to our stack. | Almost everything. Its source is the best recipe book: packages/web/src/core/shared/tokens/MotionToken.ts, loading-indicator/LoadingIndicatorElement.ts, core/shared/utils/generateClipPaths.ts |
| 2 | shoji-bar-4, Rust desktop shell, 230 stars | https://github.com/bea4dev/shoji-bar-4 | Floating islands bar, clipboard history, media, OSD, lock screen. README claims: dynamic colour moved on a spring everywhere at once, springs and shape morphs throughout, no frames drawn while nothing moves (0% CPU idle). Not web tech, so only the ideas transfer. | Colour crossfade on a spring, idle = zero redraw |
| 3 | ii-p3drovfx, Hyprland shell on Quickshell, 179 stars | https://github.com/P3DROVFX/ii-p3drovfx | Has an actual Dynamic Island (media, activities, OSD in the notch, hover opens dashboard). README: "shapes that morph with state, variable type that carries the hierarchy", palette from wallpaper via Matugen. Also ships an expressive-shaped icon pack. | Direct sibling of DyIsland: hierarchy by variable type, island content model |
| 4 | Tomato, pomodoro timer, 1555 stars | https://github.com/nsh07/Tomato | Minimalist, built on M3 Expressive, MaterialKolor dynamic colour, Google Sans Flex. Zenith's README credits it as its design inspiration. | Our timers page |
| 5 | Zenith, digital wellbeing app | https://github.com/1372Slash/Zenith | "fluid motion, adaptive typography (GSFlex), floating navigation components", expressive home widgets with streaks and progress. | Floating nav, widget-style tiles |
| 6 | PixelPlayer, music player, 7043 stars | https://github.com/PixelPlayerHQ/PixelPlayer | Dynamic colour extracted from album art, micro-interactions, Glance widgets. README is thin on specifics, I did not read its Compose source. | Our music cover glow and art-driven palette |
| 7 | m3e-canvas, sketchpad of real M3E parts, 10869 stars | https://github.com/lnkiai/m3e-canvas | Lists the full expressive parts set (split buttons, FAB menus, floating toolbars, carousels, loading indicators) with 7 palettes, 3 contrast levels, corner styles. Credits Aler1x/m3-loading-indicator for the loading shapes. | A parts checklist to mirror and a place to prototype layouts |
| 8 | material-components-android docs, official | https://github.com/material-components/material-components-android/tree/master/docs/components | The baseline. ButtonGroup: shape, motion and width change, `childSizeChange` default 15% when pressed, 12dp spacing. SplitButton: menu button "spins and changes shape when activated". ProgressIndicator: wavy variants with `waveLength`, `waveAmplitude`, `trackThickness`. LoadingIndicator: new in expressive, for waits under five seconds, replaces most indeterminate circular indicators. | The official numbers |
| 9 | Material 3 Expressive catalog, Jetpack Compose | https://github.com/meticha/material-3-expressive-catalog (227 stars, Compose) | Component catalog only; I did not read it. Listed, not relied on. | Optional |

Not found / not used: Dribbble and Behance (no real implementation links found, skipped on purpose). I did not find a Reddit showcase I could verify via API, so none are cited.

## 2. Ranked techniques (15). Recipes are plain CSS/JS for the Electron renderer

Platform facts checked: `linear()` easing is Chrome 113+, `corner-shape` is Chrome 139+ (MDN browser-compat-data). Our Electron is 45.4.1 (package.json and node_modules); that is newer than both, but I did not look up its exact Chromium version, so treat it as unverified until you open `process.versions.chrome` once.

### 1. Real spring tokens (do this first, everything else uses them)
m3e ships these values (MotionToken.ts, read at source). Use them as CSS variables:
```css
:root{
  --spring-fast-spatial:    350ms cubic-bezier(0.27,1.06,0.18,1.00);
  --spring-default-spatial: 500ms cubic-bezier(0.27,1.06,0.18,1.00);
  --spring-slow-spatial:    750ms cubic-bezier(0.27,1.06,0.18,1.00);
  --spring-fast-effects:    150ms cubic-bezier(0.31,0.94,0.34,1.00);
  --spring-default-effects: 200ms cubic-bezier(0.34,0.80,0.34,1.00);
  --spring-slow-effects:    300ms cubic-bezier(0.34,0.88,0.34,1.00);
}
```
Rule: spatial springs (size, position, shape) may overshoot (y1 above 1); effects springs (colour, opacity) must not. Overshoot on opacity or colour looks like a glitch. Use on `transform`, `width`, `clip-path`. Whether these numbers equal Google's own spring parameters, I did not verify; they are m3e's approximation.

### 2. Shape morph via clip-path polygon (loading indicator, tiles, play button)
m3e's trick (LoadingIndicatorElement.ts, generateClipPaths.ts): sample every SVG shape path to the same N points, store as `polygon(...)`, and let CSS transition `clip-path` between them, because polygons with equal vertex counts interpolate. Its loader cycles 7 shapes (soft-burst, 9-sided cookie, pentagon, pill, sunny, 4-sided cookie, oval) while rotating, over 4666ms, with `transition: clip-path` on the slow effects spring.
```js
// build once: sample(pathD, 64) -> "x% y%, ..."
const poly = n => `polygon(${n})`;
el.style.setProperty('--shape', poly(SHAPES.cookie9));
```
```css
.shape{ clip-path:var(--shape); transition:clip-path var(--spring-slow-effects); }
```
Use it for: the tile on Home that turns into a different shape on hover/selected, the now-playing art (circle paused, cookie playing), the toast icon. We currently use a static mask; this makes it animate. Keep N identical for all shapes.

### 3. Press squish with neighbour reaction (button groups)
Official: `childSizeChange` 15% when pressed, 12dp spacing (ButtonGroup.md). Recipe:
```css
.group{display:flex;gap:2px}
.group>button{flex:1 1 0;transition:flex-grow var(--spring-fast-spatial),border-radius var(--spring-fast-spatial)}
.group>button:active{flex-grow:1.15;border-radius:12px}
.group>button:has(+button:active),.group>button:active+button{flex-grow:.92}
```
Applies to the music controls, timer controls, chips, nav. Our `.m-ctrl .btn:active` changes only the corner; this adds the neighbour giving way.

### 4. Selected state by shape, not just colour
Pill when idle, rounder or squarer when selected/toggled, with the spring. Already partly in expressive.css (play button squares while playing). Extend to chips, toggles, nav items, all via `border-radius` transition with the spatial spring. If you want squircle-ish corners, `corner-shape: squircle` (Chrome 139+) is a one-line upgrade.

### 5. Split button with spinning menu
Official: the menu half "spins and changes shape when activated" (SplitButton.md). Recipe: two buttons sharing a pill, left corners round/right inner 8px; arrow icon `transform: rotate(180deg)` on `[aria-expanded=true]` plus the right button going from rounded rect to full circle. Candidate: the clipboard "paste" and "send to device" actions.

### 6. Oversized type hierarchy with variable axes
ii-p3drovfx's stated principle: hierarchy carried by variable type. We already set ROND and width. Go further:
```css
.display{font-variation-settings:"wght" 800,"wdth" 125,"ROND" 100,"opsz" 72}
.label{font-variation-settings:"wght" 600,"wdth" 90,"ROND" 40}
.display{transition:font-variation-settings var(--spring-default-effects)}
```
Animate weight on state change (time digits thicken while a timer runs). Axis names for Google Sans Flex (`wght, wdth, ROND, opsz, GRAD, slnt`) are from memory: unverified, check the font's fvar table before shipping. We only bundle the latin subset.

### 7. Tonal surface layering for depth without shadows
Use the surface-container ladder (lowest to highest) as elevation: island body = surface-container, cards = container-high, active card = container-highest, selected = secondary-container. No blur, no gradient (matches the rule already in expressive.css). dycolor.js already yields these tokens.

### 8. Colour moves on a spring too
shoji-bar-4 claims dynamic colour is "moved to on a spring everywhere at once". With `@property` registered colours, transitions cover the whole palette:
```css
@property --md-sys-color-primary{syntax:'<color>';inherits:true;initial-value:#6750a4}
:root{transition:--md-sys-color-primary var(--spring-slow-effects)}  /* repeat for the roles used */
```
Then a new cover art or a theme change crossfades every surface in sync. Cost: registering ~30 properties; do only the roles that change often (primary, container, on-container, surface-container). `@property` support is Chrome 85+ per MDN data.

### 9. Wavy progress everywhere it is a progress
Official: wavy variants with `waveLength`, `waveAmplitude`, `trackThickness` (ProgressIndicator.md). We have it for usage. Reuse the same canvas for timer ring/linear, download/send progress (LocalSend), music seek bar. Rule from the spec: flatten the wave (amplitude 0) while paused, to show state.

### 10. Loading indicator for waits under 5 seconds
Official guidance: use it instead of indeterminate circular indicators, for short waits (LoadingIndicator.md). Use for device discovery, weather fetch, calendar sync. Anything longer than a few seconds should be determinate (technique 9).

### 11. Expand/contract island as one continuous morph
Animate the container, not the content: transition `width`, `height`, `border-radius` on the spatial spring (overshoot 5 to 8 percent), content fades in with the effects spring delayed 60 to 80 ms. For shared elements (cover art, icon) use View Transitions with `view-transition-name`, which styles.css already half does. Never animate `top/left`; use `transform`.

### 12. Floating toolbar for nav and actions
Official has Floating and Docked toolbars (FloatingToolbar.md, default shape 50% rounded). Our nav is already a pill. Add: the toolbar inset from the edge with tonal-highest background, selected item growing via flex-grow (done), and the toolbar collapsing to a single FAB-like circle when the island is small.

### 13. FAB menu for quick actions
m3e has `fab-menu`. Pattern: one primary circle that on click morphs (shape + `scale` stagger 30 ms per item) into a vertical stack of labelled pills. Candidate: "+" on the island home for new timer, send file, paste from history. Stagger with the fast spatial spring.

### 14. Haptic-feeling press (no real haptics on desktop)
Press feedback has to be visual: scale 0.96 on `:active` with fast-effects spring, 8px corner on press, then spring back with slight overshoot. Optional extra: a 1-frame ripple using `radial-gradient` at pointer position. Keep under 150 ms.

### 15. Idle = zero cost
From shoji-bar-4's stated goal (0% CPU idle). Pause the wavy canvas, loader and any rAF loop when the island is collapsed or the window is hidden (`document.visibilitychange`, our own `isOpen()` state). This matters more than any visual for an always-on-top app.

## 3. Do not (always-on-top overlay)
- No `backdrop-filter: blur` or large box-shadows on the main island: constant GPU cost on a window that sits over everything, and it reads muddy over busy backgrounds. Flat tonal colour only.
- No overshoot on opacity, colour, or on anything that carries text size. Only position, size and shape may bounce.
- Do not run infinite animations while collapsed or when nothing is visible (see 15).
- Do not animate `width`/`height` of large subtrees with heavy text reflow; animate the container and fade content. If a morph is janky, switch to `transform: scale` plus counter-scale.
- Do not use `clip-path` morph on elements holding small text: clipped edges cut glyphs mid-animation. Use it on art, icons, tiles.
- Do not mix polygons with different vertex counts (the morph snaps instead of tweens).
- Do not set display type so heavy or wide that tabular digits shift width (clock and timers keep `font-variant-numeric: tabular-nums`; already done in styles.css).
- Do not rely on colour alone for state (toggle, error): keep an icon or shape change too. Contrast of on-container text over album-art-derived palettes must still be checked (dycolor's contrast level), especially in a 30-px-tall compact state.
- Do not make hover-only affordances: the island is click-through until hovered, so anything needed during a drag or on touch must not depend on hover.
- Do not copy m3e or other code verbatim without checking licence: m3e is MIT, material-components-android is Apache-2.0, m3e-canvas credits Apache-2.0 loading shapes; keep attribution in a NOTICE if we port paths.

## 4. Unverified list
- Exact Chromium version inside Electron 45.4.1.
- That m3e's spring beziers match Google's official spring parameters.
- Google Sans Flex axis names and ranges (bundled subset is latin only).
- Anything on m3.material.io itself (page text not readable without JS).
- Visual quality of PixelPlayer and Zenith (only READMEs read, no source or screenshots inspected).
