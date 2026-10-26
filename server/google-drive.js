// Google Drive through the user's own OAuth client - the client ID and
// secret they made in Google Cloud, typed once into Backup & Transfer on
// this computer. This server signs in for them (authorization code + PKCE,
// offline access) and keeps the refresh token in
// ~/.pool-master-counter/google-drive.json (readable by this user only -
// never sent to a browser, never in a backup). Then, for any device using
// this scoreboard: the folder's files listed and read (Import), and every
// backup uploaded into the folder (server/backup-drive.js).
//
//   GET  /api/drive/status                 { configured, connected, account, redirectUri, local }
//   POST /api/drive/config                 { clientId, clientSecret }   (this computer only)
//   GET  /api/drive/connect                -> Google's sign-in            (this computer only)
//   GET  /api/drive/oauth/callback         Google comes back here
//   POST /api/drive/disconnect             { forget }                    (this computer only)
//   GET  /api/drive/folder?link=...        { name, files: [{ id, name, modifiedTime, size }] }
//   GET  /api/drive/file/:id               the file's content
// The Google addresses can be pointed elsewhere for tests (PMC_GOOGLE_*).

var fs = require("fs");
var path = require("path");
var os = require("os");
var crypto = require("crypto");

var SCOPE = "https://www.googleapis.com/auth/drive";
function authUrl() { return process.env.PMC_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth"; }
function tokenUrl() { return process.env.PMC_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token"; }
function revokeUrl() { return process.env.PMC_GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke"; }
function apiBase() { return (process.env.PMC_GOOGLE_API || "https://www.googleapis.com").replace(/\/$/, ""); }
function configFile() { return path.join(os.homedir(), ".pool-master-counter", "google-drive.json"); }

var httpPort = 4173;
var access = null;   // { token, expiresAt }
var pending = {};    // sign-ins under way: state -> { verifier, at }

function loadConfig() { try { return JSON.parse(fs.readFileSync(configFile(), "utf8")) || {}; } catch (e) { return {}; } }
function saveConfig(c) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(c, null, 2), { mode: 0o600 });
  try { fs.chmodSync(configFile(), 0o600); } catch (e) {}
}
function redirectUri() { return "http://localhost:" + httpPort + "/api/drive/oauth/callback"; }
function connected() { var c = loadConfig(); return !!(c.clientId && c.clientSecret && c.refreshToken); }

function folderIdFromLink(link) {
  var s = String(link || "").trim(), m = s.match(/\/folders\/([A-Za-z0-9_-]{10,})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m) return m[1];
  return /^[A-Za-z0-9_-]{10,}$/.test(s) ? s : null;
}
function form(obj) { return Object.keys(obj).map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&"); }
function b64url(buf) { return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

function tokenRequest(fields) {
  return fetch(tokenUrl(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form(fields) })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.error) { var e = new Error(j.error_description || j.error || "token " + r.status); e.code = j.error; throw e; } return j; }); });
}
// a fresh access token (an hour long) from the refresh token
function accessToken() {
  if (access && access.expiresAt - Date.now() > 60000) return Promise.resolve(access.token);
  var c = loadConfig();
  if (!c.refreshToken) return Promise.reject(new Error("not connected"));
  return tokenRequest({ client_id: c.clientId, client_secret: c.clientSecret, refresh_token: c.refreshToken, grant_type: "refresh_token" })
    .then(function (j) { access = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 }; return access.token; })
    .catch(function (e) {
      // the sign-in was withdrawn or ran out (Google: "invalid_grant"): connect again
      if (e.code === "invalid_grant") { var c2 = loadConfig(); delete c2.refreshToken; c2.lostAt = Date.now(); saveConfig(c2); access = null; }
      throw e;
    });
}
function api(method, url, opts) {
  opts = opts || {};
  var go = function (retry) {
    return accessToken().then(function (token) {
      var headers = Object.assign({ Authorization: "Bearer " + token }, opts.headers || {});
      return fetch(url, { method: method, headers: headers, body: opts.body, redirect: "follow" }).then(function (r) {
        if (r.status === 401 && retry) { access = null; return go(false); }
        return r;
      });
    });
  };
  return go(true);
}
function apiJson(method, url, opts) {
  return api(method, url, opts).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) {
      if (!r.ok) throw new Error((j.error && j.error.message) || "Drive " + r.status);
      return j;
    });
  });
}
var D = function (p) { return apiBase() + "/drive/v3/" + p; };

function folderInfo(folderId) {
  return apiJson("GET", D("files/" + encodeURIComponent(folderId) + "?fields=id,name,mimeType&supportsAllDrives=true"));
}
function listFolder(folderId) {
  var q = "'" + folderId.replace(/'/g, "") + "' in parents and trashed=false and mimeType != 'application/vnd.google-apps.folder'";
  return apiJson("GET", D("files?q=" + encodeURIComponent(q) + "&fields=" + encodeURIComponent("files(id,name,modifiedTime,size,mimeType)") + "&orderBy=modifiedTime desc&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true"))
    .then(function (j) { return (j.files || []).filter(function (f) { return /\.json$/i.test(f.name) || f.mimeType === "application/json"; }); });
}
function download(fileId) {
  return api("GET", D("files/" + encodeURIComponent(fileId) + "?alt=media&supportsAllDrives=true")).then(function (r) {
    if (!r.ok) throw new Error("Drive " + r.status);
    return r.text();
  });
}
// a resumable upload (any size): where to send it, then the file
function upload(folderId, name, content) {
  var meta = JSON.stringify({ name: name, parents: [folderId], mimeType: "application/json" });
  var bytes = Buffer.from(content, "utf8");
  return api("POST", apiBase() + "/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name", {
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/json", "X-Upload-Content-Length": String(bytes.length) }, body: meta
  }).then(function (r) {
    var where = r.headers.get("location");
    if (!r.ok || !where) return r.text().then(function (t) { var m = ""; try { m = JSON.parse(t).error.message; } catch (e) {} throw new Error(m || "Drive " + r.status); });
    return accessToken().then(function (token) {
      return fetch(where, { method: "PUT", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: bytes });
    });
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error((j.error && j.error.message) || "Drive " + r.status); return j; });
  });
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}
function sendPage(res, ok, text) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  var safe = String(text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google Drive</title>' +
    '<body style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#1a0a0a;color:#f6efe9;display:flex;align-items:center;justify-content:center;min-height:90vh;text-align:center">' +
    '<div><div style="font-size:3rem">' + (ok ? "✅" : "⚠️") + '</div><h2 style="color:#e8b923">' + safe + '</h2><p>You can close this tab and go back to the scoreboard.</p></div>' +
    '<script>try { new BroadcastChannel("pmc-drive").postMessage("changed"); } catch (e) {} ' + (ok ? "setTimeout(function () { window.close(); }, 2500);" : "") + '</script></body>');
}
function readBody(req, cb) {
  var chunks = [], size = 0, done = false;
  req.on("data", function (c) { size += c.length; if (size > 64 * 1024) { done = true; req.destroy(); cb(null); return; } chunks.push(c); });
  req.on("end", function () { if (done) return; done = true; try { cb(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { cb(null); } });
  req.on("error", function () { if (!done) { done = true; cb(null); } });
}
function fromThisComputer(req) {
  var a = (req.socket && req.socket.remoteAddress) || "";
  return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
}

function attachGoogleDriveRoutes(app, port) {
  if (port) httpPort = port;

  app.get("/api/drive/status", function (req, res) {
    var c = loadConfig();
    sendJson(res, 200, { configured: !!(c.clientId && c.clientSecret), connected: !!(c.clientId && c.clientSecret && c.refreshToken), account: c.refreshToken ? c.account || null : null,
      lost: !c.refreshToken && !!c.lostAt, redirectUri: redirectUri(), local: fromThisComputer(req) });
  });

  app.post("/api/drive/config", function (req, res) {
    if (!fromThisComputer(req)) return sendJson(res, 403, { error: "set it up on the computer that runs the scoreboard" });
    readBody(req, function (b) {
      var id = b && String(b.clientId || "").trim(), secret = b && String(b.clientSecret || "").trim();
      if (!id || !/\.apps\.googleusercontent\.com$/.test(id)) return sendJson(res, 400, { error: "that isn't a client ID (it ends in .apps.googleusercontent.com)" });
      if (!secret || secret.length < 10) return sendJson(res, 400, { error: "the client secret is missing" });
      var c = loadConfig();
      // another client: the old sign-in doesn't go with it
      if (c.clientId !== id) { delete c.refreshToken; delete c.account; access = null; }
      c.clientId = id; c.clientSecret = secret; delete c.lostAt;
      saveConfig(c);
      sendJson(res, 200, { ok: true });
    });
  });

  app.get("/api/drive/connect", function (req, res) {
    if (!fromThisComputer(req)) return sendPage(res, false, "Connect Google Drive on the computer that runs the scoreboard");
    var c = loadConfig();
    if (!c.clientId || !c.clientSecret) return sendPage(res, false, "Save the client ID and secret first");
    var state = b64url(crypto.randomBytes(18)), verifier = b64url(crypto.randomBytes(48));
    Object.keys(pending).forEach(function (k) { if (Date.now() - pending[k].at > 15 * 60000) delete pending[k]; });
    pending[state] = { verifier: verifier, at: Date.now() };
    var url = authUrl() + "?" + form({ client_id: c.clientId, redirect_uri: redirectUri(), response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true",
      state: state, code_challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), code_challenge_method: "S256" });
    res.statusCode = 302;
    res.setHeader("Location", url);
    res.end();
  });

  app.get("/api/drive/oauth/callback", function (req, res) {
    var q = req.query || {}, p = pending[q.state];
    if (q.error) return sendPage(res, false, "Not connected (" + q.error + ")");
    if (!p || !q.code) return sendPage(res, false, "Not connected - that sign-in is out of date, press Connect again");
    delete pending[q.state];
    var c = loadConfig();
    tokenRequest({ client_id: c.clientId, client_secret: c.clientSecret, code: q.code, code_verifier: p.verifier, redirect_uri: redirectUri(), grant_type: "authorization_code" })
      .then(function (j) {
        if (!j.refresh_token) throw new Error("Google gave no lasting sign-in - remove the app's access in your Google account and connect again");
        c.refreshToken = j.refresh_token; delete c.lostAt;
        access = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
        saveConfig(c);
        return apiJson("GET", D("about?fields=user(emailAddress,displayName)")).then(function (a) {
          c.account = (a.user && (a.user.emailAddress || a.user.displayName)) || null;
          saveConfig(c);
          sendPage(res, true, "Google Drive connected" + (c.account ? " (" + c.account + ")" : ""));
        }, function () { sendPage(res, true, "Google Drive connected"); });
      })
      .catch(function (e) { try { sendPage(res, false, "Not connected - " + e.message); } catch (e2) {} });
  });

  app.post("/api/drive/disconnect", function (req, res) {
    if (!fromThisComputer(req)) return sendJson(res, 403, { error: "disconnect it on the computer that runs the scoreboard" });
    readBody(req, function (b) {
      var c = loadConfig(), token = c.refreshToken;
      delete c.refreshToken; delete c.account; delete c.lostAt;
      if (b && b.forget) { delete c.clientId; delete c.clientSecret; }
      access = null;
      saveConfig(c);
      var done = function () { sendJson(res, 200, { ok: true }); };
      if (!token) return done();
      fetch(revokeUrl(), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form({ token: token }) }).then(done, done);
    });
  });

  app.get("/api/drive/folder", function (req, res) {
    var id = folderIdFromLink((req.query || {}).link);
    if (!id) return sendJson(res, 400, { error: "not a folder link" });
    if (!connected()) return sendJson(res, 409, { error: "Google Drive isn't connected" });
    Promise.all([folderInfo(id), listFolder(id)])
      .then(function (r) { sendJson(res, 200, { name: r[0].name, files: r[1] }); })
      .catch(function (e) { sendJson(res, 502, { error: e.message }); });
  });

  app.get("/api/drive/file/:id", function (req, res) {
    if (!/^[A-Za-z0-9_-]{10,}$/.test(req.params.id)) return sendJson(res, 400, { error: "bad id" });
    if (!connected()) return sendJson(res, 409, { error: "Google Drive isn't connected" });
    download(req.params.id).then(function (text) {
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(text);
    }).catch(function (e) { sendJson(res, 502, { error: e.message }); });
  });
}

module.exports = { attachGoogleDriveRoutes: attachGoogleDriveRoutes, connected: connected, account: function () { return loadConfig().account || null; }, folderInfo: folderInfo, upload: upload, listFolder: listFolder, download: download, folderIdFromLink: folderIdFromLink };
