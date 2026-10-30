// The cue viewer / adjuster - on the recording page (record.html, while it
// records) and the cues page (cues.html). Every cue (a marked moment, kept by
// server/recorder.js) plays straight from the recording - the file still
// being written included - and can be set right by hand: a timeline with the
// cue's span and a little before and after it, its start and end dragged or
// set at the playhead (I / O), nudged a second at a time; then saved, and
// exported - cut out with ffmpeg and downloaded on the spot (also kept in
// the Clips folder).
//
// ⏪ The whole recording (2026-10-30): a timeline of the recording being
// played - the one still being recorded too, start to now - to go back to
// any moment (drag; the last 10 min / hour / all; ±10 s, ±1 min; 🔴 Live) and
// ＋ add a cue there, named after the game being played then (its 🎱 mark).
//
// PMCCueViewer.mount(container, { compact, sessions, onDelete(cueId) }) ->
// { refresh, select(id), state() }. A cue (🗑 on its row) and a whole
// recording (🗑 on its timeline - to the Trash, with its cues) can be
// deleted, a second click confirming. PMCCueViewer.nameFor(cue) - the cue's name,
// [player]-vs-[opponent]-[game]-[game N of raceto M]-[duration]-[date]-[time]-cued, with
// its own start and length (record.html names new cues with it too).
(function () {
  "use strict";
  var CONTEXT_MS = 30000; // shown before and after a cue on its timeline
  var POLL_MS = 5000;

  function pad2(n) { return String(n).padStart(2, "0"); }
  function durationText(ms) { var s = Math.max(0, Math.round(ms / 1000)); return (s >= 60 ? Math.floor(s / 60) + "m" : "") + pad2(s % 60) + "s"; }
  function stamp(t) { var d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "-" + pad2(d.getHours()) + "h" + pad2(d.getMinutes()) + "m" + pad2(d.getSeconds()); }
  // the shooter and who they play against ("Luigi-vs-Bob"); nobody selected:
  // the two sides ("Luc-vs-Bob"), or the table
  function whoOf(c) {
    if (c.player) return c.player + (c.opponent ? "-vs-" + c.opponent : "");
    return c.matchup || "Table";
  }
  function nameFor(c) {
    return [whoOf(c), c.gameLabel, c.position, c.endedAt ? durationText(c.endedAt - c.startedAt) : "", stamp(c.startedAt), "cued"].filter(Boolean).join("-");
  }
  function clockOf(t) { var d = new Date(t); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + "." + Math.floor(d.getMilliseconds() / 100); }
  function len(ms) { if (!(ms >= 0)) return "-"; var s = Math.round(ms / 1000); return (s >= 3600 ? Math.floor(s / 3600) + ":" + pad2(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ":" + pad2(s % 60); }
  function when(t) { var d = new Date(t); return d.toLocaleDateString() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  // (the page's words: js/camera-i18n.js's CT when the page has it, else English)
  function tr(key, english, vars) {
    if (window.CT) return window.CT(key, english, vars);
    return String(english).replace(/\{\{(\w+)\}\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; });
  }
  function api(path, body, method) {
    return fetch(path, { method: method || (body === undefined ? "GET" : "POST"), headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }

  var CSS = [
    ".cv { display: block; }",
    ".cv video { width: 100%; max-height: 52vh; background: #000; border-radius: 12px; display: block; }",
    ".cv .cv-name { font-weight: 800; color: var(--accent, #e8b923); margin: 8px 2px 4px; overflow-wrap: anywhere; min-height: 1.3em; }",
    ".cv .cv-name input { width: 100%; font: inherit; background: #120606; color: inherit; border: 1px solid var(--border, #4a1e1e); border-radius: 8px; padding: 6px 8px; }",
    ".cv .cv-line { position: relative; height: 54px; margin: 10px 0 6px; background: #120606; border-radius: 10px; cursor: pointer; touch-action: none; user-select: none; }",
    ".cv .cv-span { position: absolute; top: 8px; bottom: 8px; background: rgba(232,185,35,0.35); border: 2px solid var(--accent, #e8b923); border-radius: 6px; }",
    ".cv .cv-handle { position: absolute; top: 0; bottom: 0; width: 22px; margin-left: -11px; cursor: ew-resize; display: flex; align-items: center; justify-content: center; }",
    ".cv .cv-handle::after { content: ''; width: 8px; height: 100%; border-radius: 4px; background: var(--accent, #e8b923); box-shadow: 0 0 0 2px #1a0a0a; }",
    ".cv .cv-head { position: absolute; top: -4px; bottom: -4px; width: 3px; margin-left: -1px; background: #fff; pointer-events: none; }",
    ".cv .cv-tick { position: absolute; bottom: 2px; font-size: 0.72rem; color: var(--text-dim, #c9a2a2); transform: translateX(-50%); pointer-events: none; }",
    ".cv .cv-live { position: absolute; top: 0; bottom: 0; right: 0; background: repeating-linear-gradient(45deg, rgba(255,77,77,0.15) 0 6px, transparent 6px 12px); pointer-events: none; }",
    ".cv .cv-marks { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; align-items: center; margin: 6px 0; }",
    ".cv .cv-marks .t { font-variant-numeric: tabular-nums; font-weight: 700; }",
    ".cv .cv-row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }",
    ".cv button, .cv a.cv-btn { font: inherit; border-radius: 9px; border: 1px solid var(--border, #4a1e1e); background: var(--panel, #241010); color: inherit; padding: 6px 11px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; gap: 5px; min-height: 36px; }",
    ".cv button.primary { background: var(--accent, #e8b923); color: #1a0a0a; border-color: var(--accent, #e8b923); font-weight: 800; }",
    ".cv button:disabled { opacity: 0.45; cursor: default; }",
    ".cv .cv-status { color: var(--text-dim, #c9a2a2); font-size: 0.9rem; min-height: 1.2em; margin: 4px 2px; }",
    ".cv .cv-dirty { color: #ff8be0; font-weight: 700; }",
    ".cv table { width: 100%; border-collapse: collapse; margin-top: 10px; }",
    ".cv td { padding: 6px 4px; border-bottom: 1px solid var(--border, #4a1e1e); vertical-align: middle; }",
    ".cv td.n { font-weight: 700; overflow-wrap: anywhere; cursor: pointer; }",
    ".cv tr.sel td { background: rgba(232,185,35,0.13); }",
    ".cv tr.open td.n { color: #ff4d4d; }",
    ".cv input[type=search] { font: inherit; width: 100%; background: #120606; color: inherit; border: 1px solid var(--border, #4a1e1e); border-radius: 8px; padding: 7px 9px; margin-top: 10px; }",
    ".cv .cv-sessions { margin-top: 16px; }",
    ".cv .cv-session { background: var(--panel, #241010); border: 1px solid var(--border, #4a1e1e); border-radius: 12px; padding: 8px 10px; margin-bottom: 8px; }",
    ".cv .cv-tl { position: relative; height: 30px; background: #120606; border-radius: 8px; margin-top: 6px; cursor: pointer; overflow: hidden; }",
    ".cv .cv-tl .c { position: absolute; top: 4px; bottom: 4px; min-width: 4px; background: var(--accent, #e8b923); border-radius: 3px; opacity: 0.85; }",
    // (🎱 game marks: blue lines, apart from the gold ⭐ cues)
    ".cv .cv-tl .c.g { top: 0; bottom: 0; width: 3px !important; min-width: 3px; margin-left: -1px; background: #3fa9f5; opacity: 1; border-radius: 1px; z-index: 2; }",
    ".cv tr.game td.n { color: #3fa9f5; }",
    ".cv tr.game td.n::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #3fa9f5; margin-right: 6px; }",
    ".cv tr:not(.game) td.n::before { content: ''; display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--accent, #e8b923); margin-right: 6px; }",
    ".cv .cv-legend { margin-left: 10px; }",
    ".cv .cv-legend .lg { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 4px 0 8px; vertical-align: -1px; }",
    ".cv .cv-tl .h { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; }",
    ".cv .dim { color: var(--text-dim, #c9a2a2); font-size: 0.9rem; }",
    ".cv td.x { width: 1%; white-space: nowrap; text-align: right; }",
    ".cv button.cv-del { min-height: 32px; padding: 4px 9px; }",
    ".cv button.cv-del.sure { background: #b3261e; border-color: #b3261e; color: #fff; font-weight: 800; }",
    ".cv .cv-session-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
    ".cv .cv-session-head .cv-del { margin-left: auto; }",
    // ☑ the checked cues, done together
    ".cv .cv-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 10px; padding: 6px 8px; border: 1px solid var(--border, #4a1e1e); border-radius: 10px; }",
    ".cv .cv-group button { min-height: 36px; }",
    ".cv .cv-group button.cv-group-del.sure { background: #b3261e; border-color: #b3261e; color: #fff; font-weight: 800; }",
    ".cv .cv-group button.ready { background: var(--accent, #e8b923); color: #1a0d0d; font-weight: 800; }",
    ".cv td.pk { width: 1%; }",
    ".cv td.pk input { width: 20px; height: 20px; margin: 0; }",
    ".cv .kept { color: var(--accent, #e8b923); }",
    // 🐢 slow motion: the speed, a frame at a time
    ".cv .cv-speed { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 6px 0 2px; }",
    ".cv .cv-speed button { min-height: 36px; min-width: 48px; }",
    ".cv .cv-speed button.on { background: var(--accent, #e8b923); border-color: var(--accent, #e8b923); color: #1a0d0d; font-weight: 800; }",
    ".cv .cv-speed .cv-rate { font-weight: 800; margin-left: 6px; }",
    // ⏪ the whole recording, start to now
    ".cv .cv-whole { margin: 10px 0 4px; padding: 8px 10px; border: 1px solid var(--border, #4a1e1e); border-radius: 12px; }",
    ".cv .cv-whole-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }",
    ".cv .cv-whole-what { font-variant-numeric: tabular-nums; }",
    ".cv .cv-whole-what .on-air { color: var(--rec, #ff4d4d); font-weight: 800; }",
    ".cv .cv-whole-what .paused { color: var(--accent, #e8b923); font-weight: 800; }",
    ".cv .cv-wline .gap { position: absolute; top: 0; bottom: 18px; min-width: 2px; background: repeating-linear-gradient(45deg, rgba(232,185,35,0.28) 0 5px, transparent 5px 10px); pointer-events: none; }",
    ".cv .cv-zoom { margin-left: auto; display: inline-flex; gap: 4px; }",
    ".cv .cv-zoom button { min-height: 34px; padding: 4px 10px; }",
    ".cv .cv-zoom button.on { background: var(--accent, #e8b923); border-color: var(--accent, #e8b923); color: #1a0d0d; font-weight: 800; }",
    ".cv .cv-wline { position: relative; height: 64px; margin: 34px 0 6px; background: #120606; border-radius: 10px; cursor: pointer; touch-action: none; user-select: none; }",
    ".cv .cv-wline .c { position: absolute; top: 8px; bottom: 24px; min-width: 4px; background: var(--accent, #e8b923); border-radius: 3px; opacity: 0.85; pointer-events: none; }",
    ".cv .cv-wline .c.g { top: 2px; bottom: 20px; width: 3px; min-width: 3px; margin-left: -1px; background: #3fa9f5; opacity: 1; border-radius: 1px; }",
    ".cv .cv-wline .tk { position: absolute; bottom: 2px; font-size: 0.72rem; color: var(--text-dim, #c9a2a2); transform: translateX(-50%); pointer-events: none; white-space: nowrap; font-variant-numeric: tabular-nums; }",
    ".cv .cv-whead { position: absolute; top: -4px; bottom: -4px; width: 3px; margin-left: -1px; background: #fff; box-shadow: 0 0 0 1px #000; pointer-events: none; z-index: 3; }",
    ".cv .cv-wlive { position: absolute; top: 0; bottom: 0; right: 0; width: 6px; background: var(--rec, #ff4d4d); border-radius: 0 10px 10px 0; animation: cv-blink 1s steps(2) infinite; pointer-events: none; }",
    "@keyframes cv-blink { 50% { opacity: 0.3; } }",
    ".cv .cv-wbubble { position: absolute; top: -32px; transform: translateX(-50%); background: #000; color: #fff; border: 1px solid var(--accent, #e8b923); border-radius: 6px; padding: 2px 8px; font-size: 0.85rem; font-weight: 700; white-space: nowrap; pointer-events: none; z-index: 4; font-variant-numeric: tabular-nums; }",
    ".cv .cv-wnav button { min-height: 40px; }",
    ".cv .cv-wat { font-weight: 800; font-variant-numeric: tabular-nums; margin: 0 6px; }",
    ".cv .cv-wnav .cv-addcue { margin-left: auto; min-height: 44px; }"
  ].join("\n");

  function mount(root, opts) {
    opts = opts || {};
    if (!document.getElementById("cv-style")) {
      var st = document.createElement("style");
      st.id = "cv-style"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    root.classList.add("cv");
    root.innerHTML =
      '<video class="cv-video" controls playsinline></video>' +
      // ⏪ the whole recording - the one being recorded too: back to any moment, a cue added there
      '<div class="cv-whole" hidden>' +
      '<div class="cv-whole-head"><b data-i18n="rec.wholeTitle">⏪ The whole recording</b><span class="cv-whole-what dim"></span>' +
      '<span class="cv-zoom"><button data-z="600000" data-i18n="rec.zoom10">10 min</button><button data-z="3600000" data-i18n="rec.zoom60">1 h</button><button data-z="0" class="on" data-i18n="rec.zoomAll">All</button></span></div>' +
      '<div class="cv-wline" data-i18n-title="rec.wholeHint" title="Click or drag to go back to any moment"><div class="cv-wmarks"></div><div class="cv-wlive" hidden></div><div class="cv-whead" hidden></div><div class="cv-wbubble" hidden></div></div>' +
      '<div class="cv-row cv-wnav">' +
      '<button data-w="-60000" data-i18n="rec.back1m" title="Shift + ←">⏪ 1 min</button><button data-w="-10000" data-i18n="rec.back10" title="←">◀ 10 s</button>' +
      '<button data-w="10000" data-i18n="rec.fwd10" title="→">10 s ▶</button><button data-w="60000" data-i18n="rec.fwd1m" title="Shift + →">1 min ⏩</button>' +
      '<button data-w="live" class="cv-golive" data-i18n="rec.goLive">🔴 Live</button><span class="cv-wat"></span>' +
      '<button data-a="new" class="primary cv-addcue" data-i18n="rec.addCueHere">＋ Add a cue here (N)</button></div>' +
      '</div>' +
      // 🐢 slow motion, to look at a foul: the speed, and a frame at a time (keys , and .)
      '<div class="cv-speed"><span class="dim">🐢 Speed</span>' +
      '<button data-speed="1" class="on">1×</button><button data-speed="0.5">½×</button><button data-speed="0.25">¼×</button><button data-speed="0.125">⅛×</button>' +
      '<button data-a="frame-back" title="One frame back (,)">◀ 1 frame</button><button data-a="pp" title="Play / pause (space)">⏯</button><button data-a="frame-fwd" title="One frame on (.)">1 frame ▶</button>' +
      '<span class="cv-rate dim"></span></div>' +
      '<div class="cv-name"></div>' +
      '<div class="cv-edit" hidden>' +
      '  <div class="cv-line" title="Drag the yellow handles to set the start and the end; click to go there"><div class="cv-live" hidden></div><div class="cv-span"></div><div class="cv-handle" data-h="start"></div><div class="cv-handle" data-h="end"></div><div class="cv-head"></div></div>' +
      '  <div class="cv-marks">' +
      '    <span>Start</span><div class="cv-row"><span class="t cv-st"></span><button data-a="s-1">−1 s</button><button data-a="s+1">+1 s</button><button data-a="s-here" title="I">⟦ Set start here (I)</button></div>' +
      '    <span>End</span><div class="cv-row"><span class="t cv-et"></span><button data-a="e-1">−1 s</button><button data-a="e+1">+1 s</button><button data-a="e-here" title="O">Set end here (O) ⟧</button></div>' +
      '  </div>' +
      '  <div class="cv-row">' +
      '    <button data-a="play">▶ Play the cue</button><button data-a="from-start">⏮ Its start</button>' +
      '    <button data-a="save" class="primary">💾 Save</button><button data-a="revert">↺ Undo changes</button>' +
      '    <button data-a="export" class="primary">⬇ Export</button><button data-a="rename">✎ Name</button><button data-a="delete">🗑</button>' +
      '  </div>' +
      '</div>' +
      '<div class="cv-status"></div>' +
      '<div class="cv-row" style="margin-top:8px"><span class="dim cv-info"></span></div>' +
      '<input type="search" class="cv-search" placeholder="Find a cue - player, game, date...">' +
      '<div class="cv-group"><label><input type="checkbox" class="cv-pick-all"> All</label><span class="dim cv-picked">none checked</span>' +
      '<button class="cv-group-del" data-g="delete" disabled>🗑 Delete</button><button data-g="export" disabled title="Cut each one out and download it">⬇ Export</button>' +
      '<button data-g="keep" disabled title="Cut out and kept for good - not cleaned up, not deleted with its recording">📌 Save (keep forever)</button><button data-g="share" disabled title="This computer\'s share menu">📤 Share</button></div>' +
      '<table><tbody class="cv-rows"></tbody></table>' +
      (opts.sessions ? '<div class="cv-sessions"><b>Recordings</b><div class="cv-sess dim">Loading...</div></div>' +
        // 📁 each day's cues, as a folder of clips in the recordings folder
        '<div class="cv-sessions cv-folders-box"><b>📁 Daily cue folders</b> <span class="dim cv-folders-where"></span><div class="cv-folders dim">Loading...</div></div>' : "");

    var q = function (sel) { return root.querySelector(sel); };
    var video = q(".cv-video");
    var cues = [], sessions = [], ffmpeg = false, folder = "";
    var sel = null;   // the cue being viewed: a copy with the edits { id, startedAt, endedAt, name, ... }
    var saved = null; // as stored
    var play = null;  // { session, parts, index, stopAt }
    var dirty = false;
    var refreshTimer = null;
    var sure = null; // { what: "cue" | "session", id, until } - the 🗑 asking "Delete?"; a second click deletes

    function status(text) { q(".cv-status").textContent = text || ""; }

    // ---- the recordings: a moment (wall-clock ms) -> which file, how far in ----
    function partsOf(s) { return (s.parts || []).slice().sort(function (a, b) { return a.n - b.n; }); }
    function locate(t, sessionId) {
      var list = sessionId ? sessions.filter(function (s) { return s.id === sessionId; }).concat(sessions.filter(function (s) { return s.id !== sessionId; })) : sessions;
      for (var i = 0; i < list.length; i++) {
        var s = list[i], parts = partsOf(s);
        for (var j = 0; j < parts.length; j++) {
          var p = parts[j], end = p.endedAt || (j === parts.length - 1 ? Date.now() : parts[j + 1].startedAt);
          var from = j === 0 ? Math.min(p.startedAt, s.startedAt) - 1000 : p.startedAt;
          if (t >= from && t < end + (j === parts.length - 1 ? 2000 : 0)) return { session: s, parts: parts, index: j, offset: Math.max(0, (t - p.startedAt) / 1000) };
        }
      }
      // (a moment in a ⏸ pause: where the recording went on)
      for (i = 0; i < list.length; i++) {
        var ps = partsOf(list[i]);
        for (var k = 1; k < ps.length; k++) if (t >= (ps[k - 1].endedAt || ps[k].startedAt) && t < ps[k].startedAt) return { session: list[i], parts: ps, index: k, offset: 0 };
      }
      return null;
    }
    function sessionSpan(s) {
      var parts = partsOf(s), last = parts[parts.length - 1];
      // still recording (no end, not ⏸ paused, a file written in the last minute - not one never
      // stopped): up to now - its last file may have just ended, the next one not heard of yet
      var paused = !s.endedAt && !!s.pausedAt;
      var live = !s.endedAt && !paused && !(s.writtenAt && Date.now() - s.writtenAt > 60000);
      return { start: s.startedAt, end: s.endedAt || (live ? Date.now() : paused ? s.pausedAt : Math.max((last && last.endedAt) || 0, s.writtenAt || 0) || s.startedAt + 1000), live: live, paused: paused };
    }
    function seekTo(t, stopAt, autoplay) {
      var at = locate(t, sel && sel.session);
      if (!at) { status("That moment isn't in a recording (was it recording then?)"); return false; }
      var sameFile = play && play.session.id === at.session.id && play.index === at.index && video.src && video.readyState >= 1;
      play = { session: at.session, parts: at.parts, index: at.index, stopAt: stopAt || null };
      if (sameFile && !(play.parts[at.index].endedAt === null && at.offset > (video.duration || 0) - 1)) {
        try { video.currentTime = at.offset; } catch (e) {}
        if (autoplay) { var p0 = video.play(); if (p0 && p0.catch) p0.catch(function () {}); }
        return true;
      }
      load(at.index, at.offset, autoplay);
      return true;
    }
    // 🐢 the speed (kept for every file played - a new src would put it back to 1)
    var rate = 1, FRAME = 1 / 30;
    function setRate(r) {
      rate = r;
      video.defaultPlaybackRate = r;
      video.playbackRate = r;
      root.querySelectorAll(".cv-speed button[data-speed]").forEach(function (b) { b.classList.toggle("on", +b.getAttribute("data-speed") === r); });
      q(".cv-rate").textContent = r === 1 ? "" : "slow motion " + (r === 0.5 ? "½" : r === 0.25 ? "¼" : "⅛") + "×";
    }
    function stepFrame(dir) {
      if (!video.src) return;
      video.pause();
      try { video.currentTime = Math.max(0, video.currentTime + dir * FRAME); } catch (e) {}
    }
    root.querySelector(".cv-speed").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-speed")) { setRate(+b.getAttribute("data-speed")); return; }
      var a = b.getAttribute("data-a");
      if (a === "frame-back") stepFrame(-1);
      else if (a === "frame-fwd") stepFrame(1);
      else if (a === "pp" && video.src) { if (video.paused) { var go = video.play(); if (go && go.catch) go.catch(function () {}); } else video.pause(); }
    });
    // , and . a frame back / on; s: slower (1 -> ½ -> ¼ -> ⅛ -> 1) - unless typing
    document.addEventListener("keydown", function (e) {
      if (!root.isConnected || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (opts.keysWhen && !opts.keysWhen()) return;
      if (e.key === ",") { e.preventDefault(); stepFrame(-1); }
      else if (e.key === ".") { e.preventDefault(); stepFrame(1); }
      else if (e.key === "s" || e.key === "S") { e.preventDefault(); setRate(rate === 1 ? 0.5 : rate === 0.5 ? 0.25 : rate === 0.25 ? 0.125 : 1); }
    });
    function load(index, offset, autoplay) {
      var p = play.parts[index];
      play.index = index;
      // (the file still being recorded: a copy of it as it is now, to jump around in - asked
      // fresh each time, so it reaches the latest seconds)
      video.src = "/api/rec/" + encodeURIComponent(play.session.id) + "/file/" + encodeURIComponent(p.file) + (p.endedAt ? "" : "?live=" + Date.now());
      video.onloadedmetadata = function () {
        video.onloadedmetadata = null;
        video.playbackRate = rate;
        try { video.currentTime = Math.max(0, offset); } catch (e) {}
        if (autoplay) { var go = video.play(); if (go && go.catch) go.catch(function () {}); }
      };
    }
    function wallTime() {
      if (!play || !play.parts[play.index]) return null;
      return play.parts[play.index].startedAt + video.currentTime * 1000;
    }
    video.addEventListener("timeupdate", function () {
      if (play && play.stopAt && wallTime() >= play.stopAt) { video.pause(); play.stopAt = null; }
      renderLine();
      renderSessionHeads();
      renderWhole();
    });
    // a file re-indexed (made quick to jump in) while it played: back to the same moment
    var lastRetryAt = 0;
    video.addEventListener("error", function () {
      if (!play || !play.parts[play.index] || Date.now() - lastRetryAt < 5000) return;
      var t = play.parts[play.index].startedAt + (video.currentTime || 0) * 1000;
      lastRetryAt = Date.now();
      setTimeout(function () { refresh().then(function () { seekTo(t, play && play.stopAt, true); }); }, 800);
    });
    video.addEventListener("ended", function () {
      if (!play) return;
      var cur = sessions.filter(function (x) { return x.id === play.session.id; })[0] || play.session;
      var lastKnown = play.index + 1 >= play.parts.length;
      // the newest recorded (the file still being recorded, as it was a moment ago): stops there
      if (!play.parts[play.index].endedAt) { status(tr("rec.atLatest", "⏺ That's the latest recorded - 🔴 Live for the newest seconds.")); return; }
      // (the last file heard of ended while it records: on into the next one)
      if (lastKnown && !play.stopAt && sessionSpan(cur).live) {
        var t = wallTime() + 200, was = play;
        refresh().then(function () {
          if (play !== was) return;
          var fresh = sessions.filter(function (x) { return x.id === was.session.id; })[0];
          if (fresh && partsOf(fresh).length > was.parts.length) seekTo(t, null, true);
          else status(tr("rec.atLatest", "⏺ That's the latest recorded - 🔴 Live for the newest seconds."));
        });
        return;
      }
      if (lastKnown) return;
      if (play.stopAt && play.parts[play.index + 1].startedAt >= play.stopAt) return;
      load(play.index + 1, 0, true);
    });

    // ---- ⏪ the whole recording: the one being played (or recorded), start to now ----
    var zoomMs = 0, wdrag = null;
    function wholeSession() {
      if (play) { var cur = sessions.filter(function (x) { return x.id === play.session.id; })[0]; if (cur) return cur; }
      return sessions.filter(function (x) { var sp = sessionSpan(x); return sp.live || sp.paused; })[0] || sessions[0] || null;
    }
    function playingIn(s) { return play && play.session.id === s.id ? wallTime() : null; }
    function wholeWindow(s) {
      if (wdrag) return wdrag.w;
      var sp = sessionSpan(s), end = Math.max(sp.end, sp.start + 1000);
      if (!zoomMs || end - sp.start <= zoomMs) return { s: sp.start, e: end };
      var t = playingIn(s), from;
      if (t === null || t > end - zoomMs * 0.75) from = end - zoomMs;
      else from = Math.min(end - zoomMs, Math.max(sp.start, t - zoomMs / 2));
      return { s: Math.max(sp.start, from), e: Math.max(sp.start, from) + zoomMs };
    }
    function agoText(s, t) {
      var sp = sessionSpan(s);
      return clockOf(t).slice(0, 8) + " · " + (sp.live ? tr("rec.ago", "{{time}} ago", { time: len(Date.now() - t) }) : tr("rec.in", "{{time}} in", { time: len(t - sp.start) }));
    }
    function renderWhole() {
      var box = q(".cv-whole"), s = wholeSession();
      box.hidden = !s;
      if (!s) return;
      var sp = sessionSpan(s), w = wholeWindow(s), line = q(".cv-wline");
      var p = function (t) { return Math.max(0, Math.min(100, (t - w.s) / (w.e - w.s) * 100)); };
      q(".cv-whole-what").innerHTML = esc(s.id) + " · " + (sp.live ? '<span class="on-air">' + esc(tr("rec.wholeLive", "● recording · {{time}} so far", { time: len(sp.end - sp.start) })) + "</span>" :
        sp.paused ? '<span class="paused">' + esc(tr("rec.wholePaused", "⏸ paused · {{time}} so far", { time: len(sp.end - sp.start) })) + "</span>" : esc(len(sp.end - sp.start)));
      // (the ⏸ pauses: gaps between its files)
      var ps = partsOf(s), gaps = "";
      for (var g = 1; g < ps.length; g++) {
        var from = ps[g - 1].endedAt, to = ps[g].startedAt;
        if (from && to - from > 3000 && to >= w.s && from <= w.e) gaps += '<div class="gap" title="' + esc(tr("rec.pauseGap", "⏸ paused")) + '" style="left:' + p(from) + "%;width:" + (p(to) - p(from)) + '%"></div>';
      }
      // the cues (gold) and the games' starts (blue), and the time along it
      var marks = cues.filter(function (c) { return (c.session ? c.session === s.id : c.startedAt >= sp.start && c.startedAt <= sp.end) && (c.endedAt || sp.end) >= w.s && c.startedAt <= w.e; }).map(function (c) {
        if (c.kind === "game") return '<div class="c g" title="' + esc(c.name || "Game") + '" style="left:' + p(c.startedAt) + '%"></div>';
        return '<div class="c" title="' + esc(c.name || nameFor(c)) + '" style="left:' + p(c.startedAt) + "%;width:" + Math.max(0.3, p(c.endedAt || sp.end) - p(c.startedAt)) + '%"></div>';
      }).join("");
      var span = w.e - w.s, steps = [10000, 30000, 60000, 300000, 600000, 900000, 1800000, 3600000, 7200000], step = steps[steps.length - 1];
      for (var i = 0; i < steps.length; i++) if (span / steps[i] <= 10) { step = steps[i]; break; }
      var ticks = "";
      for (var k = Math.ceil(w.s / step) * step; k <= w.e; k += step) {
        if (p(k) < 3 || p(k) > 97) continue;
        ticks += '<div class="tk" style="left:' + p(k) + '%">' + clockOf(k).slice(0, step < 60000 ? 8 : 5) + "</div>";
      }
      q(".cv-wmarks").innerHTML = gaps + marks + ticks;
      q(".cv-wlive").hidden = !(sp.live && w.e >= sp.end - 1000);
      var t = wdrag ? wdrag.t : playingIn(s), head = q(".cv-whead");
      head.hidden = t === null || t < w.s || t > w.e;
      if (!head.hidden) head.style.left = p(t) + "%";
      q(".cv-wat").textContent = t !== null ? "▶ " + agoText(s, t) : tr("rec.notPlaying", "Click or drag the line to go back to any moment");
      q(".cv-golive").hidden = !sp.live;
      root.querySelectorAll(".cv-zoom button").forEach(function (b) { b.classList.toggle("on", +b.getAttribute("data-z") === zoomMs); });
      line.setAttribute("data-s", w.s);
      line.setAttribute("data-e", w.e);
    }
    // (the recording grows: its line moves on every second)
    setInterval(function () { if (root.isConnected && !wdrag && sessions.some(function (x) { return sessionSpan(x).live; })) renderWhole(); }, 1000);
    // ±10 s, ±1 min from the playhead (from now when nothing plays), 🔴 Live
    function wholeStep(delta) {
      var s = wholeSession();
      if (!s) return;
      var sp = sessionSpan(s), from = playingIn(s), playing = !play || !video.paused;
      if (delta === "live") { seekTo(Math.max(sp.start, sp.end - 8000), null, true); return; }
      if (from === null) from = sp.end;
      seekTo(Math.max(sp.start, Math.min(sp.end - 1500, from + delta)), null, playing);
      renderWhole();
    }
    root.querySelector(".cv-whole").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-z")) { zoomMs = +b.getAttribute("data-z"); renderWhole(); return; }
      if (b.hasAttribute("data-w")) { var w = b.getAttribute("data-w"); wholeStep(w === "live" ? "live" : +w); }
    });
    // drag along it: the picture follows; let go - it plays from there (if it was playing)
    (function () {
      var line = q(".cv-wline"), bubble = q(".cv-wbubble"), lastSeek = 0;
      function timeAt(e, w) { var r = line.getBoundingClientRect(); return w.s + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (w.e - w.s); }
      function showBubble(s, w, t) { bubble.hidden = false; bubble.textContent = agoText(s, t); bubble.style.left = Math.max(6, Math.min(94, (t - w.s) / (w.e - w.s) * 100)) + "%"; }
      line.addEventListener("pointerdown", function (e) {
        var s = wholeSession();
        if (!s) return;
        e.preventDefault();
        try { line.setPointerCapture(e.pointerId); } catch (err) {}
        var w = wholeWindow(s), t = timeAt(e, w);
        wdrag = { w: w, s: s, t: t, playing: !play || !video.paused };
        showBubble(s, w, t);
        renderWhole();
      });
      line.addEventListener("pointermove", function (e) {
        var s = wdrag ? wdrag.s : wholeSession();
        if (!s) return;
        var w = wdrag ? wdrag.w : wholeWindow(s), t = timeAt(e, w);
        showBubble(s, w, t);
        if (!wdrag) return;
        wdrag.t = t;
        renderWhole();
        if (Date.now() - lastSeek > 250) { lastSeek = Date.now(); seekTo(Math.min(t, sessionSpan(s).end - 1500), null, false); }
      });
      line.addEventListener("pointerleave", function () { if (!wdrag) bubble.hidden = true; });
      function done() {
        if (!wdrag) return;
        var d = wdrag;
        wdrag = null;
        bubble.hidden = true;
        seekTo(Math.max(sessionSpan(d.s).start, Math.min(d.t, sessionSpan(d.s).end - 1500)), null, d.playing);
        renderWhole();
      }
      line.addEventListener("pointerup", done);
      line.addEventListener("pointercancel", done);
    })();

    // ---- the cue being viewed: its timeline and marks ----
    function windowOf() {
      var s = sel.startedAt - CONTEXT_MS, e = (sel.endedAt || Date.now()) + CONTEXT_MS;
      var sess = sessions.filter(function (x) { return x.id === sel.session; })[0] || (locate(sel.startedAt) || {}).session;
      if (sess) { var sp = sessionSpan(sess); s = Math.max(s, sp.start); e = Math.min(e, sp.live ? Date.now() : sp.end); }
      return { s: s, e: Math.max(e, s + 1000) };
    }
    function pct(t, w) { return Math.max(0, Math.min(100, (t - w.s) / (w.e - w.s) * 100)); }
    function renderLine() {
      if (!sel) return;
      var w = windowOf(), line = q(".cv-line"), end = sel.endedAt || Date.now();
      q(".cv-span").style.left = pct(sel.startedAt, w) + "%";
      q(".cv-span").style.width = (pct(end, w) - pct(sel.startedAt, w)) + "%";
      q('.cv-handle[data-h="start"]').style.left = pct(sel.startedAt, w) + "%";
      q('.cv-handle[data-h="end"]').style.left = pct(end, w) + "%";
      q('.cv-handle[data-h="end"]').hidden = !sel.endedAt;
      var t = wallTime(), head = q(".cv-head");
      head.hidden = t === null || t < w.s || t > w.e;
      if (!head.hidden) head.style.left = pct(t, w) + "%";
      var sess = sessions.filter(function (x) { return x.id === sel.session; })[0];
      q(".cv-live").hidden = !(sess && !sess.endedAt);
      if (!line.dataset.ticks || line.dataset.ticks !== w.s + "-" + w.e) {
        line.dataset.ticks = w.s + "-" + w.e;
        line.querySelectorAll(".cv-tick").forEach(function (x) { x.remove(); });
        var step = (w.e - w.s) > 180000 ? 60000 : (w.e - w.s) > 60000 ? 15000 : 5000;
        for (var k = Math.ceil(w.s / step) * step; k <= w.e; k += step) {
          var tk = document.createElement("div");
          tk.className = "cv-tick";
          tk.style.left = pct(k, w) + "%";
          tk.textContent = clockOf(k).slice(0, 8);
          line.appendChild(tk);
        }
      }
      q(".cv-st").textContent = clockOf(sel.startedAt);
      q(".cv-et").textContent = sel.endedAt ? clockOf(sel.endedAt) + "  (" + len(sel.endedAt - sel.startedAt) + ")" : "still marking...";
      renderName();
    }
    function renderName() {
      var box = q(".cv-name");
      if (box.querySelector("input")) return;
      box.innerHTML = sel ? esc(sel.name || nameFor(sel)) + (dirty ? ' <span class="cv-dirty">· not saved</span>' : "") : "";
    }
    function setMark(which, t) {
      if (!sel) return;
      var w = windowOf();
      t = Math.round(Math.max(w.s, Math.min(w.e, t)));
      // (a 🎱 game mark is a moment: it moves whole, its name kept)
      if (sel.kind === "game") {
        sel.startedAt = sel.endedAt = sel.markedAt = t;
        sel.duration = 0;
        dirty = true;
        renderLine();
        renderButtons();
        return;
      }
      if (which === "start") sel.startedAt = Math.min(t, (sel.endedAt || Date.now()) - 1000);
      else sel.endedAt = Math.max(t, sel.startedAt + 1000);
      if (sel.endedAt) sel.duration = sel.endedAt - sel.startedAt;
      if (!sel.customName) sel.name = nameFor(sel);
      dirty = true;
      renderLine();
      renderButtons();
    }
    function renderButtons() {
      var has = !!sel, finished = has && !!sel.endedAt;
      root.querySelectorAll(".cv-edit button").forEach(function (b) { b.disabled = !has; });
      q('[data-a="save"]').disabled = !dirty;
      q('[data-a="revert"]').disabled = !dirty;
      // (a 🎱 game mark is a moment - no clip of it)
      q('[data-a="export"]').disabled = !finished || !ffmpeg || sel.kind === "game";
      q('[data-a="export"]').title = ffmpeg ? "Save, cut it out and download it" : "Needs ffmpeg on the computer";
      ["e-1", "e+1", "e-here"].forEach(function (a) { q('[data-a="' + a + '"]').disabled = !finished; });
    }
    function select(id, autoplay) {
      var c = cues.filter(function (x) { return x.id === id; })[0];
      if (!c) return;
      if (dirty && sel && sel.id !== id) { save().then(function () { select(id, autoplay); }).catch(function (e) { status("Couldn't save the changes: " + e.message); }); return; }
      saved = c;
      sel = JSON.parse(JSON.stringify(c));
      dirty = false;
      q(".cv-edit").hidden = false;
      seekTo(sel.startedAt, sel.endedAt || null, autoplay !== false);
      renderLine();
      renderButtons();
      renderRows();
      status(sel.endedAt ? "" : "Still being marked - say \"finish\" or press F on the recording page.");
    }
    function save() {
      if (!sel || !dirty) return Promise.resolve(sel);
      var patch = { startedAt: sel.startedAt, endedAt: sel.endedAt || null, duration: sel.duration || null, name: sel.name || nameFor(sel), customName: !!sel.customName };
      return api("/api/rec/cues/" + sel.id, patch, "PATCH").then(function (c) {
        Object.assign(saved, c);
        sel = JSON.parse(JSON.stringify(saved));
        dirty = false;
        status("Saved: " + sel.name);
        renderLine(); renderButtons(); renderRows();
        return sel;
      });
    }
    function exportClip() {
      if (!sel || !sel.endedAt) return;
      var btn = q('[data-a="export"]');
      btn.disabled = true;
      status("Cutting the clip...");
      return save().then(function () {
        return api("/api/rec/cues/" + sel.id + "/clip", {}, "POST");
      }).then(function (r) {
        saved.clip = sel.clip = r.file;
        var a = document.createElement("a");
        a.href = "/api/rec/clips/" + encodeURIComponent(r.file);
        a.download = r.file;
        document.body.appendChild(a); a.click(); a.remove();
        status("Exported: " + r.file + " - downloaded, and kept in " + r.folder);
        renderRows();
        return r;
      }).catch(function (e) { status("Couldn't export: " + e.message); })
        .then(function (r) { renderButtons(); return r; });
    }

    // the timeline: click to go there, drag a handle to move that mark
    (function () {
      var line = q(".cv-line"), drag = null;
      function timeAt(e) { var r = line.getBoundingClientRect(), w = windowOf(); return w.s + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (w.e - w.s); }
      line.addEventListener("pointerdown", function (e) {
        if (!sel) return;
        e.preventDefault();
        var h = e.target.closest(".cv-handle");
        line.setPointerCapture(e.pointerId);
        drag = h ? h.getAttribute("data-h") : "seek";
        if (drag === "seek") seekTo(timeAt(e), null, false);
      });
      line.addEventListener("pointermove", function (e) {
        if (!drag || !sel) return;
        if (drag === "seek") seekTo(timeAt(e), null, false);
        else { setMark(drag, timeAt(e)); seekTo(drag === "start" ? sel.startedAt : sel.endedAt, null, false); }
      });
      ["pointerup", "pointercancel"].forEach(function (t) { line.addEventListener(t, function () { drag = null; }); });
    })();

    root.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b || !root.contains(b)) return;
      var a = b.getAttribute("data-a");
      if (!a) return;
      var here = wallTime();
      if (a === "s-1") setMark("start", sel.startedAt - 1000);
      if (a === "s+1") setMark("start", sel.startedAt + 1000);
      if (a === "e-1") setMark("end", sel.endedAt - 1000);
      if (a === "e+1") setMark("end", sel.endedAt + 1000);
      if (a === "s-here" && here !== null) setMark("start", here);
      if (a === "e-here" && here !== null) setMark("end", here);
      if (a === "play") seekTo(sel.startedAt, sel.endedAt || null, true);
      if (a === "from-start") seekTo(sel.startedAt, null, false);
      if (a === "save") save().catch(function (err) { status("Couldn't save: " + err.message); });
      if (a === "revert") { sel = JSON.parse(JSON.stringify(saved)); dirty = false; renderLine(); renderButtons(); status("Back as it was."); }
      if (a === "export") exportClip();
      if (a === "rename") renameBox();
      if (a === "delete" && sel) deleteCue(sel.id);
      if (a === "new") newCueHere();
    });
    function renameBox() {
      var box = q(".cv-name"), input = document.createElement("input");
      input.value = sel.name || nameFor(sel);
      box.innerHTML = ""; box.appendChild(input); input.focus(); input.select();
      var done = function (keep) {
        if (!input.isConnected) return;
        var v = input.value.trim();
        box.innerHTML = "";
        if (keep && v && v !== sel.name) { sel.name = v; sel.customName = true; dirty = true; renderButtons(); }
        renderName();
      };
      input.addEventListener("keydown", function (k) { if (k.key === "Enter") done(true); if (k.key === "Escape") done(false); k.stopPropagation(); });
      input.addEventListener("blur", function () { done(true); });
    }
    // ---- deleting: a first click asks ("Delete?", 4 s), a second deletes ----
    function askSure(what, id) {
      if (sure && sure.what === what && sure.id === id && Date.now() < sure.until) { sure = null; return true; }
      sure = { what: what, id: id, until: Date.now() + 4000 };
      setTimeout(function () { if (sure && Date.now() >= sure.until) { sure = null; renderSure(); } }, 4100);
      renderSure();
      return false;
    }
    function renderSure() {
      root.querySelectorAll("button.cv-del").forEach(function (b) {
        var on = !!sure && b.getAttribute("data-del") === sure.what && b.getAttribute("data-id") === sure.id;
        b.classList.toggle("sure", on);
        var kind = b.getAttribute("data-del");
        if (!kind) return;
        b.textContent = on ? (sure.what === "session" ? "Delete this recording?" : sure.what === "folder" ? "Delete this folder?" : "Delete?") : (kind === "session" || kind === "folder" ? "🗑 Delete" : "🗑");
      });
      // (the checked cues' 🗑 asks too)
      var gdel = q(".cv-group-del");
      if (gdel) {
        var gon = !!sure && sure.what === "group";
        gdel.classList.toggle("sure", gon);
        var n = Object.keys(picked).length;
        gdel.textContent = gon ? "Delete " + n + " cue" + (n === 1 ? "" : "s") + "?" : "🗑 Delete";
      }
      var own = q('.cv-edit [data-a="delete"]'), mine = !!sure && sure.what === "cue" && !!sel && sure.id === sel.id;
      own.textContent = mine ? "Delete?" : "🗑";
      own.style.cssText = mine ? "background:#b3261e;border-color:#b3261e;color:#fff;font-weight:800" : "";
    }
    function deleteCue(id) {
      if (!askSure("cue", id)) return;
      api("/api/rec/cues/" + encodeURIComponent(id), undefined, "DELETE").then(function () {
        var c = cues.filter(function (x) { return x.id === id; })[0];
        cues = cues.filter(function (x) { return x.id !== id; });
        if (sel && sel.id === id) { sel = saved = null; dirty = false; q(".cv-edit").hidden = true; renderName(); }
        renderRows(); renderSessions();
        status("Deleted: " + (c ? c.name || nameFor(c) : "the cue"));
        if (opts.onDelete) opts.onDelete(id);
      }).catch(function (e) { status("Couldn't delete it: " + e.message); });
    }
    function deleteSession(id) {
      if (!askSure("session", id)) return;
      status("Moving the recording to the Trash...");
      api("/api/rec/sessions/" + encodeURIComponent(id), undefined, "DELETE").then(function (r) {
        if (play && play.session.id === id) { video.pause(); video.removeAttribute("src"); video.load(); play = null; }
        if (sel && sel.session === id) { sel = saved = null; dirty = false; q(".cv-edit").hidden = true; renderName(); }
        status("Recording " + id + " is in the Trash" + (r.cues ? " (with its " + r.cues + " cue" + (r.cues === 1 ? "" : "s") + ")" : "") + " - the exported clips are kept.");
        return refresh();
      }).catch(function (e) { status("Couldn't delete it: " + e.message); });
    }
    // a cue of your own: 20 s from the playhead (or the last 20 s recorded), then set it right
    function newCueHere() {
      var here = wallTime(), live = sessions.filter(function (s) { return sessionSpan(s).live; })[0];
      var start = here !== null ? here : live ? Date.now() - 20000 : null;
      if (start === null) { status(tr("rec.playFirst", "Play a recording first (click or drag its line), then ＋ Add a cue here.")); return; }
      var at = locate(start);
      if (!at) { status("That moment isn't in a recording."); return; }
      var end = Math.min(start + 20000, at.session.endedAt || Date.now());
      // (the game being played then: the last 🎱 game mark before it)
      var game = cues.filter(function (x) { return x.kind === "game" && x.startedAt <= start && (!x.session || x.session === at.session.id); }).sort(function (a, b) { return b.startedAt - a.startedAt; })[0] || {};
      var c = { startedAt: Math.round(start), markedAt: Math.round(start), endedAt: Math.round(end), duration: Math.round(end - start), player: "", matchup: game.matchup || "", gameType: game.gameType || "", gameLabel: game.gameLabel || "", position: game.position || "", source: "by hand", session: at.session.id };
      c.name = nameFor(c);
      api("/api/rec/cues", c).then(function (savedCue) {
        cues.unshift(savedCue);
        renderRows();
        renderWhole();
        select(savedCue.id, false);
        status(tr("rec.cueAdded", "＋ A cue at {{time}} - set its start and end (drag the yellow handles, or I / O), then 💾 Save.", { time: clockOf(c.startedAt).slice(0, 8) }));
      }).catch(function (err) { status("Couldn't add the cue: " + err.message); });
    }
    // ⏪ N: a cue here; ← → 10 s back / on (Shift: a minute) while a recording plays - unless typing
    document.addEventListener("keydown", function (e) {
      if (!root.isConnected || !sessions.length || (e.target && /INPUT|SELECT|TEXTAREA|VIDEO/.test(e.target.tagName)) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (opts.keysWhen && !opts.keysWhen()) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); newCueHere(); }
      else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && play) { e.preventDefault(); wholeStep((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 60000 : 10000)); }
    });
    // I / O (start / end at the playhead) - unless typing
    document.addEventListener("keydown", function (e) {
      if (!sel || !root.isConnected || (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName))) return;
      if (opts.keysWhen && !opts.keysWhen()) return;
      var here = wallTime();
      if ((e.key === "i" || e.key === "I") && here !== null) { e.preventDefault(); setMark("start", here); }
      else if ((e.key === "o" || e.key === "O") && here !== null && sel.endedAt) { e.preventDefault(); setMark("end", here); }
    });

    // ---- the list ----
    function renderRows() {
      var text = (q(".cv-search").value || "").trim().toLowerCase();
      var list = cues.filter(function (c) { return !text || ((c.name || nameFor(c)) + " " + when(c.startedAt)).toLowerCase().indexOf(text) !== -1; });
      var rows = q(".cv-rows");
      if (!list.length) { rows.innerHTML = '<tr><td class="dim">' + (cues.length ? "No cue matches." : "No cues yet - ⭐ Mark during the recording (or say \"mark\").") + "</td></tr>"; return; }
      rows.innerHTML = list.slice(0, opts.compact ? 12 : 1000).map(function (c) {
        var game = c.kind === "game";
        return '<tr data-id="' + esc(c.id) + '" class="' + (sel && sel.id === c.id ? "sel " : "") + (game ? "game " : "") + (c.endedAt ? "" : "open") + '"><td class="pk"><input type="checkbox" class="cv-pick" data-id="' + esc(c.id) + '"' + (picked[c.id] ? " checked" : "") + ' aria-label="Check this cue"></td><td class="n">' + esc(c.name || nameFor(c) + (c.endedAt ? "" : " (still marking)")) + (c.keep ? ' <span class="kept" title="Kept for good">📌</span>' : "") + '</td><td class="dim" style="white-space:nowrap">' + esc(when(c.startedAt)) + '</td><td class="dim">' + (game ? "▶" : c.endedAt ? esc(len(c.endedAt - c.startedAt)) : "...") + "</td><td>" +
          (c.clip ? '<a class="cv-btn" href="/api/rec/clips/' + encodeURIComponent(c.clip) + '" download="' + esc(c.clip) + '" title="The exported clip">⬇</a>' : "") + "</td>" +
          '<td class="x"><button class="cv-del" data-del="cue" data-id="' + esc(c.id) + '" title="Delete this cue (the recording stays)">🗑</button></td></tr>';
      }).join("");
      renderSure();
    }
    q(".cv-rows").addEventListener("click", function (e) {
      var del = e.target.closest("button.cv-del");
      if (del) { deleteCue(del.getAttribute("data-id")); return; }
      if (e.target.closest("a")) return;
      if (e.target.closest("td.pk")) return; // (the checkbox: its own)
      var tr = e.target.closest("tr[data-id]");
      if (tr) select(tr.getAttribute("data-id"));
    });
    q(".cv-search").addEventListener("input", renderRows);

    // ---- ☑ the checked cues, together: delete, export, save (keep forever), share ----
    var picked = {}; // id -> true
    var shareReady = null; // the files made for 📤 Share - a second click shares them (from the click itself)
    function pickedCues() { return cues.filter(function (c) { return picked[c.id]; }); }
    function renderGroup() {
      var list = pickedCues(), clips = list.filter(function (c) { return c.kind !== "game" && c.endedAt; });
      q(".cv-picked").textContent = list.length ? list.length + " checked" : "none checked";
      root.querySelectorAll(".cv-group button").forEach(function (b) {
        var g = b.getAttribute("data-g");
        b.disabled = !list.length || (g !== "delete" && !clips.length) || ((g === "export" || g === "keep" || g === "share") && !ffmpeg);
      });
      var all = q(".cv-pick-all");
      all.checked = !!cues.length && cues.every(function (c) { return picked[c.id]; });
      if (!shareReady) { var sb = q('.cv-group [data-g="share"]'); sb.textContent = "📤 Share"; sb.classList.remove("ready"); }
    }
    q(".cv-rows").addEventListener("change", function (e) {
      var box = e.target.closest("input.cv-pick");
      if (!box) return;
      if (box.checked) picked[box.getAttribute("data-id")] = true;
      else delete picked[box.getAttribute("data-id")];
      shareReady = null;
      renderGroup();
    });
    q(".cv-pick-all").addEventListener("change", function (e) {
      picked = {};
      if (e.target.checked) cues.forEach(function (c) { picked[c.id] = true; });
      shareReady = null;
      renderRows();
      renderGroup();
    });
    // each checked clip cut out (kept in Clips/ on the computer) -> [{ cue, file }]
    function cutPicked() {
      var list = pickedCues().filter(function (c) { return c.kind !== "game" && c.endedAt; }), out = [], i = 0;
      return new Promise(function (resolve, reject) {
        (function next() {
          if (i >= list.length) return resolve(out);
          var c = list[i++];
          status("Cutting " + i + " of " + list.length + "...");
          (c.clip ? Promise.resolve({ file: c.clip }) : api("/api/rec/cues/" + encodeURIComponent(c.id) + "/clip", {}, "POST")).then(function (r) {
            c.clip = r.file;
            out.push({ cue: c, file: r.file });
            next();
          }, reject);
        })();
      });
    }
    function downloadClip(file) {
      var a = document.createElement("a");
      a.href = "/api/rec/clips/" + encodeURIComponent(file);
      a.download = file;
      document.body.appendChild(a); a.click(); a.remove();
    }
    root.querySelector(".cv-group").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-g]");
      if (!b || b.disabled) return;
      var g = b.getAttribute("data-g");
      if (g === "delete") {
        if (!askSure("group", "picked")) return;
        var ids = Object.keys(picked);
        Promise.all(ids.map(function (id) { return api("/api/rec/cues/" + encodeURIComponent(id), undefined, "DELETE").catch(function () {}); })).then(function () {
          if (sel && picked[sel.id]) { sel = saved = null; dirty = false; q(".cv-edit").hidden = true; renderName(); }
          picked = {};
          status("Deleted " + ids.length + " cue" + (ids.length === 1 ? "" : "s") + ".");
          return refresh();
        });
        return;
      }
      if (g === "export") {
        cutPicked().then(function (made) {
          // (one after the other - the browser may ask once to allow several downloads)
          made.forEach(function (m, k) { setTimeout(function () { downloadClip(m.file); }, k * 400); });
          status("Exported " + made.length + " clip" + (made.length === 1 ? "" : "s") + " - downloaded, and kept in Clips on the computer.");
          renderRows();
        }).catch(function (err) { status("Couldn't export: " + err.message); });
        return;
      }
      if (g === "keep") {
        cutPicked().then(function (made) {
          return Promise.all(made.map(function (m) { return api("/api/rec/cues/" + encodeURIComponent(m.cue.id), { keep: true }, "PATCH"); })).then(function () {
            status("📌 Kept for good: " + made.length + " clip" + (made.length === 1 ? "" : "s") + " (in Clips) - not cleaned up, not deleted with their recording.");
            return refresh();
          });
        }).catch(function (err) { status("Couldn't keep them: " + err.message); });
        return;
      }
      if (g === "share") {
        // a second click: the share menu, straight from the click
        if (shareReady) {
          var files = shareReady;
          shareReady = null;
          renderGroup();
          if (navigator.canShare && navigator.share && navigator.canShare({ files: files })) navigator.share({ files: files }).catch(function () {});
          else { files.forEach(function (f, k) { setTimeout(function () { downloadClip(f.name); }, k * 400); }); status("This browser can't share files - downloaded instead."); }
          return;
        }
        b.disabled = true;
        cutPicked().then(function (made) {
          return Promise.all(made.map(function (m) {
            return fetch("/api/rec/clips/" + encodeURIComponent(m.file)).then(function (r) { return r.blob(); }).then(function (blob) { return new File([blob], m.file, { type: "video/mp4" }); });
          }));
        }).then(function (files) {
          shareReady = files;
          b.disabled = false;
          b.textContent = "📤 Share now (" + files.length + ")";
          b.classList.add("ready");
          status("Ready - 📤 Share now opens the share menu.");
        }).catch(function (err) { b.disabled = false; status("Couldn't get them ready: " + err.message); });
      }
    });

    // ---- the recordings (cues.html): a timeline each, click to play from there ----
    function renderSessions() {
      if (!opts.sessions) return;
      var box = q(".cv-sess");
      if (!sessions.length) { box.innerHTML = "No recordings yet. They're saved in " + esc(folder); return; }
      box.innerHTML = sessions.map(function (s) {
        var sp = sessionSpan(s), total = sp.end - sp.start, n = (s.parts || []).length;
        var p = function (t) { return Math.max(0, Math.min(100, (t - sp.start) / total * 100)); };
        var marks = cues.filter(function (c) { return c.startedAt >= sp.start - 2000 && c.startedAt <= sp.end; }).map(function (c) {
          if (c.kind === "game") return '<div class="c g" title="' + esc(c.name || "Game") + '" style="left:' + p(c.startedAt) + '%"></div>';
          return '<div class="c" title="' + esc(c.name || nameFor(c)) + '" style="left:' + p(c.startedAt) + "%;width:" + Math.max(0.3, p(c.endedAt || sp.end) - p(c.startedAt)) + '%"></div>';
        }).join("");
        return '<div class="cv-session"><div class="cv-session-head"><b>' + esc(s.id) + "</b> " + (sp.live ? '<span style="color:#ff4d4d">● recording</span> ' : sp.paused ? '<span style="color:var(--accent, #e8b923)">' + esc(tr("rec.pauseGap", "⏸ paused")) + "</span> " : "") + '<span class="dim">' + esc(len(total)) + " · " + n + " file" + (n === 1 ? "" : "s") + "</span>" +
          '<button class="cv-del" data-del="session" data-id="' + esc(s.id) + '"' + (sp.live || sp.paused ? ' disabled title="Stop the recording first"' : ' title="Move this recording to the Trash, with its cues (exported clips are kept)"') + ">🗑 Delete</button></div>" +
          '<div class="cv-tl" data-s="' + sp.start + '" data-e="' + sp.end + '">' + marks + '<div class="h" hidden></div></div></div>';
      }).join("");
      renderSure();
      renderSessionHeads();
    }
    // ---- 📁 the daily cue folders: "Pool Master Cues 2026-10-29 Jo - Kim - Lee" ----
    var cueFolders = { days: [], folder: "", today: "" };
    function renderFolders() {
      if (!opts.sessions) return;
      var box = q(".cv-folders");
      q(".cv-folders-where").textContent = cueFolders.folder ? "in " + cueFolders.folder + " - each day made once it's over" : "";
      if (!cueFolders.days.length) { box.innerHTML = "No cues yet."; return; }
      box.innerHTML = cueFolders.days.map(function (d) {
        var count = d.cues + " cue" + (d.cues === 1 ? "" : "s");
        var state = d.exists ? d.files + " clip" + (d.files === 1 ? "" : "s") + " of " + count : d.deleted ? "deleted (in the Trash) - " + count : (d.date === cueFolders.today ? "today - not made yet" : "not made yet") + " - " + count;
        return '<div class="cv-session cv-folder" data-date="' + esc(d.date) + '"><div class="cv-session-head"><b>' + esc(d.name) + '</b> <span class="dim">' + esc(state) + "</span>" +
          '<button class="cv-folder-make" data-date="' + esc(d.date) + '">' + (d.exists ? "↻ Bring up to date" : d.date === cueFolders.today ? "📁 Make today's folder now" : "📁 Make it") + "</button>" +
          (d.exists ? '<button class="cv-del" data-del="folder" data-id="' + esc(d.date) + '" title="Move this folder to the Trash">🗑 Delete</button>' : "") + "</div></div>";
      }).join("");
      renderSure();
    }
    function refreshFolders() {
      if (!opts.sessions) return Promise.resolve();
      return api("/api/rec/cue-folders").then(function (r) { cueFolders = r; renderFolders(); }).catch(function () {});
    }
    root.addEventListener("click", function (e) {
      var make = e.target.closest("button.cv-folder-make");
      if (make) {
        make.disabled = true;
        status("Making the folder (cutting its clips)...");
        api("/api/rec/cue-folders/" + make.getAttribute("data-date"), {}).then(function (r) {
          status("📁 " + r.name + " - " + r.files + " clip" + (r.files === 1 ? "" : "s") + " (" + r.folder + ")");
          return refreshFolders();
        }).catch(function (err) { make.disabled = false; status("Couldn't make the folder: " + err.message); });
        return;
      }
      var del = e.target.closest('button.cv-del[data-del="folder"]');
      if (del) {
        var date = del.getAttribute("data-id");
        if (!askSure("folder", date)) return;
        api("/api/rec/cue-folders/" + date, undefined, "DELETE").then(function () { status("The folder is in the Trash - it won't be made again on its own."); return refreshFolders(); }).catch(function (err) { status("Couldn't delete it: " + err.message); });
      }
    });
    function renderSessionHeads() {
      if (!opts.sessions) return;
      var t = wallTime();
      root.querySelectorAll(".cv-tl").forEach(function (tl) {
        var h = tl.querySelector(".h"), s = +tl.getAttribute("data-s"), e = +tl.getAttribute("data-e");
        h.hidden = t === null || t < s || t > e;
        if (!h.hidden) h.style.left = ((t - s) / (e - s) * 100) + "%";
      });
    }
    root.addEventListener("click", function (e) {
      var del = e.target.closest('.cv-sess button.cv-del[data-del="session"]');
      if (del) { if (!del.disabled) deleteSession(del.getAttribute("data-id")); return; }
      var tl = e.target.closest(".cv-tl");
      if (!tl) return;
      var r = tl.getBoundingClientRect(), s = +tl.getAttribute("data-s"), en = +tl.getAttribute("data-e");
      seekTo(s + (e.clientX - r.left) / r.width * (en - s), null, true);
    });

    function refresh() {
      return Promise.all([api("/api/rec/cues"), api("/api/rec/sessions")]).then(function (r) {
        cues = (r[0].cues || []).sort(function (a, b) { return (b.startedAt || 0) - (a.startedAt || 0); });
        ffmpeg = !!r[0].ffmpeg;
        sessions = r[1].sessions || [];
        folder = r[1].folder || "";
        var games = cues.filter(function (c) { return c.kind === "game"; }).length, own = cues.length - games;
        q(".cv-info").innerHTML = esc(own + " cue" + (own === 1 ? "" : "s") + (games ? " · " + games + " game mark" + (games === 1 ? "" : "s") : "") + (ffmpeg ? "" : " · exporting needs ffmpeg on the computer")) +
          '<span class="cv-legend"><span class="lg" style="background:var(--accent, #e8b923)"></span>⭐ your cues<span class="lg" style="background:#3fa9f5"></span>🎱 a game starts</span>';
        // the cue being viewed: kept as edited; picked up again if it was still being marked
        if (sel) {
          var fresh = cues.filter(function (c) { return c.id === sel.id; })[0];
          if (fresh) { saved = fresh; if (!dirty) sel = JSON.parse(JSON.stringify(fresh)); }
        }
        // (checked cues that are gone: unchecked)
        Object.keys(picked).forEach(function (id) { if (!cues.some(function (c) { return c.id === id; })) delete picked[id]; });
        renderRows(); renderSessions(); renderLine(); renderButtons(); renderGroup(); renderWhole();
        refreshFolders();
      }).catch(function (e) { q(".cv-info").textContent = "The computer's server isn't answering (" + e.message + ")"; });
    }
    refresh();
    refreshTimer = setInterval(refresh, POLL_MS);
    renderButtons();
    return {
      refresh: refresh,
      select: select,
      seekTo: seekTo,
      setMark: setMark,
      save: save,
      exportClip: exportClip,
      deleteCue: deleteCue,
      deleteSession: deleteSession,
      wallTime: wallTime,
      setRate: setRate,
      stepFrame: stepFrame,
      state: function () { return { sel: sel, dirty: dirty, cues: cues, sessions: sessions, play: play }; }
    };
  }

  window.PMCCueViewer = { mount: mount, nameFor: nameFor, whoOf: whoOf };
})();
