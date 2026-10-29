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

// FargoRate's fair-match race (P32): fargoFairRace(gap, the stronger player's race)
test("Fargo Fair-Match: a gap of 0 - both race to the same", () => {
  assert.equal(R.fargoFairRace(0, 9), 9);
  assert.equal(R.fargoFairRace(0, 7), 7);
  assert.equal(R.fargoFairRace(0, 5), 5);
});
test("Fargo Fair-Match: a gap of 100 (2 to 1) - 9-5, 10-5, 8-4, 7-4, 5-3", () => {
  assert.equal(R.fargoFairRace(100, 9), 5);
  assert.equal(R.fargoFairRace(100, 10), 5); // (FargoRate's own example: 10-5 or 8-4)
  assert.equal(R.fargoFairRace(100, 8), 4);
  assert.equal(R.fargoFairRace(100, 7), 4);
  assert.equal(R.fargoFairRace(100, 5), 3);
});
test("Fargo Fair-Match: a gap of 200 (4 to 1) - 9-2, 8-2, 7-2, 5-1, 3-1", () => {
  assert.equal(R.fargoFairRace(200, 9), 2);
  assert.equal(R.fargoFairRace(200, 8), 2);
  assert.equal(R.fargoFairRace(200, 7), 2);
  assert.equal(R.fargoFairRace(200, 5), 1);
  assert.equal(R.fargoFairRace(200, 3), 1);
});
test("Fargo Fair-Match: a race to 9 gives FargoRate's published chart, row by row", () => {
  assert.equal(R.FARGO_FAIR_RACE_TO_9.length, 8);
  R.FARGO_FAIR_RACE_TO_9.forEach(([gap, race]) => assert.equal(R.fargoFairRace(gap, 9), race, "gap " + gap));
});
test("Fargo Fair-Match: a bigger gap never a longer race; never under 1; the stronger side's gap (negative) changes nothing", () => {
  for (let g = 0; g < 600; g += 5) assert.ok(R.fargoFairRace(g + 5, 9) <= R.fargoFairRace(g, 9), "gap " + g);
  assert.equal(R.fargoFairRace(1000, 9), 1);
  assert.equal(R.fargoFairRace(-120, 9), 9);
});
