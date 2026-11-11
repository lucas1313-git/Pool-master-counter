// js/night-replay.js
// ▶ Replay, in 🧊 The night in 3D: a night's matches played back one after
// the other on a small lit pool room - and above all the change of players.
// Everyone owns one seat on the bench all night; a step walks the losers
// out and the newcomers in (trails, IN / OUT / SWITCH tags), then the
// result lands: the score painted on the cloth, a crown and a gold ring for
// the winners, the losers gone dark. Around the room: a scoreboard (the
// game's ball, the sides, the score), chips that say the change in words,
// a timeline (tap, drag, ◀ ▶, ▶ Play) and a leaderboard that counts racks
// as the night goes (its last numbers are the night's played / won).
// The room is one canvas with its own perspective - a framed picture, dark
// and lit on every theme; all that's around it is plain DOM on the app's
// colours (CSS variables). Laid out by the width of its own root: the room
// and the leaderboard side by side from 960 px, stacked below. A root with
// no size (a closed panel) draws nothing and runs nothing; it starts when
// it gets a width, or at refresh().
//
// PMCNightReplay.mount(root, night, opts) -> handle
//   night = PMCLib.nightTimeline.build(...) (js/lib/night-timeline.js), or null
//   opts = { t(key, vars), tp(key, n, vars) } - the app's words; without
//     them, the English table below (keys "nightReplay.*", = languages/*.json)
//   handle = { setNight(night) - another day (none, or no match: one line),
//     refresh() - the language or the theme changed, or the panel just
//       opened: every word and the font read again, redrawn, the match kept,
//     destroy(), goTo(index), play(), pause(),
//     state() -> { count, index, playing, moving, width } }
// Keys, only while the focus is inside the root: ← → a match back / on,
// Home / End, space = play / pause. Drag the room to turn it, double-tap to
// set it back. prefers-reduced-motion: no walking, hop, confetti or sway.
(function () {
  "use strict";

  var EN = {
    "nightReplay.aria": "Replay of the night",
    "nightReplay.empty": "No games on this day.",
    "nightReplay.matchOf": "Match {{n}} / {{count}}",
    "nightReplay.matchN": "Match {{n}}",
    "nightReplay.sizes": "{{a}} v {{b}}",
    "nightReplay.sizes3": "{{a}} v {{b}} v {{c}}",
    "nightReplay.sizesMany": "{{n}} sides",
    "nightReplay.ended": "Ended {{time}}",
    "nightReplay.minutes": "{{n}} min",
    "nightReplay.points": "points",
    "nightReplay.hint": "Drag to rotate · double-tap to reset",
    "nightReplay.play": "▶ Play",
    "nightReplay.pause": "⏸ Pause",
    "nightReplay.first": "Back to the first match",
    "nightReplay.previous": "Previous match",
    "nightReplay.next": "Next match",
    "nightReplay.timeline": "Matches of the night",
    "nightReplay.leaderboard": "Leaderboard",
    "nightReplay.afterMatch": "After match {{n}}",
    "nightReplay.beforeFirst": "Before the first game",
    "nightReplay.holding": "Holding the table",
    "nightReplay.nobody": "Nobody",
    "nightReplay.streakOne": "win",
    "nightReplay.streakRun": "in a row",
    "nightReplay.bestRun": "Best run: {{names}} ×{{n}}",
    "nightReplay.noRunYet": "No win yet",
    "nightReplay.gameByGame": "Game by game",
    "nightReplay.wonPlayed": "Won / played",
    "nightReplay.holdsTable": "Holds table",
    "nightReplay.atTable": "At table",
    "nightReplay.tag.switch": "SWITCH",
    "nightReplay.chip.firstUp": "FIRST UP",
    "nightReplay.chip.in": "IN",
    "nightReplay.chip.out": "OUT",
    "nightReplay.chip.switched": "⇄ Partners switched",
    "nightReplay.chip.samePlayers": "Same players stay on",
    "nightReplay.chip.teams": "Teams · {{sizes}}",
    "nightReplay.chip.oneOnOne": "One against one",
    "nightReplay.chip.eachAlone": "Each for themselves",
    "nightReplay.chip.nowGame": "Now {{game}}",
    "nightReplay.chip.break": "☕ {{n}} min break",
    "nightReplay.chip.raceTo": "🏁 Race to {{n}}",
    "nightReplay.chip.tournament": "🏆 Tournament",
    "nightReplay.chip.skunk": "🦨 Skunk!",
    "nightReplay.chip.ballsLeft": "🎱 {{n}} balls left on the table",
    "nightReplay.chip.ballsLeftOne": "🎱 {{n}} ball left on the table",
    "nightReplay.chip.stopped": "⏸ Stopped early",
    "nightReplay.chip.level": "🤝 Level - no winner",
    "nightReplay.chip.lastRack": "Last rack: {{points}} points"
  };

  // the room keeps its own colours on every theme
  var GOLD = "#e8b923", INK = "#1a0a0a", STAGE = "#150808", IVORY = "#f6efe9";
  var FONT = '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
  // (a player the night's own list doesn't have - it always should)
  var SPARE = ["#5aa9ff", "#ff8f45", "#45e0b5", "#f0549f", "#d9c9ff", "#5b9a68", "#9466d8", "#d3571d", "#adee72", "#159cb7", "#8cb57e", "#c8a2cb"];

  // world geometry, metres-ish. x = along the table, z = away from the viewer, y = up
  var TL = 1.5, TW = 0.85, TH = 0.82;      // table: half length, half width, height
  var XO = 2.14;                           // where a side stands, beyond each end
  var FZ = -1.55;                          // ...and a third side: in front of the table
  var BZ0 = 2.02, TD = 0.62, TSTEP = 0.42; // bench: front edge, tier depth, tier height
  var SEATW = 0.69;
  var YAW0 = -0.25, PITCH0 = 0.56, DIST = 10.5;
  var WIDE = 960, TIGHT = 640;             // root width: side by side from; stage width: the small scoreboard below

  // the ball of each game, in its real colours
  var BALL_NO = { "8ball": 8, "8ballrotation": 8, "8ballpunishment": 8, "9ball": 9, "10ball": 10, "15ballrotation": 15, straight: 14, onepocket: 1 };
  var BALL_LOOK = { 1: ["#f2c21a", 0], 8: ["#141414", 0], 9: ["#f2c21a", 1], 10: ["#2a6fd6", 1], 14: ["#1f8a4c", 1], 15: ["#8a2230", 1] };
  function ballOf(gameType) {
    var no = BALL_NO[gameType] || 0, look = BALL_LOOK[no];
    if (look) return { no: no, color: look[0], stripe: !!look[1] };
    return { no: 0, color: gameType === "snooker" ? "#c62828" : "#f4efe6", stripe: false };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smooth(u) { return u * u * (3 - 2 * u); }
  function easeIO(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fill(str, vars) {
    return String(str).replace(/\{\{(\w+)\}\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; });
  }
  function rgb(h) {
    h = String(h || "").replace("#", "");
    if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    if (!/^[0-9a-f]{6}$/i.test(h)) h = "9db4cc";
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function mix(a, b, t) {
    var A = rgb(a), B = rgb(b);
    return "rgb(" + Math.round(A[0] + (B[0] - A[0]) * t) + "," + Math.round(A[1] + (B[1] - A[1]) * t) + "," + Math.round(A[2] + (B[2] - A[2]) * t) + ")";
  }
  function mixHex(a, b, t) {
    var A = rgb(a), B = rgb(b), i, o = "#", v;
    for (i = 0; i < 3; i++) { v = Math.round(A[i] + (B[i] - A[i]) * t).toString(16); o += (v.length < 2 ? "0" : "") + v; }
    return o;
  }
  function shades(c) {
    return { hi: mix(c, "#ffffff", 0.55), light: mix(c, "#ffffff", 0.22), base: c, dark: mix(c, "#000000", 0.32), deep: mix(c, "#000000", 0.55) };
  }
  function rgba(h, a) { var A = rgb(h); return "rgba(" + A[0] + "," + A[1] + "," + A[2] + "," + a + ")"; }
  function hhmm(s) { var m = /T(\d\d):(\d\d)/.exec(s || ""); return m ? m[1] + ":" + m[2] : ""; }
  function minuteOf(s) { var m = /T(\d\d):(\d\d)/.exec(s || ""); return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null; }
  // (the library's times are local, with no zone: counted as they read)
  function stamp(s) {
    var m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/.exec(s || "");
    return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
  }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  // ---- the model: everything is worked out from the night object ----
  // Where side number `i` of `count` stands: an end of the table (L, R), or -
  // three sides and more - in front of it (F0, F1...).
  function anchorsFor(n) {
    var out = [{ key: "L" }, { key: "R" }], f = n - 2, j;
    for (j = 0; j < f; j++) out.push({ key: "F" + j, fx: (j - (f - 1) / 2) * Math.min(1.5, 3 / f) });
    return out;
  }
  function slotPos(a, count, i) {
    if (a.key.charAt(0) === "F") return { x: a.fx + (i - (count - 1) / 2) * 0.7, z: FZ };
    var sgn = a.key === "L" ? -1 : 1, x = XO, z = 0;
    if (count === 2) { z = i === 0 ? -0.74 : 0.74; x = i === 0 ? XO + 0.1 : XO - 0.04; }
    else if (count >= 3) { z = -1.08 + 2.16 * i / (count - 1); x = (i % 2 === 0) ? XO + 0.46 : XO - 0.02; }
    return { x: sgn * x, z: z };
  }

  function buildModel(night) {
    var players = [], byId = {};
    function addPlayer(src) {
      if (!src || byId[src.id]) return;
      var c = /^#[0-9a-f]{6}$/i.test(src.color || "") ? src.color : SPARE[players.length % SPARE.length];
      var p = { id: src.id, name: String(src.name || src.id), idx: players.length, color: c, form: [] };
      p.label = String(src["short"] || p.name);
      p.sh = shades(c);
      p.shDim = shades(mixHex(c, "#1c0b0b", 0.6));
      p.sh.seat = mix(c, "#241010", 0.55); p.sh.seatEdge = mix(c, "#000000", 0.45);
      players.push(p); byId[p.id] = p;
    }
    ((night && night.players) || []).forEach(addPlayer);
    var raw = ((night && night.matches) || []).filter(function (m) {
      return m && m.sides && m.sides.length >= 2 && m.sides.every(function (s) { return s && s.players && s.players.length; });
    });
    raw.forEach(function (m) { m.sides.forEach(function (s) { s.players.forEach(function (id) { addPlayer({ id: id }); }); }); });
    var n = players.length;

    // the bench: every player owns one seat all night (known by the place as well as the colour)
    var tiers = n > 7 ? 2 : 1, perRow = Math.ceil(n / tiers) || 1;
    players.forEach(function (p, i) {
      var row = Math.floor(i / perRow), col = i % perRow;
      var inRow = row < tiers - 1 ? perRow : n - perRow * (tiers - 1);
      p.seat = { x: (col - (inRow - 1) / 2) * SEATW, y: TSTEP * (row + 1), z: BZ0 + TD * row + TD / 2 - 0.02, row: row };
    });

    var matches = [], prev = null, prevM = null, maxSide = 1, hasFront = false;
    var stats = {}; players.forEach(function (p) { stats[p.id] = { p: 0, w: 0 }; });
    var run = { key: "", ids: [], count: 0 }, best = { ids: [], count: 0 };

    raw.forEach(function (m, i) {
      var ns = m.sides.length, anchors = anchorsFor(ns), pick = [], taken = {};
      var w = (typeof m.winner === "number" && m.sides[m.winner]) ? m.winner : -1;
      if (ns > 2) hasFront = true;
      // which place does each side take? as many people as possible stay where they stand
      function stays(s, a) { var c = 0; s.players.forEach(function (id) { if (prev && prev[id] && prev[id].at === a.key) c++; }); return c; }
      if (ns === 2) {
        pick = stays(m.sides[0], anchors[1]) + stays(m.sides[1], anchors[0]) > stays(m.sides[0], anchors[0]) + stays(m.sides[1], anchors[1]) ? [1, 0] : [0, 1];
      } else {
        m.sides.forEach(function (s, k) {
          var bj = -1, bs = -1;
          anchors.forEach(function (a, j) { var sc = taken[j] ? -1 : stays(s, a); if (sc > bs) { bs = sc; bj = j; } });
          taken[bj] = true; pick[k] = bj;
        });
      }
      var place = {};
      m.sides.forEach(function (side, k) {
        var a = anchors[pick[k]], ids = side.players, c = ids.length, free = [], j;
        maxSide = Math.max(maxSide, c);
        for (j = 0; j < c; j++) free.push(j);
        ids.forEach(function (id) {             // who stays keeps the nearest spot
          var pv = prev && prev[id], bestK = -1, bestD = 1e9;
          if (!pv || pv.at !== a.key) return;
          free.forEach(function (sl) { var sp = slotPos(a, c, sl), d = Math.abs(sp.z - pv.z) + Math.abs(sp.x - pv.x); if (d < bestD) { bestD = d; bestK = sl; } });
          free.splice(free.indexOf(bestK), 1);
          var sp = slotPos(a, c, bestK); place[id] = { at: a.key, x: sp.x, z: sp.z };
        });
        ids.forEach(function (id) {
          if (place[id]) return;
          var sp = slotPos(a, c, free.shift()); place[id] = { at: a.key, x: sp.x, z: sp.z };
        });
      });

      var racks = (m.racks && m.racks.length) ? m.racks : (w >= 0 ? [{ winner: w }] : []);
      // one rack played for points: the points are its score ("8 : 6"); else the racks won
      var byPoints = racks.length <= 1 && m.sides.every(function (s) { return typeof s.points === "number"; });
      var timed = !!m.startedAt && !m.startEstimated, t0 = stamp(m.startedAt), t1 = stamp(m.endedAt);
      var counts = m.sides.map(function (s) { return s.players.length; }).sort(function (a, b) { return b - a; });
      var M = {
        i: i, n: m.n || (i + 1), start: timed ? m.startedAt : null, end: m.endedAt || null,
        // (a start that is only "the match before's end" is no start: a dinner break isn't a 3-hour game)
        mins: timed && t0 !== null && t1 !== null && t1 >= t0 ? Math.round((t1 - t0) / 60000) : null,
        game: String(m.game || m.gameType || ""), gameType: m.gameType || "", ball: ballOf(m.gameType), raceTo: m.raceTo || 0,
        byPoints: byPoints, counts: counts, place: place, all: [], winIds: [], loseIds: [], racks: racks.length,
        skunk: !!m.skunk, ballsLeft: typeof m.ballsLeft === "number" ? m.ballsLeft : null, stopped: !!m.stoppedEarly, tournament: !!m.tournament,
        lastPoints: !byPoints && m.sides.every(function (s) { return typeof s.points === "number"; }) ? m.sides.map(function (s) { return s.points; }) : null
      };
      // the sides as the picture shows them, left to right
      M.sides = m.sides.map(function (s, k) {
        var a = anchors[pick[k]];
        return { ids: s.players.slice(), at: a.key, fx: a.fx || 0, order: a.key === "L" ? -9 : (a.key === "R" ? 9 : a.fx), shown: byPoints ? s.points : (s.score || 0), won: k === w, src: k };
      }).sort(function (a, b) { return a.order - b.order; });
      m.sides.forEach(function (s, k) {
        s.players.forEach(function (id) { M.all.push(id); if (w >= 0) (k === w ? M.winIds : M.loseIds).push(id); });
      });
      M.isTeam = counts[0] > 1;
      M.sizeKey = counts.join("-");
      M.groupKey = (M.gameType || M.game) + "|" + M.sizeKey;

      // what changed since the match before (the library's word when it gives one)
      var c0 = m.changes, ch = { first: !prevM, ins: [], outs: [], switched: false, gameChanged: false, sizeChanged: false, gap: 0 };
      if (!prevM) ch.ins = M.all.slice();
      else {
        ch.ins = c0 && c0["in"] ? c0["in"].slice() : M.all.filter(function (id) { return !prevM.place[id]; });
        ch.outs = c0 && c0.out ? c0.out.slice() : prevM.all.filter(function (id) { return !place[id]; });
        ch.switched = !!(c0 && c0.partnersSwitched);
        ch.gameChanged = (prevM.gameType || prevM.game) !== (M.gameType || M.game);
        ch.sizeChanged = prevM.sizeKey !== M.sizeKey;
        ch.gap = c0 && typeof c0.gapMinutes === "number" ? c0.gapMinutes : 0;
      }
      ch.ins = ch.ins.filter(function (id) { return byId[id]; }); ch.outs = ch.outs.filter(function (id) { return byId[id]; });
      M.change = ch;

      // the running numbers: every rack counts, as on the board
      var keys = m.sides.map(function (s) { return s.players.slice().sort().join("|"); });
      racks.forEach(function (rk) {
        var rw = (typeof rk.winner === "number" && m.sides[rk.winner]) ? rk.winner : -1;
        m.sides.forEach(function (s, k) {
          s.players.forEach(function (id) { stats[id].p++; if (k === rw) stats[id].w++; byId[id].form.push({ i: i, w: k === rw }); });
        });
        if (rw >= 0 && keys[rw] === run.key) run = { key: run.key, ids: run.ids, count: run.count + 1 };
        else run = { key: rw >= 0 ? keys[rw] : "", ids: rw >= 0 ? m.sides[rw].players.slice() : [], count: rw >= 0 ? 1 : 0 };
        if (run.count > best.count) best = { ids: run.ids, count: run.count };
      });
      if (w < 0) run = { key: "", ids: [], count: 0 };   // level when it stopped: nobody holds the table
      M.stats = {}; players.forEach(function (p) { M.stats[p.id] = { p: stats[p.id].p, w: stats[p.id].w }; });
      M.streak = run; M.best = best;

      matches.push(M); prev = place; prevM = M;
    });

    return { players: players, byId: byId, matches: matches, tiers: tiers, perRow: perRow, maxSide: maxSide, hasFront: hasFront };
  }

  // ---- paths: how a token gets from A to B without crossing the table ----
  function crossesTable(ax, az, bx, bz) {
    var i, t, x, z;
    for (i = 1; i < 14; i++) {
      t = i / 14; x = ax + (bx - ax) * t; z = az + (bz - az) * t;
      if (Math.abs(x) < TL + 0.36 && Math.abs(z) < TW + 0.34) return true;
    }
    return false;
  }
  function inFront(q) { return q.z < -TW - 0.34 && Math.abs(q.x) < TL + 0.36; }
  // to a place in front of the table: round an end of it, along the edge of the rug
  function frontRoute(O, F, kind) {
    var sgn = Math.abs(O.x) > 0.3 ? (O.x > 0 ? 1 : -1) : (F.x < -0.05 ? -1 : 1), pts = [{ x: O.x, z: O.z }], lane;
    if (O.z > TW + 0.6) {
      lane = kind === "IN" ? 1.3 : 1.64;
      if (Math.abs(O.z - lane) > 0.3) pts.push({ x: O.x, z: lane });
      pts.push({ x: sgn * (XO + 0.62), z: lane }, { x: sgn * (XO + 0.62), z: F.z });
    } else pts.push({ x: sgn * 2.5, z: -1.1 }, { x: sgn * 1.75, z: F.z });
    pts.push({ x: F.x, z: F.z });
    return pts;
  }
  function routePoints(A, B, kind, blockers) {
    var pts = [{ x: A.x, z: A.z }], lane;
    if (crossesTable(A.x, A.z, B.x, B.z)) {
      if (inFront(B)) pts = frontRoute(A, B, kind);
      else if (inFront(A)) pts = frontRoute(B, A, kind).reverse();
      else {
        var benchy = A.z > TW + 0.6 || B.z > TW + 0.6;
        lane = benchy ? (kind === "IN" ? 1.3 : 1.64) : (A.x < B.x ? -1.4 : 1.42);
        var ax = A.x, bx = B.x;
        if (kind === "OUT") { ax = A.x + (A.x < 0 ? -0.42 : 0.42); pts.push({ x: ax, z: A.z + 0.35 }); }
        if (Math.abs(A.z - lane) > 0.3) pts.push({ x: ax, z: lane });
        if (Math.abs(B.z - lane) > 0.3) pts.push({ x: bx, z: lane });
        pts.push({ x: B.x, z: B.z });
      }
    } else pts.push({ x: B.x, z: B.z });
    // step around someone standing still in the way
    var out = [pts[0]], i;
    function sidestep(p, q) {
      var dx = q.x - p.x, dz = q.z - p.z, L2 = dx * dx + dz * dz;
      if (L2 < 0.01) return;
      blockers.forEach(function (bk) {
        var t = ((bk.x - p.x) * dx + (bk.z - p.z) * dz) / L2;
        if (t < 0.08 || t > 0.92) return;
        var cx = p.x + dx * t, cz = p.z + dz * t;
        if (Math.abs(cx - bk.x) + Math.abs(cz - bk.z) >= 0.5) return;
        if (inFront(bk)) out.push({ x: bk.x, z: bk.z - 0.66 }); else out.push({ x: bk.x + (bk.x < 0 ? -0.66 : 0.66), z: bk.z });
      });
    }
    for (i = 0; i < pts.length - 1; i++) { sidestep(pts[i], pts[i + 1]); out.push(pts[i + 1]); }
    return out;
  }
  function buildPath(c) {
    // a quadratic B-spline through the way-points (it stays inside their hull, so never cuts the table)
    var xs = [], zs = [], cum = [0], n = c.length - 1, i, j, S, E, t, u;
    function push(x, z) {
      if (xs.length) cum.push(cum[cum.length - 1] + Math.sqrt(Math.pow(x - xs[xs.length - 1], 2) + Math.pow(z - zs[zs.length - 1], 2)));
      xs.push(x); zs.push(z);
    }
    if (n === 1) { for (j = 0; j <= 10; j++) push(c[0].x + (c[1].x - c[0].x) * j / 10, c[0].z + (c[1].z - c[0].z) * j / 10); }
    else {
      S = c[0]; push(S.x, S.z);
      for (i = 1; i < n; i++) {
        E = (i === n - 1) ? c[n] : { x: (c[i].x + c[i + 1].x) / 2, z: (c[i].z + c[i + 1].z) / 2 };
        for (j = 1; j <= 14; j++) {
          t = j / 14; u = 1 - t;
          push(u * u * S.x + 2 * u * t * c[i].x + t * t * E.x, u * u * S.z + 2 * u * t * c[i].z + t * t * E.z);
        }
        S = E;
      }
    }
    return { xs: xs, zs: zs, cum: cum, len: cum[cum.length - 1] };
  }
  function pointAt(path, d) {
    var cum = path.cum, i = 1, n = cum.length - 1;
    if (d <= 0) return { x: path.xs[0], z: path.zs[0] };
    if (d >= path.len) return { x: path.xs[n], z: path.zs[n] };
    while (i < n && cum[i] < d) i++;
    var t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return { x: path.xs[i - 1] + (path.xs[i] - path.xs[i - 1]) * t, z: path.zs[i - 1] + (path.zs[i] - path.zs[i - 1]) * t };
  }

  // ---- the look of all that's around the room (the app's colours; crimson when alone) ----
  var CSS = [
    ".pmc-nr{display:block;position:relative;min-width:0;font:inherit;color:var(--text,#f6efe9);-webkit-user-select:none;user-select:none;outline:none}",
    ".pmc-nr:focus-visible{outline:2px solid var(--accent,#e8b923);outline-offset:4px;border-radius:var(--radius,14px)}",
    ".pmc-nr *{box-sizing:border-box}",
    ".pmc-nr-empty{padding:22px 8px;text-align:center;color:var(--text-dim,#c9a2a2)}",
    ".pmc-nr-grid{display:flex;flex-direction:column;gap:10px}",
    ".pmc-nr--wide .pmc-nr-grid{display:grid;grid-template-columns:minmax(0,1fr) 312px;grid-template-rows:auto auto}",
    ".pmc-nr--wide .pmc-nr-stage{grid-column:1;grid-row:1}",
    ".pmc-nr--wide .pmc-nr-board{grid-column:2;grid-row:1}",
    ".pmc-nr--wide .pmc-nr-tl{grid-column:1/-1;grid-row:2}",
    ".pmc-nr-stage{display:flex;flex-direction:column;gap:10px;min-width:0}",
    ".pmc-nr-score,.pmc-nr-board,.pmc-nr-tl{background:var(--bg-card,#2e1414);border:1px solid var(--border,#4a1e1e);border-radius:var(--radius,14px)}",
    // scoreboard
    ".pmc-nr-score{padding:14px 16px;display:grid;grid-template-columns:minmax(148px,auto) minmax(0,1fr) minmax(112px,auto);grid-template-areas:'ml vs mr';align-items:center;column-gap:10px}",
    ".pmc-nr-ml{grid-area:ml;display:flex;align-items:center;gap:10px;min-width:0}",
    ".pmc-nr-mr{grid-area:mr;text-align:right;min-width:0}",
    ".pmc-nr-ball{flex:none;width:38px;height:38px;border-radius:50%;position:relative;overflow:hidden;background:#101010;box-shadow:inset -5px -7px 10px rgba(0,0,0,.5),0 2px 5px rgba(0,0,0,.45)}",
    ".pmc-nr-ball b{position:absolute;left:50%;top:50%;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;background:#f8f4ec;color:#1a0a0a;font-size:12.5px;font-weight:800;line-height:20px;text-align:center;letter-spacing:-.04em}",
    ".pmc-nr-ball:after{content:'';position:absolute;left:18%;top:10%;width:34%;height:24%;border-radius:50%;background:rgba(255,255,255,.38);transform:rotate(-28deg)}",
    ".pmc-nr-no{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim,#c9a2a2);white-space:nowrap;font-variant-numeric:tabular-nums}",
    ".pmc-nr-no b{font-size:22px;color:var(--accent,#e8b923);letter-spacing:0;margin:0 1px}",
    ".pmc-nr-game{font-size:13px;font-weight:600;color:var(--text,#f6efe9);margin-top:1px;overflow-wrap:anywhere}",
    ".pmc-nr-time{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".pmc-nr-dur{font-size:12px;color:var(--text-dim,#c9a2a2);white-space:nowrap;margin-top:2px;min-height:15px}",
    ".pmc-nr-vs{grid-area:vs;display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;column-gap:14px;min-width:0}",
    ".pmc-nr-side{display:flex;flex-wrap:wrap;align-items:center;gap:6px 9px;min-width:0}",
    ".pmc-nr-side.L{justify-content:flex-end}",
    ".pmc-nr-side.R{justify-content:flex-start}",
    ".pmc-nr-nm{display:inline-block;max-width:100%;height:34px;line-height:34px;padding:0 14px;border-radius:999px;color:#1a0a0a;font-size:18px;font-weight:800;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" +
      "box-shadow:inset -4px -6px 9px rgba(0,0,0,.28),inset 3px 4px 6px rgba(255,255,255,.35);transition:opacity .3s}",
    ".pmc-nr-side.many .pmc-nr-nm{height:26px;line-height:26px;font-size:14px;padding:0 10px}",
    ".pmc-nr-lose .pmc-nr-nm{opacity:.45}",
    ".pmc-nr-win .pmc-nr-nm{box-shadow:inset -4px -6px 9px rgba(0,0,0,.28),inset 3px 4px 6px rgba(255,255,255,.35),0 0 0 2px var(--bg-card,#2e1414),0 0 0 4px var(--accent,#e8b923)}",
    ".pmc-nr-crown{position:absolute;left:50%;top:-13px;width:24px;height:18px;margin-left:-12px;fill:var(--accent,#e8b923);stroke:var(--bg-card,#2e1414);stroke-width:1.5;paint-order:stroke}",
    ".pmc-nr-pts{position:relative;display:flex;align-items:center;gap:8px;font-variant-numeric:tabular-nums}",
    ".pmc-nr-pts b,.pmc-nr-one b{display:block;position:relative;min-width:46px;height:50px;line-height:48px;padding:0 6px;text-align:center;font-size:34px;font-weight:800;" +
      "background:var(--bg,#1a0a0a);border:1px solid var(--border,#4a1e1e);border-radius:10px;color:var(--text,#f6efe9);transition:color .25s,border-color .25s}",
    ".pmc-nr-pts b.two,.pmc-nr-one b.two{font-size:27px}",
    ".pmc-nr-pts b.win,.pmc-nr-one b.win{color:var(--accent,#e8b923);border-color:var(--accent,#e8b923)}",
    ".pmc-nr-pts b.pend,.pmc-nr-one b.pend{color:var(--text-dim,#c9a2a2);opacity:.55}",
    ".pmc-nr-pts span{color:var(--text-dim,#c9a2a2);font-weight:800;font-size:20px}",
    ".pmc-nr-unit{position:absolute;left:0;right:0;bottom:-13px;text-align:center;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim,#c9a2a2);white-space:nowrap;line-height:1}",
    // (three sides and more: each side with its own score)
    ".pmc-nr-vs.each{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:8px 16px;position:relative}",
    ".pmc-nr-one{display:flex;align-items:center;gap:8px;min-width:0}",
    ".pmc-nr-one b{min-width:40px;height:42px;line-height:40px;font-size:26px}",
    ".pmc-nr-one b.two{font-size:22px}",
    ".pmc-nr-one .pmc-nr-crown{top:-12px;width:20px;height:15px;margin-left:-10px}",
    // the room
    ".pmc-nr-scene{position:relative;background:#150808;border:1px solid var(--border,#4a1e1e);border-radius:16px;overflow:hidden}",
    ".pmc-nr-scene:after{content:'';position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;border-radius:15px;box-shadow:inset 0 0 70px 10px rgba(10,3,3,.7)}",
    ".pmc-nr-view{position:relative;height:420px;touch-action:pan-y;cursor:grab}",
    ".pmc-nr-view.drag{cursor:grabbing}",
    ".pmc-nr-view canvas{position:absolute;left:0;top:0;width:100%;height:100%;display:block}",
    ".pmc-nr-hint{position:absolute;right:12px;top:9px;font-size:11px;color:#8a6464;letter-spacing:.04em;pointer-events:none}",
    ".pmc-nr-chips{position:absolute;z-index:2;left:10px;right:10px;bottom:9px;display:flex;flex-wrap:wrap;justify-content:center;gap:6px;pointer-events:none}",
    ".pmc-nr-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;min-height:28px;padding:3px 11px;border-radius:999px;font-size:13px;font-weight:600;" +
      "background:rgba(36,16,16,.92);border:1px solid #4a1e1e;color:#f6efe9;line-height:1.25}",
    ".pmc-nr-chip em{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.12em;color:#c9a2a2;white-space:nowrap}",
    ".pmc-nr-chip.in em{color:#e8b923}",
    ".pmc-nr-chip.gold{background:#e8b923;border-color:#e8b923;color:#1a0a0a;font-weight:800}",
    ".pmc-nr-chip.note{color:#e9cfcf}",
    ".pmc-nr-chip i{width:10px;height:10px;border-radius:50%;flex:none}",
    ".pmc-nr-chip .sep{color:#c9a2a2}",
    ".pmc-nr-chip .who{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}",
    // leaderboard
    ".pmc-nr-board{display:flex;flex-direction:column;min-width:0;padding:12px 10px 8px}",
    ".pmc-nr-lbhead{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 6px 8px}",
    ".pmc-nr-lbttl{font-size:15px;font-weight:700;color:var(--text,#f6efe9)}",
    ".pmc-nr-after{font-size:12px;color:var(--text-dim,#c9a2a2);font-variant-numeric:tabular-nums;text-align:right}",
    ".pmc-nr-hold{margin:0 2px 10px;padding:9px 12px 10px;border-radius:12px;border:1px solid var(--accent,#e8b923);" +
      "background:linear-gradient(180deg,rgba(232,185,35,.16),rgba(232,185,35,.05));display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:center}",
    ".pmc-nr-hold .k{grid-column:1/-1;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accent,#e8b923);margin-bottom:4px}",
    ".pmc-nr-hold .who{font-size:15px;font-weight:700;display:flex;flex-wrap:wrap;align-content:center;gap:1px 8px;min-width:0;min-height:40px;line-height:19px}",
    ".pmc-nr-hold .who span{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}",
    ".pmc-nr-hold .who .none{color:var(--text-dim,#c9a2a2)}",
    ".pmc-nr-hold .who i,.pmc-nr-chip i{box-shadow:0 0 0 1px rgba(0,0,0,.28)}",
    ".pmc-nr-hold .who i{width:11px;height:11px;border-radius:50%;flex:none}",
    ".pmc-nr-hold .run{text-align:right;line-height:1}",
    ".pmc-nr-hold .run b{font-size:28px;font-weight:800;color:var(--accent,#e8b923);font-variant-numeric:tabular-nums}",
    ".pmc-nr-hold .run small{display:block;font-size:10px;color:var(--text-dim,#c9a2a2);letter-spacing:.06em;text-transform:uppercase;margin-top:2px;white-space:nowrap}",
    ".pmc-nr-hold .best{grid-column:1/-1;font-size:11.5px;color:var(--text-dim,#c9a2a2);margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".pmc-nr-cols{display:flex;justify-content:space-between;gap:8px;padding:0 12px 4px 46px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim,#c9a2a2);opacity:.8}",
    ".pmc-nr-rows{position:relative;flex:1 1 auto;min-height:0}",
    ".pmc-nr-row{position:absolute;left:0;right:0;top:0;display:grid;grid-template-columns:16px 26px minmax(0,1fr) auto;column-gap:8px;align-items:center;" +
      "padding:0 10px 0 6px;border-radius:10px;transition:transform .55s cubic-bezier(.3,.9,.3,1),background-color .3s;will-change:transform}",
    ".pmc-nr-row.at{background:var(--bg,#1a0a0a)}",
    ".pmc-nr-row.hold{background:linear-gradient(90deg,rgba(232,185,35,.2),rgba(232,185,35,.05))}",
    ".pmc-nr-rank{font-size:12px;font-weight:700;color:var(--text-dim,#c9a2a2);opacity:.8;text-align:right;font-variant-numeric:tabular-nums}",
    ".pmc-nr-dot{width:26px;height:26px;border-radius:50%;box-shadow:inset -4px -5px 7px rgba(0,0,0,.4),inset 3px 3px 5px rgba(255,255,255,.28),0 0 0 1px rgba(0,0,0,.2)}",
    ".pmc-nr-row.hold .pmc-nr-dot{box-shadow:inset -4px -5px 7px rgba(0,0,0,.4),inset 3px 3px 5px rgba(255,255,255,.28),0 0 0 2px var(--bg-card,#2e1414),0 0 0 4px var(--accent,#e8b923)}",
    ".pmc-nr-mid{display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:0}",
    ".pmc-nr-name{font-size:14.5px;font-weight:700;line-height:1.15;white-space:nowrap;min-width:0;overflow:hidden;text-overflow:ellipsis}",
    ".pmc-nr-line{display:flex;align-items:center;gap:8px;min-width:0;height:14px}",
    ".pmc-nr-line small{flex:none;margin-left:auto;font-size:9px;font-weight:800;line-height:12px;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;color:var(--text-dim,#c9a2a2);border:1px solid var(--border,#4a1e1e);border-radius:999px;padding:0 6px}",
    ".pmc-nr-row.hold .pmc-nr-line small{color:var(--on-accent,#241a00);background:var(--accent,#e8b923);border-color:var(--accent,#e8b923)}",
    ".pmc-nr-form{display:flex;flex:1 1 auto;gap:3px;height:9px;min-width:0}",
    ".pmc-nr-form i{flex:0 1 9px;min-width:2px;height:9px;border-radius:5px;border:1.5px solid var(--text-dim,#c9a2a2);opacity:.6;transition:transform .35s cubic-bezier(.3,1.6,.5,1),opacity .3s}",
    ".pmc-nr-form i.w{border:0;opacity:1;box-shadow:inset -1px -2px 2px rgba(0,0,0,.3),0 0 0 1px rgba(0,0,0,.22)}",
    ".pmc-nr-form i.new{transform:scale(0);opacity:0}",
    ".pmc-nr-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--text-dim,#c9a2a2);font-size:13px}",
    ".pmc-nr-num b{font-size:21px;font-weight:800;color:var(--text,#f6efe9)}",
    ".pmc-nr-rows.compact .pmc-nr-mid{flex-direction:row;align-items:center;gap:8px}",
    ".pmc-nr-rows.compact .pmc-nr-name{flex:0 0 76px;font-size:13.5px}",
    ".pmc-nr-rows.compact .pmc-nr-line{flex:1}",
    ".pmc-nr-rows.compact .pmc-nr-line small{display:none}",
    ".pmc-nr-rows.compact .pmc-nr-num b{font-size:17px}",
    ".pmc-nr-rows.compact .pmc-nr-dot{width:22px;height:22px}",
    // timeline
    ".pmc-nr-tl{padding:8px 12px 9px;display:flex;gap:14px;align-items:flex-end}",
    ".pmc-nr-ctl{display:flex;gap:6px;flex:none;align-items:center}",
    ".pmc-nr-ctl button{width:48px;height:48px;min-width:0;margin:0;padding:0;border-radius:12px;border:1px solid var(--border,#4a1e1e);background:var(--bg,#1a0a0a);color:var(--text,#f6efe9);font:inherit;" +
      "display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:none;-webkit-tap-highlight-color:transparent}",
    ".pmc-nr-ctl button svg{width:18px;height:18px;fill:currentColor}",
    ".pmc-nr-ctl button:active{transform:scale(.95)}",
    ".pmc-nr-ctl button:disabled{opacity:.35;cursor:default}",
    ".pmc-nr-ctl .pmc-nr-play{width:auto;min-width:112px;padding:0 14px;background:var(--accent,#e8b923);border-color:var(--accent,#e8b923);color:var(--on-accent,#241a00);font-weight:800;font-size:15px;white-space:nowrap}",
    ".pmc-nr-ctl button:focus-visible,.pmc-nr-strip:focus-visible{outline:2px solid var(--accent,#e8b923);outline-offset:2px}",
    ".pmc-nr-tlwrap{flex:1;min-width:0}",
    ".pmc-nr-segs{display:flex;gap:4px;margin-bottom:4px}",
    ".pmc-nr-segs div{min-width:0;border-top:2px solid var(--border,#4a1e1e);padding-top:3px;font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-dim,#c9a2a2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
    ".pmc-nr-segs div.tiny{font-size:0;height:16px}",
    ".pmc-nr-segs div.solo{border-top-style:dashed;border-top-color:var(--text-dim,#c9a2a2)}",
    ".pmc-nr-strip{display:flex;height:55px;touch-action:none;cursor:pointer;position:relative;border-radius:8px;outline:none}",
    ".pmc-nr-tk{flex:1 1 0;min-width:0;padding:0 2px;display:flex;flex-direction:column;justify-content:flex-end;align-items:stretch;position:relative;opacity:.3;transition:opacity .3s,transform .25s}",
    ".pmc-nr-tk.gapL{margin-left:4px}",
    ".pmc-nr-tk.past,.pmc-nr-tk.cur{opacity:1}",
    ".pmc-nr-tk .n{font-size:11px;font-weight:700;color:var(--text-dim,#c9a2a2);text-align:center;line-height:13px;height:13px;margin-bottom:3px;font-variant-numeric:tabular-nums;overflow:hidden}",
    ".pmc-nr-tk.cur .n{color:var(--accent,#e8b923);transform:translateY(-2px)}",
    ".pmc-nr-tk .w{display:flex;height:22px;border-radius:5px 5px 2px 2px;overflow:hidden;margin-top:2px;box-shadow:inset 0 -3px 4px rgba(0,0,0,.25),inset 0 2px 2px rgba(255,255,255,.25)}",
    ".pmc-nr-tk .w i,.pmc-nr-tk .l i{flex:1}",
    ".pmc-nr-tk .w.none{background:var(--border,#4a1e1e);box-shadow:none}",
    ".pmc-nr-tk .l{display:flex;height:7px;border-radius:2px 2px 4px 4px;overflow:hidden;margin-top:2px;opacity:.5}",
    ".pmc-nr-tk .l.all{opacity:.9}",
    ".pmc-nr-tk.cur:after{content:'';position:absolute;left:-1px;right:-1px;top:19px;bottom:-4px;border:2px solid var(--accent,#e8b923);border-radius:8px;box-shadow:0 0 10px rgba(232,185,35,.4)}",
    ".pmc-nr-strip.thin .pmc-nr-tk{padding:0 .5px}",
    ".pmc-nr-strip.thin .n{visibility:hidden}",
    ".pmc-nr-strip.thin .pmc-nr-tk.cur .n{visibility:visible;overflow:visible;white-space:nowrap;display:flex;justify-content:center}",
    ".pmc-nr-strip.thin .w,.pmc-nr-strip.thin .l{border-radius:2px}",
    ".pmc-nr-strip.thin .pmc-nr-tk.gapL{margin-left:3px}",
    // a narrow root (a phone, a narrow panel)
    ".pmc-nr--tight .pmc-nr-score{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:'ml mr' 'vs vs';padding:9px 10px 16px;row-gap:14px}",
    ".pmc-nr--tight .pmc-nr-ball{width:30px;height:30px}",
    ".pmc-nr--tight .pmc-nr-ball b{width:16px;height:16px;margin:-8px 0 0 -8px;font-size:10px;line-height:16px}",
    ".pmc-nr--tight .pmc-nr-no b{font-size:18px}",
    ".pmc-nr--tight .pmc-nr-game{font-size:12px}",
    ".pmc-nr--tight .pmc-nr-time{font-size:13px}",
    ".pmc-nr--tight .pmc-nr-vs{column-gap:8px}",
    ".pmc-nr--tight .pmc-nr-nm{font-size:14.5px;height:28px;line-height:28px;padding:0 10px}",
    ".pmc-nr--tight .pmc-nr-side.many .pmc-nr-nm{font-size:12px;height:22px;line-height:22px;padding:0 7px}",
    ".pmc-nr--tight .pmc-nr-side{gap:5px 5px}",
    ".pmc-nr--tight .pmc-nr-pts b{min-width:38px;height:44px;line-height:42px;font-size:28px}",
    ".pmc-nr--tight .pmc-nr-pts b.two{font-size:23px}",
    ".pmc-nr--tight .pmc-nr-one b{min-width:34px;height:36px;line-height:34px;font-size:21px}",
    ".pmc-nr--tight .pmc-nr-chip{min-height:25px;font-size:11.5px;padding:2px 8px;gap:4px}",
    ".pmc-nr--tight .pmc-nr-chip i{width:8px;height:8px}",
    ".pmc-nr--tight .pmc-nr-hint{display:none}",
    ".pmc-nr--tight .pmc-nr-tl{display:block;padding:8px 10px 10px}",
    ".pmc-nr--tight .pmc-nr-ctl{margin-bottom:8px;justify-content:center}",
    ".pmc-nr--tight .pmc-nr-ctl .pmc-nr-play{flex:1;max-width:190px}",
    "@media (prefers-reduced-motion:reduce){.pmc-nr-row,.pmc-nr-tk,.pmc-nr-form i,.pmc-nr-nm,.pmc-nr-pts b,.pmc-nr-one b{transition:none!important}}"
  ].join("\n");

  var CROWN_SVG = '<svg class="pmc-nr-crown" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 16.5 1 4.5l6 5 5-8.5 5 8.5 6-5-1 12z"/></svg>';
  var ICON = {
    first: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 3h2.4v14H4zM17 3v14L7.5 10z"/></svg>',
    prev: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M14.5 3v14L4.5 10z"/></svg>',
    next: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 3v14l10-7z"/></svg>'
  };
  function addStyle() {
    if (document.getElementById("pmc-night-replay-style")) return;
    var s = document.createElement("style");
    s.id = "pmc-night-replay-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  // ---- mount ----
  function mount(root, night, opts) {
    if (root.__pmcNightReplay && root.__pmcNightReplay.destroy) root.__pmcNightReplay.destroy();
    opts = opts || {};
    function T(key, vars) {
      if (opts.t) return String(opts.t(key, vars));
      return fill(EN[key] === undefined ? key : EN[key], vars);
    }
    // (a count's sentence - "1 ball left" / "3 balls left": the app's own rule when it gives one)
    function TP(key, n, vars) {
      if (opts.tp) return String(opts.tp(key, n, vars));
      return T(n === 1 ? key + "One" : key, vars);
    }

    var dead = false, reduced = false, fontFam = FONT, words = {};
    var model, players, byId, MS, N, NP, el = null, tks = [], rowEls = {}, ctx = null;
    var cur = -1, revealed = false, playing = false, anim = null, raf = 0, lastT = 0;
    var celebT0 = -1e9, holdUntil = 0, particles = [], clockMin = 0, clockTarget = 0;
    var basePitch = PITCH0, view = { yaw: YAW0, pitch: PITCH0, drift: 0, amp: 0 };
    var W = 10, H = 10, rootW = -1, dpr = 1, rowH = 46, headK = 1, labelCache = {}, st = {};
    var sized = false, pending = false, wide = false, tight = false, chipH = 28, benchHW = 1, WALLZ = 3, WALLH = 3;
    var dragState = null, scrub = false, lastTap = 0, globals = [], observer = null, rz = 0;

    function chipNames(ids) {
      return ids.map(function (id) {
        var p = byId[id];
        return '<span class="who" title="' + esc(p.name) + '"><i style="background:' + p.color + '"></i>' + esc(p.label) + "</span>";
      }).join('<span class="sep">·</span>');
    }
    function sizesOf(M) {
      var c = M.counts;
      if (c.length === 2) return T("nightReplay.sizes", { a: c[0], b: c[1] });
      if (c.length === 3) return T("nightReplay.sizes3", { a: c[0], b: c[1], c: c[2] });
      return T("nightReplay.sizesMany", { n: c.length });
    }
    function groupLabel(M) { return M.game ? M.game + " · " + sizesOf(M) : sizesOf(M); }

    // ---- the night: model and state ----
    function load(nt) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      model = buildModel(nt); players = model.players; byId = model.byId; MS = model.matches; N = MS.length; NP = players.length;
      cur = -1; revealed = false; playing = false; anim = null; particles = []; celebT0 = -1e9; holdUntil = 0; dragState = null; scrub = false;
      clockMin = clockTarget = N ? firstMinute() : 19 * 60;
      view = { yaw: YAW0, pitch: PITCH0, drift: 0, amp: 0 };
      st = {};
      players.forEach(function (p) { st[p.id] = { x: p.seat.x, y: p.seat.y, z: p.seat.z, lift: 0, crown: 0, dim: 0, tag: null, tagA: 0 }; });
      benchHW = model.perRow * SEATW / 2 + 0.1; WALLZ = BZ0 + model.tiers * TD + 0.03; WALLH = model.tiers * TSTEP + 2.25;
      pending = N > 0; rootW = -1;
      build();
      measure();
    }
    function firstMinute() {
      var i, m;
      for (i = 0; i < N; i++) { m = minuteOf(MS[i].start || MS[i].end); if (m !== null) return m; }
      return 19 * 60;
    }
    function layoutFor(k) {
      var out = {}, id;
      players.forEach(function (p) { out[p.id] = { x: p.seat.x, y: p.seat.y, z: p.seat.z, at: "B" }; });
      if (k >= 0) { var pl = MS[k].place; for (id in pl) if (pl.hasOwnProperty(id) && out[id]) out[id] = { x: pl[id].x, y: 0, z: pl[id].z, at: pl[id].at }; }
      return out;
    }

    // ---- the DOM around the room (built again at refresh(): every word read again) ----
    function build() {
      var hadFocus = document.activeElement && root.contains(document.activeElement) && document.activeElement !== root;
      reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      // (the canvas writes in the theme's own font)
      try { fontFam = window.getComputedStyle(root).fontFamily || FONT; } catch (e) { fontFam = FONT; }
      words = { IN: T("nightReplay.chip.in"), OUT: T("nightReplay.chip.out"), SWAP: T("nightReplay.tag.switch") };
      root.setAttribute("aria-label", T("nightReplay.aria"));
      labelCache = {}; ctx = null; el = null; tks = []; rowEls = {};
      if (!N) { root.innerHTML = '<div class="pmc-nr-empty">' + esc(T("nightReplay.empty")) + "</div>"; return; }

      var segHtml = "", tkHtml = "", rowHtml = "", i, g0 = 0;
      for (i = 0; i <= N; i++) {
        if (i === N || (i > 0 && MS[i].groupKey !== MS[i - 1].groupKey)) {
          segHtml += '<div class="' + (MS[g0].isTeam ? "" : "solo") + '" style="flex:' + (i - g0) + ' 1 0" title="' + esc(groupLabel(MS[g0])) + '">' + esc(groupLabel(MS[g0])) + "</div>";
          g0 = i;
        }
      }
      function bars(ids) { return ids.map(function (id) { return '<i style="background:' + byId[id].color + '"></i>'; }).join(""); }
      MS.forEach(function (M, k) {
        // winners' colours over losers'; no winner: a blank bar over everyone's
        var w = bars(M.winIds), l = bars(M.winIds.length ? M.loseIds : M.all);
        tkHtml += '<div class="pmc-nr-tk' + (k > 0 && M.groupKey !== MS[k - 1].groupKey ? " gapL" : "") + '"><span class="n">' + esc(M.n) + "</span>" +
          '<span class="w' + (w ? "" : " none") + '">' + w + '</span><span class="l' + (w ? "" : " all") + '">' + l + "</span></div>";
      });
      players.forEach(function (p) {
        rowHtml += '<div class="pmc-nr-row" data-id="' + esc(p.id) + '"><span class="pmc-nr-rank"></span><span class="pmc-nr-dot" style="background:' + p.color + '"></span>' +
          '<div class="pmc-nr-mid"><span class="pmc-nr-name" title="' + esc(p.name) + '">' + esc(p.name) + '</span><span class="pmc-nr-line"><span class="pmc-nr-form"></span><small></small></span></div><span class="pmc-nr-num"></span></div>';
      });
      function btn(cls, key, inner) { return '<button type="button" class="' + cls + '" aria-label="' + esc(key) + '" title="' + esc(key) + '">' + inner + "</button>"; }
      root.innerHTML =
        '<div class="pmc-nr-grid">' +
        '<section class="pmc-nr-stage">' +
          '<div class="pmc-nr-score" aria-live="polite">' +
            '<div class="pmc-nr-ml"><span class="pmc-nr-ball"><b></b></span><div><div class="pmc-nr-no"></div><div class="pmc-nr-game"></div></div></div>' +
            '<div class="pmc-nr-vs"></div>' +
            '<div class="pmc-nr-mr"><div class="pmc-nr-time"></div><div class="pmc-nr-dur"></div></div>' +
          "</div>" +
          '<div class="pmc-nr-scene"><div class="pmc-nr-view"><canvas></canvas><div class="pmc-nr-hint">' + esc(T("nightReplay.hint")) + '</div></div><div class="pmc-nr-chips"></div></div>' +
        "</section>" +
        '<section class="pmc-nr-tl">' +
          '<div class="pmc-nr-ctl">' + btn("pmc-nr-first", T("nightReplay.first"), ICON.first) + btn("pmc-nr-prev", T("nightReplay.previous"), ICON.prev) +
            '<button type="button" class="pmc-nr-play"></button>' + btn("pmc-nr-next", T("nightReplay.next"), ICON.next) + "</div>" +
          '<div class="pmc-nr-tlwrap"><div class="pmc-nr-segs">' + segHtml + "</div>" +
          '<div class="pmc-nr-strip" role="slider" tabindex="0" aria-label="' + esc(T("nightReplay.timeline")) + '" aria-valuemin="1" aria-valuemax="' + N + '">' + tkHtml + "</div></div>" +
        "</section>" +
        '<aside class="pmc-nr-board">' +
          '<div class="pmc-nr-lbhead"><div class="pmc-nr-lbttl" role="heading" aria-level="3">' + esc(T("nightReplay.leaderboard")) + '</div><span class="pmc-nr-after"></span></div>' +
          '<div class="pmc-nr-hold"></div>' +
          '<div class="pmc-nr-cols"><span>' + esc(T("nightReplay.gameByGame")) + "</span><span>" + esc(T("nightReplay.wonPlayed")) + "</span></div>" +
          '<div class="pmc-nr-rows">' + rowHtml + "</div>" +
        "</aside></div>";

      function $(s) { return root.querySelector(s); }
      el = {
        view: $(".pmc-nr-view"), canvas: $("canvas"), chips: $(".pmc-nr-chips"),
        ball: $(".pmc-nr-ball"), ballNo: $(".pmc-nr-ball b"), no: $(".pmc-nr-no"), game: $(".pmc-nr-game"), time: $(".pmc-nr-time"), dur: $(".pmc-nr-dur"),
        vs: $(".pmc-nr-vs"), after: $(".pmc-nr-after"), hold: $(".pmc-nr-hold"), rows: $(".pmc-nr-rows"),
        strip: $(".pmc-nr-strip"), bFirst: $(".pmc-nr-first"), bPrev: $(".pmc-nr-prev"), bPlay: $(".pmc-nr-play"), bNext: $(".pmc-nr-next")
      };
      tks = Array.prototype.slice.call(root.querySelectorAll(".pmc-nr-tk"));
      Array.prototype.forEach.call(root.querySelectorAll(".pmc-nr-row"), function (r, k) {
        rowEls[players[k].id] = { row: r, rank: r.querySelector(".pmc-nr-rank"), tag: r.querySelector("small"), form: r.querySelector(".pmc-nr-form"), num: r.querySelector(".pmc-nr-num"), formN: -1 };
      });
      ctx = el.canvas.getContext("2d");
      bind();
      setPlaying(playing);
      renderHud(); renderTimeline();
      if (hadFocus) { try { root.focus(); } catch (e2) {} }
    }

    // ---- projection ----
    var cam = { f: 1, cx: 0, cy: 0, tx: 0, ty: 0.55, tz: 0.75, cyw: 1, syw: 0, cp: 1, sp: 0, px: 0, py: 0, pz: 0 };
    function setCam(yaw, pitch) {
      cam.cyw = Math.cos(yaw); cam.syw = Math.sin(yaw); cam.cp = Math.cos(pitch); cam.sp = Math.sin(pitch);
      cam.px = cam.tx - DIST * cam.cp * cam.syw; cam.py = cam.ty + DIST * cam.sp; cam.pz = cam.tz - DIST * cam.cp * cam.cyw;
    }
    function P(x, y, z) {
      var X = x - cam.tx, Y = y - cam.ty, Z = z - cam.tz;
      var x1 = X * cam.cyw - Z * cam.syw, z1 = X * cam.syw + Z * cam.cyw;
      var y2 = Y * cam.cp + z1 * cam.sp, z2 = -Y * cam.sp + z1 * cam.cp + DIST;
      var s = cam.f / z2;
      return { x: cam.cx + x1 * s, y: cam.cy - y2 * s, s: s, d: z2 };
    }
    function ell(x, y, z) { // how flat a level circle looks from the camera
      var dx = cam.px - x, dy = cam.py - y, dz = cam.pz - z;
      return dy / Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    function frontZ() { return model.hasFront ? FZ - 0.42 : (model.maxSide >= 3 ? -1.5 : -1.3); }
    function fit() {
      var xo = XO + (model.maxSide >= 3 ? 0.46 : 0.1) + 0.36, topY = model.tiers * TSTEP + 1.5, zf = frontZ();
      var pts = [[-xo, 0, zf], [xo, 0, zf], [-xo, 1.75, 0.9], [xo, 1.75, 0.9], [-xo, 0, 0.9], [xo, 0, 0.9],
                 [-benchHW, topY, WALLZ - 0.3], [benchHW, topY, WALLZ - 0.3], [-benchHW - 0.1, 0, BZ0], [benchHW + 0.1, 0, BZ0]];
      var padX = 12, padT = 8, padB = chipH + 18, pitch, best = null, i, p, bb, fw, fh;
      // (padB: the chips lie over the bottom of the picture)
      // a tall canvas gets a steeper camera (more of the floor, less overlap); a wide one a lower, more dramatic one
      for (pitch = 0.5; pitch <= 0.86; pitch += 0.03) {
        cam.f = 1; cam.cx = 0; cam.cy = 0; setCam(YAW0, pitch);
        bb = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
        for (i = 0; i < pts.length; i++) {
          p = P(pts[i][0], pts[i][1], pts[i][2]);
          bb.x0 = Math.min(bb.x0, p.x); bb.x1 = Math.max(bb.x1, p.x); bb.y0 = Math.min(bb.y0, p.y); bb.y1 = Math.max(bb.y1, p.y);
        }
        fw = (W - 2 * padX) / (bb.x1 - bb.x0); fh = (H - padT - padB) / (bb.y1 - bb.y0);
        if (!best || fh >= fw || pitch <= 0.56) best = { pitch: pitch, f: Math.min(fw, fh), bb: bb };
        if (fh < fw && pitch >= 0.56) break;
      }
      // (a view the user has turned keeps its turn)
      if (Math.abs(view.pitch - basePitch) < 0.001) view.pitch = best.pitch;
      basePitch = best.pitch;
      cam.f = Math.min(best.f, 172 * DIST);
      cam.cx = W / 2 - (best.bb.x0 + best.bb.x1) / 2 * cam.f;
      cam.cy = padT + (H - padT - padB) / 2 - (best.bb.y0 + best.bb.y1) / 2 * cam.f;
      return Math.ceil((best.bb.y1 - best.bb.y0) * cam.f) + padT + padB;
    }
    function flag(name, on) { if (root.classList) root.classList[on ? "add" : "remove"](name); }
    // Sizes everything from the root's own width; a root with no width (a closed panel) stops it all.
    function measure() {
      if (dead) return;
      var w = Math.round(root.getBoundingClientRect().width);
      rootW = w;
      if (!el || w < 40) {
        sized = false;
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        if (el && cur >= 0) { playing = false; settle(); setPlaying(false); }
        return;
      }
      wide = w >= WIDE;
      var stageW = wide ? w - 322 : w;
      tight = stageW < TIGHT;
      flag("pmc-nr--wide", wide); flag("pmc-nr--tight", tight);
      chipH = chipRoom();
      el.view.style.height = (clamp(Math.round(220 + 0.38 * stageW), 300, 560) + chipH - 28) + "px";
      W = Math.max(50, el.view.clientWidth); H = Math.max(50, el.view.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      headK = W < 560 ? 1.22 : 1; labelCache = {};
      // (a narrow room is held by its width: no taller than the picture needs)
      var need = fit();
      if (need < H - 6) { H = Math.max(240, need); el.view.style.height = H + "px"; fit(); }
      el.canvas.width = Math.round(W * dpr); el.canvas.height = Math.round(H * dpr);
      renderHud();
      // the leaderboard's rows: beside the room they share its height, below it they take what they need
      if (wide) {
        el.rows.style.height = ""; el.rows.style.minHeight = (NP * 30) + "px";
        rowH = clamp(Math.floor(el.rows.clientHeight / Math.max(1, NP)), 30, 62);
      } else {
        rowH = NP > 8 ? 40 : 48;
        el.rows.style.minHeight = ""; el.rows.style.height = (rowH * NP) + "px";
      }
      el.rows.className = "pmc-nr-rows" + (rowH < 46 ? " compact" : "");
      Object.keys(rowEls).forEach(function (id) { rowEls[id].row.style.height = (rowH - 4) + "px"; });
      el.strip.className = "pmc-nr-strip" + (el.strip.clientWidth / Math.max(1, N) < 21 ? " thin" : "");
      // (a bracket too narrow for a word of its label: the line only)
      Array.prototype.forEach.call(root.querySelectorAll(".pmc-nr-segs div"), function (d) {
        d.className = d.className.replace(" tiny", "");
        if (d.scrollWidth > d.clientWidth && d.clientWidth < 64) d.className += " tiny";
      });
      sized = true;
      if (pending) { pending = false; go(0, { force: true, instant: reduced }); }
      else { renderBoard(false); kick(); }
    }

    // ---- drawing helpers ----
    function poly(a) { var i; ctx.beginPath(); ctx.moveTo(a[0].x, a[0].y); for (i = 1; i < a.length; i++) ctx.lineTo(a[i].x, a[i].y); ctx.closePath(); }
    function face(a, fillC) { poly(a); ctx.fillStyle = fillC; ctx.fill(); ctx.strokeStyle = fillC; ctx.lineWidth = 0.8; ctx.stroke(); }
    function box(x0, x1, y0, y1, z0, z1, cTop, cFront, cSide) {
      if (cam.px < x0) face([P(x0, y0, z1), P(x0, y0, z0), P(x0, y1, z0), P(x0, y1, z1)], cSide);
      if (cam.px > x1) face([P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)], cSide);
      if (cam.pz < z0) face([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], cFront);
      if (cam.py > y1) face([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], cTop);
    }
    function oval(cx, cy, rx, ry) { ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); }
    function line3(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    function font(px) { ctx.font = "800 " + px + "px " + fontFam; }
    function planeText(str, x, y, z, hWorld, fillC, alpha) {
      // text lying flat on a level plane (an affine stand-in for the perspective)
      var p0 = P(x, y, z), px = P(x + 0.5, y, z), pz = P(x, y, z + 0.5), k = hWorld / 100 * 2 * dpr;
      ctx.save();
      ctx.setTransform((px.x - p0.x) * k, (px.y - p0.y) * k, -(pz.x - p0.x) * k, -(pz.y - p0.y) * k, p0.x * dpr, p0.y * dpr);
      font(100); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.globalAlpha = alpha; ctx.fillStyle = fillC; ctx.fillText(str, 0, 6);
      ctx.restore();
    }
    function pill(x, y, w, h, fillC, stroke) {
      var r = h / 2;
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath();
      ctx.fillStyle = fillC; ctx.fill();
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
    }

    // ---- the room: floor, rug, wall ----
    function drawRoom() {
      var c0 = P(0, 0, 0.5), R = 6.4 * c0.s, g, i, x;
      ctx.save();
      poly([P(-13, 0, -4.2), P(13, 0, -4.2), P(13, 0, WALLZ), P(-13, 0, WALLZ)]); ctx.clip();
      ctx.save();
      ctx.translate(c0.x, c0.y); ctx.scale(1, 0.6);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, "#4f2318"); g.addColorStop(0.45, "#351710"); g.addColorStop(0.8, "#1f0c0a"); g.addColorStop(1, STAGE);
      ctx.fillStyle = g; ctx.fillRect(-R, -R, 2 * R, 2 * R);
      ctx.restore();
      g = ctx.createRadialGradient(c0.x, c0.y, 0, c0.x, c0.y, R * 0.92);
      g.addColorStop(0, "rgba(10,3,3,.55)"); g.addColorStop(0.6, "rgba(10,3,3,.4)"); g.addColorStop(1, "rgba(10,3,3,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 1;
      for (i = -24; i <= 24; i++) {            // boards running away from the viewer
        x = i * 0.46;
        line3(P(x, 0, -4.2), P(x, 0, WALLZ));
        var zs = -4 + ((i * 37 + 1000) % 11) / 11 * 2.6;
        for (; zs < WALLZ; zs += 2.6) line3(P(x, 0, zs), P(x + 0.46, 0, zs));
      }
      ctx.restore();

      // the rug under the table: the "stage"
      var rx = XO + 0.66 + (model.maxSide >= 3 ? 0.44 : 0), rz1 = model.maxSide >= 3 ? 1.5 : 1.3, rz0 = model.hasFront ? -FZ + 0.5 : rz1;
      var rug = [P(-rx, 0, -rz0), P(rx, 0, -rz0), P(rx, 0, rz1), P(-rx, 0, rz1)];
      ctx.save(); poly(rug); ctx.clip();
      var rc = P(0, 0, 0);
      ctx.translate(rc.x, rc.y); ctx.scale(1, 0.55);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * rc.s * 1.05);
      g.addColorStop(0, "#7a2424"); g.addColorStop(0.6, "#5c1a1a"); g.addColorStop(1, "#3d1111");
      ctx.fillStyle = g; ctx.fillRect(-4000, -4000, 8000, 8000);
      ctx.restore();
      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(232,185,35,.6)"; ctx.lineWidth = Math.max(1.2, 0.022 * rc.s);
      poly([P(-rx + 0.11, 0, -rz0 + 0.11), P(rx - 0.11, 0, -rz0 + 0.11), P(rx - 0.11, 0, rz1 - 0.11), P(-rx + 0.11, 0, rz1 - 0.11)]); ctx.stroke();
      ctx.strokeStyle = "rgba(232,185,35,.22)"; ctx.lineWidth = 1;
      poly([P(-rx + 0.2, 0, -rz0 + 0.2), P(rx - 0.2, 0, -rz0 + 0.2), P(rx - 0.2, 0, rz1 - 0.2), P(-rx + 0.2, 0, rz1 - 0.2)]); ctx.stroke();
      // the table's soft shadow on the rug
      ctx.fillStyle = "rgba(6,1,1,.085)";
      for (i = 0; i < 10; i++) {                // nested quads = a cheap soft edge, no blur filter
        x = 0.3 - i * 0.036;
        poly([P(-TL - x, 0, -TW - x + 0.04), P(TL + x + 0.08, 0, -TW - x + 0.04), P(TL + x + 0.08, 0, TW + x + 0.06), P(-TL - x, 0, TW + x + 0.06)]); ctx.fill();
      }

      // the back wall
      var w0 = P(0, 0.7, WALLZ), RW = 6.2 * w0.s;
      ctx.save();
      poly([P(-13, 0, WALLZ), P(13, 0, WALLZ), P(13, WALLH + 1.5, WALLZ), P(-13, WALLH + 1.5, WALLZ)]); ctx.clip();
      g = ctx.createRadialGradient(w0.x, w0.y, 0, w0.x, w0.y, RW);
      g.addColorStop(0, "#3d1818"); g.addColorStop(0.55, "#2a1010"); g.addColorStop(1, STAGE);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      g = ctx.createRadialGradient(w0.x, w0.y, 0, w0.x, w0.y, RW * 0.85);
      g.addColorStop(0, "rgba(232,185,35,.3)"); g.addColorStop(1, "rgba(232,185,35,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 1.2;
      line3(P(-13, WALLH - 0.35, WALLZ), P(13, WALLH - 0.35, WALLZ));
      g = ctx.createRadialGradient(w0.x, w0.y, 0, w0.x, w0.y, RW * 0.85);
      g.addColorStop(0, "rgba(0,0,0,.34)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.strokeStyle = g; ctx.lineWidth = 1;
      for (i = -12; i <= 12; i++) line3(P(i * 0.95, 0, WALLZ), P(i * 0.95, WALLH - 0.35, WALLZ));
      ctx.restore();
      drawDecor();
    }

    // a wall clock (the time of the match) and a cue rack - only when there is room
    function drawDecor() {
      var cx3 = -(benchHW + 0.8), cy3 = model.tiers * TSTEP + 0.78, c = P(cx3, cy3, WALLZ), r = 0.33 * c.s, a, i;
      if (c.x - r > 12 && c.y - r > 10) {
        ctx.save();
        oval(c.x, c.y, r * cam.cyw, r); ctx.fillStyle = "#120606"; ctx.fill();
        ctx.lineWidth = Math.max(1.5, r * 0.11); ctx.strokeStyle = "#b08a1c"; ctx.stroke();
        ctx.strokeStyle = "rgba(246,239,233,.55)"; ctx.lineWidth = 1;
        for (i = 0; i < 12; i++) {
          a = i / 12 * Math.PI * 2;
          ctx.beginPath(); ctx.moveTo(c.x + Math.sin(a) * r * 0.78 * cam.cyw, c.y - Math.cos(a) * r * 0.78);
          ctx.lineTo(c.x + Math.sin(a) * r * 0.9 * cam.cyw, c.y - Math.cos(a) * r * 0.9); ctx.stroke();
        }
        ctx.lineCap = "round"; ctx.strokeStyle = IVORY;
        a = (clockMin % 720) / 720 * Math.PI * 2; ctx.lineWidth = Math.max(1.6, r * 0.1);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.sin(a) * r * 0.48 * cam.cyw, c.y - Math.cos(a) * r * 0.48); ctx.stroke();
        a = (clockMin % 60) / 60 * Math.PI * 2; ctx.lineWidth = Math.max(1.1, r * 0.06);
        ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.sin(a) * r * 0.72 * cam.cyw, c.y - Math.cos(a) * r * 0.72); ctx.stroke();
        oval(c.x, c.y, r * 0.08, r * 0.08); ctx.fillStyle = GOLD; ctx.fill();
        ctx.restore();
      }
      var kx = benchHW + 0.62, k0 = P(kx, 0, WALLZ), k1 = P(kx + 0.9, 0, WALLZ);
      var y0 = 0.45, y1 = model.tiers * TSTEP + 1.32, kt = P(kx + 0.98, y1, WALLZ);
      if (k1.x < W - 12 && kt.x < W - 12 && kt.y > 10) {
        ctx.save();
        face([P(kx - 0.08, y0 + 0.25, WALLZ), P(kx + 0.98, y0 + 0.25, WALLZ), P(kx + 0.98, y0 + 0.4, WALLZ), P(kx - 0.08, y0 + 0.4, WALLZ)], "#4a2412");
        face([P(kx - 0.08, y1 - 0.5, WALLZ), P(kx + 0.98, y1 - 0.5, WALLZ), P(kx + 0.98, y1 - 0.38, WALLZ), P(kx - 0.08, y1 - 0.38, WALLZ)], "#4a2412");
        ctx.lineCap = "round";
        for (i = 0; i < 4; i++) {
          var qx = kx + 0.09 + i * 0.24, a0 = P(qx, y0, WALLZ - 0.03), a1 = P(qx, y0 + (y1 - y0) * 0.42, WALLZ - 0.03), a2 = P(qx, y1, WALLZ - 0.03);
          ctx.strokeStyle = ["#2b1109", "#3a1a12", "#101820", "#2b1109"][i]; ctx.lineWidth = Math.max(2, 0.05 * k0.s); line3(a0, a1);
          ctx.strokeStyle = "#c9a26b"; ctx.lineWidth = Math.max(1.4, 0.032 * k0.s); line3(a1, a2);
        }
        ctx.restore();
      }
    }

    // ---- the bench ----
    function drawBench() {
      var r, hw = benchHW, z0, y1, a, b;
      for (r = model.tiers - 1; r >= 0; r--) {
        z0 = BZ0 + r * TD; y1 = TSTEP * (r + 1);
        box(-hw, hw, 0, y1, z0, z0 + TD, "#5b2c1b", "#3a1a10", "#2a120b");
        a = P(-hw, y1, z0); b = P(hw, y1, z0);
        ctx.strokeStyle = "rgba(255,205,160,.28)"; ctx.lineWidth = 1.2; line3(a, b);
        ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 1; line3(P(-hw, y1 * 0.5, z0), P(hw, y1 * 0.5, z0));
      }
      players.forEach(function (p) {            // each player's own cushion
        var c = P(p.seat.x, p.seat.y + 0.005, p.seat.z), k = ell(p.seat.x, p.seat.y, p.seat.z), rr = 0.285 * c.s;
        oval(c.x, c.y, rr, rr * k); ctx.fillStyle = p.sh.seat; ctx.fill();
        ctx.strokeStyle = p.sh.seatEdge; ctx.lineWidth = 1; ctx.stroke();
      });
    }

    // ---- the pool table ----
    // where each side's score is painted on the cloth, and how tall
    function clothSpot(M, S) {
      var two = M.sides.length === 2, len = String(S.shown).length, h = (two ? [0.74, 0.56, 0.42] : [0.46, 0.38, 0.3])[Math.min(len, 3) - 1];
      if (S.at === "L" || S.at === "R") return { x: (S.at === "L" ? -1 : 1) * (two ? 0.84 : 0.92), z: 0, h: h };
      return { x: S.fx * 0.5, z: -0.36, h: h };
    }
    function drawTable() {
      var i, g, M = cur >= 0 ? MS[cur] : null;
      var lx = TL - 0.3, lz = TW - 0.28;
      [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]].sort(function (a, b) { return P(b[0], 0, b[1]).d - P(a[0], 0, a[1]).d; }).forEach(function (q) {
        box(q[0] - 0.09, q[0] + 0.09, 0, 0.5, q[1] - 0.09, q[1] + 0.09, "#2a1208", "#3a1b0c", "#241006");
      });
      box(-TL + 0.06, TL - 0.06, 0.46, 0.7, -TW + 0.06, TW - 0.06, "#3a1b0c", "#4a2511", "#331709");
      box(-TL, TL, 0.68, TH, -TW, TW, "#8a4f28", "#6e3b1c", "#532a12");
      // a highlight on the near top edge of the rail
      ctx.strokeStyle = "rgba(255,214,170,.35)"; ctx.lineWidth = 1.2;
      line3(P(-TL, TH, -TW), P(TL, TH, -TW));
      if (cam.px > TL) line3(P(TL, TH, -TW), P(TL, TH, TW)); else if (cam.px < -TL) line3(P(-TL, TH, -TW), P(-TL, TH, TW));
      // cushions + cloth
      var ci = 0.15, cl = 0.2;
      face([P(-TL + ci, TH, -TW + ci), P(TL - ci, TH, -TW + ci), P(TL - ci, TH, TW - ci), P(-TL + ci, TH, TW - ci)], "#0f5233");
      var cloth = [P(-TL + cl, TH, -TW + cl), P(TL - cl, TH, -TW + cl), P(TL - cl, TH, TW - cl), P(-TL + cl, TH, TW - cl)];
      var cc = P(0, TH, 0);
      ctx.save(); poly(cloth); ctx.clip();
      ctx.translate(cc.x, cc.y); ctx.scale(1, 0.5);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.55 * cc.s);
      g.addColorStop(0, "#36b077"); g.addColorStop(0.55, "#218a59"); g.addColorStop(1, "#156a41");
      ctx.fillStyle = g; ctx.fillRect(-3000, -3000, 6000, 6000);
      ctx.restore();
      // pockets
      [[-1, -1], [0, -1], [1, -1], [-1, 1], [0, 1], [1, 1]].forEach(function (q) {
        var x = q[0] * (TL - ci - 0.01), z = q[1] * (TW - ci - (q[0] === 0 ? -0.03 : 0.01)), c = P(x, TH, z), k = ell(x, TH, z);
        oval(c.x, c.y, 0.1 * c.s, 0.1 * c.s * k); ctx.fillStyle = "#070202"; ctx.fill();
      });
      // rail sights
      ctx.fillStyle = "rgba(240,205,120,.85)";
      for (i = -3; i <= 3; i++) {
        if (i === 0) continue;
        [-1, 1].forEach(function (sg) {
          var c = P(i * 0.34 + (i > 0 ? 0.05 : -0.05), TH, sg * (TW - 0.07)); oval(c.x, c.y, 0.017 * c.s, 0.012 * c.s); ctx.fill();
        });
      }
      [-0.3, 0, 0.3].forEach(function (z) { [-1, 1].forEach(function (sg) { var c = P(sg * (TL - 0.07), TH, z); oval(c.x, c.y, 0.017 * c.s, 0.012 * c.s); ctx.fill(); }); });

      if (!M) return;
      // the score, painted on the cloth where each side stands
      if (revealed) {
        M.sides.forEach(function (S) {
          var sp = clothSpot(M, S);
          planeText(String(S.shown), sp.x, TH, sp.z, sp.h, S.won ? GOLD : IVORY, S.won ? 0.95 : (M.winIds.length ? 0.4 : 0.7));
        });
      }
      // the game's ball, oversized so 8-Ball / 9-Ball reads at a glance (three sides: moved back, the scores need the middle)
      var bz = M.sides.length > 2 ? 0.3 : 0, br = 0.17, bc = P(0, TH + br, bz), R = br * bc.s, B = M.ball, sh = P(0.07, TH, bz + 0.02), k2 = ell(0, TH, bz);
      oval(sh.x, sh.y, R * 1.1, R * 1.1 * k2); ctx.fillStyle = "rgba(0,0,0,.42)"; ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.arc(bc.x, bc.y, R, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = B.stripe ? "#f4efe6" : B.color; ctx.fillRect(bc.x - R, bc.y - R, 2 * R, 2 * R);
      if (B.stripe) { ctx.fillStyle = B.color; ctx.fillRect(bc.x - R, bc.y - R * 0.6, 2 * R, R * 1.2); }
      g = ctx.createRadialGradient(bc.x - R * 0.35, bc.y - R * 0.45, R * 0.05, bc.x, bc.y, R * 1.05);
      g.addColorStop(0, "rgba(255,255,255,.5)"); g.addColorStop(0.35, "rgba(255,255,255,.06)"); g.addColorStop(1, "rgba(0,0,0,.5)");
      ctx.fillStyle = g; ctx.fillRect(bc.x - R, bc.y - R, 2 * R, 2 * R);
      ctx.restore();
      if (B.no) {
        ctx.beginPath(); ctx.arc(bc.x, bc.y, R * 0.5, 0, Math.PI * 2); ctx.fillStyle = "#f8f4ec"; ctx.fill();
        ctx.fillStyle = INK; font(R * (B.no > 9 ? 0.58 : 0.72)); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(B.no), bc.x, bc.y + R * 0.04);
      }
    }

    // ---- a player's token: a pawn whose head is a ball carrying the name ----
    function labelFor(p, R) {
      // the short name, as large as fits in the head; never under 11 px - a long one is
      // set a little narrower, then cut
      var key = p.id + "|" + Math.round(R * 2), c = labelCache[key], maxW = R * 1.8, px = Math.max(11, Math.min(R * 0.6, 17)), txt = p.label, sx = 1, w, len;
      if (c) return c;
      font(px); w = ctx.measureText(txt).width;
      if (w > maxW) { px = Math.max(11, px * maxW / w); font(px); w = ctx.measureText(txt).width; }
      if (w > maxW) {
        sx = Math.max(0.84, maxW / w);
        if (w * sx > maxW + 0.5) {
          for (len = txt.length - 1; len > 1; len--) { if (ctx.measureText(txt.substr(0, len) + "…").width * sx <= maxW) break; }
          txt = txt.substr(0, len) + "…";
        }
      }
      c = { txt: txt, px: px, sx: sx };
      labelCache[key] = c; return c;
    }
    function geomOf(p, s) {
      var x = s.x, z = s.z, y = s.y + s.lift;
      var b = P(x, y, z), sc = b.s, hc = P(x, y + 1.02 + (headK - 1) * 0.2, z), R = 0.31 * headK * hc.s;
      return { b: b, k: ell(x, y, z), rb: 0.27 * sc, r1: 0.215 * sc, r2: 0.1 * sc, t1: P(x, y + 0.1, z).y, t2: P(x, y + 0.76, z).y, hc: hc, R: R, lb: labelFor(p, R) };
    }
    function drawGround(p, s) {
      // contact shadow + (winners) a gold ring: drawn before any token so rings never cover a neighbour
      var x = s.x, z = s.z, yg = s.y, k = ell(x, yg, z), g;
      var gp = P(x + 0.07, yg, z + 0.02), sc = gp.s, shr = 1 / (1 + s.lift * 1.2);
      oval(gp.x, gp.y, 0.38 * sc * shr, 0.38 * sc * k * shr); ctx.fillStyle = "rgba(0,0,0," + (0.4 * shr) + ")"; ctx.fill();
      if (s.crown > 0.02) {
        var fp = P(x, yg, z);
        ctx.save(); ctx.translate(fp.x, fp.y); ctx.scale(1, k);
        g = ctx.createRadialGradient(0, 0, 0.2 * sc, 0, 0, 0.74 * sc);
        g.addColorStop(0, "rgba(232,185,35," + (0.5 * s.crown) + ")"); g.addColorStop(1, "rgba(232,185,35,0)");
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 0.74 * sc, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        oval(fp.x, fp.y, 0.43 * sc, 0.43 * sc * k); ctx.strokeStyle = "rgba(244,205,70," + (0.95 * s.crown) + ")"; ctx.lineWidth = Math.max(1.6, 0.05 * sc); ctx.stroke();
      }
    }
    function pawnBody(G, sh, ink) {
      var g, b = G.b, k = G.k;
      // base disc
      ctx.beginPath(); ctx.moveTo(b.x - G.rb, G.t1); ctx.lineTo(b.x - G.rb, b.y); ctx.ellipse(b.x, b.y, G.rb, G.rb * k, 0, Math.PI, 0, true); ctx.lineTo(b.x + G.rb, G.t1); ctx.closePath();
      g = ctx.createLinearGradient(b.x - G.rb, 0, b.x + G.rb, 0);
      g.addColorStop(0, sh.deep); g.addColorStop(0.4, sh.dark); g.addColorStop(0.62, sh.base); g.addColorStop(1, sh.deep);
      ctx.fillStyle = g; ctx.fill();
      oval(b.x, G.t1, G.rb, G.rb * k); ctx.fillStyle = sh.base; ctx.fill();
      // body
      ctx.beginPath(); ctx.moveTo(b.x - G.r1, G.t1); ctx.ellipse(b.x, G.t1, G.r1, G.r1 * k, 0, Math.PI, 0, true); ctx.lineTo(b.x + G.r2, G.t2); ctx.lineTo(b.x - G.r2, G.t2); ctx.closePath();
      g = ctx.createLinearGradient(b.x - G.r1, 0, b.x + G.r1, 0);
      g.addColorStop(0, sh.deep); g.addColorStop(0.3, sh.base); g.addColorStop(0.48, sh.light); g.addColorStop(0.7, sh.dark); g.addColorStop(1, sh.deep);
      ctx.fillStyle = g; ctx.fill();
      // head
      var hc = G.hc, R = G.R;
      oval(hc.x, G.t2 + R * 0.12, G.r2 * 1.5, G.r2 * 1.5 * k); ctx.fillStyle = sh.deep; ctx.fill();
      g = ctx.createRadialGradient(hc.x - R * 0.36, hc.y - R * 0.42, R * 0.06, hc.x, hc.y, R * 1.02);
      g.addColorStop(0, sh.hi); g.addColorStop(0.32, sh.light); g.addColorStop(0.72, sh.base); g.addColorStop(1, sh.dark);
      ctx.beginPath(); ctx.arc(hc.x, hc.y, R, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = "rgba(20,6,6,.55)"; ctx.lineWidth = 1; ctx.stroke();
      font(G.lb.px); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = ink;
      ctx.save(); ctx.translate(hc.x, hc.y + G.lb.px * 0.06); ctx.scale(G.lb.sx, 1); ctx.fillText(G.lb.txt, 0, 0); ctx.restore();
    }
    // A crown never hides who stands behind (a partner's name): when it would,
    // it is a smaller one, worn low on the head.
    function crownHides(p) {
      // (judged standing, not mid-hop: the crown must not change as its wearer jumps)
      function rest(q) { var t = st[q.id]; return t.lift > 0.001 ? geomOf(q, { x: t.x, y: t.y, z: t.z, lift: 0 }) : t.G; }
      var s = st[p.id], G = rest(p), r = 0.215 * G.hc.s * 1.05, cx = G.hc.x, cy = G.hc.y - G.R - r * 0.7;
      return players.some(function (q) {
        var Q, dx, dy;
        if (q === p || st[q.id].depth <= s.depth) return false;
        Q = rest(q); dx = Q.hc.x - cx; dy = Q.hc.y - cy;
        if (dx * dx + dy * dy < (Q.R + r) * (Q.R + r)) return true;
        return Math.abs(Q.b.x - cx) < r + Q.r1 * 0.6 && cy + r > Q.t2 && cy - r < Q.b.y;   // (their body counts too)
      });
    }
    function drawPawn(p, s, showStreak) {
      var G = s.G, hc = G.hc, R = G.R, g;
      pawnBody(G, p.sh, INK);
      if (s.dim > 0.02) {                      // losers fade to a dull, dark version of themselves
        ctx.globalAlpha = s.dim; pawnBody(G, p.shDim, "rgba(246,239,233,.85)"); ctx.globalAlpha = 1;
      }
      if (s.crown > 0.02) {
        var low = crownHides(p), cs = s.crown * (low ? 0.62 : 1), cw = 0.215 * hc.s * cs, chh = cw * 1.25;
        var y0 = hc.y - (low ? R * 0.7 : R + 0.045 * hc.s);
        ctx.save();
        ctx.shadowColor = "rgba(244,200,50,.9)"; ctx.shadowBlur = 12 * cs;
        ctx.beginPath();
        ctx.moveTo(hc.x - cw, y0); ctx.lineTo(hc.x - cw * 1.12, y0 - chh * 0.82); ctx.lineTo(hc.x - cw * 0.5, y0 - chh * 0.42);
        ctx.lineTo(hc.x, y0 - chh); ctx.lineTo(hc.x + cw * 0.5, y0 - chh * 0.42); ctx.lineTo(hc.x + cw * 1.12, y0 - chh * 0.82); ctx.lineTo(hc.x + cw, y0);
        ctx.closePath();
        g = ctx.createLinearGradient(0, y0 - chh, 0, y0); g.addColorStop(0, "#ffe58a"); g.addColorStop(1, "#d99f12");
        ctx.fillStyle = g; ctx.fill();
        ctx.restore();
        ctx.strokeStyle = "#7a5606"; ctx.lineWidth = 1; ctx.stroke();
        if (showStreak) {                      // "×3": wins in a row, beside the crown
          var txt = "×" + showStreak, px = clamp(0.2 * hc.s, 11, 15), tw, bx = hc.x + cw * 1.2 + 3, by = y0 - chh * 0.5;
          font(px); tw = ctx.measureText(txt).width + px * 0.9;
          ctx.globalAlpha = s.crown;
          pill(bx, by - px * 0.75, tw, px * 1.5, GOLD);
          ctx.fillStyle = INK; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(txt, bx + tw / 2, by + px * 0.05);
          ctx.globalAlpha = 1;
        }
      }
    }

    // ---- travel: trails, landing rings, IN / OUT tags ----
    function drawTrails() {
      if (!anim) return;
      anim.movers.forEach(function (m) {
        if (m.t <= 0 || m.t >= 1) return;
        var s = st[m.p.id], d1 = m.d, d0 = Math.max(0, d1 - 1.9), d, a, q0, q1, w0, w1, fade = Math.min(1, m.t * 5, (1 - m.t) * 5);
        ctx.lineCap = "round";
        for (d = d0; d < d1 - 0.02; d += 0.14) {
          a = Math.pow((d - d0) / Math.max(0.01, d1 - d0), 1.4);
          q0 = pointAt(m.path, d); q1 = pointAt(m.path, Math.min(d1, d + 0.15));
          if (q0.z > BZ0 - 0.12) continue;
          w0 = P(q0.x, 0.004, q0.z); w1 = P(q1.x, 0.004, q1.z);
          ctx.strokeStyle = rgba(m.p.color, 0.75 * a * fade); ctx.lineWidth = Math.max(2, 0.13 * w0.s * (0.4 + 0.6 * a));
          line3(w0, w1);
        }
        // where this token is going to land
        var e = P(m.B.x, m.B.y + 0.006, m.B.z), k = ell(m.B.x, m.B.y, m.B.z);
        ctx.save(); ctx.setLineDash([5, 4]);
        oval(e.x, e.y, 0.36 * e.s, 0.36 * e.s * k); ctx.strokeStyle = rgba(m.p.color, 0.9 * fade); ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
        s.tagA = fade;
      });
    }
    function drawTags() {
      players.forEach(function (p) {
        var s = st[p.id], G = s.G;
        if (!s.tag || s.tagA <= 0.02 || !words[s.tag]) return;
        var txt = words[s.tag], px = clamp(0.19 * G.hc.s, 11, 13), w, h = px * 1.7, x, y;
        font(px); w = ctx.measureText(txt).width + px * 1.3;
        x = clamp(G.hc.x - w / 2, 3, W - w - 3); y = Math.max(3, G.hc.y - G.R - h - 4);
        ctx.globalAlpha = s.tagA;
        if (s.tag === "OUT") pill(x, y, w, h, "#241010", "#c9a2a2"); else pill(x, y, w, h, GOLD);
        ctx.fillStyle = s.tag === "OUT" ? IVORY : INK; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(txt, x + w / 2, y + h / 2 + px * 0.06);
        ctx.globalAlpha = 1;
      });
    }
    function drawParticles() {
      particles.forEach(function (q) {
        var p = P(q.x, q.y, q.z), sz = q.size * p.s, a = clamp(q.life / 0.35, 0, 1);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(q.rot);
        ctx.globalAlpha = a; ctx.fillStyle = q.color; ctx.fillRect(-sz / 2, -sz * 0.3, sz, sz * 0.6);
        ctx.restore();
      });
    }

    function inFrontOfTable(s) {
      // a token is drawn after the table when the camera is on its side of a face that separates the two
      if (s.z < -TW && cam.pz < -TW) return true;
      if (s.x < -TL && cam.px < -TL) return true;
      if (s.x > TL && cam.px > TL) return true;
      return false;
    }
    function draw() {
      if (!ctx || !sized) return;
      setCam(view.yaw + view.drift, view.pitch);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      drawRoom(); drawBench(); drawTrails();
      var back = [], front = [], M = cur >= 0 ? MS[cur] : null, streakOn = null;
      players.forEach(function (p) {
        var s = st[p.id]; s.G = geomOf(p, s); s.depth = P(s.x, s.y, s.z).d;
        (inFrontOfTable(s) ? front : back).push(p);
      });
      if (M && revealed && M.streak.count >= 2) {
        M.streak.ids.forEach(function (id) { if (st[id] && (!streakOn || st[id].z > st[streakOn].z)) streakOn = id; });
      }
      function byDepth(a, b) { return st[b.id].depth - st[a.id].depth; }
      back.sort(byDepth).forEach(function (p) { drawGround(p, st[p.id]); });
      back.forEach(function (p) { drawPawn(p, st[p.id], p.id === streakOn ? M.streak.count : 0); });
      drawTable();
      front.sort(byDepth).forEach(function (p) { drawGround(p, st[p.id]); });
      front.forEach(function (p) { drawPawn(p, st[p.id], p.id === streakOn ? M.streak.count : 0); });
      drawParticles(); drawTags();
    }

    // ---- a step: the change of players, then the result ----
    function go(k, opt) {
      opt = opt || {};
      if (!N || !el) return;
      k = clamp(Math.round(Number(k) || 0), 0, N - 1);
      if (k === cur && !opt.force) return;
      var now = nowMs(), prevLay = layoutFor(cur), lay = layoutFor(k), speed = opt.fast ? 0.42 : 1, nextOne = k === cur + 1;
      var movers = [], blockers = [], outs = [], ins = [];
      players.forEach(function (p) {
        var s = st[p.id], B = lay[p.id];
        s.tag = null; s.lift = 0;
        if (Math.abs(s.x - B.x) + Math.abs(s.z - B.z) + Math.abs(s.y - B.y) < 0.03) {
          s.x = B.x; s.y = B.y; s.z = B.z;
          if (B.at !== "B") blockers.push({ x: B.x, z: B.z });
          return;
        }
        var fromAt = prevLay[p.id].at, kind = B.at === "B" ? "OUT" : (fromAt === "B" ? "IN" : (fromAt !== B.at && nextOne && MS[k].change.switched ? "SWAP" : "MOVE"));
        var m = { p: p, A: { x: s.x, y: s.y, z: s.z }, B: B, kind: kind, delay: 60, t: 0, d: 0 };
        movers.push(m);
        if (kind === "OUT") outs.push(m); else if (kind === "IN") ins.push(m);
      });
      outs.sort(function (a, b) { return b.A.z - a.A.z; }).forEach(function (m, i) { m.delay = i * 150; });
      ins.sort(function (a, b) { return a.B.z - b.B.z; }).forEach(function (m, i) { m.delay = (outs.length ? 330 : 0) + i * 150; });
      var moveEnd = 0;
      movers.forEach(function (m) {
        m.path = buildPath(routePoints(m.A, m.B, m.kind, blockers));
        m.dur = clamp(520 + 140 * m.path.len, 680, 1250) * speed; m.delay *= speed;
        moveEnd = Math.max(moveEnd, m.delay + m.dur);
      });
      cur = k; revealed = false; particles = [];
      clockTarget = clockOf(MS[k], false);
      anim = { t0: now, movers: movers, moveEnd: moveEnd, revealAt: moveEnd + (movers.length ? 200 : 320) * speed, fast: !!opt.fast };
      // (no motion wanted, or nothing to see it on: the new state at once)
      if (reduced || opt.instant || !sized) settle();
      else { renderHud(); renderBoard(false); }
      renderTimeline();
      kick();
    }
    function clockOf(M, ended) {
      var m = minuteOf(ended ? M.end : M.start);
      return m === null ? clockTarget : m;
    }
    function crownTarget(id) { return (revealed && cur >= 0 && MS[cur].winIds.indexOf(id) >= 0) ? 1 : 0; }
    function dimTarget(id) { return (revealed && cur >= 0 && MS[cur].loseIds.indexOf(id) >= 0) ? 1 : 0; }
    function doReveal(now, quiet) {
      var M = MS[cur];
      revealed = true; celebT0 = quiet ? -1e9 : now; holdUntil = now + ((anim && anim.fast) ? 500 : 1000);
      clockTarget = clockOf(M, true);
      if (clockTarget < clockMin - 600) clockMin -= 1440;   // past midnight: the hands go on, not back
      if (!quiet && !reduced) {
        M.winIds.forEach(function (id) {
          var s = st[id], i, cols = [GOLD, "#ffe58a", byId[id].color, IVORY];
          for (i = 0; i < 18; i++) {
            particles.push({ x: s.x, y: 1.35, z: s.z, vx: (Math.random() - 0.5) * 2.6, vy: 1.6 + Math.random() * 2.6, vz: (Math.random() - 0.5) * 2.6,
              life: 0.9 + Math.random() * 0.6, color: cols[i % cols.length], size: 0.05 + Math.random() * 0.05, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
          }
        });
      }
      renderHud(); renderBoard(!quiet); renderTimeline();
    }
    // whatever is moving, done at once: everyone in place, the result shown
    function settle() {
      if (cur < 0) return;
      if (anim) { anim.movers.forEach(function (m) { var s = st[m.p.id]; s.x = m.B.x; s.y = m.B.y; s.z = m.B.z; }); anim = null; }
      if (!revealed) doReveal(nowMs(), true);
      particles = []; celebT0 = -1e9; view.amp = 0; view.drift = 0; clockMin = clockTarget;
      players.forEach(function (p) { var s = st[p.id]; s.lift = 0; s.tag = null; s.tagA = 0; s.crown = crownTarget(p.id); s.dim = dimTarget(p.id); });
    }

    function frame(now) {
      raf = 0;
      if (dead || !sized || !el) return;
      var dt = clamp(now - lastT, 0, 50), busy = false; lastT = now;
      if (anim) {
        var Tm = now - anim.t0;
        anim.movers.forEach(function (m) {
          var s = st[m.p.id], t = clamp((Tm - m.delay) / m.dur, 0, 1), L = m.path.len, d = easeIO(t) * L, q = pointAt(m.path, d), y = 0, u, edge;
          if (m.A.y > 0.01) { u = clamp(d / 0.85, 0, 1); y += m.A.y * (1 - smooth(u)) + 0.22 * Math.sin(Math.PI * u); }
          if (m.B.y > 0.01) { u = clamp((L - d) / 0.85, 0, 1); y += m.B.y * (1 - smooth(u)) + 0.22 * Math.sin(Math.PI * u); }
          edge = clamp(Math.min(d, L - d) / 0.3, 0, 1);
          s.x = q.x; s.z = q.z; s.y = y;
          s.lift = (y < 0.02) ? 0.055 * Math.abs(Math.sin(d * Math.PI / 0.46)) * edge : 0;
          s.tag = (t > 0 && t < 1) ? m.kind : null;
          m.t = t; m.d = d;
        });
        if (Tm >= anim.moveEnd) {
          anim.movers.forEach(function (m) { var s = st[m.p.id]; s.x = m.B.x; s.y = m.B.y; s.z = m.B.z; s.lift = 0; s.tag = null; });
          if (Tm >= anim.revealAt) { doReveal(now, false); anim = null; }
        }
        busy = true;
      }
      // the winners' hop, and the crown / dark values eased in
      var ct = (now - celebT0) / 1000, kf = 1 - Math.exp(-dt / 110);
      players.forEach(function (p) {
        var s = st[p.id], a = crownTarget(p.id), b = dimTarget(p.id);
        if (a && ct < 1.05 && !reduced) { s.lift = 0.5 * Math.abs(Math.sin(Math.PI * ct / 0.35)) * Math.pow(1 - ct / 1.05, 1.6); busy = true; }
        else if (!anim) s.lift = 0;
        if (Math.abs(a - s.crown) > 0.01) { s.crown += (a - s.crown) * (a > s.crown ? kf * 1.4 : kf * 2.2); busy = true; } else s.crown = a;
        if (Math.abs(b - s.dim) > 0.01) { s.dim += (b - s.dim) * kf; busy = true; } else s.dim = b;
      });
      if (particles.length) {
        var sec = dt / 1000;
        particles = particles.filter(function (q) {
          q.vy -= 6.5 * sec; q.x += q.vx * sec; q.y += q.vy * sec; q.z += q.vz * sec; q.rot += q.vr * sec; q.life -= sec;
          return q.life > 0 && q.y > 0;
        });
        busy = true;
      }
      if (Math.abs(clockTarget - clockMin) > 0.2) { clockMin += (clockTarget - clockMin) * (1 - Math.exp(-dt / 220)); busy = true; } else clockMin = clockTarget;
      // a slow sway of the camera while the night plays: the parallax sells the depth
      var ampT = (playing && !reduced && !dragState) ? 1 : 0;
      if (Math.abs(ampT - view.amp) > 0.005) { view.amp += (ampT - view.amp) * (1 - Math.exp(-dt / 500)); busy = true; } else view.amp = ampT;
      view.drift = view.amp * 0.075 * Math.sin(now / 2300);
      draw();
      if (playing && !anim && revealed && now >= holdUntil) {
        if (cur < N - 1) go(cur + 1); else setPlaying(false);
      }
      // (nothing moving: no loop)
      if ((busy || playing || dragState) && !raf) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && !dead && sized && el) { lastT = nowMs(); raf = requestAnimationFrame(frame); } }

    // ---- the panels ----
    function nameChip(id) { var p = byId[id]; return '<span class="pmc-nr-nm" style="background:' + p.color + '" title="' + esc(p.name) + '">' + esc(p.label) + "</span>"; }
    function scoreBox(S, M) {
      var txt = revealed ? String(S.shown) : "–";
      return '<b class="' + (revealed ? (S.won ? "win" : "") : "pend") + (txt.length > 2 ? " two" : "") + '">' + esc(txt) + (revealed && S.won ? CROWN_SVG : "") + "</b>";
    }
    function renderHud() {
      if (!el || cur < 0) return;
      var M = MS[cur], B = M.ball, decided = revealed && M.winIds.length > 0, html = "";
      el.ball.style.background = B.stripe ? "linear-gradient(#f4efe6 0,#f4efe6 20%," + B.color + " 20%," + B.color + " 80%,#f4efe6 80%)" : B.color;
      el.ballNo.textContent = B.no || "";
      el.ballNo.style.display = B.no ? "" : "none";
      // (one phrase for the translators, its number set large)
      el.no.innerHTML = esc(T("nightReplay.matchOf", { n: "", count: "" })).replace("", "<b>" + esc(M.n) + "</b>").replace("", String(N));
      el.game.textContent = groupLabel(M);
      el.time.textContent = M.start ? hhmm(M.start) + (M.end ? " – " + hhmm(M.end) : "") : (M.end ? T("nightReplay.ended", { time: hhmm(M.end) }) : "");
      el.dur.textContent = M.mins !== null ? T("nightReplay.minutes", { n: M.mins }) : "";
      var unit = M.byPoints ? '<small class="pmc-nr-unit">' + esc(T("nightReplay.points")) + "</small>" : "";
      function sideCls(S) { return (S.ids.length > 2 ? " many" : "") + (decided ? (S.won ? " pmc-nr-win" : " pmc-nr-lose") : ""); }
      if (M.sides.length === 2) {
        el.vs.className = "pmc-nr-vs";
        html = '<div class="pmc-nr-side L' + sideCls(M.sides[0]) + '">' + M.sides[0].ids.map(nameChip).join("") + "</div>" +
          '<div class="pmc-nr-pts">' + scoreBox(M.sides[0], M) + "<span>:</span>" + scoreBox(M.sides[1], M) + unit + "</div>" +
          '<div class="pmc-nr-side R' + sideCls(M.sides[1]) + '">' + M.sides[1].ids.map(nameChip).join("") + "</div>";
      } else {
        // each for themselves: every side with its own score
        el.vs.className = "pmc-nr-vs each";
        html = M.sides.map(function (S) {
          return '<div class="pmc-nr-one' + (decided ? (S.won ? " pmc-nr-win" : " pmc-nr-lose") : "") + '"><div class="pmc-nr-side' + (S.ids.length > 2 ? " many" : "") + '">' + S.ids.map(nameChip).join("") + "</div>" + scoreBox(S, M) + "</div>";
        }).join("") + unit;
      }
      el.vs.innerHTML = html;
      // (names that don't fit on one line: the smaller chips)
      Array.prototype.forEach.call(el.vs.querySelectorAll(".pmc-nr-side"), function (sd) {
        if (sd.children.length > 1 && sd.offsetHeight > sd.children[0].offsetHeight * 1.6 && !/ many/.test(sd.className)) sd.className += " many";
      });
      el.chips.innerHTML = chipsHtml(M, revealed);
    }

    function chipsHtml(M, over) {
      var ch = M.change, chips = "";
      // what changed going into this match...
      function chip(cls, inner) { chips += '<span class="pmc-nr-chip' + (cls ? " " + cls : "") + '">' + inner + "</span>"; }
      if (ch.first) chip("in", "<em>" + esc(T("nightReplay.chip.firstUp")) + "</em>" + chipNames(ch.ins));
      else {
        if (ch.switched) chip("gold", esc(T("nightReplay.chip.switched")));
        if (ch.sizeChanged) chip("gold", esc(M.sides.length > 2 ? T("nightReplay.chip.eachAlone") : (M.isTeam ? T("nightReplay.chip.teams", { sizes: sizesOf(M) }) : T("nightReplay.chip.oneOnOne"))));
        if (ch.gameChanged && M.game) chip("gold", esc(T("nightReplay.chip.nowGame", { game: M.game })));
        if (ch.gap >= 10) chip("note", esc(T("nightReplay.chip.break", { n: ch.gap })));
        if (ch.outs.length) chip("out", "<em>" + esc(T("nightReplay.chip.out")) + "</em>" + chipNames(ch.outs));
        if (ch.ins.length) chip("in", "<em>" + esc(T("nightReplay.chip.in")) + "</em>" + chipNames(ch.ins));
        if (!ch.outs.length && !ch.ins.length && !ch.switched) chip("", esc(T("nightReplay.chip.samePlayers")));
      }
      if (M.tournament) chip("note", esc(T("nightReplay.chip.tournament")));
      if (M.raceTo) chip("note", esc(T("nightReplay.chip.raceTo", { n: M.raceTo })));
      // ...and, once it is over, how it ended
      if (over) {
        if (M.skunk) chip("gold", esc(T("nightReplay.chip.skunk")));
        if (M.ballsLeft !== null) chip("note", esc(TP("nightReplay.chip.ballsLeft", M.ballsLeft, { n: M.ballsLeft })));
        if (M.lastPoints) chip("note", esc(T("nightReplay.chip.lastRack", { points: M.sides.map(function (S) { return M.lastPoints[S.src]; }).join(" – ") })));
        if (M.stopped) chip("note", esc(T("nightReplay.chip.stopped")));
        if (!M.winIds.length) chip("note", esc(T("nightReplay.chip.level")));
      }
      return chips;
    }
    // the most room the chips take on this night, at this width: kept free under the picture
    function chipRoom() {
      var i, max = 0;
      for (i = 0; i < N; i++) { el.chips.innerHTML = chipsHtml(MS[i], true); max = Math.max(max, el.chips.offsetHeight); }
      return clamp(max, 28, tight ? 90 : 64);
    }

    function renderTimeline() {
      if (!el) return;
      tks.forEach(function (t, i) {
        t.className = t.className.replace(/ (past|cur)\b/g, "") + (i === cur ? " cur" : "") + ((i < cur || (i === cur && revealed)) ? " past" : "");
      });
      el.strip.setAttribute("aria-valuenow", cur + 1);
      if (cur >= 0) el.strip.setAttribute("aria-valuetext", T("nightReplay.matchOf", { n: MS[cur].n, count: N }));
      el.bPrev.disabled = el.bFirst.disabled = cur <= 0;
      el.bNext.disabled = cur >= N - 1;
    }

    function renderBoard(animateNew) {
      if (!el) return;
      var through = revealed ? cur : cur - 1, M = through >= 0 ? MS[through] : null, now = cur >= 0 ? MS[cur] : null;
      function dotName(id) { var p = byId[id]; return '<span title="' + esc(p.name) + '"><i style="background:' + p.color + '"></i>' + esc(p.label) + "</span>"; }
      el.after.textContent = M ? T("nightReplay.afterMatch", { n: M.n }) : T("nightReplay.beforeFirst");
      var bestLine = M && M.best.count ? T("nightReplay.bestRun", { names: M.best.ids.map(function (id) { return byId[id].label; }).join(" & "), n: M.best.count }) : T("nightReplay.noRunYet");
      el.hold.innerHTML = '<div class="k">' + esc(T("nightReplay.holding")) + "</div>" +
        (M && M.streak.count > 0
          ? '<div class="who">' + M.streak.ids.map(dotName).join("") + '</div><div class="run"><b>' + M.streak.count + "</b><small>" + esc(M.streak.count === 1 ? T("nightReplay.streakOne") : T("nightReplay.streakRun")) + "</small></div>"
          : '<div class="who"><span class="none">' + esc(T("nightReplay.nobody")) + '</span></div><div class="run"><b>–</b><small>&nbsp;</small></div>') +
        '<div class="best">' + esc(bestLine) + "</div>";
      var order = players.slice().sort(function (a, b) {
        var A = M ? M.stats[a.id] : { p: 0, w: 0 }, B = M ? M.stats[b.id] : { p: 0, w: 0 };
        if (B.w !== A.w) return B.w - A.w;
        var ra = A.p ? A.w / A.p : -1, rb = B.p ? B.w / B.p : -1;
        if (rb !== ra) return rb - ra;
        if (A.p !== B.p) return A.p - B.p;
        return a.idx - b.idx;
      });
      order.forEach(function (p, rank) {
        var r = rowEls[p.id], s = M ? M.stats[p.id] : { p: 0, w: 0 };
        var at = now && now.place[p.id], hold = at && M && M.streak.ids.indexOf(p.id) >= 0;
        r.row.style.transform = "translateY(" + (rank * rowH) + "px)";
        r.row.className = "pmc-nr-row" + (hold ? " hold" : (at ? " at" : ""));
        r.rank.textContent = rank + 1;
        r.tag.textContent = hold ? T("nightReplay.holdsTable") : (at ? T("nightReplay.atTable") : "");
        r.tag.style.display = at ? "" : "none";
        r.num.innerHTML = "<b>" + s.w + "</b> / " + s.p;
        // game by game: a chip a rack (a 2-0 match = two), filled = won
        var n = 0, html = "", fresh = false;
        p.form.forEach(function (f) {
          if (f.i > through) return;
          n++;
          if (animateNew && f.i === through) fresh = true;
          html += '<i class="' + (f.w ? "w" : "l") + (animateNew && f.i === through ? " new" : "") + '"' + (f.w ? ' style="background:' + p.color + '"' : "") + ' title="' + esc(T("nightReplay.matchN", { n: MS[f.i].n })) + '"></i>';
        });
        if (r.formN !== n || animateNew) {
          r.form.innerHTML = html; r.formN = n;
          if (fresh) {
            var box2 = r.form;
            requestAnimationFrame(function () { requestAnimationFrame(function () {
              Array.prototype.forEach.call(box2.querySelectorAll(".new"), function (c) { c.className = c.className.replace(" new", ""); });
            }); });
          }
        }
      });
    }

    function setPlaying(on) {
      playing = !!on && N > 0 && sized;
      if (!el) return;
      el.bPlay.textContent = playing ? T("nightReplay.pause") : T("nightReplay.play");
      if (playing) { holdUntil = Math.min(holdUntil, nowMs() + 250); kick(); }
    }
    function rewind() {
      // everybody back on the bench, then the first match walks in
      players.forEach(function (p) { var s = st[p.id]; s.x = p.seat.x; s.y = p.seat.y; s.z = p.seat.z; s.crown = 0; s.dim = 0; });
      cur = -1; revealed = false; go(0, { force: true });
    }
    function togglePlay() {
      if (!playing && cur >= N - 1) { rewind(); setPlaying(true); return; }
      setPlaying(!playing);
    }
    function step(d) { setPlaying(false); go(cur + d); }

    // ---- input ----
    function resetView() { view.yaw = YAW0; view.pitch = basePitch; kick(); }
    function bind() {
      function on(target, type, fn) { target.addEventListener(type, fn, false); }
      on(el.bPrev, "click", function () { step(-1); });
      on(el.bNext, "click", function () { step(1); });
      on(el.bFirst, "click", function () { setPlaying(false); rewind(); });
      on(el.bPlay, "click", togglePlay);
      function stripIndex(e) {
        var r = el.strip.getBoundingClientRect();
        return clamp(Math.floor((e.clientX - r.left) / (r.width || 1) * N), 0, N - 1);
      }
      on(el.strip, "pointerdown", function (e) {
        scrub = true; setPlaying(false);
        try { el.strip.setPointerCapture(e.pointerId); } catch (err) {}
        go(stripIndex(e), { fast: Math.abs(stripIndex(e) - cur) > 1 });
        e.preventDefault();
        try { el.strip.focus(); } catch (err2) {}
      });
      on(el.strip, "pointermove", function (e) { if (scrub) go(stripIndex(e), { fast: true }); });
      on(el.strip, "pointerup", function () { scrub = false; });
      on(el.strip, "pointercancel", function () { scrub = false; });
      on(el.view, "pointerdown", function (e) {
        if (e.button) return;
        dragState = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, mouse: e.pointerType === "mouse" };
        try { el.view.setPointerCapture(e.pointerId); } catch (err) {}
        el.view.className = "pmc-nr-view drag";
      });
      on(el.view, "pointermove", function (e) {
        if (!dragState) return;
        view.yaw = clamp(dragState.yaw + (e.clientX - dragState.x) * 0.006, -0.8, 0.8);
        if (dragState.mouse) view.pitch = clamp(dragState.pitch + (e.clientY - dragState.y) * 0.004, 0.36, 1.0);
        kick();
      });
      function endDrag(e) {
        // a double tap (touch) sets the camera back; dblclick covers the mouse
        if (dragState && e && e.type === "pointerup" && !dragState.mouse && Math.abs(e.clientX - dragState.x) + Math.abs(e.clientY - dragState.y) < 8) {
          if (e.timeStamp - lastTap < 320) resetView();
          lastTap = e.timeStamp;
        }
        dragState = null; el.view.className = "pmc-nr-view";
      }
      on(el.view, "pointerup", endDrag);
      on(el.view, "pointercancel", endDrag);
      on(el.view, "dblclick", resetView);
    }
    function onGlobal(target, type, fn) { target.addEventListener(type, fn, false); globals.push([target, type, fn]); }
    // (only keys pressed inside the root, and only its own: the app's "/", "*" and letters go on to the app)
    onGlobal(root, "keydown", function (e) {
      var t = e.target && e.target.tagName, k = e.key, c = e.keyCode;
      if (!N || !el || e.metaKey || e.ctrlKey || e.altKey || t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
      if (k === "ArrowRight" || c === 39) step(1);
      else if (k === "ArrowLeft" || c === 37) step(-1);
      else if (k === "Home" || c === 36) { setPlaying(false); go(0, { fast: true }); }
      else if (k === "End" || c === 35) { setPlaying(false); go(N - 1, { fast: true }); }
      else if ((k === " " || k === "Spacebar" || c === 32) && t !== "BUTTON") togglePlay();
      else return;
      e.preventDefault(); e.stopPropagation();
    });
    function resized() { if (!dead && Math.round(root.getBoundingClientRect().width) !== rootW) measure(); }
    if (window.ResizeObserver) { observer = new ResizeObserver(resized); observer.observe(root); }
    onGlobal(window, "resize", function () { if (rz) return; rz = requestAnimationFrame(function () { rz = 0; resized(); }); });

    // ---- start ----
    addStyle();
    var hadTab = root.hasAttribute("tabindex");
    if (root.classList) root.classList.add("pmc-nr");
    if (!hadTab) root.setAttribute("tabindex", "0");
    root.setAttribute("role", "group");
    load(night);

    var api = {
      setNight: function (nt) { if (!dead) load(nt); },
      refresh: function () { if (dead) return; build(); rootW = -1; measure(); },
      goTo: function (k) { if (dead || !N) return; setPlaying(false); pending = false; go(k, { fast: Math.abs(k - cur) > 1 }); },
      play: function () { if (dead || !N || playing) return; if (cur >= N - 1) rewind(); setPlaying(true); },
      pause: function () { if (!dead) setPlaying(false); },
      state: function () { return { count: N, index: cur, playing: playing, moving: !!raf, width: Math.max(0, rootW) }; },
      destroy: function () {
        if (dead) return;
        dead = true; playing = false; anim = null;
        if (raf) cancelAnimationFrame(raf);
        if (rz) cancelAnimationFrame(rz);
        raf = 0; rz = 0;
        if (observer) observer.disconnect();
        globals.forEach(function (l) { l[0].removeEventListener(l[1], l[2], false); });
        root.innerHTML = ""; el = null; ctx = null;
        if (root.classList) { root.classList.remove("pmc-nr"); root.classList.remove("pmc-nr--wide"); root.classList.remove("pmc-nr--tight"); }
        if (!hadTab) root.removeAttribute("tabindex");
        root.removeAttribute("role"); root.removeAttribute("aria-label");
        root.__pmcNightReplay = null;
      }
    };
    root.__pmcNightReplay = api;
    return api;
  }

  window.PMCNightReplay = { mount: mount };
})();
