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
