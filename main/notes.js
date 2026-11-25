// Quick note: one line appended to a plain text file (Documents\DyIsland\notes.md by default). Nothing else, nowhere else.
const fs = require('fs');
const path = require('path');

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

// text -> one markdown list line; line breaks become spaces, control characters go, 2000 characters at most. '' when nothing is left.
function formatLine(text, date = new Date()) {
  const t = String(text == null ? '' : text).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s*[\r\n]+\s*/g, ' ').trim().slice(0, 2000);
  return t ? '- ' + stamp(date) + '  ' + t + '\n' : '';
}

function append(file, text, date = new Date()) {
  const line = formatLine(text, date);
  if (!line) return { ok: false, error: 'Empty note' };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    let prefix = '';
    try { const st = fs.statSync(file); if (st.size > 0) { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, st.size - 1); fs.closeSync(fd); if (b[0] !== 10) prefix = '\n'; } } catch { /* new file */ }
    fs.appendFileSync(file, prefix + line, 'utf8');
    return { ok: true, file };
  } catch (e) { return { ok: false, error: 'Could not write the notes file' }; }
}

module.exports = { formatLine, append };
