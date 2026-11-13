// js/lib/night-timeline.js
// A night as a sequence of matches, for 🧊 The night in 3D (js/night-map.js,
// js/night-braid.js): who played whom, which game, who won, the score - and
// between two matches, who came in, who sat down, who changed partner.
// Pure: no page, no storage, no app state - js/app.js calls it through
// PMCLib.nightTimeline (loaded before it), the unit tests load it in Node.
//
// build(dayKey, src, opts) -> { day, title, note, players, matches, rackCount, warnings }
//   src = { playerStats, gameHistory, tournamentResults, dayNotes } - the app's
//     PLAYER_STATS, state.gameHistory, TOURNAMENT_RESULTS and DAY_NOTES, or the
//     same keys of a backup file ({ playerStats, state.gameHistory, ... }).
//   opts = { mergeOpenPlay (default true: the same sides again with no race set
//     are one match, "2-0"), locale (the title's), gameLabel(gameType, label) }
//   players[] = { id, name, short, color, played, won } - id is a slug of the
//     name (a saved game carries names only), short the first name when that
//     tells everyone apart, played / won the racks (games), as on the board.
//   matches[] = { n, startedAt, endedAt (local "YYYY-MM-DDTHH:MM:SS"),
//     startEstimated, mode "teams" | "individual", freeForAll, rotatingTeams,
//     game, gameType, raceTo, finished, sides[{ players[ids], score, points,
//     raceTo, board }], winner (index, or null: level when it stopped),
//     skunk, ballsLeft, stoppedEarly, tournament, sidesMerged,
//     changes { in, out, stayed, keptSides, winnerStayed, gapMinutes,
//     partnersSwitched } (null for the first), racks[] }
// What the stored games can't say: the order of the waiting line, a player
// subbed in mid-game, and - mostly - when a game started (only when its
// first shot was timed; else the match before's end, startEstimated).
(function (root) {
  "use strict";

  // 12 colours told apart on a dark ground, by colour-blind eyes too as far
  // as 12 can be (the first 8 clearly) - and away from the winners' gold
  var COLORS = ["#5aa9ff", "#ff8f45", "#45e0b5", "#f0549f", "#d9c9ff", "#5b9a68", "#9466d8", "#d3571d", "#adee72", "#159cb7", "#8cb57e", "#c8a2cb"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  // (= js/lib/pool-day.js localDateStrFromTs: local time, 5 a.m. to 5 a.m.)
  function poolDay(ts) {
    var d = new Date(ts);
    if (d.getHours() < 5) d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function localIso(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }
  function nameKey(n) { return String(n || "").replace(/\s+/g, " ").trim().toLowerCase(); }
  function sameGame(winners, losers, label) {
    return [winners.map(nameKey).sort().join("+"), losers.map(nameKey).sort().join("+"), label || ""].join("|");
  }

  // Every rack of the day, once: by its time (ts) - the open session's entry
  // first, else a winner's saved copy, else a loser's (whose "opponents" are
  // the winners).
  function collectRacks(dayKey, src) {
    var byTs = {};
    function put(ts, rank, g, winners, losers) {
      if (!byTs[ts] || byTs[ts].rank < rank) byTs[ts] = { rank: rank, g: g, winners: winners, losers: losers };
    }
    var saved = {};
    Object.keys(src.playerStats || {}).forEach(function (owner) {
      ((src.playerStats[owner] || {}).sessions || []).forEach(function (s) {
        (s.games || []).forEach(function (g) {
          if (!g || !g.ts || poolDay(g.ts) !== dayKey) return;
          if (g.result === "won") put(g.ts, 2, g, g.winnerNames || [owner], g.opponentNames || s.opponents || []);
          else put(g.ts, 1, g, g.winnerNames || g.opponentNames || [], [owner].concat(g.teammateNames || []));
          saved[g.ts] = true;
        });
      });
    });
    // The open session's entries. One whose game is already saved under
    // another time - the same sides, the same game, and that saved one with
    // no open entry of its own - is that game again, not one more (seen on a
    // real night: the last rack, filed at 5:00 p.m. and still open at 8:02).
    // Only when the open session was filed already (some of its entries
    // saved under their own time): a new session after a saved one starts
    // with nothing filed, and the same game again in it is one more.
    var live = (src.gameHistory || []).filter(function (e) {
      return e && typeof e !== "string" && e.ts && e.winnerNames && poolDay(e.ts) === dayKey;
    });
    var filed = live.some(function (e) { return saved[e.ts]; });
    var liveTs = {}, orphans = {};
    live.forEach(function (e) { liveTs[e.ts] = true; });
    Object.keys(byTs).forEach(function (ts) {
      if (liveTs[ts]) return;
      var k = sameGame(byTs[ts].winners, byTs[ts].losers, byTs[ts].g.gameLabel);
      orphans[k] = (orphans[k] || 0) + 1;
    });
    live.forEach(function (e) {
      if (filed && !saved[e.ts]) {
        var k = sameGame(e.winnerNames, e.opponentNames || [], e.gameLabel);
        if (orphans[k] > 0) { orphans[k] -= 1; return; }
      }
      put(e.ts, 3, e, e.winnerNames, e.opponentNames || []);
    });
    return byTs;
  }

  function build(dayKey, src, opts) {
    src = src || {};
    opts = opts || {};
    var mergeOpenPlay = opts.mergeOpenPlay !== false;
    var warnings = [], players = [], idByKey = {};
    var byTs = collectRacks(dayKey, src);

    function pid(name) {
      var k = nameKey(name);
      if (!idByKey[k]) {
        var slug = k.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "p", id = slug, n = 2;
        while (players.some(function (p) { return p.id === id; })) id = slug + "-" + n++;
        idByKey[k] = id;
        players.push({ id: id, name: String(name), played: 0, won: 0 });
      }
      return idByKey[k];
    }
    function player(id) { return players.filter(function (p) { return p.id === id; })[0]; }
    function sideKey(ids) { return ids.slice().sort().join("+"); }
    // (only the open session's entry says "tournament"; a saved one is a
    // tournament's when it falls inside a recorded one of its players)
    function tournamentOf(g, names) {
      if (g.tournamentId) return g.tournamentId;
      var hit = (src.tournamentResults || []).filter(function (r) {
        if (!r || r.format === "session-race" || !r.tournamentId || !(r.tournamentId <= g.ts && g.ts <= r.ts)) return false;
        var keys = (r.players || []).map(nameKey);
        return names.every(function (n) { return keys.indexOf(nameKey(n)) !== -1; });
      })[0];
      return hit ? hit.tournamentId : null;
    }

    // the racks in order; the winners are side 0
    var racks = Object.keys(byTs).sort().map(function (ts) {
      var r = byTs[ts], g = r.g, isTeam = !!g.isTeam;
      var sideNames = [r.winners].concat(isTeam ? [r.losers] : r.losers.map(function (n) { return [n]; })).filter(function (s) { return s.length; });
      var sides = sideNames.map(function (names) { return names.map(pid); });
      // (3 teams at the table: every other team comes as one list)
      var merged = isTeam && r.losers.length > r.winners.length;
      if (merged) warnings.push(ts + ": the losing side is 2+ teams in one list");
      if (sides.length < 2) warnings.push(ts + ": no losing side on record");
      // (a rack scored with one "+" has no score but the win)
      var hasPoints = !!g.scores && !(g.unit === "rack" && (g.target || 1) <= 1);
      var endMs = Date.parse(ts);
      return {
        endMs: endMs, startMs: typeof g.durationMs === "number" && g.durationMs > 0 ? endMs - g.durationMs : null,
        mode: isTeam ? "teams" : sides.length > 2 ? "freeForAll" : "individual", rotatingTeams: !!g.rotatingTeams, sidesMerged: merged,
        gameType: g.gameType || null, game: g.gameLabel || g.gameType || "", target: g.target || null,
        raceTarget: g.raceTarget > 1 ? g.raceTarget : null, endsRace: !!(g.wonRace || g.raceInterrupted), interrupted: !!g.raceInterrupted,
        raceTally: g.raceTally || null, names: sideNames, sides: sides, keys: sides.map(sideKey),
        points: hasPoints ? sideNames.map(function (names) { return names.reduce(function (t, n) { return t + (typeof g.scores[n] === "number" ? g.scores[n] : 0); }, 0); }) : null,
        ballsLeft: typeof g.ballsLeftOnTable === "number" ? g.ballsLeftOnTable : null, skunk: !!g.skunk,
        tournamentId: tournamentOf(g, r.winners.concat(r.losers))
      };
    });

    // racks into matches: the same sides and game again, until the race is over
    var groups = [], cur = null;
    racks.forEach(function (rk) {
      var sig = rk.keys.slice().sort().join(" v ") + "|" + rk.gameType + "|" + rk.target + "|" + rk.mode + "|" + (rk.tournamentId || ""), racing = !!rk.raceTarget;
      if (!cur || cur.sig !== sig || cur.closed || cur.racing !== racing || (!racing && !mergeOpenPlay)) {
        cur = { sig: sig, racing: racing, closed: false, keys: rk.keys.slice(), sides: rk.sides, names: rk.names, wins: {}, raceTo: {}, racks: [] };
        rk.keys.forEach(function (k) { cur.wins[k] = 0; });
        groups.push(cur);
      }
      var w = rk.keys[0];
      cur.wins[w] += 1;
      if (racing) cur.raceTo[w] = rk.raceTarget;
      cur.racks.push(rk);
      if (rk.endsRace || (racing && cur.wins[w] >= rk.raceTarget)) cur.closed = true;
    });

    var prev = null;
    var matches = groups.map(function (m, i) {
      var first = m.racks[0], last = m.racks[m.racks.length - 1];
      var best = Math.max.apply(null, m.keys.map(function (k) { return m.wins[k]; }));
      var leaders = m.keys.filter(function (k) { return m.wins[k] === best; });
      var winner = leaders.length === 1 ? m.keys.indexOf(leaders[0]) : null;
      var raceTos = m.keys.map(function (k) { return m.raceTo[k] || null; }).filter(Boolean);
      // (a race: finished, or 2+ racks of it by these sides - partners who
      // change at every rack with a race set are so many 1-rack matches)
      var isRace = m.racing && raceTos.length > 0 && (m.closed || m.racks.length > 1);
      var startMs = first.startMs !== null ? first.startMs : prev ? prev.endMs : null;
      var here = [].concat.apply([], m.sides), changes = null;
      if (prev) {
        var before = [].concat.apply([], prev.sides);
        var keptSides = m.keys.map(function (k, idx) { return prev.keys.indexOf(k) !== -1 ? idx : -1; }).filter(function (x) { return x !== -1; });
        var stayed = here.filter(function (id) { return before.indexOf(id) !== -1; });
        // two who stay, together before and apart now - or apart, now together
        var switched = stayed.some(function (a) {
          return stayed.some(function (b) {
            if (a >= b) return false;
            var was = prev.sides.some(function (s) { return s.indexOf(a) !== -1 && s.indexOf(b) !== -1; });
            var is = m.sides.some(function (s) { return s.indexOf(a) !== -1 && s.indexOf(b) !== -1; });
            return was !== is;
          });
        });
        changes = {
          "in": here.filter(function (id) { return before.indexOf(id) === -1; }),
          out: before.filter(function (id) { return here.indexOf(id) === -1; }),
          stayed: stayed, keptSides: keptSides,
          winnerStayed: prev.winnerKey ? m.keys.indexOf(prev.winnerKey) !== -1 : null,
          gapMinutes: first.startMs !== null ? Math.round((first.startMs - prev.endMs) / 60000) : null,
          partnersSwitched: m.sides.some(function (s) { return s.length > 1; }) && switched
        };
      }
      prev = { sides: m.sides, keys: m.keys, endMs: last.endMs, winnerKey: winner === null ? null : m.keys[winner] };
      // (games played and won: every rack counts, as on the board)
      m.sides.forEach(function (ids, s) {
        ids.forEach(function (id) {
          var p = player(id);
          p.played += m.racks.length;
          p.won += m.wins[m.keys[s]];
        });
      });
      var one = m.racks.length === 1;
      return {
        n: i + 1,
        startedAt: startMs === null ? null : localIso(startMs), endedAt: localIso(last.endMs), startEstimated: first.startMs === null,
        mode: first.mode === "freeForAll" ? "individual" : first.mode, freeForAll: first.mode === "freeForAll", rotatingTeams: first.rotatingTeams,
        game: opts.gameLabel ? opts.gameLabel(first.gameType, first.game) : first.game, gameType: first.gameType,
        raceTo: isRace ? Math.max.apply(null, raceTos) : undefined, finished: !m.racing || m.closed,
        sides: m.sides.map(function (ids, s) {
          var side = { players: ids, score: m.wins[m.keys[s]] };
          if (isRace && m.raceTo[m.keys[s]]) side.raceTo = m.raceTo[m.keys[s]];
          if (last.points) side.points = last.points[s];
          // (one against one: the board's own count, the race's - a race played in several stints)
          if (ids.length === 1 && last.raceTally && typeof last.raceTally[m.names[s][0]] === "number") side.board = last.raceTally[m.names[s][0]];
          return side;
        }),
        winner: winner,
        skunk: one && first.skunk, ballsLeft: one ? first.ballsLeft : null, stoppedEarly: last.interrupted,
        tournament: !!first.tournamentId, sidesMerged: first.sidesMerged,
        changes: changes,
        racks: m.racks.map(function (rk) {
          return { endedAt: localIso(rk.endMs), durationMs: rk.startMs === null ? null : rk.endMs - rk.startMs, winner: m.keys.indexOf(rk.keys[0]), points: rk.points, ballsLeft: rk.ballsLeft, skunk: rk.skunk };
        })
      };
    });

    // first names where they tell everyone apart; a colour each, in order of appearance
    var firsts = {};
    players.forEach(function (p) { var f = nameKey(p.name.split(/\s+/)[0]); firsts[f] = (firsts[f] || 0) + 1; });
    players.forEach(function (p, i) {
      var f = p.name.split(/\s+/)[0];
      p.short = firsts[nameKey(f)] === 1 ? f : p.name;
      p.color = COLORS[i % COLORS.length];
    });

    var title = dayKey;
    try { title = new Date(dayKey + "T12:00:00").toLocaleDateString(opts.locale || "en", { weekday: "long", day: "numeric", month: "long", year: "numeric" }); } catch (e) {}
    return { day: dayKey, title: title, note: (src.dayNotes || {})[dayKey] || "", players: players, matches: matches, rackCount: racks.length, warnings: warnings };
  }

  // The days with games, newest first: [{ day, racks }]
  function days(src) {
    src = src || {};
    var seen = {}, count = {};
    function add(ts) {
      if (!ts || seen[ts]) return;
      seen[ts] = true;
      var d = poolDay(ts);
      count[d] = (count[d] || 0) + 1;
    }
    Object.keys(src.playerStats || {}).forEach(function (owner) {
      ((src.playerStats[owner] || {}).sessions || []).forEach(function (s) { (s.games || []).forEach(function (g) { if (g) add(g.ts); }); });
    });
    (src.gameHistory || []).forEach(function (e) { if (e && typeof e !== "string" && e.winnerNames) add(e.ts); });
    return Object.keys(count).sort().reverse().map(function (d) { return { day: d, racks: count[d] }; });
  }

  var api = { build: build, days: days, COLORS: COLORS };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.nightTimeline = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
