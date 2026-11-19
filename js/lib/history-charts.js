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
      if (d) el("path", { d: d, fill: "none", stroke: color, "stroke-width": s.color ? 3 : 2, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: s.color ? 1 : 0.7 }, g);
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
    colored.forEach(function (s) {
      drawSeries(s, lines);
    });

    var marks = el("g", {}, svg);
    (spec.markers || []).forEach(function (m) {
      if (m.i < spec.from || m.i > cutoffEnd || m.value == null) return;
      drawMarker(marks, m, x(m.i), y(m.value), chrome);
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
        text(lab, lx, e.ly + 5, fitText(labelTexts[e.s.key], 15, 600, labelW - 18), { "font-size": 15, "font-weight": 600, fill: chrome.ink });
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
    spec.rows.forEach(function (row, r) {
      var top = plot.top + r * (cellH + 2);
      if (row.color) el("rect", { x: 6, y: top + cellH / 2 - 2, width: 14, height: 4, rx: 2, fill: row.color }, g);
      text(g, 26, top + cellH / 2 + 5, fitText(row.label, 15, 600, labelW - 32), { "font-size": 15, "font-weight": 600, fill: chrome.ink });
      for (var i = spec.from; i <= cutoffEnd; i++) {
        var v = row.values[i];
        el("rect", { x: plot.left + (i - spec.from) * cw + 1, y: top, width: Math.max(1, cw - 2), height: cellH, rx: Math.min(4, cw / 4), fill: v ? heatColor(spec.mode, v) : chrome.grid, opacity: v ? 1 : 0.6 }, g);
        if (v && row.marks && row.marks[i] && cw >= 10) el("circle", { cx: plot.left + (i - spec.from + 0.5) * cw, cy: top + cellH / 2, r: Math.min(4, cw / 4), fill: chrome.surface, stroke: ARROWS[spec.mode].race, "stroke-width": 2 }, g);
      }
    });
    xLabels(g, { from: spec.from, to: spec.to, labels: spec.labels }, x, plot.bottom + 24, chrome, cutoffEnd);
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
