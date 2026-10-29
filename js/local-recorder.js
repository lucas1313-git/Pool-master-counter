// Recording the session on the device itself - for a device with no local
// server (an iPad on the GitHub site), where the recording page
// (record.html) can't save anything. The camera is recorded in 2-second
// pieces, each kept in this browser's storage (IndexedDB) as it comes, so
// a closed page loses at most a moment; cues are marked as on the Mac
// (⭐ Cue, the "/" key, voice: from 20 s before, named
// [player]-vs-[opponent]-[game]-[position]-[length]-[date]-[time]-cued as
// things stood at the cue's start). A cue is cut out as an ordinary MP4
// right here (js/mp4-clip.js - no re-encoding) and saved through the share
// sheet (Save to Files, AirDrop...) or as a download; the whole recording
// too. The recorded sound goes quiet for a moment at each cue (the tick's
// not in the video). Player recognition (the same camera) pauses while it
// records and comes back after.
// Two ways to record (the mode picker): ✨ Highlights (the default) keeps a
// rolling 10 minutes and, after that, only what the cues cover - a night of
// cues in a few hundred MB, not 10 GB; 🎞️ Everything keeps it all. Free
// space is checked before and while recording: running low stops it cleanly,
// everything up to then kept. A long recording is saved in 15-minute parts
// (no one file of several GB). The screen is kept awake while recording.
//
// PMCLocalRecorder.mount(panelBody, bridge) - bridge (from js/app.js):
//   { t(key, vars), toast(text, icon), context() -> the scoreboard's
//     { player, opponent, matchup, gameType, gameLabel, position },
//     pauseRecognition() -> was it running, resumeRecognition(),
//     changed() - the scoreboard's ⭐ Cue button to redraw }
// PMCLocalRecorder.isRecording(), .cueOpen(), .cueSince(),
//   .toggleCue(source), .mark(source), .finish(source), .start(), .stop()
(function () {
  "use strict";
  var DB_NAME = "pmc-local-recordings", PRE_ROLL_MS = 20000, CHUNK_MS = 2000, MAX_CUE_MS = 15 * 60 * 1000, HISTORY_MS = 5 * 60 * 1000;
  var MODE_KEY = "poolMasterCounter.recordingMode.v1";
  // (timings the tests shorten - see _setTiming)
  var TIMING = {
    bufferMs: 10 * 60 * 1000, // Highlights: the rolling stretch kept whatever the cues
    pruneMs: 30000, // how often Highlights lets go of what's older
    partMs: 15 * 60 * 1000, // a saved recording comes in parts this long
    spaceCheckMs: 30000, // free space looked at this often while recording
    minFreeStart: { highlights: 300e6, full: 1500e6 }, // ...and needed to start
    minFreeRunning: 200e6 // below this, the recording stops
  };
  var bridge = null, els = {}, rec = null, openCue = null, boardHistory = [], dbp = null, lastStop = null, persisted = null;
  var T = function (k, v) { return bridge ? bridge.t(k, v) : k; };

  // ---- storage ----
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (ok, no) {
      var r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = function () {
        var d = r.result;
        d.createObjectStore("sessions", { keyPath: "id" });
        var c = d.createObjectStore("chunks", { keyPath: ["session", "seq"] });
        c.createIndex("session", "session");
        var q = d.createObjectStore("cues", { keyPath: "id" });
        q.createIndex("session", "session");
      };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
    });
    return dbp;
  }
  function req(r) { return new Promise(function (ok, no) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); }
  function store(name, mode) { return db().then(function (d) { return d.transaction(name, mode || "readonly").objectStore(name); }); }
  function put(name, value) { return store(name, "readwrite").then(function (s) { return req(s.put(value)); }); }
  function get(name, key) { return store(name).then(function (s) { return req(s.get(key)); }); }
  function all(name) { return store(name).then(function (s) { return req(s.getAll()); }); }
  function bySession(name, id) { return store(name).then(function (s) { return req(s.index("session").getAll(id)); }); }
  function del(name, key) { return store(name, "readwrite").then(function (s) { return req(s.delete(key)); }); }

  // ---- small things ----
  function pad2(n) { return String(n).padStart(2, "0"); }
  function clock(ms) { var s = Math.max(0, Math.round(ms / 1000)); return (s >= 3600 ? Math.floor(s / 3600) + ":" + pad2(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ":" + pad2(s % 60); }
  function lengthText(ms) { var s = Math.max(0, Math.round(ms / 1000)); return (s >= 60 ? Math.floor(s / 60) + "m" : "") + pad2(s % 60) + "s"; }
  function stamp(t) { var d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "-" + pad2(d.getHours()) + "h" + pad2(d.getMinutes()) + "m" + pad2(d.getSeconds()); }
  function when(t) { var d = new Date(t); return d.toLocaleDateString() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
  function mb(n) { return n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : Math.max(0.1, n / 1e6).toFixed(1) + " MB"; }
  function whoOf(c) { if (c.player) return c.player + (c.opponent ? "-vs-" + c.opponent : ""); return c.matchup || "Table"; }
  function nameFor(c) { return [whoOf(c), c.gameLabel, c.position, c.endedAt ? lengthText(c.endedAt - c.startedAt) : "", stamp(c.startedAt), "cued"].filter(Boolean).join("-"); }
  function safeName(n) { return String(n || "clip").replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150) || "clip"; }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // a file out: the share sheet on a phone/tablet (Save to Files - iCloud Drive, Google Drive -, AirDrop, Mail), else a download
  function saveFile(file) {
    var touch = (navigator.maxTouchPoints || 0) > 1;
    if (touch && navigator.canShare && navigator.share) {
      try {
        if (navigator.canShare({ files: [file] })) {
          // (the file alone: a title would be saved as a second, text item)
          return navigator.share({ files: [file] }).then(function () { return "shared"; }, function (e) { if (e && e.name === "AbortError") return "cancelled"; download(file); return "downloaded"; });
        }
      } catch (e) {}
    }
    download(file);
    return Promise.resolve("downloaded");
  }
  function download(file) {
    var url = URL.createObjectURL(file), a = document.createElement("a");
    a.href = url; a.download = file.name; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  // ---- the sound: through a volume turned down for a moment at a cue ----
  var audioCtx = null, duckGain = null;
  function duck(ms) {
    if (!duckGain || !audioCtx) return;
    var t = audioCtx.currentTime, g = duckGain.gain, back = t + (ms || 900) / 1000;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + 0.03);
    g.setValueAtTime(0, back); g.linearRampToValueAtTime(1, back + 0.06);
  }

  // ---- the scoreboard as it stood: a cue is named as things were at its start ----
  function noteBoard() {
    if (!bridge) return;
    var b = bridge.context(), now = Date.now(), last = boardHistory[boardHistory.length - 1];
    if (!last || last.player !== b.player || last.opponent !== b.opponent || last.matchup !== b.matchup || last.gameLabel !== b.gameLabel || last.position !== b.position) boardHistory.push(Object.assign({ at: now }, b));
    while (boardHistory.length > 1 && now - boardHistory[1].at > HISTORY_MS) boardHistory.shift();
  }
  function boardAt(t) { var found = null; boardHistory.forEach(function (b) { if (b.at <= t) found = b; }); return found || boardHistory[0] || {}; }

  // ---- the screen kept awake while recording (Auto-Lock would end it) ----
  var wakeLock = null;
  function holdAwake() {
    if (!rec || wakeLock || !navigator.wakeLock || document.visibilityState !== "visible") return;
    navigator.wakeLock.request("screen").then(function (lock) {
      wakeLock = lock;
      lock.addEventListener("release", function () { wakeLock = null; if (rec) setTimeout(holdAwake, 1000); });
      if (!rec) letSleep();
    }).catch(function () {});
  }
  function letSleep() {
    var l = wakeLock;
    wakeLock = null;
    if (l) { try { l.release(); } catch (e) {} }
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") holdAwake(); });

  // ---- free space ----
  // { free, quota } in bytes, or null when the browser won't say
  function freeSpace() {
    if (!navigator.storage || !navigator.storage.estimate) return Promise.resolve(null);
    return navigator.storage.estimate().then(function (e) {
      return e && e.quota ? { free: Math.max(0, e.quota - (e.usage || 0)), quota: e.quota } : null;
    }, function () { return null; });
  }
  function modeNow() {
    var m = els.mode ? els.mode.value : null;
    return m === "full" ? "full" : "highlights";
  }

  // ---- recording ----
  function pickMime() {
    var list = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4;codecs=avc1,mp4a", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
    for (var i = 0; i < list.length; i++) if (window.MediaRecorder && MediaRecorder.isTypeSupported(list[i])) return list[i];
    return "";
  }
  function openCamera() {
    var deviceId = els.camera.value;
    var video = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    return navigator.mediaDevices.getUserMedia({ video: video }).then(function (v) {
      if (!els.sound.checked) return v;
      // the sound on its own: a microphone that never answers mustn't hold up the picture
      var timeout = new Promise(function (ok) { setTimeout(function () { ok(null); }, 8000); });
      return Promise.race([navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } }).catch(function () { return null; }), timeout]).then(function (a) {
        return a ? new MediaStream(v.getVideoTracks().concat(a.getAudioTracks())) : v;
      });
    });
  }
  function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (devs) {
      var keep = els.camera.value;
      els.camera.innerHTML = "";
      devs.filter(function (d) { return d.kind === "videoinput"; }).forEach(function (d, i) {
        var o = document.createElement("option");
        o.value = d.deviceId; o.textContent = d.label || T("lrec.camera") + " " + (i + 1);
        els.camera.appendChild(o);
      });
      if (keep) els.camera.value = keep;
    });
  }
  function start() {
    if (rec) return Promise.resolve();
    var mime = pickMime();
    if (!mime) { bridge.toast(T("lrec.cantRecord"), "⚠️ "); return Promise.resolve(); }
    clearTimeout(retryTimer); retries = 0;
    var mode = modeNow();
    // (Highlights cuts clips out as it goes - an MP4 recording only)
    if (mode === "highlights" && !(window.Mp4Clip && /mp4/.test(mime))) { mode = "full"; bridge.toast(T("lrec.highlightsNeedMp4"), "⚠️ "); }
    return freeSpace().then(function (space) {
      if (space && space.free < TIMING.minFreeStart[mode]) {
        lastStop = T("lrec.noSpaceToStart", { free: mb(space.free) });
        bridge.toast(lastStop, "⚠️ ");
        render();
        return;
      }
      lastStop = null;
      return startRecording(mime, mode);
    });
  }
  // carried: recognition already paused by the recording the camera dropped
  function startRecording(mime, mode, carried) {
    var wasRecognizing = carried || bridge.pauseRecognition();
    if (wasRecognizing) bridge.toast(T("lrec.recognitionPaused"), "🎬 ");
    // (the camera only after recognition let go of it)
    return new Promise(function (ok) { setTimeout(ok, wasRecognizing ? 700 : 0); }).then(openCamera).then(function (stream) {
      var out = stream;
      try {
        // the sound through a volume the cues turn down (the page was just tapped: sound is allowed)
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state !== "running") audioCtx.resume();
        if (stream.getAudioTracks().length) {
          var src = audioCtx.createMediaStreamSource(new MediaStream(stream.getAudioTracks())), g = audioCtx.createGain(), dest = audioCtx.createMediaStreamDestination();
          src.connect(g); g.connect(dest); duckGain = g;
          out = new MediaStream(stream.getVideoTracks().concat(dest.stream.getAudioTracks()));
        }
      } catch (e) { duckGain = null; }
      // (a key frame every 2 s where the browser takes it - Chrome: pieces that
      // short, so a clip starts close to its mark and Highlights lets go of
      // what isn't cued in small steps)
      var mr = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 6000000, audioBitsPerSecond: 128000, videoKeyFrameIntervalDuration: 2000 });
      var id = uid("r"), startedAt = Date.now();
      rec = { id: id, startedAt: startedAt, mime: mime, mode: mode, stream: stream, mr: mr, seq: 0, bytes: 0, keptBytes: 0, indexer: window.Mp4Clip && /mp4/.test(mime) ? new window.Mp4Clip.Indexer() : null, queue: Promise.resolve(), wasRecognizing: wasRecognizing, saveEvery: 0, failed: false, prunedAt: startedAt, spaceAt: startedAt };
      els.preview.srcObject = stream;
      els.preview.play && els.preview.play().catch(function () {});
      var session = { id: id, startedAt: startedAt, endedAt: null, mime: mime, mode: mode, bytes: 0, keptBytes: 0, chunks: 0, initEnd: 0, init: null, fragments: [] };
      rec.session = session;
      mr.ondataavailable = function (e) {
        if (!e.data || !e.data.size) return;
        var blob = e.data, seq = rec.seq++, offset = rec.bytes, r = rec, at = Date.now();
        rec.bytes += blob.size;
        r.queue = r.queue.then(function () {
          if (r.failed) return;
          var work = r.indexer ? blob.arrayBuffer().then(function (buf) { try { r.indexer.push(new Uint8Array(buf)); } catch (err) { r.indexer = null; } }) : Promise.resolve();
          return work.then(function () { return put("chunks", { session: id, seq: seq, offset: offset, size: blob.size, at: at, blob: blob }); }).then(function () {
            r.keptBytes += blob.size;
            session.bytes = r.bytes; session.keptBytes = r.keptBytes; session.chunks = seq + 1;
            if (r.indexer && r.indexer.init && !session.init) { session.init = r.indexer.init; session.initEnd = r.indexer.initEnd; }
            if (++r.saveEvery % 10 === 0) return saveSession(r);
          });
        }).catch(function (err) {
          // (a piece that couldn't be kept: stop there, cleanly - not go on
          // recording into nothing)
          if (r.failed) return;
          r.failed = true;
          stopForSpace(r, err && err.message ? err.message : String(err));
        });
      };
      watchCamera(rec);
      mr.start(CHUNK_MS);
      put("sessions", session);
      // (not kept for good: Safari may clear this site's storage when space runs short - said under the lists)
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(function (kept) { rec && (rec.persisted = !!kept); persisted = !!kept; refreshLists(); }, function () {}); } catch (e) {}
      holdAwake();
      boardHistory = [];
      noteBoard();
      rec.timer = setInterval(tick, 1000);
      render();
      bridge.changed();
    }).catch(function (e) {
      rec = null;
      if (wasRecognizing && !carried) bridge.resumeRecognition();
      bridge.toast(T("lrec.cameraError", { error: e && e.message ? e.message : String(e) }), "⚠️ ");
      render();
    });
  }
  function saveSession(r) {
    var s = r.session;
    s.bytes = r.bytes;
    s.keptBytes = r.keptBytes;
    if (r.indexer) { s.fragments = r.indexer.fragments.slice(); s.init = r.indexer.init; s.initEnd = r.indexer.initEnd; }
    return put("sessions", s);
  }
  function stop() {
    if (!rec || rec.stopping) return rec && rec.stopping || Promise.resolve();
    var r = rec;
    if (openCue) finish("recording stopped");
    clearInterval(r.timer);
    r.stopping = new Promise(function (ok) {
      r.mr.onstop = function () { ok(); };
      try { r.mr.stop(); } catch (e) { ok(); }
    }).then(function () { return r.queue; }).then(function () {
      r.session.endedAt = Date.now();
      return pruneHighlights(r, true).catch(function () {});
    }).then(function () {
      return saveSession(r).catch(function () {});
    }).then(function () {
      r.stream.getTracks().forEach(function (t) { t.stop(); });
      els.preview.srcObject = null;
      duckGain = null;
      rec = null;
      letSleep();
      if (r.wasRecognizing) { bridge.resumeRecognition(); bridge.toast(T("lrec.recognitionResumed"), "🎬 "); }
      render();
      refreshLists();
      bridge.changed();
    });
    return r.stopping;
  }
  // The camera lost mid-recording (another app took it, a cable, iOS
  // interrupting it - "ended", or "muted" for more than a few seconds): what
  // was recorded is kept and a new recording starts, trying again after 2,
  // 5, 15, 30 s.
  var RETRY_MS = [2000, 5000, 15000, 30000], retries = 0, retryTimer = null;
  function watchCamera(r) {
    var track = r.stream.getVideoTracks()[0];
    if (!track) return;
    var muteTimer = null;
    var lost = function () {
      if (rec !== r || r.stopping) return;
      var mode = r.mode, mime = r.mime, was = r.wasRecognizing;
      r.wasRecognizing = false; // (recognition stays paused for the next try)
      bridge.toast(T("lrec.cameraLost"), "⚠️ ");
      stop().then(function () { retryRecording(mime, mode, was); });
    };
    track.addEventListener("ended", lost);
    track.addEventListener("mute", function () { clearTimeout(muteTimer); muteTimer = setTimeout(function () { if (track.muted) lost(); }, 4000); });
    track.addEventListener("unmute", function () { clearTimeout(muteTimer); });
  }
  function retryRecording(mime, mode, was) {
    if (rec) return;
    if (retries >= RETRY_MS.length) { retries = 0; if (was) bridge.resumeRecognition(); return; }
    clearTimeout(retryTimer);
    retryTimer = setTimeout(function () {
      retries++;
      startRecording(mime, mode, was).then(function () { if (rec) { retries = 0; bridge.toast(T("lrec.cameraBack"), "🎬 "); } else retryRecording(mime, mode, was); });
    }, RETRY_MS[Math.min(retries, RETRY_MS.length - 1)]);
  }
  // Space ran short (or a piece couldn't be written): stop cleanly - what's
  // recorded so far is kept - and say so where it can't be missed.
  function stopForSpace(r, error) {
    if (rec !== r) return;
    lastStop = T("lrec.stoppedNoSpace", { error: error || "" });
    bridge.toast(lastStop, "⚠️ ");
    stop();
  }
  function tick() {
    if (!rec) return;
    var r = rec, now = Date.now();
    noteBoard();
    if (openCue && now - openCue.markedAt > MAX_CUE_MS) finish("nobody finished it");
    if (now - r.prunedAt >= TIMING.pruneMs) { r.prunedAt = now; r.queue = r.queue.then(function () { return pruneHighlights(r, false); }).catch(function () {}); }
    if (now - r.spaceAt >= TIMING.spaceCheckMs) {
      r.spaceAt = now;
      freeSpace().then(function (space) { if (space && space.free < TIMING.minFreeRunning && rec === r) stopForSpace(r, T("lrec.spaceLeft", { free: mb(space.free) })); });
    }
    renderStatus();
    bridge.changed();
  }

  // Highlights: what's older than the rolling stretch goes, unless a cue
  // covers it (with the stretch the clip is cut from - Mp4Clip.pick). final:
  // the recording's over - only the cues are kept.
  function pruneHighlights(r, final) {
    if (r.mode !== "highlights" || !r.indexer || !window.Mp4Clip) return Promise.resolve();
    var now = Date.now(), cutoff = final ? Infinity : now - TIMING.bufferMs, frags = r.indexer.fragments, initEnd = r.indexer.initEnd || 0;
    return bySession("cues", r.id).then(function (cues) {
      var keep = [];
      cues.forEach(function (c) {
        var range = frags.length ? window.Mp4Clip.pick(frags, (c.startedAt - r.startedAt) / 1000, ((c.endedAt || now) - r.startedAt) / 1000) : null;
        if (!c.endedAt) keep.push({ from: range ? range.from : 0, to: Infinity }); // (still being marked)
        else if (range) keep.push(range);
      });
      return bySession("chunks", r.id).then(function (chunks) {
        var gone = chunks.filter(function (ch) {
          if ((ch.at || 0) >= cutoff || ch.offset < initEnd) return false;
          return !keep.some(function (k) { return ch.offset < k.to && ch.offset + ch.size > k.from; });
        });
        if (!gone.length) return;
        return Promise.all(gone.map(function (ch) { return del("chunks", [r.id, ch.seq]); })).then(function () {
          gone.forEach(function (ch) { r.keptBytes -= ch.size; });
          r.session.keptBytes = r.keptBytes;
        });
      });
    });
  }

  // ---- cues ----
  function mark(source) {
    if (!rec) return false;
    if (openCue) finish("a new mark");
    var now = Date.now(), startedAt = Math.max(rec.startedAt, now - PRE_ROLL_MS), b = boardAt(startedAt);
    openCue = { id: uid("c"), session: rec.id, markedAt: now, startedAt: startedAt, endedAt: null, player: b.player || "", opponent: b.opponent || "", matchup: b.matchup || "", gameType: b.gameType || "", gameLabel: b.gameLabel || "", position: b.position || "", source: source || "button" };
    openCue.name = nameFor(openCue);
    put("cues", openCue);
    duck(/voice/.test(source || "") ? 3000 : 900);
    render();
    bridge.changed();
    return true;
  }
  function finish(why) {
    if (!openCue) return false;
    var c = openCue;
    openCue = null;
    c.endedAt = Date.now();
    c.name = nameFor(c);
    c.note = typeof why === "string" ? why : "";
    put("cues", c).then(refreshLists);
    duck(900);
    bridge.toast(T("lrec.finished", { name: c.name }), "✔ ");
    render();
    bridge.changed();
    return true;
  }
  function toggleCue(source) { return openCue ? finish(source) : mark(source); }

  // a cue's clip: the fragments covering it, cut as an ordinary MP4
  function clipFile(cue) {
    return get("sessions", cue.session).then(function (s) {
      var live = rec && rec.id === cue.session ? rec : null;
      var fragments = live && live.indexer ? live.indexer.fragments : s && s.fragments, init = live && live.indexer ? live.indexer.init : s && s.init;
      if (!s || !init || !fragments || !fragments.length || !window.Mp4Clip) throw new Error("cant-cut");
      var a = (cue.startedAt - s.startedAt) / 1000, b = ((cue.endedAt || Date.now()) - s.startedAt) / 1000;
      var range = window.Mp4Clip.pick(fragments, a, b);
      if (!range) throw new Error("cant-cut");
      return bySession("chunks", cue.session).then(function (chunks) {
        chunks.sort(function (x, y) { return x.seq - y.seq; });
        var parts = chunks.filter(function (c) { return c.offset < range.to && c.offset + c.size > range.from; });
        if (!parts.length) throw new Error("cant-cut");
        var base = parts[0].offset;
        return new Blob(parts.map(function (c) { return c.blob; })).slice(range.from - base, range.to - base).arrayBuffer().then(function (bytes) {
          var clip = window.Mp4Clip.cut(init instanceof Uint8Array ? init : new Uint8Array(init), new Uint8Array(bytes), a, b);
          return new File([clip.bytes], safeName(cue.name) + ".mp4", { type: "video/mp4" });
        });
      });
    });
  }
  // A long recording in parts: part i of a session (partMs each), as the
  // recording's own start (ftyp+moov) and the pieces covering it - a
  // fragmented MP4 that plays anywhere, made of the stored pieces as they are
  // (nothing held in memory but the part being shared).
  function partCount(s) {
    var length = (s.endedAt || Date.now()) - s.startedAt;
    return s.init && s.fragments && s.fragments.length && length > TIMING.partMs ? Math.ceil(length / TIMING.partMs) : 1;
  }
  function partFile(s, i, n) {
    var a = i * TIMING.partMs / 1000, b = i === n - 1 ? Infinity : (i + 1) * TIMING.partMs / 1000;
    var range = window.Mp4Clip ? window.Mp4Clip.pick(s.fragments, a, b) : null;
    if (!range) return Promise.reject(new Error("cant-cut"));
    // (each part starts on its first fragment: pick may step back to a key frame)
    if (i > 0) { var own = s.fragments.filter(function (f) { return f.time >= a - 0.001; })[0]; if (own) range.from = Math.max(range.from, own.offset); }
    return bySession("chunks", s.id).then(function (chunks) {
      chunks.sort(function (x, y) { return x.seq - y.seq; });
      var parts = chunks.filter(function (c) { return c.offset < range.to && c.offset + c.size > range.from; });
      if (!parts.length) throw new Error("cant-cut");
      var base = parts[0].offset, init = s.init instanceof Uint8Array ? s.init : new Uint8Array(s.init);
      var body = new Blob(parts.map(function (c) { return c.blob; })).slice(range.from - base, range.to - base);
      return new File([init, body], "pool-master-counter-recording-" + stamp(s.startedAt) + "-part-" + (i + 1) + "-of-" + n + ".mp4", { type: "video/mp4" });
    });
  }
  function recordingBlob(id) {
    return Promise.all([get("sessions", id), bySession("chunks", id)]).then(function (r) {
      var chunks = r[1].sort(function (x, y) { return x.seq - y.seq; });
      return { session: r[0], blob: new Blob(chunks.map(function (c) { return c.blob; }), { type: (r[0] && r[0].mime || "video/mp4").split(";")[0] }) };
    });
  }
  function playFile(file) { playBlob(file, 0); }
  function play(sessionId, atMs) {
    recordingBlob(sessionId).then(function (r) { playBlob(r.blob, atMs); });
  }
  function playBlob(blob, atMs) {
    (function (r) {
      if (els.player.dataset.url) URL.revokeObjectURL(els.player.dataset.url);
      var url = URL.createObjectURL(r.blob);
      els.player.dataset.url = url;
      els.player.classList.remove("hidden");
      els.player.src = url;
      els.player.onloadedmetadata = function () { try { els.player.currentTime = Math.max(0, (atMs || 0) / 1000); } catch (e) {} els.player.play().catch(function () {}); };
      els.player.scrollIntoView({ block: "center", behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    })({ blob: blob });
  }

  // ---- the panel ----
  function statusText() {
    if (!rec) return lastStop || T("lrec.statusIdle");
    var time = clock(Date.now() - rec.startedAt);
    return rec.mode === "highlights" ? T("lrec.statusHighlights", { time: time, size: mb(rec.keptBytes) }) : T("lrec.statusRecording", { time: time, size: mb(rec.bytes) });
  }
  function renderStatus() {
    var on = !!rec;
    els.status.textContent = statusText();
    els.status.classList.toggle("lrec-stopped", !on && !!lastStop);
    els.status.classList.toggle("lrec-live", on);
    if (els.summary) els.summary.textContent = on ? statusText() : els.summary.dataset.idle || "";
    if (openCue) els.cue.textContent = T("recorder.endCue", { time: clock(Date.now() - openCue.markedAt) });
  }
  function render() {
    var on = !!rec;
    els.start.textContent = on ? T("lrec.stop") : T("lrec.start");
    els.start.classList.toggle("lrec-on", on);
    els.cue.disabled = !on;
    els.cue.textContent = openCue ? T("recorder.endCue", { time: clock(Date.now() - openCue.markedAt) }) : T("recorder.cue");
    els.cue.classList.toggle("open", !!openCue);
    els.camera.disabled = on; els.sound.disabled = on;
    if (els.mode) els.mode.disabled = on;
    els.preview.classList.toggle("hidden", !on);
    renderStatus();
  }
  function button(text, cls, fn) { var b = document.createElement("button"); b.type = "button"; b.className = "btn btn-ghost " + (cls || ""); b.textContent = text; b.addEventListener("click", fn); return b; }
  // Save: the file is made first (cut, gathered) - and Safari only opens the
  // share sheet straight from a tap, so on a phone/tablet the button then
  // turns into "Share" for a second tap; a computer just downloads it.
  function shareSheetWanted() {
    if (!((navigator.maxTouchPoints || 0) > 1 && navigator.canShare && navigator.share)) return false;
    try { return navigator.canShare({ files: [new File(["x"], "x.mp4", { type: "video/mp4" })] }); } catch (e) { return false; }
  }
  function prepareThenSave(btn, makeFile) {
    var ready = null, label = btn.textContent;
    btn.addEventListener("click", function () {
      if (ready) {
        var file = ready;
        ready = null; btn.textContent = label; btn.classList.remove("lrec-ready");
        saveFile(file).then(function (how) { if (how !== "cancelled") bridge.toast(T("lrec.saved", { file: file.name }), "⬇ "); });
        return;
      }
      btn.disabled = true; btn.textContent = T("lrec.preparing");
      makeFile().then(function (file) {
        btn.disabled = false;
        if (shareSheetWanted()) { ready = file; btn.textContent = T("lrec.shareReady"); btn.classList.add("lrec-ready"); return; }
        btn.textContent = label;
        download(file);
        bridge.toast(T("lrec.saved", { file: file.name }), "⬇ ");
      }, function () {
        btn.disabled = false; btn.textContent = label;
        bridge.toast(T("lrec.cantCut"), "⚠️ ");
      });
    });
  }
  // a first tap asks, a second does it
  function askTwice(btn, label, fn) {
    btn.addEventListener("click", function () {
      if (btn.dataset.sure) { fn(); return; }
      btn.dataset.sure = "1"; var was = btn.textContent; btn.textContent = label; btn.classList.add("lrec-sure");
      setTimeout(function () { if (btn.isConnected) { delete btn.dataset.sure; btn.textContent = was; btn.classList.remove("lrec-sure"); } }, 4000);
    });
  }
  function refreshLists() {
    return Promise.all([all("sessions"), all("cues")]).then(function (r) {
      var sessions = r[0].sort(function (a, b) { return b.startedAt - a.startedAt; });
      var cues = r[1].sort(function (a, b) { return b.startedAt - a.startedAt; });
      els.cues.innerHTML = "";
      if (!cues.length) { var e = document.createElement("li"); e.className = "lrec-empty"; e.textContent = T("lrec.noCues"); els.cues.appendChild(e); }
      cues.forEach(function (c) {
        var li = document.createElement("li");
        var name = document.createElement("div"); name.className = "lrec-name"; name.textContent = (c.name || nameFor(c)) + (c.endedAt ? "" : " " + T("lrec.cueLive"));
        var meta = document.createElement("div"); meta.className = "lrec-meta"; meta.textContent = when(c.startedAt) + (c.endedAt ? " · " + clock(c.endedAt - c.startedAt) : "");
        var row = document.createElement("div"); row.className = "row lrec-actions";
        row.appendChild(button(T("lrec.play"), "", function () {
          get("sessions", c.session).then(function (s) {
            if (!s) return;
            // (a Highlights recording has gaps: its clip, cut out)
            if (s.mode === "highlights") clipFile(c).then(playFile, function () { bridge.toast(T("lrec.cantCut"), "⚠️ "); });
            else play(c.session, c.startedAt - s.startedAt);
          });
        }));
        var save = button(T("lrec.saveClip"), "lrec-save", function () {});
        prepareThenSave(save, function () { return clipFile(c); });
        save.disabled = !c.endedAt;
        row.appendChild(save);
        var bin = button("🗑", "lrec-del", function () {});
        askTwice(bin, T("lrec.deleteAsk"), function () { del("cues", c.id).then(refreshLists); });
        row.appendChild(bin);
        li.appendChild(name); li.appendChild(meta); li.appendChild(row);
        els.cues.appendChild(li);
      });
      els.sessions.innerHTML = "";
      if (!sessions.length) { var e2 = document.createElement("li"); e2.className = "lrec-empty"; e2.textContent = T("lrec.noRecordings"); els.sessions.appendChild(e2); }
      sessions.forEach(function (s) {
        var live = rec && rec.id === s.id, highlights = s.mode === "highlights";
        var li = document.createElement("li");
        var name = document.createElement("div"); name.className = "lrec-name"; name.textContent = (highlights ? "✨ " : "🎞️ ") + when(s.startedAt) + (live ? " " + T("lrec.liveNow") : "");
        var meta = document.createElement("div"); meta.className = "lrec-meta";
        var size = highlights ? T("lrec.keptSize", { size: mb(typeof s.keptBytes === "number" ? s.keptBytes : s.bytes || 0) }) : mb(s.bytes || 0);
        meta.textContent = clock((s.endedAt || Date.now()) - s.startedAt) + " · " + size + " · " + cues.filter(function (c) { return c.session === s.id; }).length + " ⭐";
        var row = document.createElement("div"); row.className = "row lrec-actions";
        // (Highlights keeps only the cues: no whole recording to play or save)
        if (!highlights) {
          row.appendChild(button(T("lrec.play"), "", function () { play(s.id, 0); }));
          var n = partCount(s);
          if (n > 1) {
            for (var i = 0; i < n; i++) (function (i) {
              var part = button(T("lrec.savePart", { n: i + 1, of: n, from: clock(i * TIMING.partMs), to: clock(Math.min((i + 1) * TIMING.partMs, (s.endedAt || Date.now()) - s.startedAt)) }), "lrec-save lrec-part", function () {});
              prepareThenSave(part, function () { return partFile(s, i, n); });
              part.disabled = live;
              row.appendChild(part);
            })(i);
          } else {
            var save = button(T("lrec.saveRecording"), "lrec-save", function () {});
            prepareThenSave(save, function () {
              return recordingBlob(s.id).then(function (r) {
                var ext = /mp4/.test(r.session.mime) ? "mp4" : "webm";
                return new File([r.blob], "pool-master-counter-recording-" + stamp(s.startedAt) + "." + ext, { type: r.blob.type });
              });
            });
            save.disabled = live;
            row.appendChild(save);
          }
        }
        var bin = button("🗑", "lrec-del", function () {});
        bin.disabled = live;
        askTwice(bin, T("lrec.deleteRecordingAsk"), function () {
          Promise.all([bySession("chunks", s.id), bySession("cues", s.id)]).then(function (r) {
            return Promise.all(r[0].map(function (c) { return del("chunks", [s.id, c.seq]); }).concat(r[1].map(function (c) { return del("cues", c.id); }), [del("sessions", s.id)]));
          }).then(refreshLists);
        });
        row.appendChild(bin);
        li.appendChild(name); li.appendChild(meta); li.appendChild(row);
        els.sessions.appendChild(li);
      });
      if (els.summary) {
        els.summary.dataset.idle = T("lrec.summaryIdle", { count: sessions.length, cues: cues.length });
        if (!rec) els.summary.textContent = els.summary.dataset.idle;
      }
      if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (est) {
        els.storage.textContent = T("lrec.storage", { used: mb(est.usage || 0), total: mb(est.quota || 0) }) + (persisted === false ? " " + T("lrec.notPersisted") : "");
      });
    }).catch(function () {});
  }

  function mount(root, b) {
    bridge = b;
    var q = function (id) { return root.querySelector("#" + id); };
    els = { root: root, preview: q("lrec-preview"), camera: q("lrec-camera"), sound: q("lrec-sound"), mode: q("lrec-mode"), start: q("btn-lrec-start"), cue: q("btn-lrec-cue"), status: q("lrec-status"), cues: q("lrec-cues"), sessions: q("lrec-sessions"), player: q("lrec-player"), storage: q("lrec-storage"), summary: document.getElementById("local-record-panel-summary") };
    var signBtn = q("btn-lrec-sign");
    if (signBtn) signBtn.addEventListener("click", function () {
      if (window.PMCRecordingConsent) window.PMCRecordingConsent.printSign({ sound: els.sound.checked });
    });
    // (the first recording on this device asks first - js/recording-consent.js)
    els.start.addEventListener("click", function () {
      if (rec) { stop(); return; }
      if (!window.PMCRecordingConsent) { start(); return; }
      window.PMCRecordingConsent.ask({ sound: els.sound.checked }).then(function (ok) { if (ok) start(); });
    });
    els.cue.addEventListener("click", function () { toggleCue("button"); });
    if (els.mode) {
      try { els.mode.value = localStorage.getItem(MODE_KEY) === "full" ? "full" : "highlights"; } catch (e) {}
      els.mode.addEventListener("change", function () { try { localStorage.setItem(MODE_KEY, modeNow()); } catch (e) {} });
    }
    listCameras();
    render();
    refreshLists();
    // a recording cut short (the page closed): kept, marked as ended
    all("sessions").then(function (list) {
      list.forEach(function (s) { if (!s.endedAt) { s.endedAt = s.startedAt + Math.max(1000, (s.chunks || 0) * CHUNK_MS); put("sessions", s); } });
      refreshLists();
    }).catch(function () {});
    window.addEventListener("beforeunload", function (e) { if (rec) { e.preventDefault(); e.returnValue = ""; } });
  }

  window.PMCLocalRecorder = {
    mount: mount,
    start: start,
    stop: stop,
    mark: mark,
    finish: finish,
    toggleCue: toggleCue,
    isRecording: function () { return !!rec; },
    cueOpen: function () { return !!openCue; },
    cueSince: function () { return openCue ? openCue.markedAt : null; },
    refresh: refreshLists,
    // (✨ Tonight's highlights - js/app.js: every cue, and a cue's clip as a File)
    cues: function () { return all("cues"); },
    clipFile: clipFile,
    // (tests)
    _clipFile: clipFile,
    _all: all,
    _state: function () { return { recording: !!rec, id: rec && rec.id, bytes: rec && rec.bytes, keptBytes: rec && rec.keptBytes, mode: rec && rec.mode, fragments: rec && rec.indexer ? rec.indexer.fragments.length : 0, cue: openCue, mime: rec && rec.mime, awake: !!wakeLock, stopped: lastStop }; },
    _partFile: partFile,
    _endCamera: function () { var t = rec && rec.stream.getVideoTracks()[0]; if (t) t.dispatchEvent(new Event("ended")); },
    _bySession: bySession,
    _setTiming: function (t) { Object.keys(t || {}).forEach(function (k) { TIMING[k] = t[k]; }); }
  };
})();
