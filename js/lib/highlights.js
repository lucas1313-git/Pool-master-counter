// js/lib/highlights.js
// Tonight's highlights (P35): which of the recorder's cues make the reel. Each cue is matched, by
// time, to what the scoreboard recorded around it - a rack or a race won (the game history's ts),
// a break-and-run or another rack tag, a long run (the run records) - and scored; the best go in
// until the reel is about a minute long, then play in the order they happened. Only players who
// said yes to highlights are in it: a cue with anyone on it who hasn't is left out.
// Pure: no page, no storage, no app state - js/app.js calls it through PMCLib.highlights (loaded
// before it), and the unit tests (tests/unit/) load it in Node.
(function (root) {
  "use strict";

  // what each kind of moment is worth (a cue can have several)
  var HIGHLIGHT_POINTS = { raceWin: 8, breakAndRun: 7, goldenBreak: 7, eightOnBreak: 6, tenOnBreak: 6, longRun: 5, rackWin: 3, marked: 1 };
  // balls in a row worth a highlight
  var LONG_RUN = 8;
  // a win is credited a little after the shot that won it
  var CREDIT_AFTER_MS = 60000;

  function highlightMs(v) {
    if (typeof v === "number") return v;
    var n = Date.parse(v);
    return isNaN(n) ? null : n;
  }

  // the game won during (or just after) a cue - the nearest one
  function highlightGame(cue, games) {
    var a = highlightMs(cue.startedAt), b = highlightMs(cue.endedAt);
    if (a === null || b === null) return null;
    var best = null, bestGap = Infinity;
    (games || []).forEach(function (g) {
      var ts = highlightMs(g.ts);
      if (ts === null || ts < a || ts > b + CREDIT_AFTER_MS) return;
      var gap = Math.abs(ts - b);
      if (gap < bestGap) {
        bestGap = gap;
        best = g;
      }
    });
    return best;
  }

  // Why a cue is worth showing: [{ kind, name?, value? }]
  function highlightReasonList(cue, game, runs) {
    var out = [];
    var a = highlightMs(cue.startedAt), b = highlightMs(cue.endedAt);
    if (game) {
      var winner = (game.winnerNames || [])[0];
      out.push({ kind: game.wonRace ? "raceWin" : "rackWin", name: winner });
      (game.tags || []).forEach(function (tag) {
        if (HIGHLIGHT_POINTS[tag]) out.push({ kind: tag, name: winner });
      });
      var best = game.turns && game.turns.best;
      if (best && typeof best === "object") {
        Object.keys(best).forEach(function (n) {
          if (best[n] >= LONG_RUN) out.push({ kind: "longRun", name: n, value: best[n] });
        });
      }
    }
    (runs || []).forEach(function (r) {
      var ts = highlightMs(r.ts);
      if (ts === null || ts < a || ts > b + CREDIT_AFTER_MS || !(r.value >= LONG_RUN)) return;
      if (!out.some(function (x) { return x.kind === "longRun" && x.name === r.name; })) out.push({ kind: "longRun", name: r.name, value: r.value });
    });
    if (cue.source && !/^auto/.test(cue.source)) out.push({ kind: "marked" });
    return out;
  }

  function highlightScore(reasons) {
    return reasons.reduce(function (s, r) { return s + (HIGHLIGHT_POINTS[r.kind] || 0); }, 0);
  }

  // everyone a cue shows: its player and opponent, and the game's sides
  function highlightPeople(cue, game) {
    var names = [];
    var add = function (n) { if (n && names.indexOf(n) === -1) names.push(n); };
    String(cue.player || "").split(/\s*[&+,]\s*/).forEach(add);
    String(cue.opponent || "").split(/\s*[&+,]\s*/).forEach(add);
    if (game) (game.winnerNames || []).concat(game.opponentNames || []).forEach(add);
    return names;
  }

  // The part of a cue that goes in: at most clipMax seconds - around the
  // shot when the camera saw one, else the end (where the ball dropped).
  function highlightClipSpan(cue, clipMax) {
    var a = highlightMs(cue.startedAt), b = highlightMs(cue.endedAt);
    var max = clipMax * 1000;
    if (b - a <= max) return { from: a, to: b };
    var shot = highlightMs(cue.shotAt);
    if (shot !== null && shot >= a && shot <= b) {
      var from = Math.max(a, shot - max * 0.3);
      return { from: from, to: Math.min(b, from + max) };
    }
    return { from: b - max, to: b };
  }

  // cues: the recorder's (finished ones count); games: the night's game
  // history; runs: run records [{ name, value, ts }]; opts: { optedIn(name),
  // player (one player's reel; null: the night's), maxSeconds (60),
  // clipMax (12), clipMin (2) }.
  // -> { clips: [{ cue, game, from, to, seconds, reasons, score }] in time
  //      order, left: { notOptedIn: [names], dropped: n } }
  function pickHighlights(cues, games, runs, opts) {
    opts = opts || {};
    var maxSeconds = opts.maxSeconds || 60, clipMax = opts.clipMax || 12, clipMin = opts.clipMin || 2;
    var optedIn = opts.optedIn || function () { return false; };
    var notOptedIn = [];
    var candidates = [];
    (cues || []).forEach(function (cue) {
      if (cue.kind === "game") return; // (🎱 a game mark: when a game started, not a moment to show)
      var a = highlightMs(cue.startedAt), b = highlightMs(cue.endedAt);
      if (a === null || b === null || b - a < clipMin * 1000) return;
      var game = highlightGame(cue, games);
      var names = highlightPeople(cue, game);
      var missing = names.filter(function (n) { return !optedIn(n); });
      if (!names.length || missing.length) {
        missing.forEach(function (n) { if (notOptedIn.indexOf(n) === -1) notOptedIn.push(n); });
        return;
      }
      if (opts.player && names.indexOf(opts.player) === -1) return;
      var reasons = highlightReasonList(cue, game, runs);
      // (one player's reel: their own moments first - a rack they won, their run)
      var score = highlightScore(reasons) + (opts.player && reasons.some(function (r) { return r.name === opts.player; }) ? 2 : 0);
      var span = highlightClipSpan(cue, clipMax);
      candidates.push({ cue: cue, game: game, from: span.from, to: span.to, seconds: (span.to - span.from) / 1000, reasons: reasons, score: score });
    });
    candidates.sort(function (x, y) { return y.score - x.score || x.from - y.from; });
    var picked = [], total = 0;
    candidates.forEach(function (c) {
      if (picked.length && total + c.seconds > maxSeconds) return;
      picked.push(c);
      total += c.seconds;
    });
    picked.sort(function (x, y) { return x.from - y.from; });
    return { clips: picked, left: { notOptedIn: notOptedIn.sort(), dropped: candidates.length - picked.length } };
  }

  // The score bug's numbers: the race (or the game's score) as it stood
  // after this game - [{ name, value }] for the two sides, or null.
  function highlightBug(game) {
    if (!game) return null;
    var tally = game.raceTally;
    var w = (game.winnerNames || []).join(" & "), l = (game.opponentNames || []).join(" & ");
    if (tally && typeof tally === "object" && tally[w] !== undefined) return [{ name: w, value: tally[w] }, { name: l, value: tally[l] || 0 }];
    if (game.scores && typeof game.scores === "object" && !Array.isArray(game.scores) && game.scores[w] !== undefined) return [{ name: w, value: game.scores[w] }, { name: l, value: game.scores[l] || 0 }];
    return null;
  }

  var api = {
    HIGHLIGHT_POINTS: HIGHLIGHT_POINTS,
    LONG_RUN: LONG_RUN,
    highlightGameForCue: highlightGame,
    highlightReasons: highlightReasonList,
    highlightNames: highlightPeople,
    highlightSpan: highlightClipSpan,
    pickHighlights: pickHighlights,
    highlightBugScore: highlightBug
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.highlights = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
