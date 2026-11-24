// Claude Code usage from the transcripts Claude Code already saves on this PC.
// Reads ~/.claude/projects/**/*.jsonl (or $CLAUDE_CONFIG_DIR/projects). No network, no sign-in, no secrets.
// "Tokens" here = input + output + cache creation. Cache reads are tracked but not counted (they dwarf everything else).
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const DAY = 24 * 3600 * 1000;
const fileCache = new Map();          // path -> { mtimeMs, size, rows: [[ts, key, model, tokens, cacheRead], ...] }
let last = { at: 0, data: null };

function projectsDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  return path.join(base, 'projects');
}

async function* walk(dir, cutoff) {
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, cutoff);
    else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        const st = await fs.promises.stat(p);
        if (st.mtimeMs >= cutoff) yield { p, st };
      } catch { /* file vanished */ }
    }
  }
}

function readRows(p, st) {
  const cached = fileCache.get(p);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return Promise.resolve(cached.rows);
  return new Promise((resolve) => {
    const rows = [];
    const rl = readline.createInterface({ input: fs.createReadStream(p, { encoding: 'utf8' }), crlfDelay: Infinity });
    rl.on('line', (line) => {
      if (!line.includes('"usage"')) return;        // cheap pre-filter: most lines are not usage records
      try {
        const o = JSON.parse(line);
        const m = o.message;
        if (!m || !m.usage || !o.timestamp || m.model === '<synthetic>') return;
        const u = m.usage;
        const tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
        rows.push([Date.parse(o.timestamp), (m.id || '') + ':' + (o.requestId || ''), m.model || 'unknown', tokens, u.cache_read_input_tokens || 0]);
      } catch { /* skip malformed line */ }
    });
    rl.on('close', () => { fileCache.set(p, { mtimeMs: st.mtimeMs, size: st.size, rows }); resolve(rows); });
    rl.on('error', () => resolve(rows));
  });
}

function family(model) {
  const m = /(opus|sonnet|haiku|fable)/i.exec(model || '');
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : 'Other';
}

async function getUsage() {
  if (last.data && Date.now() - last.at < 30000) return last.data;
  const dir = projectsDir();
  const now = Date.now();
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  // 7 local midnights built with setDate so a daylight-saving change inside the window cannot shift a bucket
  const bounds = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(startToday); d.setDate(d.getDate() - i); bounds.push(d.getTime()); }
  const weekStart = bounds[0];
  const fiveH = now - 5 * 3600 * 1000;
  const visited = new Set();

  const seen = new Set();               // resumed sessions copy history into new files: count each message once
  const days = new Array(7).fill(0);
  const models = new Map();
  let today = 0, todayMsgs = 0, five = 0, week = 0, found = false;

  for await (const { p, st } of walk(dir, weekStart)) {
    found = true;
    visited.add(p);
    for (const [ts, key, model, tokens] of await readRows(p, st)) {
      if (!(ts >= weekStart && ts <= now + 60000)) continue;       // also rejects NaN timestamps
      if (key !== ':' && seen.has(key)) continue;
      seen.add(key);
      week += tokens;
      let idx = 6; while (idx > 0 && ts < bounds[idx]) idx--;
      days[idx] += tokens;
      models.set(family(model), (models.get(family(model)) || 0) + tokens);
      if (ts >= startToday.getTime()) { today += tokens; todayMsgs++; }
      if (ts >= fiveH) five += tokens;
    }
  }
  for (const k of fileCache.keys()) if (!visited.has(k)) fileCache.delete(k);   // drop files that left the 7-day window
  const top = [...models.entries()].sort((a, b) => b[1] - a[1])[0];
  const data = {
    found, today, todayMsgs, five, week, days,
    topModel: top ? top[0] : null,
    dayLetters: bounds.map((b) => new Date(b).toLocaleDateString('en', { weekday: 'narrow' })),
  };
  last = { at: Date.now(), data };
  return data;
}

module.exports = { getUsage };
