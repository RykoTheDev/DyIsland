// Draws the DyIsland app icon (a teal rounded square with a dark "island" capsule holding two little eyes) and writes
//   build/icon.png   512x512 (source image for the installer)
//   assets/icon.png  the same image, shipped inside the app: the tray icon is read from here (the build/ folder is not packaged)
//   build/icon.ico   16..256 px, used by the installer and the .exe
// Pure Node (zlib only): no image libraries. Run with:  npm run icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TEAL = [0x1f, 0xb5, 0xa5], DARK = [0x0b, 0x15, 0x13], EYE = [0x53, 0xdb, 0xc9];

// signed distance to a rounded rectangle centred at (cx, cy)
const rrect = (px, py, cx, cy, w, h, r) => {
  const qx = Math.abs(px - cx) - (w / 2 - r), qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

function render(size) {
  const buf = Buffer.alloc(size * size * 4), S = 4;                           // 4x4 supersampling
  const u = size / 512;                                                       // design units are on a 512 grid
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const px = (x + (sx + 0.5) / S) / u, py = (y + (sy + 0.5) / S) / u;
      let col = null;
      if (rrect(px, py, 256, 256, 512, 512, 120) < 0) {
        col = TEAL;
        if (rrect(px, py, 256, 188, 328, 132, 66) < 0) {                       // the island
          col = DARK;
          if (rrect(px, py, 216, 188, 34, 68, 17) < 0 || rrect(px, py, 296, 188, 34, 68, 17) < 0) col = EYE;   // the eyes
        } else if (rrect(px, py, 256, 352, 328, 84, 42) < 0) col = [0xe9, 0xfb, 0xf8];   // a light bar below: the expanded card hint
      }
      if (col) { r += col[0]; g += col[1]; b += col[2]; a += 1; }
    }
    const i = (y * size + x) * 4, n = S * S;
    if (a) { buf[i] = Math.round(r / a); buf[i + 1] = Math.round(g / a); buf[i + 2] = Math.round(b / a); buf[i + 3] = Math.round((a / n) * 255); }
  }
  return buf;
}

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;   // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function ico(sizes) {
  const images = sizes.map((s) => png(s, render(s)));
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = 6 + 16 * sizes.length;
  const dir = sizes.map((s, i) => { const e = Buffer.alloc(16); e[0] = s >= 256 ? 0 : s; e[1] = s >= 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12); offset += images[i].length; return e; });
  return Buffer.concat([head, ...dir, ...images]);
}

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });
const big = png(512, render(512));
fs.writeFileSync(path.join(out, 'icon.png'), big);
const assets = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assets, { recursive: true });
fs.writeFileSync(path.join(assets, 'icon.png'), big);
fs.writeFileSync(path.join(out, 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));
console.log('wrote build/icon.png, build/icon.ico and assets/icon.png');
