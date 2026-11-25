// Drag detection for the click-through island. Windows only delivers a drag-and-drop to a window that can be hit-tested, and the island is
// click-through, so main turns it into a real drop target for the length of a drag that heads for it:
//   the mouse button is down (system helper reports LMB 1/0), it went down OUTSIDE the zone, and the pointer is now inside the zone -> armed.
//   armed ends 400 ms after the button is released (so the drop is delivered first), or 700 ms after the pointer left the zone.
// Pure logic (no Electron), so it is unit-tested. The renderer still decides whether the thing dragged is a file (dataTransfer.types).
const PAD = 40;                                    // the zone is the open island plus this margin

// The zone, in screen pixels, in front of the docked edge: the open island's size plus a margin.
function zone(b, edge, openW, openH) {
  const w = Math.round(openW + PAD * 2), h = Math.round(openH + PAD * 2);
  if (edge === 'left') return { x: b.x, y: Math.round(b.y + b.height / 2 - h / 2), width: w, height: h };
  if (edge === 'right') return { x: b.x + b.width - w, y: Math.round(b.y + b.height / 2 - h / 2), width: w, height: h };
  return { x: Math.round(b.x + b.width / 2 - w / 2), y: b.y, width: w, height: h };
}
const inside = (p, r) => p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;

// One state machine per island. step() is called with every pointer sample and every button change; it returns 'arm', 'disarm' or null.
function createMachine() {
  let down = false, downInZone = false, downAt = 0, armed = false, leftAt = 0, upAt = 0;
  return {
    isArmed: () => armed,
    button(isDown, inZone, now) {
      if (isDown) { down = true; downInZone = inZone; downAt = now; upAt = 0; leftAt = 0; }
      else { down = false; if (armed) upAt = now; }
    },
    step(inZone, now) {
      if (!armed) {
        if (down && !downInZone && inZone && now - downAt >= 150) { armed = true; leftAt = 0; return 'arm'; }
        return null;
      }
      if (!down && upAt && now - upAt >= 400) { armed = false; return 'disarm'; }
      if (down) { if (inZone) leftAt = 0; else if (!leftAt) leftAt = now; else if (now - leftAt >= 700) { armed = false; return 'disarm'; } }
      return null;
    },
    reset() { const was = armed; down = false; armed = false; leftAt = 0; upAt = 0; return was; },
  };
}

module.exports = { zone, inside, createMachine, PAD };
