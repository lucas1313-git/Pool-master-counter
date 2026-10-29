// Race math (js/lib/race-math.js).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../js/lib/race-math.js");
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= (tol || 1e-9), a + " vs " + b);

test("equal ratings: an even chance", () => near(R.eloExpectedScore(500, 500), 0.5));
test("100 points better: a 2-to-1 favourite", () => near(R.eloExpectedScore(600, 500), 2 / 3));
test("the two sides' chances add up to 1", () => near(R.eloExpectedScore(431, 612) + R.eloExpectedScore(612, 431), 1));
test("a race: equal players, equal races - an even chance", () => near(R.raceWinProbability(0.5, 7, 7), 0.5));
test("a race to 1 is just one game", () => near(R.raceWinProbability(0.62, 1, 1), 0.62));
test("a longer race favours the better player more", () => {
  assert.ok(R.raceWinProbability(0.6, 9, 9) > R.raceWinProbability(0.6, 3, 3));
});
test("needing fewer games than the opponent helps", () => {
  assert.ok(R.raceWinProbability(0.5, 3, 5) > 0.5);
});
test("nothing left to win: already won; the opponent nothing left: already lost", () => {
  near(R.raceWinProbability(0.3, 0, 4), 1);
  near(R.raceWinProbability(0.9, 4, 0), 0);
});
test("BCA handicap: no gap, both race to the base", () => {
  const r = R.bcaRaceForRatingGap(5, 0);
  assert.equal(typeof r, "number");
  assert.equal(r, 5);
});
test("BCA handicap: a big gap is capped at twice the base", () => {
  assert.ok(R.bcaRaceForRatingGap(5, 2000) <= 5 * R.BCA_MAX_RACE_FACTOR);
});
test("BCA handicap: a bigger gap never asks for a shorter race", () => {
  assert.ok(R.bcaRaceForRatingGap(5, 300) >= R.bcaRaceForRatingGap(5, 100));
});
