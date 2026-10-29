// js/lib/events.js
// Breaks, fouls, safeties and innings: the turn tracker (runs, high runs, innings, fouls in a 
// row), the three-foul rules, who breaks next, and when a 15-ball rotation frame is won.
// Pure: no page, no storage, no app state - js/app.js calls it through
// PMCLib.events (loaded before it), and the unit tests (tests/unit/) load it in Node.
// Moved out of js/app.js as it was (P29).
(function (root) {
  "use strict";

  // ---- Breaks, fouls, safeties and innings (P24) ----
  // Optional - ☰ 🎱 Game › "Track breaks, fouls & innings"
  // (state.currentGame.trackEvents): an event bar under the board. These
  // rules are plain functions of plain data (tests/test_events.js); the
  // tracker lives in state.turns, one per rack, and goes onto the game
  // entry when the rack is won (g.turns).
  //   shooter: whose turn it is; run: their run so far (balls);
  //   best / innings / safeties / foulsInRow / fouls: { name: n }
  function newTurnTracker(shooter) {
    var tr = { shooter: null, run: 0, best: {}, innings: {}, safeties: {}, foulsInRow: {}, fouls: {} };
    if (shooter) turnStart(tr, shooter);
    return tr;
  }

  // a turn at the table begins (an inning)
  function turnStart(tr, name) {
    if (tr.shooter === name) return;
    tr.shooter = name;
    tr.run = 0;
    tr.innings[name] = (tr.innings[name] || 0) + 1;
  }

  // balls potted: a legal shot - the run grows, a foul streak ends
  function turnPot(tr, name, balls) {
    turnStart(tr, name);
    tr.run += balls;
    if (tr.run > (tr.best[name] || 0)) tr.best[name] = tr.run;
    tr.foulsInRow[name] = 0;
  }

  // the turn ends: "miss", "safety" or "foul" - the run ends there; the
  // next player's inning begins. Returns the shooter's fouls in a row.
  function turnEnd(tr, kind, nextName) {
    var name = tr.shooter;
    var inRow = 0;
    if (name) {
      if (kind === "safety") tr.safeties[name] = (tr.safeties[name] || 0) + 1;
      if (kind === "foul") {
        inRow = tr.foulsInRow[name] = (tr.foulsInRow[name] || 0) + 1;
        tr.fouls[name] = (tr.fouls[name] || 0) + 1;
      } else {
        tr.foulsInRow[name] = 0;
      }
    }
    tr.shooter = null;
    tr.run = 0;
    if (nextName) turnStart(tr, nextName);
    return inRow;
  }

  // A foul's cost in this game: points (14.1: −1, −2 on the break; the
  // third in a row −1 and 15 more, and a re-rack), what a third in a row
  // does ("rerack" in 14.1, "lose" the rack in 9- and 10-ball), and
  // whether a two-foul warning matters here.
  var THREE_FOUL_GAMES = { straight: "rerack", "9ball": "lose", "10ball": "lose" };

  function foulRule(gameType, inRow, breakFoul) {
    var third = THREE_FOUL_GAMES[gameType] || null;
    var rule = { points: 0, third: null, warns: !!third };
    if (gameType === "straight") rule.points = breakFoul ? -2 : -1;
    if (third && inRow >= 3) {
      rule.third = third;
      if (gameType === "straight") rule.points = -16;
    }
    return rule;
  }

  // Who breaks the next rack: "winner", "loser" or "alternate"
  function nextBreaker(rule, players, lastBreaker, winner) {
    var others = players.filter(function (n) { return n !== winner; });
    if (rule === "loser") return others[0] || winner;
    if (rule === "alternate") {
      var i = players.indexOf(lastBreaker);
      return players[(i + 1) % players.length] || winner;
    }
    return winner;
  }

  // 15-ball rotation (120 points a frame): with two players the first to
  // 61; with more, the leader as soon as nobody can catch them with what's
  // left on the table (rules/rotation.html) - a fixed 61 could leave
  // three players stuck at 50-40-30. scores: [{ id, score }]
  var ROTATION_FRAME_POINTS = 120;

  function rotationFrameWinner(scores) {
    if (!scores || scores.length < 2) return null;
    var sorted = scores.slice().sort(function (a, b) { return b.score - a.score; });
    var left = Math.max(0, ROTATION_FRAME_POINTS - scores.reduce(function (sum, x) { return sum + Math.max(0, x.score); }, 0));
    return sorted[0].score > sorted[1].score + left ? sorted[0].id : null;
  }

  var api = {
    THREE_FOUL_GAMES: THREE_FOUL_GAMES,
    ROTATION_FRAME_POINTS: ROTATION_FRAME_POINTS,
    newTurnTracker: newTurnTracker,
    turnStart: turnStart,
    turnPot: turnPot,
    turnEnd: turnEnd,
    foulRule: foulRule,
    nextBreaker: nextBreaker,
    rotationFrameWinner: rotationFrameWinner
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.events = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
