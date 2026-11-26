// js/lib/winning-shots.js
// 🏆 The winning shots of a recording (2026-11-12, the user: "extract all the winning shots at the
// end of all games in the video ... a 30 seconds extract of these and call it winning shot [player]
// vs [player]-[game type]-[score]"): every game the scoreboard saw won while the recording ran -
// when the win was entered (the game's ts, a moment after the ball that won it), who won, who lost,
// the game and the score then (the race's), the time - and its clip: 30 s ending 2 s after the
// ball that won it went in, when the camera page watched the table (see ballIn), else 25 s before
// the win was entered to 5 s after.
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

  function key(n) { return String(n || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function isPointsUnit(unit) { return unit === "points" || unit === "balls"; }
  // "2026-11-15-16h11m39" (local time - as a cue's name has it, js/cue-viewer.js)
  function stamp(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "-" + pad(d.getHours()) + "h" + pad(d.getMinutes()) + "m" + pad(d.getSeconds());
  }
  // a side's wins in the race, from a rack's raceTally (by name): its player's - partners', when
  // they're the same; null when the tally can't say
  function sideWins(tally, names) {
    var byKey = {};
    Object.keys(tally || {}).forEach(function (n) { byKey[key(n)] = tally[n]; });
    var wins = names.map(function (n) { return byKey[key(n)]; });
    if (!wins.length || wins.some(function (v) { return typeof v !== "number"; })) return null;
    return wins.every(function (v) { return v === wins[0]; }) ? wins[0] : null;
  }

  // the score once rack r was won, each side's (the winner's first - order: the sides' indexes):
  // a points game, its points ("100-45"); else the race score kept with the rack, as the board
  // showed it ("7-3" - 2026-11-16, the user: "the winning shot names all say 1-0, use the race
  // score": with Winner Stays the two at the table change every rack, each pairing one rack); a
  // rack kept with no race score, the games won in the match ("3-2")
  // -> { values [], points (true: points) }
  function scoreAfter(m, r, order, sideNames) {
    var rack = m.racks[r];
    if (rack.points && (isPointsUnit(rack.unit) || (!rack.unit && m.racks.length === 1 && !m.raceTo))) {
      return { values: order.map(function (i) { return rack.points[i]; }), points: true };
    }
    if (rack.raceTally && typeof rack.raceTally === "object") {
      var race = order.map(function (i) { return sideWins(rack.raceTally, sideNames[i]); });
      if (race.every(function (v) { return v !== null; })) return { values: race, points: false };
    }
    var wins = m.sides.map(function () { return 0; });
    for (var k = 0; k <= r; k++) if (m.racks[k].winner >= 0) wins[m.racks[k].winner] += 1;
    return { values: order.map(function (i) { return wins[i]; }), points: false };
  }

  // "winning shot Luc vs Bob-8-Ball-7-3-2026-11-15-16h11m39" (partners "Luc & Chris"; the time
  // the win was entered - 2026-11-16, the user: "I need to have the time in the clips")
  function shotName(w) {
    return "winning shot " + [w.winners].concat(w.losers).map(function (names) { return names.join(" & "); }).join(" vs ") + "-" + w.game + "-" + w.score + (w.at ? "-" + stamp(w.at) : "");
  }

  // The games won from start to end (ms), in order:
  // [{ at, winners [names], losers [[names] a side], game, gameType, score ("7-3"), sides
  //   [{ names, value }] (the winner's first - the score's numbers), points (true: a points game's
  //   points), raceTo (a race: its length), wonRace (true: it won the race), name }]
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
          var sideNames = m.sides.map(function (side) { return side.players.map(function (id) { return nameOf[id]; }); });
          var order = [rack.winner].concat(m.sides.map(function (s, i) { return i; }).filter(function (i) { return i !== rack.winner; }));
          var score = scoreAfter(m, r, order, sideNames);
          var w = {
            at: at,
            winners: sideNames[rack.winner],
            losers: order.slice(1).map(function (i) { return sideNames[i]; }),
            game: m.game || m.gameType || "Game",
            gameType: m.gameType || "",
            score: score.values.join("-"),
            sides: order.map(function (i, k) { return { names: sideNames[i], value: score.values[k] }; }),
            points: score.points,
            raceTo: !score.points && rack.raceTarget > 1 ? rack.raceTarget : null
          };
          // (the race won with it - not stopped early)
          w.wonRace = !!w.raceTo && (!!rack.wonRace || w.sides[0].value >= w.raceTo);
          w.name = shotName(w);
          out.push(w);
        });
      });
    });
    return out.sort(function (a, b) { return a.at - b.at; });
  }

  // The race as it stood at t (ms) - for the caption of a cue that isn't a win: from the racks of
  // t's pool day before it (a race won or stopped: the next one from 0) -> { wins { name (lower
  // case): wins }, raceTo, unit } - or null: no rack that day before t
  function scoreAt(src, t) {
    var night = timeline.build(poolDay(t), src || {}), racks = [];
    night.matches.forEach(function (m) { m.racks.forEach(function (rk) { racks.push({ at: new Date(rk.endedAt).getTime(), rk: rk }); }); });
    racks.sort(function (a, b) { return a.at - b.at; });
    var wins = {}, last = null;
    racks.forEach(function (x) {
      if (x.at > t) return;
      if (last && last.rk.endsRace) wins = {};
      Object.keys(x.rk.raceTally || {}).forEach(function (n) { wins[key(n)] = x.rk.raceTally[n]; });
      last = x;
    });
    if (!last) return null;
    return { wins: last.rk.endsRace ? {} : wins, raceTo: last.rk.raceTarget || null, unit: last.rk.unit || null };
  }

  // When the ball that won it went in (2026-11-26, the user: "stop the cue about 2 seconds after the
  // last shot finishes ... when the ball goes in + 2 seconds" - the win is entered a while after):
  // the camera's shots during the recording (record.html keeps them - { beganAt, aimAt, endedAt,
  // shot, pockets [times a ball went into a pocket] }) - the last one begun before the win was
  // entered (up to 3 minutes before, and after the game before was won - notBefore: a shot the
  // camera missed mustn't be taken for the last game's): its last ball into a pocket before then;
  // none seen, everything on the table still again (its end) - if that was before the win was entered.
  // -> { at, how: "pocket" | "still" } or null (no shot to go by: the camera page wasn't watching)
  var LOOK_BACK_MS = 3 * 60000, BALL_TAIL_MS = 2000, CLIP_MS = BEFORE_MS + AFTER_MS;
  function ballIn(at, shots, notBefore) {
    var last = null, startOf = function (e) { return e.aimAt || e.beganAt || 0; }, since = Math.max(at - LOOK_BACK_MS, notBefore || 0);
    (shots || []).forEach(function (e) {
      var s = startOf(e);
      if (!(e.shot || (e.pockets && e.pockets.length)) || !s || s > at || s < since) return;
      if (!last || s > startOf(last)) last = e;
    });
    if (!last) return null;
    var drops = (last.pockets || []).filter(function (p) { return typeof p === "number" && p <= at && p >= startOf(last); });
    if (drops.length) return { at: Math.max.apply(null, drops), how: "pocket" };
    if (last.endedAt && last.endedAt <= at) return { at: last.endedAt, how: "still" };
    return null;
  }

  // its clip, inside the recording (from, to): 30 s ending 2 s after the ball went in (shots: the
  // camera's, notBefore: the game before's win - see ballIn) - else, as before, 25 s before the win
  // was entered to 5 s after
  // -> { startedAt, endedAt, ballInAt, how } (ballInAt / how: only when the ball's moment was found)
  function clipSpan(at, from, to, shots, notBefore) {
    var b = ballIn(at, shots, notBefore);
    if (!b) return { startedAt: Math.max(from, at - BEFORE_MS), endedAt: Math.min(to, at + AFTER_MS) };
    var end = Math.min(to, b.at + BALL_TAIL_MS);
    return { startedAt: Math.max(from, end - CLIP_MS), endedAt: end, ballInAt: b.at, how: b.how };
  }

  var api = { between: between, clipSpan: clipSpan, ballIn: ballIn, shotName: shotName, scoreAt: scoreAt, stamp: stamp, BEFORE_MS: BEFORE_MS, AFTER_MS: AFTER_MS, BALL_TAIL_MS: BALL_TAIL_MS };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.winningShots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
