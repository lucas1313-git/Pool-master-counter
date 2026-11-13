// js/lib/winning-shots.js
// 🏆 The winning shots of a recording (2026-11-12, the user: "extract all the winning shots at the
// end of all games in the video ... a 30 seconds extract of these and call it winning shot [player]
// vs [player]-[game type]-[score]"): every game the scoreboard saw won while the recording ran -
// when the win was entered (the game's ts, a moment after the ball that won it), who won, who lost,
// the game and the score then - and its clip, 25 s before that moment to 5 s after.
// Pure: no page, no storage - js/cue-viewer.js calls it through PMCLib.winningShots (with
// js/lib/night-timeline.js loaded before it), the unit tests load it in Node.
(function (root) {
  "use strict";

  var BEFORE_MS = 25000, AFTER_MS = 5000;
  var DAY_START_HOUR = 5;
  var timeline = root.PMCLib && root.PMCLib.nightTimeline;
  if (!timeline && typeof require === "function") timeline = require("./night-timeline.js");

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // (= js/lib/pool-day.js: local time, 5 a.m. to 5 a.m.)
  function poolDay(ms) {
    var d = new Date(ms);
    if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  // the score once rack r was won, the winner's first: the games won in the match ("3-2"); a game
  // on its own with points, its points ("100-45")
  function scoreAfter(m, r) {
    var rack = m.racks[r], w = rack.winner;
    var order = [w].concat(m.sides.map(function (s, i) { return i; }).filter(function (i) { return i !== w; }));
    if (m.racks.length === 1 && !m.raceTo && rack.points) return order.map(function (i) { return rack.points[i]; }).join("-");
    var wins = m.sides.map(function () { return 0; });
    for (var k = 0; k <= r; k++) if (m.racks[k].winner >= 0) wins[m.racks[k].winner] += 1;
    return order.map(function (i) { return wins[i]; }).join("-");
  }

  // "winning shot Luc vs Bob-8-Ball-3-2" (partners "Luc & Chris")
  function shotName(w) {
    return "winning shot " + [w.winners].concat(w.losers).map(function (names) { return names.join(" & "); }).join(" vs ") + "-" + w.game + "-" + w.score;
  }

  // The games won from start to end (ms), in order:
  // [{ at, winners [names], losers [[names] a side], game, gameType, score, name }]
  //   src = { gameHistory, playerStats, tournamentResults } - as js/lib/night-timeline.js takes it
  function between(src, start, end) {
    var days = {}, out = [];
    for (var t = start; t < end; t += 3 * 3600000) days[poolDay(t)] = true;
    days[poolDay(end)] = true;
    Object.keys(days).sort().forEach(function (day) {
      var night = timeline.build(day, src || {});
      var nameOf = {};
      night.players.forEach(function (p) { nameOf[p.id] = p.name; });
      night.matches.forEach(function (m) {
        m.racks.forEach(function (rack, r) {
          var at = new Date(rack.endedAt).getTime();
          if (!(at >= start && at <= end) || rack.winner < 0) return;
          var names = function (side) { return side.players.map(function (id) { return nameOf[id]; }); };
          var w = {
            at: at,
            winners: names(m.sides[rack.winner]),
            losers: m.sides.filter(function (s, i) { return i !== rack.winner; }).map(names),
            game: m.game || m.gameType || "Game",
            gameType: m.gameType || "",
            score: scoreAfter(m, r)
          };
          w.name = shotName(w);
          out.push(w);
        });
      });
    });
    return out.sort(function (a, b) { return a.at - b.at; });
  }

  // its clip: 25 s before the win to 5 s after - inside the recording (from, to)
  function clipSpan(at, from, to) {
    return { startedAt: Math.max(from, at - BEFORE_MS), endedAt: Math.min(to, at + AFTER_MS) };
  }

  var api = { between: between, clipSpan: clipSpan, shotName: shotName, BEFORE_MS: BEFORE_MS, AFTER_MS: AFTER_MS };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.winningShots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
