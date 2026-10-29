// A chip tournament played out (P34), no browser - js/app.js's own engine (the functions taken
// out of it, as test_swiss does): 12 players, 3 tables, auto-assign on, a random winner every
// game (seeded), until one player has chips:
// - never more than 3 games live, nobody on two tables, every table used;
// - every game costs its loser exactly one chip; nobody plays with 0; out at 0, never back;
// - the next two in line go to a free table (nobody waits while a table is free and two can play);
// - nobody plays the same opponent twice in a row while someone else is waiting in the line (with
//   only the two of them in it, they're the next two - by the rules, they play);
// - one champion, everyone else placed (the last out 2nd ... the first out 12th);
// - chips by rating: 4 / 3 / 2 by the default chart;
// - a withdrawal while waiting: out at once; a late player: chips from the chart, to the back.
// usage: node tests/test_chip_tournament.js
const fs = require("fs");
const path = require("path");
const LIB = path.join(__dirname, "..", "js", "lib");
const src = fs.readdirSync(LIB).filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(LIB, f), "utf8"))
  .concat(fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8")).join("\n").split("\n");
function extract(name) {
  const re = new RegExp("^  function " + name + "\\(");
  const start = src.findIndex((l) => re.test(l));
  if (start < 0) return "function " + name + "() { throw new Error('" + name + " missing'); }";
  let end = start;
  while (src[end] !== "  }") end++;
  return src.slice(start, end + 1).join("\n");
}
const NAMES = ["createBracketMatch", "buildChipTournament", "chipPendingMatches", "settleChipChampion", "allBracketMatches", "findBracketMatchById",
  "pendingBracketMatches", "reportBracketResult", "tournamentBusyNames", "matchQueueOrder", "findWbPosition", "tournamentQueue", "freeTournamentTables",
  "tournamentAutoAssignOn", "autoAssignTables", "beginTournamentMatch", "activeFor", "tournamentPlacings", "isGrandFinalMatch", "applyTournamentWithdrawals"];
const PMCLib = { chips: Object.assign({}, require(path.join(LIB, "chips.js"))) };
// (every pairing the engine makes, with the line as it was)
const pairings = [];
const nextChipPair = PMCLib.chips.nextChipPair;
PMCLib.chips.nextChipPair = (state) => {
  const pair = nextChipPair(state);
  if (pair) pairings.push({ line: state.line.slice(), pair, rematch: (state.lastOpponent || {})[pair[0]] === pair[1] });
  return pair;
};
const RATINGS = {};
const F = new Function("PMCLib", "RATINGS",
  "var __n = 0; function uid() { return 'm' + ++__n; }\n" +
  "var networkMode = '';\n" +
  "function T(k) { return k; }\n" +
  "function loadChipChart() { return JSON.parse(JSON.stringify(PMCLib.chips.DEFAULT_CHIP_CHART)); }\n" +
  "function averageRating(names) { return names.reduce(function (s, n) { return s + (RATINGS[n] || 400); }, 0) / names.length; }\n" +
  "function getPlayerRating(n) { return RATINGS[n] || 400; }\n" +
  NAMES.map(extract).join("\n") + "\nreturn {" + NAMES.join(",") + "};")(PMCLib, RATINGS);

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }

const names = ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay", "Gus", "Hal", "Ivy", "Jon", "Kit", "Lou"];
// three bands: 4 under 400, 3 under 550, 2 above
names.forEach((n, i) => { RATINGS[n] = 320 + i * 30; });
const t = F.buildChipTournament(names, "8ball", 1, 1, false, names, null);
t.tableCount = 3;
check("chips by rating, the default chart: " + names.map((n) => n + " " + t.chips[n]).join(", "), names.every((n) => t.chips[n] === (RATINGS[n] <= 399 ? 4 : RATINGS[n] <= 549 ? 3 : 2)), t.chips);
const startTotal = Object.values(t.chips).reduce((a, b) => a + b, 0);

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
let games = 0, maxLive = 0, doubleBooked = 0, chipErrors = [], idleWhileFree = 0, played0 = [];
const tablesUsed = {};
const lastOpp = {};
const outOrder = [];
F.autoAssignTables(t);
while (!t.champion && games < 400) {
  maxLive = Math.max(maxLive, t.activeMatches.length);
  const seen = {};
  t.activeMatches.forEach((a) => { const m = F.findBracketMatchById(t, a.matchId); [m.a, m.b].forEach((n) => { if (seen[n]) doubleBooked++; seen[n] = true; }); tablesUsed[a.table] = true; });
  // a free table, two who could play: someone waiting while a table's free
  const free = 3 - t.activeMatches.length;
  if (free > 0 && t.line.length >= 2) idleWhileFree++;
  // finish a random live game, a random winner
  const a = t.activeMatches[Math.floor(rnd() * t.activeMatches.length)];
  const m = F.findBracketMatchById(t, a.matchId);
  [m.a, m.b].forEach((n) => { if (!(t.chips[n] > 0)) played0.push(n); });
  const winner = rnd() < 0.5 ? m.a : m.b, loser = winner === m.a ? m.b : m.a;
  const before = Object.assign({}, t.chips);
  F.reportBracketResult(t, m, winner, winner === m.a ? 1 : 0, winner === m.b ? 1 : 0);
  t.activeMatches.splice(t.activeMatches.indexOf(a), 1);
  games++;
  if (t.chips[loser] !== before[loser] - 1 || t.chips[winner] !== before[winner]) chipErrors.push({ game: games, winner, loser, before: before[loser], after: t.chips[loser] });
  if (t.chips[loser] === 0) outOrder.push(loser);
  lastOpp[m.a] = m.b; lastOpp[m.b] = m.a;
  F.autoAssignTables(t);
}
const endTotal = Object.values(t.chips).reduce((a, b) => a + b, 0);
check("12 players, 3 tables: played to one player with chips (" + games + " games, " + t.champion + ")", !!t.champion && Object.keys(t.chips).filter((n) => t.chips[n] > 0).length === 1 && t.championNames.join() === t.champion);
check("...every game cost its loser exactly one chip (" + startTotal + " chips -> " + endTotal + " in " + games + " games), the winner none", chipErrors.length === 0 && startTotal - endTotal === games, chipErrors.slice(0, 3));
check("...never more than 3 games live (" + maxLive + "), every table used, nobody on two tables at once", maxLive === 3 && Object.keys(tablesUsed).length === 3 && doubleBooked === 0, { maxLive, tablesUsed, doubleBooked });
check("...nobody waiting while a table was free and two could play", idleWhileFree === 0, idleWhileFree);
check("...nobody played with 0 chips; out is out", played0.length === 0 && outOrder.every((n) => t.chips[n] === 0 && t.line.indexOf(n) === -1), { played0 });
const rematches = pairings.filter((p) => p.rematch);
check("...no immediate rematch while someone else was in the line (" + pairings.length + " pairings, " + rematches.length + " rematches - only the two of them waiting)", rematches.every((p) => p.line.length === 2), rematches.filter((p) => p.line.length !== 2).slice(0, 3));
const pl = F.tournamentPlacings(t);
check("...placings: the champion 1st, the last out 2nd ... the first out 12th", pl.length === 12 && pl[0].names[0] === t.champion && pl[1].names[0] === outOrder[outOrder.length - 1] && pl[11].names[0] === outOrder[0] && pl.every((g, i) => g.place === i + 1), pl);
check("...nothing left to play, the line empty", F.pendingBracketMatches(t).length === 0 && t.line.length === 0 && t.activeMatches.length === 0);

// withdrawal while waiting; a late player
const u = F.buildChipTournament(["Ann", "Ben", "Cat", "Dan", "Eve"], "8ball", 1, 1, false, ["Ann", "Ben", "Cat", "Dan", "Eve"], null);
u.tableCount = 2;
F.autoAssignTables(u);
const waiting = u.line[0];
u.withdrawn = { [waiting]: true };
F.applyTournamentWithdrawals(u);
check("a withdrawal while waiting (" + waiting + "): out at once - no chips, not in line", u.chips[waiting] === 0 && u.line.indexOf(waiting) === -1 && u.bustOrder.indexOf(waiting) !== -1, { chips: u.chips, line: u.line });
RATINGS.Zed = 700;
u.players.push("Zed");
PMCLib.chips.addChipPlayer(u, "Zed", PMCLib.chips.chipsForRating(u.chipChart, RATINGS.Zed));
check("a late player (rating 700): 2 chips, at the back of the line", u.chips.Zed === 2 && u.line[u.line.length - 1] === "Zed", { chips: u.chips, line: u.line });
// a withdrawn player's game coming up: their opponent goes through, the withdrawn player out
const v = F.buildChipTournament(["Ann", "Ben", "Cat"], "8ball", 1, 1, false, ["Ann", "Ben", "Cat"], null);
v.tableCount = 1;
const g1 = F.pendingBracketMatches(v)[0];
v.withdrawn = { [g1.a]: true };
F.applyTournamentWithdrawals(v);
check("a withdrawn player's waiting game: a walkover - " + g1.a + " out with every chip, " + g1.b + " back in line", g1.winner === g1.b && v.chips[g1.a] === 0 && v.line.indexOf(g1.b) !== -1, { g1, chips: v.chips, line: v.line });

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
