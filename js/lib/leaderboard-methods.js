// js/lib/leaderboard-methods.js
// The Leaderboard's other ways to pick the leader (2026-11-17, the user: "up to 3 different ways to
// calculate ... keep the default as is but propose 3 great ways to motivate players that don't play
// as often as others"). The default, the MVP score, stays in js/app.js
// (computeLeaderboardScoreBreakdown) as it was; these three only look at how well someone plays,
// never how much:
// - "performance": the rating you played at over the period - the opponents' average rating
//   + 100 × log2((won + 2) ÷ (lost + 2)) (100 rating points = 2-to-1 odds, the rating's own scale);
//   beating strong players counts most, more games add nothing by themselves;
// - "last10": everyone judged on the same 10 games - the wins in your last 10 of the period, a game
//   not played yet counting half a win;
// - "bestNights": the average of your 3 best nights' performance (a pool night, 5 a.m. to 5 a.m.,
//   of 3 games or more); a night you haven't had counts at your rating, so a bad night - or none -
//   never costs anything.
// Who is ranked at all is js/app.js's: only players already onboarded - a rating established, no
// longer provisional (the user: "they should be onboarded already, same for all ratings").
// Pure: no page, no storage, no app state - games come in as {ts, won, opp, names} (opp: the
// opponents' average rating, null when there were none; names: who they were, for 🧗). js/app.js calls it through PMCLib.leaderboardMethods,
// the unit tests (tests/unit/) load it in Node.
(function (root) {
  "use strict";

  var METHODS = ["mvp", "performance", "last10", "bestNights"];
  // (every method: ranked from 3 games - for best nights, a night counts from 3)
  var MIN_GAMES = 3;
  // the games won and lost each start at 2, so 2 games won of 2 isn't +infinity, and a few games
  // can't outweigh many (3-0 is +132, 40-10 +181)
  var PRIOR = 2;
  var LAST_GAMES = 10;
  var BEST_NIGHTS = 3;

  function isMethod(m) {
    return METHODS.indexOf(m) !== -1;
  }

  function time(g) {
    var t = new Date(g.ts).getTime();
    return isNaN(t) ? 0 : t;
  }

  // the rating played at: opponents' average + 100 × log2((won + 2) ÷ (lost + 2)) - over games
  // with opponents (a game with none tells nothing of how well it was played)
  function performanceOf(games) {
    var rated = games.filter(function (g) {
      return typeof g.opp === "number" && isFinite(g.opp);
    });
    if (!rated.length) return null;
    var won = 0;
    var oppSum = 0;
    rated.forEach(function (g) {
      if (g.won) won += 1;
      oppSum += g.opp;
    });
    var lost = rated.length - won;
    var opp = oppSum / rated.length;
    var edge = 100 * (Math.log((won + PRIOR) / (lost + PRIOR)) / Math.LN2);
    return { score: opp + edge, opp: opp, edge: edge, won: won, lost: lost, games: rated.length };
  }

  function performance(games) {
    var p = performanceOf(games || []);
    return p && p.games >= MIN_GAMES ? p : null;
  }

  // the wins in the last 10 games; fewer than 10: each one missing is half a win
  function last10(games) {
    games = (games || []).slice().sort(function (a, b) {
      return time(b) - time(a);
    });
    if (games.length < MIN_GAMES) return null;
    var counted = games.slice(0, LAST_GAMES);
    var won = counted.filter(function (g) {
      return g.won;
    }).length;
    var missing = LAST_GAMES - counted.length;
    return { score: won + missing / 2, won: won, played: counted.length, missing: missing, results: counted };
  }

  // the average of the 3 best nights' performance; a night not had (yet) counts at the rating
  function bestNights(games, rating, dayOf) {
    dayOf = dayOf || (root.PMCLib && root.PMCLib.poolDay && root.PMCLib.poolDay.localDateStrFromTs);
    var byDay = {};
    var days = [];
    (games || []).forEach(function (g) {
      var day = dayOf(g.ts);
      if (!byDay[day]) {
        byDay[day] = [];
        days.push(day);
      }
      byDay[day].push(g);
    });
    var nights = [];
    days.forEach(function (day) {
      var p = performanceOf(byDay[day]);
      if (p && p.games >= MIN_GAMES) nights.push({ day: day, score: p.score, opp: p.opp, won: p.won, lost: p.lost, games: p.games, results: byDay[day] });
    });
    if (!nights.length) return null;
    nights.sort(function (a, b) {
      return b.score - a.score || (a.day < b.day ? 1 : -1);
    });
    var best = nights.slice(0, BEST_NIGHTS);
    var filled = BEST_NIGHTS - best.length;
    var sum = best.reduce(function (s, n) {
      return s + n.score;
    }, 0);
    return { score: (sum + filled * rating) / BEST_NIGHTS, nights: best, filled: filled, rating: rating, nightsPlayed: nights.length };
  }

  // one entry's result for a method: {score, ...} or null (not ranked)
  function score(method, games, rating, dayOf) {
    if (method === "performance") return performance(games);
    if (method === "last10") return last10(games);
    if (method === "bestNights") return bestNights(games, rating, dayOf);
    return null;
  }

  // the order: the score, then (last 10) the more games really played, then the rating
  function compare(method, a, b) {
    var d = b.result.score - a.result.score;
    if (Math.abs(d) > 1e-9) return d;
    if (method === "last10" && b.result.played !== a.result.played) return b.result.played - a.result.played;
    return (b.rating || 0) - (a.rating || 0);
  }

  // 🧗 how to climb: the fewest k (1 to max) for which passes(k) holds - null when even max won't
  function fewest(passes, max) {
    for (var k = 1; k <= max; k++) if (passes(k)) return k;
    return null;
  }

  // k games in a row, all won (or all lost), against opponents rated opp, named names, a second
  // apart from ts
  function streak(k, won, opp, names, ts) {
    var t = new Date(ts).getTime();
    var out = [];
    for (var i = 0; i < k; i++) out.push({ ts: new Date(t + i * 1000).toISOString(), won: won, opp: opp, names: names || [] });
    return out;
  }

  // the games by opponent, most played first: [{names, won, lost, opp (their average rating, null
  // when none), games}]
  function byOpponent(games) {
    var groups = {};
    var order = [];
    (games || []).forEach(function (g) {
      var names = (g.names || []).slice().sort();
      var key = names.join("\n");
      if (!groups[key]) {
        groups[key] = { names: names, won: 0, lost: 0, oppSum: 0, oppCount: 0, games: [] };
        order.push(key);
      }
      var o = groups[key];
      if (g.won) o.won += 1;
      else o.lost += 1;
      if (typeof g.opp === "number" && isFinite(g.opp)) {
        o.oppSum += g.opp;
        o.oppCount += 1;
      }
      o.games.push(g);
    });
    return order
      .map(function (key) {
        var o = groups[key];
        return { names: o.names, won: o.won, lost: o.lost, opp: o.oppCount ? o.oppSum / o.oppCount : null, games: o.games };
      })
      .sort(function (a, b) {
        return b.games.length - a.games.length || b.won - a.won;
      });
  }

  // "7½" for 7.5 - the last-10 score as said
  function halves(n) {
    var whole = Math.floor(n);
    return n - whole >= 0.5 ? (whole ? whole + "½" : "½") : String(whole);
  }

  var api = {
    METHODS: METHODS,
    MIN_GAMES: MIN_GAMES,
    PRIOR: PRIOR,
    LAST_GAMES: LAST_GAMES,
    BEST_NIGHTS: BEST_NIGHTS,
    isMethod: isMethod,
    performance: performance,
    last10: last10,
    bestNights: bestNights,
    score: score,
    compare: compare,
    fewest: fewest,
    streak: streak,
    byOpponent: byOpponent,
    halves: halves
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.leaderboardMethods = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
