// The cue viewer / adjuster - on the recording page (record.html, while it
// records) and the cues page (cues.html). Every cue (a marked moment, kept by
// server/recorder.js) plays straight from the recording - the file still
// being written included - and can be set right by hand: a timeline with the
// cue's span and a little before and after it, its start and end dragged or
// set at the playhead (I / O), nudged a second at a time; then saved, and
// exported - cut out with ffmpeg and downloaded on the spot (also kept in
// the Clips folder).
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
    ".cv .cv-tl .h { position: absolute; top: 0; bottom: 0; width: 2px; background: #fff; }",
    ".cv .dim { color: var(--text-dim, #c9a2a2); font-size: 0.9rem; }",
    ".cv td.x { width: 1%; white-space: nowrap; text-align: right; }",
    ".cv button.cv-del { min-height: 32px; padding: 4px 9px; }",
    ".cv button.cv-del.sure { background: #b3261e; border-color: #b3261e; color: #fff; font-weight: 800; }",
    ".cv .cv-session-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
    ".cv .cv-session-head .cv-del { margin-left: auto; }"
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
      '<div class="cv-row" style="margin-top:8px"><button data-a="new" title="A cue of your own at the playhead">＋ New cue here</button><span class="dim cv-info"></span></div>' +
      '<input type="search" class="cv-search" placeholder="Find a cue - player, game, date...">' +
      '<table><tbody class="cv-rows"></tbody></table>' +
      (opts.sessions ? '<div class="cv-sessions"><b>Recordings</b><div class="cv-sess dim">Loading...</div></div>' : "");

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
      return null;
    }
    function sessionSpan(s) {
      var parts = partsOf(s), last = parts[parts.length - 1];
      return { start: s.startedAt, end: s.endedAt || (last ? last.endedAt || Date.now() : s.startedAt + 1000), live: !s.endedAt };
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
    function load(index, offset, autoplay) {
      var p = play.parts[index];
      play.index = index;
      // (the file still being recorded: asked fresh each time, so it reaches the latest seconds)
      video.src = "/api/rec/" + encodeURIComponent(play.session.id) + "/file/" + encodeURIComponent(p.file) + (p.endedAt ? "" : "?t=" + Date.now());
      video.onloadedmetadata = function () {
        video.onloadedmetadata = null;
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
      if (!play || play.index + 1 >= play.parts.length) return;
      if (play.stopAt && play.parts[play.index + 1].startedAt >= play.stopAt) return;
      load(play.index + 1, 0, true);
    });

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
      q('[data-a="export"]').disabled = !finished || !ffmpeg;
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
        b.textContent = on ? (sure.what === "session" ? "Delete this recording?" : "Delete?") : (b.getAttribute("data-del") === "session" ? "🗑 Delete" : "🗑");
      });
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
      var here = wallTime(), live = sessions.filter(function (s) { return !s.endedAt; })[0];
      var start = here !== null ? here : live ? Date.now() - 20000 : null;
      if (start === null) { status("Play a recording first (click its timeline), then ＋ New cue here."); return; }
      var at = locate(start);
      if (!at) { status("That moment isn't in a recording."); return; }
      var end = Math.min(start + 20000, at.session.endedAt || Date.now());
      var c = { startedAt: Math.round(start), markedAt: Math.round(start), endedAt: Math.round(end), duration: Math.round(end - start), player: "", gameLabel: "", position: "", source: "by hand", session: at.session.id };
      c.name = nameFor(c);
      api("/api/rec/cues", c).then(function (savedCue) { cues.unshift(savedCue); renderRows(); select(savedCue.id, false); status("New cue - set its start and end, then 💾 Save."); });
    }
    // I / O (start / end at the playhead), space, arrows - unless typing
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
        return '<tr data-id="' + esc(c.id) + '" class="' + (sel && sel.id === c.id ? "sel " : "") + (c.endedAt ? "" : "open") + '"><td class="n">' + esc(c.name || nameFor(c) + (c.endedAt ? "" : " (still marking)")) + '</td><td class="dim" style="white-space:nowrap">' + esc(when(c.startedAt)) + '</td><td class="dim">' + (c.endedAt ? esc(len(c.endedAt - c.startedAt)) : "...") + "</td><td>" +
          (c.clip ? '<a class="cv-btn" href="/api/rec/clips/' + encodeURIComponent(c.clip) + '" download="' + esc(c.clip) + '" title="The exported clip">⬇</a>' : "") + "</td>" +
          '<td class="x"><button class="cv-del" data-del="cue" data-id="' + esc(c.id) + '" title="Delete this cue (the recording stays)">🗑</button></td></tr>';
      }).join("");
      renderSure();
    }
    q(".cv-rows").addEventListener("click", function (e) {
      var del = e.target.closest("button.cv-del");
      if (del) { deleteCue(del.getAttribute("data-id")); return; }
      if (e.target.closest("a")) return;
      var tr = e.target.closest("tr[data-id]");
      if (tr) select(tr.getAttribute("data-id"));
    });
    q(".cv-search").addEventListener("input", renderRows);

    // ---- the recordings (cues.html): a timeline each, click to play from there ----
    function renderSessions() {
      if (!opts.sessions) return;
      var box = q(".cv-sess");
      if (!sessions.length) { box.innerHTML = "No recordings yet. They're saved in " + esc(folder); return; }
      box.innerHTML = sessions.map(function (s) {
        var sp = sessionSpan(s), total = sp.end - sp.start, n = (s.parts || []).length;
        var p = function (t) { return Math.max(0, Math.min(100, (t - sp.start) / total * 100)); };
        var marks = cues.filter(function (c) { return c.startedAt >= sp.start - 2000 && c.startedAt <= sp.end; }).map(function (c) {
          return '<div class="c" title="' + esc(c.name || nameFor(c)) + '" style="left:' + p(c.startedAt) + "%;width:" + Math.max(0.3, p(c.endedAt || sp.end) - p(c.startedAt)) + '%"></div>';
        }).join("");
        return '<div class="cv-session"><div class="cv-session-head"><b>' + esc(s.id) + "</b> " + (sp.live ? '<span style="color:#ff4d4d">● recording</span> ' : "") + '<span class="dim">' + esc(len(total)) + " · " + n + " file" + (n === 1 ? "" : "s") + "</span>" +
          '<button class="cv-del" data-del="session" data-id="' + esc(s.id) + '"' + (sp.live ? ' disabled title="Stop the recording first"' : ' title="Move this recording to the Trash, with its cues (exported clips are kept)"') + ">🗑 Delete</button></div>" +
          '<div class="cv-tl" data-s="' + sp.start + '" data-e="' + sp.end + '">' + marks + '<div class="h" hidden></div></div></div>';
      }).join("");
      renderSure();
      renderSessionHeads();
    }
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
        q(".cv-info").textContent = cues.length + " cue" + (cues.length === 1 ? "" : "s") + (ffmpeg ? "" : " · exporting needs ffmpeg on the computer");
        // the cue being viewed: kept as edited; picked up again if it was still being marked
        if (sel) {
          var fresh = cues.filter(function (c) { return c.id === sel.id; })[0];
          if (fresh) { saved = fresh; if (!dirty) sel = JSON.parse(JSON.stringify(fresh)); }
        }
        renderRows(); renderSessions(); renderLine(); renderButtons();
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
      state: function () { return { sel: sel, dirty: dirty, cues: cues, sessions: sessions, play: play }; }
    };
  }

  window.PMCCueViewer = { mount: mount, nameFor: nameFor, whoOf: whoOf };
})();
