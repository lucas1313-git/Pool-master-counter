// A night as a sequence of matches (js/lib/night-timeline.js) - from games shaped like the app's:
// the open session's entries (state.gameHistory) and each player's saved copies (PLAYER_STATS).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const N = require("../../js/lib/night-timeline.js");

// a night starting at 7 p.m. local on 2026-11-08, a rack every `gap` minutes
function night() {
  const live = [];
  let clock = new Date(2026, 10, 8, 19, 0).getTime();
  const rack = (o) => {
    clock += (o.gap || 10) * 60000;
    const e = { ts: new Date(clock).toISOString(), gameType: o.gt || "8ball", gameLabel: o.gl || "8-Ball", target: o.target || 1, unit: o.unit || "rack", winnerNames: o.w, opponentNames: o.l, isTeam: !!o.team, rotatingTeams: !!o.team,
      durationMs: o.dur === undefined ? null : o.dur, wonRace: !!o.wonRace, raceTarget: o.race || 1, scores: o.scores || null, raceTally: o.tally || null, skunk: !!o.skunk, ballsLeftOnTable: o.bl === undefined ? null : o.bl };
    if (o.stop) e.raceInterrupted = { how: "stopped" };
    live.unshift(e); // (newest first, as the app keeps them)
    return e;
  };
  return { live, rack };
}
// every participant's own copy of a game, as exportAllPlayerStats files it: a loser's "opponents" are the winners
function copies(entries) {
  const ps = {};
  entries.forEach((e) => {
    e.winnerNames.concat(e.opponentNames).forEach((me) => {
      const won = e.winnerNames.includes(me), mine = won ? e.winnerNames : e.opponentNames;
      const g = Object.assign({}, e, { result: won ? "won" : "lost", opponentNames: won ? e.opponentNames : e.winnerNames, teammateNames: mine.filter((n) => n !== me) });
      ps[me] = ps[me] || { sessions: [{ date: "2026-11-08", games: [] }] };
      ps[me].sessions[0].games.push(g);
    });
  });
  return ps;
}
const ids = (side) => side.players.join("&");
const line = (m) => m.sides.map((s) => ids(s) + " " + s.score).join(" v ");

test("rotating partners, a rack each: who won, who came in, who sat down", () => {
  const n = night();
  n.rack({ w: ["Luc Martin", "Luigi"], l: ["Bob", "Chris"], team: 1, bl: 1 });
  n.rack({ w: ["Luc Martin", "Luigi"], l: ["Bob", "Batman"], team: 1 });
  n.rack({ w: ["Chris", "Batman"], l: ["Luc Martin", "Luigi"], team: 1, bl: 7, skunk: 1 });
  const r = N.build("2026-11-08", { gameHistory: n.live });
  assert.equal(r.matches.length, 3);
  assert.equal(r.rackCount, 3);
  assert.equal(line(r.matches[0]), "luc-martin&luigi 1 v bob&chris 0");
  assert.equal(r.matches[0].winner, 0);
  assert.equal(r.matches[0].ballsLeft, 1);
  assert.equal(r.matches[0].changes, null);
  assert.deepEqual(r.matches[1].changes.in, ["batman"]);
  assert.deepEqual(r.matches[1].changes.out, ["chris"]);
  assert.equal(r.matches[1].changes.winnerStayed, true);
  assert.equal(r.matches[2].skunk, true);
  assert.deepEqual(r.matches[2].changes.in, ["chris"]);
  assert.deepEqual(r.matches[2].changes.out, ["bob"]);
  assert.equal(r.matches[2].mode, "teams");
  assert.equal(r.matches[2].rotatingTeams, true);
});

test("players: a slug for an id, the first name when it tells everyone apart, a colour each, racks played and won", () => {
  const n = night();
  n.rack({ w: ["Luc Martin", "Luigi"], l: ["Bob Falche", "Bob Smith"], team: 1 });
  n.rack({ w: ["Luc Martin", "Luigi"], l: ["Bob Falche", "Bob Smith"], team: 1 });
  const r = N.build("2026-11-08", { gameHistory: n.live });
  const by = Object.fromEntries(r.players.map((p) => [p.id, p]));
  assert.equal(by["luc-martin"].short, "Luc");
  assert.equal(by["bob-falche"].short, "Bob Falche");
  assert.equal(by["bob-smith"].short, "Bob Smith");
  assert.equal(new Set(r.players.map((p) => p.color)).size, 4);
  assert.deepEqual([by["luc-martin"].played, by["luc-martin"].won, by["bob-smith"].played, by["bob-smith"].won], [2, 2, 2, 0]);
});

test("the same sides again with no race set: one match, 2-0 - or a match each when asked", () => {
  const n = night();
  n.rack({ w: ["Ana", "Kim"], l: ["Jo", "Al"], team: 1 });
  n.rack({ w: ["Ana", "Kim"], l: ["Jo", "Al"], team: 1 });
  n.rack({ w: ["Jo", "Al"], l: ["Ana", "Kim"], team: 1 });
  const merged = N.build("2026-11-08", { gameHistory: n.live });
  assert.equal(merged.matches.length, 1);
  assert.equal(line(merged.matches[0]), "ana&kim 2 v jo&al 1");
  assert.deepEqual(merged.matches[0].racks.map((k) => k.winner), [0, 0, 1]);
  assert.equal(N.build("2026-11-08", { gameHistory: n.live }, { mergeOpenPlay: false }).matches.length, 3);
});

test("a change of game is a new match", () => {
  const n = night();
  n.rack({ w: ["Ana", "Kim"], l: ["Jo", "Al"], team: 1 });
  n.rack({ w: ["Ana", "Kim"], l: ["Jo", "Al"], team: 1, gt: "9ball", gl: "9-Ball" });
  const r = N.build("2026-11-08", { gameHistory: n.live });
  assert.deepEqual(r.matches.map((m) => m.game), ["8-Ball", "9-Ball"]);
});

test("one against one, a race to 3: 3-1, its racks, the times when the first shot was timed", () => {
  const n = night();
  n.rack({ w: ["Kim"], l: ["Ana"], gt: "9ball", gl: "9-Ball", race: 3, dur: 300000, tally: { Kim: 1, Ana: 0 } });
  n.rack({ w: ["Ana"], l: ["Kim"], gt: "9ball", gl: "9-Ball", race: 3, dur: 300000, tally: { Kim: 1, Ana: 1 } });
  n.rack({ w: ["Kim"], l: ["Ana"], gt: "9ball", gl: "9-Ball", race: 3, dur: 300000, tally: { Kim: 2, Ana: 1 } });
  n.rack({ w: ["Kim"], l: ["Ana"], gt: "9ball", gl: "9-Ball", race: 3, dur: 300000, tally: { Kim: 3, Ana: 1 }, wonRace: 1 });
  n.rack({ w: ["Ana"], l: ["Kim"], gt: "9ball", gl: "9-Ball", race: 3, tally: { Kim: 0, Ana: 1 } }); // the next race: its own match
  const r = N.build("2026-11-08", { gameHistory: n.live });
  assert.equal(r.matches.length, 2);
  const m = r.matches[0];
  assert.equal(line(m), "kim 3 v ana 1");
  assert.equal(m.raceTo, 3);
  assert.equal(m.finished, true);
  assert.equal(m.mode, "individual");
  assert.equal(m.racks.length, 4);
  assert.equal(m.startEstimated, false);
  assert.equal(m.startedAt.slice(11, 16), "19:05"); // 19:10, less the 5 minutes it lasted
  assert.equal(m.endedAt.slice(11, 16), "19:40");
  assert.equal(m.sides[0].board, 3);
  assert.equal(r.matches[1].finished, false);
});

test("no timed first shot: the start is the match before's end, said so - and unknown for the first", () => {
  const n = night();
  n.rack({ w: ["Ana"], l: ["Kim"] });
  n.rack({ w: ["Jo"], l: ["Ana"] });
  const r = N.build("2026-11-08", { gameHistory: n.live });
  assert.equal(r.matches[0].startedAt, null);
  assert.equal(r.matches[0].startEstimated, true);
  assert.equal(r.matches[1].startedAt, r.matches[0].endedAt);
  assert.equal(r.matches[1].startEstimated, true);
});

test("a race stopped level has no winner", () => {
  const n = night();
  n.rack({ w: ["Al"], l: ["Jo"], race: 5 });
  n.rack({ w: ["Jo"], l: ["Al"], race: 5, stop: 1 });
  const m = N.build("2026-11-08", { gameHistory: n.live }).matches[0];
  assert.equal(m.winner, null);
  assert.equal(m.stoppedEarly, true);
  assert.equal(line(m), "al 1 v jo 1");
});

test("partners switched: two who stay, together before and apart now", () => {
  const n = night();
  n.rack({ w: ["Bob", "Luigi"], l: ["Luc", "Chris"], team: 1 });
  n.rack({ w: ["Chris", "Luigi"], l: ["Luc", "Batman"], team: 1 }); // Bob out, Batman in - and Luc and Chris split
  n.rack({ w: ["Chris", "Luigi"], l: ["Bob", "Luc"], team: 1 });    // Batman out, Bob in - nobody who stays changed partner
  const r = N.build("2026-11-08", { gameHistory: n.live });
  assert.equal(r.matches[1].changes.partnersSwitched, true);
  assert.equal(r.matches[2].changes.partnersSwitched, false);
});

test("three players, each for themselves, on points", () => {
  const n = night();
  n.rack({ w: ["Su"], l: ["Ana", "Kim"], gt: "15ballrotation", gl: "15 Ball Rotation", unit: "points", target: 61, scores: { Su: 61, Ana: 40, Kim: 19 } });
  const m = N.build("2026-11-08", { gameHistory: n.live }).matches[0];
  assert.equal(m.freeForAll, true);
  assert.equal(m.sides.length, 3);
  assert.deepEqual(m.sides.map((s) => s.points), [61, 40, 19]);
  assert.equal(m.winner, 0);
});

test("saved copies: one rack per time, the losing side from a loser's copy when no winner's is left", () => {
  const n = night();
  const a = n.rack({ w: ["Luc", "Luigi"], l: ["Bob", "Chris"], team: 1 });
  n.rack({ w: ["Chris", "Batman"], l: ["Luc", "Luigi"], team: 1 });
  const ps = copies(n.live);
  ["Luc", "Luigi"].forEach((w) => { ps[w].sessions[0].games = ps[w].sessions[0].games.filter((g) => g.ts !== a.ts); });
  const r = N.build("2026-11-08", { playerStats: ps });
  assert.equal(r.rackCount, 2);
  // (a loser's copy names its owner first: the side's order is that copy's)
  assert.deepEqual(r.matches[0].sides.map((s) => s.players.slice().sort().join("&") + " " + s.score), ["luc&luigi 1", "bob&chris 0"]);
  assert.equal(line(r.matches[1]), "chris&batman 1 v luc&luigi 0");
  assert.equal(r.warnings.length, 0);
});

test("saved and still open: a game in both is one game - also when the open entry carries another time", () => {
  const n = night();
  n.rack({ w: ["Luc", "Luigi"], l: ["Bob", "Chris"], team: 1 });
  const last = n.rack({ w: ["Chris", "Luigi"], l: ["Bob", "Batman"], team: 1 });
  const ps = copies(n.live);
  // (seen on a real night: the last rack filed at 5:00 p.m., its open entry stamped 8:02 p.m.)
  const again = Object.assign({}, last, { ts: new Date(Date.parse(last.ts) + 182 * 60000).toISOString() });
  const r = N.build("2026-11-08", { playerStats: ps, gameHistory: [again, n.live[1]] });
  assert.equal(r.rackCount, 2);
  assert.equal(r.matches.length, 2);
  // ...but a real second win by the same sides, filed nowhere yet, counts
  const more = N.build("2026-11-08", { playerStats: ps, gameHistory: [Object.assign({}, again, { ts: new Date(Date.parse(again.ts) + 60000).toISOString() }), again] });
  assert.equal(more.rackCount, 3);
});

test("the pool day: a rack after midnight is the evening's; another day's games stay out", () => {
  const n = night();
  n.rack({ w: ["Ana"], l: ["Kim"] });
  n.rack({ w: ["Kim"], l: ["Ana"], gap: 400 });      // 1:50 a.m. - still the 8th
  n.rack({ w: ["Jo"], l: ["Al"], gap: 24 * 60 });    // the 9th's night
  assert.equal(N.build("2026-11-08", { gameHistory: n.live }).rackCount, 2);
  assert.equal(N.build("2026-11-09", { gameHistory: n.live }).rackCount, 1);
  assert.deepEqual(N.days({ gameHistory: n.live }).map((d) => d.day), ["2026-11-09", "2026-11-08"]);
});

test("a day with no games: no players, no matches", () => {
  const r = N.build("2026-11-08", {});
  assert.deepEqual([r.players.length, r.matches.length, r.rackCount], [0, 0, 0]);
});

test("the game's name through the app's own labels, and the day's note", () => {
  const n = night();
  n.rack({ w: ["Ana"], l: ["Kim"] });
  const r = N.build("2026-11-08", { gameHistory: n.live, dayNotes: { "2026-11-08": "Good pool." } }, { gameLabel: (type, label) => type === "8ball" ? "Bola 8" : label });
  assert.equal(r.matches[0].game, "Bola 8");
  assert.equal(r.note, "Good pool.");
});
