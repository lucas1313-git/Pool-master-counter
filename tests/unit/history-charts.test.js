// js/lib/history-charts.js - the 📈 History page's influencers: the nights a player's leaderboard
// position changed, and why (their own results, a race won, or the others').
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../../js/lib/history-charts.js");

const night = (won, lost, races) => ({ won, lost, races: races || 0 });

test("up with wins, up with a race, down with losses - and who passed whom", () => {
  const ranks = { Ace: [1, 2, 1], Bob: [2, 1, 2], Cid: [3, 3, 3] };
  const played = { Ace: [null, night(0, 3), night(4, 1, 1)], Bob: [null, night(3, 0), night(0, 4)], Cid: [null, null, null] };
  const ev = H.influencers(ranks, played);
  const at = (name, i) => ev.find((e) => e.name === name && e.i === i);
  assert.equal(ev.length, 4);
  assert.deepEqual([at("Ace", 1).kind, at("Ace", 1).from, at("Ace", 1).to, at("Ace", 1).passedBy], ["down", 1, 2, ["Bob"]]);
  assert.deepEqual([at("Bob", 1).kind, at("Bob", 1).passed], ["up", ["Ace"]]);
  assert.deepEqual([at("Ace", 2).kind, at("Ace", 2).races, at("Ace", 2).won, at("Ace", 2).lost], ["race", 1, 4, 1]);
  assert.equal(at("Bob", 2).kind, "down");
  assert.equal(ev.filter((e) => e.name === "Cid").length, 0);
});

test("moved by the others: no games that night, or results that went the other way", () => {
  const ranks = { Ace: [1, 2, 3], Bob: [2, 1, 1], Cid: [3, 3, 2] };
  const played = { Ace: [null, null, night(2, 0)], Bob: [null, night(5, 0), null], Cid: [null, null, night(0, 2)] };
  const ev = H.influencers(ranks, played);
  const at = (name, i) => ev.find((e) => e.name === name && e.i === i);
  assert.equal(at("Ace", 1).kind, "passiveDown");
  // (won 2, still dropped - others' doing; lost 2, still climbed - same)
  assert.equal(at("Ace", 2).kind, "passiveDown");
  assert.equal(at("Cid", 2).kind, "passiveUp");
  assert.deepEqual(at("Cid", 2).passed, ["Ace"]);
});

test("into and out of the ranking", () => {
  const ranks = { Ace: [null, 1, 1, null], Bob: [1, 2, 2, 1] };
  const ev = H.influencers(ranks, {});
  assert.deepEqual(ev.filter((e) => e.name === "Ace").map((e) => [e.i, e.kind, e.from, e.to]), [[1, "enter", null, 1], [3, "leave", 1, null]]);
  assert.deepEqual(ev.filter((e) => e.name === "Bob").map((e) => [e.i, e.kind]), [[1, "passiveDown"], [3, "passiveUp"]]);
});

test("clean value-axis ticks; the activity bins", () => {
  assert.deepEqual(H.niceTicks(380, 480, 5), [380, 400, 420, 440, 460, 480]);
  assert.deepEqual(H.niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
  // (the top value inside the ticks: 19 wins under a tick of 20, not over one of 15)
  assert.deepEqual(H.niceTicks(0, 19, 5), [0, 5, 10, 15, 20]);
  assert.deepEqual(H.niceTicks(342, 512, 5), [300, 350, 400, 450, 500, 550]);
  assert.equal(H.heatColor("light", 1), H.HEAT.light[0]);
  assert.equal(H.heatColor("light", 7), H.HEAT.light[2]);
  assert.equal(H.heatColor("dark", 40), H.HEAT.dark[4]);
  assert.equal(H.PALETTE.light.length, 8);
});

// the replay's commentator: Ace leads, Cid comes in, Bob wins 2 races against Ace and takes #1,
// then the gap closes in
function season() {
  const ranks = { Ace: [1, 1, 2, 2], Bob: [2, 2, 1, 1], Cid: [null, 3, 3, 3] };
  const played = {
    Ace: [null, null, { won: 3, lost: 6, races: 0, vs: { Bob: { won: 3, lost: 6 } } }, null],
    Bob: [null, null, { won: 6, lost: 3, races: 2, vs: { Ace: { won: 6, lost: 3 } } }, null],
    Cid: [null, { won: 5, lost: 0, races: 0, vs: { Dee: { won: 5, lost: 0 } } }, null, null]
  };
  const scores = { Ace: [50, 52, 48, 49], Bob: [40, 45, 51, 50.5], Cid: [null, 30, 30, 31] };
  return { names: ["Ace", "Bob", "Cid"], count: 4, ranks, played, scores, events: H.influencers(ranks, played), closeGap: 2 };
}

test("commentary: the first leader, a newcomer's clean sweep, a lead change with its races, a top-3 clash, neck and neck", () => {
  const c = H.commentary(season());
  const kinds = (i) => c[i].general.map((x) => x.kind + ":" + x.name);
  assert.deepEqual(kinds(0), ["firstLeader:Ace"]);
  // (one item per player: Cid's sweep and his entry - the entry at #3 counts more)
  assert.deepEqual(kinds(1), ["enter:Cid"]);
  // (the clash told from the winner's side)
  assert.deepEqual(kinds(2), ["leadChange:Bob", "clash:Bob"]);
  assert.deepEqual(c[2].general[0].how, { won: 6, lost: 3, races: 2 });
  assert.deepEqual([c[2].general[1].wa, c[2].general[1].wb, c[2].general[1].other], [6, 3, "Ace"]);
  assert.deepEqual(kinds(3), ["closeRace:Bob"]);
  assert.equal(c[3].general[0].gap, 0.5 + 1);
  assert.ok(c.every((n) => n.personal.length === 0));
});

test("commentary following Bob: his night, the climb, a career best, the gaps, his rating, his first race", () => {
  const input = Object.assign(season(), { follow: "Bob", ratings: { Bob: [400, 400, 420, 420] } });
  const c = H.commentary(input);
  assert.deepEqual(c[0].personal, []);
  assert.deepEqual(c[2].personal.map((x) => x.kind), ["fNight", "fUp", "fBest", "fGapDown", "fRating", "fFirstRace"]);
  assert.deepEqual(c[2].personal[0].vs, [{ other: "Ace", won: 6, lost: 3 }]);
  assert.deepEqual(c[2].personal[1].passed, ["Ace"]);
  assert.equal(c[2].personal[3].gap, 3);
  assert.equal(c[2].personal[4].delta, 20);
  // (a quiet night - didn't play, nothing moved: nothing to say about him)
  assert.deepEqual(c[3].personal, []);
});

test("commentary: a reign every 5 nights at #1, a winning streak for the one followed", () => {
  const n = 10;
  const ranks = { Ace: Array(n).fill(1), Bob: Array(n).fill(2) };
  const played = { Ace: Array(n).fill(null), Bob: Array.from({ length: n }, () => ({ won: 4, lost: 2, races: 0, vs: {} })) };
  const c = H.commentary({ names: ["Ace", "Bob"], count: n, ranks, played, events: [], follow: "Bob" });
  assert.deepEqual(c.map((x) => x.general.filter((g) => g.kind === "reign").map((g) => g.nights)).flat(), [5, 10]);
  assert.deepEqual(c.map((x) => (x.personal.find((p) => p.kind === "fStreak") || {}).nights || 0), [0, 0, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("commentary: a top-3 clash only when one-sided enough - 5 games, won by 3", () => {
  const ranks = { Ace: [1, 1], Bob: [2, 2] };
  const night = (aw, al) => ({ Ace: [null, { won: aw, lost: al, races: 0, vs: { Bob: { won: aw, lost: al } } }], Bob: [null, { won: al, lost: aw, races: 0, vs: { Ace: { won: al, lost: aw } } }] });
  const clash = (aw, al) => H.commentary({ names: ["Ace", "Bob"], count: 2, ranks, played: night(aw, al), events: [] })[1].general.filter((g) => g.kind === "clash");
  assert.equal(clash(3, 3).length, 0);
  assert.equal(clash(3, 1).length, 0);
  assert.equal(clash(4, 2).length, 0);
  assert.deepEqual(clash(1, 5).map((g) => [g.name, g.wa, g.wb, g.other]), [["Bob", 5, 1, "Ace"]]);
});
