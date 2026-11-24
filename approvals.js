// Open permission requests from Claude Code, waiting for an Allow / Deny on the island.
// Pure and timer-injectable. Every request is answered exactly once: by you, by the wait running out ('ask': Claude Code
// then shows its own prompt), or dropped if the hook went away.
function createApprovals({ onChange = () => {}, waitMs = 30000, max = 8, setT = setTimeout, clearT = clearTimeout, now = Date.now } = {}) {
  const items = new Map();
  let seq = 0, wait = waitMs;

  function finish(id, behavior) {
    const it = items.get(id); if (!it) return false;
    items.delete(id); clearT(it.timer);
    try { it.respond(behavior); } catch { /* the hook already left */ }
    onChange(); return true;
  }
  return {
    setWait(ms) { wait = ms; },
    // returns an id, or null when there are too many open (the extra ones just fall back to the terminal prompt)
    add(info, respond) {
      if (items.size >= max) return null;
      const id = ++seq;
      const timer = setT(() => finish(id, 'ask'), wait);
      items.set(id, { id, info, respond, timer, at: now() });
      onChange(); return id;
    },
    answer(id, behavior) { return finish(Number(id), behavior === 'allow' || behavior === 'deny' ? behavior : 'ask'); },
    cancel(id) { const it = items.get(id); if (!it) return false; clearT(it.timer); items.delete(id); onChange(); return true; },
    // settled elsewhere (new prompt / turn ended): hand the hook an 'ask' so it exits at once instead of hanging until its wait runs out
    cancelSession(session) { let n = 0; for (const [id, it] of [...items]) if (it.info.session === session) { finish(id, 'ask'); n++; } return n; },
    askAll() { for (const id of [...items.keys()]) finish(id, 'ask'); },          // approvals switched off / island hidden
    count: () => items.size,
    list: () => [...items.values()].map((it) => ({ id: it.id, session: it.info.session, project: it.info.project, tool: it.info.tool, detail: it.info.detail, extra: it.info.extra, at: it.at })),
  };
}

module.exports = { createApprovals };
