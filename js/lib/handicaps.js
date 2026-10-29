// js/lib/handicaps.js
// APA's handicap charts (8-Ball Games Must Win, 9-Ball points to win and match points) and reading 
// them: the skill levels, a pairing's races, the league points for a result.
// Pure: no page, no storage, no app state - js/app.js calls it through
// PMCLib.handicaps (loaded before it), and the unit tests (tests/unit/) load it in Node.
// Moved out of js/app.js as it was (P29).
(function (root) {
  "use strict";

  // 8-Ball: APA's "Games Must Win" chart - a race depends on BOTH
  // players' Skill Levels (2-7 in 8-Ball): APA_8BALL_RACE_CHART[you]
  // [opponent] = [games you must win, games they must win]. Every cell
  // copied from APA's own chart (Official Team Manual, The Equalizer
  // Handicap System > Games Must Win Charts, rules.poolplayers.com,
  // checked 28 Oct 2026); data/handicap-charts.json carries the same.
  var APA_8BALL_RACE_CHART = {
    2: { 2: [2, 2], 3: [2, 3], 4: [2, 4], 5: [2, 5], 6: [2, 6], 7: [2, 7] },
    3: { 2: [3, 2], 3: [2, 2], 4: [2, 3], 5: [2, 4], 6: [2, 5], 7: [2, 6] },
    4: { 2: [4, 2], 3: [3, 2], 4: [3, 3], 5: [3, 4], 6: [3, 5], 7: [2, 5] },
    5: { 2: [5, 2], 3: [4, 2], 4: [4, 3], 5: [4, 4], 6: [4, 5], 7: [3, 5] },
    6: { 2: [6, 2], 3: [5, 2], 4: [5, 3], 5: [5, 4], 6: [5, 5], 7: [4, 5] },
    7: { 2: [7, 2], 3: [6, 2], 4: [5, 2], 5: [5, 3], 6: [5, 4], 7: [5, 5] }
  };

  var APA_8BALL_MIN_SL = 2;

  var APA_8BALL_MAX_SL = 7;

  // 9-Ball: points to win, from the player's own Skill Level alone (APA's
  // "Points Required To Win" chart). Balls 1-8 are a point each, the
  // 9-ball two - the league board's "9-ball +2" button (APA 9-Ball only).
  var APA_9BALL_POINTS_TARGET = { 1: 14, 2: 19, 3: 25, 4: 31, 5: 38, 6: 46, 7: 55, 8: 65, 9: 75 };

  // APA 9-Ball match points: 20 a match, split by the "Score of Match"
  // chart on APA's 9-Ball scoresheet - by the LOSER's Skill Level, the
  // fewest points they must have made to earn 1, 2, ... 8 of the 20 (the
  // winner gets the rest: 20-0 down to 12-8).
  var APA_9BALL_LOSER_POINT_STEPS = {
    1: [3, 4, 5, 7, 8, 9, 11, 12],
    2: [4, 6, 8, 9, 11, 13, 15, 17],
    3: [5, 7, 10, 12, 15, 17, 20, 22],
    4: [6, 9, 12, 15, 19, 22, 25, 28],
    5: [7, 11, 15, 19, 23, 27, 30, 34],
    6: [9, 13, 18, 23, 28, 32, 37, 41],
    7: [11, 16, 22, 27, 33, 38, 44, 50],
    8: [14, 20, 27, 33, 40, 46, 53, 59],
    9: [18, 25, 32, 39, 47, 54, 61, 68]
  };

  var APA_9BALL_MIN_SL = 1;

  var APA_9BALL_MAX_SL = 9;

  // Data-driven handicap charts for league match targets (see
  // league.useHandicap/handicapSystem/handicapBaseGames below and
  // leagueMatchTargets). A chart is either per player ({SL: target}) or
  // for two players ({SL: {opponent SL: [target, opponent's target]}},
  // like APA 8-Ball). Pre-seeded with APA's real charts (the
  // only one of the four with one official nationwide table - matches
  // APA_8BALL_RACE_CHART/APA_9BALL_POINTS_TARGET above) so the app works
  // correctly even before data/handicap-charts.json has loaded, or if it
  // never does (offline, fetch blocked, etc.) - BCA/VNBA/TAP start empty
  // either way since none of them publish one universal chart. This is
  // the shared, app-wide fallback only; each league's own numbers live
  // on the league itself (customHandicapCharts, edited via "View/Edit
  // Table") and take priority over this when present - see
  // leagueEffectiveHandicapChart.
  var HANDICAP_CHARTS = {
    apa: { "8ball": JSON.parse(JSON.stringify(APA_8BALL_RACE_CHART)), "9ball": Object.assign({}, APA_9BALL_POINTS_TARGET) },
    bca: { "8ball": {}, "9ball": {} },
    vnba: { "8ball": {}, "9ball": {} },
    tap: { "8ball": {}, "9ball": {} }
  };

  // A member's Skill Level as the chart reads it: APA 8-Ball runs 2-7
  // (an 8 or 9 entered before the chart was right reads as a 7).
  function leagueChartSkillLevel(league, skillLevel) {
    if (league.handicapSystem === "apa" && league.format !== "apa9ball") {
      return Math.max(APA_8BALL_MIN_SL, Math.min(APA_8BALL_MAX_SL, skillLevel));
    }
    return skillLevel;
  }

  // The race in a two-player chart (APA 8-Ball): {targetA, targetB}, or
  // null for a per-player chart or a pair it doesn't cover.
  function handicapChartRaces(chart, slA, slB) {
    var row = chart[slA];
    if (!row || typeof row !== "object") return null;
    var cell = row[slB];
    return Array.isArray(cell) && cell.length === 2 && cell[0] > 0 && cell[1] > 0 ? { targetA: cell[0], targetB: cell[1] } : null;
  }

  // Standings points for one finished match - a simplified stand-in for
  // APA's own full Team Points formula (which is built around 5-person
  // team segments this app doesn't model): the winner banks 2 points; the
  // loser banks 1 "close match" point if they reached at least half of
  // their own target, otherwise 0. Simple, integer, easy to reason about -
  // not a claim of official APA precision.
  // A match's league points, the way the league's system scores it:
  // - APA 8-Ball (its scoresheet's Match Points Earned): a shutout 3-0,
  //   the loser on the hill (one game short) 2-1, otherwise 2-0;
  // - APA 9-Ball: 20 points split by the Score of Match chart, from the
  //   loser's Skill Level and points made (APA_9BALL_LOSER_POINT_STEPS);
  // - BCA/VNBA/TAP (each league its own rules): 2 to the winner, 1 to a
  //   loser who reached half their race.
  function leaguePointsForResult(league, winnerScore, winnerTarget, loserScore, loserTarget, loserSkillLevel) {
    if (league && league.handicapSystem === "apa") {
      if (league.format === "apa9ball") {
        var loserPoints = apa9BallLoserMatchPoints(loserScore, loserTarget, loserSkillLevel);
        return { winnerPoints: 20 - loserPoints, loserPoints: loserPoints };
      }
      if (loserScore <= 0) return { winnerPoints: 3, loserPoints: 0 };
      if (loserScore >= loserTarget - 1) return { winnerPoints: 2, loserPoints: 1 };
      return { winnerPoints: 2, loserPoints: 0 };
    }
    var loserCredit = loserScore >= loserTarget / 2 ? 1 : 0;
    return { winnerPoints: 2, loserPoints: loserCredit };
  }

  // The loser's share of an APA 9-Ball match's 20 points. Their Skill
  // Level picks the chart row; a race that isn't that row's (handicap
  // off, a base number) reads the row whose target is nearest, with the
  // points made scaled to it.
  function apa9BallLoserMatchPoints(loserScore, loserTarget, loserSkillLevel) {
    var sl = loserSkillLevel;
    if (!APA_9BALL_LOSER_POINT_STEPS[sl] || APA_9BALL_POINTS_TARGET[sl] !== loserTarget) {
      if (!APA_9BALL_LOSER_POINT_STEPS[sl]) sl = 1;
      Object.keys(APA_9BALL_POINTS_TARGET).forEach(function (k) {
        if (Math.abs(APA_9BALL_POINTS_TARGET[k] - loserTarget) < Math.abs(APA_9BALL_POINTS_TARGET[sl] - loserTarget)) sl = +k;
      });
    }
    var rowTarget = APA_9BALL_POINTS_TARGET[sl];
    var made = loserTarget > 0 && loserTarget !== rowTarget ? Math.floor((loserScore * rowTarget) / loserTarget) : loserScore;
    return APA_9BALL_LOSER_POINT_STEPS[sl].filter(function (step) { return made >= step; }).length;
  }

  var api = {
    APA_8BALL_RACE_CHART: APA_8BALL_RACE_CHART,
    APA_8BALL_MIN_SL: APA_8BALL_MIN_SL,
    APA_8BALL_MAX_SL: APA_8BALL_MAX_SL,
    APA_9BALL_POINTS_TARGET: APA_9BALL_POINTS_TARGET,
    APA_9BALL_LOSER_POINT_STEPS: APA_9BALL_LOSER_POINT_STEPS,
    APA_9BALL_MIN_SL: APA_9BALL_MIN_SL,
    APA_9BALL_MAX_SL: APA_9BALL_MAX_SL,
    HANDICAP_CHARTS: HANDICAP_CHARTS,
    leagueChartSkillLevel: leagueChartSkillLevel,
    handicapChartRaces: handicapChartRaces,
    apa9BallLoserMatchPoints: apa9BallLoserMatchPoints,
    leaguePointsForResult: leaguePointsForResult
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.handicaps = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
