// The clipboard history as a plain list (no Electron here, so it can be tested): pinned items first, then the newest first.
// An item is { id, kind: 'text' | 'image', sig, text?, thumb?, pinned, ...anything the caller keeps (the full image) }.
const MAX_PINS = 10;

const order = (items) => [...items.filter((x) => x.pinned), ...items.filter((x) => !x.pinned)];       // (a stable split: each group keeps its own order)

// A new copy goes to the top of the unpinned items; the same thing copied again moves up instead of being listed twice. The oldest unpinned ones fall off.
function add(items, entry, max) {
  const prev = items.find((x) => x.sig === entry.sig);
  if (prev && prev.pinned) return items;                                           // a pinned item stays where it is
  const rest = items.filter((x) => x.sig !== entry.sig);
  const item = prev ? { ...prev, ...entry, id: prev.id, pinned: false } : { pinned: false, ...entry };
  const pinned = rest.filter((x) => x.pinned), loose = [item, ...rest.filter((x) => !x.pinned)].slice(0, Math.max(1, max));
  return [...pinned, ...loose];
}
// Copying an item from the list brings it to the top of its group
function touch(items, id) {
  const it = items.find((x) => x.id === id); if (!it) return items;
  const same = items.filter((x) => x.pinned === it.pinned && x.id !== id), other = items.filter((x) => x.pinned !== it.pinned);
  return it.pinned ? [it, ...same, ...other] : [...other, it, ...same];
}
function togglePin(items, id, max) {
  const it = items.find((x) => x.id === id); if (!it) return items;
  if (!it.pinned && items.filter((x) => x.pinned).length >= MAX_PINS) return items;
  const flipped = { ...it, pinned: !it.pinned };
  const rest = items.filter((x) => x.id !== id);
  if (flipped.pinned) return [flipped, ...rest.filter((x) => x.pinned), ...rest.filter((x) => !x.pinned)];       // a new pin goes first among the pins
  const pinned = rest.filter((x) => x.pinned), loose = [flipped, ...rest.filter((x) => !x.pinned)].slice(0, Math.max(1, max));
  return [...pinned, ...loose];
}
const clearUnpinned = (items) => items.filter((x) => x.pinned);
const remove = (items, id) => items.filter((x) => x.id !== id);
// What the page gets: no full images, no signatures
const view = (items) => items.map((x) => ({ id: x.id, kind: x.kind, text: x.kind === 'text' ? x.text : undefined, thumb: x.kind === 'image' ? x.thumb : undefined, pinned: !!x.pinned }));
// Search: text items whose text contains the query (case-insensitive, any order of words); pinned stay on top; images only when there is no query
function filter(list, q) {
  q = String(q || '').trim().toLowerCase(); if (!q) return list;
  const words = q.split(/\s+/);
  return list.filter((x) => x.kind === 'text' && words.every((w) => String(x.text).toLowerCase().includes(w)));
}

module.exports = { MAX_PINS, add, touch, togglePin, clearUnpinned, remove, view, filter, order };
