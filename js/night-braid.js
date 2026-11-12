// 🧊 The night in 3D, as one picture: "the night as a braid". Every player is
// a ribbon, every match a raised block, time runs left to right. On a block
// a ribbon is thick and carries the name: playing. On the floor it is a thin
// line: sitting out, on the bench of the side it left. The winners stand on
// a gold step and their ribbons carry straight on to the next block; the
// losers slide off, the next ones ramp up; partners who switch cross over.
// The ball on the felt is the game, the plate on the front the match's
// number and its score (winner first) - a single rack is just a win, a tick.
// Under a block: when it ended, or start–end when the start was timed.
// The layout is solved, not drawn as it comes: a beam search picks, match by
// match, which side stands near and in which order partners stand, and gives
// every sit on the bench a lane, so the ribbons cross as little as they can.
// Drawn on a canvas in an oblique projection, far to near, so ribbons weave
// over and under each other; the picture keeps its own dark palette on every
// theme (a framed picture), the chips, key and match list around it follow
// the app's. Tap a player (chip or name tag): the others turn grey. Tap or
// hover a block: its details. A plain match list underneath says it in text.
//
// The night comes from js/lib/night-timeline.js (PMCLib.nightTimeline.build).
// PMCNightBraid.mount(root, night, { t(key, vars), tp(key, n, vars),
//   clock(localIso), onSavePicture() }) -> { setNight(night), refresh(), destroy(),
//   highlight(playerId | null), pictureDataUrl(), pictureSize(), state() }
//   - root: an element as wide as the panel; nothing is drawn while it has
//     no width (a closed panel) - refresh(), or the width coming, draws it.
//   - refresh(): the language or the theme changed, or the panel just opened.
//   - pictureDataUrl(): the poster as a PNG data URL, drawn on the spot and
//     synchronously (a share sheet opens only from inside the tap);
//     pictureSize() its { width, height }. The 🖼️ button calls
//     onSavePicture() when given, else downloads the picture itself.
//   - state(): { matches, players, rows, highlight, width, drawMs } (tests).
// Words: every one through T / TP (keys nightBraid.*) - the app's t / tp when given,
// else the English below (the same keys as languages/english.json).
(function () {
  "use strict";

  var STR = {
    "nightBraid.empty": "No games that day.",
    "nightBraid.savePicture": "🖼️ Save as picture",
    "nightBraid.legendLabel": "Players. Tap one to follow their ribbon.",
    "nightBraid.chipStats": "{{played}} played · {{won}} won",
    "nightBraid.swipeHint": "Swipe sideways to follow the night →",
    "nightBraid.pictureLabel": "The night as a braid, {{title}}: every player a ribbon, every match a block. The match list below says the same in words.",
    "nightBraid.keyPlaying": "On a block: playing",
    "nightBraid.keyBench": "On the floor: sitting out",
    "nightBraid.keyGold": "Gold side: the winners",
    "nightBraid.keyBall": "The ball shows the game",
    "nightBraid.keyHint": "Tap a player to follow one ribbon, tap a block for the match.",
    "nightBraid.matchList": "Match list",
    "nightBraid.colTime": "Time",
    "nightBraid.colGame": "Game",
    "nightBraid.colPlayers": "Players",
    "nightBraid.colScore": "Score",
    "nightBraid.versus": "{{a}} v {{b}}",
    "nightBraid.eyebrow": "THE NIGHT AS A BRAID",
    "nightBraid.matchCount": "{{n}} matches",
    "nightBraid.matchCountOne": "{{n}} match",
    "nightBraid.playerCount": "{{n}} players",
    "nightBraid.playerCountOne": "{{n}} player",
    "nightBraid.rowMatches": "Matches {{from}}–{{to}}",
    "nightBraid.matchNo": "Match {{n}}",
    "nightBraid.raceTo": "Race to {{n}}",
    "nightBraid.tournament": "Tournament",
    "nightBraid.freeForAll": "Everyone for themselves",
    "nightBraid.endedAt": "Ended {{time}}",
    "nightBraid.minutes": "{{n}} min",
    "nightBraid.won": "WON",
    "nightBraid.noWinner": "No winner",
    "nightBraid.stoppedEarly": "Stopped early",
    "nightBraid.skunk": "🦨 Skunk",
    "nightBraid.ballsLeft": "{{n}} balls left",
    "nightBraid.ballsLeftOne": "{{n}} ball left",
    "nightBraid.changeIn": "In: {{names}}",
    "nightBraid.changeOut": "Out: {{names}}",
    "nightBraid.partnersSwitched": "Partners switched",
    "nightBraid.samePlayers": "Same players again",
    "nightBraid.rack": "Rack {{n}}"
  };
  // the mount whose words are being read (every way in sets it; nothing here waits)
  var words = null;
  function T(key, vars) {
    if (words && words.t) return String(words.t(key, vars));
    return String(STR[key] || key).replace(/\{\{(\w+)\}\}/g, function (all, k) { return vars && vars[k] != null ? vars[k] : all; });
  }
  // (a count's sentence - "1 match" / "3 matches": the app's own, when it gives one)
  function TP(key, n, vars) {
    if (words && words.tp) return String(words.tp(key, n, vars));
    return T(n === 1 ? key + "One" : key, vars);
  }

  // The picture's own palette: a framed picture, the same on every theme of the app.
  var THEME = { bg: "#1a0a0a", panel: "#241010", gold: "#e8b923", text: "#f6efe9", dim: "#c9a2a2", border: "#4a1e1e", ink: "#1a0a0a" };
  // (a player's colour comes with the night - these only for one that has none)
  var PALETTE = ["#5aa9ff", "#ff8f45", "#45e0b5", "#f0549f", "#d9c9ff", "#5b9a68", "#9466d8", "#d3571d", "#adee72", "#159cb7", "#8cb57e", "#c8a2cb"];
  var FONT = "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif";

  // World geometry (units = px at scale 1). x = time, y = depth (near < 0 < far), z = height.
  var G = {
    CX: 0.25, CY: 0.66,      // oblique projection: screenX = x + y*CX, screenY = -(y*CY + z)
    WP: 24, RW: 21,         // slot pitch / ribbon width while playing
    GAPIN: 3, PAD: 7,       // between partners / around a side
    GAPFFA: 10,             // between players who each play for themselves
    FELT: 28,               // green strip between the two sides
    MN: 30, MF: 44,         // clear floor between block and near / far bench
    PITCH: 23, RB: 7,       // bench lane pitch / bench thread width
    HB: 18, POD: 9,         // block height / extra height of the winners' podium
    BL: 60, GAP: 48, LO: 30, // block length, gap between blocks, lead-out after the last block
    STUB: 14, STAG: 9, BEAM: 24, W_SHIFT: 0.06, W_UNDER: 2.2
  };
  var TAG_MAX = 100; // the widest name tag where a row starts (a name and its Q-Score)

  // ---------- small helpers ----------
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function ease(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
  function lerp(a, b, u) { return a + (b - a) * u; }
  function hex2rgb(h) { h = h.replace("#", ""); return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)]; }
  function mix(h1, h2, u) {
    var a = hex2rgb(h1), b = hex2rgb(h2);
    return "rgb(" + Math.round(lerp(a[0], b[0], u)) + "," + Math.round(lerp(a[1], b[1], u)) + "," + Math.round(lerp(a[2], b[2], u)) + ")";
  }
  // (the app's own clock - "2:19 PM" - when it gives one: opts.clock)
  function hhmm(iso) {
    if (iso && words && typeof words.clock === "function") {
      try { var own = words.clock(iso); if (own) return own; } catch (e) {}
    }
    var m = /T(\d\d):(\d\d)/.exec(iso || "");
    return m ? (m[1] + ":" + m[2]) : "";
  }
  function minutesBetween(a, b) {
    var x = Date.parse(a), y = Date.parse(b);
    if (isNaN(x) || isNaN(y)) return null;
    return Math.round((y - x) / 60000);
  }
  function halfDepth(n, gap) { return G.PAD * 2 + n * G.WP + (n - 1) * gap; }

  // ---------- 1. the night, as the drawing needs it ----------
  // The plate's score, winner first: the points when the game has them, else the racks won.
  // A single rack with no points is just a win - the gold side says it, the plate stays quiet.
  function plateOf(sides, w) {
    var pts = sides.some(function (s) { return s.points !== null; }), total = 0, vals = [];
    sides.forEach(function (s, k) {
      if (!s.idx.length) return;
      total += s.score || 0;
      vals.push({ k: k, v: pts ? (s.points !== null ? s.points : 0) : (s.score || 0) });
    });
    if (vals.length < 2 || (!pts && total <= 1)) return null;
    vals.sort(function (a, b) { return (a.k === w ? -1 : 0) - (b.k === w ? -1 : 0) || b.v - a.v || a.k - b.k; });
    return vals.map(function (x) { return String(x.v); });
  }

  // A block has two halves. Two sides: one each. Three or more (each for himself): the winner
  // on one half, everyone else on the other, in lanes of their own with felt between them.
  function prepare(night) {
    var players = [], byId = {};
    function add(id, src) {
      if (byId.hasOwnProperty(id)) return byId[id];
      src = src || {};
      var i = players.length, c = /^#[0-9a-f]{6}$/i.test(src.color || "") ? src.color : PALETTE[i % PALETTE.length];
      var name = src.name || String(id);
      players.push({ id: id, name: name, short: src.short || name, index: i, color: c, benchColor: mix(c, THEME.panel, 0.36), ghost: mix(c, "#2a1414", 0.82), edge: mix(c, "#000000", 0.45),
        played: src.played || 0, won: src.won || 0, fitted: {},
        rating: typeof src.rating === "number" ? src.rating : null, ratingBefore: typeof src.ratingBefore === "number" ? src.ratingBefore : null });
      byId[id] = i;
      return i;
    }
    (night.players || []).forEach(function (p) { if (p && p.id != null) add(p.id, p); });
    var maxHalf = halfDepth(1, G.GAPIN);
    var matches = (night.matches || []).map(function (m, i) {
      var seen = {}, raw = (m.sides || []).slice();
      while (raw.length < 2) raw.push({ players: [] });
      var sides = raw.map(function (s) {
        var idx = [];
        ((s && s.players) || []).forEach(function (id) { var pi = add(id); if (!seen[pi]) { seen[pi] = 1; idx.push(pi); } });
        return { idx: idx, score: s && typeof s.score === "number" ? s.score : null, points: s && typeof s.points === "number" ? s.points : null };
      });
      var w = typeof m.winner === "number" && sides[m.winner] ? m.winner : -1, front = w >= 0 ? w : 0, rest = [], others = 0;
      sides.forEach(function (s, k) { if (k !== front && s.idx.length) { rest = rest.concat(s.idx); others++; } });
      var halves = [{ idx: sides[front].idx, gap: G.GAPIN }, { idx: rest, gap: others > 1 ? G.GAPFFA : G.GAPIN }];
      halves.forEach(function (h) { maxHalf = Math.max(maxHalf, halfDepth(Math.max(1, h.idx.length), h.gap)); });
      // (a start that is only "the match before's end" is not a start: the end is what is known)
      var known = !!m.startedAt && !m.startEstimated;
      return {
        n: m.n != null ? m.n : (i + 1), src: m, sides: sides, halves: halves, winner: w, winHalf: w >= 0 ? 0 : -1, ratings: m.ratings || {},
        game: m.game || "", gameType: m.gameType || "", start: known ? hhmm(m.startedAt) : "", end: hhmm(m.endedAt),
        mins: known ? minutesBetween(m.startedAt, m.endedAt) : null, plate: plateOf(sides, w)
      };
    });
    var P = players.length, M = matches.length, side = [], next = [], n, p;
    for (n = 0; n < M; n++) {
      side[n] = [];
      for (p = 0; p < P; p++) side[n][p] = -1;
      matches[n].halves.forEach(function (h, k) { h.idx.forEach(function (pi) { side[n][pi] = k; }); });
    }
    for (n = M - 1; n >= 0; n--) {
      next[n] = [];
      for (p = 0; p < P; p++) next[n][p] = (n + 1 < M) ? (side[n + 1][p] >= 0 ? n + 1 : next[n + 1][p]) : 1e9;
    }
    return { title: night.title || night.day || "", day: night.day || "", players: players, byId: byId, matches: matches, side: side, next: next, maxHalf: maxHalf };
  }

  // ---------- 2. lane solver (beam search over orientation + partner order) ----------
  // Decides, for every match, which side stands on the near half and in which order partners stand,
  // and gives every bench stint a fixed lane, so that threads cross as little as possible.
  // rows[t][p] = depth (world y) of player p; t = 0 is "before the first match", t = n + 1 is match n.
  function solve(model) {
    var P = model.players.length, M = model.matches.length, side = model.side, next = model.next;
    var F2 = G.FELT / 2, maxHalf = model.maxHalf;
    var B0N = F2 + maxHalf + G.MN + G.PITCH / 2, B0F = F2 + maxHalf + G.MF + G.PITCH / 2;
    var benchMin = F2 + maxHalf + 1;
    function slotY(sign, j, gap) { return sign * (F2 + G.PAD + G.WP / 2 + j * (G.WP + gap)); }
    function laneY(sign, L) { return sign < 0 ? -(B0N + L * G.PITCH) : (B0F + L * G.PITCH); }
    function isBench(y) { return Math.abs(y) > benchMin; }
    function laneOf(y) { return Math.round((Math.abs(y) - (y < 0 ? B0N : B0F)) / G.PITCH); }
    function perms(a) {
      if (a.length <= 1) return [a.slice()];
      var out = [], i;
      for (i = 0; i < a.length; i++) {
        var rest = a.slice(0, i).concat(a.slice(i + 1));
        perms(rest).forEach(function (r) { out.push([a[i]].concat(r)); });
      }
      return out;
    }
    // (five or more on one half: not every order, it would take seconds)
    function orders(a) { return a.length > 4 ? [a.slice(), a.slice().reverse()] : perms(a); }
    // weights: 1 bench, 2 stays on the table, 3 enters, 4 leaves
    function wPair(a, b) {
      if (a === 1 || b === 1) return 0.7;
      if (a === 2 && b === 2) return 1.5;
      if (a === 2 || b === 2) return G.W_UNDER;
      if (a !== b) return 1.2;
      return 1;
    }
    var W_SHIFT = G.W_SHIFT;

    function evaluate(beam, n, o, lists) {
      var rowsB = beam.rows, t = n + 1, prev = rowsB[t - 1], halves = model.matches[n].halves;
      var row = [], type = [], pe = prev.slice(), retro = [], leavers = [], cost = 0, maxL = beam.maxL;
      var p, q, k, j, L, y, s, best, bestS, tt, a, c, e, rq, inner, free, i;
      for (p = 0; p < P; p++) { row[p] = NaN; type[p] = 0; }
      for (k = 0; k < 2; k++) {
        var sign = (k === o) ? -1 : 1;
        for (j = 0; j < lists[k].length; j++) {
          p = lists[k][j];
          row[p] = slotY(sign, j, halves[k].gap);
          type[p] = isNaN(prev[p]) ? 5 : (isBench(prev[p]) ? 3 : 2);
        }
      }
      for (p = 0; p < P; p++) {
        if (side[n][p] >= 0 || isNaN(prev[p])) continue;
        if (isBench(prev[p])) { row[p] = prev[p]; type[p] = 1; } else { type[p] = 4; leavers.push(p); }
      }
      // first appearance: give the player a bench lane for the time before, on the side he enters from
      for (p = 0; p < P; p++) {
        if (type[p] !== 5) continue;
        var sg = row[p] < 0 ? -1 : 1;
        best = -1; bestS = 1e9;
        for (L = 0; L <= maxL + 2; L++) {
          y = laneY(sg, L); free = true;
          for (i = 0; i < retro.length && free; i++) if (retro[i][1] === y) free = false;
          for (tt = 0; tt < t && free; tt++) for (q = 0; q < P; q++) if (rowsB[tt][q] === y) { free = false; break; }
          if (!free) continue;
          s = 0.05 * L;
          for (tt = 1; tt < t; tt++) for (q = 0; q < P; q++) {
            a = rowsB[tt - 1][q]; c = rowsB[tt][q];
            if (a === c || isNaN(a) || isNaN(c)) continue;
            if ((a - y) * (c - y) < 0) s += 0.7;
          }
          for (q = 0; q < P; q++) {
            if (type[q] === 1 && (row[q] < 0) === (y < 0) && Math.abs(row[q]) < Math.abs(y)) s += 0.7;
          }
          for (i = 0; i < retro.length; i++) {
            q = retro[i][0];
            if ((retro[i][1] - y) * (row[q] - row[p]) < 0) s += 1;
          }
          if (s < bestS) { bestS = s; best = L; }
        }
        y = laneY(sg, best);
        pe[p] = y; retro.push([p, y]); type[p] = 3;
        if (best > maxL) maxL = best;
      }
      // leavers sit down on the bench of the side they played on
      leavers.sort(function (u, v) { return (next[n][u] - next[n][v]) || (Math.abs(prev[u]) - Math.abs(prev[v])); });
      for (i = 0; i < leavers.length; i++) {
        p = leavers[i]; e = next[n][p];
        var sg2 = prev[p] < 0 ? -1 : 1;
        best = -1; bestS = 1e9;
        for (L = 0; L <= maxL + 2; L++) {
          y = laneY(sg2, L); free = true;
          for (q = 0; q < P; q++) if (row[q] === y) { free = false; break; }
          if (!free) continue;
          s = 0.03 * L;
          for (q = 0; q < P; q++) {
            if (q === p || isNaN(row[q]) || !isBench(row[q]) || (row[q] < 0) !== (y < 0)) continue;
            inner = Math.abs(row[q]) < Math.abs(y); rq = next[n][q];
            if (type[q] === 1) {
              if (inner) s += 0.7 + (rq > e ? 0.7 : 0); else s += (rq < e ? 0.7 : 0);
            } else if (type[q] === 4) {
              if ((prev[q] - prev[p]) * (row[q] - y) < 0) s += 1;
              if (inner) s += (rq > e ? 0.7 : 0); else s += (rq < e ? 0.7 : 0);
            }
          }
          if (s < bestS) { bestS = s; best = L; }
        }
        row[p] = laneY(sg2, best);
        if (best > maxL) maxL = best;
      }
      // crossings between t-1 and t, and sideways travel of those who stay on the table
      for (p = 0; p < P; p++) {
        if (isNaN(row[p]) || isNaN(pe[p])) continue;
        if (type[p] === 2) cost += W_SHIFT * Math.abs(row[p] - pe[p]);
        for (q = p + 1; q < P; q++) {
          if (isNaN(row[q]) || isNaN(pe[q])) continue;
          if ((pe[p] - pe[q]) * (row[p] - row[q]) < 0) cost += wPair(type[p], type[q]);
        }
      }
      return { cost: beam.cost + cost, row: row, retro: retro, maxL: maxL, beam: beam };
    }

    var BEAM = M > 30 ? Math.min(G.BEAM, 12) : G.BEAM;
    var nanRow = [], p0;
    for (p0 = 0; p0 < P; p0++) nanRow.push(NaN);
    var beams = [{ rows: [nanRow], cost: 0, maxL: 0 }];
    for (var n = 0; n < M; n++) {
      var m = model.matches[n], pa = orders(m.halves[0].idx), pb = orders(m.halves[1].idx), cands = [];
      for (var bi = 0; bi < beams.length; bi++) {
        for (var o = 0; o < (n === 0 ? 1 : 2); o++) {
          for (var ia = 0; ia < pa.length; ia++) for (var ib = 0; ib < pb.length; ib++) {
            cands.push(evaluate(beams[bi], n, o, [pa[ia], pb[ib]]));
          }
        }
      }
      cands.sort(function (u, v) { return u.cost - v.cost; });
      var nb = [], seen = {};
      for (var ci = 0; ci < cands.length && nb.length < BEAM; ci++) {
        var ev = cands[ci], key = ev.row.join(",");
        if (seen[key]) continue;
        seen[key] = 1;
        var rows = ev.beam.rows.slice();
        if (ev.retro.length) {
          for (var tt = 0; tt < rows.length; tt++) {
            var r = rows[tt].slice();
            for (var ri = 0; ri < ev.retro.length; ri++) r[ev.retro[ri][0]] = ev.retro[ri][1];
            rows[tt] = r;
          }
        }
        rows.push(ev.row);
        nb.push({ rows: rows, cost: ev.cost, maxL: ev.maxL });
      }
      beams = nb;
    }
    var bestBeam = beams[0], rowsF = bestBeam.rows, t, p, L;
    // players on the list who never played: park them on the outer far bench
    for (p = 0; p < P; p++) {
      if (!isNaN(rowsF[rowsF.length - 1][p])) continue;
      for (L = 0; ; L++) {
        var yy = laneY(1, L), ok = true;
        for (t = 0; t < rowsF.length && ok; t++) for (var q2 = 0; q2 < P; q2++) if (rowsF[t][q2] === yy) { ok = false; break; }
        if (ok) break;
      }
      for (t = 0; t < rowsF.length; t++) { if (t === 0 || rowsF[t] !== rowsF[t - 1]) rowsF[t] = rowsF[t].slice(); rowsF[t][p] = laneY(1, L); }
    }
    var nearL = 0, farL = 0;
    for (t = 0; t < rowsF.length; t++) for (p = 0; p < P; p++) {
      var yv = rowsF[t][p];
      if (isBench(yv)) { if (yv < 0) nearL = Math.max(nearL, laneOf(yv) + 1); else farL = Math.max(farL, laneOf(yv) + 1); }
    }
    return { rows: rowsF, cost: bestBeam.cost, nearL: nearL, farL: farL, maxHalf: maxHalf, B0N: B0N, B0F: B0F, laneY: laneY, isBench: isBench };
  }

  // ---------- 3. scene: rows, scale, strands ----------
  var measureCtx = null;
  function textW(str, font) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = font;
    return measureCtx.measureText(str).width;
  }
  function fit(str, font, maxW) {
    if (textW(str, font) <= maxW) return str;
    var s = str;
    while (s.length > 1 && textW(s + "…", font) > maxW) s = s.substr(0, s.length - 1);
    return s + "…";
  }
  // A name with its Q-Score beside it, and + / − for a match won or lost ("Luc 424 +"): the name is
  // what's cut when there's no room. The score: just after match n; before the night when n < 0.
  function scoreTag(model, p, n, sign) {
    var pl = model.players[p], q = pl.ratingBefore, m = n >= 0 ? model.matches[n] : null;
    for (var k = n; k >= 0; k--) {
      if (model.side[k][p] >= 0 && typeof model.matches[k].ratings[pl.id] === "number") { q = model.matches[k].ratings[pl.id]; break; }
    }
    var tag = q === null ? "" : " " + q;
    if (sign && m && m.winHalf >= 0 && model.side[n][p] >= 0) tag += model.side[n][p] === m.winHalf ? " +" : " −";
    return tag;
  }
  function fitTag(name, tag, font, maxW) {
    return tag ? fit(name, font, maxW - textW(tag, font)) + tag : fit(name, font, maxW);
  }

  function buildScene(model, sol, availW, opts) {
    opts = opts || {};
    var M = model.matches.length, P = model.players.length, F2 = G.FELT / 2;
    var mx = 10, tagFont = "700 11px " + FONT, tagW = 0, p;
    for (p = 0; p < P; p++) tagW = Math.max(tagW, textW(model.players[p].short + scoreTag(model, p, -1, false), tagFont));
    tagW = Math.min(tagW, TAG_MAX) + 14;
    var yN = -(sol.nearL ? sol.B0N + (sol.nearL - 1) * G.PITCH + G.PITCH / 2 + 7 : F2 + sol.maxHalf + G.MN);
    var yF = (sol.farL ? sol.B0F + (sol.farL - 1) * G.PITCH + G.PITCH / 2 + 7 : F2 + sol.maxHalf + G.MF);
    var depth = yF - yN, step = G.BL + G.GAP;
    function rowWorldW(k) { return G.STUB + G.GAP + k * step - G.GAP + G.LO; }
    var minScale = 0.94, maxScale = 1.3;
    var perRow;
    if (opts.perRow) perRow = opts.perRow;
    else if (availW < 720) { perRow = Math.min(Math.max(M, 1), 24); opts = { perRow: perRow }; }
    else {
      var room = (availW - 2 * mx - tagW - 8) / minScale - depth * G.CX - G.LO - G.STUB;
      perRow = clamp(Math.floor(room / step), 4, Math.max(4, M));
    }
    var nRows = Math.max(1, Math.ceil(M / perRow));
    if (!opts.perRow) perRow = Math.max(1, Math.ceil(M / nRows));
    var s = (availW - 2 * mx - tagW - 8) / (rowWorldW(Math.min(perRow, Math.max(M, 1))) + depth * G.CX);
    s = clamp(s, minScale, maxScale);
    if (availW < 720) s = 1.08; // narrow screen: one line, swipe sideways
    var fs = clamp(s, 1, 1.2);
    var topExt = Math.max(yF * G.CY, (F2 + sol.maxHalf) * G.CY + G.HB + G.POD + 20) * s + 22;
    var botExt = -yN * G.CY * s + 12;
    var rowH = topExt + botExt, rowGap = 12;
    var width = Math.ceil(2 * mx + tagW + 8 + (rowWorldW(Math.min(perRow, Math.max(M, 1))) + depth * G.CX) * s);
    var height = Math.ceil(nRows * rowH + (nRows - 1) * rowGap + 8);
    var rows = [], r;
    for (r = 0; r < nRows; r++) {
      var a = r * perRow, b = Math.min(M, a + perRow) - 1;
      rows.push({ index: r, a: a, b: b, ox: mx + tagW + 8, oy: 4 + r * (rowH + rowGap) + topExt, xL: -(tagW + 8) / s, xR: rowWorldW(b - a + 1), last: r === nRows - 1 });
    }
    var scene = { model: model, sol: sol, s: s, fs: fs, rows: rows, width: width, height: height, yN: yN, yF: yF, perRow: perRow, tagW: tagW, hits: [], tagHits: [] };
    for (r = 0; r < nRows; r++) buildRow(scene, rows[r]);
    return scene;
  }

  function stateAt(scene, t, p) {
    var y = scene.sol.rows[t][p];
    if (t === 0) return { y: y, z: 0, w: G.RB, play: false };
    var n = t - 1, k = scene.model.side[n][p];
    if (k < 0) return { y: y, z: 0, w: G.RB, play: false };
    return { y: y, z: G.HB + (scene.model.matches[n].winHalf === k ? G.POD : 0), w: G.RW, play: true };
  }

  var TID = 0;
  function buildRow(scene, R) {
    var model = scene.model, P = model.players.length, s = scene.s, yN = scene.yN, F2 = G.FELT / 2;
    var step = G.BL + G.GAP;
    R.X = function (x, y) { return R.ox + (x + (y - yN) * G.CX) * s; };
    R.Y = function (y, z) { return R.oy - (y * G.CY + z) * s; };
    R.x0 = function (n) { return G.STUB + G.GAP + (n - R.a) * step; };
    R.blocks = []; R.quads = []; R.labels = []; R.tags = []; R.benchTags = [];
    var n, p, k, j;
    for (n = R.a; n <= R.b; n++) {
      var m = model.matches[n], nearSide = 0;
      for (k = 0; k < 2; k++) if (m.halves[k].idx.length && scene.sol.rows[n + 1][m.halves[k].idx[0]] < 0) nearSide = k;
      var hvN = m.halves[nearSide], hvF = m.halves[1 - nearSide], lanes = [];
      var hN = halfDepth(Math.max(1, hvN.idx.length), hvN.gap), hF = halfDepth(Math.max(1, hvF.idx.length), hvF.gap);
      // each for himself: a strip of felt between two lanes of the same half
      for (k = 0; k < 2; k++) {
        var hv = k ? hvF : hvN;
        if (hv.gap !== G.GAPFFA) continue;
        for (j = 0; j + 1 < hv.idx.length; j++) lanes.push((k ? 1 : -1) * (F2 + G.PAD + G.WP + j * (G.WP + hv.gap) + hv.gap / 2));
      }
      R.blocks.push({ n: n, m: m, x0: R.x0(n), x1: R.x0(n) + G.BL, yA: -(F2 + hN), yB: F2 + hF, nearSide: nearSide, nearWins: m.winHalf === nearSide, farWins: m.winHalf === 1 - nearSide, lanes: lanes });
    }
    // Partners who walk the same way in the same gap would overlap under the shear (their offset in depth
    // points along the direction of travel), so they are staggered in time like nested lanes in a bend.
    var phase = {}, span = {};
    for (n = R.a; n <= R.b; n++) {
      var groups = {};
      for (p = 0; p < P; p++) {
        var a0 = stateAt(scene, n, p), b0 = stateAt(scene, n + 1, p);
        if (a0.y === b0.y || (a0.play && b0.play)) continue;
        var gk = (a0.play ? "L" : "E") + (b0.y > a0.y ? "+" : "-") + (a0.y + b0.y < 0 ? "n" : "f");
        (groups[gk] = groups[gk] || []).push({ p: p, y: a0.y + b0.y, up: b0.y > a0.y });
      }
      for (var gname in groups) {
        var gl = groups[gname];
        gl.sort(function (u, v) { return gl[0].up ? v.y - u.y : u.y - v.y; });
        for (k = 0; k < gl.length; k++) { phase[n + ":" + gl[k].p] = k * G.STAG; span[n + ":" + gl[k].p] = (gl.length - 1) * G.STAG; }
      }
    }
    for (p = 0; p < P; p++) {
      var xc = 0, A = stateAt(scene, R.a, p);
      R.tags.push({ p: p, y: A.y, z: A.z, play: A.play });
      for (n = R.a; n <= R.b; n++) {
        var B = stateAt(scene, n + 1, p), xg1 = R.x0(n), xg0 = xg1 - G.GAP;
        if (!A.play && !B.play && A.y === B.y) {
          // nothing changes: keep holding
        } else {
          var kind = A.play ? (B.play ? "S" : "L") : "E";
          var ta = xg0, tb = xg1, dy = Math.abs(B.y - A.y), ext = 0;
          // long walks to/from the near bench would look "backwards" under the shear: give them more room
          if (dy / G.GAP > 2.2 && (kind === "L" ? B.y < 0 : (kind === "E" && A.y < 0))) {
            ext = Math.min(G.BL * 0.8, dy / 2.2 - G.GAP);
            if (kind === "L") tb += ext; else if (n > R.a) ta -= ext;
          }
          if (ta > xc) hold(R, p, A, xc, ta, n - 1);
          else ta = Math.max(ta, xc);
          transition(R, p, A, B, ta, tb, kind, xg0, xg1, phase[n + ":" + p] || 0, span[n + ":" + p] || 0);
          xc = tb;
        }
        A = B;
        // the stretch on / beside block n is emitted by the next hold; remember where the block is for the label
        if (B.play) R.labels.push({ p: p, x: xg1 + G.BL / 2, y: B.y, z: B.z, n: n });
      }
      var xe = R.x0(R.b) + G.BL + G.LO - 12;
      hold(R, p, A, xc, xe, R.b);
      // tapered end: "continues" on the next row, or the end of the night
      if (!R.last) R.quads.push({ p: p, i: 0, tid: ++TID, L: [pt3(R, xe, A.y + A.w / 2, A.z), pt3(R, xe + 9, A.y, A.z)], R: [pt3(R, xe, A.y - A.w / 2, A.z), pt3(R, xe + 9, A.y, A.z)],
        floor: A.z < 0.6, key: zkey(A.z, A.y), m: A.play ? 1 : 0, sh: null });
    }
    // A bench line that runs past several blocks is only a colour by then: its name again, small,
    // beside a block (where no thread changes place).
    for (p = 0; p < P; p++) {
      var from = -1;
      for (n = R.a; n <= R.b + 1; n++) {
        var sits = n <= R.b && model.side[n][p] < 0;
        if (sits && from < 0) from = n;
        if (sits || from < 0) continue;
        var len = n - from, count = len >= (from === R.a ? 4 : 3) ? Math.max(1, Math.round(len / 3.5)) : 0;
        for (k = 0; k < count; k++) {
          var at = from + Math.floor((k + 0.5) * len / count);
          R.benchTags.push({ p: p, x: R.x0(at) + G.BL / 2, y: scene.sol.rows[at + 1][p] });
        }
        from = -1;
      }
    }
  }
  function pt3(R, x, y, z) { return [R.X(x, y), R.Y(y, z)]; }
  // Painter's order. In this projection the nearer of two points on one view ray is always the visible one,
  // so drawing far-to-near is exact for thin flat pieces; height only breaks ties.
  function zkey(z, y) { return -y * 100 + z; }

  function hold(R, p, S, xa, xb, n) {
    if (xb - xa < 0.01) return;
    R.quads.push({ p: p, i: 0, tid: ++TID, L: [pt3(R, xa, S.y + S.w / 2, S.z), pt3(R, xb, S.y + S.w / 2, S.z)], R: [pt3(R, xa, S.y - S.w / 2, S.z), pt3(R, xb, S.y - S.w / 2, S.z)],
      floor: S.z < 0.6, key: zkey(S.z, S.y), m: S.play ? 1 : 0, sh: null });
  }

  // One thread changing place between two matches: S = stays on the table, L = leaves for the bench, E = enters.
  // The ribbon is a flat band in the world (constant width across its own direction), cut into short pieces
  // so that the painter's algorithm can weave it over / under the other threads.
  function transition(R, p, A, B, ta, tb, kind, xg0, xg1, ph, sp) {
    var K = Math.max(10, Math.round((tb - ta) / 3.2)), i, cs = [], x, u, y, z, w, m, d;
    var crossesCentre = (A.y < 0) !== (B.y < 0);
    // Two who trade places on the table would cut through each other (a saw edge where their pieces
    // interleave): the one walking away from the viewer bridges over, drawn after the rest of the gap.
    var over = kind === "S" && B.y - A.y > G.WP / 2, arch = over ? Math.min(6, (B.y - A.y) / 8) : 0;
    for (i = 0; i <= K; i++) {
      u = i / K; x = ta + (tb - ta) * u;
      y = lerp(A.y, B.y, ease((x - ta - ph) / (tb - ta - sp)));
      if (kind === "S") { z = lerp(A.z, B.z, ease(u)) + arch * Math.sin(Math.PI * u); w = G.RW; m = 1; }
      else if (kind === "L") {
        d = x - xg0;
        z = A.z * (1 - ease(d / (0.6 * G.GAP)));
        m = 1 - ease(d / (0.62 * G.GAP)); w = lerp(G.RB, G.RW, m);
      } else {
        d = xg1 - x;
        z = B.z * (1 - ease(d / ((crossesCentre ? 0.4 : 0.6) * G.GAP)));
        m = 1 - ease(d / (0.62 * G.GAP)); w = lerp(G.RB, G.RW, m);
      }
      cs.push([x, y, z, w, m]);
    }
    var L = [], Rr = [], Ls = [], Rs = [];
    for (i = 0; i <= K; i++) {
      var c0 = cs[Math.max(0, i - 1)], c1 = cs[Math.min(K, i + 1)], c = cs[i];
      var tx = c1[0] - c0[0], ty = c1[1] - c0[1], len = Math.sqrt(tx * tx + ty * ty) || 1;
      if (i === 0 || i === K) { tx = 1; ty = 0; len = 1; }
      var nx = -ty / len * c[3] / 2, ny = tx / len * c[3] / 2;
      L.push(pt3(R, c[0] + nx, c[1] + ny, c[2])); Rr.push(pt3(R, c[0] - nx, c[1] - ny, c[2]));
      // shadow on the floor, pushed slightly towards the viewer
      Ls.push(pt3(R, c[0] + nx + c[2] * 0.12, c[1] + ny - c[2] * 0.2, 0)); Rs.push(pt3(R, c[0] - nx + c[2] * 0.12, c[1] - ny - c[2] * 0.2, 0));
    }
    var tid = ++TID;
    for (i = 0; i < K; i++) {
      var zz = (cs[i][2] + cs[i + 1][2]) / 2;
      R.quads.push({ p: p, i: i, tid: tid, L: L, R: Rr, floor: zz < 0.6, key: zkey(zz, (cs[i][1] + cs[i + 1][1]) / 2) + (over ? 1e6 : 0), m: (cs[i][4] + cs[i + 1][4]) / 2,
        sh: i === 0 ? { L: Ls, R: Rs } : null });
    }
  }

  // ---------- 4. drawing ----------
  function poly(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // The game's ball, in pool-ball colours (a stripe: white with a band).
  var EIGHT = { num: "8", base: "#16161a" }, WHITE = "#f6f1e7";
  var BALLS = {
    "8ball": EIGHT, "8ballrotation": EIGHT, "8ballpunishment": EIGHT,
    "9ball": { num: "9", base: WHITE, stripe: "#f2c21c" },
    "10ball": { num: "10", base: WHITE, stripe: "#2f6fdb" },
    "15ballrotation": { num: "15", base: WHITE, stripe: "#8c2337" },
    "straight": { num: "14", base: WHITE, stripe: "#1f8f52" },
    "onepocket": { num: "1", base: "#f2c21c" },
    "snooker": { num: "", base: "#c61f2b" }
  };
  function drawBall(ctx, x, y, r, type) {
    var b = BALLS[type] || { num: "", base: WHITE };
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.beginPath(); ctx.ellipse(x + r * 0.25, y + r * 0.95, r * 0.95, r * 0.38, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = b.base; ctx.fill();
    ctx.save(); ctx.clip();
    if (b.stripe) { ctx.fillStyle = b.stripe; ctx.fillRect(x - r, y - r * 0.58, r * 2, r * 1.16); }
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r * 1.05);
    g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(0.35, "rgba(255,255,255,0.08)"); g.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.restore();
    if (b.num) {
      ctx.beginPath(); ctx.arc(x, y, r * 0.56, 0, Math.PI * 2); ctx.fillStyle = "#fbf8f2"; ctx.fill();
      ctx.fillStyle = "#16161a"; ctx.font = "800 " + Math.round(r * (b.num.length > 1 ? 0.82 : 1.02)) + "px " + FONT;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(b.num, x, y + r * 0.06);
    }
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawFloor(ctx, scene, R) {
    var yN = scene.yN, yF = scene.yF, sol = scene.sol, F2 = G.FELT / 2, th = 7, i;
    var a = pt3(R, R.xL, yN, 0), b = pt3(R, R.xR, yN, 0), c = pt3(R, R.xR, yF, 0), d = pt3(R, R.xL, yF, 0);
    // slab thickness
    poly(ctx, [a, b, [b[0], b[1] + th], [a[0], a[1] + th]]); ctx.fillStyle = "#140707"; ctx.fill();
    poly(ctx, [b, c, [c[0], c[1] + th], [b[0], b[1] + th]]); ctx.fillStyle = "#0f0505"; ctx.fill();
    var g = ctx.createLinearGradient(0, d[1], 0, a[1]);
    g.addColorStop(0, "#1f0d0d"); g.addColorStop(1, "#2a1313");
    poly(ctx, [a, b, c, d]); ctx.fillStyle = g; ctx.fill();
    // the table lane: where the blocks stand
    var r0 = -(F2 + sol.maxHalf + 6), r1 = F2 + sol.maxHalf + 6;
    poly(ctx, [pt3(R, R.xL, r0, 0), pt3(R, R.xR, r0, 0), pt3(R, R.xR, r1, 0), pt3(R, R.xL, r1, 0)]);
    ctx.fillStyle = "rgba(255,220,200,0.035)"; ctx.fill();
    // bench lane guides
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(201,162,162,0.09)";
    ctx.beginPath();
    for (i = 0; i < sol.nearL; i++) { var y1 = sol.laneY(-1, i); ctx.moveTo(R.X(0, y1), R.Y(y1, 0)); ctx.lineTo(R.X(R.xR, y1), R.Y(y1, 0)); }
    for (i = 0; i < sol.farL; i++) { var y2 = sol.laneY(1, i); ctx.moveTo(R.X(0, y2), R.Y(y2, 0)); ctx.lineTo(R.X(R.xR, y2), R.Y(y2, 0)); }
    ctx.stroke();
    poly(ctx, [a, b, c, d]); ctx.strokeStyle = THEME.border; ctx.lineWidth = 1; ctx.stroke();
  }

  function blockFaces(R, x0, x1, yA, yB, z0, z1) {
    return {
      top: [pt3(R, x0, yA, z1), pt3(R, x1, yA, z1), pt3(R, x1, yB, z1), pt3(R, x0, yB, z1)],
      front: [pt3(R, x0, yA, z1), pt3(R, x1, yA, z1), pt3(R, x1, yA, z0), pt3(R, x0, yA, z0)],
      right: [pt3(R, x1, yA, z1), pt3(R, x1, yB, z1), pt3(R, x1, yB, z0), pt3(R, x1, yA, z0)]
    };
  }

  function drawBlock(ctx, scene, R, B, st) {
    var s = scene.s, fs = scene.fs, F2 = G.FELT / 2, m = B.m;
    var dimmed = st.hi >= 0 && scene.model.side[B.n][st.hi] < 0;
    ctx.save();
    if (dimmed) ctx.globalAlpha = 0.38;
    var f = blockFaces(R, B.x0, B.x1, B.yA, B.yB, 0, G.HB);
    // base slab
    poly(ctx, f.right); ctx.fillStyle = "#1b0a0a"; ctx.fill();
    var fg = ctx.createLinearGradient(0, f.front[0][1], 0, f.front[2][1]);
    fg.addColorStop(0, "#3a1b1b"); fg.addColorStop(1, "#2a1212");
    poly(ctx, f.front); ctx.fillStyle = fg; ctx.fill();
    poly(ctx, f.top); ctx.fillStyle = "#42201f"; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "#6a3030";
    poly(ctx, f.top); ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    poly(ctx, f.front); ctx.stroke(); poly(ctx, f.right); ctx.stroke();
    // felt strip between the two sides
    var ft = [pt3(R, B.x0 + 1.5, -F2 + 2, G.HB), pt3(R, B.x1 - 1.5, -F2 + 2, G.HB), pt3(R, B.x1 - 1.5, F2 - 2, G.HB), pt3(R, B.x0 + 1.5, F2 - 2, G.HB)];
    var gg = ctx.createLinearGradient(ft[0][0], 0, ft[1][0], 0);
    gg.addColorStop(0, "#1d7a55"); gg.addColorStop(1, "#125a3d");
    poly(ctx, ft); ctx.fillStyle = gg; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.stroke();
    for (var li = 0; li < B.lanes.length; li++) {
      var ly = B.lanes[li];
      poly(ctx, [pt3(R, B.x0 + 1.5, ly - 3, G.HB), pt3(R, B.x1 - 1.5, ly - 3, G.HB), pt3(R, B.x1 - 1.5, ly + 3, G.HB), pt3(R, B.x0 + 1.5, ly + 3, G.HB)]);
      ctx.fillStyle = gg; ctx.fill(); ctx.stroke();
    }
    // winners' podium: far one first (it can be partly hidden by the near one)
    if (B.farWins) drawPodium(ctx, R, B.x0, B.x1, F2, B.yB, dimmed);
    if (B.nearWins) drawPodium(ctx, R, B.x0, B.x1, B.yA, -F2, dimmed);
    // front plate: match number + score (winner first)
    var px0 = f.front[3][0], px1 = f.front[2][0], pyMid = (f.front[0][1] + f.front[3][1]) / 2;
    ctx.textBaseline = "middle";
    ctx.font = "600 " + Math.round(11 * fs) + "px " + FONT; ctx.textAlign = "left"; ctx.fillStyle = THEME.dim;
    ctx.fillText(String(m.n), px0 + 5 * s, pyMid + 0.5);
    var xr = px1 - 5 * s, xl = px0 + 9 * s + ctx.measureText(String(m.n)).width;
    if (m.plate) drawScore(ctx, m, xl, xr, pyMid, fs);
    else if (m.winner >= 0) {
      // one rack: a win, no score to read - a small tick
      ctx.lineWidth = 1.5 * fs; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(232,185,35,0.6)";
      ctx.beginPath(); ctx.moveTo(xr - 8.5 * fs, pyMid + 0.5 * fs); ctx.lineTo(xr - 6 * fs, pyMid + 3 * fs); ctx.lineTo(xr - 1.5 * fs, pyMid - 3 * fs); ctx.stroke();
      ctx.lineCap = "butt";
    }
    ctx.restore();
  }
  // winner first, in gold; made smaller (then cut to the first two) when the plate is too narrow
  function drawScore(ctx, m, xl, xr, y, fs) {
    var parts = m.plate, size, w, i, x;
    function fitSize() {
      size = Math.round(13 * fs) + 1;
      do { size--; ctx.font = "800 " + size + "px " + FONT; w = ctx.measureText(parts.join("–")).width + (parts.length - 1) * 3; } while (w > xr - xl && size > 9);
    }
    fitSize();
    if (w > xr - xl && parts.length > 2) { parts = parts.slice(0, 2); fitSize(); }
    ctx.textAlign = "right"; x = xr;
    for (i = parts.length - 1; i >= 0; i--) {
      ctx.fillStyle = m.winner < 0 ? THEME.text : (i === 0 ? THEME.gold : THEME.dim);
      ctx.fillText(parts[i], x, y + 0.5); x -= ctx.measureText(parts[i]).width + 1;
      if (i > 0) { ctx.fillStyle = "rgba(201,162,162,0.7)"; ctx.fillText("–", x, y); x -= ctx.measureText("–").width + 2; }
    }
  }
  function drawPodium(ctx, R, x0, x1, yA, yB, dimmed) {
    var f = blockFaces(R, x0, x1, yA, yB, G.HB, G.HB + G.POD);
    if (!dimmed) {
      // glow
      ctx.save(); ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(232,185,35,0.10)";
      poly(ctx, f.top); ctx.lineWidth = 6; ctx.stroke(); ctx.lineWidth = 11; ctx.stroke(); ctx.lineWidth = 17; ctx.stroke();
      ctx.restore();
    }
    poly(ctx, f.top); ctx.fillStyle = "#e8b923"; ctx.fill();
    poly(ctx, f.right); ctx.fillStyle = "#7d5c08"; ctx.fill();
    var g = ctx.createLinearGradient(0, f.front[0][1], 0, f.front[2][1]);
    g.addColorStop(0, "#f3cc4a"); g.addColorStop(1, "#b98c10");
    poly(ctx, f.front); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(60,40,0,0.6)";
    poly(ctx, f.front); ctx.stroke(); poly(ctx, f.right); ctx.stroke();
    poly(ctx, f.top); ctx.strokeStyle = "#ffe58a"; ctx.stroke();
  }

  function bandColour(pl, m) {
    if (m >= 0.985) return pl.color;
    if (m <= 0.015) return pl.benchColor;
    if (!pl.ramp) { pl.ramp = []; for (var i = 0; i <= 24; i++) pl.ramp.push(mix(pl.color, THEME.panel, 0.36 * (1 - i / 24))); }
    return pl.ramp[Math.round(m * 24)];
  }
  var EDGE = "#170707";
  // Consecutive pieces of one ribbon that are also neighbours in painter's order are drawn as one run:
  // same picture, a fraction of the canvas calls.
  function bbox(q) {
    var a = q.L[q.i], b = q.L[q.i + 1], c = q.R[q.i + 1], d = q.R[q.i];
    return [Math.min(a[0], b[0], c[0], d[0]) - 1.5, Math.min(a[1], b[1], c[1], d[1]) - 1.5, Math.max(a[0], b[0], c[0], d[0]) + 1.5, Math.max(a[1], b[1], c[1], d[1]) + 4.5];
  }
  function makeRuns(list) {
    var runs = [], open = [], i, k, q, r, o, ok, bb;
    for (i = 0; i < list.length; i++) list[i].bb = bbox(list[i]);
    for (i = 0; i < list.length; i++) {
      q = list[i]; bb = q.bb; r = open[q.tid];
      ok = !!r && (q.i === r.i1 + 1 || q.i === r.i0 - 1);
      // joining an earlier run draws this piece earlier: only allowed if nothing in between touches it
      for (k = ok ? r.since : i; k < i; k++) {
        o = list[k];
        if (o.tid !== q.tid && o.bb[0] < bb[2] && o.bb[2] > bb[0] && o.bb[1] < bb[3] && o.bb[3] > bb[1]) { ok = false; break; }
      }
      if (ok) { if (q.i > r.i1) r.i1 = q.i; else r.i0 = q.i; r.ms[q.i] = q.m; }
      else { r = { p: q.p, L: q.L, R: q.R, i0: q.i, i1: q.i, ms: {}, since: i + 1 }; r.ms[q.i] = q.m; open[q.tid] = r; runs.push(r); }
    }
    return runs;
  }
  function drawRun(ctx, scene, q, st, raised) {
    var pl = scene.model.players[q.p], L = q.L, Rr = q.R, i0 = q.i0, i1 = q.i1 + 1, n = L.length - 1, j;
    var m0 = q.ms[q.i0], m1 = q.ms[q.i1], fill;
    function band(dy) {
      ctx.beginPath();
      ctx.moveTo(L[i0][0], L[i0][1] + dy);
      for (j = i0 + 1; j <= i1; j++) ctx.lineTo(L[j][0], L[j][1] + dy);
      for (j = i1; j >= i0; j--) ctx.lineTo(Rr[j][0], Rr[j][1] + dy);
      ctx.closePath();
    }
    if (st.hi >= 0 && st.hi !== q.p) {
      // someone else is being followed: an opaque, greyed-out ghost of this ribbon
      band(0); ctx.fillStyle = pl.ghost; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(16,4,4,0.55)"; ctx.stroke();
      return;
    }
    if (raised) {
      // thickness of the tape: the same band, a little lower, in a darker shade
      var t = 2.8 * Math.min(1, 0.25 + Math.max(m0, m1));
      ctx.beginPath();
      ctx.moveTo(L[i0][0], L[i0][1]);
      for (j = i0 + 1; j <= i1; j++) ctx.lineTo(L[j][0], L[j][1]);
      for (j = i1; j >= i0; j--) ctx.lineTo(L[j][0], L[j][1] + t);
      ctx.closePath();
      ctx.moveTo(Rr[i0][0], Rr[i0][1]);
      for (j = i0 + 1; j <= i1; j++) ctx.lineTo(Rr[j][0], Rr[j][1]);
      for (j = i1; j >= i0; j--) ctx.lineTo(Rr[j][0], Rr[j][1] + t);
      ctx.closePath();
      ctx.fillStyle = pl.edge; ctx.fill();
    }
    if (Math.abs(m0 - m1) < 0.03) fill = bandColour(pl, (m0 + m1) / 2);
    else {
      fill = ctx.createLinearGradient((L[i0][0] + Rr[i0][0]) / 2, (L[i0][1] + Rr[i0][1]) / 2, (L[i1][0] + Rr[i1][0]) / 2, (L[i1][1] + Rr[i1][1]) / 2);
      fill.addColorStop(0, bandColour(pl, m0)); fill.addColorStop(1, bandColour(pl, m1));
    }
    band(0);
    ctx.fillStyle = fill; ctx.fill();
    // hide the hairline towards the neighbouring run of the same ribbon (kept clear of the edge lines)
    if (i0 > 0 || i1 < n) {
      ctx.lineCap = "butt"; ctx.lineWidth = 1.2; ctx.strokeStyle = fill;
      ctx.beginPath();
      if (i0 > 0) { ctx.moveTo(lerp(L[i0][0], Rr[i0][0], 0.12), lerp(L[i0][1], Rr[i0][1], 0.12)); ctx.lineTo(lerp(L[i0][0], Rr[i0][0], 0.88), lerp(L[i0][1], Rr[i0][1], 0.88)); }
      if (i1 < n) { ctx.moveTo(lerp(L[i1][0], Rr[i1][0], 0.12), lerp(L[i1][1], Rr[i1][1], 0.12)); ctx.lineTo(lerp(L[i1][0], Rr[i1][0], 0.88), lerp(L[i1][1], Rr[i1][1], 0.88)); }
      ctx.stroke();
    }
    ctx.lineCap = "square"; ctx.lineJoin = "bevel"; ctx.strokeStyle = EDGE; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L[i0][0], L[i0][1]); for (j = i0 + 1; j <= i1; j++) ctx.lineTo(L[j][0], L[j][1]);
    ctx.moveTo(Rr[i0][0], Rr[i0][1]); for (j = i0 + 1; j <= i1; j++) ctx.lineTo(Rr[j][0], Rr[j][1]);
    ctx.stroke();
    ctx.lineCap = "butt";
  }

  function drawRow(ctx, scene, R, st) {
    var s = scene.s, fs = scene.fs, model = scene.model, i, j, q, B;
    drawFloor(ctx, scene, R);
    // row caption
    var first = model.matches[R.a], last = model.matches[R.b];
    ctx.font = "600 " + Math.round(11 * fs) + "px " + FONT; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; ctx.fillStyle = THEME.dim;
    var t0 = first.start || first.end, cap = (scene.rows.length > 1 ? T("nightBraid.rowMatches", { from: first.n, to: last.n }) + "   " : "") + (t0 && last.end ? t0 + " → " + last.end : t0);
    ctx.fillText(cap, R.X(R.xL, scene.yF) + 4, R.Y(scene.yF, 0) - 7);

    // shadows
    // soft contact shadows under the blocks (stacked strokes: much cheaper than shadowBlur)
    ctx.save();
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (i = 0; i < R.blocks.length; i++) {
      B = R.blocks[i];
      var b0 = pt3(R, B.x0 + 4, B.yA - 6, 0), b1 = pt3(R, B.x1 + 5, B.yA - 6, 0), b2 = pt3(R, B.x1 + 5, B.yB - 2, 0), b3 = pt3(R, B.x0 + 4, B.yB - 2, 0);
      ctx.moveTo(b0[0], b0[1]); ctx.lineTo(b1[0], b1[1]); ctx.lineTo(b2[0], b2[1]); ctx.lineTo(b3[0], b3[1]); ctx.closePath();
    }
    ctx.fillStyle = "rgba(0,0,0,0.42)"; ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.13)";
    ctx.lineWidth = 5 * s; ctx.stroke(); ctx.lineWidth = 10 * s; ctx.stroke(); ctx.lineWidth = 16 * s; ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    for (i = 0; i < R.quads.length; i++) {
      q = R.quads[i];
      if (!q.sh || (st.hi >= 0 && st.hi !== q.p)) continue;
      ctx.moveTo(q.sh.L[0][0], q.sh.L[0][1]);
      for (j = 1; j < q.sh.L.length; j++) ctx.lineTo(q.sh.L[j][0], q.sh.L[j][1]);
      for (j = q.sh.R.length - 1; j >= 0; j--) ctx.lineTo(q.sh.R[j][0], q.sh.R[j][1]);
      ctx.closePath();
    }
    ctx.fillStyle = "rgba(0,0,0,0.34)"; ctx.fill();

    // floor-level thread pieces, then blocks, then everything that is raised
    if (!R.sorted) {
      R.floorQ = []; R.raisedQ = [];
      for (i = 0; i < R.quads.length; i++) { q = R.quads[i]; (q.floor ? R.floorQ : R.raisedQ).push(q); }
      var cmp = function (u, v) { return u.key - v.key; };
      R.floorQ.sort(cmp); R.raisedQ.sort(cmp); R.sorted = true;
      R.floorRuns = makeRuns(R.floorQ); R.raisedRuns = makeRuns(R.raisedQ);
    }
    for (i = 0; i < R.floorRuns.length; i++) if (st.hi < 0 || R.floorRuns[i].p !== st.hi) drawRun(ctx, scene, R.floorRuns[i], st, false);
    if (st.hi >= 0) for (i = 0; i < R.floorRuns.length; i++) if (R.floorRuns[i].p === st.hi) drawRun(ctx, scene, R.floorRuns[i], st, false);
    for (i = 0; i < R.blocks.length; i++) drawBlock(ctx, scene, R, R.blocks[i], st);
    for (i = 0; i < R.raisedRuns.length; i++) if (st.hi < 0 || R.raisedRuns[i].p !== st.hi) drawRun(ctx, scene, R.raisedRuns[i], st, true);
    // the followed thread goes on top of everything, so it is never interrupted
    if (st.hi >= 0) for (i = 0; i < R.raisedRuns.length; i++) if (R.raisedRuns[i].p === st.hi) drawRun(ctx, scene, R.raisedRuns[i], st, true);

    // balls on the felt, time under the block
    for (i = 0; i < R.blocks.length; i++) {
      B = R.blocks[i];
      var dimmed = st.hi >= 0 && model.side[B.n][st.hi] < 0;
      ctx.globalAlpha = dimmed ? 0.4 : 1;
      var xc = (B.x0 + B.x1) / 2, r = 7.6 * s;
      drawBall(ctx, R.X(xc, 0), R.Y(0, G.HB) - r * 0.82, r, B.m.gameType);
      // a start that was timed: start–end; else only when it ended
      var when = B.m.start && B.m.end ? B.m.start + "–" + B.m.end : (B.m.end || B.m.start);
      if (when) {
        ctx.font = "500 " + Math.round(11 * fs) + "px " + FONT; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        var lx = R.X(xc, B.yA), ly = R.Y(B.yA, 0) + 4 + 7 * fs, lw = ctx.measureText(when).width + 8;
        rrect(ctx, lx - lw / 2, ly - 7 * fs, lw, 14 * fs, 4); ctx.fillStyle = "rgba(36,16,16,0.86)"; ctx.fill();
        ctx.fillStyle = THEME.dim; ctx.fillText(when, lx, ly + 0.5);
      }
      ctx.globalAlpha = 1;
      if (st.sel === B.n) {
        var f = blockFaces(R, B.x0, B.x1, B.yA, B.yB, 0, G.HB);
        ctx.save(); ctx.lineWidth = 2; ctx.strokeStyle = THEME.text; ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(f.front[3][0], f.front[3][1]); ctx.lineTo(f.front[2][0], f.front[2][1]); ctx.lineTo(f.right[2][0], f.right[2][1]);
        ctx.lineTo(f.top[2][0], f.top[2][1]); ctx.lineTo(f.top[3][0], f.top[3][1]); ctx.lineTo(f.top[0][0], f.top[0][1]); ctx.closePath();
        ctx.stroke(); ctx.restore();
      }
    }
    // names on the ribbons while they are on a block
    var nameFont = "700 " + Math.round(11 * fs) + "px " + FONT;
    ctx.font = nameFont; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (i = 0; i < R.labels.length; i++) {
      var L = R.labels[i], pl = model.players[L.p];
      var ghost = st.hi >= 0 && st.hi !== L.p;
      if (ghost && model.side[L.n][st.hi] < 0) continue;
      var tag = scoreTag(model, L.p, L.n, true), keyS = Math.round(G.BL * s) + tag;
      if (!pl.fitted[keyS]) pl.fitted[keyS] = fitTag(pl.short, tag, nameFont, (G.BL + G.GAP * 0.6) * s - 8);
      var lx = R.X(L.x, L.y), ly = R.Y(L.y, L.z), lw = textW(pl.fitted[keyS], nameFont) + 8;
      // (wider than the block, with its Q-Score: on a tab of the ribbon's colour, out over the gaps a little)
      if (lw > G.BL * s - 2) { rrect(ctx, lx - lw / 2, ly - 7 * fs, lw, 14 * fs, 4); ctx.fillStyle = ghost ? pl.ghost : pl.color; ctx.fill(); }
      ctx.fillStyle = ghost ? "rgba(246,239,233,0.62)" : THEME.ink;
      ctx.fillText(pl.fitted[keyS], lx, ly + 0.5);
    }
    // name tags where each thread starts on this row
    for (i = 0; i < R.tags.length; i++) {
      var tg = R.tags[i], pp = model.players[tg.p], tgText = fitTag(pp.short, scoreTag(model, tg.p, R.a - 1, false), nameFont, TAG_MAX * fs);
      var tw = textW(tgText, nameFont) + 12, thh = Math.round(13 * fs);
      var tx = R.X(0, tg.y) + 3, ty = R.Y(tg.y, tg.z);
      ctx.globalAlpha = (st.hi >= 0 && st.hi !== tg.p) ? 0.25 : 1;
      rrect(ctx, tx - tw, ty - thh / 2, tw, thh, 5);
      ctx.fillStyle = pp.color; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(16,4,4,0.8)"; ctx.stroke();
      ctx.fillStyle = THEME.ink; ctx.textAlign = "center";
      ctx.fillText(tgText, tx - tw / 2, ty + 0.5);
      ctx.globalAlpha = 1;
    }
    // ...and the small ones along a long sit on the bench
    var smallFont = "700 " + Math.round(9.5 * fs) + "px " + FONT, sh = Math.round(11.5 * fs);
    ctx.font = smallFont; ctx.textAlign = "center";
    for (i = 0; i < R.benchTags.length; i++) {
      var bt = R.benchTags[i], bp = model.players[bt.p];
      if (st.hi >= 0 && st.hi !== bt.p) continue;
      var bn = fit(bp.short, smallFont, 54 * fs), bw = textW(bn, smallFont) + 9, bx = R.X(bt.x, bt.y), by = R.Y(bt.y, 0);
      rrect(ctx, bx - bw / 2, by - sh / 2, bw, sh, 4);
      ctx.fillStyle = bp.color; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(16,4,4,0.8)"; ctx.stroke();
      ctx.fillStyle = THEME.ink; ctx.fillText(bn, bx, by + 0.5);
    }
  }

  function collectHits(scene) {
    scene.hits = []; scene.tagHits = [];
    scene.rows.forEach(function (R) {
      R.blocks.forEach(function (B) {
        var x0 = R.X(B.x0, B.yA) - 4, x1 = R.X(B.x1, B.yB) + 4, y0 = R.Y(B.yB, G.HB + G.POD) - 10, y1 = R.Y(B.yA, 0) + 18;
        scene.hits.push({ n: B.n, x: x0, y: y0, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
      });
      R.tags.forEach(function (tg) {
        var x = R.X(0, tg.y) + 3, y = R.Y(tg.y, tg.z);
        scene.tagHits.push({ p: tg.p, x: x - scene.tagW - 4, y: y - 9, w: scene.tagW + 8, h: 18 });
      });
    });
  }

  function draw(ctx, scene, st) {
    st = st || { hi: -1, sel: -1 };
    for (var r = 0; r < scene.rows.length; r++) drawRow(ctx, scene, scene.rows[r], st);
    if (!scene.hits.length) collectHits(scene);
  }

  // The same night is solved once: a redraw, a new width, the poster and a second mount reuse it.
  var solved = [];
  function solveCached(model) {
    var key = model.players.length + "|" + model.matches.map(function (m) { return m.halves[0].idx.join(",") + "/" + m.halves[1].idx.join(",") + "/" + m.halves[1].gap; }).join(";"), i;
    for (i = 0; i < solved.length; i++) if (solved[i].key === key) return solved[i].sol;
    var sol = solve(model);
    solved.unshift({ key: key, sol: sol });
    if (solved.length > 4) solved.pop();
    return sol;
  }

  // ---------- 5. the poster: title, legend, the whole braid, the key - on one canvas ----------
  var POSTER_W = 1200, MAX_PIXELS = 15.5e6; // (iOS draws nothing on a canvas over 16.7 million pixels)
  function summaryLine(model) {
    var M = model.matches, P = model.players.length;
    var parts = [TP("nightBraid.matchCount", M.length, { n: M.length }), TP("nightBraid.playerCount", P, { n: P })];
    var t0 = M[0].start || M[0].end, t1 = M[M.length - 1].end;
    if (t0 && t1) parts.push(t0 + "–" + t1);
    return parts.join("  ·  ");
  }
  function posterLayout(model, sol) {
    var pad = 16, scene = buildScene(model, sol, POSTER_W - 2 * pad, {}), W = Math.max(POSTER_W, scene.width + 2 * pad);
    var chipH = 40, chipGap = 8, x = pad, y = 78, chips = [], i;
    var nameF = "700 14px " + FONT, statF = "500 12px " + FONT;
    for (i = 0; i < model.players.length; i++) {
      var pl = model.players[i], stat = T("nightBraid.chipStats", { played: pl.played, won: pl.won }), nm = fitTag(pl.name, pl.rating === null ? "" : " " + pl.rating, nameF, 220);
      var cw = 24 + Math.max(textW(nm, nameF), textW(stat, statF)) + 14;
      if (x + cw > W - pad && x > pad) { x = pad; y += chipH + chipGap; }
      chips.push({ x: x, y: y, w: cw, pl: pl, name: nm, stat: stat });
      x += cw + chipGap;
    }
    // the key: whole phrases, on as many lines as they need beside the app's name
    var brand = "Pool Master Counter", room = W - 2 * pad - textW(brand, statF) - 28, lines = [""];
    [T("nightBraid.keyPlaying"), T("nightBraid.keyBench"), T("nightBraid.keyGold"), T("nightBraid.keyBall")].forEach(function (ph) {
      var cur = lines[lines.length - 1], more = cur ? cur + "  ·  " + ph : ph;
      if (cur && textW(more, statF) > room) lines.push(ph); else lines[lines.length - 1] = more;
    });
    var top = y + chipH + 14, H = top + scene.height + 26 + lines.length * 18;
    var scale = Math.min(2, Math.sqrt(MAX_PIXELS / (W * H)));
    return { W: W, H: H, pad: pad, scale: scale, scene: scene, chips: chips, chipH: chipH, top: top, lines: lines, brand: brand, nameF: nameF, statF: statF,
      width: Math.floor(W * scale), height: Math.floor(H * scale) };
  }
  function drawPoster(model, L) {
    var cv = document.createElement("canvas"), W = L.W, H = L.H, pad = L.pad, i;
    cv.width = L.width; cv.height = L.height;
    var ctx = cv.getContext("2d");
    ctx.scale(L.scale, L.scale);
    ctx.fillStyle = THEME.bg; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    var sum = summaryLine(model), sumF = "500 13px " + FONT, titleF = "800 26px " + FONT;
    ctx.textAlign = "right"; ctx.fillStyle = THEME.dim; ctx.font = sumF; ctx.fillText(sum, W - pad, 52);
    ctx.textAlign = "left"; ctx.fillStyle = THEME.gold; ctx.font = "700 12px " + FONT; ctx.fillText(T("nightBraid.eyebrow"), pad, 24);
    ctx.fillStyle = THEME.text; ctx.font = titleF; ctx.fillText(fit(model.title, titleF, W - 2 * pad - textW(sum, sumF) - 24), pad, 52);
    L.chips.forEach(function (c) {
      rrect(ctx, c.x, c.y, c.w, L.chipH, 9); ctx.fillStyle = THEME.panel; ctx.fill(); ctx.strokeStyle = THEME.border; ctx.lineWidth = 1; ctx.stroke();
      rrect(ctx, c.x + 9, c.y + 8, 8, L.chipH - 16, 3); ctx.fillStyle = c.pl.color; ctx.fill();
      ctx.textAlign = "left"; ctx.fillStyle = THEME.text; ctx.font = L.nameF; ctx.fillText(c.name, c.x + 24, c.y + 17);
      ctx.fillStyle = THEME.dim; ctx.font = L.statF; ctx.fillText(c.stat, c.x + 24, c.y + 32);
    });
    ctx.save(); ctx.translate(pad + Math.max(0, (W - 2 * pad - L.scene.width) / 2), L.top);
    draw(ctx, L.scene, { hi: -1, sel: -1 });
    ctx.restore();
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "left"; ctx.fillStyle = THEME.dim; ctx.font = L.statF;
    for (i = 0; i < L.lines.length; i++) ctx.fillText(L.lines[i], pad, H - 16 - (L.lines.length - 1 - i) * 18);
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(201,162,162,0.7)";
    ctx.fillText(L.brand, W - pad, H - 16);
    return cv;
  }

  // ---------- 6. the panel: legend, picture, key, match list ----------
  var STYLE_ID = "pmc-night-braid-style";
  var CSS = [
    ".pmc-nb{color:var(--text,#f6efe9);font:inherit;min-width:0}.pmc-nb *{box-sizing:border-box}",
    ".pmc-nb-top{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start;justify-content:flex-end;margin:0 0 10px}.pmc-nb-legend{display:flex;flex-wrap:wrap;gap:8px;flex:1 1 280px;min-width:0}",
    ".pmc-nb-chip{display:grid;grid-template-columns:auto auto;column-gap:8px;align-items:center;text-align:left;margin:0;font:inherit;color:var(--text,#f6efe9);background:var(--bg-card,#2e1414);border:1px solid var(--border,#4a1e1e);border-radius:10px;padding:5px 12px 5px 9px;min-height:44px;cursor:pointer}",
    ".pmc-nb-sw{grid-row:1 / 3;width:8px;height:28px;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.28)}.pmc-nb-nm{font-weight:700;font-size:14px;line-height:1.15;max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pmc-nb-st{color:var(--text-dim,#c9a2a2);font-size:12px;line-height:1.15;white-space:nowrap}",
    ".pmc-nb-chip.pmc-nb-on{border-color:var(--accent,#e8b923);box-shadow:inset 0 0 0 1px var(--accent,#e8b923)}.pmc-nb-chip.pmc-nb-off{opacity:.5}",
    ".pmc-nb-btn{font:inherit;font-weight:700;margin:0;color:var(--on-accent,#241a00);background:var(--accent,#e8b923);border:1px solid var(--accent,#e8b923);border-radius:10px;min-height:44px;padding:0 16px;cursor:pointer;white-space:nowrap}",
    ".pmc-nb-chip:focus-visible,.pmc-nb-btn:focus-visible,.pmc-nb-list summary:focus-visible{outline:2px solid var(--accent,#e8b923);outline-offset:2px}",
    ".pmc-nb-hint{display:none;color:var(--text-dim,#c9a2a2);font-size:12px;margin:0 0 4px}.pmc-nb-stage{position:relative}",
    ".pmc-nb-frame{background:#1a0a0a;border:1px solid #4a1e1e;border-radius:var(--radius,14px);overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch}.pmc-nb-frame canvas{display:block;margin:0 auto}",
    ".pmc-nb-key{display:flex;flex-wrap:wrap;gap:4px 18px;align-items:center;color:var(--text-dim,#c9a2a2);font-size:12px;margin:8px 0 0}.pmc-nb-key span{display:inline-flex;align-items:center;gap:6px}.pmc-nb-key i{display:inline-block;width:26px;border-radius:2px}",
    ".pmc-nb-k1{height:9px;background:#5aa9ff;box-shadow:0 2px 0 #2f5a8c}.pmc-nb-k2{height:3px;background:#3f6694}.pmc-nb-k3{height:8px;background:#e8b923;box-shadow:0 0 0 1px rgba(125,92,8,.55)}",
    ".pmc-nb-list{margin:6px 0 0;color:var(--text-dim,#c9a2a2);font-size:13px}.pmc-nb-list summary{cursor:pointer;min-height:32px;display:flex;align-items:center;gap:6px}",
    ".pmc-nb-list summary::before{content:\"▸\"}.pmc-nb-list[open] summary::before{content:\"▾\"}.pmc-nb-list summary::-webkit-details-marker{display:none}",
    ".pmc-nb-tw{overflow-x:auto;-webkit-overflow-scrolling:touch}.pmc-nb-list table{border-collapse:collapse;margin:4px 0 0;color:var(--text,#f6efe9)}",
    ".pmc-nb-list th,.pmc-nb-list td{text-align:left;padding:5px 14px 5px 0;border-bottom:1px solid var(--border,#4a1e1e);font-size:13px;white-space:nowrap}.pmc-nb-list th{color:var(--text-dim,#c9a2a2);font-weight:600}.pmc-nb-list td:nth-child(4){white-space:normal;min-width:150px}.pmc-nb-list td span{color:var(--text-dim,#c9a2a2)}",
    ".pmc-nb-empty{display:none;margin:0;padding:18px 0;color:var(--text-dim,#c9a2a2);text-align:center}.pmc-nb-none .pmc-nb-empty{display:block}",
    ".pmc-nb-none .pmc-nb-top,.pmc-nb-none .pmc-nb-hint,.pmc-nb-none .pmc-nb-stage,.pmc-nb-none .pmc-nb-key,.pmc-nb-none .pmc-nb-list{display:none}",
    ".pmc-nb-tip{display:none;position:absolute;z-index:5;pointer-events:none;min-width:220px;max-width:300px;background:var(--bg-card,#2e1414);color:var(--text,#f6efe9);border:1px solid var(--border,#4a1e1e);border-radius:12px;padding:10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.5);font-size:13px;line-height:1.35}.pmc-nb-tip.pmc-nb-pin{pointer-events:auto;cursor:pointer}",
    ".pmc-nb-t1{display:flex;justify-content:space-between;gap:12px;font-size:14px}.pmc-nb-t1 span{font-weight:700;text-align:right}.pmc-nb-t2{color:var(--text-dim,#c9a2a2);font-size:12px;margin:1px 0 7px}",
    ".pmc-nb-side{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:8px;padding:5px 7px;margin:3px 0 0;border-radius:8px;border:1px solid var(--border,#4a1e1e)}.pmc-nb-side.pmc-nb-won{border-color:var(--accent,#e8b923)}",
    ".pmc-nb-ps{display:flex;flex-wrap:wrap;gap:2px 10px;min-width:0}.pmc-nb-p{display:inline-flex;align-items:center;gap:5px;font-weight:600}.pmc-nb-p i{flex:none;width:10px;height:10px;border-radius:3px;display:inline-block;box-shadow:0 0 0 1px rgba(0,0,0,.28)}",
    ".pmc-nb-sc{font-weight:800;font-size:16px}.pmc-nb-w{font-weight:800;font-size:10px;letter-spacing:.06em;padding:2px 6px;border-radius:6px;color:var(--on-accent,#241a00);background:var(--accent,#e8b923)}",
    ".pmc-nb-f{color:var(--text-dim,#c9a2a2);font-size:12px;margin:6px 0 0}.pmc-nb-rk{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;font-size:12px;padding:3px 0 0}.pmc-nb-rk>span:first-child,.pmc-nb-rk>span:last-child{color:var(--text-dim,#c9a2a2)}",
    "@media (max-width:600px){.pmc-nb-chip{padding:4px 10px 4px 8px}.pmc-nb-btn{padding:0 12px}}"
  ].join("");
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]; }); }
  function el(tag, cls, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (parent) parent.appendChild(e);
    return e;
  }
  function now() { return window.performance && performance.now ? performance.now() : Date.now(); }

  function mount(root, night, opts) {
    opts = opts || {};
    if (!document.getElementById(STYLE_ID)) {
      var style = document.createElement("style");
      style.id = STYLE_ID; style.textContent = CSS;
      document.head.appendChild(style);
    }
    var model = null, sol = null, scene = null, poster = null, chips = [];
    var hi = -1, sel = -1, pinned = false, lastW = 0, drawMs = 0, timer = null, urlTimer = null, blobUrl = null, ro = null, dead = false;
    function use() { words = opts; }

    root.innerHTML = "";
    root.classList.add("pmc-nb");
    var top = el("div", "pmc-nb-top", root), legend = el("div", "pmc-nb-legend", top), save = el("button", "pmc-nb-btn", top);
    var hint = el("div", "pmc-nb-hint", root), stage = el("div", "pmc-nb-stage", root), frame = el("div", "pmc-nb-frame", stage);
    var canvas = el("canvas", "", frame), tip = el("div", "pmc-nb-tip", stage), key = el("div", "pmc-nb-key", root);
    var list = el("details", "pmc-nb-list", root), listSum = el("summary", "", list), listBody = el("div", "pmc-nb-tw", list);
    var empty = el("p", "pmc-nb-empty", root);
    save.type = "button";
    legend.setAttribute("role", "group");
    canvas.setAttribute("role", "img");
    tip.setAttribute("role", "status");

    function shortNames(idx) { return idx.map(function (pi) { return model.players[pi].short; }); }
    function namesOf(ids) {
      return (ids || []).map(function (id) { return model.byId.hasOwnProperty(id) ? model.players[model.byId[id]].short : String(id); }).join(", ");
    }
    function whenOf(m) { return m.start && m.end ? m.start + "–" + m.end : (m.end || m.start); }

    // ----- the words: chips, key, match list (again at every refresh) -----
    function listHtml() {
      var h = "<table><thead><tr><th>#</th><th>" + esc(T("nightBraid.colTime")) + "</th><th>" + esc(T("nightBraid.colGame")) + "</th><th>" + esc(T("nightBraid.colPlayers")) + "</th><th>" + esc(T("nightBraid.colScore")) + "</th></tr></thead><tbody>";
      model.matches.forEach(function (m) {
        var who = "";
        m.sides.forEach(function (sd, k) {
          if (!sd.idx.length) return;
          var one = esc(shortNames(sd.idx).join(" + "));
          one = m.winner === k ? "<b>" + one + "</b>" : "<span>" + one + "</span>";
          who = who ? T("nightBraid.versus", { a: who, b: one }) : one;
        });
        h += "<tr><td>" + esc(m.n) + "</td><td>" + esc(whenOf(m)) + "</td><td>" + esc(m.game) + "</td><td>" + who + "</td><td>" + (m.plate ? esc(m.plate.join("–")) : "") + "</td></tr>";
      });
      return h + "</tbody></table>";
    }
    function markChips() {
      for (var k = 0; k < chips.length; k++) {
        chips[k].setAttribute("aria-pressed", k === hi ? "true" : "false");
        chips[k].className = "pmc-nb-chip" + (hi >= 0 && k !== hi ? " pmc-nb-off" : "") + (k === hi ? " pmc-nb-on" : "");
      }
    }
    function fillWords() {
      save.textContent = T("nightBraid.savePicture");
      hint.textContent = T("nightBraid.swipeHint");
      empty.textContent = T("nightBraid.empty");
      listSum.textContent = T("nightBraid.matchList");
      legend.setAttribute("aria-label", T("nightBraid.legendLabel"));
      key.innerHTML = "<span><i class=\"pmc-nb-k1\"></i>" + esc(T("nightBraid.keyPlaying")) + "</span><span><i class=\"pmc-nb-k2\"></i>" + esc(T("nightBraid.keyBench")) +
        "</span><span><i class=\"pmc-nb-k3\"></i>" + esc(T("nightBraid.keyGold")) + "</span><span>" + esc(T("nightBraid.keyHint")) + "</span>";
      legend.innerHTML = ""; listBody.innerHTML = ""; chips = [];
      if (model) root.classList.remove("pmc-nb-none"); else root.classList.add("pmc-nb-none");
      if (!model) return;
      canvas.setAttribute("aria-label", T("nightBraid.pictureLabel", { title: model.title }));
      model.players.forEach(function (pl, i) {
        var b = el("button", "pmc-nb-chip", legend);
        b.type = "button";
        b.innerHTML = "<span class=\"pmc-nb-sw\" style=\"background:" + pl.color + "\"></span><span class=\"pmc-nb-nm\">" + esc(pl.name + (pl.rating === null ? "" : " " + pl.rating)) + "</span><span class=\"pmc-nb-st\">" +
          esc(T("nightBraid.chipStats", { played: pl.played, won: pl.won })) + "</span>";
        b.onclick = function () { setHi(hi === i ? -1 : i); };
        chips.push(b);
      });
      markChips();
      listBody.innerHTML = listHtml();
    }

    // ----- the picture -----
    function layout(force) {
      if (dead || !model) return;
      var w = frame.clientWidth;
      // (a closed panel has no width: nothing to draw until refresh(), or until it gets one)
      if (!w || (!force && w === lastW && scene)) return;
      lastW = w;
      if (!sol) sol = solveCached(model);
      scene = buildScene(model, sol, w);
      var dpr = Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(14e6 / (scene.width * scene.height)));
      canvas.width = Math.round(scene.width * dpr); canvas.height = Math.round(scene.height * dpr);
      canvas.style.width = scene.width + "px"; canvas.style.height = scene.height + "px";
      scene.dpr = dpr;
      hint.style.display = scene.width > w + 4 ? "block" : "none";
      hideTip(); sel = -1; pinned = false;
      paint();
    }
    function paint() {
      if (!scene) return;
      var t0 = now(), ctx = canvas.getContext("2d");
      ctx.setTransform(scene.dpr, 0, 0, scene.dpr, 0, 0);
      ctx.clearRect(0, 0, scene.width, scene.height);
      draw(ctx, scene, { hi: hi, sel: sel });
      drawMs = now() - t0;
    }
    function setHi(i) {
      use();
      hi = i;
      markChips();
      paint();
    }

    // ----- a block's details -----
    function tipHtml(m) {
      var src = m.src, h, line = [], facts = [], racks = src.racks || [], ch = src.changes;
      h = "<div class=\"pmc-nb-t1\"><b>" + esc(T("nightBraid.matchNo", { n: m.n })) + "</b><span>" + esc(m.game) + "</span></div>";
      if (m.start && m.end) line.push(m.start + " – " + m.end + (m.mins > 0 ? " · " + T("nightBraid.minutes", { n: m.mins }) : ""));
      else if (m.end) line.push(T("nightBraid.endedAt", { time: m.end }));
      if (src.raceTo) line.push(T("nightBraid.raceTo", { n: src.raceTo }));
      if (src.tournament) line.push(T("nightBraid.tournament"));
      if (src.freeForAll) line.push(T("nightBraid.freeForAll"));
      h += "<div class=\"pmc-nb-t2\">" + esc(line.join(" · ")) + "</div>";
      m.sides.forEach(function (sd, k) {
        if (!sd.idx.length) return;
        var won = m.winner === k, score = sd.points !== null ? sd.points : (m.plate && sd.score !== null ? sd.score : "");
        h += "<div class=\"pmc-nb-side" + (won ? " pmc-nb-won" : "") + "\"><span class=\"pmc-nb-ps\">";
        sd.idx.forEach(function (pi) { var pl = model.players[pi]; h += "<span class=\"pmc-nb-p\"><i style=\"background:" + pl.color + "\"></i>" + esc(pl.name) + "</span>"; });
        h += "</span><span class=\"pmc-nb-sc\">" + score + "</span>" + (won ? "<span class=\"pmc-nb-w\">" + esc(T("nightBraid.won")) + "</span>" : "<span></span>") + "</div>";
      });
      if (m.winner < 0) facts.push(T("nightBraid.noWinner"));
      if (src.stoppedEarly) facts.push(T("nightBraid.stoppedEarly"));
      if (src.skunk) facts.push(T("nightBraid.skunk"));
      if (typeof src.ballsLeft === "number") facts.push(TP("nightBraid.ballsLeft", src.ballsLeft, { n: src.ballsLeft }));
      if (facts.length) h += "<div class=\"pmc-nb-f\">" + esc(facts.join(" · ")) + "</div>";
      if (ch) {
        facts = [];
        if (ch["in"] && ch["in"].length) facts.push(T("nightBraid.changeIn", { names: namesOf(ch["in"]) }));
        if (ch.out && ch.out.length) facts.push(T("nightBraid.changeOut", { names: namesOf(ch.out) }));
        if (ch.partnersSwitched) facts.push(T("nightBraid.partnersSwitched"));
        if (!facts.length) facts.push(T("nightBraid.samePlayers"));
        h += "<div class=\"pmc-nb-f\">" + esc(facts.join(" · ")) + "</div>";
      }
      if (racks.length > 1) {
        h += "<div class=\"pmc-nb-f\">";
        racks.forEach(function (rk, i) {
          var sd = m.sides[rk.winner], extra = [hhmm(rk.endedAt)];
          if (rk.points) extra.push(rk.points.join("–"));
          if (rk.skunk) extra.push(T("nightBraid.skunk"));
          if (typeof rk.ballsLeft === "number") extra.push(TP("nightBraid.ballsLeft", rk.ballsLeft, { n: rk.ballsLeft }));
          h += "<div class=\"pmc-nb-rk\"><span>" + esc(T("nightBraid.rack", { n: i + 1 })) + "</span><span class=\"pmc-nb-ps\">";
          (sd ? sd.idx : []).forEach(function (pi) { var pl = model.players[pi]; h += "<span class=\"pmc-nb-p\"><i style=\"background:" + pl.color + "\"></i>" + esc(pl.short) + "</span>"; });
          h += "</span><span>" + esc(extra.join(" · ")) + "</span></div>";
        });
        h += "</div>";
      }
      return h;
    }
    function hitAt(x, y) {
      var i, h;
      for (i = 0; i < scene.tagHits.length; i++) { h = scene.tagHits[i]; if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return { tag: h.p }; }
      for (i = 0; i < scene.hits.length; i++) { h = scene.hits[i]; if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return { n: h.n, hit: h }; }
      return null;
    }
    function showTip(h) {
      tip.innerHTML = tipHtml(model.matches[h.n]);
      tip.className = "pmc-nb-tip" + (pinned ? " pmc-nb-pin" : "");
      tip.style.display = "block";
      // (the canvas is centred in its frame, and the frame may be scrolled)
      var cr = canvas.getBoundingClientRect(), sr = stage.getBoundingClientRect(), ox = cr.left - sr.left, oy = cr.top - sr.top;
      var tw = tip.offsetWidth, th = tip.offsetHeight, x = ox + h.hit.cx - tw / 2, y = oy + h.hit.y - th - 8;
      if (y < 4) y = oy + h.hit.y + h.hit.h + 8;
      tip.style.left = Math.max(6, Math.min(stage.clientWidth - tw - 6, x)) + "px";
      tip.style.top = y + "px";
    }
    function hideTip() { tip.style.display = "none"; }
    function select(h, pin) {
      var n = h ? h.n : -1;
      if (n === sel && (!pin || pinned)) { if (h) showTip(h); return; }
      sel = n;
      if (pin) pinned = n >= 0;
      if (h) showTip(h); else hideTip();
      paint();
    }
    function local(ev) { var r = canvas.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    canvas.addEventListener("mousemove", function (ev) {
      if (pinned || !scene) return;
      use();
      var p = local(ev), h = hitAt(p.x, p.y);
      canvas.style.cursor = h ? "pointer" : "default";
      select(h && h.n != null ? h : null, false);
    });
    canvas.addEventListener("mouseleave", function () { if (!pinned && scene) { use(); select(null, false); } });
    canvas.addEventListener("click", function (ev) {
      if (!scene) return;
      use();
      var p = local(ev), h = hitAt(p.x, p.y);
      if (h && h.tag != null) { setHi(hi === h.tag ? -1 : h.tag); return; }
      pinned = false;
      if (h && h.n != null) { sel = -1; select(h, true); } else select(null, false);
    });
    function unpin() { if (scene && (pinned || sel >= 0)) { use(); pinned = false; select(null, false); } }
    tip.addEventListener("click", unpin);
    frame.addEventListener("scroll", unpin);

    // ----- the poster -----
    function posterOf() {
      if (!model) return null;
      if (!sol) sol = solveCached(model);
      if (!poster) poster = posterLayout(model, sol);
      return poster;
    }
    function pictureDataUrl() {
      if (dead) return "";
      use();
      var L = posterOf();
      return L ? drawPoster(model, L).toDataURL("image/png") : "";
    }
    function pictureSize() {
      if (dead) return { width: 0, height: 0 };
      use();
      var L = posterOf();
      return { width: L ? L.width : 0, height: L ? L.height : 0 };
    }
    function forgetUrl() {
      if (urlTimer) clearTimeout(urlTimer);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      urlTimer = null; blobUrl = null;
    }
    // (no app to hand the picture to: a plain download)
    function download() {
      var url = pictureDataUrl(), href = url, a = document.createElement("a"), i;
      if (!url) return;
      forgetUrl();
      try {
        var bin = atob(url.split(",")[1]), bytes = new Uint8Array(bin.length);
        for (i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        href = blobUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        urlTimer = setTimeout(forgetUrl, 10000);
      } catch (e) { href = url; }
      a.href = href; a.download = "pool-night-" + (model.day || "braid") + ".png";
      a.style.display = "none";
      root.appendChild(a); a.click(); root.removeChild(a);
    }
    save.addEventListener("click", function () { if (typeof opts.onSavePicture === "function") opts.onSavePicture(); else download(); });

    // ----- the handle -----
    function setNight(n) {
      if (dead) return;
      use();
      hideTip();
      hi = -1; sel = -1; pinned = false; scene = null; sol = null; poster = null; lastW = 0;
      model = n && n.matches && n.matches.length ? prepare(n) : null;
      if (!model) { canvas.width = canvas.height = 0; canvas.style.width = canvas.style.height = "0"; }
      fillWords();
      layout(true);
    }
    function refresh() {
      if (dead) return;
      use();
      poster = null;
      fillWords();
      layout(true);
    }
    function widthChanged() {
      if (dead || !model || frame.clientWidth === lastW) return;
      use();
      if (timer) clearTimeout(timer);
      // the first width draws at once; a panel being dragged wider waits for it to settle
      if (!scene) layout(false); else timer = setTimeout(function () { timer = null; use(); layout(false); }, 80);
    }
    if (window.ResizeObserver) { ro = new window.ResizeObserver(widthChanged); ro.observe(root); }
    else window.addEventListener("resize", widthChanged);

    setNight(night);
    return {
      setNight: setNight,
      refresh: refresh,
      destroy: function () {
        if (dead) return;
        dead = true;
        if (timer) clearTimeout(timer);
        forgetUrl();
        if (ro) ro.disconnect(); else window.removeEventListener("resize", widthChanged);
        root.innerHTML = "";
        root.classList.remove("pmc-nb"); root.classList.remove("pmc-nb-none");
        model = sol = scene = poster = null; chips = [];
      },
      highlight: function (id) {
        if (dead || !model) return;
        setHi(id != null && model.byId.hasOwnProperty(id) ? model.byId[id] : -1);
      },
      pictureDataUrl: pictureDataUrl,
      pictureSize: pictureSize,
      state: function () {
        return { matches: model ? model.matches.length : 0, players: model ? model.players.length : 0, rows: scene ? scene.rows.length : 0,
          highlight: model && hi >= 0 ? model.players[hi].id : null, width: scene ? scene.width : 0, drawMs: drawMs };
      }
    };
  }

  window.PMCNightBraid = { mount: mount };
})();
