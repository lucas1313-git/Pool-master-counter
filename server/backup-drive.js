// Backups into the Google Drive folder the user linked (Backup & Transfer's
// Drive folder link). Google Drive connected (their own OAuth client, see
// google-drive.js): uploaded through the Drive API - from any device. Else,
// with Google Drive for desktop on this computer, every
// synced folder is a real folder under ~/Library/CloudStorage/GoogleDrive-
// <account>, marked with its Drive id (the extended attribute
// com.google.drivefs.item-id#S) - so the folder in the link is found by its
// id and the backup is written straight into it; Drive uploads it.
// Not synced here (or no Drive for desktop): the backup is kept in
// ~/Documents/Pool Master Counter Backups and - asked from this computer -
// put on the clipboard as a file, ready to paste where it should go.
//
//   GET  /api/backup/drive?link=...           where a backup would go -> { folder, where, via } | { reason }
//   GET  /api/backup/from-link?url=...       a backup from a link -> { kind: "file", text } |
//                                            { kind: "folder", name, files: [{ id, name, modifiedTime }] }
//   GET  /api/backup/from-link/file?url=...&id=...   one backup of that folder (its text)
//   POST /api/backup/drive  { link, filename, content, copy }
//        -> { saved: true, file, where, via: "api" | "desktop" }   (in the Drive folder)
//        -> { saved: false, reason, file, kept, copied }    (kept in Documents; on the clipboard)
// Like the camera relay: no login, the local network only.

var fs = require("fs");
var path = require("path");
var os = require("os");
var childProcess = require("child_process");
var googleDrive = require("./google-drive");

var MAX_BODY = 200 * 1024 * 1024;
var ATTR = "com.google.drivefs.item-id#S";
var SEARCH_MAX_DIRS = 5000, SEARCH_MAX_DEPTH = 7, SEARCH_MAX_MS = 25000, BATCH = 200;
var found = {};   // folder id -> local path (checked again before each use)
var missing = {}; // folder id -> when a search last didn't find it (not searched again for a while)
var MISSING_MS = 10 * 60 * 1000;
var searching = {}; // folder id -> callbacks waiting for the search under way

function cloudRoot() { return process.env.PMC_CLOUD_STORAGE || path.join(os.homedir(), "Library", "CloudStorage"); }
function keptDir() { return path.join(os.homedir(), "Documents", "Pool Master Counter Backups"); }

// the folder id in a Drive folder link: .../folders/<id>, ...?id=<id>, or
// the bare id (as js/app.js's extractDriveFolderId reads it)
function folderIdFromLink(link) {
  var s = String(link || "").trim(), m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}
function safeFileName(name) {
  var n = String(name || "").replace(/[\/\\:*?"<>|\x00-\x1f]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 150);
  if (!n) n = "pool-master-counter-backup";
  return /\.json$/i.test(n) ? n : n + ".json";
}
function uniquePath(dir, name) {
  var p = path.join(dir, name), k = 2, base = name.replace(/\.json$/i, "");
  while (fs.existsSync(p)) p = path.join(dir, base + " (" + k++ + ").json");
  return p;
}

// the Drive ids of these folders, read in one go
function readIds(dirs, cb) {
  if (!dirs.length) return cb({});
  childProcess.execFile("/usr/bin/xattr", ["-p", ATTR].concat(dirs), { maxBuffer: 8 * 1024 * 1024, timeout: 15000 }, function (err, stdout) {
    var ids = {}, lines = String(stdout || "").split("\n");
    if (dirs.length === 1) { var v = lines[0] && lines[0].trim(); if (v) ids[dirs[0]] = v; return cb(ids); }
    // "path: id" per line (a path may hold ": " itself - match the known paths)
    lines.forEach(function (line) {
      for (var i = 0; i < dirs.length; i++) {
        if (line.indexOf(dirs[i] + ": ") === 0) { ids[dirs[i]] = line.slice(dirs[i].length + 2).trim(); break; }
      }
    });
    cb(ids);
  });
}
function idOf(dir, cb) { readIds([dir], function (ids) { cb(ids[dir] || null); }); }

// where to look: each account's My Drive and shared drives
function startDirs() {
  var out = [];
  try {
    fs.readdirSync(cloudRoot()).forEach(function (acc) {
      if (!/^GoogleDrive-/.test(acc)) return;
      var base = path.join(cloudRoot(), acc);
      ["My Drive", "Shared drives"].forEach(function (top) { var p = path.join(base, top); if (fs.existsSync(p)) out.push({ dir: p, depth: 0 }); });
    });
  } catch (e) {}
  return out;
}
function describeApi(name) { var a = googleDrive.account(); return "Google Drive" + (a ? " (" + a + ")" : "") + " › " + name; }
function describe(dir) {
  var rel = path.relative(cloudRoot(), dir).split(path.sep), acc = (rel.shift() || "").replace(/^GoogleDrive-/, "");
  return "Google Drive (" + acc + ") › " + rel.join(" › ");
}

// breadth first, a level at a time, the ids read in batches - one search
// at a time per folder, a miss remembered for 10 minutes
function findFolder(id, cb) {
  if (!found[id] && missing[id] && Date.now() - missing[id].at < MISSING_MS) return cb(null, missing[id].why);
  if (searching[id]) { searching[id].push(cb); return; }
  searching[id] = [cb];
  searchFolder(id, function (dir, why) {
    var waiting = searching[id] || [];
    delete searching[id];
    if (dir) delete missing[id];
    else missing[id] = { at: Date.now(), why: why };
    waiting.forEach(function (f) { f(dir, why); });
  });
}
function searchFolder(id, cb) {
  if (found[id]) {
    var known = found[id];
    return idOf(known, function (v) { if (v === id && fs.existsSync(known)) return cb(known); delete found[id]; searchFolder(id, cb); });
  }
  var level = startDirs(), seen = 0, began = Date.now();
  if (!level.length) return cb(null, "no-drive");
  (function next() {
    if (!level.length || seen > SEARCH_MAX_DIRS || Date.now() - began > SEARCH_MAX_MS) return cb(null, "not-synced");
    var dirs = level.map(function (x) { return x.dir; }), batches = [], ids = {};
    for (var i = 0; i < dirs.length; i += BATCH) batches.push(dirs.slice(i, i + BATCH));
    (function readBatch(k) {
      if (k < batches.length) return readIds(batches[k], function (r) { Object.assign(ids, r); readBatch(k + 1); });
      for (var j = 0; j < dirs.length; j++) if (ids[dirs[j]] === id) { found[id] = dirs[j]; return cb(dirs[j]); }
      var deeper = [];
      level.forEach(function (x) {
        if (x.depth >= SEARCH_MAX_DEPTH) return;
        var names = [];
        try { names = fs.readdirSync(x.dir, { withFileTypes: true }); } catch (e) {}
        names.forEach(function (d) { if (d.isDirectory() && d.name[0] !== ".") deeper.push({ dir: path.join(x.dir, d.name), depth: x.depth + 1 }); });
      });
      seen += dirs.length;
      level = deeper;
      next();
    })(0);
  })();
}

function readBody(req, cb) {
  var chunks = [], size = 0, done = false;
  req.on("data", function (c) { size += c.length; if (size > MAX_BODY) { done = true; req.destroy(); cb(null); return; } chunks.push(c); });
  req.on("end", function () { if (done) return; done = true; try { cb(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { cb(null); } });
  req.on("error", function () { if (!done) { done = true; cb(null); } });
}
function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
function fromThisComputer(req) {
  var a = (req.socket && req.socket.remoteAddress) || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}
// the file itself on the clipboard (Finder: ⌘V pastes it)
function copyFileToClipboard(file, cb) {
  // (tests: written down instead of touching the real clipboard)
  if (process.env.PMC_CLIPBOARD_FILE) { try { fs.writeFileSync(process.env.PMC_CLIPBOARD_FILE, file); return cb(true); } catch (e) { return cb(false); } }
  if (process.platform !== "darwin") return cb(false);
  var script = 'set the clipboard to (POSIX file "' + file.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '")';
  childProcess.execFile("/usr/bin/osascript", ["-e", script], { timeout: 10000 }, function (err) { cb(!err); });
}

// ---- a backup from a link (Restore › From a link), fetched here - a
// browser may not read another site's file (Google Drive's least of all):
// a Google Drive file (signed in, or shared "anyone with the link"), a
// Google Drive folder (signed in, or synced on this computer by Drive for
// desktop - its backups listed), or any web address.
var LINK_MAX = 100 * 1024 * 1024;
function driveFileIdFromLink(link) {
  var s = String(link || ""), m = s.match(/drive\.google\.com\/(?:file\/d|uc|open)(?:\/([A-Za-z0-9_-]{10,}))?(?:[^?#]*)?(?:\?[^#]*?\bid=([A-Za-z0-9_-]{10,}))?/);
  if (m && (m[1] || m[2])) return m[1] || m[2];
  m = s.match(/docs\.google\.com\/[^?#]*\/d\/([A-Za-z0-9_-]{10,})/);
  return m ? m[1] : null;
}
// (only addresses out on the internet - never this computer's own network)
function publicUrl(link) {
  var u;
  try { u = new URL(String(link || "").trim()); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  var h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || /\.local$/.test(h) || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1" || /^f[cd]/.test(h) || /^fe80:/.test(h)) return null;
  return u.href;
}
function fetchText(url) {
  return fetch(url, { redirect: "follow", headers: { "User-Agent": "PoolMasterCounter" } }).then(function (r) {
    if (!r.ok) throw new Error("the link answered " + r.status);
    var len = Number(r.headers.get("content-length") || 0);
    if (len > LINK_MAX) throw new Error("that file is too big for a backup");
    return r.text();
  });
}
function looksLikeBackup(text) { var t = String(text || "").trim(); return t.charAt(0) === "{"; }
function localFolderFiles(dir) {
  return fs.readdirSync(dir).filter(function (n) { return /\.json$/i.test(n); }).map(function (n) {
    var st = fs.statSync(path.join(dir, n));
    return { id: "local:" + n, name: n, modifiedTime: new Date(st.mtimeMs).toISOString() };
  }).sort(function (a, b) { return a.modifiedTime < b.modifiedTime ? 1 : -1; }).slice(0, 100);
}

function attachBackupDriveRoutes(app) {
  app.get("/api/backup/from-link", function (req, res) {
    var link = String((req.query && req.query.url) || "").trim();
    var folderId = /\/folders\//.test(link) ? folderIdFromLink(link) : null, fileId = folderId ? null : driveFileIdFromLink(link);
    var fail = function (e, code) { sendJson(res, 200, { error: code || "unreadable", message: e && e.message ? e.message : String(e || "") }); };
    if (folderId) {
      var local = function () {
        findFolder(folderId, function (dir) {
          if (!dir) return fail(null, "folder-unreachable");
          try { sendJson(res, 200, { kind: "folder", name: path.basename(dir), files: localFolderFiles(dir) }); } catch (e) { fail(e); }
        });
      };
      // (signed in: only the folder backups go to - never the rest of the Drive)
      if (!googleDrive.connected() || folderId !== googleDrive.backupFolderId()) return local();
      return Promise.all([googleDrive.folderInfo(folderId), googleDrive.listFolder(folderId)])
        .then(function (r) { sendJson(res, 200, { kind: "folder", name: r[0].name, files: r[1] }); }, local);
    }
    if (fileId) {
      var publicCopy = function () {
        fetchText("https://drive.google.com/uc?export=download&id=" + encodeURIComponent(fileId)).then(function (text) {
          if (!looksLikeBackup(text)) return fail(null, "drive-not-shared");
          sendJson(res, 200, { kind: "file", text: text });
        }, function () { fail(null, "drive-not-shared"); });
      };
      if (!googleDrive.connected()) return publicCopy();
      // (signed in: a file in the backups folder; anything else only if it's shared with anyone)
      return googleDrive.inBackupFolder(fileId).then(function (ok) {
        if (!ok) return publicCopy();
        return googleDrive.download(fileId).then(function (text) { sendJson(res, 200, { kind: "file", text: text }); }, publicCopy);
      });
    }
    var url = publicUrl(link);
    if (!url) return fail(null, "bad-link");
    fetchText(url).then(function (text) {
      if (!looksLikeBackup(text)) return fail(null, "not-a-backup");
      sendJson(res, 200, { kind: "file", text: text });
    }, function (e) { fail(e); });
  });

  app.get("/api/backup/from-link/file", function (req, res) {
    var q = req.query || {}, folderId = folderIdFromLink(q.url), id = String(q.id || "");
    var send = function (text) { res.statusCode = 200; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.setHeader("Cache-Control", "no-store"); res.end(text); };
    if (!folderId || !id) return sendJson(res, 400, { error: "bad request" });
    if (id.indexOf("local:") === 0) {
      var name = id.slice(6);
      if (!/^[^\/\\]+\.json$/i.test(name)) return sendJson(res, 400, { error: "bad name" });
      return findFolder(folderId, function (dir) {
        if (!dir) return sendJson(res, 404, { error: "folder-unreachable" });
        fs.readFile(path.join(dir, name), "utf8", function (err, text) { if (err) return sendJson(res, 404, { error: "not found" }); send(text); });
      });
    }
    if (!googleDrive.connected() || !/^[A-Za-z0-9_-]{10,}$/.test(id)) return sendJson(res, 409, { error: "not signed in" });
    if (folderId !== googleDrive.backupFolderId()) return sendJson(res, 403, { error: "only the backups folder" });
    googleDrive.inBackupFolder(id).then(function (ok) {
      if (!ok) return sendJson(res, 403, { error: "only the backups folder" });
      googleDrive.download(id).then(send, function (e) { sendJson(res, 502, { error: e.message }); });
    });
  });

  app.get("/api/backup/drive", function (req, res) {
    var link = (req.query && req.query.link) || "";
    var id = folderIdFromLink(link);
    if (!id) return sendJson(res, 200, { reason: link ? "not-a-folder-link" : "no-link" });
    var local = function (apiError) {
      findFolder(id, function (dir, why) {
        if (dir) return sendJson(res, 200, { folder: path.basename(dir), where: describe(dir), via: "desktop", apiError: apiError || null });
        sendJson(res, 200, { reason: why || "not-synced", kept: keptDir(), apiError: apiError || null });
      });
    };
    if (!googleDrive.connected()) return local();
    googleDrive.folderInfo(id).then(function (f) {
      if (f.mimeType && f.mimeType !== "application/vnd.google-apps.folder") return local("not a folder");
      sendJson(res, 200, { folder: f.name, where: describeApi(f.name), via: "api" });
    }, function (e) { local(e.message); });
  });

  app.post("/api/backup/drive", function (req, res) {
    readBody(req, function (b) {
      if (!b || typeof b.content !== "string" || !b.content) return sendJson(res, 400, { error: "nothing to save" });
      var name = safeFileName(b.filename), id = folderIdFromLink(b.link);
      var keep = function (reason) {
        var file;
        try { fs.mkdirSync(keptDir(), { recursive: true }); file = uniquePath(keptDir(), name); fs.writeFileSync(file, b.content); }
        catch (e) { return sendJson(res, 500, { error: "couldn't keep the backup (" + e.message + ")" }); }
        if (!b.copy || !fromThisComputer(req)) return sendJson(res, 200, { saved: false, reason: reason, file: path.basename(file), kept: keptDir(), copied: false });
        copyFileToClipboard(file, function (ok) { sendJson(res, 200, { saved: false, reason: reason, file: path.basename(file), kept: keptDir(), copied: ok }); });
      };
      if (!id) return keep(b.link ? "not-a-folder-link" : "no-link");
      // (the folder backups go to - the one folder this server reads when signed in)
      googleDrive.setBackupFolder(id);
      var local = function () {
        findFolder(id, function (dir, why) {
          if (!dir) return keep(why || "not-synced");
          var file;
          try { file = uniquePath(dir, name); fs.writeFileSync(file, b.content); }
          catch (e) { return keep("write-failed"); }
          sendJson(res, 200, { saved: true, file: path.basename(file), folder: path.basename(dir), where: describe(dir), via: "desktop" });
        });
      };
      // connected: straight up through the Drive API (no luck: as before)
      if (!googleDrive.connected()) return local();
      googleDrive.upload(id, name, b.content).then(function (f) {
        // (uploaded: its folder's name only for saying so)
        var done = function (folder) { sendJson(res, 200, { saved: true, file: f.name || name, folder: folder, where: describeApi(folder), via: "api" }); };
        googleDrive.folderInfo(id).then(function (info) { done(info.name); }, function () { done("Drive"); });
      }, function (e) { console.warn("[backup] Drive upload failed (" + e.message + ") - trying this computer's Drive folder"); local(); });
    });
  });
}

module.exports = { attachBackupDriveRoutes: attachBackupDriveRoutes, _folderIdFromLink: folderIdFromLink, _driveFileIdFromLink: driveFileIdFromLink, _publicUrl: publicUrl };
