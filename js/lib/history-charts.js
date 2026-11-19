// js/lib/history-charts.js
// The 📈 History page's graphs (2026-11-19, the user: "represent the leaderboard as a historical
// graph with each player represented by a line, there should be "influencers" these would be
// events that makes a player leaderboard position change these should be up and down graphic
// arrows of diferent colors ... multiple timelines dynamically ... a library of graph to help
// visualize the timeline and players progresses"). Plain SVG, no library:
// - influencers(ranks, played): from each player's rank after every night (null: not ranked) and
//   what they played that night ({won, lost, races}), the nights their position changed and why -
//   "race" (up, won a race), "up" (up, won games), "down" (down, lost games), "passiveUp" /
//   "passiveDown" (moved by the others' results or the period's window), "enter" / "leave" (into
//   or out of the ranking), with who they passed and who passed them;
// - lineChart(host, spec): one line per series over the nights - a rank chart (#1 at the top) or a
//   value chart (rating, win %) - with markers (the ▲▼ arrows), a crosshair tooltip listing every
//   series, and labels at the line ends;
// - heatmap(host, spec): a row per series, a cell per night (the activity calendar);
// - table(host, spec): every chart's table view.
// Colours: the dataviz reference palette (validated light and dark - 8 slots, colour follows the
// player, never their rank); the arrows: good / gold / critical / muted, each with its own shape.
(function (root) {
  "use strict";

  var SVG = "http://www.w3.org/2000/svg";

  var PALETTE = {
    light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
    dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"]
  };
  var CHROME = {
    light: { surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", grid: "#e1e0d9", axis: "#c3c2b7", other: "#b9b7b0" },
    dark: { surface: "#1a1a19", ink: "#f0efec", ink2: "#c3c2b7", muted: "#898781", grid: "#2c2c2a", axis: "#383835", other: "#5b5a56" }
  };
  // ▲ won games, ⏫ won a race, ▼ lost games, △▽ moved without playing, ○ ✕ into / out of the ranking
  var ARROWS = {
    light: { up: "#0ca30c", race: "#c98500", down: "#d03b3b", passiveUp: "#898781", passiveDown: "#898781", enter: "#898781", leave: "#898781" },
    dark: { up: "#0ca30c", race: "#fab219", down: "#e05252", passiveUp: "#9a9890", passiveDown: "#9a9890", enter: "#9a9890", leave: "#9a9890" }
  };
  var SHAPES = { up: "up", race: "double", down: "down", passiveUp: "hollowUp", passiveDown: "hollowDown", enter: "ring", leave: "cross" };
  // the activity calendar's games-a-night bins: one hue, more is darker (light) / lighter (dark)
  var HEAT = {
    light: ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"],
    dark: ["#184f95", "#256abf", "#3987e5", "#6da7ec", "#b7d3f6"]
  };
  var HEAT_BINS = [2, 5, 10, 20, Infinity];

  function influencers(ranks, played) {
    var names = Object.keys(ranks);
    var count = names.length ? ranks[names[0]].length : 0;
    var out = [];
    for (var i = 1; i < count; i++) {
      names.forEach(function (p) {
        var a = ranks[p][i - 1];
        var b = ranks[p][i];
        if (a === b || (a == null && b == null)) return;
        var res = (played && played[p] && played[p][i]) || { won: 0, lost: 0, races: 0 };
        var ev = { name: p, i: i, from: a == null ? null : a, to: b == null ? null : b, won: res.won || 0, lost: res.lost || 0, races: res.races || 0, passed: [], passedBy: [] };
        if (a == null) ev.kind = "enter";
        else if (b == null) ev.kind = "leave";
        else {
          names.forEach(function (q) {
            if (q === p) return;
            var qa = ranks[q][i - 1];
            var qb = ranks[q][i];
            if (qa == null || qb == null) return;
            if (qa < a && qb > b) ev.passed.push(q);
            if (qa > a && qb < b) ev.passedBy.push(q);
          });
          // (their own results moved them only when they went the same way: a night of losses
          // that still saw them climb - someone above leaving - is the others' doing)
          if (b < a) ev.kind = ev.races > 0 ? "race" : ev.won > 0 ? "up" : "passiveUp";
          else ev.kind = ev.lost > 0 ? "down" : "passiveDown";
        }
        out.push(ev);
      });
    }
    return out;
  }

  // The replay's commentator (2026-11-19, the user: "in the timeline animmation, I would like to
  // see some text when an event of signifiance occurs, like a sport commentator would do ... select
  // a player to view the animation from his point of view ... see much more details on his timeline
  // and more comments"). For each night: `general` - what mattered on the leaderboard, the most
  // notable first (sig: how much), one item per player at most - and, with `follow`, `personal`:
  // that player's whole night. Items are {kind, name, sig, ...values}; the app words them.
  // input: {names, count, ranks, scores (numbers), played ({won, lost, races, vs: {opponents:
  // {won, lost}}} per night), events (influencers), closeGap (a gap that counts as neck and neck),
  // follow, ratings ({name: [rating per night]})}
  function commentary(input) {
    var names = input.names;
    var ranks = input.ranks;
    var scores = input.scores || {};
    var played = input.played || {};
    var follow = input.follow && ranks[input.follow] ? input.follow : null;
    var rating = (follow && input.ratings && input.ratings[follow]) || null;
    var evAt = {};
    (input.events || []).forEach(function (e) {
      (evAt[e.i] = evAt[e.i] || {})[e.name] = e;
    });
    var out = [];
    var reign = 0;
    var prevGap = null;
    var best = null;
    var streak = 0;
    var raced = false;
    var lastRating = null;
    // (the most games anyone has won in a night so far; everyone's wins so far; the followed
    // player's best night)
    var recordNight = 0;
    var winsSoFar = {};
    var bestNight = 0;
    var uniq = function (list) {
      return list.filter(function (x, k) {
        return list.indexOf(x) === k;
      });
    };
    var rankAt = function (i, r) {
      for (var k = 0; k < names.length; k++) if (ranks[names[k]][i] === r) return names[k];
      return null;
    };
    for (var i = 0; i < input.count; i++) {
      var items = [];
      var ev = evAt[i] || {};
      var res = function (nm) {
        var r = played[nm] && played[nm][i];
        return r && r.won + r.lost > 0 ? r : null;
      };
      var how = function (nm) {
        var r = res(nm);
        return r ? { won: r.won, lost: r.lost, races: r.races || 0 } : { absent: true };
      };
      var leader = rankAt(i, 1);
      var second = rankAt(i, 2);
      var prevLeader = i > 0 ? rankAt(i - 1, 1) : null;
      var used = {};
      if (leader && leader !== prevLeader) {
        if (!prevLeader) items.push({ kind: "firstLeader", name: leader, sig: 60, top: true });
        else items.push({ kind: res(prevLeader) ? "leadChange" : "leadChangeAbsent", name: leader, other: prevLeader, how: how(leader), sig: 100, top: true });
        // (the old leader's slip is the same news)
        used[leader] = true;
        if (prevLeader) used[prevLeader] = true;
        reign = 1;
      } else if (leader) {
        reign += 1;
        if (reign % 5 === 0) items.push({ kind: "reign", name: leader, nights: reign, sig: 45, top: true });
      } else reign = 0;
      names.forEach(function (nm) {
        var e = ev[nm];
        var r = res(nm);
        var cands = [];
        if (e) {
          var places = e.from != null && e.to != null ? Math.abs(e.from - e.to) : 0;
          if (e.kind === "race") cands.push({ kind: "raceClimb", races: e.races, from: e.from, to: e.to, sig: 62 + 4 * places });
          if (e.kind === "up" && places >= 2) cands.push({ kind: "bigClimb", from: e.from, to: e.to, places: places, sig: 58 + 4 * places });
          if ((e.kind === "up" || e.kind === "race" || e.kind === "passiveUp") && e.to <= 3 && e.to > 1 && e.from > 3) cands.push({ kind: "topThree", to: e.to, sig: 55 });
          if (e.kind === "down" && places >= 2) cands.push({ kind: "bigDrop", won: e.won, lost: e.lost, to: e.to, places: places, sig: 52 + 3 * places });
          if ((e.kind === "down" || e.kind === "passiveDown") && places === 1 && e.from <= 3) cands.push({ kind: "slip", from: e.from, to: e.to, sig: 38 });
          if (e.kind === "enter") cands.push({ kind: "enter", to: e.to, sig: e.to <= 3 ? 50 : 30 });
          if (e.kind === "leave") cands.push({ kind: "leave", sig: 20 });
        }
        if (r && r.won >= 5 && r.lost === 0) cands.push({ kind: "sweep", won: r.won, sig: 50 });
        else if (r && r.won >= 8 && r.won / (r.won + r.lost) >= 0.75) cands.push({ kind: "onFire", won: r.won, lost: r.lost, sig: 48 });
        // (the night's big moments, moved or not: skunks, races won, an upset, a run of wins, a
        // record night, a round number of wins)
        if (r && r.skunks && r.skunks.length) cands.push({ kind: "skunk", count: r.skunks.length, others: uniq(r.skunks), sig: 46 });
        if (r && r.races && !(e && e.kind === "race")) cands.push({ kind: "raceWon", count: r.races, race: r.raceTo && r.raceTo.length ? r.raceTo[0] : null, sig: 40 });
        if (r && r.upset && r.upset.theirs - r.upset.mine >= 75) cands.push({ kind: "upset", other: r.upset.other, mine: r.upset.mine, theirs: r.upset.theirs, sig: 50 });
        if (r && r.run >= 5) cands.push({ kind: "winRun", count: r.run, sig: 42 });
        if (r && recordNight >= 5 && r.won > recordNight) cands.push({ kind: "recordNight", won: r.won, sig: 50 });
        var before = winsSoFar[nm] || 0;
        var after = before + (r ? r.won : 0);
        winsSoFar[nm] = after;
        if (Math.floor(after / 50) > Math.floor(before / 50)) cands.push({ kind: "milestone", count: Math.floor(after / 50) * 50, sig: 44 });
        if (r) cands.push({ kind: "nightLine", won: r.won, lost: r.lost, sig: 5 });
        if (!cands.length) return;
        cands.sort(function (a, b) {
          return b.sig - a.sig;
        });
        // (all of them for 🔎 everything; the best one - top - for the rest, unless a lead change
        // already tells their night)
        cands.forEach(function (c, k) {
          items.push(Object.assign({ name: nm, top: k === 0 && !used[nm] }, c));
        });
      });
      names.forEach(function (nm) {
        var r = res(nm);
        if (r && r.won > recordNight) recordNight = r.won;
      });
      // two of the top 3 (as the night began) one-on-one, 5 games or more, won clearly (by 3): the
      // biggest such night only
      if (i > 0) {
        var top = [1, 2, 3]
          .map(function (r) {
            return rankAt(i - 1, r);
          })
          .filter(Boolean);
        var clash = null;
        top.forEach(function (a, ia) {
          top.slice(ia + 1).forEach(function (b) {
            var r = res(a);
            var v = r && r.vs && r.vs[b];
            if (!v || v.won + v.lost < 5 || Math.abs(v.won - v.lost) < 3) return;
            if (clash && clash.wa + clash.wb >= v.won + v.lost) return;
            clash = v.won > v.lost ? { kind: "clash", name: a, other: b, wa: v.won, wb: v.lost, sig: 52, top: true } : { kind: "clash", name: b, other: a, wa: v.lost, wb: v.won, sig: 52, top: true };
          });
        });
        if (clash) items.push(clash);
      }
      // neck and neck at the top: once, when the gap first closes in
      if (leader && second && scores[leader] && scores[second] && input.closeGap) {
        var gap = scores[leader][i] - scores[second][i];
        if (gap >= 0 && gap < input.closeGap && (prevGap == null || prevGap >= input.closeGap)) items.push({ kind: "closeRace", name: leader, other: second, gap: gap, sig: 42, top: true });
        // (the leader pulling away: the gap up by twice a close one in a night)
        else if (leader === prevLeader && prevGap != null && gap - prevGap >= 2 * input.closeGap) items.push({ kind: "leadStretch", name: leader, gap: gap, sig: 34, top: true });
        prevGap = gap;
      } else prevGap = null;
      items.sort(function (a, b) {
        return b.sig - a.sig;
      });

      var personal = [];
      if (follow) {
        var fr = res(follow);
        var rk = ranks[follow][i];
        var fe = ev[follow];
        if (fr) {
          var vs = Object.keys(fr.vs || {})
            .map(function (o) {
              return { other: o, won: fr.vs[o].won, lost: fr.vs[o].lost };
            })
            .sort(function (a, b) {
              return b.won + b.lost - (a.won + a.lost);
            });
          personal.push({ kind: "fNight", name: follow, won: fr.won, lost: fr.lost, races: fr.races || 0, vs: vs });
        }
        if (fe && fe.kind === "enter") personal.push({ kind: "fEnter", name: follow, to: fe.to });
        else if (fe && fe.kind === "leave") personal.push({ kind: "fLeave", name: follow });
        else if (fe && fe.to < fe.from) personal.push({ kind: "fUp", name: follow, from: fe.from, to: fe.to, passed: fe.passed });
        else if (fe) personal.push({ kind: "fDown", name: follow, from: fe.from, to: fe.to, passedBy: fe.passedBy, played: !!fr });
        // (the very first night has no "before": there, they come in)
        else if (rk != null && fr) personal.push(i > 0 && ranks[follow][i - 1] === rk ? { kind: "fHold", name: follow, rank: rk } : { kind: "fEnter", name: follow, to: rk });
        if (rk != null) {
          if (best != null && rk < best) personal.push({ kind: "fBest", name: follow, rank: rk });
          best = best == null ? rk : Math.min(best, rk);
        }
        if (rk != null && (fr || fe)) {
          var above = rankAt(i, rk - 1);
          var below = rankAt(i, rk + 1);
          if (above && scores[above]) personal.push({ kind: "fGapUp", name: follow, other: above, rank: rk - 1, gap: scores[above][i] - scores[follow][i] });
          if (below && scores[below]) personal.push({ kind: "fGapDown", name: follow, other: below, rank: rk + 1, gap: scores[follow][i] - scores[below][i] });
        }
        if (rating && rating[i] != null) {
          if (lastRating != null && rating[i] !== lastRating) personal.push({ kind: "fRating", name: follow, delta: rating[i] - lastRating, rating: rating[i] });
          lastRating = rating[i];
        }
        if (fr) {
          streak = fr.won > fr.lost ? streak + 1 : 0;
          if (streak >= 3) personal.push({ kind: "fStreak", name: follow, nights: streak });
          if (fr.races && !raced) personal.push({ kind: "fFirstRace", name: follow });
          if (fr.races) raced = true;
          if (fr.skunks && fr.skunks.length) personal.push({ kind: "fSkunk", name: follow, names: uniq(fr.skunks) });
          if (fr.skunked && fr.skunked.length) personal.push({ kind: "fSkunked", name: follow, names: uniq(fr.skunked) });
          if (fr.upset && fr.upset.theirs - fr.upset.mine >= 75) personal.push({ kind: "fUpset", name: follow, other: fr.upset.other, mine: fr.upset.mine, theirs: fr.upset.theirs });
          if (fr.run >= 4) personal.push({ kind: "fRun", name: follow, count: fr.run });
          if (bestNight >= 3 && fr.won > bestNight) personal.push({ kind: "fBestNight", name: follow, won: fr.won });
          bestNight = Math.max(bestNight, fr.won);
        }
        // (a round number of wins - from the night's own count, worked out above)
        var mine = items.filter(function (it) {
          return it.name === follow && it.kind === "milestone";
        })[0];
        if (mine) personal.push({ kind: "fMilestone", name: follow, count: mine.count });
      }
      out.push({ general: items, personal: personal });
    }
    return out;
  }

  function el(name, attrs, parent) {
    var e = document.createElementNS(SVG, name);
    Object.keys(attrs || {}).forEach(function (k) {
      e.setAttribute(k, attrs[k]);
    });
    if (parent) parent.appendChild(e);
    return e;
  }

  function text(parent, x, y, str, attrs) {
    var t = el("text", Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }

  // a marker's path, centred on (x, y), s its half-size
  function shapePath(shape, x, y, s) {
    var up = "M" + x + "," + (y - s) + " L" + (x + s) + "," + (y + s * 0.8) + " L" + (x - s) + "," + (y + s * 0.8) + " Z";
    var down = "M" + x + "," + (y + s) + " L" + (x + s) + "," + (y - s * 0.8) + " L" + (x - s) + "," + (y - s * 0.8) + " Z";
    if (shape === "up" || shape === "hollowUp") return up;
    if (shape === "down" || shape === "hollowDown") return down;
    if (shape === "double") {
      var h = s * 0.95;
      return "M" + x + "," + (y - h * 1.5) + " L" + (x + h) + "," + (y - h * 0.2) + " L" + (x - h) + "," + (y - h * 0.2) + " Z M" + x + "," + (y - h * 0.3) + " L" + (x + h) + "," + (y + h) + " L" + (x - h) + "," + (y + h) + " Z";
    }
    if (shape === "cross") return "M" + (x - s * 0.7) + "," + (y - s * 0.7) + " L" + (x + s * 0.7) + "," + (y + s * 0.7) + " M" + (x + s * 0.7) + "," + (y - s * 0.7) + " L" + (x - s * 0.7) + "," + (y + s * 0.7);
    return null;
  }

  function drawMarker(g, m, x, y, chrome) {
    var s = m.size || 8;
    var shape = m.shape;
    if (shape === "ring") {
      el("circle", { cx: x, cy: y, r: s * 0.75, fill: chrome.surface, stroke: m.color, "stroke-width": 3 }, g);
      return;
    }
    var d = shapePath(shape, x, y, s);
    if (shape === "cross") {
      el("path", { d: d, stroke: chrome.surface, "stroke-width": 6, "stroke-linecap": "round" }, g);
      el("path", { d: d, stroke: m.color, "stroke-width": 3, "stroke-linecap": "round" }, g);
      return;
    }
    var hollow = shape === "hollowUp" || shape === "hollowDown";
    // (the 2px surface ring, then the mark)
    el("path", { d: d, fill: chrome.surface, stroke: chrome.surface, "stroke-width": 4, "stroke-linejoin": "round" }, g);
    el("path", { d: d, fill: hollow ? chrome.surface : m.color, stroke: m.color, "stroke-width": hollow ? 2.5 : 1, "stroke-linejoin": "round" }, g);
  }

  // a label's width as drawn (15px semibold), and a label cut to a width with "…"
  var measureCtx = null;
  function textWidth(str, size, weight) {
    if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
    measureCtx.font = (weight || 600) + " " + size + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    return measureCtx.measureText(str).width;
  }
  function fitText(str, size, weight, max) {
    if (textWidth(str, size, weight) <= max) return str;
    while (str.length > 1 && textWidth(str + "…", size, weight) > max) str = str.slice(0, -1);
    return str + "…";
  }

  // a marker on its own, for a legend
  function markerIcon(shape, color, mode) {
    var svg = el("svg", { width: 22, height: 22, viewBox: "0 0 22 22", class: "hc-icon", "aria-hidden": "true" });
    drawMarker(svg, { shape: shape, color: color, size: 7 }, 11, shape === "double" ? 12 : 11, CHROME[mode]);
    return svg;
  }

  // clean ticks for a value axis
  function niceTicks(min, max, count) {
    if (max <= min) max = min + 1;
    var span = max - min;
    var step = Math.pow(10, Math.floor(Math.log10(span / count)));
    [1, 2, 2.5, 5, 10].some(function (m) {
      if (span / (step * m) <= count) {
        step *= m;
        return true;
      }
      return false;
    });
    // (from a tick at or below min to one at or above max, so every value sits inside them)
    var ticks = [];
    var top = Math.ceil(max / step - 1e-9) * step;
    for (var v = Math.floor(min / step + 1e-9) * step; v <= top + 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
    return ticks;
  }

  // x positions for nights from..to across [left, right]
  function xScale(from, to, left, right) {
    return function (i) {
      return to === from ? (left + right) / 2 : left + ((i - from) / (to - from)) * (right - left);
    };
  }

  function xLabels(g, spec, x, y, chrome, cutoffEnd) {
    var from = spec.from;
    var to = spec.to;
    var px = to > from ? (x(to) - x(from)) / (to - from) : 999;
    var step = Math.max(1, Math.ceil(84 / px));
    for (var i = from; i <= to; i += step) {
      text(g, x(i), y, spec.labels[i], { "text-anchor": i === from && to > from ? "start" : "middle", "font-size": 14, fill: i > cutoffEnd ? chrome.grid : chrome.muted });
    }
  }

  function setChrome(host, mode) {
    var c = CHROME[mode];
    host.style.setProperty("--hc-surface", c.surface);
    host.style.setProperty("--hc-ink", c.ink);
    host.style.setProperty("--hc-ink2", c.ink2);
    host.style.setProperty("--hc-muted", c.muted);
    host.style.setProperty("--hc-grid", c.grid);
    host.classList.add("hc-host");
    return c;
  }

  // the tooltip: a title, then a row per series - a line key, the value (strong), the label, a note
  function showTooltip(host, tip, content, px, py) {
    tip.textContent = "";
    if (!content) {
      tip.hidden = true;
      return;
    }
    var title = document.createElement("div");
    title.className = "hc-tip-title";
    title.textContent = content.title;
    tip.appendChild(title);
    (content.rows || []).forEach(function (r) {
      var row = document.createElement("div");
      row.className = "hc-tip-row";
      var key = document.createElement("span");
      key.className = "hc-tip-key";
      key.style.background = r.color || "transparent";
      var value = document.createElement("strong");
      value.textContent = r.value;
      var label = document.createElement("span");
      label.className = "hc-tip-label";
      label.textContent = r.label;
      row.appendChild(key);
      row.appendChild(value);
      row.appendChild(label);
      if (r.note) {
        var note = document.createElement("span");
        note.className = "hc-tip-note";
        if (r.noteColor) note.style.borderLeftColor = r.noteColor;
        note.textContent = r.note;
        row.appendChild(note);
      }
      tip.appendChild(row);
    });
    tip.hidden = false;
    var w = host.clientWidth;
    var tw = tip.offsetWidth;
    var left = px + 16;
    if (left + tw > w - 4) left = Math.max(4, px - tw - 16);
    tip.style.left = left + "px";
    tip.style.top = Math.max(4, py) + "px";
  }

  // pointer and keyboard over the plot: the crosshair snaps to the nearest night, the tooltip lists
  // every series there; a tap on touch screens toggles it
  function crosshair(host, svg, spec, x, plot, chrome, cutoffEnd) {
    var tip = document.createElement("div");
    tip.className = "hc-tip";
    tip.hidden = true;
    host.appendChild(tip);
    var line = el("line", { x1: 0, x2: 0, y1: plot.top, y2: plot.bottom, stroke: chrome.ink2, "stroke-width": 1, visibility: "hidden" }, svg);
    var hit = el("rect", { x: plot.left - 12, y: 0, width: plot.right - plot.left + 24, height: plot.bottom + 6, fill: "transparent", tabindex: 0, role: "img", "aria-label": spec.ariaLabel || "" }, svg);
    var current = null;
    var at = function (i, py) {
      current = i;
      if (i == null) {
        line.setAttribute("visibility", "hidden");
        tip.hidden = true;
        return;
      }
      line.setAttribute("x1", x(i));
      line.setAttribute("x2", x(i));
      line.setAttribute("visibility", "visible");
      var scale = svg.getBoundingClientRect().width / Number(svg.getAttribute("width"));
      showTooltip(host, tip, spec.tooltip ? spec.tooltip(i) : null, x(i) * scale, py);
    };
    var nearest = function (evt) {
      var r = svg.getBoundingClientRect();
      var scale = r.width / Number(svg.getAttribute("width"));
      var px = (evt.clientX - r.left) / scale;
      var i = spec.to === spec.from ? spec.from : Math.round(spec.from + ((px - plot.left) / (plot.right - plot.left)) * (spec.to - spec.from));
      return Math.max(spec.from, Math.min(cutoffEnd, i));
    };
    hit.addEventListener("pointermove", function (evt) {
      if (evt.pointerType === "touch") return;
      at(nearest(evt), evt.clientY - host.getBoundingClientRect().top + 12);
    });
    hit.addEventListener("pointerleave", function (evt) {
      if (evt.pointerType !== "touch") at(null);
    });
    hit.addEventListener("click", function (evt) {
      var i = nearest(evt);
      at(current === i && evt.pointerType !== "mouse" ? null : i, evt.clientY - host.getBoundingClientRect().top + 12);
    });
    hit.addEventListener("keydown", function (evt) {
      if (evt.key !== "ArrowLeft" && evt.key !== "ArrowRight") return;
      evt.preventDefault();
      var i = current == null ? cutoffEnd : current + (evt.key === "ArrowLeft" ? -1 : 1);
      at(Math.max(spec.from, Math.min(cutoffEnd, i)), 12);
    });
    hit.addEventListener("blur", function () {
      at(null);
    });
    return { show: at };
  }

  function lineChart(host, spec) {
    host.textContent = "";
    var chrome = setChrome(host, spec.mode);
    var W = Math.max(300, Math.round(spec.width || host.clientWidth || 600));
    var rank = !!spec.rank;
    var colored = spec.series.filter(function (s) {
      return s.color;
    });
    var endLabels = spec.endLabels !== false && colored.length > 0;
    var cutoffEnd = spec.cutoff == null ? spec.to : Math.min(spec.to, spec.cutoff);
    // (the label room: the longest label, up to a third of the width - longer ones cut with "…")
    var labelTexts = {};
    var longest = 0;
    colored.forEach(function (s) {
      var v = s.values[cutoffEnd];
      if (v == null) return;
      labelTexts[s.key] = s.endLabel ? s.endLabel(v) : s.label;
      longest = Math.max(longest, textWidth(labelTexts[s.key], 15, 600));
    });
    var labelW = endLabels ? Math.max(48, Math.min(W * 0.34, longest + 26)) : 16;
    var plot = { left: rank ? 52 : 58, right: W - labelW, top: 18 };
    var rowH = spec.rowHeight || 34;
    var plotH = rank ? (spec.yMax - spec.yMin + 1) * rowH : spec.height || 260;
    plot.bottom = plot.top + plotH;
    var H = plot.bottom + 38;
    var svg = el("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, class: "hc-svg", role: "group" }, host);
    var x = xScale(spec.from, spec.to, plot.left, plot.right);
    var y = rank
      ? function (v) {
          return plot.top + (v - spec.yMin + 0.5) * rowH;
        }
      : function (v) {
          return plot.top + (1 - (v - spec.yMin) / (spec.yMax - spec.yMin || 1)) * plotH;
        };
    var grid = el("g", {}, svg);
    var ticks = rank
      ? (function () {
          var t = [];
          for (var r = spec.yMin; r <= spec.yMax; r++) t.push(r);
          return t;
        })()
      : spec.yTicks || niceTicks(spec.yMin, spec.yMax, 5);
    ticks.forEach(function (v) {
      el("line", { x1: plot.left, x2: plot.right, y1: y(v), y2: y(v), stroke: chrome.grid, "stroke-width": 1 }, grid);
      text(grid, plot.left - 10, y(v) + 5, spec.yFormat ? spec.yFormat(v) : String(v), { "text-anchor": "end", "font-size": 14, fill: chrome.muted, class: "hc-num" });
    });
    (spec.refLines || []).forEach(function (r) {
      el("line", { x1: plot.left, x2: plot.right, y1: y(r.value), y2: y(r.value), stroke: chrome.axis, "stroke-width": 1.5 }, grid);
    });
    el("line", { x1: plot.left, x2: plot.right, y1: plot.bottom, y2: plot.bottom, stroke: chrome.axis, "stroke-width": 1 }, grid);
    xLabels(grid, spec, x, plot.bottom + 24, chrome, cutoffEnd);

    var px = spec.to > spec.from ? (plot.right - plot.left) / (spec.to - spec.from) : 999;
    var drawSeries = function (s, g) {
      var d = "";
      var open = false;
      var single = [];
      for (var i = spec.from; i <= cutoffEnd; i++) {
        var v = s.values[i];
        if (v == null) {
          open = false;
          continue;
        }
        var next = i < cutoffEnd ? s.values[i + 1] : null;
        if (!open && next == null) single.push(i);
        d += (open ? " L" : " M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
        open = true;
      }
      var color = s.color || chrome.other;
      // (following someone: their line the thickest, on top; everyone else faded)
      var focused = spec.focus && s.key === spec.focus;
      var dim = spec.focus && !focused;
      var opacity = dim ? 0.28 : s.color ? 1 : 0.7;
      if (dim) g = el("g", { opacity: opacity }, g);
      if (d) el("path", { d: d, fill: "none", stroke: color, "stroke-width": focused ? 5 : s.color ? 3 : 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: dim ? 1 : opacity }, g);
      // (points: every night while there's room, and a night on its own always)
      for (var j = spec.from; j <= cutoffEnd; j++) {
        if (s.values[j] == null) continue;
        if (!s.color && single.indexOf(j) === -1) continue;
        if (s.color && px < 16 && single.indexOf(j) === -1 && j !== cutoffEnd) continue;
        el("circle", { cx: x(j), cy: y(s.values[j]), r: s.color ? 4.5 : 3, fill: color, stroke: chrome.surface, "stroke-width": 2 }, g);
      }
    };
    var lines = el("g", {}, svg);
    spec.series
      .filter(function (s) {
        return !s.color;
      })
      .forEach(function (s) {
        drawSeries(s, lines);
      });
    colored
      .filter(function (s) {
        return s.key !== spec.focus;
      })
      .concat(
        colored.filter(function (s) {
          return s.key === spec.focus;
        })
      )
      .forEach(function (s) {
        drawSeries(s, lines);
      });

    var marks = el("g", {}, svg);
    var faded = el("g", { opacity: 0.3 }, marks);
    var front = el("g", {}, marks);
    (spec.markers || []).forEach(function (m) {
      if (m.i < spec.from || m.i > cutoffEnd || m.value == null) return;
      drawMarker(spec.focus && m.key !== spec.focus ? faded : front, m, x(m.i), y(m.value), chrome);
    });

    // labels at the line ends - the series still there on the last night shown; leader lines where
    // they'd collide
    if (endLabels) {
      var ends = colored
        .filter(function (s) {
          return s.values[cutoffEnd] != null;
        })
        .map(function (s) {
          return { s: s, v: s.values[cutoffEnd], y: y(s.values[cutoffEnd]) };
        })
        .sort(function (a, b) {
          return a.y - b.y;
        });
      var gap = 19;
      ends.forEach(function (e, k) {
        e.ly = k ? Math.max(e.y, ends[k - 1].ly + gap) : e.y;
      });
      var over = ends.length ? ends[ends.length - 1].ly - (plot.bottom + 10) : 0;
      if (over > 0) ends.forEach(function (e) {
        e.ly -= over;
      });
      var under = ends.length ? plot.top - 4 - ends[0].ly : 0;
      if (under > 0) ends.forEach(function (e) {
        e.ly += under;
      });
      var lab = el("g", {}, svg);
      ends.forEach(function (e) {
        var lx = plot.right + 14;
        if (Math.abs(e.ly - e.y) > 2) el("path", { d: "M" + (x(cutoffEnd) + 6) + "," + e.y + " L" + (lx - 4) + "," + e.ly, stroke: chrome.muted, "stroke-width": 1, fill: "none" }, lab);
        var dimLabel = spec.focus && e.s.key !== spec.focus;
        text(lab, lx, e.ly + 5, fitText(labelTexts[e.s.key], 15, 600, labelW - 18), { "font-size": 15, "font-weight": dimLabel ? 500 : 700, fill: dimLabel ? chrome.muted : chrome.ink });
      });
    }
    if (spec.cutoff != null && spec.cutoffLabel) {
      text(svg, plot.right - 4, plot.top + 30, spec.cutoffLabel, { "text-anchor": "end", "font-size": 28, "font-weight": 800, fill: chrome.ink2, opacity: 0.55 });
    }
    return crosshair(host, svg, spec, x, plot, chrome, cutoffEnd);
  }

  function heatColor(mode, n) {
    for (var k = 0; k < HEAT_BINS.length; k++) if (n <= HEAT_BINS[k]) return HEAT[mode][k];
    return HEAT[mode][HEAT[mode].length - 1];
  }

  function heatmap(host, spec) {
    host.textContent = "";
    var chrome = setChrome(host, spec.mode);
    var W = Math.max(300, Math.round(spec.width || host.clientWidth || 600));
    var widest = 0;
    spec.rows.forEach(function (row) {
      widest = Math.max(widest, textWidth(row.label, 15, 600));
    });
    var labelW = Math.max(70, Math.min(W * 0.34, widest + 36));
    var plot = { left: labelW, right: W - 12, top: 10 };
    var cellH = 30;
    plot.bottom = plot.top + spec.rows.length * (cellH + 2);
    var H = plot.bottom + 38;
    var svg = el("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, class: "hc-svg", role: "group" }, host);
    var cutoffEnd = spec.cutoff == null ? spec.to : Math.min(spec.to, spec.cutoff);
    var n = spec.to - spec.from + 1;
    var cw = (plot.right - plot.left) / n;
    var x = function (i) {
      return plot.left + (i - spec.from + 0.5) * cw;
    };
    var g = el("g", {}, svg);
    var all = g;
    spec.rows.forEach(function (row, r) {
      var top = plot.top + r * (cellH + 2);
      g = spec.focus && row.key !== spec.focus ? el("g", { opacity: 0.35 }, all) : all;
      if (row.color) el("rect", { x: 6, y: top + cellH / 2 - 2, width: 14, height: 4, rx: 2, fill: row.color }, g);
      text(g, 26, top + cellH / 2 + 5, fitText(row.label, 15, 600, labelW - 32), { "font-size": 15, "font-weight": 600, fill: chrome.ink });
      for (var i = spec.from; i <= cutoffEnd; i++) {
        var v = row.values[i];
        el("rect", { x: plot.left + (i - spec.from) * cw + 1, y: top, width: Math.max(1, cw - 2), height: cellH, rx: Math.min(4, cw / 4), fill: v ? heatColor(spec.mode, v) : chrome.grid, opacity: v ? 1 : 0.6 }, g);
        if (v && row.marks && row.marks[i] && cw >= 10) el("circle", { cx: plot.left + (i - spec.from + 0.5) * cw, cy: top + cellH / 2, r: Math.min(4, cw / 4), fill: chrome.surface, stroke: ARROWS[spec.mode].race, "stroke-width": 2 }, g);
      }
    });
    xLabels(all, { from: spec.from, to: spec.to, labels: spec.labels }, x, plot.bottom + 24, chrome, cutoffEnd);
    var xc = function (i) {
      return x(i);
    };
    return crosshair(host, svg, spec, xc, plot, chrome, cutoffEnd);
  }

  // the table view: a row per night (newest first), a column per series
  function table(host, spec) {
    host.textContent = "";
    var t = document.createElement("table");
    t.className = "hc-table";
    var head = document.createElement("tr");
    [spec.firstColumn].concat(
      spec.series.map(function (s) {
        return s.label;
      })
    ).forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    });
    var thead = document.createElement("thead");
    thead.appendChild(head);
    t.appendChild(thead);
    var body = document.createElement("tbody");
    var end = spec.cutoff == null ? spec.to : Math.min(spec.to, spec.cutoff);
    for (var i = end; i >= spec.from; i--) {
      var tr = document.createElement("tr");
      var td0 = document.createElement("th");
      td0.textContent = spec.labels[i];
      tr.appendChild(td0);
      spec.series.forEach(function (s) {
        var td = document.createElement("td");
        td.textContent = spec.cell(s, i);
        tr.appendChild(td);
      });
      body.appendChild(tr);
    }
    t.appendChild(body);
    host.appendChild(t);
  }

  var api = {
    influencers: influencers,
    commentary: commentary,
    lineChart: lineChart,
    markerIcon: markerIcon,
    heatmap: heatmap,
    table: table,
    niceTicks: niceTicks,
    heatColor: heatColor,
    PALETTE: PALETTE,
    CHROME: CHROME,
    ARROWS: ARROWS,
    SHAPES: SHAPES,
    HEAT: HEAT,
    HEAT_BINS: HEAT_BINS
  };
  root.PMCLib = root.PMCLib || {};
  root.PMCLib.historyCharts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
