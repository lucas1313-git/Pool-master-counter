// js/lib/winning-shots.js
// 🏆 The winning shots of a recording (2026-11-12, the user: "extract all the winning shots at the
// end of all games in the video ... a 30 seconds extract of these and call it winning shot [player]
// vs [player]-[game type]-[score]"): every game the scoreboard saw won while the recording ran -
// when the win was entered (the game's ts, a moment after the ball that won it), who won, who lost,
// the game and the score then (the race's), the time - and its clip: from 25 s before the win was
// entered to 5 s after - or the start and stop chosen (see clipSpan) - ending 2 s after the ball
// that won it went in instead, when the camera page watched the table (see ballIn).
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

  // a side's key: its players, in any order
  function sideKey(names) { return names.map(key).sort().join("+"); }
  // The wins in the race from the racks themselves - for a team game kept without the teams' own
  // count (raceTeams - before 2026-11-26): each pair's, as the board keeps it (a pair's own wins,
  // partners changed or not - js/app.js syncTeamCombos), and each player's, up to and including
  // rack i of the day's (all, in order - { raceId, endsRace, winner (its side's key), winners
  // (its players' keys) }): the racks with its raceId; none kept, since the last race ended
  // -> { sides { side key: wins }, players { name key: wins } }
  function raceWins(all, i) {
    var me = all[i], sides = {}, players = {};
    for (var j = i; j >= 0; j--) {
      var x = all[j];
      if (!me.raceId && j < i && x.endsRace) break;
      if ((me.raceId && x.raceId !== me.raceId) || !x.winner) continue;
      sides[x.winner] = (sides[x.winner] || 0) + 1;
      x.winners.forEach(function (n) { players[n] = (players[n] || 0) + 1; });
    }
    return { sides: sides, players: players };
  }

  // the score once rack r was won, each side's (the winner's first - order: the sides' indexes):
  // a points game, its points ("100-45"); else the race score kept with the rack, as the board
  // showed it ("7-3" - 2026-11-16, the user: "the winning shot names all say 1-0, use the race
  // score": with Winner Stays the two at the table change every rack, each pairing one rack) - a
  // team game: the teams' (raceTeams; kept without: counted - won: see raceWins; 2026-11-26, the
  // user: "the score I see is the +1 from the rack I need to see the race to score instead" -
  // Rotating Teams, partners changing every rack, each pair's own count); a rack kept with no race
  // score, the games won in the match ("3-2")
  // -> { values [], points (true: points) }
  function scoreAfter(m, r, order, sideNames, won) {
    var rack = m.racks[r];
    if (rack.points && (isPointsUnit(rack.unit) || (!rack.unit && m.racks.length === 1 && !m.raceTo))) {
      return { values: order.map(function (i) { return rack.points[i]; }), points: true };
    }
    if (Array.isArray(rack.raceTeams) && rack.raceTeams.length) {
      var byTeam = {};
      rack.raceTeams.forEach(function (t) { if (t && Array.isArray(t.names)) byTeam[sideKey(t.names)] = t.wins; });
      var teams = order.map(function (i) { var v = byTeam[sideKey(sideNames[i])]; return typeof v === "number" ? v : null; });
      if (teams.every(function (v) { return v !== null; })) return { values: teams, points: false };
    }
    var counted = m.mode === "teams" && !m.tournament && won ? order.map(function (i) { return won.sides[sideKey(sideNames[i])] || 0; }) : null;
    // (a team's: its players' own wins when they've played together all race - partners changed, theirs aren't its)
    var steady = !counted || order.every(function (i, k) { return sideNames[i].every(function (n) { return (won.players[key(n)] || 0) === counted[k]; }); });
    if (steady && rack.raceTally && typeof rack.raceTally === "object") {
      var race = order.map(function (i) { return sideWins(rack.raceTally, sideNames[i]); });
      if (race.every(function (v) { return v !== null; })) return { values: race, points: false };
    }
    if (counted) return { values: counted, points: false };
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
  //   points), raceTo (a race: its length), wonRace (true: it won the race), name, ratings (src
  //   with ratings: the winners' Q-Scores [{ name, from, to }] - see ratingsAt; each side's too, in
  //   sides[].ratings) }]
  //   src = { gameHistory, playerStats, tournamentResults, ratings } - as js/lib/night-timeline.js
  //   takes it (and the scoreboard's ratings)
  function between(src, start, end) {
    var days = {}, out = [];
    for (var t = start; t < end; t += 3 * 3600000) days[poolDay(t)] = true;
    days[poolDay(end)] = true;
    Object.keys(days).sort().forEach(function (day) {
      var night = timeline.build(day, src || {});
      var nameOf = {};
      night.players.forEach(function (p) { nameOf[p.id] = p.name; });
      // (every rack of the day, in order - for the race score counted: see raceWins)
      var all = [];
      night.matches.forEach(function (m) {
        var sideNames = m.sides.map(function (side) { return side.players.map(function (id) { return nameOf[id]; }); });
        m.racks.forEach(function (rack, r) {
          all.push({ m: m, r: r, sideNames: sideNames, ms: Date.parse(rack.ts || "") || new Date(rack.endedAt).getTime(),
            raceId: rack.raceId || null, endsRace: !!rack.endsRace, winner: rack.winner >= 0 ? sideKey(sideNames[rack.winner]) : null,
            winners: rack.winner >= 0 ? sideNames[rack.winner].map(key) : [] });
        });
      });
      all.sort(function (a, b) { return a.ms - b.ms; });
      all.forEach(function (x, k) {
        var m = x.m, r = x.r, rack = m.racks[r], sideNames = x.sideNames;
        var at = new Date(rack.endedAt).getTime();
        if (!(at >= start && at <= end) || rack.winner < 0) return;
        var order = [rack.winner].concat(m.sides.map(function (s, i) { return i; }).filter(function (i) { return i !== rack.winner; }));
        var score = scoreAfter(m, r, order, sideNames, m.mode === "teams" ? raceWins(all, k) : null);
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
        // (the Q-Scores: the winners', and each side's - the losers' going down)
        if (src && src.ratings) {
          var ts = rack.ts || new Date(x.ms).toISOString();
          w.ratings = ratingsAt(src.ratings, w.winners, ts);
          w.sides.forEach(function (sd, i) { sd.ratings = i === 0 ? w.ratings : ratingsAt(src.ratings, sd.names, ts); });
        }
        out.push(w);
      });
    });
    return out.sort(function (a, b) { return a.at - b.at; });
  }

  // Each player's Q-Score (rating) just before the game and just after it (2026-11-26, the user:
  // "I would like to see with a similar animation the q-score of the winners going up" - then
  // "on the left I want to see the q-score of the winner(s) and in the right the q-score of the
  // losers"): from
  // their rating history (ratings - the scoreboard's: { name: { history [{ ts, rating, delta }] } }),
  // the point the game made (at its time, ts) -> [{ name, from, to }] - a player without one left
  // out (an unrated game, a history trimmed)
  function ratingsAt(ratings, names, ts) {
    var byKey = {}, t = Date.parse(ts);
    Object.keys(ratings || {}).forEach(function (k) { byKey[key(k)] = ratings[k]; });
    return names.map(function (n) {
      var e = byKey[key(n)], hist = e && Array.isArray(e.history) ? e.history : [];
      var find = function (same) {
        for (var i = hist.length - 1; i >= 0; i--) if (hist[i] && typeof hist[i].rating === "number" && same(hist[i])) return i;
        return -1;
      };
      // (its own time - else within the second: a time kept to the second)
      var i = find(function (h) { return h.ts === ts; });
      if (i === -1) i = find(function (h) { return Math.abs(Date.parse(h.ts) - t) < 1000; });
      if (i === -1) return null;
      var h = hist[i], before = typeof h.delta === "number" ? h.rating - h.delta : i > 0 && hist[i - 1] && typeof hist[i - 1].rating === "number" ? hist[i - 1].rating : null;
      return before === null ? null : { name: n, from: Math.round(before), to: Math.round(h.rating) };
    }).filter(Boolean);
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
  var LOOK_BACK_MS = 3 * 60000, BALL_TAIL_MS = 2000;
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

  // its clip, inside the recording (from, to): 25 s before the win was entered to 5 s after - or
  // the rule's start and stop (2026-11-26, the user: "i want to be able to control how long before
  // I click on the winner score the winning cue will stop ... from the start that is [x] seconds
  // before till [x] seconds before the click": { startMs, stopMs - before the win was entered, a
  // minus number: after it }) - and, the ball that won it gone in (shots: the camera's, notBefore:
  // the game before's win - see ballIn; rule.ballIn false: not looked for), as long a clip ending
  // 2 s after it - or rule.tailMs after it (2026-11-28, the user: "2 s after the last shot ... I want
  // to be able to change the 2 into what I want")
  // -> { startedAt, endedAt, ballInAt, how } (ballInAt / how: only when the ball's moment was found)
  function clipSpan(at, from, to, shots, notBefore, rule) {
    var r = rule || {}, startMs = typeof r.startMs === "number" ? r.startMs : BEFORE_MS, stopMs = typeof r.stopMs === "number" ? r.stopMs : -AFTER_MS;
    var b = r.ballIn === false ? null : ballIn(at, shots, notBefore), tailMs = typeof r.tailMs === "number" ? r.tailMs : BALL_TAIL_MS;
    if (!b) return { startedAt: Math.max(from, at - startMs), endedAt: Math.min(to, at - stopMs) };
    var end = Math.min(to, b.at + tailMs);
    return { startedAt: Math.max(from, end - (startMs - stopMs)), endedAt: end, ballInAt: b.at, how: b.how };
  }

  var api = { between: between, clipSpan: clipSpan, ballIn: ballIn, shotName: shotName, scoreAt: scoreAt, stamp: stamp, ratingsAt: ratingsAt, BEFORE_MS: BEFORE_MS, AFTER_MS: AFTER_MS, BALL_TAIL_MS: BALL_TAIL_MS };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.winningShots = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
