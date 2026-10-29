// A fake Challonge v2.1 for the tests (tests/test_challonge.js, tests/probe_challonge.js): round
// robin, and single elimination drawn the standard way from the seeds (1 v 8, 4 v 5, 2 v 7, 3 v 6,
// byes to the top seeds); a double elimination's losers bracket is left out on purpose (a
// Challonge whose losers bracket isn't ours). Results are checked the way Challonge does: an
// elimination match takes one only once it's open, and a winner can't change without a reopen.
// paging: "jsonapi" (25 a page, JSON:API links), "nolinks" (25 a page) or "ignore" (the page
// number ignored: everything every time).
// createFakeChallonge(paging) -> { api(method, path, body) -> Promise<{ok, status, body}>,
//   tournaments, log (every result reported), latest(), results(t), nameOf(t, id), start(t) }
function createFakeChallonge(paging) {
  const C = { tournaments: {}, nextId: 100, log: [], paging: paging || "jsonapi" };
  function standardOrder(size) { let o = [1]; while (o.length < size) { const m = o.length * 2 + 1; o = o.flatMap((s) => [s, m - s]); } return o; }
  function ok(body) { return Promise.resolve({ ok: true, status: 200, body }); }
  function refuse(detail) { return Promise.resolve({ ok: false, status: 422, body: { errors: [{ detail }] } }); }
  function matchJson(m) {
    return { id: String(m.id), type: "match", attributes: { state: m.state, points_by_participant: m.players.filter(Boolean).map((p) => ({ participant_id: +p, scores: [] })) } };
  }
  function startTournament(t) {
    t.state = "underway";
    const parts = t.participants.slice();
    const mk = (players, extra) => { const m = Object.assign({ id: String(C.nextId++), players, state: players.every(Boolean) ? "open" : "pending", score: null, winner: null }, extra); t.matches.push(m); return m; };
    if (t.type === "round robin") {
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) mk([parts[i].id, parts[j].id]);
      return;
    }
    // elimination: seeded the standard way, byes to the top seeds; a double elimination's losers
    // bracket is left out on purpose (a Challonge whose losers bracket isn't ours)
    parts.sort((x, y) => (x.seed || 999) - (y.seed || 999));
    const size = 2 ** Math.ceil(Math.log2(Math.max(2, parts.length)));
    const slots = standardOrder(size).map((s) => (s <= parts.length ? parts[s - 1].id : null));
    let round = [];
    for (let k = 0; k < size; k += 2) round.push({ players: [slots[k], slots[k + 1]] });
    const rounds = [round];
    while (rounds[rounds.length - 1].length > 1) {
      const prev = rounds[rounds.length - 1];
      rounds.push(Array.from({ length: prev.length / 2 }, () => ({ players: [null, null] })));
    }
    // later rounds first, so a round-1 match knows where its winner goes
    for (let r = rounds.length - 1; r >= 0; r--) {
      rounds[r].forEach((spot, i) => {
        const next = r + 1 < rounds.length ? rounds[r + 1][Math.floor(i / 2)] : null;
        spot.nextSlot = i % 2;
        spot.next = next;
        if (r === 0 && (!spot.players[0] || !spot.players[1])) { next.players[spot.nextSlot] = spot.players[0] || spot.players[1]; return; }
      });
    }
    rounds.forEach((rnd, r) => rnd.forEach((spot) => {
      if (r === 0 && (!spot.players[0] || !spot.players[1])) return;
      spot.match = mk(spot.players.slice(), { spot });
    }));
    rounds.forEach((rnd) => rnd.forEach((spot) => { if (spot.match) spot.match.players = spot.players; }));
    t.rounds = rounds;
  }
  function api(method, p, body) {
    const url = new URL("https://x" + p);
    const parts = url.pathname.split("/").filter(Boolean);
    if (method === "POST" && url.pathname === "/tournaments.json") {
      const id = String(C.nextId++);
      const a = body.data.attributes;
      C.tournaments[id] = { id, name: a.name, type: a.tournament_type, private: a.private, rr: a.round_robin_options, state: "pending", participants: [], matches: [] };
      return ok({ data: { id, type: "tournament", attributes: { name: a.name } } });
    }
    const t = C.tournaments[parts[1]];
    if (!t) return refuse("no such tournament");
    if (method === "POST" && parts[2] === "participants") {
      if (t.state !== "pending" && t.type !== "round robin") return refuse("Tournament participants can no longer be added");
      if (t.state === "complete") return refuse("Tournament participants can no longer be added");
      const added = body.data.attributes.participants.map((pp) => { const q = { id: String(C.nextId++), name: pp.name, seed: pp.seed }; t.participants.push(q); return q; });
      if (t.state === "underway") added.forEach((q) => t.participants.filter((o) => o !== q).forEach((o) => t.matches.push({ id: String(C.nextId++), players: [o.id, q.id], state: "open" })));
      return ok({ data: added.map((q) => ({ id: q.id, type: "participant", attributes: { name: q.name, seed: q.seed } })) });
    }
    if (method === "PUT" && parts[2] === "change_state.json") {
      const st = body.data.attributes.state;
      if (st === "start") { if (t.state !== "pending") return refuse("Tournament is already underway"); startTournament(t); return ok({}); }
      if (st === "finalize") {
        if (t.matches.some((m) => m.state !== "complete")) return refuse("All matches must be complete");
        t.state = "complete";
        return ok({});
      }
    }
    if (method === "GET" && parts[2] === "matches.json") {
      const all = t.matches.map(matchJson);
      const page = +url.searchParams.get("page") || 0;
      if (C.paging === "ignore" || !page) return ok({ data: all });
      const per = Math.min(+url.searchParams.get("per_page") || 25, 25); // pages of 25, whatever was asked
      const slice = all.slice((page - 1) * per, page * per);
      const more = page * per < all.length;
      return ok(C.paging === "jsonapi" ? { data: slice, links: { next: more ? "next" : null } } : { data: slice });
    }
    if (method === "PUT" && parts[2] === "matches") {
      const m = t.matches.find((x) => x.id === parts[3].replace(".json", ""));
      if (!m) return refuse("no such match");
      if (t.state === "complete") return refuse("Tournament is complete");
      const a = body.data.attributes;
      const entry = a.match;
      if (!m.players.every(Boolean) || !entry.every((e) => m.players.includes(e.participant_id))) return refuse("Participants aren't in this match");
      const winner = a.tie ? null : (entry.find((e) => e.rank === 1 && e.advancing) || {}).participant_id || null;
      if (t.type !== "round robin") {
        if (m.state === "pending") return refuse("Match isn't open yet");
        if (!winner) return refuse("Elimination match needs a winner");
        if (m.state === "complete" && m.winner !== winner) return refuse("Reopen the match to change its winner");
      }
      m.state = "complete";
      m.winner = winner;
      m.score = Object.fromEntries(entry.map((e) => [e.participant_id, +e.score_set]));
      C.log.push({ t: t.id, match: m.id, score: m.score, winner, tie: !!a.tie });
      if (m.spot && m.spot.next) {
        const next = m.spot.next;
        next.players[m.spot.nextSlot] = winner;
        if (next.match && next.players.every(Boolean) && next.match.state === "pending") next.match.state = "open";
      }
      if (m.spot && !m.spot.next) t.champion = winner;
      return ok({ data: matchJson(m) });
    }
    return refuse("unexpected " + method + " " + p);
  }
  const nameOf = (t, id) => (t.participants.find((q) => q.id === id) || {}).name;
  // Challonge's results as "Ann 2-1 Bob" (a, b alphabetical), ties as "Ann 1-1 Bob tie"
  function challongeResults(t) {
    return t.matches.filter((m) => m.state === "complete").map((m) => {
      const [x, y] = m.players.map((id) => nameOf(t, id)).sort();
      const idx = (n) => m.players.find((id) => nameOf(t, id) === n);
      return x + " " + m.score[idx(x)] + "-" + m.score[idx(y)] + " " + y + (m.winner ? "" : " tie");
    }).sort();
  }
  return {
    api, tournaments: C.tournaments, log: C.log, start: startTournament, results: challongeResults, nameOf,
    latest: () => { const ids = Object.keys(C.tournaments); return C.tournaments[ids[ids.length - 1]]; }
  };
}
module.exports = { createFakeChallonge };
