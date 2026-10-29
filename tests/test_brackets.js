// Brackets built the standard way - the real functions, pulled out of js/app.js and played out
// with random results, for every field size from 3 to 64, single and double elimination:
// - byes only in round 1, at most one each, and to the top seeds (seed 1 and 2 meet only in the
//   final when the higher seed always wins); the wins needed to take the title differ by at most one;
// - double elimination: the standard losers bracket (nobody plays more than 2 x (rounds - 1) losers
//   matches), nobody's first losers match is against the player who just beat them, everyone but
//   the champion goes out on their second loss, the grand final resets when the losers-bracket
//   champion wins it;
// - "Match Similar Ratings": round 1 pairs neighbours, byes to the lowest-rated;
// - no deadlock: every tournament reaches a champion.
// usage: node tests/test_brackets.js
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8").split("\n");
function extract(name) {
  const re = new RegExp("^  function " + name + "\\(");
  const start = src.findIndex((l) => re.test(l));
  if (start < 0) return "function " + name + "() {}"; // (an older app.js without it)
  let end = start;
  while (src[end] !== "  }") end++;
  return src.slice(start, end + 1).join("\n");
}
const NAMES = ["nextPow2", "seedOrder", "createBracketMatch", "buildWinnersBracketRounds", "buildLosersBracketRounds",
  "advanceBracket", "advanceBracketV2", "pairUpNames", "wbRoundComplete", "pendingLbMatches", "buildSingleEliminationBracket", "buildDoubleEliminationBracket", "isGrandFinalMatch", "reportBracketResult"];
const F = new Function("var __n = 0; function uid() { return 'm' + ++__n; }\n" + NAMES.map(extract).join("\n") + "\nreturn {" + NAMES.join(",") + "};")();

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 600) : "")); if (!ok) fails++; }
const seedOf = (name) => +name.slice(1);
function allMatches(t) {
  return [].concat(...t.wb, ...t.lbRounds, t.grandFinal);
}
// plays a tournament out; strongest: the higher seed (lower number) always wins
function play(t, rng, strongest) {
  const log = [];
  for (let guard = 0; guard < 5000; guard++) {
    if (t.champion) return { log, deadlock: false };
    const open = allMatches(t).filter((m) => m.a && m.b && m.winner === null);
    if (!open.length) return { log, deadlock: true };
    const m = open[Math.floor(rng() * open.length)];
    const w = strongest ? (seedOf(m.a) < seedOf(m.b) ? m.a : m.b) : rng() < 0.5 ? m.a : m.b;
    log.push({ m, a: m.a, b: m.b, winner: w });
    F.reportBracketResult(t, m, w, 1, 0);
  }
  return { log, deadlock: true };
}
let seed = 12345;
const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const names = (n) => Array.from({ length: n }, (_, i) => "S" + (i + 1));

const problems = { byes: [], winsSpread: [], seeds12: [], lbPath: [], rematch: [], losses: [], deadlock: [], reset: [] };
for (let n = 3; n <= 64; n++) {
  const k = Math.log2(F.nextPow2(n));
  for (const format of ["single", "double"]) {
    // structure (seeded): byes in round 1 only, at most one each, to the top seeds
    const t0 = (format === "single" ? F.buildSingleEliminationBracket : F.buildDoubleEliminationBracket)(names(n), "8ball", 1, 3, false, names(n), false);
    const byeHolders = t0.wb[0].filter((m) => (m.a === null) !== (m.b === null)).map((m) => m.a || m.b);
    const expectedByes = F.nextPow2(n) - n;
    if (byeHolders.length !== expectedByes || new Set(byeHolders).size !== byeHolders.length || byeHolders.some((p) => seedOf(p) > expectedByes)) problems.byes.push({ n, format, byeHolders });
    // wins needed to take the winners bracket: by round-1 position
    if (format === "single") {
      // (a later-round bye - the old layout's pendingBye - is a free pass, not a win)
      const need = t0.wb[0].map((m, mi) => {
        let wins = m.a && m.b ? 1 : 0, idx = mi;
        for (let ri = 1; ri < t0.wb.length; ri++) { idx = Math.floor(idx / 2); if (!t0.wb[ri][idx].pendingBye) wins++; }
        return wins;
      });
      if (Math.max(...need) - Math.min(...need) > 1) problems.winsSpread.push({ n, need: [Math.min(...need), Math.max(...need)] });
      const strong = (F.buildSingleEliminationBracket)(names(n), "8ball", 1, 3, false, names(n), false);
      play(strong, rng, true);
      const fin = strong.wb[strong.wb.length - 1][0];
      if (![fin.a, fin.b].includes("S1") || ![fin.a, fin.b].includes("S2")) problems.seeds12.push({ n, final: [fin.a, fin.b] });
    }
    // random results, seeded and random draws
    for (let run = 0; run < 60; run++) {
      const t = (format === "single" ? F.buildSingleEliminationBracket : F.buildDoubleEliminationBracket)(names(n), "8ball", 1, 3, false, run % 2 ? names(n) : null, false);
      const { log, deadlock } = play(t, rng, false);
      if (deadlock) { problems.deadlock.push({ n, format, run }); continue; }
      const losses = {}, lbPlayed = {}, firstLb = {}, beatenBy = {};
      const lbIds = new Set([].concat(...t.lbRounds).map((m) => m.id));
      const gfIds = new Set(t.grandFinal.map((m) => m.id));
      log.forEach(({ m, a, b, winner }) => {
        const loser = winner === a ? b : a;
        losses[loser] = (losses[loser] || 0) + 1;
        if (lbIds.has(m.id)) {
          [a, b].forEach((p) => { lbPlayed[p] = (lbPlayed[p] || 0) + 1; if (!(p in firstLb)) firstLb[p] = winner === p ? loser : winner; });
        } else if (!gfIds.has(m.id) && !(loser in beatenBy)) beatenBy[loser] = winner;
      });
      names(n).forEach((p) => {
        const want = p === t.champion ? null : format === "single" ? 1 : 2;
        if (want !== null && losses[p] !== want) problems.losses.push({ n, format, p, losses: losses[p] || 0 });
      });
      if (format === "double") {
        const most = Math.max(0, ...Object.values(lbPlayed));
        if (most > 2 * (k - 1)) problems.lbPath.push({ n, most, standard: 2 * (k - 1) });
        // (3 players: only three people - the one with the losers-bracket bye can only meet the other two)
        if (n > 3) Object.keys(firstLb).forEach((p) => { if (beatenBy[p] && firstLb[p] === beatenBy[p]) problems.rematch.push({ n, run, p, vs: beatenBy[p] }); });
        const gf = t.grandFinal;
        if (gf.length && gf[0].winner === t.lbChampion && gf.length !== 2) problems.reset.push({ n, run });
      }
    }
  }
}
check("every bracket: byes only in round 1, at most one each, to the top seeds", problems.byes.length === 0, problems.byes);
check("single elimination: the wins needed to take the title differ by at most one (3-64 players)", problems.winsSpread.length === 0, problems.winsSpread);
check("...the higher seed always winning: seed 1 meets seed 2 in the final", problems.seeds12.length === 0, problems.seeds12);
check("no deadlock: every tournament (3-64 players, single and double, 60 random runs each) has a champion", problems.deadlock.length === 0, problems.deadlock);
check("everyone but the champion goes out on their 1st (single) / 2nd (double) loss", problems.losses.length === 0, problems.losses.slice(0, 5));
check("double elimination: nobody plays more than the standard 2 x (rounds - 1) losers matches", problems.lbPath.length === 0, problems.lbPath.slice(0, 5));
check("...nobody's first losers match is against the player who just beat them (4-64 players)", problems.rematch.length === 0, problems.rematch.slice(0, 5));
check("...the grand final resets when the losers-bracket champion wins it", problems.reset.length === 0, problems.reset.slice(0, 5));

// "Match Similar Ratings": neighbours in round 1, byes to the lowest-rated
const sim = F.buildSingleEliminationBracket(names(6), "8ball", 1, 3, false, names(6), true);
const r1 = sim.wb[0].map((m) => [m.a, m.b]);
check("Match Similar Ratings, 6 players: round 1 S1-S2, S3-S4, then byes for S5 and S6", JSON.stringify(r1) === JSON.stringify([["S1", "S2"], ["S3", "S4"], ["S5", null], ["S6", null]]), r1);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
