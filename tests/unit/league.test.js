// League standings and merging (js/lib/league.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../js/lib/league.js");
const clone = (x) => JSON.parse(JSON.stringify(x));
const member = (name) => ({ name, skillLevel: 5, matchesPlayed: 0, matchesWon: 0, leaguePoints: 0 });
let n = 0;
const match = (a, b, winner, pa, pb, extra) => Object.assign({ id: "m" + ++n, ts: "2026-10-2" + (n % 9) + "T20:00:00.000Z", playerA: a, playerB: b, winner, leaguePointsA: pa, leaguePointsB: pb, season: 1, week: 1 }, extra || {});
const table = (l) => l.members.map((m) => m.name + ":" + m.matchesWon + "-" + (m.matchesPlayed - m.matchesWon) + "/" + m.leaguePoints).sort().join(" ");
const base = () => { const l = { id: "x", members: ["Ann", "Ben", "Cat"].map(member), matches: [match("Ann", "Ben", "Ann", 2, 0), match("Ben", "Cat", "Cat", 0, 2)], teams: [], deletedMatchIds: [] }; L.recomputeLeagueStandings(l); return l; };

test("standings are the sum of the matches", () => {
  assert.equal(table(base()), "Ann:1-0/2 Ben:0-2/0 Cat:1-0/2");
});
test("deleting a match and recomputing takes it out of the standings", () => {
  const l = base();
  l.matches.pop();
  L.recomputeLeagueStandings(l);
  assert.equal(table(l), "Ann:1-0/2 Ben:0-1/0 Cat:0-0/0");
});
test("merging another device's copy adds its new matches", () => {
  const a = base(), b = clone(a);
  b.matches.push(match("Ann", "Cat", "Ann", 2, 0));
  const added = L.mergeLeagueInto(a, b);
  assert.equal(added.length, 1);
  assert.equal(a.matches.length, 3);
});
test("merging the same copy twice changes nothing the second time", () => {
  const a = base(), b = clone(a);
  b.matches.push(match("Ann", "Cat", "Ann", 2, 0));
  L.mergeLeagueInto(a, clone(b));
  const before = table(a);
  assert.equal(L.mergeLeagueInto(a, clone(b)).length, 0);
  assert.equal(table(a), before);
});
test("a match deleted on one device stays deleted after a merge", () => {
  const a = base(), b = clone(a);
  const gone = a.matches[0].id;
  a.deletedMatchIds.push(gone);
  a.matches = a.matches.filter((m) => m.id !== gone);
  L.recomputeLeagueStandings(a);
  L.mergeLeagueInto(a, b);
  assert.ok(!a.matches.some((m) => m.id === gone));
});
test("the later edit of a match wins", () => {
  const a = base(), b = clone(a);
  Object.assign(b.matches[1], { winner: "Ben", leaguePointsA: 2, leaguePointsB: 0, editedAt: "2026-10-30T10:00:00.000Z" });
  L.mergeLeagueInto(a, b);
  assert.equal(a.matches.find((m) => m.id === b.matches[1].id).winner, "Ben");
});
test("merging either way round ends with the same standings", () => {
  const a = base(), b = clone(a);
  a.matches.push(match("Ann", "Cat", "Cat", 0, 2));
  b.matches.push(match("Ben", "Ann", "Ben", 2, 0));
  L.recomputeLeagueStandings(a); L.recomputeLeagueStandings(b);
  const ab = clone(a), ba = clone(b);
  L.mergeLeagueInto(ab, clone(b)); L.mergeLeagueInto(ba, clone(a));
  assert.equal(table(ab), table(ba));
});
test("an older league's counts are kept as a baseline, new matches add to them", () => {
  const old = { id: "o", members: [Object.assign(member("Ann"), { matchesPlayed: 4, matchesWon: 3, leaguePoints: 6 }), Object.assign(member("Ben"), { matchesPlayed: 4, matchesWon: 1, leaguePoints: 2 })], matches: [], teams: [] };
  L.takeLeagueStandingsBaseline(old);
  old.matches.push(match("Ben", "Ann", "Ben", 2, 0));
  L.recomputeLeagueStandings(old);
  assert.equal(table(old), "Ann:3-2/6 Ben:2-3/4");
});
test("a season's standings count only that season", () => {
  const l = base();
  l.matches.push(match("Ann", "Ben", "Ben", 0, 2, { season: 2 }));
  const s2 = L.leagueSeasonRows(l, 2);
  assert.deepEqual(s2.map((m) => m.name + ":" + m.matchesWon + "-" + (m.matchesPlayed - m.matchesWon)).sort(), ["Ann:0-1", "Ben:1-0", "Cat:0-0"]);
});
test("a team's points are its members' points", () => {
  const l = base();
  l.teams = [{ id: "t1", name: "Sharks", memberNames: ["Ann", "Cat"] }];
  const t = L.leagueTeamRows(l, l.members).find((x) => x.name === "Sharks");
  assert.equal(t.points, 4);
  assert.equal(L.leagueTeamForMember(l, "Cat").name, "Sharks");
});
