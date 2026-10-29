// League nights across devices (P23), the real functions pulled out of js/app.js:
// - standings are the sum of the match list: an edit or a delete just recomputes;
// - two devices start from the same league and diverge (one adds a match, deletes one and edits
//   another; the other adds two): merging either into the other ends with the same matches and
//   identical standings, whichever way round; the deleted match stays deleted; the later edit
//   wins; a second import of the same file changes nothing;
// - a league saved before every match was kept: its counts are taken as a baseline once, so
//   nothing is lost, and new matches add to them;
// - a season's standings count only that season; teams' standings add up their members.
// usage: node tests/test_league_merge.js
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
const NAMES = ["leagueMatchSums", "takeLeagueStandingsBaseline", "recomputeLeagueStandings", "leagueSeasonRows", "leagueTeamRows", "leagueTeamForMember", "mergeLeagueInto"];
const F = new Function(NAMES.map(extract).join("\n") + "\nreturn {" + NAMES.join(",") + "};")();

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const clone = (x) => JSON.parse(JSON.stringify(x));
const member = (name) => ({ name, skillLevel: 5, matchesPlayed: 0, matchesWon: 0, leaguePoints: 0 });
let n = 0;
const match = (a, b, winner, ptsA, ptsB, extra) => Object.assign({ id: "m" + ++n, ts: "2026-10-2" + n + "T20:00:00.000Z", playerA: a, playerB: b, winner, leaguePointsA: ptsA, leaguePointsB: ptsB, scoreA: winner === a ? 5 : 2, scoreB: winner === b ? 5 : 2, season: 1, week: 1 }, extra || {});
const table = (l) => l.members.map((m) => m.name + ":" + m.matchesWon + "-" + (m.matchesPlayed - m.matchesWon) + "/" + m.leaguePoints).sort().join(" ");

// the league both devices start from
const L0 = { id: "league-x", members: ["Ann", "Ben", "Cat", "Dan"].map(member), matches: [match("Ann", "Ben", "Ann", 2, 0), match("Cat", "Dan", "Dan", 1, 2)], teams: [{ id: "t1", name: "Sharks", memberNames: ["Ann", "Cat"] }, { id: "t2", name: "Jets", memberNames: ["Ben", "Dan"] }], deletedMatchIds: [], season: 1, week: 1 };
F.recomputeLeagueStandings(L0);
check("standings are the sum of the matches (Ann 1-0/2, Ben 0-1/0, Cat 0-1/1, Dan 1-0/2)", table(L0) === "Ann:1-0/2 Ben:0-1/0 Cat:0-1/1 Dan:1-0/2", table(L0));

// device X: adds a match, deletes m1 (Ann v Ben), edits m2 (Cat v Dan: now Cat won)
const X = clone(L0);
X.matches.push(match("Ann", "Cat", "Cat", 0, 3, { week: 2 }));
X.deletedMatchIds.push(X.matches[0].id);
X.matches = X.matches.filter((m) => m.id !== X.deletedMatchIds[0]);
const m2 = X.matches.find((m) => m.playerA === "Cat" && m.playerB === "Dan");
Object.assign(m2, { winner: "Cat", leaguePointsA: 3, leaguePointsB: 0, editedAt: "2026-10-29T21:00:00.000Z", edited: true });
F.recomputeLeagueStandings(X);
// device Y: adds two
const Y = clone(L0);
Y.matches.push(match("Ben", "Dan", "Ben", 2, 1, { week: 2 }), match("Ann", "Dan", "Dan", 0, 2, { week: 2 }));
F.recomputeLeagueStandings(Y);

const XY = clone(X), YX = clone(Y);
const addedToX = F.mergeLeagueInto(XY, clone(Y));
const addedToY = F.mergeLeagueInto(YX, clone(X));
const ids = (l) => l.matches.map((m) => m.id).sort().join();
check("X merges Y and Y merges X: the same matches either way (" + ids(XY) + ")", ids(XY) === ids(YX) && XY.matches.length === 4, { XY: ids(XY), YX: ids(YX) });
check("...identical standings either way: " + table(XY), table(XY) === table(YX), { XY: table(XY), YX: table(YX) });
check("...the match X deleted stays deleted on both", !XY.matches.some((m) => m.id === L0.matches[0].id) && !YX.matches.some((m) => m.id === L0.matches[0].id));
check("...the later edit wins (Cat beat Dan, on both)", XY.matches.find((m) => m.id === m2.id).winner === "Cat" && YX.matches.find((m) => m.id === m2.id).winner === "Cat");
check("...each side is told which matches were new to it (X: 2, Y: 1)", addedToX.length === 2 && addedToY.length === 1, { x: addedToX.map((m) => m.id), y: addedToY.map((m) => m.id) });
const again = clone(XY);
const addedAgain = F.mergeLeagueInto(again, clone(Y));
check("...importing the same file again changes nothing", addedAgain.length === 0 && table(again) === table(XY) && ids(again) === ids(XY));

// a league saved before every match was kept
const old = { id: "old", members: [Object.assign(member("Ann"), { matchesPlayed: 6, matchesWon: 4, leaguePoints: 9 }), Object.assign(member("Ben"), { matchesPlayed: 6, matchesWon: 2, leaguePoints: 4 })], matches: [match("Ann", "Ben", "Ann", 2, 0)], teams: [] };
F.takeLeagueStandingsBaseline(old);
F.recomputeLeagueStandings(old);
check("an older league (counts beyond its match list): the counts kept as a baseline (Ann 4-2/9, Ben 2-4/4)", table(old) === "Ann:4-2/9 Ben:2-4/4", table(old));
old.matches.push(match("Ann", "Ben", "Ben", 0, 2));
F.recomputeLeagueStandings(old);
check("...a new match adds to them (Ann 4-3/9, Ben 3-4/6)", table(old) === "Ann:4-3/9 Ben:3-4/6", table(old));

// seasons and teams
const S = clone(XY);
S.matches.push(match("Ann", "Ben", "Ann", 3, 0, { season: 2, week: 1 }));
F.recomputeLeagueStandings(S);
const s2 = F.leagueSeasonRows(S, 2);
check("season 2's standings count only season 2 (Ann 1-0/3, Ben 0-1/0, Cat and Dan nothing)", s2.map((m) => m.name + ":" + m.matchesWon + "-" + (m.matchesPlayed - m.matchesWon) + "/" + m.leaguePoints).sort().join(" ") === "Ann:1-0/3 Ben:0-1/0 Cat:0-0/0 Dan:0-0/0", s2);
const teams = F.leagueTeamRows(S, S.members);
const sum = (names) => S.members.filter((m) => names.includes(m.name)).reduce((a, m) => a + m.leaguePoints, 0);
check("teams' standings add up their members (Sharks " + teams.find((t) => t.name === "Sharks").points + ", Jets " + teams.find((t) => t.name === "Jets").points + ")", teams.find((t) => t.name === "Sharks").points === sum(["Ann", "Cat"]) && teams.find((t) => t.name === "Jets").points === sum(["Ben", "Dan"]), teams);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
