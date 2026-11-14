// js/night-map.js
// 🗺️ The map, in 🧊 The night in 3D: a night as a diagram in space, to turn
// and move around like a map - nothing plays, nothing walks.
// The white line is the table: a ball for every match, in order. Each
// match is a slice across it: round the match's ball, a ball for every
// player of the night (each their own direction from the table, all
// night) - solid for who plays that match, very faint for who doesn't.
// Who plays is joined to their side's node, and the sides to the match's
// ball; gold is the winning side (its node, its way into the ball, a ring
// round its players). From slice to slice a line takes every player to
// their next ball: solid while they play, fading out where they stop and
// in where they come back. So a match is its solid balls, and a player's
// night one line - there where it is solid.
// Two shapes: 🌀 spiral (the table's line winds round and up - compact, the
// whole night at a glance) and ➖ straight (the order of things, left to
// right; top to bottom in a narrow box).
// Drag: turn it. Two fingers, Shift-drag or right-drag: move it. Pinch,
// Ctrl-wheel, + / −: zoom. Double-tap: back as it was. Three ready views:
// 3D, from the side, and from above (spiral) or end-on (straight: looking
// down the table). Tap a player (a chip, a node): their path alone. Tap a
// ball: that match in words. The players' names in between show from near
// enough to read them.
//
// The night comes from js/lib/night-timeline.js (PMCLib.nightTimeline.build).
// PMCNightMap.mount(root, night, { t(key, vars), tp(key, n, vars),
//   clock(localIso), onSavePicture() }) -> { setNight(night), refresh(),
//   destroy(), highlight(playerId | null), view("3d" | "side" | "end"),
//   shape("spiral" | "line"), spots(), pictureDataUrl(), state() }
//   - nothing is drawn while root has no width (a folded panel): refresh(),
//     or the width coming, draws it.
//   - pictureDataUrl(): what's on show now as a PNG data URL, made at once
//     (a share sheet opens only from inside the tap).
//   - state(): { matches, players, nodes, highlight, selected, shape, view,
//     yaw, pitch, zoom, width } (tests).
// Words: every one through T / TP (keys nightMap.*) - the app's when given,
// else the English below (the same keys as languages/english.json).
(function () {
  "use strict";

  var STR = {
    "nightMap.empty": "No games that day.",
    "nightMap.aria": "A map of the night in 3D. Drag to turn it.",
    "nightMap.hint": "Drag: turn · two fingers or Shift-drag: move · pinch or + / −: zoom · double-tap: reset",
    "nightMap.view3d": "3D",
    "nightMap.viewSide": "Side",
    "nightMap.viewEnd": "End-on",
    "nightMap.viewTop": "From above",
    "nightMap.shapeAria": "The shape of the map",
    "nightMap.shapeSpiral": "🌀 Spiral",
    "nightMap.shapeLine": "➖ Straight",
    "nightMap.zoomIn": "Zoom in",
    "nightMap.zoomOut": "Zoom out",
    "nightMap.reset": "Reset the view",
    "nightMap.savePicture": "🖼️ Save as picture",
    "nightMap.chipStats": "{{played}} played · {{won}} won",
    "nightMap.qScore": "Rating",
    "nightMap.qScoreTitle": "Rating {{rating}} at the end of that day ({{change}} that day)",
    "nightMap.infoQ": "Rating: {{list}}",
    "nightMap.keyQ": "Numbers: the rating, and what a match did to it",
    "nightMap.keyTrunk": "White line: the table, match after match",
    "nightMap.keyPlay": "Solid: playing that match",
    "nightMap.keyAside": "Faint: not playing it",
    "nightMap.keyGold": "Gold: the winning side",
    "nightMap.keyTap": "Tap a player to follow them, a ball for its match.",
    "nightMap.matchNo": "Match {{n}}",
    "nightMap.versus": "{{a}} v {{b}}",
    "nightMap.wonBy": "Won by {{names}}",
    "nightMap.noWinner": "No winner",
    "nightMap.score": "Score {{score}}",
    "nightMap.endedAt": "Ended {{time}}",
    "nightMap.raceTo": "Race to {{n}}",
    "nightMap.tournament": "Tournament",
    "nightMap.stoppedEarly": "Stopped early",
    "nightMap.skunk": "🦨 Skunk",
    "nightMap.ballsLeft": "{{n}} balls left",
    "nightMap.ballsLeftOne": "{{n}} ball left",
    "nightMap.changeIn": "In: {{names}}",
    "nightMap.changeOut": "Out: {{names}}",
    "nightMap.partnersSwitched": "Partners switched",
    "nightMap.close": "Close"
  };
  var STYLE_ID = "pmc-night-map-style";
  var CSS = [
    ".pmc-nm{display:block;font:inherit;color:var(--text,#f6efe9)}",
    ".pmc-nm-top{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}",
    ".pmc-nm-legend{display:flex;flex-wrap:wrap;gap:6px;flex:1 1 300px;min-width:0}",
    ".pmc-nm-chip{display:grid;grid-template-columns:auto auto auto;column-gap:8px;align-items:center;text-align:left;margin:0;font:inherit;color:var(--text,#f6efe9);background:var(--bg-card,#2e1414);border:1px solid var(--border,#4a1e1e);border-radius:12px;padding:5px 12px 5px 9px;min-height:44px;cursor:pointer;box-shadow:none}",
    ".pmc-nm-chip i{grid-row:1 / span 2;width:10px;height:30px;border-radius:5px;display:block}",
    ".pmc-nm-chip b{font-weight:800;line-height:1.15}.pmc-nm-chip small{color:var(--text-dim,#c9a2a2);font-size:.8rem;line-height:1.15;font-variant-numeric:tabular-nums}",
    ".pmc-nm-q{grid-column:3;grid-row:1 / span 2;display:grid;justify-items:end;margin-left:6px;padding-left:10px;border-left:1px solid var(--border,#4a1e1e);font-variant-numeric:tabular-nums;line-height:1.15}",
    ".pmc-nm-q em{font-style:normal;font-size:.68rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-dim,#c9a2a2)}.pmc-nm-q strong{font-weight:800;font-size:1.05rem}",
    ".pmc-nm-q span{font-size:.8rem;font-weight:800}.pmc-nm-q .pmc-nm-up{color:#3fbf6b}.pmc-nm-q .pmc-nm-down{color:#f0605d}.pmc-nm-q .pmc-nm-flat{color:var(--text-dim,#c9a2a2)}",
    ".pmc-nm-chip.pmc-nm-on{border-color:var(--accent,#e8b923);box-shadow:inset 0 0 0 1px var(--accent,#e8b923)}.pmc-nm-chip.pmc-nm-off{opacity:.5}",
    ".pmc-nm-btn{font:inherit;font-weight:800;min-height:44px;min-width:44px;padding:0 12px;border-radius:12px;border:1px solid var(--border,#4a1e1e);background:var(--bg-card,#2e1414);color:var(--text,#f6efe9);cursor:pointer;box-shadow:none}",
    ".pmc-nm-btn.pmc-nm-on{border-color:var(--accent,#e8b923);background:var(--accent,#e8b923);color:var(--on-accent,#241a00)}",
    ".pmc-nm-btn.pmc-nm-save{background:var(--accent,#e8b923);border-color:var(--accent,#e8b923);color:var(--on-accent,#241a00)}",
    ".pmc-nm-chip:focus-visible,.pmc-nm-btn:focus-visible,.pmc-nm-view:focus-visible{outline:2px solid var(--accent,#e8b923);outline-offset:2px}",
    ".pmc-nm-view{position:relative;border-radius:var(--radius,14px);overflow:hidden;border:1px solid #4a1e1e;background:radial-gradient(ellipse at 50% 35%,#2a1010 0%,#140707 70%,#0d0404 100%)}",
    ".pmc-nm-view canvas{display:block;width:100%;touch-action:none;cursor:grab}.pmc-nm-view.pmc-nm-drag canvas{cursor:grabbing}",
    ".pmc-nm-tools{position:absolute;right:8px;top:8px;display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;max-width:calc(100% - 16px)}",
    ".pmc-nm-shapes{position:absolute;right:8px;bottom:8px;display:flex;gap:6px}",
    ".pmc-nm-tools .pmc-nm-btn,.pmc-nm-shapes .pmc-nm-btn{background:rgba(20,7,7,.82);border-color:#5a2a2a;color:#f6efe9;min-height:40px;min-width:40px;padding:0 10px}",
    ".pmc-nm-tools .pmc-nm-btn.pmc-nm-on,.pmc-nm-shapes .pmc-nm-btn.pmc-nm-on{background:#e8b923;border-color:#e8b923;color:#241a00}",
    ".pmc-nm-hint{position:absolute;left:10px;bottom:8px;right:230px;font-size:.78rem;color:rgba(246,239,233,.5);pointer-events:none}",
    ".pmc-nm-narrow .pmc-nm-hint{right:10px;bottom:56px}.pmc-nm-narrow .pmc-nm-tools{top:auto;bottom:8px;right:auto;left:8px;justify-content:flex-start;max-width:calc(100% - 200px)}",
    ".pmc-nm-info{position:absolute;left:8px;top:8px;max-width:min(330px,calc(100% - 16px));background:rgba(20,7,7,.93);border:1px solid #e8b923;border-radius:12px;padding:10px 40px 10px 12px;color:#f6efe9;font-size:.92rem;line-height:1.35}",
    ".pmc-nm-info b{display:block;color:#e8b923}.pmc-nm-info div{margin-top:3px}.pmc-nm-info .dim{color:#c9a2a2}",
    ".pmc-nm-info button{position:absolute;right:4px;top:4px;width:36px;height:36px;border:0;background:none;color:#f6efe9;font-size:1.3rem;cursor:pointer;box-shadow:none;padding:0}",
    ".pmc-nm-key{display:flex;flex-wrap:wrap;gap:4px 18px;margin-top:8px;color:var(--text-dim,#c9a2a2);font-size:.85rem}",
    ".pmc-nm-key span{display:inline-flex;align-items:center;gap:6px}.pmc-nm-key i{display:inline-block;box-sizing:border-box;flex:none}",
    ".pmc-nm-k-line{width:24px;height:4px;border-radius:2px;background:var(--text,#f6efe9);opacity:.6}.pmc-nm-k-gold{width:24px;height:6px;border-radius:3px;background:#e8b923}",
    ".pmc-nm-k-ball{width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#bfe0ff,#5aa9ff 55%,#2b5c96)}",
    ".pmc-nm-k-q{font-style:normal;font-weight:800;font-size:.8rem;color:#3fbf6b}.pmc-nm-k-q::before{content:\"+4\"}.pmc-nm-k-faint{width:14px;height:14px;border-radius:50%;background:#5aa9ff;opacity:.25}",
    ".pmc-nm-empty{color:var(--text-dim,#c9a2a2);padding:14px 0}"
  ].join("\n");

  var GOLD = "#e8b923", GREY = "#8f7f7f";
  // the space: a step along the table per match, the ring of seats, the sides' nodes between
  var DX = 150, INNER = 84, SIDE = 38, GHOST = 0.13; // (GHOST: how faint a player is in a match they don't play)
  // the game's ball: [number or "", colour, striped]
  var BALLS = { "8ball": [8, "#16161a", 0], "8ballrotation": [8, "#16161a", 0], "8ballpunishment": [8, "#16161a", 0], "9ball": [9, "#f2c21c", 1], "10ball": [10, "#2a62c9", 1], "15ballrotation": [15, "#7a2230", 1], "straight": [14, "#1f8a4c", 1], "onepocket": [1, "#f2c21c", 0], "snooker": ["", "#c62828", 0] };

  var words = null;
  function fill(s, vars) { return String(s).replace(/\{\{(\w+)\}\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; }); }
  function T(key, vars) { return words && words.t ? String(words.t(key, vars)) : fill(STR[key] || key, vars); }
  function TP(key, n, vars) { return words && words.tp ? String(words.tp(key, n, vars)) : fill(STR[n === 1 ? key + "One" : key] || STR[key] || key, vars); }
  function clockOf(iso) {
    if (iso && words && typeof words.clock === "function") { try { var own = words.clock(iso); if (own) return own; } catch (e) {} }
    var m = /T(\d\d):(\d\d)/.exec(iso || "");
    return m ? m[1] + ":" + m[2] : "";
  }
  function signed(n) { return n > 0 ? "+" + n : n < 0 ? "−" + -n : "±0"; } // (a change, with its sign)
  function rgb(h) { h = h.replace("#", ""); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function rgba(h, a) { var c = rgb(h); return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")"; }
  function mix(h1, h2, u) { var a = rgb(h1), b = rgb(h2); return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * u) + "," + Math.round(a[1] + (b[1] - a[1]) * u) + "," + Math.round(a[2] + (b[2] - a[2]) * u) + ")"; }
  function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }

  // ---- the night as nodes and lines in space ----
  // Along the table's line: the matches, in order - each a slice across it. In every slice the match's
  // ball on the line and, round it, a ball for every player of the night (each their own direction from
  // the table, all night): solid for who plays that match - joined to their side's node, and the sides to
  // the match's ball - and very faint for who doesn't. From slice to slice a line takes every player to
  // their next ball: solid while they play, fading out as they stop and in as they come back.
  // Two shapes: "spiral" - the table's line winds up and round, a turn of some dozen matches (compact: the
  // whole night at a glance, to walk around), and "line" - straight (the order of things, left to right).
  function build(night, shape) {
    var players = night.players, n = players.length, N = night.matches.length;
    var seat = {}, idx = {};
    players.forEach(function (p, i) {
      var a = -Math.PI / 2 + 2 * Math.PI * i / Math.max(3, n); // (the first on top; two players: not on one line through the table)
      seat[p.id] = [-Math.sin(a), Math.cos(a)]; // (up, and across: outwards on a spiral)
      idx[p.id] = i;
    });
    // where the table's line is at match t (halves too), and the two ways across it there
    var perTurn = Math.max(9, Math.min(14, N + 1)), big = perTurn * DX / (2 * Math.PI), rise = N > perTurn ? 2 * INNER + 190 : 150;
    function frame(t) {
      if (shape !== "spiral") return { o: [(t - (N - 1) / 2) * DX, 0, 0], u: [0, 1, 0], v: [0, 0, 1] };
      var f = -Math.PI / 2 + 2 * Math.PI * t / perTurn; // (it starts at the front, and goes round to the right)
      return { o: [big * Math.cos(f), rise * (t / perTurn - N / perTurn / 2), big * Math.sin(f)], u: [0, 1, 0], v: [Math.cos(f), 0, Math.sin(f)] };
    }
    function off(t, a, b) { var f = frame(t); return [f.o[0] + f.u[0] * a + f.v[0] * b, f.o[1] + f.u[1] * a + f.v[1] * b, f.o[2] + f.u[2] * a + f.v[2] * b]; }
    var nodes = [], lines = [], shapes = [];
    function node(o) { o.i = nodes.length; nodes.push(o); return o; }
    // (a line: straight, in a few pieces - each is drawn at its own depth)
    function line(a, b, o) {
      var pts = [], steps = 5;
      for (var s = 0; s <= steps; s++) { var u = s / steps; pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]); }
      o.pts = pts;
      lines.push(o);
    }
    function along(a, b, from, to) { // (a line along the table's, at a, b across it)
      var pts = [];
      for (var t = from; t < to; t += 0.25) pts.push(off(t, a, b));
      pts.push(off(to, a, b));
      return pts;
    }
    var before = {}; // player -> their ball in the slice before: { p, played }
    for (var k = 0; k < N; k++) {
      var m = night.matches[k], sideOf = {};
      m.sides.forEach(function (s, si) { s.players.forEach(function (id) { sideOf[id] = si; }); });
      var ball = node({ kind: "match", m: m, k: k, p: off(k, 0, 0), r: 17 });
      // each side's node: towards its players; two sides that would sit together are pushed apart
      var dirs = m.sides.map(function (s) {
        var y = 0, z = 0;
        s.players.forEach(function (id) { y += seat[id][0]; z += seat[id][1]; });
        var d = Math.sqrt(y * y + z * z);
        if (d < 0.2) { y = -seat[s.players[0]][1]; z = seat[s.players[0]][0]; d = 1; }
        return [y / d, z / d];
      });
      if (dirs.length === 2 && dirs[0][0] * dirs[1][0] + dirs[0][1] * dirs[1][1] > 0.6) {
        var qy = -dirs[0][1], qz = dirs[0][0];
        dirs[0] = [dirs[0][0] * 0.6 + qy * 0.8, dirs[0][1] * 0.6 + qz * 0.8];
        dirs[1] = [dirs[1][0] * 0.6 - qy * 0.8, dirs[1][1] * 0.6 - qz * 0.8];
      }
      var meet = m.sides.map(function (s, si) {
        var winner = m.winner === si;
        if (s.players.length < 2) return ball;
        var t = node({ kind: "side", m: m, k: k, side: si, p: off(k, dirs[si][0] * SIDE, dirs[si][1] * SIDE), r: 8, winner: winner, ids: s.players });
        line(t.p, ball.p, { kind: "sideIn", k: k, ids: s.players, winner: winner, w: winner ? 7 : 4 });
        return t;
      });
      players.forEach(function (p) {
        var id = p.id, plays = sideOf[id] !== undefined, won = plays && m.winner === sideOf[id], from = before[id];
        var nd = node({ kind: "player", id: id, k: k, m: m, ghost: !plays, p: off(k, seat[id][0] * INNER, seat[id][1] * INNER), r: 12, winner: won, first: k === 0, last: k === N - 1 });
        // from the slice before: solid while they play, fading where they stop or come back, faint while they don't
        if (from) line(from.p, nd.p, { kind: "path", k: k, ids: [id], a0: from.played ? 1 : GHOST, a1: plays ? 1 : GHOST, w: from.played && plays ? 3.6 : 3 });
        if (plays) line(nd.p, meet[sideOf[id]].p, { kind: "join", k: k, ids: [id], winner: won, w: 3.6 });
        before[id] = { p: nd.p, played: plays };
      });
    }
    lines.push({ kind: "table", ids: [], w: 2.4, pts: along(0, 0, -0.6, N - 0.4) });
    // a spiral stands on a floor: three faint circles under it - they turn with it, and say which way is up
    if (shape === "spiral") {
      var low = Infinity;
      nodes.forEach(function (nd) { low = Math.min(low, nd.p[1]); });
      [big - INNER - 40, big, big + INNER + 40].forEach(function (rad) {
        var ring = [];
        for (var a = 0; a <= 72; a++) ring.push([Math.cos(a / 72 * 2 * Math.PI) * rad, low - 60, Math.sin(a / 72 * 2 * Math.PI) * rad]);
        shapes.push({ kind: "floor", pts: ring });
      });
    }
    // all of it about its own middle (the view turns about it)
    var lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], size = 0;
    nodes.forEach(function (nd) { for (var c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], nd.p[c]); hi[c] = Math.max(hi[c], nd.p[c]); } });
    function centre(q) { for (var c = 0; c < 3; c++) q[c] -= (lo[c] + hi[c]) / 2; }
    var seen = [];
    function all(pts) { pts.forEach(function (q) { if (seen.indexOf(q) === -1) { seen.push(q); centre(q); } }); }
    nodes.forEach(function (nd) { all([nd.p]); });
    lines.forEach(function (ln) { all(ln.pts); });
    shapes.forEach(function (sh) { all(sh.pts); });
    nodes.forEach(function (nd) { size = Math.max(size, Math.sqrt(nd.p[0] * nd.p[0] + nd.p[1] * nd.p[1] + nd.p[2] * nd.p[2])); });
    return { night: night, shape: shape === "spiral" ? "spiral" : "line", nodes: nodes, lines: lines, shapes: shapes, idx: idx, size: size + 40 };
  }

  // the ready views, as [turn, tilt]: for the table running left to right (a wide box), and top to bottom (a narrow one)
  var VIEWS = { "3d": [0.5, 0.34], side: [0, 0], end: [Math.PI / 2 - 0.0001, 0] };
  var VIEWS_TALL = { "3d": [0.6, 0.3], side: [0, 0], end: [0, -Math.PI / 2 + 0.0001] };
  var VIEWS_SPIRAL = { "3d": [0.3, 0.72], side: [0, 0.1], end: [0, Math.PI / 2 - 0.0001] }; // ("end": from above)

  function mount(root, night, opts) {
    opts = opts || {};
    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement("style");
      style.id = STYLE_ID; style.textContent = CSS;
      document.head.appendChild(style);
    }
    var model = null, hi = null, sel = null, dead = false, ro = null, lastW = 0, chips = [], viewBtns = {};
    var cam = { yaw: 0, pitch: 0, zoom: 1, panX: 0, panY: 0, name: "3d" };
    var W = 0, H = 0, dpr = 1, hits = [], tall = false, shape = opts.shape === "line" ? "line" : "spiral", nightNow = null, shapeBtns = {};
    // (a straight table in a narrow box stands up: time runs down, the turn is about the table)
    function stands() { return tall && shape === "line"; }
    function views() { return shape === "spiral" ? VIEWS_SPIRAL : tall ? VIEWS_TALL : VIEWS; }
    function use() { words = opts; }

    root.innerHTML = "";
    root.classList.add("pmc-nm");
    var empty = el("div", "pmc-nm-empty", root);
    var body = el("div", "", root);
    var top = el("div", "pmc-nm-top", body);
    var legend = el("div", "pmc-nm-legend", top);
    var save = el("button", "pmc-nm-btn pmc-nm-save", top);
    save.type = "button";
    var view = el("div", "pmc-nm-view", body);
    view.tabIndex = 0;
    var canvas = el("canvas", "", view);
    var ctx = canvas.getContext("2d");
    var tools = el("div", "pmc-nm-tools", view);
    ["3d", "side", "end"].forEach(function (name) {
      var b = el("button", "pmc-nm-btn", tools);
      b.type = "button";
      b.addEventListener("click", function () { setView(name); });
      viewBtns[name] = b;
    });
    var zoomOut = el("button", "pmc-nm-btn", tools), zoomIn = el("button", "pmc-nm-btn", tools), reset = el("button", "pmc-nm-btn", tools);
    zoomOut.type = zoomIn.type = reset.type = "button";
    zoomOut.textContent = "−"; zoomIn.textContent = "+"; reset.textContent = "⟲";
    zoomOut.addEventListener("click", function () { zoomBy(1 / 1.3); });
    zoomIn.addEventListener("click", function () { zoomBy(1.3); });
    reset.addEventListener("click", function () { setView("3d"); });
    var shapes = el("div", "pmc-nm-shapes", view);
    ["spiral", "line"].forEach(function (name) {
      var b = el("button", "pmc-nm-btn", shapes);
      b.type = "button";
      b.addEventListener("click", function () { setShape(name); });
      shapeBtns[name] = b;
    });
    var hint = el("div", "pmc-nm-hint", view);
    var info = el("div", "pmc-nm-info", view);
    info.hidden = true;
    var key = el("div", "pmc-nm-key", body);

    // ---- the camera: turned about the middle, a little perspective, fitted to the box ----
    function project(p) {
      var cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
      var up = stands(), px = up ? p[1] : p[0], py = up ? -p[0] : p[1];
      var x = px * cy + p[2] * sy, z = -px * sy + p[2] * cy;
      var y = py * cp + z * sp, d = -py * sp + z * cp; // (tilt > 0: seen from above)
      var far = model.size * 2.6 + 500, s = far / (far + d);
      return [W / 2 + cam.panX + x * s * cam.zoom, H / 2 + cam.panY - y * s * cam.zoom, d, s * cam.zoom];
    }
    function fit() {
      cam.zoom = 1; cam.panX = 0; cam.panY = 0;
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      model.nodes.forEach(function (nd) {
        var q = project(nd.p);
        minX = Math.min(minX, q[0]); maxX = Math.max(maxX, q[0]); minY = Math.min(minY, q[1]); maxY = Math.max(maxY, q[1]);
      });
      var padX = tall ? 34 : Math.min(84, W * 0.1), padY = tall ? 56 : 54;
      var z = Math.min((W - 2 * padX) / Math.max(1, maxX - minX), (H - 2 * padY) / Math.max(1, maxY - minY));
      cam.zoom = Math.max(0.05, z);
      cam.panX = -((minX + maxX) / 2 - W / 2) * cam.zoom;
      cam.panY = -((minY + maxY) / 2 - H / 2) * cam.zoom + 6;
    }
    function setView(name) {
      var v = views()[name] || views()["3d"];
      cam.name = name;
      cam.yaw = v[0]; cam.pitch = v[1];
      renderViewButtons();
      if (model && W) fit();
      draw();
    }
    function zoomBy(f, cx, cy) {
      if (!model) return;
      var z = Math.max(0.05, Math.min(12, cam.zoom * f)), k = z / cam.zoom;
      // (about the pointer, or the middle: what's under it stays under it)
      var ox = (cx === undefined ? W / 2 : cx) - W / 2, oy = (cy === undefined ? H / 2 : cy) - H / 2;
      cam.panX = ox - (ox - cam.panX) * k; cam.panY = oy - (oy - cam.panY) * k;
      cam.zoom = z;
      draw();
    }

    // ---- drawing: everything far to near ----
    function dimmed(ids) { return hi !== null && ids.indexOf(hi) === -1; }
    function colourOf(id) { return model.night.players[model.idx[id]].color; }
    function draw() {
      if (dead || !model || !W) return;
      use();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var items = [], range = model.size;
      function fog(d) { return Math.max(0.3, Math.min(1, 1 - (d + range * 0.25) / (range * 2.4))); }
      model.shapes.forEach(function (sh) {
        var pr = sh.pts.map(project), d = 0;
        pr.forEach(function (q) { d += q[2]; });
        items.push({ d: d / pr.length + 4000, shape: sh, pr: pr });
      });
      model.lines.forEach(function (ln) {
        var pr = ln.pts.map(project);
        for (var s = 0; s < pr.length - 1; s++) items.push({ d: (pr[s][2] + pr[s + 1][2]) / 2, a: pr[s], b: pr[s + 1], ln: ln, u: (s + 0.5) / (pr.length - 1) });
      });
      model.nodes.forEach(function (nd) { var q = project(nd.p); nd.q = q; items.push({ d: q[2] - 1, nd: nd }); });
      items.sort(function (a, b) { return b.d - a.d; });
      hits = [];
      var labels = [];
      items.forEach(function (it) {
        if (it.shape) {
          ctx.beginPath();
          it.pr.forEach(function (q, i) { if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
          ctx.strokeStyle = "rgba(232,185,35,0.1)"; ctx.lineWidth = 1.2; ctx.stroke();
          return;
        }
        if (it.ln) {
          var ln = it.ln, f = fog(it.d), sc = (it.a[3] + it.b[3]) / 2, col, alpha = 1;
          if (ln.kind === "table") { col = "#f6efe9"; alpha = 0.34; }
          else if (ln.kind === "sideIn") { col = ln.winner ? GOLD : GREY; alpha = ln.winner ? 1 : 0.85; }
          else if (ln.kind === "path") { col = colourOf(ln.ids[0]); alpha = ln.a0 + (ln.a1 - ln.a0) * it.u; if (hi === ln.ids[0]) alpha = Math.max(alpha, 0.4); } // (followed: their faint stretches a little clearer)
          else { col = colourOf(ln.ids[0]); alpha = 1; }
          if (ln.ids.length && dimmed(ln.ids)) { alpha *= 0.1; }
          else if (hi !== null && !ln.ids.length) alpha *= 0.5;
          ctx.lineCap = alpha < 0.5 ? "butt" : "round"; // (faint pieces end to end: round ends would show as beads)
          ctx.beginPath(); ctx.moveTo(it.a[0], it.a[1]); ctx.lineTo(it.b[0], it.b[1]);
          ctx.globalAlpha = alpha * f;
          ctx.strokeStyle = col; ctx.lineWidth = Math.max(0.8, ln.w * sc);
          ctx.stroke();
          ctx.globalAlpha = 1;
          return;
        }
        var nd = it.nd, q = nd.q, r = Math.max(2.5, nd.r * q[3]), fg = fog(q[2]), a = 1;
        if (nd.kind === "player") {
          var pl = model.night.players[model.idx[nd.id]], col = colourOf(nd.id), ends = nd.first || nd.last;
          // in a match they don't play: very faint (a little clearer when followed)
          if (nd.ghost) a = hi === nd.id ? 0.4 : GHOST;
          if (dimmed([nd.id])) a *= 0.13;
          // a ball of their colour - a gold ring: won this one
          if (nd.winner) { ctx.globalAlpha = a * fg; ctx.beginPath(); ctx.arc(q[0], q[1], r + Math.max(1.5, 2.6 * q[3]), 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); ctx.globalAlpha = 1; }
          ball(q[0], q[1], nd.ghost ? r * 0.8 : r, col, nd.ghost ? a : a * fg);
          hits.push({ x: q[0], y: q[1], r: Math.max(16, r + 6), player: nd.id });
          // the name over it: in the first and the last slice (faint with the ball); in between for who plays, when followed or from near enough to read it
          // ...and their Q-Score: going into the night in the first slice, at its end in the last; in between, what that match did to it
          if (ends || (!nd.ghost && (hi === nd.id || r >= 12.5))) {
            var qs = pl.qScore, mq = nd.m.qScores && nd.m.qScores[nd.id], extra = "", extraCol = "#f6efe9";
            if (ends && qs) extra = String(nd.first ? qs.start : qs.end);
            else if (!ends && mq) { extra = signed(mq.delta); extraCol = mq.delta > 0 ? "#5fd98a" : mq.delta < 0 ? "#ff7a76" : "#c9a2a2"; }
            labels.push({ x: q[0], y: q[1] - r - 4, text: pl.short || pl.name, extra: extra, extraCol: extraCol, col: col, a: nd.ghost ? Math.max(0.45, a) * (dimmed([nd.id]) ? 0.3 : 1) : a, d: q[2], bold: true, rank: nd.ghost ? 2.5 : ends ? 1 : hi === nd.id ? 1 : 3 });
          }
        } else if (nd.kind === "side") {
          if (hi !== null && nd.ids.indexOf(hi) === -1) a = 0.15;
          ball(q[0], q[1], r, nd.winner ? GOLD : GREY, a * fg);
        } else {
          var m = nd.m, mine = hi === null || m.sides.some(function (s) { return s.players.indexOf(hi) !== -1; });
          a = mine ? 1 : 0.2;
          var b = BALLS[m.gameType] || ["", "#f4efe6", 0];
          if (m.winner !== null) { // (a gold ring: it has a winner)
            ctx.globalAlpha = a * fg; ctx.beginPath(); ctx.arc(q[0], q[1], r + Math.max(2, 3.5 * q[3]), 0, Math.PI * 2); ctx.strokeStyle = GOLD; ctx.lineWidth = Math.max(1.5, 2.5 * q[3]); ctx.stroke(); ctx.globalAlpha = 1;
          }
          poolBall(q[0], q[1], r, b, a * fg);
          if (sel === nd.k) { ctx.beginPath(); ctx.arc(q[0], q[1], r + Math.max(5, 8 * q[3]), 0, Math.PI * 2); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke(); }
          hits.push({ x: q[0], y: q[1], r: Math.max(18, r + 6), match: nd.k });
          var sc2 = scoreText(m);
          labels.push({ x: q[0], y: q[1] + r + 6, text: String(m.n) + (sc2 ? "  " + sc2 : ""), col: sc2 ? GOLD : "#f6efe9", a: a, d: q[2], bold: !!sc2, top: true, small: !sc2, rank: 2 });
        }
      });
      // names and numbers on top: the players' names at the ends and the followed player's first,
      // the matches', the rest - the near ones first; one that would sit on another is left out (zoom in: there's room)
      labels.sort(function (a, b) { return a.rank - b.rank || a.d - b.d; });
      var taken = [];
      labels.forEach(function (lb) {
        var size = lb.small ? 11 : 13;
        ctx.font = (lb.bold ? "800 " : "600 ") + size + "px " + (getComputedStyle(root).fontFamily || "sans-serif");
        var wt = ctx.measureText(lb.text).width, we = lb.extra ? ctx.measureText(lb.extra).width + 5 : 0, w = wt + we + 10, h = size + 6;
        var x = lb.x - w / 2, y = lb.top ? lb.y : lb.y - h;
        if (taken.some(function (t) { return x < t[0] + t[2] && x + w > t[0] && y < t[1] + t[3] && y + h > t[1]; })) return;
        taken.push([x, y, w, h]);
        ctx.globalAlpha = lb.a * 0.82; ctx.fillStyle = "#140707";
        roundRect(x, y, w, h, 6); ctx.fill();
        ctx.globalAlpha = lb.a; ctx.fillStyle = lb.col; ctx.textBaseline = "middle"; ctx.textAlign = "left";
        ctx.fillText(lb.text, x + 5, y + h / 2 + 0.5);
        if (lb.extra) { ctx.fillStyle = lb.extraCol; ctx.fillText(lb.extra, x + 5 + wt + 5, y + h / 2 + 0.5); }
        ctx.globalAlpha = 1;
      });
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }
    function ball(x, y, r, col, a) {
      var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
      g.addColorStop(0, mix(col, "#ffffff", 0.55)); g.addColorStop(0.55, col); g.addColorStop(1, mix(col, "#000000", 0.45));
      ctx.globalAlpha = a; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.stroke(); ctx.globalAlpha = 1;
    }
    function poolBall(x, y, r, b, a) {
      ball(x, y, r, b[2] ? "#f4efe6" : b[1], a);
      ctx.globalAlpha = a;
      if (b[2]) { // (a stripe)
        ctx.save(); ctx.beginPath(); ctx.arc(x, y, r - 0.5, 0, Math.PI * 2); ctx.clip();
        ctx.fillStyle = b[1]; ctx.fillRect(x - r, y - r * 0.48, r * 2, r * 0.96); ctx.restore();
      }
      if (b[0] !== "" && r >= 8) {
        ctx.beginPath(); ctx.arc(x, y, r * 0.5, 0, Math.PI * 2); ctx.fillStyle = "#f8f4ec"; ctx.fill();
        ctx.fillStyle = "#111"; ctx.font = "800 " + Math.round(r * (b[0] > 9 ? 0.6 : 0.72)) + "px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(b[0]), x, y + 0.5);
      }
      ctx.globalAlpha = 1;
    }
    // "2–0", "8–6" - a single rack with no points is just a win: no score
    function scoreText(m) {
      var order = m.sides.map(function (s, i) { return i; });
      if (m.winner !== null) order.sort(function (a, b) { return (b === m.winner) - (a === m.winner); });
      if (m.sides.some(function (s) { return typeof s.points === "number"; })) return order.map(function (i) { return m.sides[i].points; }).join("–");
      if (m.racks && m.racks.length > 1) return order.map(function (i) { return m.sides[i].score; }).join("–");
      return "";
    }

    // ---- a match in words ----
    function namesOf(ids) { return ids.map(function (id) { var p = model.night.players[model.idx[id]]; return p.short || p.name; }).join(" & "); }
    function showInfo(k) {
      sel = k;
      var m = model.night.matches[k];
      use();
      info.innerHTML = "";
      var close = el("button", "", info);
      close.type = "button"; close.textContent = "×"; close.setAttribute("aria-label", T("nightMap.close"));
      close.addEventListener("click", function () { sel = null; info.hidden = true; draw(); });
      el("b", "", info).textContent = T("nightMap.matchNo", { n: m.n }) + " · " + m.game;
      var vs = m.sides.map(function (s) { return namesOf(s.players); });
      el("div", "", info).textContent = vs.length === 2 ? T("nightMap.versus", { a: vs[0], b: vs[1] }) : vs.join(" · ");
      el("div", "", info).textContent = m.winner === null ? T("nightMap.noWinner") : T("nightMap.wonBy", { names: namesOf(m.sides[m.winner].players) });
      var sc = scoreText(m), extra = [];
      if (sc) extra.push(T("nightMap.score", { score: sc }));
      if (m.raceTo) extra.push(T("nightMap.raceTo", { n: m.raceTo }));
      if (m.skunk) extra.push(T("nightMap.skunk"));
      if (typeof m.ballsLeft === "number") extra.push(TP("nightMap.ballsLeft", m.ballsLeft, { n: m.ballsLeft }));
      if (m.stoppedEarly) extra.push(T("nightMap.stoppedEarly"));
      if (m.tournament) extra.push(T("nightMap.tournament"));
      if (extra.length) el("div", "", info).textContent = extra.join(" · ");
      if (m.qScores) {
        var qlist = [];
        m.sides.forEach(function (s) { s.players.forEach(function (id) { if (m.qScores[id]) qlist.push(namesOf([id]) + " " + signed(m.qScores[id].delta)); }); });
        if (qlist.length) el("div", "", info).textContent = T("nightMap.infoQ", { list: qlist.join(" · ") });
      }
      var ch = [];
      if (m.changes) {
        if (m.changes["in"].length) ch.push(T("nightMap.changeIn", { names: namesOf(m.changes["in"]) }));
        if (m.changes.out.length) ch.push(T("nightMap.changeOut", { names: namesOf(m.changes.out) }));
        if (m.changes.partnersSwitched) ch.push(T("nightMap.partnersSwitched"));
      }
      if (ch.length) el("div", "dim", info).textContent = ch.join(" · ");
      el("div", "dim", info).textContent = T("nightMap.endedAt", { time: clockOf(m.endedAt) });
      info.hidden = false;
      draw();
    }

    // ---- the page around the picture ----
    function renderChrome() {
      use();
      view.setAttribute("aria-label", T("nightMap.aria"));
      save.textContent = T("nightMap.savePicture");
      viewBtns["3d"].textContent = T("nightMap.view3d"); viewBtns.side.textContent = T("nightMap.viewSide"); viewBtns.end.textContent = T(shape === "spiral" ? "nightMap.viewTop" : "nightMap.viewEnd");
      shapeBtns.spiral.textContent = T("nightMap.shapeSpiral"); shapeBtns.line.textContent = T("nightMap.shapeLine");
      shapes.setAttribute("role", "group"); shapes.setAttribute("aria-label", T("nightMap.shapeAria"));
      Object.keys(shapeBtns).forEach(function (n) { shapeBtns[n].className = "pmc-nm-btn" + (shape === n ? " pmc-nm-on" : ""); shapeBtns[n].setAttribute("aria-pressed", shape === n ? "true" : "false"); });
      Object.keys(viewBtns).forEach(function (n) { viewBtns[n].className = "pmc-nm-btn" + (cam.name === n ? " pmc-nm-on" : ""); });
      zoomIn.setAttribute("aria-label", T("nightMap.zoomIn")); zoomOut.setAttribute("aria-label", T("nightMap.zoomOut")); reset.setAttribute("aria-label", T("nightMap.reset"));
      hint.textContent = T("nightMap.hint");
      empty.textContent = T("nightMap.empty");
      legend.innerHTML = ""; chips = [];
      if (model) model.night.players.forEach(function (p) {
        var b = el("button", "pmc-nm-chip", legend);
        b.type = "button";
        el("i", "", b).style.background = p.color;
        el("b", "", b).textContent = p.name;
        el("small", "", b).textContent = T("nightMap.chipStats", { played: p.played, won: p.won });
        if (p.qScore) {
          // their Q-Score at the day's end, and what the day did to it
          var q = el("span", "pmc-nm-q", b), ch = p.qScore.change;
          el("em", "", q).textContent = T("nightMap.qScore");
          el("strong", "", q).textContent = p.qScore.end;
          el("span", ch > 0 ? "pmc-nm-up" : ch < 0 ? "pmc-nm-down" : "pmc-nm-flat", q).textContent = (ch > 0 ? "▲ " : ch < 0 ? "▼ " : "") + signed(ch).replace(/^[+−]/, ch ? "" : "±");
          q.title = T("nightMap.qScoreTitle", { rating: p.qScore.end, change: signed(ch) });
        }
        b.addEventListener("click", function () { highlight(hi === p.id ? null : p.id); });
        chips.push({ id: p.id, el: b });
      });
      paintChips();
      key.innerHTML = "";
      [["line", "nightMap.keyTrunk"], ["ball", "nightMap.keyPlay"], ["faint", "nightMap.keyAside"], ["gold", "nightMap.keyGold"], ["q", "nightMap.keyQ"]].forEach(function (k) {
        if (k[0] === "q" && !(model && model.night.players.some(function (p) { return p.qScore; }))) return;
        var s = el("span", "", key);
        el("i", "pmc-nm-k-" + k[0], s);
        s.appendChild(document.createTextNode(T(k[1])));
      });
      el("span", "", key).textContent = T("nightMap.keyTap");
    }
    function paintChips() {
      chips.forEach(function (c) { c.el.className = "pmc-nm-chip" + (hi === c.id ? " pmc-nm-on" : hi !== null ? " pmc-nm-off" : ""); c.el.setAttribute("aria-pressed", hi === c.id ? "true" : "false"); });
    }
    function highlight(id) {
      hi = id && model && model.idx[id] !== undefined ? id : null;
      paintChips();
      draw();
    }
    function size() {
      var w = Math.floor(root.clientWidth);
      if (!w) return false;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      var was = tall;
      tall = w < 620;
      view.classList.toggle("pmc-nm-narrow", tall);
      W = w; H = tall ? Math.round(Math.max(420, Math.min(760, (window.innerHeight || 700) * 0.74))) : Math.round(Math.max(380, Math.min(700, w * 0.6)));
      if (was !== tall && cam.name) { var v = views()[cam.name]; cam.yaw = v[0]; cam.pitch = v[1]; }
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.height = H + "px";
      return true;
    }
    function layout(refit) {
      if (dead) return;
      var has = !!model;
      empty.hidden = has; body.hidden = !has;
      if (!has) return;
      var w = Math.floor(root.clientWidth);
      if (!w) return; // (a folded panel: later)
      var changed = w !== lastW, wasTall = tall;
      lastW = w;
      size();
      if (wasTall !== tall) refit = true;
      if (refit || changed) fit();
      draw();
    }
    function setNight(n) {
      nightNow = n;
      model = n && n.matches && n.matches.length ? build(n, shape) : null;
      hi = null; sel = null; info.hidden = true;
      var v = views()[cam.name || "3d"];
      cam.name = cam.name || "3d"; cam.yaw = v[0]; cam.pitch = v[1];
      renderChrome();
      layout(true);
    }
    // the other shape: the same night, the same player followed
    function setShape(name) {
      name = name === "line" ? "line" : "spiral";
      if (name === shape) return;
      var keep = hi, keepSel = sel;
      shape = name; cam.name = "3d";
      setNight(nightNow);
      if (keep) highlight(keep);
      if (keepSel !== null && model) showInfo(keepSel);
    }

    // ---- turning, moving, zooming, tapping ----
    var ptrs = {}, gesture = null, lastTap = 0;
    function local(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    function onDown(e) {
      if (!model) return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      ptrs[e.pointerId] = local(e);
      var ids = Object.keys(ptrs);
      if (ids.length === 1) gesture = { mode: e.shiftKey || e.button === 2 ? "pan" : "turn", start: ptrs[e.pointerId], last: ptrs[e.pointerId], moved: 0 };
      else if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        gesture = { mode: "pinch", dist: Math.hypot(a[0] - b[0], a[1] - b[1]), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], moved: 99 };
      }
      view.classList.add("pmc-nm-drag");
    }
    function onMove(e) {
      if (!gesture || !ptrs[e.pointerId]) return;
      var p = local(e);
      ptrs[e.pointerId] = p;
      if (gesture.mode === "pinch") {
        var ids = Object.keys(ptrs);
        if (ids.length < 2) return;
        var a = ptrs[ids[0]], b = ptrs[ids[1]], dist = Math.hypot(a[0] - b[0], a[1] - b[1]), mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        cam.panX += mid[0] - gesture.mid[0]; cam.panY += mid[1] - gesture.mid[1];
        if (gesture.dist > 0) zoomBy(dist / gesture.dist, mid[0], mid[1]); else draw();
        gesture.dist = dist; gesture.mid = mid;
        return;
      }
      var dx = p[0] - gesture.last[0], dy = p[1] - gesture.last[1];
      gesture.moved += Math.abs(dx) + Math.abs(dy);
      gesture.last = p;
      if (gesture.moved < 5) return;
      if (gesture.mode === "pan") { cam.panX += dx; cam.panY += dy; }
      else {
        cam.yaw -= dx * 0.008; // (the near side goes with the finger)
        cam.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, cam.pitch + dy * 0.008));
        if (cam.name) { cam.name = ""; renderViewButtons(); }
      }
      draw();
    }
    function renderViewButtons() { Object.keys(viewBtns).forEach(function (n) { viewBtns[n].className = "pmc-nm-btn" + (cam.name === n ? " pmc-nm-on" : ""); }); }
    function onUp(e) {
      var p = ptrs[e.pointerId];
      delete ptrs[e.pointerId];
      if (!gesture) return;
      var tap = gesture.mode !== "pinch" && gesture.moved < 5 && p;
      if (!Object.keys(ptrs).length) { gesture = null; view.classList.remove("pmc-nm-drag"); }
      else if (gesture.mode === "pinch") { var id = Object.keys(ptrs)[0]; gesture = { mode: "turn", start: ptrs[id], last: ptrs[id], moved: 99 }; }
      if (!tap) return;
      var now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; setView("3d"); return; } // (double-tap: back as it was)
      lastTap = now;
      // the nearest thing under the finger: a ball first, then a player
      var best = null;
      hits.forEach(function (h) {
        var d = Math.hypot(h.x - p[0], h.y - p[1]);
        if (d <= h.r && (!best || d < best.d)) best = { d: d, h: h };
      });
      if (!best) return;
      if (best.h.match !== undefined) showInfo(best.h.match);
      else highlight(hi === best.h.player ? null : best.h.player);
    }
    function onWheel(e) {
      if (!model || !(e.ctrlKey || e.metaKey)) return; // (a plain wheel scrolls the page)
      e.preventDefault();
      var p = local(e);
      zoomBy(Math.exp(-e.deltaY * 0.01), p[0], p[1]);
    }
    function onKey(e) {
      var done = true;
      if (e.key === "+" || e.key === "=") zoomBy(1.3);
      else if (e.key === "-") zoomBy(1 / 1.3);
      else if (e.key === "ArrowLeft") { cam.yaw += 0.12; cam.name = ""; renderViewButtons(); draw(); }
      else if (e.key === "ArrowRight") { cam.yaw -= 0.12; cam.name = ""; renderViewButtons(); draw(); }
      else if (e.key === "ArrowUp") { cam.pitch = Math.min(Math.PI / 2 - 0.001, cam.pitch + 0.12); cam.name = ""; renderViewButtons(); draw(); }
      else if (e.key === "ArrowDown") { cam.pitch = Math.max(-Math.PI / 2 + 0.001, cam.pitch - 0.12); cam.name = ""; renderViewButtons(); draw(); }
      else if (e.key === "0") setView("3d");
      else done = false;
      if (done) e.preventDefault();
    }
    function noMenu(e) { e.preventDefault(); }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", noMenu);
    view.addEventListener("keydown", onKey);
    save.addEventListener("click", function () {
      if (opts.onSavePicture) { opts.onSavePicture(); return; }
      var a = document.createElement("a");
      a.href = pictureDataUrl(); a.download = "night-map.png";
      document.body.appendChild(a); a.click(); a.remove();
    });

    // the picture: what's on show, with the day over it
    function pictureDataUrl() {
      if (!model || !W) return "";
      draw();
      var out = document.createElement("canvas"), head = 54;
      out.width = canvas.width; out.height = canvas.height + Math.round(head * dpr);
      var c = out.getContext("2d");
      c.fillStyle = "#140707"; c.fillRect(0, 0, out.width, out.height);
      c.drawImage(canvas, 0, Math.round(head * dpr));
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = "#f6efe9"; c.font = "800 22px " + (getComputedStyle(root).fontFamily || "sans-serif"); c.textBaseline = "middle";
      c.fillText(model.night.title || model.night.day || "", 16, head / 2 + 2);
      c.fillStyle = "#c9a2a2"; c.font = "600 13px " + (getComputedStyle(root).fontFamily || "sans-serif"); c.textAlign = "right";
      c.fillText("Pool Master Counter", W - 16, head / 2 + 2);
      return out.toDataURL("image/png");
    }

    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(function () { if (Math.floor(root.clientWidth) !== lastW) layout(false); });
      ro.observe(root);
    }
    setNight(night);

    return {
      setNight: setNight,
      refresh: function () { renderChrome(); layout(false); },
      destroy: function () {
        dead = true;
        if (ro) ro.disconnect();
        canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
        canvas.removeEventListener("wheel", onWheel); canvas.removeEventListener("contextmenu", noMenu);
        view.removeEventListener("keydown", onKey);
        root.innerHTML = ""; root.classList.remove("pmc-nm");
      },
      highlight: highlight,
      view: setView,
      shape: setShape,
      spots: function () { return hits.map(function (h) { return { x: h.x, y: h.y, match: h.match, player: h.player }; }); }, // (what can be tapped, in the box - tests)
      pictureDataUrl: pictureDataUrl,
      state: function () {
        return { matches: model ? model.night.matches.length : 0, players: model ? model.night.players.length : 0, nodes: model ? model.nodes.length : 0, highlight: hi, selected: sel, shape: shape, view: cam.name, yaw: cam.yaw, pitch: cam.pitch, zoom: cam.zoom, width: W };
      }
    };
  }

  window.PMCNightMap = { mount: mount };
})();
