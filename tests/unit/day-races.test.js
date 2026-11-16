// 🏁 A day's races (js/lib/day-races.js): the day's racks put back together into the races they
// were played in - by the race kept with each rack (raceId), or, for older racks, by the score kept
// with it (raceTally) - so one can be reset (2026-11-16: "i need to reset the last race to as it
// was not rightly recorded").
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../js/lib/day-races.js");

// racks as the app keeps them, from 9 p.m. local on 2026-11-15, one every 10 minutes; the score
// after each (raceTally) worked out as the board does - each seated player's wins in the race -
// unless told (tally: false: an older rack with none)
function night() {
  let clock = new Date(2026, 10, 15, 21, 0).getTime();
  let wins = {};
  const racks = [];
  const rack = (w, l, o) => {
    o = o || {};
    clock += 10 * 60000;
    const winners = [].concat(w), losers = [].concat(l);
    if (o.fresh) wins = {};
    winners.forEach((n) => (wins[n] = (wins[n] || 0) + 1));
    const tally = {};
    winners.concat(losers).forEach((n) => (tally[n] = wins[n] || 0));
    const g = { ts: new Date(clock).toISOString(), gameLabel: "8-Ball", winnerNames: winners, opponentNames: losers, isTeam: winners.length > 1,
      raceTarget: o.race === undefined ? 7 : o.race, wonRace: !!o.won, raceInterrupted: o.stopped ? { by: "Luc", how: "lead" } : null,
      raceTally: o.tally === false ? null : tally, raceId: o.id || null };
    racks.push(g);
    if (o.won || o.stopped) wins = {};
    return g;
  };
  return { racks, rack, reset: () => (wins = {}), set: (w) => (wins = w) };
}
const shape = (races) => races.map((r) => ({ n: r.racks.length, end: r.end, winners: r.winners.join("&") }));

test("a race won, then the next one: two races, each its racks, its winner and its score", () => {
  const n = night();
  n.rack("Bob", "Luc", { race: 3 });
  n.rack("Luc", "Bob", { race: 3 });
  n.rack("Bob", "Luc", { race: 3 });
  n.rack("Bob", "Luc", { race: 3, won: true });
  n.rack("Chris", "Bob", { race: 3 });
  n.rack("Chris", "Bob", { race: 3 });
  const races = R.races(n.racks.slice().reverse());
  assert.deepEqual(shape(races), [{ n: 4, end: "won", winners: "Bob" }, { n: 2, end: null, winners: "" }]);
  assert.equal(races[0].raceTo, 3);
  assert.equal(races[0].from, n.racks[0].ts);
  assert.equal(races[0].to, n.racks[3].ts);
  assert.deepEqual(races[0].sides, [{ names: ["Bob"], wins: 3 }, { names: ["Luc"], wins: 1 }]);
});

test("Winner Stays: one race for the whole line, the loser out every rack", () => {
  const n = night();
  n.rack("Kim", "Jo");
  n.rack("Ann", "Kim");
  n.rack("Ann", "Bob");
  n.rack("Jo", "Ann");
  n.rack("Kim", "Jo");
  const races = R.races(n.racks);
  assert.equal(races.length, 1);
  assert.equal(races[0].racks.length, 5);
  assert.deepEqual(races[0].sides.map((s) => s.names[0] + " " + s.wins), ["Kim 2", "Ann 2", "Jo 1", "Bob 0"]);
});

test("⏹ stopped by hand, then ▶️ New game with the same two: the stopped race, and a new one", () => {
  const n = night();
  n.rack("Bob", "Chris");
  n.rack("Bob", "Luc");
  n.rack("Luc", "Bob", { stopped: true, won: true });
  n.rack("Chris", "Bob");
  n.rack("Bob", "Chris");
  assert.deepEqual(shape(R.races(n.racks)), [{ n: 3, end: "stopped", winners: "Luc" }, { n: 2, end: null, winners: "" }]);
});

test("a race left unfinished, a new one started: told apart by the score going back to 0", () => {
  const n = night();
  n.rack("Bob", "Chris");
  n.rack("Bob", "Chris");
  n.rack("Chris", "Bob", { fresh: true });
  n.rack("Chris", "Bob");
  const races = R.races(n.racks);
  assert.deepEqual(shape(races), [{ n: 2, end: null, winners: "" }, { n: 2, end: null, winners: "" }]);
  assert.deepEqual(races[1].sides, [{ names: ["Chris"], wins: 2 }, { names: ["Bob"], wins: 0 }]);
});

test("open play between two races ends the first one; it is in no race", () => {
  const n = night();
  n.rack("Bob", "Luc", { tally: false });
  n.rack("Bob", "Luc", { tally: false });
  n.rack("Luc", "Bob", { race: 1, tally: false });
  n.rack("Luc", "Bob", { tally: false });
  const races = R.races(n.racks);
  assert.deepEqual(races.map((r) => r.racks.length), [2, 1]);
});

test("older racks with no score: the race to tells them apart", () => {
  const n = night();
  n.rack("Bob", "Luc", { tally: false, race: 5 });
  n.rack("Bob", "Luc", { tally: false, race: 5 });
  n.rack("Bob", "Luc", { tally: false, race: 7 });
  assert.deepEqual(R.races(n.racks).map((r) => r.raceTo + ":" + r.racks.length), ["5:2", "7:1"]);
});

test("🏁 two races at once, racks in between each other: two races", () => {
  const n = night();
  const one = {}, two = {};
  const rackIn = (wins, w, l, o) => { n.set(wins); const g = n.rack(w, l, o); Object.assign(wins, g.raceTally); return g; };
  rackIn(one, "Kim", "Jo");
  rackIn(one, "Kim", "Jo");
  rackIn(two, "Ann", "Bob");
  rackIn(one, "Jo", "Kim");
  rackIn(two, "Ann", "Bob");
  rackIn(one, "Kim", "Jo", { race: 3, won: true });
  rackIn(two, "Bob", "Ann");
  const races = R.races(n.racks);
  assert.deepEqual(races.map((r) => r.racks.map((g) => g.winnerNames[0]).join(",")), ["Kim,Kim,Jo,Kim", "Ann,Ann,Bob"]);
  assert.equal(races[0].end, "won");
});

test("Winner Stays' max in a row: two new players in, then someone from before back - still one race", () => {
  const n = night();
  n.rack("Kim", "Jo");
  n.rack("Kim", "Ann");
  n.rack("Chris", "Dan"); // (Kim out after her max; Chris and Dan in, both new)
  n.rack("Chris", "Jo"); // Jo back: 0 wins - follows on from both
  n.rack("Kim", "Chris"); // Kim back with her 2: the two were one race
  const races = R.races(n.racks);
  assert.equal(races.length, 1);
  assert.equal(races[0].racks.length, 5);
  assert.deepEqual(races[0].racks.map((g) => g.ts), n.racks.map((g) => g.ts));
});

test("racks saved with their race (raceId): by it, exactly - open play the race carried on from too", () => {
  const n = night();
  const a = n.rack("Kim", "Jo", { race: 1, id: "A" }).ts;
  n.racks[0].raceId = a;
  n.rack("Kim", "Jo", { id: a });
  n.rack("Ann", "Bob", { id: "B", fresh: true });
  n.rack("Jo", "Kim", { id: a });
  n.rack("Kim", "Jo", { id: a, won: true });
  n.rack("Luc", "Bob", { race: 1, id: "C" }); // (open play only: no race)
  const races = R.races(n.racks);
  assert.deepEqual(races.map((r) => r.racks.length + (r.end || "")), ["4won", "1"]);
  assert.deepEqual(races[0].sides, [{ names: ["Kim"], wins: 3 }, { names: ["Jo"], wins: 1 }]);
});

test("teams: each side as a team", () => {
  const n = night();
  n.rack(["Luc", "Luigi"], ["Bob", "Suresh"]);
  n.rack(["Bob", "Suresh"], ["Luc", "Luigi"]);
  n.rack(["Luc", "Luigi"], ["Bob", "Suresh"], { race: 2, won: true });
  const races = R.races(n.racks);
  assert.deepEqual(races[0].sides, [{ names: ["Luc", "Luigi"], wins: 2 }, { names: ["Bob", "Suresh"], wins: 1 }]);
  assert.deepEqual(races[0].winners, ["Luc", "Luigi"]);
});

test("nothing, or nothing raced", () => {
  assert.deepEqual(R.races([]), []);
  assert.deepEqual(R.races(null), []);
  const n = night();
  n.rack("Bob", "Luc", { race: 1 });
  assert.deepEqual(R.races(n.racks), []);
});
