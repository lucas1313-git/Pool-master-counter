// js/lib/race-math.js
// Race math: the Elo expected score, the chance of winning a race to N from a per-rack chance, 
// the BCA-style handicapped race for a rating gap, and FargoRate's fair-match race.
// Pure: no page, no storage, no app state - js/app.js calls it through
// PMCLib.raceMath (loaded before it), and the unit tests (tests/unit/) load it in Node.
// Moved out of js/app.js as it was (P29).
(function (root) {
  "use strict";

  // BCA's handicap compares the two players actually matched: the
  // lower-rated one races to Base Games to Win, and the higher-rated
  // one's race is whichever makes the match closest to 50/50 on this
  // app's rating scale (100 points = 2 to 1 a game, FargoRate's scale -
  // eloExpectedScore/raceWinProbability) - at most twice the base: past
  // that a match is too lopsided to even out by race length alone.
  var BCA_MAX_RACE_FACTOR = 2;

  function bcaRaceForRatingGap(base, gap) {
    var p = eloExpectedScore(Math.abs(gap), 0);
    var best = base;
    var bestDiff = Infinity;
    for (var race = base; race <= base * BCA_MAX_RACE_FACTOR; race++) {
      var diff = Math.abs(raceWinProbability(p, race, base) - 0.5);
      if (diff < bestDiff - 1e-9) {
        bestDiff = diff;
        best = race;
      }
    }
    return best;
  }

  // Win probability for A over B given the two ratings — a 100-point gap
  // is a 2:1 expected win ratio, matching FargoRate's published scale.
  function eloExpectedScore(ratingA, ratingB) {
    return 1 / (1 + Math.pow(2, (ratingB - ratingA) / 100));
  }

  // P(a player racing to needA wins reaches that before an opponent
  // racing to needB does), given the first player's per-game win
  // probability p. Plain DP over "wins still needed" from each side -
  // numerically stable for any race length this app would ever use
  // (races top out well under 100), no factorials/overflow risk.
  function raceWinProbability(p, needA, needB) {
    var memo = {};
    function f(i, j) {
      if (i === 0) return 1;
      if (j === 0) return 0;
      var k = i + "," + j;
      if (memo[k] !== undefined) return memo[k];
      var v = p * f(i - 1, j) + (1 - p) * f(i, j - 1);
      memo[k] = v;
      return v;
    }
    return f(needA, needB);
  }

  // FargoRate's own fair match (fargorate.com/faq, "What does a particular
  // Fargo Rating difference mean?"): the two races in the same ratio as the
  // games each player is expected to win - 100 points = 2 to 1 - so the
  // weaker player's race is the stronger one's divided by 2^(gap / 100).
  // Their published chart for a race to 9, as published (rating gap,
  // weaker player's race) - each row is exactly that ratio; between rows
  // the nearest whole game, never under 1.
  var FARGO_FAIR_RACE_TO_9 = [[17, 8], [36, 7], [58, 6], [85, 5], [117, 4], [158, 3], [217, 2], [317, 1]];

  function fargoFairRace(gap, anchorRace) {
    if (!(gap > 0)) return anchorRace;
    return Math.max(1, Math.min(anchorRace, Math.round(anchorRace / Math.pow(2, gap / 100))));
  }

  var api = {
    BCA_MAX_RACE_FACTOR: BCA_MAX_RACE_FACTOR,
    FARGO_FAIR_RACE_TO_9: FARGO_FAIR_RACE_TO_9,
    fargoFairRace: fargoFairRace,
    eloExpectedScore: eloExpectedScore,
    raceWinProbability: raceWinProbability,
    bcaRaceForRatingGap: bcaRaceForRatingGap
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.raceMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
