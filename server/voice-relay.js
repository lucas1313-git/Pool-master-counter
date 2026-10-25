// Voice commands from outside the page - a Siri Shortcut (or anything else
// that can send a web request) hands the open scoreboard a sentence and
// gets back what was done, as text to speak. The scoreboard understands it
// with the same sentences as its own 🎤 Talk button (js/voice.js).
//
//   POST /voice          { "text": "add one point to Luc" }  (or a form
//                        field "text", or the sentence as a plain-text body)
//   GET  /voice?text=... the same, to try it from a browser
//     -> 200 text/plain: the answer to speak ("Luc plus 1, now 1")
//     -> 503: no scoreboard open; 504: it didn't answer in time
//
// The scoreboard's side:
//   GET  /voice/events   Server-Sent Events: "hello" { client }, then one
//                        "command" { id, text } per sentence
//   POST /voice/result   { id, ok, speech }
//   POST /voice/active   { client, visible } - on screen / just used
//
// Several scoreboards can be open (the computer's browser, an iPad's
// Safari): a sentence goes to ONE - on screen, used most recently - so a
// point is never counted twice. Like the camera relay: no login, the
// local network only.

var clients = new Map(); // id -> { res, connectedAt, activeAt, visible }
var pending = new Map(); // command id -> { timer, done(answer) }
var nextId = 1;
var ANSWER_TIMEOUT_MS = 8000;
var MAX_BODY = 8192;

function readBody(req, cb) {
  var chunks = [], size = 0, finished = false;
  function finish(text) { if (!finished) { finished = true; cb(text); } }
  req.on("data", function (c) {
    size += c.length;
    if (size > MAX_BODY) { finish(""); req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", function () { finish(Buffer.concat(chunks).toString("utf8")); });
  req.on("error", function () { finish(""); });
}

function sentenceFrom(req, body) {
  if (req.query && typeof req.query.text === "string" && req.query.text) return req.query.text;
  var type = String(req.headers["content-type"] || "");
  if (/json/i.test(type)) {
    try {
      var o = JSON.parse(body);
      if (typeof o === "string") return o;
      if (o && typeof o.text === "string") return o.text;
    } catch (e) {}
    return "";
  }
  if (/x-www-form-urlencoded/i.test(type)) return new URLSearchParams(body).get("text") || "";
  return body;
}

function rank(c) {
  return (c.visible ? 1e15 : 0) + (c.activeAt || c.connectedAt);
}

function pickScoreboard() {
  var best = null;
  clients.forEach(function (c) {
    if (!best || rank(c) > rank(best)) best = c;
  });
  return best;
}

function sendEvent(c, name, data) {
  try {
    c.res.write("event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n");
  } catch (e) {}
}

function parseJson(body) {
  try { return JSON.parse(body) || {}; } catch (e) { return {}; }
}

function plain(res, status, text) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(text);
}

function attachVoiceRoutes(app) {
  app.get("/voice/events", function (req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    var id = "s" + nextId++;
    var c = { id: id, res: res, connectedAt: Date.now(), activeAt: 0, visible: true };
    clients.set(id, c);
    res.write("retry: 3000\n\n");
    sendEvent(c, "hello", { client: id });
    var ping = setInterval(function () {
      try { res.write(": ping\n\n"); } catch (e) {}
    }, 25000);
    req.on("close", function () {
      clearInterval(ping);
      clients.delete(id);
    });
  });

  app.post("/voice/active", function (req, res) {
    readBody(req, function (body) {
      var o = parseJson(body);
      var c = clients.get(String(o.client || ""));
      if (c) {
        c.visible = !!o.visible;
        if (o.used || o.visible) c.activeAt = Date.now();
      }
      res.statusCode = 204;
      res.end();
    });
  });

  app.post("/voice/result", function (req, res) {
    readBody(req, function (body) {
      var o = parseJson(body);
      var p = pending.get(String(o.id || ""));
      if (p) {
        pending.delete(String(o.id));
        clearTimeout(p.timer);
        p.done(o);
      }
      res.statusCode = 204;
      res.end();
    });
  });

  function handle(req, res, body) {
    var text = String(sentenceFrom(req, body) || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!text) return plain(res, 400, "Say a sentence after the shortcut's name.");
    var c = pickScoreboard();
    if (!c) return plain(res, 503, "The scoreboard isn't open on the computer.");
    var id = String(nextId++);
    var timer = setTimeout(function () {
      pending.delete(id);
      plain(res, 504, "The scoreboard didn't answer.");
    }, ANSWER_TIMEOUT_MS);
    pending.set(id, {
      timer: timer,
      done: function (o) {
        var speech = typeof o.speech === "string" && o.speech.trim() ? o.speech.trim() : o.ok ? "Done." : "Sorry, that didn't work.";
        plain(res, 200, speech);
      }
    });
    sendEvent(c, "command", { id: id, text: text });
  }

  app.get("/voice", function (req, res) { handle(req, res, ""); });
  app.post("/voice", function (req, res) {
    readBody(req, function (body) { handle(req, res, body); });
  });
}

module.exports = { attachVoiceRoutes: attachVoiceRoutes };
