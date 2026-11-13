// 🏆 The winning shots of a recording (js/lib/winning-shots.js): every game won while it ran, named
// "winning shot [player] vs [player]-[game]-[score]", and its 30-second clip.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const W = require("../../js/lib/winning-shots.js");

// games as the app keeps them (state.gameHistory, newest first), from 7 p.m. local on 2026-11-12
function night(startHour) {
  const live = [];
  let clock = new Date(2026, 10, 12, startHour === undefined ? 19 : startHour, 0).getTime();
  const rack = (o) => {
    clock += (o.gap || 10) * 60000;
    live.unshift({ ts: new Date(clock).toISOString(), gameType: o.gt || "8ball", gameLabel: o.gl || "8-Ball", target: o.target || 1, unit: o.unit || "rack", winnerNames: o.w, opponentNames: o.l,
      isTeam: !!o.team, wonRace: !!o.wonRace, raceTarget: o.race || 1, scores: o.scores || null });
    return clock;
  };
  return { src: { gameHistory: live, playerStats: {} }, rack, now: () => clock };
}
const names = (list) => list.map((w) => w.name);

test("a race to 3: each rack's winner first, the games won then", () => {
  const n = night();
  const from = n.now();
  n.rack({ w: ["Luc"], l: ["Bob"], race: 3 });
  n.rack({ w: ["Bob"], l: ["Luc"], race: 3 });
  n.rack({ w: ["Luc"], l: ["Bob"], race: 3 });
  const last = n.rack({ w: ["Luc"], l: ["Bob"], race: 3, wonRace: true });
  const wins = W.between(n.src, from, last + 1000);
  assert.deepEqual(names(wins), [
    "winning shot Luc vs Bob-8-Ball-1-0",
    "winning shot Bob vs Luc-8-Ball-1-1",
    "winning shot Luc vs Bob-8-Ball-2-1",
    "winning shot Luc vs Bob-8-Ball-3-1"
  ]);
  assert.equal(wins[3].at, last);
  assert.deepEqual(wins[1].winners, ["Bob"]);
  assert.deepEqual(wins[1].losers, [["Luc"]]);
});

test("partners, a game on its own with points, open play", () => {
  const n = night();
  const from = n.now();
  n.rack({ w: ["Luc", "Chris"], l: ["Bob", "Kim"], team: 1 });
  n.rack({ w: ["Luc"], l: ["Bob"], gt: "straight", gl: "Straight Pool", unit: "points", target: 100, scores: { Luc: 100, Bob: 45 } });
  n.rack({ w: ["Kim"], l: ["Jo"], gl: "9-Ball", gt: "9ball" });
  const last = n.rack({ w: ["Kim"], l: ["Jo"], gl: "9-Ball", gt: "9ball" });
  assert.deepEqual(names(W.between(n.src, from, last)), [
    "winning shot Luc & Chris vs Bob & Kim-8-Ball-1-0",
    "winning shot Luc vs Bob-Straight Pool-100-45",
    "winning shot Kim vs Jo-9-Ball-1-0",
    "winning shot Kim vs Jo-9-Ball-2-0"
  ]);
});

test("only the games won while it recorded - across 5 a.m. too", () => {
  const n = night(3); // 3:10 a.m. on, the night before's pool day
  const t1 = n.rack({ w: ["Luc"], l: ["Bob"] });
  const t2 = n.rack({ w: ["Bob"], l: ["Luc"], gap: 120 }); // 5:10 a.m., the next pool day
  const t3 = n.rack({ w: ["Luc"], l: ["Bob"], gap: 30 });
  assert.deepEqual(W.between(n.src, t1 + 1000, t3 - 1000).map((w) => w.at), [t2]);
  assert.deepEqual(W.between(n.src, t1, t3).map((w) => w.at), [t1, t2, t3]);
  assert.deepEqual(W.between(n.src, t3 + 1, t3 + 3600000), []);
  assert.deepEqual(W.between({}, t1, t3), []);
});

test("its clip: 25 s before the win to 5 s after, inside the recording", () => {
  assert.deepEqual(W.clipSpan(100000, 0, 200000), { startedAt: 75000, endedAt: 105000 });
  assert.deepEqual(W.clipSpan(100000, 90000, 102000), { startedAt: 90000, endedAt: 102000 });
  assert.equal(W.AFTER_MS + W.BEFORE_MS, 30000);
});
