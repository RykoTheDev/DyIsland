// The clipboard module with a FAKE Electron clipboard (the real one is never touched): history, picture, pin, pins on disk, paste gate.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const fake = { text: '', image: null, written: [], marked: false };
const mkImage = (w, h, tag) => ({ isEmpty: () => false, getSize: () => ({ width: w, height: h }), resize: () => ({ toBitmap: () => Buffer.from('bm' + tag), toDataURL: () => 'data:image/png;base64,' + tag }) });
const electron = { clipboard: {
  readText: async () => fake.text, readImage: async () => fake.image || { isEmpty: () => true },
  has: async (f) => fake.marked && f === 'ExcludeClipboardContentFromMonitorProcessing',
  writeText: async (t) => { fake.written.push('text:' + t); fake.text = t; }, writeImage: async () => { fake.written.push('image'); },
} };
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? electron : orig.call(this, r, ...a); };
const { create } = require('../main/clipboard.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dyisland-clip-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const make = (settings) => {
  const handlers = {}, sent = [];
  const mod = create({ ipcMain: { handle: (c, f) => { handlers[c] = f; } }, store: { get: () => ({ clipboard: settings }) }, broadcast: (c, v) => sent.push(v), dataDir: () => dir, paste: () => { fake.written.push('PASTE'); } });
  return { mod, h: (c, ...a) => handlers[c]({}, ...a), sent };
};

(async () => {
  const cfg = { enabled: true, max: 5, images: true, paste: false, persistPins: true };
  const a = make(cfg); a.mod.sync();
  fake.text = 'already here';                                    // what is on the clipboard when history starts is not recorded... (it was read at sync: set after, so this is new)
  await sleep(1200);
  fake.text = 'secret'; fake.marked = true; await sleep(1100); fake.marked = false;
  let list = a.mod.items();
  assert(list.some((x) => x.text === 'already here'), 'a new copy is recorded');
  assert(!list.some((x) => x.text === 'secret'), 'something a password manager marked is never recorded');
  fake.text = ''; fake.image = mkImage(400, 300, 'AAA'); await sleep(1100);
  list = a.mod.items(); const img = list.find((x) => x.kind === 'image');
  assert(img && img.thumb.startsWith('data:image/png') && !('image' in img), 'a picture is listed with a thumbnail only');
  // pin the text: it goes to the top and to disk
  const textItem = list.find((x) => x.text === 'already here');
  await a.h('clipboard:pin', textItem.id);
  assert.strictEqual(a.mod.items()[0].text, 'already here'); assert(a.mod.items()[0].pinned);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pins.json'), 'utf8')), ['already here'], 'pinned text is saved (only with the option on)');
  assert(!fs.readFileSync(path.join(dir, 'pins.json'), 'utf8').includes('AAA'), 'pictures are never saved');
  // paste is gated by its setting; copy always works
  assert.strictEqual(await a.h('clipboard:paste', img.id), false, 'Click to paste is off: nothing pasted'); assert(!fake.written.includes('PASTE'));
  assert.strictEqual(await a.h('clipboard:copy', img.id), true); assert(fake.written.includes('image'), 'a picture is copied back as a picture');
  // clear keeps pins
  await a.h('clipboard:clear'); assert.deepStrictEqual(a.mod.items().map((x) => x.text), ['already here']);
  // a new run: the pin comes back
  const b = make(cfg); b.mod.sync();
  assert.deepStrictEqual(b.mod.items().map((x) => [x.text, x.pinned]), [['already here', true]], 'pins survive a restart with the option on');
  // the same run, options changed: Click to paste now pastes, and switching "keep pins" off removes the file
  cfg.paste = true; fake.written.length = 0;
  assert.strictEqual(await b.h('clipboard:paste', b.mod.items()[0].id), true); await sleep(120);
  assert(fake.written.includes('PASTE') && fake.written.includes('text:already here'), 'with Click to paste on, the item is copied and Ctrl+V is sent');
  cfg.persistPins = false; b.mod.sync();
  assert(!fs.existsSync(path.join(dir, 'pins.json')), 'switching the option off deletes pins.json');
  console.log('PASS clipboard module: history, marked-secret skipped, picture thumbnail, pins on disk (opt-in), Clear keeps pins');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
