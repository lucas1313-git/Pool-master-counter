// APA handicaps and league points (js/lib/handicaps.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../../js/lib/handicaps.js");
const apa8 = { handicapSystem: "apa", format: "apa8ball" }, apa9 = { handicapSystem: "apa", format: "apa9ball" }, bca = { handicapSystem: "bca", format: "8ball" };

test("APA 8-Ball: the same skill level races to the same number", () => {
  for (let sl = 2; sl <= 7; sl++) {
    const r = H.handicapChartRaces(H.APA_8BALL_RACE_CHART, sl, sl);
    assert.equal(r.targetA, r.targetB, "SL" + sl);
  }
});
test("APA 8-Ball: the chart is the same read from either side", () => {
  for (let a = 2; a <= 7; a++) for (let b = 2; b <= 7; b++) {
    const ab = H.handicapChartRaces(H.APA_8BALL_RACE_CHART, a, b), ba = H.handicapChartRaces(H.APA_8BALL_RACE_CHART, b, a);
    assert.deepEqual([ab.targetA, ab.targetB], [ba.targetB, ba.targetA], a + " v " + b);
  }
});
test("APA 8-Ball: a 7 needs more games than a 2 against each other", () => {
  const r = H.handicapChartRaces(H.APA_8BALL_RACE_CHART, 7, 2);
  assert.ok(r.targetA > r.targetB);
});
test("a pairing the chart doesn't cover: null", () => {
  assert.equal(H.handicapChartRaces(H.APA_8BALL_RACE_CHART, 12, 3), null);
});
test("APA 8-Ball skill levels read 2-7 (an 8 entered earlier reads as 7)", () => {
  assert.equal(H.leagueChartSkillLevel(apa8, 9), 7);
  assert.equal(H.leagueChartSkillLevel(apa8, 1), 2);
  assert.equal(H.leagueChartSkillLevel(apa9, 9), 9);
});
test("APA 9-Ball points to win: SL1 14 ... SL9 75, rising", () => {
  assert.equal(H.APA_9BALL_POINTS_TARGET[1], 14);
  assert.equal(H.APA_9BALL_POINTS_TARGET[9], 75);
  for (let sl = 2; sl <= 9; sl++) assert.ok(H.APA_9BALL_POINTS_TARGET[sl] > H.APA_9BALL_POINTS_TARGET[sl - 1]);
});
test("APA 8-Ball league points: a shutout 3-0, on the hill 2-1, otherwise 2-0", () => {
  assert.deepEqual(H.leaguePointsForResult(apa8, 3, 3, 0, 3), { winnerPoints: 3, loserPoints: 0 });
  assert.deepEqual(H.leaguePointsForResult(apa8, 3, 3, 2, 3), { winnerPoints: 2, loserPoints: 1 });
  assert.deepEqual(H.leaguePointsForResult(apa8, 3, 3, 1, 3), { winnerPoints: 2, loserPoints: 0 });
});
test("APA 9-Ball: the 20 points split by the loser's points made", () => {
  const nothing = H.leaguePointsForResult(apa9, 38, 38, 0, 38, 5), close = H.leaguePointsForResult(apa9, 38, 38, 37, 38, 5);
  assert.equal(nothing.winnerPoints + nothing.loserPoints, 20);
  assert.equal(nothing.loserPoints, 0);
  assert.ok(close.loserPoints >= 7 && close.loserPoints <= 8, JSON.stringify(close));
});
test("APA 9-Ball: the loser's share never goes down with more points made", () => {
  let last = -1;
  for (let made = 0; made < 38; made++) { const p = H.apa9BallLoserMatchPoints(made, 38, 5); assert.ok(p >= last); last = p; }
});
test("BCA-style leagues: 2 to the winner, 1 to a loser who reached half their race", () => {
  assert.deepEqual(H.leaguePointsForResult(bca, 5, 5, 3, 5), { winnerPoints: 2, loserPoints: 1 });
  assert.deepEqual(H.leaguePointsForResult(bca, 5, 5, 2, 5), { winnerPoints: 2, loserPoints: 0 });
});
