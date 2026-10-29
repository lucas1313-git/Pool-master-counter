// Which devices may use this server. The computer itself (a request from
// this machine, not set off by some other website) always may; any other
// phone or tablet pairs once with a code shown on the computer and keeps a
// token after that (a cookie its browser sends by itself, or - for a Siri
// Shortcut or the iPad camera app - "?device=<token>" in the address, or an
// X-PMC-Device header). Every /api, /voice and WebSocket request needs one
// of those; the app's own pages and files stay open, so a new device can
// show the pairing screen.
//
//   GET  /api/pair/status          { paired, local }
//   POST /api/pair { code, name }  -> { ok, token } and the cookie
//   GET  /api/pair/code            (a paired device) { code, expiresAt }
//   GET  /api/pair/devices         (this computer) [{ id, name, pairedAt, lastSeen }]
//   POST /api/pair/forget          (this computer) { id } or { all: true }
//   GET  /api/pair/app-token       (a paired device) { token } - for the
//                                  Siri Shortcut and the iPad camera app
//
// Kept in ~/.pool-master-counter/paired-devices.json (tokens as hashes;
// the one app token as is, so it can be shown again).

var fs = require("fs");
var os = require("os");
var path = require("path");
var crypto = require("crypto");

var CODE_TTL_MS = 30 * 60 * 1000;
var MAX_TRIES_PER_MINUTE = 8;
var COOKIE = "pmc_device";
var COOKIE_MAX_AGE = 10 * 365 * 24 * 3600;
// open to anyone: pairing itself, the QR picture, and Google's sign-in
// coming back (checked by its own state/PKCE - see google-drive.js)
var OPEN_PATHS = ["/api/pair/status", "/api/pair", "/api/qr.png", "/api/drive/oauth/callback"];

function sha(text) {
  return crypto.createHash("sha256").update(String(text)).digest("hex");
}

function createPairing(opts) {
  opts = opts || {};
  var dir = opts.dir || path.join(os.homedir(), ".pool-master-counter");
  var file = path.join(dir, "paired-devices.json");
  var data = load();
  // codes handed out and still good (each for 30 minutes from when it was
  // made: a QR shown a while ago keeps working while a newer one is out)
  var codes = [];
  var tries = new Map(); // ip -> [times]

  function load() {
    try {
      var d = JSON.parse(fs.readFileSync(file, "utf8"));
      if (d && typeof d === "object" && d.devices && typeof d.devices === "object") return d;
    } catch (e) {}
    return { devices: {}, appToken: null };
  }
  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
    } catch (e) {
      console.error("Could not save the paired devices:", e.message);
    }
  }

  // the code to show now: the newest, or a new one once it has under 10
  // minutes left
  function currentCodeEntry() {
    var now = Date.now();
    codes = codes.filter(function (c) { return c.expires > now; });
    var newest = codes[codes.length - 1];
    if (!newest || newest.expires - now < 10 * 60 * 1000) {
      newest = { code: String(crypto.randomInt(0, 1000000)).padStart(6, "0"), expires: now + CODE_TTL_MS };
      codes.push(newest);
    }
    return newest;
  }
  function currentCode() {
    return currentCodeEntry().code;
  }
  function codeIsGood(given) {
    var now = Date.now();
    return codes.some(function (c) { return c.code === given && c.expires > now; });
  }

  function isLocal(req) {
    var a = (req.socket && req.socket.remoteAddress) || "";
    return a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";
  }
  // set off by another website (an <img> or form on some page) - never
  // trusted just for coming from this computer
  function crossSite(req) {
    var site = req.headers["sec-fetch-site"];
    if (site === "cross-site") return true;
    var origin = req.headers.origin;
    if (origin && origin !== "null") {
      try {
        if (new URL(origin).host !== req.headers.host) return true;
      } catch (e) {
        return true;
      }
    }
    return false;
  }
  function cookieToken(req) {
    var m = new RegExp("(?:^|;\\s*)" + COOKIE + "=([a-f0-9]{64})").exec(req.headers.cookie || "");
    return m ? m[1] : null;
  }
  function queryToken(req) {
    var q = (req.url || "").split("?")[1] || "";
    var v = new URLSearchParams(q).get("device");
    return v && /^[a-f0-9]{64}$/.test(v) ? v : null;
  }
  function deviceFor(token) {
    if (!token) return null;
    if (data.appToken && token === data.appToken) return { id: "app", name: "Siri Shortcut / camera app" };
    var d = data.devices[sha(token)];
    return d || null;
  }
  // the device a request comes from, or null
  function requestDevice(req) {
    var header = req.headers["x-pmc-device"];
    var token = (typeof header === "string" && /^[a-f0-9]{64}$/.test(header) && header) || cookieToken(req) || queryToken(req);
    var d = deviceFor(token);
    if (d && d !== true && d.lastSeen !== undefined) {
      var now = Date.now();
      if (now - (d.lastSeen || 0) > 3600000) {
        d.lastSeen = now;
        save();
      }
    }
    return d;
  }
  function authorized(req) {
    if (requestDevice(req)) return true;
    return isLocal(req) && !crossSite(req);
  }

  function json(res, status, body) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(body));
  }

  // express middleware: /api and /voice need a paired device
  function guard(req, res, next) {
    var p = req.path || "";
    var protectedPath = p === "/voice" || p.indexOf("/voice/") === 0 || p.indexOf("/api/") === 0;
    if (!protectedPath || OPEN_PATHS.indexOf(p) !== -1) return next();
    if (authorized(req)) return next();
    json(res, 401, { error: "pair-needed", message: "This device isn't paired with the scoreboard's computer yet." });
  }

  // WebSocket upgrades (/ws, /ws-camera)
  function upgradeAllowed(req) {
    return authorized(req);
  }

  function readJson(req, cb) {
    var chunks = [], size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > 4096) { req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () {
      try { cb(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { cb({}); }
    });
  }

  function attachPairingRoutes(app) {
    app.get("/api/pair/status", function (req, res) {
      json(res, 200, { paired: authorized(req), local: isLocal(req) });
    });

    app.post("/api/pair", function (req, res) {
      var ip = (req.socket && req.socket.remoteAddress) || "?";
      var now = Date.now();
      var recent = (tries.get(ip) || []).filter(function (t) { return now - t < 60000; });
      if (recent.length >= MAX_TRIES_PER_MINUTE) {
        tries.set(ip, recent);
        return json(res, 429, { error: "too-many", message: "Too many tries - wait a minute." });
      }
      readJson(req, function (body) {
        var given = String((body && body.code) || "").replace(/\D/g, "");
        if (!given || !codeIsGood(given)) {
          recent.push(now);
          tries.set(ip, recent);
          return json(res, 403, { error: "wrong-code", message: "That's not the code shown on the computer." });
        }
        var token = crypto.randomBytes(32).toString("hex");
        var name = String((body && body.name) || req.headers["user-agent"] || "device").slice(0, 80);
        data.devices[sha(token)] = { id: sha(token).slice(0, 12), name: name, pairedAt: now, lastSeen: now };
        save();
        res.setHeader("Set-Cookie", COOKIE + "=" + token + "; Path=/; Max-Age=" + COOKIE_MAX_AGE + "; HttpOnly; SameSite=Strict");
        json(res, 200, { ok: true, token: token });
      });
    });

    app.get("/api/pair/code", function (req, res) {
      if (!authorized(req)) return json(res, 401, { error: "pair-needed" });
      var c = currentCodeEntry();
      json(res, 200, { code: c.code, expiresAt: c.expires });
    });

    app.get("/api/pair/devices", function (req, res) {
      if (!(isLocal(req) && !crossSite(req))) return json(res, 403, { error: "this-computer-only" });
      json(res, 200, {
        devices: Object.keys(data.devices).map(function (k) { return data.devices[k]; }),
        appToken: !!data.appToken
      });
    });

    app.post("/api/pair/forget", function (req, res) {
      if (!(isLocal(req) && !crossSite(req))) return json(res, 403, { error: "this-computer-only" });
      readJson(req, function (body) {
        if (body && body.all) {
          data.devices = {};
          data.appToken = null;
        } else if (body && body.id === "app") {
          data.appToken = null;
        } else if (body && body.id) {
          Object.keys(data.devices).forEach(function (k) {
            if (data.devices[k].id === body.id) delete data.devices[k];
          });
        }
        save();
        json(res, 200, { ok: true });
      });
    });

    app.get("/api/pair/app-token", function (req, res) {
      if (!authorized(req)) return json(res, 401, { error: "pair-needed" });
      if (!data.appToken) {
        data.appToken = crypto.randomBytes(32).toString("hex");
        save();
      }
      json(res, 200, { token: data.appToken });
    });
  }

  return {
    guard: guard,
    upgradeAllowed: upgradeAllowed,
    attachPairingRoutes: attachPairingRoutes,
    currentCode: currentCode,
    authorized: authorized
  };
}

// Refuses a WebSocket upgrade from a device that isn't paired.
function refuseUpgrade(socket) {
  try {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
  } catch (e) {}
  socket.destroy();
}

module.exports = { createPairing: createPairing, refuseUpgrade: refuseUpgrade };
