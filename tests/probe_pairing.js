// The computer's server answers only paired devices (server/pairing.js). Starts its own server
// (server/server.js on 4257, a throwaway HOME) and plays "another device on the Wi-Fi" by using
// this computer's own LAN address (a request from it isn't from this computer's loopback):
// - unpaired: every /api, /voice and WebSocket route answers 401 (the app's pages stay open);
//   GET /voice no longer exists (POST only);
// - from this computer: allowed - unless another website set it off (Sec-Fetch-Site cross-site,
//   a foreign Origin);
// - pairing: a wrong code 403, the right one pairs (an HttpOnly, SameSite=Strict cookie), then
//   the API and the camera WebSocket work; too many wrong codes 429; the device list, Forget;
//   the app key (?device=) lets POST /voice and /ws-camera in (the Siri Shortcut, the iPad camera
//   app); kept in paired-devices.json (600, tokens only as hashes);
// - in a browser on the LAN address: the pairing screen, a wrong code, the right one - paired
//   after the reload; camera.html?pair=<code> pairs by itself and drops the code from the address;
//   the computer's 📱 Paired devices panel shows the code and the paired device;
// - the camera viewer rebuilds what it's sent from plain parts: no script, picture, link or
//   on... handler gets through;
// - no page errors.
// usage: node tests/probe_pairing.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4257;
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 600) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal);

function request(host, method, p, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const req = http.request({ host, port: PORT, method, path: p, headers: Object.assign({}, opts.headers || {}, opts.body ? { "Content-Type": "application/json" } : {}) }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", (e) => resolve({ status: 0, body: String(e) }));
    // (an event stream never ends: its first answer is enough)
    req.setTimeout(1500, () => { req.destroy(); });
    if (opts.body) req.write(JSON.stringify(opts.body));
    req.end();
  });
}
// a WebSocket upgrade: the status the server answers it with
function upgrade(host, p, headers) {
  return new Promise((resolve) => {
    const req = http.request({ host, port: PORT, path: p, headers: Object.assign({ Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" }, headers || {}) });
    req.on("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.on("response", (res) => resolve(res.statusCode));
    req.on("error", () => resolve(0));
    req.end();
  });
}

(async () => {
  if (!lanIp) {
    check("this computer has a LAN address to play another device from", false);
    process.exit(1);
  }
  const LAN = lanIp.address;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-pairing-"));
  const server = spawn(process.execPath, [path.join(REPO, "server", "server.js")], { env: Object.assign({}, process.env, { HOME: home, PORT: String(PORT) }), stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 40 && !/running on port/.test(log); i++) await sleep(150);
  check("the server prints a pairing code at start-up", /Pairing code for other devices \(30 minutes\): \d{6}/.test(log), log.slice(0, 300));

  // ---- unpaired, from "another device" ----
  const routes = [["GET", "/api/lan-info"], ["GET", "/api/rec/info"], ["GET", "/api/rec/sessions"], ["DELETE", "/api/rec/sessions/x"], ["GET", "/api/rec/cues"],
    ["GET", "/api/backup/drive?link=x"], ["POST", "/api/backup/drive"], ["GET", "/api/backup/from-link?url=x"], ["GET", "/api/drive/status"], ["POST", "/api/drive/config"],
    ["GET", "/api/drive/folder?link=x"], ["GET", "/api/drive/file/abcdefghijk"], ["GET", "/api/pair/code"], ["GET", "/api/pair/app-token"],
    ["POST", "/voice"], ["GET", "/voice/events"], ["POST", "/voice/active"], ["POST", "/voice/result"]];
  const not401 = [];
  for (const [m, p] of routes) {
    const r = await request(LAN, m, p, m === "POST" ? { body: { text: "add one point to Ann" } } : {});
    if (r.status !== 401) not401.push(m + " " + p + " -> " + r.status);
  }
  check("an unpaired device: every /api, /voice route answers 401 (" + routes.length + " tried)", not401.length === 0, not401);
  const wsUnpaired = [await upgrade(LAN, "/ws"), await upgrade(LAN, "/ws-camera")];
  check("...and both WebSockets (/ws, /ws-camera) are refused with 401", wsUnpaired.every((s) => s === 401), wsUnpaired);
  const page0 = await request(LAN, "GET", "/"), cam0 = await request(LAN, "GET", "/camera.html"), pairJs = await request(LAN, "GET", "/js/pairing.js");
  check("...the app's own pages stay open (so it can show the pairing screen)", page0.status === 200 && cam0.status === 200 && pairJs.status === 200);
  const st0 = JSON.parse((await request(LAN, "GET", "/api/pair/status")).body || "{}");
  check("...its status: not paired, not this computer", st0.paired === false && st0.local === false, st0);
  const getVoice = await request("127.0.0.1", "GET", "/voice?text=add%20one%20point");
  check("GET /voice?text= no longer does anything (POST only - no link or picture can set it off)", getVoice.status === 404, getVoice.status);

  // ---- this computer ----
  const local = await request("127.0.0.1", "GET", "/api/lan-info");
  check("this computer itself: allowed without pairing", local.status === 200);
  const xsite = await request("127.0.0.1", "GET", "/api/lan-info", { headers: { "Sec-Fetch-Site": "cross-site" } });
  const xorigin = await request("127.0.0.1", "POST", "/voice", { headers: { Origin: "http://evil.example" }, body: { text: "x" } });
  const xws = await upgrade("127.0.0.1", "/ws-camera", { Origin: "http://evil.example" });
  check("...but not when another website set it off (cross-site, a foreign Origin, a WebSocket from it): 401", xsite.status === 401 && xorigin.status === 401 && xws === 401, [xsite.status, xorigin.status, xws]);

  // ---- pairing ----
  const code = JSON.parse((await request("127.0.0.1", "GET", "/api/pair/code")).body).code;
  check("the computer shows a 6-digit code", /^\d{6}$/.test(code), code);
  const wrong = await request(LAN, "POST", "/api/pair", { body: { code: code === "000000" ? "111111" : "000000" } });
  check("a wrong code: 403", wrong.status === 403, wrong.status);
  const paired = await request(LAN, "POST", "/api/pair", { body: { code, name: "Probe phone" } });
  const cookie = (paired.headers["set-cookie"] || [""])[0];
  const token = (/pmc_device=([a-f0-9]{64})/.exec(cookie) || [])[1];
  check("the right code pairs: a cookie that's HttpOnly and SameSite=Strict", paired.status === 200 && !!token && /HttpOnly/.test(cookie) && /SameSite=Strict/.test(cookie), cookie);
  const withCookie = { headers: { Cookie: "pmc_device=" + token } };
  const api1 = await request(LAN, "GET", "/api/lan-info", withCookie);
  const ws1 = await upgrade(LAN, "/ws-camera", { Cookie: "pmc_device=" + token });
  const st1 = JSON.parse((await request(LAN, "GET", "/api/pair/status", withCookie)).body || "{}");
  check("...after that the device gets in: the API, the camera WebSocket, status paired", api1.status === 200 && ws1 === 101 && st1.paired === true, [api1.status, ws1, st1]);
  const devices = await request(LAN, "GET", "/api/pair/devices", withCookie);
  check("...the device list is for this computer only (a paired phone gets 403)", devices.status === 403, devices.status);
  const list = JSON.parse((await request("127.0.0.1", "GET", "/api/pair/devices")).body);
  check("...this computer lists it (\"Probe phone\")", (list.devices || []).some((d) => d.name === "Probe phone"), list);
  // the app key: the Siri Shortcut / the iPad camera app
  const appToken = JSON.parse((await request(LAN, "GET", "/api/pair/app-token", withCookie)).body).token;
  const voice = await request(LAN, "POST", "/voice?device=" + appToken, { body: { text: "add one point to Ann" } });
  const wsApp = await upgrade(LAN, "/ws-camera?device=" + appToken);
  check("the app key (?device=) lets in POST /voice (503: no scoreboard open here) and /ws-camera (the Siri Shortcut, the iPad camera app)", voice.status === 503 && wsApp === 101, [voice.status, wsApp]);
  const file = path.join(home, ".pool-master-counter", "paired-devices.json");
  const saved = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  check("kept in paired-devices.json, readable by this user only (600), the device's token only as a hash", saved && (fs.statSync(file).mode & 0o777) === 0o600 && saved.indexOf(token) === -1, { mode: saved && (fs.statSync(file).mode & 0o777).toString(8) });
  // forgetting
  const id = list.devices.find((d) => d.name === "Probe phone").id;
  await request("127.0.0.1", "POST", "/api/pair/forget", { body: { id } });
  const forgotten = await request(LAN, "GET", "/api/lan-info", withCookie);
  check("Forget: that device is out again (401)", forgotten.status === 401, forgotten.status);
  // too many wrong codes
  let last = 0;
  for (let i = 0; i < 9; i++) last = (await request(LAN, "POST", "/api/pair", { body: { code: "999999" === code ? "888888" : "999999" } })).status;
  check("too many wrong codes in a minute: 429", last === 429, last);

  // ---- in a browser, on the LAN address ----
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 900 } });
  const errors = [];
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const B = "http://" + LAN + ":" + PORT + "/";
  // (a new code: the old one is at its limit of tries from this address... codes are per computer, tries per address)
  await sleep(61000);
  const code2 = JSON.parse((await request("127.0.0.1", "GET", "/api/pair/code")).body).code;
  await page.goto(B, { waitUntil: "networkidle2" });
  await sleep(1200);
  const screen = await page.evaluate(() => { const o = document.getElementById("pmc-pair-overlay"); return o ? { text: o.textContent } : null; });
  check("the scoreboard on an unpaired phone: the pairing screen", !!screen && /Pair this device/.test(screen.text) && /6-digit code/.test(screen.text), screen);
  await page.type("#pmc-pair-code", code2 === "123456" ? "654321" : "123456");
  await page.click("#pmc-pair-button");
  await sleep(600);
  const msg = await page.evaluate(() => document.getElementById("pmc-pair-status").textContent);
  check("...a wrong code says so", /not the code/.test(msg), msg);
  await page.evaluate(() => { document.getElementById("pmc-pair-code").value = ""; });
  await page.type("#pmc-pair-code", code2);
  await page.click("#pmc-pair-button");
  await sleep(2500);
  const after = await page.evaluate(() => ({ overlay: !!document.getElementById("pmc-pair-overlay"), status: window.PMCPairing && window.PMCPairing.status }));
  check("...the right code: reloaded, paired, no pairing screen", !after.overlay && after.status && after.status.paired === true, after);
  if (process.argv[2]) await page.screenshot({ path: path.join(process.argv[2], "paired.png") });
  // camera.html?pair=: pairs by itself (another phone: its own cookies)
  const ctx2 = await browser.createBrowserContext();
  const cam = await ctx2.newPage();
  // (camera.html over plain http has no camera at all - getUserMedia - as before; only other errors count)
  cam.on("pageerror", (e) => { if (!/getUserMedia/.test(e.message)) errors.push("camera: " + e.message); });
  const code3 = JSON.parse((await request("127.0.0.1", "GET", "/api/pair/code")).body).code;
  await cam.goto(B + "camera.html?pair=" + code3, { waitUntil: "domcontentloaded" });
  await sleep(4000);
  const camState = await cam.evaluate(() => ({ url: location.href, overlay: !!document.getElementById("pmc-pair-overlay"), status: window.PMCPairing && window.PMCPairing.status }));
  check("camera.html?pair=<code> (the camera setup QR): pairs by itself, the code dropped from the address", !camState.overlay && camState.status && camState.status.paired && !/pair=/.test(camState.url), camState);
  // the computer's panel
  const mac = await browser.newPage();
  mac.on("pageerror", (e) => errors.push("mac: " + e.message));
  await mac.goto("http://127.0.0.1:" + PORT + "/manifest.json");
  await mac.evaluate(() => { localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await mac.goto("http://127.0.0.1:" + PORT + "/", { waitUntil: "networkidle2" });
  await sleep(1500);
  const panel = await mac.evaluate(() => ({ shown: !document.getElementById("pairing-panel").classList.contains("hidden"), code: (document.getElementById("pair-panel-code") || {}).textContent, devices: (document.getElementById("pair-panel-devices") || {}).textContent || "" }));
  check("the computer's 📱 Paired devices panel: the code and the two paired phones", panel.shown && /^\d{6}$/.test(panel.code) && /iPad|Mac|Device|scoreboard/.test(panel.devices) && /camera/.test(panel.devices), panel);
  if (process.argv[2]) {
    await mac.evaluate(() => { const b = document.getElementById("btn-toggle-pairing-panel"); b.click(); document.getElementById("pairing-panel").scrollIntoView(); });
    await sleep(800);
    await mac.screenshot({ path: path.join(process.argv[2], "panel.png") });
  }

  // ---- the camera viewer: plain parts only ----
  const src = fs.readFileSync(path.join(REPO, "camera.html"), "utf8");
  const start = src.indexOf("  var VIEWER_SAFE_TAGS");
  const end = src.indexOf("  function applyViewerFrame(msg)");
  const safe = await mac.evaluate((code) => {
    const f = new Function(code + "\nreturn setViewerSafeHtml;")();
    const el = document.createElement("div");
    document.body.appendChild(el);
    window.__pwned = 0;
    f(el, '<div class="row" id="r1"><button type="button" class="danger" id="b1" onclick="window.__pwned=1">Delete</button><img src=x onerror="window.__pwned=2"><script>window.__pwned=3<\/script><a href="javascript:window.__pwned=4">link</a><span style="background:url(http://evil)">Ann</span></div>');
    return { html: el.innerHTML, buttonKept: !!el.querySelector("#b1.danger"), text: el.textContent };
  }, src.slice(start, end));
  await sleep(300);
  const pwned = await mac.evaluate(() => window.__pwned);
  check("the camera viewer: a row and its button come through (ids, classes), the words too - no script, picture, link, style or onclick", safe.buttonKept && /Ann/.test(safe.text) && /link/.test(safe.text) && !/onclick|<img|<script|<a |style=|javascript/i.test(safe.html) && pwned === 0, { safe, pwned });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  server.kill();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
