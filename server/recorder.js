// The recorder's side on the computer (record.html records, cues.html
// finds the moments again). The recording page sends its video here in
// small pieces as it goes - an hours-long evening never has to fit in the
// browser - and this keeps it on disk, in ~/Movies/Pool Master Counter/:
//
//   2026-10-25 20h05/            one folder per recording
//     session.json               when it started, its parts (each with its
//                                start and end time), the crop it was made with
//     part-001.mp4, part-002...  the video, a new part every few minutes, so
//                                each one is quick to open and to jump around in
//   cues.json                    every cue (a marked moment), all recordings
//   Clips/                       the cues cut out as their own videos
//
// With ffmpeg on the computer (Homebrew's, or anywhere on the usual paths),
// each finished part is rewritten with its index at the front (instant
// jumps, no re-encoding), and a cue is cut out as a clip in a second.
// Without it the recording and the cues still work; clips don't.
//
//   POST   /api/rec/start                    { mime, ext, crop, camera } -> { id }
//   POST   /api/rec/:id/part/:n              (video bytes, appended; X-Started-At on the first)
//   POST   /api/rec/:id/part/:n/end          { startedAt, endedAt }
//   POST   /api/rec/:id/stop                 { endedAt }
//   POST   /api/rec/:id/pause, /resume        ⏸ paused / ▶ going on - the same recording ({ at })
//   GET    /api/rec/sessions                 every recording, newest first
//   DELETE /api/rec/sessions/:id             to the Trash, with its cues (not while it records;
//                                            exported clips are kept)
//   GET    /api/rec/:id/file/:name           a part (seekable: Range requests); ?live=<token>: the
//                                            one still being recorded, as a copy to jump around in
//   GET    /api/rec/cues                     every cue, newest first
//   POST   /api/rec/cues                     a new cue -> the cue (with its id)
//   PATCH  /api/rec/cues/:cue                change it (finish it, rename it)
//   DELETE /api/rec/cues/:cue
//   POST   /api/rec/cues/:cue/clip           cut it out -> { file }
//   GET    /api/rec/clips/:name              a clip
//   GET    /api/rec/info                     where it all goes, ffmpeg or not
//   GET    /api/rec/settings                 { keepDays } (0: keep them all)
//   POST   /api/rec/settings                 { keepDays: 0 | 7 | 14 | 30 | 90 }
// Like the camera relay: no login, the local network only.
//
// Keeping them (settings.json, keepDays): a recording older than that goes to
// the Trash on its own (at start-up, when the setting changes, every few
// hours) - its cues cut out as clips first (they're kept in Clips/), and one
// with cues it can't cut (no ffmpeg) is left alone. 0, the default: kept.

var fs = require("fs");
var path = require("path");
var os = require("os");
var childProcess = require("child_process");

var MAX_JSON = 256 * 1024;
// (a reel's request carries a small PNG score bug a clip)
var MAX_REEL_JSON = 16 * 1024 * 1024;
var reel = require("./reel");

function root() { return path.join(os.homedir(), "Movies", "Pool Master Counter"); }
function cuesFile() { return path.join(root(), "cues.json"); }
function settingsFile() { return path.join(root(), "settings.json"); }
var KEEP_DAYS = [0, 7, 14, 30, 90];
function loadSettings() { var s = readJson(settingsFile(), {}); return { keepDays: KEEP_DAYS.indexOf(s.keepDays) !== -1 ? s.keepDays : 0 }; }
function clipsDir() { return path.join(root(), "Clips"); }

var ffmpegPath;
function ffmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath;
  ffmpegPath = null;
  var tries = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg"];
  (process.env.PATH || "").split(path.delimiter).forEach(function (d) { if (d) tries.push(path.join(d, "ffmpeg")); });
  for (var i = 0; i < tries.length; i++) {
    try { fs.accessSync(tries[i], fs.constants.X_OK); ffmpegPath = tries[i]; break; } catch (e) {}
  }
  return ffmpegPath;
}
function runFfmpeg(args, cb) {
  var bin = ffmpeg();
  if (!bin) return cb(new Error("ffmpeg isn't on this computer"));
  childProcess.execFile(bin, ["-hide_banner", "-loglevel", "error", "-y"].concat(args), { timeout: 10 * 60 * 1000 }, function (err, stdout, stderr) {
    cb(err ? new Error((stderr || err.message).toString().trim().split("\n").pop()) : null);
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}
function writeJson(file, obj) {
  var tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, file);
}
function readBody(req, cb, limit) {
  var chunks = [], size = 0, done = false;
  req.on("data", function (c) { size += c.length; if (size > (limit || MAX_JSON)) { done = true; req.destroy(); cb(null); return; } chunks.push(c); });
  req.on("end", function () { if (done) return; done = true; try { cb(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { cb(null); } });
  req.on("error", function () { if (!done) { done = true; cb(null); } });
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

// ids are folder names we made: "2026-10-25 20h05" (+ " (2)")
function sessionDir(id) {
  if (typeof id !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}h\d{2}( \(\d+\))?$/.test(id)) return null;
  return path.join(root(), id);
}
function partName(n, ext) { return "part-" + String(n).padStart(3, "0") + "." + ext; }
function pad2(n) { return String(n).padStart(2, "0"); }
function folderName(t) {
  var d = new Date(t);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + "h" + pad2(d.getMinutes());
}
// a file name from a cue's name - letters, digits and - _ . only
function safeFileName(name) {
  return String(name || "clip").replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 160) || "clip";
}

function loadSession(id) {
  var dir = sessionDir(id);
  if (!dir) return null;
  var s = readJson(path.join(dir, "session.json"), null);
  return s ? { dir: dir, s: s } : null;
}
function saveSession(x) { writeJson(path.join(x.dir, "session.json"), x.s); }

// A finished part with its index moved to the front: opens and jumps at
// once (no re-encoding). The part keeps its name; done next to it first.
function makeSeekable(dir, file, cb) {
  if (!ffmpeg() || !/\.mp4$/.test(file)) return cb && cb(null);
  var src = path.join(dir, file), tmp = path.join(dir, file.replace(/\.mp4$/, ".seek.mp4"));
  runFfmpeg(["-i", src, "-c", "copy", "-movflags", "+faststart", tmp], function (err) {
    if (err) { try { fs.unlinkSync(tmp); } catch (e) {} return cb && cb(err); }
    try { fs.renameSync(tmp, src); } catch (e) { return cb && cb(e); }
    cb && cb(null);
  });
}

// The file still being recorded can't be jumped around in (it grows, no
// index yet): asked for with ?live=<token>, a copy of it as it is now, its
// index at the front (no re-encoding - about half a second for 10 minutes
// of 1080p). One copy serves every request for 4 s, and a token keeps the
// copy it first got (a player reads it in pieces over time); the last 3
// copies are kept, and all go when the file ends.
var LIVE_COPY_MS = 4000, LIVE_COPIES_KEPT = 3;
var liveCopies = {}; // the part's path -> { list: [{ path, at, tokens }], making: [callbacks] | null }
function liveCopy(dir, file, token, cb) {
  var src = path.join(dir, file), st = liveCopies[src] || (liveCopies[src] = { list: [], making: null });
  var give = function (err, c) { if (err) return cb(err); c.tokens[token] = true; cb(null, c.path); };
  var known = st.list.filter(function (c) { return c.tokens[token]; })[0];
  if (known && fs.existsSync(known.path)) return cb(null, known.path);
  var fresh = st.list[st.list.length - 1];
  if (fresh && Date.now() - fresh.at < LIVE_COPY_MS && fs.existsSync(fresh.path)) return give(null, fresh);
  if (st.making) return st.making.push(give);
  st.making = [give];
  var at = Date.now(), ext = path.extname(file), out = path.join(dir, file.slice(0, -ext.length) + ".live-" + at + ext);
  runFfmpeg(["-i", src, "-c", "copy"].concat(ext === ".mp4" ? ["-movflags", "+faststart"] : []).concat([out]), function (err) {
    var waiting = st.making, c = err ? null : { path: out, at: at, tokens: {} };
    st.making = null;
    if (c) {
      st.list.push(c);
      while (st.list.length > LIVE_COPIES_KEPT) { try { fs.unlinkSync(st.list.shift().path); } catch (e) {} }
    } else { try { fs.unlinkSync(out); } catch (e) {} }
    waiting.forEach(function (w) { w(err, c); });
  });
}
function dropLiveCopies(dir, file) {
  delete liveCopies[path.join(dir, file)];
  var stem = file.replace(/\.\w+$/, "") + ".live-";
  try { fs.readdirSync(dir).forEach(function (n) { if (n.indexOf(stem) === 0) { try { fs.unlinkSync(path.join(dir, n)); } catch (e) {} } }); } catch (e) {}
}

// A new recording starts: any left open before it (the page closed or the computer slept - never
// stopped, or paused an hour ago and never gone on) ends where its last file does. (Not one still
// being written - another page recording - nor paused a moment ago.)
function closeLeftOpen() {
  var now = Date.now();
  try {
    fs.readdirSync(root()).forEach(function (n) {
      var x = loadSession(n);
      if (!x || x.s.endedAt) return;
      var last = x.s.parts[x.s.parts.length - 1], written = 0;
      if (last) { try { written = fs.statSync(path.join(x.dir, last.file)).mtimeMs; } catch (e) {} }
      if (x.s.pausedAt ? now - x.s.pausedAt < 3600000 : now - (written || x.s.startedAt) < 120000) return;
      var end = x.s.pausedAt || (last && last.endedAt) || written;
      x.s.endedAt = Math.round(end || x.s.startedAt);
      x.s.pausedAt = null;
      saveSession(x);
    });
  } catch (e) {}
}

function loadCues() { return readJson(cuesFile(), []); }
function saveCues(cues) { fs.mkdirSync(root(), { recursive: true }); writeJson(cuesFile(), cues); }

// The parts covering [from, to] (wall-clock ms) of the recordings, with
// where in each part that is (seconds).
function piecesFor(from, to) {
  var pieces = [];
  var dirs = [];
  try { dirs = fs.readdirSync(root()).filter(function (n) { return !!sessionDir(n); }); } catch (e) {}
  dirs.forEach(function (id) {
    var x = loadSession(id);
    if (!x) return;
    var parts = (x.s.parts || []).slice().sort(function (a, b) { return a.n - b.n; });
    parts.forEach(function (p, i) {
      // (the part still being recorded: up to now - ffmpeg reads what's there)
      var end = p.endedAt || (!x.s.endedAt && i === parts.length - 1 ? Date.now() : null);
      if (!p.startedAt || !end || end <= from || p.startedAt >= to) return;
      pieces.push({ file: path.join(x.dir, p.file), at: p.startedAt, from: Math.max(0, (from - p.startedAt) / 1000), to: (Math.min(to, end) - p.startedAt) / 1000 });
    });
  });
  pieces.sort(function (a, b) { return a.at - b.at; });
  return pieces;
}

// (outDir: another folder than Clips/ - a day's cue folder)
function cutClip(cue, cb, outDir) {
  if (!cue.startedAt || !cue.endedAt) return cb(new Error("the cue isn't finished"));
  var pieces = piecesFor(cue.startedAt, cue.endedAt);
  if (!pieces.length) return cb(new Error("no recording covers that moment"));
  fs.mkdirSync(outDir || clipsDir(), { recursive: true });
  var name = safeFileName(cue.name) + ".mp4", out = path.join(outDir || clipsDir(), name);
  if (pieces.length === 1) {
    var p = pieces[0];
    return runFfmpeg(["-ss", p.from.toFixed(2), "-i", p.file, "-t", (p.to - p.from).toFixed(2), "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", out], function (err) { cb(err, name); });
  }
  // across parts: each piece cut, then joined
  var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-clip-")), list = [], i = 0;
  (function next() {
    if (i === pieces.length) {
      var listFile = path.join(tmpDir, "list.txt");
      fs.writeFileSync(listFile, list.map(function (f) { return "file '" + f.replace(/'/g, "'\\''") + "'"; }).join("\n"));
      return runFfmpeg(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", out], function (err) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        cb(err, name);
      });
    }
    var pc = pieces[i], piece = path.join(tmpDir, "piece-" + i + ".mp4");
    i++;
    runFfmpeg(["-ss", pc.from.toFixed(2), "-i", pc.file, "-t", (pc.to - pc.from).toFixed(2), "-c", "copy", "-avoid_negative_ts", "make_zero", piece], function (err) {
      if (err) { fs.rmSync(tmpDir, { recursive: true, force: true }); return cb(err); }
      list.push(piece);
      next();
    });
  })();
}

// A recording to the Trash (it can be put back from there), its cues with
// it - the clips already cut stay. -> { trash, cues } or throws.
function trashSession(id, x) {
  var trash = path.join(os.homedir(), ".Trash"), dest = path.join(trash, "Pool Master Counter " + id), k = 2;
  fs.mkdirSync(trash, { recursive: true });
  while (fs.existsSync(dest)) dest = path.join(trash, "Pool Master Counter " + id + " (" + k++ + ")");
  fs.renameSync(x.dir, dest);
  var span = { s: x.s.startedAt, e: x.s.endedAt || Date.now() };
  // (a 📌 kept cue stays, its clip in Clips/)
  var cues = loadCues(), left = cues.filter(function (c) {
    if (c.keep && c.clip) return true;
    return c.session ? c.session !== id : !(c.startedAt >= span.s && c.startedAt <= span.e);
  });
  if (left.length !== cues.length) saveCues(left);
  return { trash: dest, cues: cues.length - left.length };
}
function cuesOf(id, x) {
  var span = { s: x.s.startedAt, e: x.s.endedAt || Date.now() };
  return loadCues().filter(function (c) { return c.session ? c.session === id : c.startedAt >= span.s && c.startedAt <= span.e; });
}

// ---- 📁 A folder of each day's cues (2026-10-29 request) ----
// "Pool Master Cues 2026-10-29 Jo - Kim - Lee" in the recordings folder: the
// day's cues (not the 🎱 game marks) cut out as clips. Each pool day (it
// turns at 5 a.m. - js/lib/pool-day.js) is made once it's over (looked at
// every hour, the last 14 days), or now from the cues page; its name follows
// who's on its cues (renamed as more come). Deleted (from the cues page: to
// the Trash; or in the Finder), it isn't made again on its own.
var poolDay = require("../js/lib/pool-day.js");
var CUE_FOLDER_PREFIX = "Pool Master Cues ";
function cueFoldersFile() { return path.join(root(), "cue-folders.json"); }
function loadCueFolders() { var s = readJson(cueFoldersFile(), {}); return s && typeof s === "object" ? s : {}; }
function saveCueFolders(s) { fs.mkdirSync(root(), { recursive: true }); writeJson(cueFoldersFile(), s); }
function cueDay(c) { return poolDay.localDateStrFromTs(c.startedAt); }
function dayCues(date) { return loadCues().filter(function (c) { return c.kind !== "game" && c.startedAt && c.endedAt && cueDay(c) === date; }); }
// everyone on a day's cues (players, opponents, "A-vs-B", "Bob+Chris"), A-Z
function dayPlayers(cues) {
  var names = {};
  cues.forEach(function (c) {
    [c.player, c.opponent, c.matchup, c.cameraShooter].forEach(function (s) {
      String(s || "").split(/\s*(?:-vs-|\+|&|,| v )\s*/).forEach(function (n) { n = n.trim(); if (n) names[n.toLowerCase()] = names[n.toLowerCase()] || n; });
    });
  });
  return Object.keys(names).map(function (k) { return names[k]; }).sort(function (a, b) { return a.localeCompare(b); });
}
function cueFolderName(date, cues) {
  var players = dayPlayers(cues), list = players.join(" - ");
  // (a long night: as many as fit in a file name, then "+ n more")
  var room = 150 - (CUE_FOLDER_PREFIX + date + " ").length;
  for (var n = players.length; n > 0 && list.length > room; n--) list = players.slice(0, n - 1).join(" - ") + " + " + (players.length - n + 1) + " more";
  return safeFileName(CUE_FOLDER_PREFIX + date + (list ? " " + list : "")).replace(/\.+$/, "");
}
// the day's folder as it is on disk now (whatever its players say)
function existingCueFolder(date) {
  try {
    var hit = fs.readdirSync(root()).filter(function (n) { return n.indexOf(CUE_FOLDER_PREFIX + date) === 0 && fs.statSync(path.join(root(), n)).isDirectory(); })[0];
    return hit ? path.join(root(), hit) : null;
  } catch (e) { return null; }
}
// makes (or brings up to date) a day's folder -> cb(err, { name, dir, cut, files })
function buildCueFolder(date, cb) {
  var cues = dayCues(date);
  if (!cues.length) return cb(new Error("no cues that day"));
  var name = cueFolderName(date, cues), dir = path.join(root(), name), was = existingCueFolder(date);
  try {
    if (was && was !== dir) fs.renameSync(was, dir);
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) { return cb(e); }
  var cut = 0, i = 0;
  (function next() {
    if (i >= cues.length) {
      var state = loadCueFolders();
      state[date] = { name: name, built: Date.now(), deleted: false };
      saveCueFolders(state);
      return cb(null, { name: name, dir: dir, cut: cut, files: fs.readdirSync(dir).filter(function (f) { return /\.mp4$/.test(f); }).length });
    }
    var c = cues[i++];
    if (fs.existsSync(path.join(dir, safeFileName(c.name) + ".mp4"))) return next();
    cutClip(c, function (err) { if (!err) cut++; next(); }, dir);
  })();
}
// every finished day of the last 14 not made yet (nor deleted) -> cb(dates made)
var cueFoldersRunning = false;
function makeDueCueFolders(now, cb) {
  if (cueFoldersRunning || !ffmpeg()) return cb && cb([]);
  cueFoldersRunning = true;
  var today = poolDay.localDateStrFromTs(now), state = loadCueFolders(), days = {};
  loadCues().forEach(function (c) {
    if (c.kind === "game" || !c.startedAt || !c.endedAt || now - c.startedAt > 14 * 86400000) return;
    var d = cueDay(c);
    if (d !== today && !(state[d] && (state[d].built || state[d].deleted))) days[d] = true;
  });
  var dates = Object.keys(days).sort(), made = [];
  (function next(i) {
    if (i >= dates.length) { cueFoldersRunning = false; return cb && cb(made); }
    buildCueFolder(dates[i], function (err) { if (!err) made.push(dates[i]); next(i + 1); });
  })(0);
}
function deleteCueFolder(date) {
  var dir = existingCueFolder(date), state = loadCueFolders();
  state[date] = Object.assign(state[date] || {}, { deleted: true });
  saveCueFolders(state);
  if (!dir) return null;
  var trash = path.join(os.homedir(), ".Trash"), dest = path.join(trash, path.basename(dir)), k = 2;
  fs.mkdirSync(trash, { recursive: true });
  while (fs.existsSync(dest)) dest = path.join(trash, path.basename(dir) + " (" + k++ + ")");
  fs.renameSync(dir, dest);
  return dest;
}
// every day with cues (newest first): its folder's name, whether it's there, how many clips
function listCueFolders() {
  var state = loadCueFolders(), days = {};
  loadCues().forEach(function (c) { if (c.kind !== "game" && c.startedAt && c.endedAt) (days[cueDay(c)] = days[cueDay(c)] || []).push(c); });
  return Object.keys(days).sort().reverse().map(function (d) {
    var dir = existingCueFolder(d), files = 0;
    try { if (dir) files = fs.readdirSync(dir).filter(function (f) { return /\.mp4$/.test(f); }).length; } catch (e) {}
    return { date: d, name: dir ? path.basename(dir) : cueFolderName(d, days[d]), exists: !!dir, files: files, cues: days[d].length, deleted: !!(state[d] && state[d].deleted) && !dir };
  });
}

// Recordings older than keepDays: their cues cut out, then to the Trash.
// cb(names trashed).
var retentionRunning = false;
function applyRetention(now, cb) {
  var keep = loadSettings().keepDays;
  if (!keep || retentionRunning) return cb && cb([]);
  retentionRunning = true;
  var ids = [];
  try { ids = fs.readdirSync(root()).filter(function (n) { return !!sessionDir(n); }); } catch (e) {}
  var old = ids.map(function (id) { return { id: id, x: loadSession(id) }; }).filter(function (o) {
    return o.x && o.x.s.endedAt && now - o.x.s.endedAt > keep * 86400000;
  });
  var gone = [];
  (function next(i) {
    if (i >= old.length) { retentionRunning = false; return cb && cb(gone); }
    // (a game mark is a moment - nothing to cut, nothing to keep)
    var o = old[i], uncut = cuesOf(o.id, o.x).filter(function (c) { return !c.clip && c.endedAt && c.kind !== "game"; });
    if (uncut.length && !ffmpeg()) return next(i + 1); // (its cues can't be kept as clips: it stays)
    (function cutNext(j) {
      if (j >= uncut.length) {
        try { trashSession(o.id, o.x); gone.push(o.id); console.log("[recorder] " + o.id + " is older than " + keep + " days - moved to the Trash"); } catch (e) { console.warn("[recorder] couldn't move " + o.id + " to the Trash: " + e.message); }
        return next(i + 1);
      }
      cutClip(uncut[j], function (err, name) {
        if (err) { console.warn("[recorder] kept " + o.id + ": a cue couldn't be cut (" + err.message + ")"); return next(i + 1); }
        var cues = loadCues();
        cues.forEach(function (c) { if (c.id === uncut[j].id) c.clip = name; });
        saveCues(cues);
        cutNext(j + 1);
      });
    })(0);
  })(0);
}

function attachRecorderRoutes(app) {
  // (kept recordings: looked at shortly after start-up, then every 6 hours)
  setTimeout(function () { applyRetention(Date.now()); }, 15000).unref();
  setInterval(function () { applyRetention(Date.now()); }, 6 * 3600 * 1000).unref();
  // (📁 each finished day's cue folder: shortly after start-up, then every hour)
  setTimeout(function () { makeDueCueFolders(Date.now()); }, 20000).unref();
  setInterval(function () { makeDueCueFolders(Date.now()); }, 3600 * 1000).unref();
  app.get("/api/rec/cue-folders", function (req, res) { sendJson(res, 200, { folder: root(), today: poolDay.localDateStrFromTs(Date.now()), ffmpeg: !!ffmpeg(), days: listCueFolders() }); });
  app.post("/api/rec/cue-folders/:date", function (req, res) {
    var date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: "a date, like 2026-10-29" });
    if (!ffmpeg()) return sendJson(res, 500, { error: "ffmpeg isn't on this computer" });
    buildCueFolder(date, function (err, r) {
      if (err) return sendJson(res, 404, { error: err.message });
      sendJson(res, 200, { name: r.name, folder: r.dir, cut: r.cut, files: r.files });
    });
  });
  app.delete("/api/rec/cue-folders/:date", function (req, res) {
    var date = req.params.date;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { error: "a date, like 2026-10-29" });
    try { sendJson(res, 200, { trash: deleteCueFolder(date) }); } catch (e) { sendJson(res, 500, { error: e.message }); }
  });
  app.get("/api/rec/settings", function (req, res) { sendJson(res, 200, loadSettings()); });
  app.post("/api/rec/settings", function (req, res) {
    readBody(req, function (b) {
      if (!b || KEEP_DAYS.indexOf(Number(b.keepDays)) === -1) return sendJson(res, 400, { error: "keepDays: one of " + KEEP_DAYS.join(", ") });
      fs.mkdirSync(root(), { recursive: true });
      writeJson(settingsFile(), { keepDays: Number(b.keepDays) });
      applyRetention(Date.now(), function (gone) { sendJson(res, 200, { keepDays: Number(b.keepDays), trashed: gone }); });
    });
  });

  app.get("/api/rec/info", function (req, res) {
    sendJson(res, 200, { folder: root(), ffmpeg: !!ffmpeg() });
  });

  app.post("/api/rec/start", function (req, res) {
    readBody(req, function (b) {
      if (!b) return sendJson(res, 400, { error: "bad request" });
      fs.mkdirSync(root(), { recursive: true });
      closeLeftOpen();
      var startedAt = Number(b.startedAt) || Date.now(), id = folderName(startedAt), k = 2;
      while (fs.existsSync(path.join(root(), id))) id = folderName(startedAt) + " (" + k++ + ")";
      var dir = path.join(root(), id);
      fs.mkdirSync(dir);
      var ext = b.ext === "webm" ? "webm" : "mp4";
      var s = { id: id, startedAt: startedAt, endedAt: null, mime: String(b.mime || ""), ext: ext, crop: b.crop || null, camera: String(b.camera || "").slice(0, 200), parts: [] };
      writeJson(path.join(dir, "session.json"), s);
      sendJson(res, 200, { id: id, folder: dir });
    });
  });

  app.post("/api/rec/:id/part/:n", function (req, res) {
    var x = loadSession(req.params.id), n = parseInt(req.params.n, 10);
    if (!x || !(n >= 1 && n < 10000)) return sendJson(res, 404, { error: "no such recording" });
    var file = partName(n, x.s.ext);
    if (!x.s.parts.some(function (p) { return p.n === n; })) {
      x.s.parts.push({ n: n, file: file, startedAt: Number(req.headers["x-started-at"]) || Date.now(), endedAt: null, bytes: 0 });
      saveSession(x);
    }
    var out = fs.createWriteStream(path.join(x.dir, file), { flags: "a" }), bytes = 0;
    req.on("data", function (c) { bytes += c.length; });
    req.pipe(out);
    out.on("finish", function () { sendJson(res, 200, { ok: true, bytes: bytes }); });
    out.on("error", function (e) { sendJson(res, 500, { error: e.message }); });
  });

  app.post("/api/rec/:id/part/:n/end", function (req, res) {
    readBody(req, function (b) {
      var x = loadSession(req.params.id), n = parseInt(req.params.n, 10);
      if (!x || !b) return sendJson(res, 404, { error: "no such recording" });
      var p = x.s.parts.filter(function (q) { return q.n === n; })[0];
      if (!p) return sendJson(res, 404, { error: "no such part" });
      if (Number(b.startedAt)) p.startedAt = Number(b.startedAt);
      p.endedAt = Number(b.endedAt) || Date.now();
      try { p.bytes = fs.statSync(path.join(x.dir, p.file)).size; } catch (e) {}
      saveSession(x);
      sendJson(res, 200, { ok: true });
      dropLiveCopies(x.dir, p.file);
      makeSeekable(x.dir, p.file, function (err) {
        if (err) console.warn("[recorder] couldn't index " + p.file + ": " + err.message);
      });
    });
  });

  // ⏸ Paused (the file so far ended - no new one till it goes on) and ▶ going on: the same recording
  app.post("/api/rec/:id/pause", function (req, res) {
    readBody(req, function (b) {
      var x = loadSession(req.params.id);
      if (!x) return sendJson(res, 404, { error: "no such recording" });
      if (!x.s.endedAt && !x.s.pausedAt) {
        x.s.pausedAt = (b && Number(b.at)) || Date.now();
        x.s.pauses = (x.s.pauses || []).concat([{ from: x.s.pausedAt, to: null }]);
        saveSession(x);
      }
      sendJson(res, 200, { ok: true });
    });
  });
  app.post("/api/rec/:id/resume", function (req, res) {
    readBody(req, function (b) {
      var x = loadSession(req.params.id);
      if (!x) return sendJson(res, 404, { error: "no such recording" });
      if (x.s.pausedAt) {
        var last = (x.s.pauses || [])[x.s.pauses.length - 1];
        if (last && !last.to) last.to = (b && Number(b.at)) || Date.now();
        x.s.pausedAt = null;
        saveSession(x);
      }
      sendJson(res, 200, { ok: true });
    });
  });

  app.post("/api/rec/:id/stop", function (req, res) {
    readBody(req, function (b) {
      var x = loadSession(req.params.id);
      if (!x) return sendJson(res, 404, { error: "no such recording" });
      x.s.endedAt = (b && Number(b.endedAt)) || Date.now();
      x.s.pausedAt = null;
      saveSession(x);
      sendJson(res, 200, { ok: true });
    });
  });

  app.get("/api/rec/sessions", function (req, res) {
    var list = [];
    try {
      fs.readdirSync(root()).forEach(function (n) {
        var x = loadSession(n);
        if (!x) return;
        // (no end yet: when its last file was written - recording still, or never stopped)
        var last = x.s.parts[x.s.parts.length - 1];
        if (!x.s.endedAt && last) try { x.s.writtenAt = fs.statSync(path.join(x.dir, last.file)).mtimeMs; } catch (e) {}
        list.push(x.s);
      });
    } catch (e) {}
    list.sort(function (a, b) { return b.startedAt - a.startedAt; });
    sendJson(res, 200, { folder: root(), sessions: list });
  });

  // A recording goes to the Trash (it can be put back from there) - its
  // cues with it, the clips already exported stay. Not while it records:
  // no end yet and a file written in the last minute (a recording that
  // was never stopped - the computer slept, the page closed - can go).
  app.delete("/api/rec/sessions/:id", function (req, res) {
    var x = loadSession(req.params.id);
    if (!x) return sendJson(res, 404, { error: "no such recording" });
    if (!x.s.endedAt) {
      var latest = 0;
      try { fs.readdirSync(x.dir).forEach(function (n) { latest = Math.max(latest, fs.statSync(path.join(x.dir, n)).mtimeMs); }); } catch (e) {}
      if (Date.now() - latest < 60000) return sendJson(res, 409, { error: "it's still recording - stop it first" });
    }
    var done;
    try { done = trashSession(req.params.id, x); } catch (e) { return sendJson(res, 500, { error: "couldn't move it to the Trash (" + e.message + ")" }); }
    sendJson(res, 200, { ok: true, trash: done.trash, cues: done.cues });
  });

  app.get("/api/rec/:id/file/:name", function (req, res) {
    var x = loadSession(req.params.id), name = req.params.name;
    if (!x || !/^part-\d{3,4}\.(mp4|webm)$/.test(name)) return sendJson(res, 404, { error: "not found" });
    var send = function (file) { res.sendFile(file, { headers: { "Cache-Control": "no-store" } }, function (err) { if (err && !res.headersSent) sendJson(res, 404, { error: "not found" }); }); };
    // (the file still being recorded, to jump around in: a copy of it as it is now)
    var part = x.s.parts.filter(function (p) { return p.file === name; })[0], token = String(req.query.live || "").slice(0, 40);
    if (token && part && !part.endedAt && ffmpeg()) {
      return liveCopy(x.dir, name, token, function (err, file) { send(err ? path.join(x.dir, name) : file); });
    }
    send(path.join(x.dir, name));
  });

  app.get("/api/rec/cues", function (req, res) {
    var cues = loadCues().slice().sort(function (a, b) { return (b.markedAt || 0) - (a.markedAt || 0); });
    sendJson(res, 200, { cues: cues, ffmpeg: !!ffmpeg() });
  });

  // (kind: "game" - a game mark, the moment a game started; none - a cue)
  // (keep: 📌 kept for good - its clip cut, never cleaned up, not deleted with its recording)
  var CUE_FIELDS = ["name", "kind", "keep", "player", "opponent", "matchup", "gameType", "gameLabel", "position", "note", "startedAt", "markedAt", "endedAt", "duration", "source", "session", "customName", "shotAt", "shotEndedAt", "cameraShooter"];
  function pickCue(b, into) {
    CUE_FIELDS.forEach(function (k) {
      if (b[k] === undefined) return;
      into[k] = typeof b[k] === "number" || typeof b[k] === "boolean" ? b[k] : b[k] === null ? null : String(b[k]).slice(0, 300);
    });
    return into;
  }
  app.post("/api/rec/cues", function (req, res) {
    readBody(req, function (b) {
      if (!b) return sendJson(res, 400, { error: "bad request" });
      var cues = loadCues();
      var cue = pickCue(b, { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), createdAt: Date.now() });
      cues.push(cue);
      saveCues(cues);
      sendJson(res, 200, cue);
    });
  });
  app.patch("/api/rec/cues/:cue", function (req, res) {
    readBody(req, function (b) {
      var cues = loadCues(), cue = cues.filter(function (c) { return c.id === req.params.cue; })[0];
      if (!cue || !b) return sendJson(res, 404, { error: "no such cue" });
      pickCue(b, cue);
      saveCues(cues);
      sendJson(res, 200, cue);
    });
  });
  app.delete("/api/rec/cues/:cue", function (req, res) {
    var cues = loadCues(), left = cues.filter(function (c) { return c.id !== req.params.cue; });
    if (left.length === cues.length) return sendJson(res, 404, { error: "no such cue" });
    saveCues(left);
    sendJson(res, 200, { ok: true });
  });
  app.post("/api/rec/cues/:cue/clip", function (req, res) {
    var cues = loadCues(), cue = cues.filter(function (c) { return c.id === req.params.cue; })[0];
    if (!cue) return sendJson(res, 404, { error: "no such cue" });
    if (cue.kind === "game") return sendJson(res, 400, { error: "a game mark is a moment, not a clip" });
    cutClip(cue, function (err, name) {
      if (err) return sendJson(res, 500, { error: err.message });
      cue.clip = name;
      saveCues(cues);
      sendJson(res, 200, { file: name, folder: clipsDir() });
    });
  });
  // ✨ Tonight's highlights (P35): the clips the app picked, cut and joined
  // into one reel with their score bugs - server/reel.js
  app.post("/api/rec/reel", function (req, res) {
    readBody(req, function (body) {
      if (!body || !Array.isArray(body.clips)) return sendJson(res, 400, { error: "no clips" });
      buildHighlightReel(body, function (err, r) {
        if (err) return sendJson(res, 500, { error: err.message });
        sendJson(res, 200, { file: r.file, seconds: r.seconds, clips: r.clips, skipped: r.skipped, folder: path.dirname(r.path) });
      });
    }, MAX_REEL_JSON);
  });
  app.get("/api/rec/highlights/:name", function (req, res) {
    var name = req.params.name;
    if (!/^[^\/\\]+\.mp4$/.test(name)) return sendJson(res, 404, { error: "not found" });
    res.sendFile(path.join(root(), "Highlights", name), { headers: { "Cache-Control": "no-store" } }, function (err) { if (err && !res.headersSent) sendJson(res, 404, { error: "not found" }); });
  });
  app.get("/api/rec/clips/:name", function (req, res) {
    var name = req.params.name;
    if (!/^[^\/\\]+\.mp4$/.test(name)) return sendJson(res, 404, { error: "not found" });
    res.sendFile(path.join(clipsDir(), name), { headers: { "Cache-Control": "no-store" } }, function (err) { if (err && !res.headersSent) sendJson(res, 404, { error: "not found" }); });
  });
}

// body: { clips: [{ from, to, bug: "data:image/png;base64,..." }], aspect, sound, name }
function buildHighlightReel(body, cb) {
  var clips = body.clips.slice(0, 40).map(function (c) {
    var m = /^data:image\/png;base64,([A-Za-z0-9+\/=]+)$/.exec(String((c && c.bug) || ""));
    return { from: Number(c && c.from), to: Number(c && c.to), bug: m ? Buffer.from(m[1], "base64") : null };
  }).filter(function (c) { return c.from > 0 && c.to > c.from && c.to - c.from <= 120000; });
  reel.buildReel({ ffmpeg: ffmpeg, runFfmpeg: runFfmpeg, piecesFor: piecesFor, root: root }, {
    clips: clips,
    aspect: body.aspect === "9:16" ? "9:16" : "16:9",
    sound: body.sound === true,
    size: Number(body.size) || 1080,
    name: String(body.name || "Highlights").slice(0, 100)
  }, cb);
}

module.exports = { attachRecorderRoutes: attachRecorderRoutes, _piecesFor: piecesFor, _applyRetention: applyRetention, _buildHighlightReel: buildHighlightReel, _makeDueCueFolders: makeDueCueFolders, _buildCueFolder: buildCueFolder, _deleteCueFolder: deleteCueFolder, _listCueFolders: listCueFolders, _cueFolderName: cueFolderName };
