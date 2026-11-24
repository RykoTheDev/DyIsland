// Where the island lives: which edge of the screen (top, left, right) and which monitor(s).
// Pure geometry, no Electron imports, so it can be tested on its own. A "display" is { id, bounds: {x,y,width,height}, workArea?: {...} }.
const WIN_W = 736;        // widest open island (640) + the settings button beside it (8 gap + 40) on one side
const WIN_H = 376;        // top edge: tall enough for the open island plus the quick-actions tray under the settings button
const WIN_H_SIDE = 520;   // left/right edge: the island is centred vertically, so it needs room above and below
const EDGES = ['top', 'left', 'right'];

// Which displays get an island. monitor: 'primary' | 'all' | '<display id>'. Always at least one: an unplugged monitor falls back to primary.
function pickDisplays(all, primaryId, monitor) {
  const list = Array.isArray(all) ? all.filter((d) => d && d.bounds) : [];
  if (!list.length) return [];
  const primary = list.find((d) => d.id === primaryId) || list[0];
  if (monitor === 'all') return [primary, ...list.filter((d) => d !== primary)];          // primary first: it is the "lead" island
  if (monitor && monitor !== 'primary') {
    const hit = list.find((d) => String(d.id) === String(monitor));
    if (hit) return [hit];
  }
  return [primary];
}

// The island window on one display. It is a fixed size; the island morphs inside it.
function windowBounds(b, edge) {
  const w = Math.min(WIN_W, b.width);
  if (edge === 'left' || edge === 'right') {
    const h = Math.min(WIN_H_SIDE, b.height);
    return { x: edge === 'left' ? b.x : b.x + b.width - w, y: Math.round(b.y + (b.height - h) / 2), width: w, height: h };
  }
  return { x: Math.round(b.x + (b.width - w) / 2), y: b.y, width: w, height: Math.min(WIN_H, b.height) };
}

// The settings card: under the island (top edge) or beside it, past the settings button (left/right edge).
// It has a transparent margin around it for the shadow.
function settingsBounds(display, edge, openW, openH, { width = 496, margin = 16, gap = 8, fab = 48 } = {}) {
  const b = display.bounds, wa = display.workArea || b;
  if (edge === 'left' || edge === 'right') {
    const height = Math.max(240, Math.min(680, wa.height - 16));
    const y = Math.round(Math.max(wa.y, Math.min(wa.y + wa.height - height, b.y + (b.height - height) / 2)));
    let x = edge === 'left' ? b.x + openW + fab + gap - margin : b.x + b.width - openW - fab - gap + margin - width;
    x = Math.round(Math.max(b.x, Math.min(b.x + b.width - width, x)));
    return { x, y, width, height };
  }
  let top = b.y + openH + gap - margin;
  const room = wa.y + wa.height - top - 8;
  const height = Math.max(160, Math.min(680, room));
  const bottom = wa.y + wa.height - 8;
  if (top + height > bottom) top = Math.max(wa.y, bottom - height);          // a short screen: slide up (over the island) rather than off the bottom
  return { x: Math.round(b.x + (b.width - width) / 2), y: top, width, height };
}

// The point the island hangs from (for the mascot's gaze): the middle of the docked edge.
function dockPoint(b, edge) {
  if (edge === 'left') return { x: b.x, y: b.y + b.height / 2 };
  if (edge === 'right') return { x: b.x + b.width, y: b.y + b.height / 2 };
  return { x: b.x + b.width / 2, y: b.y };
}

// Auto-hide's hot zone: the pointer touching the docked edge, within `half` px of the island's middle.
function nearDock(p, b, edge, half = 120, thickness = 4) {
  if (edge === 'left') return p.x >= b.x && p.x <= b.x + thickness && Math.abs(p.y - (b.y + b.height / 2)) <= half;
  if (edge === 'right') return p.x <= b.x + b.width && p.x >= b.x + b.width - thickness && Math.abs(p.y - (b.y + b.height / 2)) <= half;
  return p.y >= b.y && p.y <= b.y + thickness && Math.abs(p.x - (b.x + b.width / 2)) <= half;
}

// Is another monitor right behind this island's docked edge? Then the pointer crosses that edge on its way to the other screen,
// and a plain "touch the edge" hot zone would pop the island up on every crossing.
function sharedEdge(display, edge, all) {
  const b = display.bounds, mid = edge === 'top' ? b.x + b.width / 2 : b.y + b.height / 2, eps = 2;
  return (all || []).some((o) => {
    if (!o || o === display || o.id === display.id || !o.bounds) return false;
    const c = o.bounds;
    if (edge === 'top') return Math.abs(c.y + c.height - b.y) <= eps && mid >= c.x && mid <= c.x + c.width;
    if (edge === 'left') return Math.abs(c.x + c.width - b.x) <= eps && mid >= c.y && mid <= c.y + c.height;
    return Math.abs(c.x - (b.x + b.width)) <= eps && mid >= c.y && mid <= c.y + c.height;
  });
}

const insideRect = (p, b) => p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;

// Labels for the Settings picker: "Monitor 1 (main) · 2560x1440", with where it sits relative to the main one.
function monitorLabels(displays, primaryId) {
  const list = (displays || []).filter((d) => d && d.bounds);
  const primary = list.find((d) => d.id === primaryId) || list[0];
  const sorted = [...list].sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
  return sorted.map((d, i) => {
    const isPrimary = d === primary;
    let where = '';
    if (!isPrimary && primary) {
      const dx = d.bounds.x - primary.bounds.x, dy = d.bounds.y - primary.bounds.y;
      where = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left of main' : 'right of main') : (dy < 0 ? 'above main' : 'below main');
    }
    const res = Math.round(d.bounds.width) + '×' + Math.round(d.bounds.height);
    return { id: String(d.id), primary: isPrimary, label: 'Monitor ' + (i + 1) + (isPrimary ? ' (main)' : '') + ' · ' + res + (where ? ' · ' + where : '') };
  });
}

module.exports = { sharedEdge, WIN_W, WIN_H, WIN_H_SIDE, EDGES, pickDisplays, windowBounds, settingsBounds, dockPoint, nearDock, insideRect, monitorLabels };
