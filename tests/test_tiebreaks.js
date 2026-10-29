// Round robin and Swiss tie-breaks (P20), the real functions pulled out of js/app.js:
// - level on match wins: head-to-head, then rack difference, then racks won - each split starting
//   over with head-to-head for whoever is still level;
// - a three-way circle (A>B, B>C, C>A) decided by rack difference, then head-to-head for the two
//   still level;
// - still level: a shared place; at the top, a playoff is asked for (no champion yet) - played, it
//   decides; or the title is shared;
// - a bye counts as a win with no racks;
// - placings "1st", "2nd", "3rd–4th" from the standings, a playoff ordering the players it was for;
// - winners-bracket round names by distance from the final: 9 players open with a Round of 16.
// usage: node tests/test_tiebreaks.js
const fs = require("fs");
const path = require("path");
// (js/lib/ first - the pure functions live there now - then js/app.js)
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
const NAMES = ["createBracketMatch", "tournamentRecords", "rankWithTieBreaks", "roundRobinStandings", "swissStandings", "settleTournamentChampion",
  "finalizeRoundRobinIfComplete", "startTournamentPlayoff", "finalizeTournamentPlayoff", "shareTournamentTitle", "groupPlacings", "tournamentPlacings",
  "allBracketMatches", "placeOrdinal", "placingLabel", "wbRoundLabel"];
const EN = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "languages", "english.json"), "utf8"));
const F = new Function("EN",
  "var __n = 0; function uid() { return 'm' + ++__n; }\n" +
  "var activeLanguageCode = 'english';\n" +
  "function T(key, vars) { var s = EN[key] !== undefined ? EN[key] : key; Object.keys(vars || {}).forEach(function (k) { s = s.split('{{' + k + '}}').join(vars[k]); }); return s; }\n" +
  NAMES.map(extract).join("\n") + "\nreturn {" + NAMES.join(",") + "};")(EN);

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const m = (a, b, winner, sa, sb) => ({ a, b, winner, loser: winner === a ? b : a, scoreA: sa, scoreB: sb });
const order = (rows) => rows.map((r) => (r.shared ? "=" : "") + r.place + r.name).join(" ");

// head-to-head between two on equal wins
let r = F.rankWithTieBreaks(["Ann", "Ben", "Cat"], [m("Ann", "Ben", "Ben", 1, 3), m("Ann", "Cat", "Ann", 3, 0), m("Ben", "Cat", "Cat", 0, 3)]);
// Ann 1-1 (racks 4-3), Ben 1-1 (3-4), Cat 1-1 (3-3): all level on wins, h2h 1 each, diff Ann +1, Cat 0, Ben -1
check("three level on wins, a circle: rack difference orders them (Ann +1, Cat 0, Ben −1)", order(r) === "1Ann 2Cat 3Ben", order(r));
r = F.rankWithTieBreaks(["Ann", "Ben", "Cat", "Dan"], [
  m("Ann", "Ben", "Ann", 3, 2), m("Cat", "Dan", "Cat", 3, 0), m("Ann", "Cat", "Cat", 0, 3), m("Ben", "Dan", "Ben", 3, 0), m("Ann", "Dan", "Ann", 3, 0), m("Ben", "Cat", "Cat", 0, 3)]);
check("Cat 3 wins first; Ann and Ben on 1... Ann 2 wins, Ben 1, Dan 0 - plain wins", order(r) === "1Cat 2Ann 3Ben 4Dan", order(r));
r = F.rankWithTieBreaks(["Ann", "Ben", "Cat"], [m("Ann", "Ben", "Ben", 2, 3), m("Ann", "Cat", "Ann", 3, 0), m("Ben", "Cat", "Cat", 0, 3), m("Ann", "Ben", "Ann", 3, 2)]);
// a double round between Ann and Ben: 1 each; Ann's rack difference +3 beats Ben's −3... (Ann 8-5, Ben 5-8, Cat 3-3)
check("level, head-to-head level too: rack difference", r[0].name === "Ann" && r[0].wins === 2 && !r[0].shared, order(r));
// head-to-head beats a better rack difference
r = F.rankWithTieBreaks(["Ann", "Ben", "Cat", "Dan"], [
  m("Ann", "Ben", "Ben", 2, 3), m("Ann", "Cat", "Ann", 3, 0), m("Ann", "Dan", "Ann", 3, 0),
  m("Ben", "Cat", "Cat", 2, 3), m("Ben", "Dan", "Ben", 3, 2), m("Cat", "Dan", "Dan", 2, 3)]);
// Ann 2 (8-3, +5), Ben 2 (8-7, +1), Cat 1, Dan 1; Ben beat Ann head-to-head
check("two on 2 wins: head-to-head (Ben beat Ann) before rack difference (Ann +5, Ben +1)", r[0].name === "Ben" && r[1].name === "Ann", order(r));
// racks won after rack difference
r = F.rankWithTieBreaks(["Ann", "Ben", "Cat", "Dan"], [
  m("Ann", "Cat", "Ann", 5, 3), m("Ben", "Dan", "Ben", 3, 1), m("Ann", "Dan", "Dan", 4, 5), m("Ben", "Cat", "Cat", 1, 2)]);
// Ann 1-1 9-8 (+1), Ben 1-1 4-3 (+1), never met: racks won 9 v 4
check("same wins, never met, same rack difference: racks won (Ann 9, Ben 4)", r.findIndex((x) => x.name === "Ann") < r.findIndex((x) => x.name === "Ben") && r.find((x) => x.name === "Ann").place !== r.find((x) => x.name === "Ben").place, order(r));
// fully level: shared place
r = F.rankWithTieBreaks(["Ann", "Ben", "Cat", "Dan"], [m("Ann", "Cat", "Ann", 3, 1), m("Ben", "Dan", "Ben", 3, 1)]);
check("fully level (same wins, never met, same racks): a shared place", r[0].place === 1 && r[1].place === 1 && r[0].shared && r[1].shared && r[2].place === 3 && r[2].shared, order(r));
// a bye: a win, no racks
r = F.rankWithTieBreaks(["Ann", "Ben", "Cat"], [m("Ann", null, "Ann"), m("Ben", "Cat", "Ben", 3, 2)]);
check("a bye is a win with no racks (Ann 1 win 0-0, Ben 1 win 3-2): Ben ahead on rack difference", r[0].name === "Ben" && r[1].name === "Ann" && r[1].racksFor === 0 && r[1].wins === 1, r);

// the playoff
const rr = { format: "roundrobin", players: ["Ann", "Ben", "Cat"], matches: [m("Ann", "Ben", "Ann", 3, 1), m("Ben", "Cat", "Ben", 3, 1), m("Cat", "Ann", "Cat", 3, 1)], champion: null, championNames: null };
F.finalizeRoundRobinIfComplete(rr);
check("a round robin ending level at the top after every tie-break: no champion yet, a playoff asked for the three", !rr.champion && JSON.stringify(rr.playoffPending) === JSON.stringify(["Ann", "Ben", "Cat"]), rr);
F.startTournamentPlayoff(rr);
check("...the playoff: everyone tied plays everyone else tied once (3 matches), and they're the event's open matches", rr.playoff && rr.playoff.matches.length === 3 && F.allBracketMatches(rr).length === 6, rr.playoff);
rr.playoff.matches.forEach((pm) => { pm.winner = pm.a === "Ben" || pm.b === "Ben" ? "Ben" : pm.a; pm.scoreA = pm.winner === pm.a ? 3 : 0; pm.scoreB = pm.winner === pm.b ? 3 : 0; });
F.finalizeTournamentPlayoff(rr);
check("...Ben wins both playoff matches: Ben is champion", rr.champion === "Ben" && JSON.stringify(rr.championNames) === '["Ben"]', rr);
const pl = F.tournamentPlacings(rr);
check("...the placings follow the playoff: 1st Ben, 2nd and 3rd from it", pl[0].names.join() === "Ben" && pl.length === 3 && pl[1].place === 2, pl);
const two = { format: "roundrobin", players: ["Ann", "Ben"], matches: [], playoffPending: ["Ann", "Ben"] };
F.shareTournamentTitle(two);
check("share the title: both champions", JSON.stringify(two.championNames) === '["Ann","Ben"]' && two.champion === "Ann & Ben" && !two.playoffPending, two);
const swiss = { format: "swiss", players: ["Ann", "Ben", "Cat", "Dan"], rounds: [[m("Ann", "Ben", "Ann", 3, 0), m("Cat", "Dan", "Cat", 3, 0)], [m("Ann", "Cat", "Ann", 3, 2), m("Ben", "Dan", "Ben", 3, 1)]] };
check("Swiss standings: wins, then the tie-breaks (Ann 2, Cat 1 +4, Ben 1 −2, Dan 0)", order(F.swissStandings(swiss)) === "1Ann 2Cat 3Ben 4Dan", order(F.swissStandings(swiss)));

// placings and labels
const shared = F.groupPlacings([{ name: "A", place: 1 }, { name: "B", place: 2 }, { name: "C", place: 3 }, { name: "D", place: 3 }]);
check("placings: \"1st\", \"2nd\", \"3rd–4th\"", shared.map(F.placingLabel).join("|") === "1st|2nd|3rd–4th", shared.map(F.placingLabel));
check("ordinals: 11th, 12th, 13th, 21st, 22nd", [11, 12, 13, 21, 22].map(F.placeOrdinal).join(",") === "11th,12th,13th,21st,22nd", [11, 12, 13, 21, 22].map(F.placeOrdinal));
const draw16 = { wb: [new Array(8), new Array(4), new Array(2), new Array(1)] };
check("9 players (a 16 draw): Round of 16, Quarterfinal, Semifinal, Final", [0, 1, 2, 3].map((ri) => F.wbRoundLabel(draw16, ri)).join("|") === [EN["tournament.roundOfN"].replace("{{n}}", "16"), EN["tournament.roundQuarterfinal"], EN["tournament.roundSemifinal"], EN["tournament.roundFinal"]].join("|"), [0, 1, 2, 3].map((ri) => F.wbRoundLabel(draw16, ri)));
const oldDraw = { wb: [new Array(5), new Array(2), new Array(1)] };
check("an older 9-player bracket without its byes (5 matches in round 1): \"Quarterfinal\", not \"Round of 10\"", F.wbRoundLabel(oldDraw, 0) === EN["tournament.roundQuarterfinal"], F.wbRoundLabel(oldDraw, 0));

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
