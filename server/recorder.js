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
//   GET    /api/rec/sessions                 every recording, newest first
//   GET    /api/rec/:id/file/:name           a part (seekable: Range requests)
//   GET    /api/rec/cues                     every cue, newest first
//   POST   /api/rec/cues                     a new cue -> the cue (with its id)
//   PATCH  /api/rec/cues/:cue                change it (finish it, rename it)
//   DELETE /api/rec/cues/:cue
//   POST   /api/rec/cues/:cue/clip           cut it out -> { file }
//   GET    /api/rec/clips/:name              a clip
//   GET    /api/rec/info                     where it all goes, ffmpeg or not
// Like the camera relay: no login, the local network only.

var fs = require("fs");
var path = require("path");
var os = require("os");
var childProcess = require("child_process");

var MAX_JSON = 256 * 1024;

function root() { return path.join(os.homedir(), "Movies", "Pool Master Counter"); }
function cuesFile() { return path.join(root(), "cues.json"); }
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
function readBody(req, cb) {
  var chunks = [], size = 0, done = false;
  req.on("data", function (c) { size += c.length; if (size > MAX_JSON) { done = true; req.destroy(); cb(null); return; } chunks.push(c); });
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
    (x.s.parts || []).forEach(function (p) {
      if (!p.startedAt || !p.endedAt || p.endedAt <= from || p.startedAt >= to) return;
      pieces.push({ file: path.join(x.dir, p.file), at: p.startedAt, from: Math.max(0, (from - p.startedAt) / 1000), to: (Math.min(to, p.endedAt) - p.startedAt) / 1000 });
    });
  });
  pieces.sort(function (a, b) { return a.at - b.at; });
  return pieces;
}

function cutClip(cue, cb) {
  if (!cue.startedAt || !cue.endedAt) return cb(new Error("the cue isn't finished"));
  var pieces = piecesFor(cue.startedAt, cue.endedAt);
  if (!pieces.length) return cb(new Error("no recording covers that moment"));
  fs.mkdirSync(clipsDir(), { recursive: true });
  var name = safeFileName(cue.name) + ".mp4", out = path.join(clipsDir(), name);
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

function attachRecorderRoutes(app) {
  app.get("/api/rec/info", function (req, res) {
    sendJson(res, 200, { folder: root(), ffmpeg: !!ffmpeg() });
  });

  app.post("/api/rec/start", function (req, res) {
    readBody(req, function (b) {
      if (!b) return sendJson(res, 400, { error: "bad request" });
      fs.mkdirSync(root(), { recursive: true });
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
      makeSeekable(x.dir, p.file, function (err) {
        if (err) console.warn("[recorder] couldn't index " + p.file + ": " + err.message);
      });
    });
  });

  app.post("/api/rec/:id/stop", function (req, res) {
    readBody(req, function (b) {
      var x = loadSession(req.params.id);
      if (!x) return sendJson(res, 404, { error: "no such recording" });
      x.s.endedAt = (b && Number(b.endedAt)) || Date.now();
      saveSession(x);
      sendJson(res, 200, { ok: true });
    });
  });

  app.get("/api/rec/sessions", function (req, res) {
    var list = [];
    try {
      fs.readdirSync(root()).forEach(function (n) {
        var x = loadSession(n);
        if (x) list.push(x.s);
      });
    } catch (e) {}
    list.sort(function (a, b) { return b.startedAt - a.startedAt; });
    sendJson(res, 200, { folder: root(), sessions: list });
  });

  app.get("/api/rec/:id/file/:name", function (req, res) {
    var x = loadSession(req.params.id), name = req.params.name;
    if (!x || !/^part-\d{3,4}\.(mp4|webm)$/.test(name)) return sendJson(res, 404, { error: "not found" });
    res.sendFile(path.join(x.dir, name), { headers: { "Cache-Control": "no-store" } }, function (err) { if (err && !res.headersSent) sendJson(res, 404, { error: "not found" }); });
  });

  app.get("/api/rec/cues", function (req, res) {
    var cues = loadCues().slice().sort(function (a, b) { return (b.markedAt || 0) - (a.markedAt || 0); });
    sendJson(res, 200, { cues: cues, ffmpeg: !!ffmpeg() });
  });

  var CUE_FIELDS = ["name", "player", "gameType", "gameLabel", "position", "note", "startedAt", "markedAt", "endedAt", "duration", "source", "session"];
  function pickCue(b, into) {
    CUE_FIELDS.forEach(function (k) {
      if (b[k] === undefined) return;
      into[k] = typeof b[k] === "number" ? b[k] : b[k] === null ? null : String(b[k]).slice(0, 300);
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
    cutClip(cue, function (err, name) {
      if (err) return sendJson(res, 500, { error: err.message });
      cue.clip = name;
      saveCues(cues);
      sendJson(res, 200, { file: name, folder: clipsDir() });
    });
  });
  app.get("/api/rec/clips/:name", function (req, res) {
    var name = req.params.name;
    if (!/^[^\/\\]+\.mp4$/.test(name)) return sendJson(res, 404, { error: "not found" });
    res.sendFile(path.join(clipsDir(), name), { headers: { "Cache-Control": "no-store" } }, function (err) { if (err && !res.headersSent) sendJson(res, 404, { error: "not found" }); });
  });
}

module.exports = { attachRecorderRoutes: attachRecorderRoutes, _piecesFor: piecesFor };
