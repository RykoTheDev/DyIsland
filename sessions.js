// Which Claude Code sessions are working right now, and what each one is up to.
// One entry per session_id: when its current prompt started, and when we last heard from it.
// A session that goes quiet for `timeoutMs` (default 10 minutes) is dropped: if you press Esc mid-task, Claude Code
// may never send Stop, and without this the indicator would stay on forever.
// Finished sessions stay in the list for `recentMs` (15 minutes) as "done", so you can see what just completed.
// Pure and clock-injectable, so it can be tested without waiting.
const TEN_MINUTES = 10 * 60 * 1000;

function createSessions({ timeoutMs = TEN_MINUTES, recentMs = 15 * 60 * 1000, quietMs = 5 * 60 * 1000, now = Date.now } = {}) {
  const map = new Map();                                   // active: id -> { startedAt, lastEvent, project, status, beats, approvals }
  const recent = new Map();                                // finished: id -> { project, endedAt }

  const projectOf = (m) => (m && typeof m.project === 'string' ? m.project.slice(0, 60) : '');

  function prune() {
    const t = now();
    let changed = false;
    for (const [id, s] of map) {
      if (t - s.lastEvent >= timeoutMs) { map.delete(id); changed = true; }   // timeout is per session
    }
    for (const [id, r] of recent) if (t - r.endedAt >= recentMs) { recent.delete(id); changed = true; }
    return changed;
  }

  return {
    // UserPromptSubmit: a (new) prompt began. A new prompt in a known session restarts that session's clock.
    start(id, meta) {
      const t = now(); const old = map.get(id);
      recent.delete(id);
      map.set(id, { startedAt: t, lastEvent: t, project: projectOf(meta) || (old && old.project) || '', status: 'working', beats: 0, approvals: 0 });
    },
    // Any other event from a session that is already working (e.g. a tool call) proves it is alive and busy again.
    touch(id, meta) {
      const s = map.get(id); if (!s) return;
      s.lastEvent = now(); s.beats++;
      if (s.status === 'waiting') s.status = 'working';
      if (!s.project) s.project = projectOf(meta);
    },
    // Notification: Claude is waiting for you (a question, or a permission prompt)
    wait(id, meta) {
      const s = map.get(id); if (!s) return;
      s.lastEvent = now(); s.status = 'waiting';
      if (!s.project) s.project = projectOf(meta);
    },
    // A permission request is open for this session (the island is asking). Creates the session if we have not seen it:
    // a request proves it is alive.
    approval(id, on, meta) {
      let s = map.get(id);
      if (!s) {
        if (!on) return;
        const t = now(); recent.delete(id);
        s = { startedAt: t, lastEvent: t, project: projectOf(meta), status: 'working', beats: 0, approvals: 0 }; map.set(id, s);
      }
      s.lastEvent = now();
      s.approvals = Math.max(0, s.approvals + (on ? 1 : -1));
      if (!s.project) s.project = projectOf(meta);
    },
    // Stop: finished this prompt (kept as "done"). SessionEnd: gone for good.
    end(id, { gone = false } = {}) {
      const s = map.get(id);
      if (s && !gone) recent.set(id, { project: s.project, endedAt: now() });
      if (gone) recent.delete(id);
      return map.delete(id);
    },
    prune,
    // The indicator shows while ANY session is active; its elapsed time is that of the most recently started one.
    state() {
      prune();
      let since = 0;
      for (const s of map.values()) if (s.startedAt > since) since = s.startedAt;
      return { working: map.size > 0, since, count: map.size, list: this.list() };
    },
    // Every session worth showing, most urgent first: needs you, working, then done.
    list() {
      prune();
      const t = now(); const out = [];
      for (const [id, s] of map) {
        const status = s.approvals > 0 ? 'approval' : s.status === 'waiting' ? 'waiting'
          : (s.beats > 0 && t - s.lastEvent >= quietMs) ? 'quiet' : 'working';   // "quiet" only if heartbeats prove we would have heard
        out.push({ id: id.slice(0, 8), project: s.project, status, since: s.startedAt });
      }
      const rank = { approval: 0, waiting: 1, quiet: 2, working: 3 };
      out.sort((a, b) => rank[a.status] - rank[b.status] || b.since - a.since);
      const done = [...recent].sort((a, b) => b[1].endedAt - a[1].endedAt).map(([id, r]) => ({ id: id.slice(0, 8), project: r.project, status: 'done', since: r.endedAt }));
      return out.concat(done).slice(0, 12);
    },
  };
}

module.exports = { createSessions, TEN_MINUTES };
