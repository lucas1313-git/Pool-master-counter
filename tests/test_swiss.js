// Swiss pairing (P20), the real functions pulled out of js/app.js: 1,000 simulated events (3 to 20
// players, the default number of rounds or more, random results and scores), played round by
// round through buildSwissTournament / finalizeSwissRoundIfComplete:
// - no avoidable rematch: whenever a round repeats a pairing, an exhaustive search confirms no
//   round without one existed (any bye included);
// - every round: each player once, at most one bye; a second bye only when every player still
//   without one would force a rematch (late in a long odd field);
// - the number of rounds: the organizer's, else ceil(log2 n); never more than a field can play
//   without meeting twice;
// - each event ends with a champion or a playoff asked for.
// Compared with the old greedy pairing over the same events (for the record, not a pass/fail).
// usage: node tests/test_swiss.js
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8").split("\n");
function extract(name) {
  const re = new RegExp("^  function " + name + "\\(");
  const start = src.findIndex((l) => re.test(l));
  if (start < 0) return "function " + name + "() { throw new Error('" + name + " missing'); }";
  let end = start;
  while (src[end] !== "  }") end++;
  return src.slice(start, end + 1).join("\n");
}
const NAMES = ["createBracketMatch", "swissRoundsFor", "buildSwissTournament", "swissWinsMap", "swissPairingOrder", "swissPairKey", "swissPairNames", "pairSwissRound",
  "tournamentRecords", "rankWithTieBreaks", "swissStandings", "settleTournamentChampion", "finalizeSwissRoundIfComplete"];
const F = new Function("var __n = 0; function uid() { return 'm' + ++__n; }\n" + NAMES.map(extract).join("\n") + "\nreturn {" + NAMES.join(",") + "};")();

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
let seed = 20261029;
const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// exhaustive: is there a round with no rematch (a bye allowed for an odd field)? bitmask memo
function rematchFreeExists(names, played) {
  const n = names.length;
  const ok = names.map((a, i) => names.map((b, j) => i !== j && !played(a, b)));
  const memo = new Map();
  function can(mask) {
    if (mask === 0) return true;
    if (memo.has(mask)) return memo.get(mask);
    let i = 0;
    while (!(mask & (1 << i))) i++;
    let res = false;
    for (let j = i + 1; j < n && !res; j++) if ((mask & (1 << j)) && ok[i][j]) res = can(mask & ~(1 << i) & ~(1 << j));
    memo.set(mask, res);
    return res;
  }
  const all = (1 << n) - 1;
  if (n % 2 === 0) return can(all);
  for (let b = 0; b < n; b++) if (can(all & ~(1 << b))) return true;
  return false;
}

const problems = { avoidable: [], shape: [], byes: [], rounds: [], unfinished: [] };
let events = 0, roundsPlayed = 0, rematchRounds = 0, oldAvoidable = 0;
for (let run = 0; run < 1000; run++) {
  const n = 3 + Math.floor(rng() * 18);
  const names = Array.from({ length: n }, (_, i) => "P" + (i + 1));
  const wanted = rng() < 0.5 ? 0 : 1 + Math.floor(rng() * n);
  const t = F.buildSwissTournament(names, "8ball", 1, 3, false, null, wanted);
  events++;
  const expectRounds = F.swissRoundsFor(n, wanted);
  const most = n % 2 === 1 ? n : n - 1;
  if (t.totalRounds !== expectRounds || t.totalRounds > most || (wanted === 0 && t.totalRounds !== Math.max(1, Math.ceil(Math.log2(n))))) problems.rounds.push({ n, wanted, total: t.totalRounds });
  const met = {};
  const key = (a, b) => [a, b].sort().join("|");
  const byes = {};
  for (let guard = 0; guard < 64 && !t.champion && !t.playoffPending; guard++) {
    const round = t.rounds[t.rounds.length - 1];
    roundsPlayed++;
    // shape: everyone once, at most one bye
    const seen = round.flatMap((mm) => [mm.a, mm.b]).filter((x) => x !== null);
    const roundByes = round.filter((mm) => mm.b === null).map((mm) => mm.a);
    if (seen.length !== n || new Set(seen).size !== n || roundByes.length !== n % 2) problems.shape.push({ n, round: t.rounds.length, seen: seen.length, byes: roundByes.length });
    roundByes.forEach((b) => {
      // (a second bye only when every player still without one would force a rematch)
      const fresh = names.filter((x) => !byes[x]);
      if (byes[b] && fresh.some((x) => rematchFreeExists(names.filter((y) => y !== x), (p, q) => !!met[key(p, q)]))) problems.byes.push({ n, round: t.rounds.length, bye: b });
      byes[b] = (byes[b] || 0) + 1;
    });
    // rematches: avoidable?
    const pairs = round.filter((mm) => mm.b !== null);
    const repeats = pairs.filter((mm) => met[key(mm.a, mm.b)]);
    if (repeats.length) {
      rematchRounds++;
      if (rematchFreeExists(names, (a, b) => !!met[key(a, b)])) problems.avoidable.push({ n, round: t.rounds.length, repeats: repeats.map((mm) => key(mm.a, mm.b)) });
    }
    // the old greedy on the same history, for the record
    {
      const wins = F.swissWinsMap(t);
      const ranked = names.slice().sort((a, b) => wins[b] - wins[a] || names.indexOf(a) - names.indexOf(b));
      const un = ranked.slice();
      if (un.length % 2) { let bi = -1; for (let q = un.length - 1; q >= 0; q--) if (!byes[un[q]] || byes[un[q]] === 1 && roundByes.includes(un[q])) { bi = q; break; } un.splice(bi < 0 ? un.length - 1 : bi, 1); }
      let rem = 0;
      while (un.length) { const a = un.shift(); let k = un.findIndex((x) => !met[key(a, x)]); if (k < 0) { k = 0; rem++; } un.splice(k, 1); }
      if (rem && rematchFreeExists(names, (a, b) => !!met[key(a, b)])) oldAvoidable++;
    }
    pairs.forEach((mm) => {
      met[key(mm.a, mm.b)] = true;
      const aWins = rng() < 0.5;
      mm.winner = aWins ? mm.a : mm.b;
      mm.loser = aWins ? mm.b : mm.a;
      mm.scoreA = aWins ? 3 : Math.floor(rng() * 3);
      mm.scoreB = aWins ? Math.floor(rng() * 3) : 3;
    });
    F.finalizeSwissRoundIfComplete(t);
  }
  if (!t.champion && !t.playoffPending) problems.unfinished.push({ n, rounds: t.rounds.length });
}
check(events + " Swiss events (" + roundsPlayed + " rounds): no avoidable rematch (" + rematchRounds + " rounds repeated a pairing, each unavoidable)", problems.avoidable.length === 0, problems.avoidable.slice(0, 5));
check("...every round: each player once, a bye only for an odd field", problems.shape.length === 0, problems.shape.slice(0, 5));
check("...a second bye only when every player without one would force a rematch", problems.byes.length === 0, problems.byes.slice(0, 5));
check("...rounds: the organizer's number, else ceil(log2 n), never more than n − 1 (n when odd)", problems.rounds.length === 0, problems.rounds.slice(0, 5));
check("...each event ends: a champion, or a playoff asked for", problems.unfinished.length === 0, problems.unfinished.slice(0, 5));
console.log("(the old greedy pairing, on the same rounds: " + oldAvoidable + " avoidable rematches)");
check("swissRoundsFor: 8 players → 3 (auto), 7 when asked for 10; 7 players → 3, 7 when asked for 9", F.swissRoundsFor(8, 0) === 3 && F.swissRoundsFor(8, 10) === 7 && F.swissRoundsFor(7, 0) === 3 && F.swissRoundsFor(7, 9) === 7);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
