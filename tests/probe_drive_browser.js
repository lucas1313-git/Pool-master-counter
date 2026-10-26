// Google Drive signed in on the device itself - the GitHub page on an iPad,
// no Mac server: Backup & Transfer's 🔗 Google Drive sign-in with only the
// OAuth client ID, Google's own sign-in library (Google Identity Services)
// in the browser. Here: the site from a plain file server (like GitHub
// Pages - no /api), and a fake Google on 4298 with CORS (a fake sign-in
// library at /gsi/client, a small Drive: about, files, alt=media, multipart
// uploads), the page pointed at it by window.PMC_TEST_GOOGLE_API /
// PMC_TEST_GIS_SRC.
// Checks: no secret field on this page, the ID saved on this device only;
// Connect -> Google's sign-in (asked for the full Drive, consent the first
// time) -> "Connected as ..."; the folder link -> "upload straight into
// your Drive folder"; All Data uploaded into the folder (complete, no client
// ID or token in it, the token kept for this tab only); an hour later the
// next backup asks Google again (no consent screen) and still uploads;
// Import lists the folder's backups and reads one; Disconnect revokes.
// usage: node tests/probe_drive_browser.js     (starts its own servers on 4240 and 4298)
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4240, GPORT = 4298, BASE = "http://localhost:" + PORT + "/", G = "http://localhost:" + GPORT;
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLIENT_ID = "987654-web.apps.googleusercontent.com";
const FOLDER = "1FAKEipadBackupsFolder01", LINK = "https://drive.google.com/drive/folders/" + FOLDER;

// ---- the site, as GitHub Pages serves it: files only ----
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const site = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, BASE).pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(REPO, p);
  if (!file.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end("<h1>404</h1>"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

// ---- a fake Google ----
const google = { files: [], tokens: {}, uploads: 0, revoked: [] };
google.files.push({ id: "1OLDipadBackupFile0001", name: "old-backup.json", parents: [FOLDER], modifiedTime: "2026-10-01T10:00:00Z", mimeType: "application/json",
  content: JSON.stringify({ exportedAt: "2026-10-01T10:00:00Z", state: { players: [{ id: "p-mario", name: "Mario", playing: false, balls: 0 }], currentGame: { gameType: "8ball", unit: "rack", target: 1, mode: "individual" }, gameHistory: [] } }) });
const GIS = `window.google = { accounts: { oauth2: {
  initTokenClient: function (cfg) {
    window.__gis = { cfg: { client_id: cfg.client_id, scope: cfg.scope }, requests: [] };
    return { requestAccessToken: function (o) {
      window.__gis.requests.push(o || {});
      fetch("${G}/fake-token", { method: "POST" }).then(function (r) { return r.json(); }).then(function (j) { cfg.callback({ access_token: j.token, expires_in: 3600, scope: cfg.scope }); });
    } };
  },
  revoke: function (t, cb) { fetch("${G}/fake-revoke?t=" + encodeURIComponent(t), { method: "POST" }); if (cb) cb({}); }
} } };`;
function cors(res, status, headers) { res.writeHead(status, Object.assign({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Upload-Content-Type", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS", "Access-Control-Expose-Headers": "Location" }, headers || {})); }
function json(res, status, obj) { cors(res, status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c).toString("utf8"))); }); }
const fakeGoogle = http.createServer(async (req, res) => {
  const u = new URL(req.url, G), p = u.pathname;
  if (req.method === "OPTIONS") { cors(res, 204); return res.end(); }
  if (p === "/gsi/client") { cors(res, 200, { "Content-Type": "text/javascript" }); return res.end(GIS); }
  if (p === "/fake-revoke") { google.revoked.push(u.searchParams.get("t")); delete google.tokens[u.searchParams.get("t")]; return json(res, 200, {}); }
  if (p === "/fake-token") { const t = "tok-" + crypto.randomBytes(5).toString("hex"); google.tokens[t] = true; return json(res, 200, { token: t }); }
  const t = (req.headers.authorization || "").replace(/^Bearer /, "");
  if (!google.tokens[t]) return json(res, 401, { error: { message: "Request had invalid authentication credentials." } });
  if (p === "/drive/v3/about") return json(res, 200, { user: { emailAddress: "ipad-tester@example.com" } });
  if (p === "/upload/drive/v3/files" && u.searchParams.get("uploadType") === "multipart") {
    const b = await body(req), boundary = (req.headers["content-type"].match(/boundary=(.+)$/) || [])[1];
    const parts = b.split("--" + boundary).filter((x) => x.trim() && x.trim() !== "--").map((x) => x.replace(/^\r\n/, "").split("\r\n\r\n").slice(1).join("\r\n\r\n").replace(/\r\n$/, ""));
    const meta = JSON.parse(parts[0]);
    const file = { id: "1UP" + crypto.randomBytes(6).toString("hex"), name: meta.name, parents: meta.parents, mimeType: meta.mimeType, modifiedTime: new Date().toISOString(), content: parts[1] };
    google.files.push(file); google.uploads++;
    return json(res, 200, { id: file.id, name: file.name });
  }
  if (p === "/drive/v3/files") {
    const m = (u.searchParams.get("q") || "").match(/'([^']+)' in parents/);
    return json(res, 200, { files: google.files.filter((f) => m && f.parents.includes(m[1])).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, mimeType: f.mimeType })) });
  }
  const fm = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (fm) {
    if (fm[1] === FOLDER) return json(res, 200, { name: "iPad Backups" });
    const f = google.files.find((x) => x.id === fm[1]);
    if (!f) return json(res, 404, { error: { message: "File not found" } });
    if (u.searchParams.get("alt") === "media") { cors(res, 200, { "Content-Type": "application/json" }); return res.end(f.content); }
    return json(res, 200, { name: f.name });
  }
  json(res, 404, { error: { message: "no fake " + p } });
});

(async () => {
  await new Promise((ok) => site.listen(PORT, ok));
  await new Promise((ok) => fakeGoogle.listen(GPORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 900 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument((g) => { window.PMC_TEST_GOOGLE_API = g; window.PMC_TEST_GIS_SRC = g + "/gsi/client"; window.__downloads = []; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); return click.call(this); }; }, G);
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE + "?owner", { waitUntil: "networkidle2" });
  await sleep(700);
  await page.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  const openPanel = () => page.evaluate(() => { const b = document.getElementById("btn-toggle-backup-panel"); if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click(); });
  const closeModals = async () => { for (let i = 0; i < 10; i++) { const open = await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) { document.getElementById("btn-confirm-modal-ok").click(); return true; } return false; }); if (!open) break; await sleep(400); } };
  await openPanel();
  // Backup & Restore › More options (the owner's sign-in setup: ?owner in the address)
  await page.evaluate(() => { document.getElementById("bk-more").open = true; });
  await sleep(800);
  const ui = () => page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !e.classList.contains("hidden") && e.offsetParent !== null; };
    return { status: document.getElementById("drive-connect-status").textContent, idField: vis("drive-client-id-input"), secretField: vis("drive-client-secret-input"), connect: vis("btn-drive-connect"), connectDisabled: document.getElementById("btn-drive-connect").disabled, disconnect: vis("btn-drive-disconnect"), backup: document.getElementById("drive-backup-status").textContent };
  });
  const waitUi = async (f) => { let u; for (let i = 0; i < 40; i++) { u = await ui(); if (f(u)) break; await sleep(250); } return u; };
  const toast = () => page.evaluate(() => { const t = [...document.querySelectorAll("#page-toast, #win-toast")].find((x) => !x.classList.contains("hidden") && x.textContent.trim()); return t ? t.textContent : ""; });

  let u = await waitUi((x) => /Save the app's Google client ID below/.test(x.status));
  check("no Mac server, the owner (?owner), nothing set up: the setup asks for the client ID only (no secret field), no Connect until it's saved", u.idField && !u.secretField && !u.connect, u);

  await page.evaluate((id) => { const i = document.getElementById("drive-client-id-input"); i.value = id; }, CLIENT_ID);
  await page.click("#btn-drive-save-client");
  u = await waitUi((x) => /Not connected yet/.test(x.status));
  const kept = await page.evaluate(() => localStorage.getItem("poolMasterCounter.driveBrowserClientId.v1"));
  for (let i = 0; i < 20; i++) { if (await page.evaluate(() => !!(window.google && window.google.accounts))) break; await sleep(200); }
  check("saved on this device, Google's sign-in library loaded - \"Not connected yet: press Connect\"", kept === CLIENT_ID && u.connect && (await page.evaluate(() => !!(window.google && window.google.accounts))), { kept, u });

  await page.click("#btn-drive-connect");
  u = await waitUi((x) => /Connected to Google as/.test(x.status));
  const gis = await page.evaluate(() => window.__gis);
  check("Connect: Google's sign-in for the full Drive, consent the first time -> \"Connected to Google as ipad-tester@example.com\"", /Connected to Google as ipad-tester@example\.com/.test(u.status) && gis.cfg.client_id === CLIENT_ID && /auth\/drive$/.test(gis.cfg.scope) && gis.requests[0].prompt === "consent" && u.disconnect, { u, gis });

  await page.evaluate((l) => { const i = document.getElementById("drive-folder-link-input"); i.value = l; i.dispatchEvent(new Event("change", { bubbles: true })); }, LINK);
  u = await waitUi((x) => /signed in on this device/.test(x.backup));
  check("the folder link: \"Backups upload straight into your Drive folder (signed in on this device)\"", /upload straight into your Drive folder \(signed in on this device\)/.test(u.backup), u.backup);

  await page.click("#btn-backup-now");
  let up = null;
  for (let i = 0; i < 40 && !up; i++) { await sleep(250); up = google.files.find((f) => /all-data/.test(f.name)); }
  const data = up ? JSON.parse(up.content) : null;
  const tokenKept = await page.evaluate(() => ({ session: !!sessionStorage.getItem("poolMasterCounter.driveBrowserToken.v1"), local: Object.keys(localStorage).some((k) => /Token/.test(k)) }));
  check("All Data: uploaded into the folder from the browser (" + (up && up.name) + ")", up && up.parents[0] === FOLDER && data.state.players.length === 2 && data.driveFolderLink === LINK, up && up.parents);
  check("...no client ID, no token in the backup; the token kept for this tab only", up && up.content.indexOf(CLIENT_ID) === -1 && up.content.indexOf("tok-") === -1 && tokenKept.session && !tokenKept.local, tokenKept);
  await sleep(300);
  check("...says so, nothing downloaded", /Saved in your Drive folder “iPad Backups”/.test(await toast()) && (await page.evaluate(() => window.__downloads.length)) === 0, { t: await toast(), d: await page.evaluate(() => window.__downloads) });

  // an hour later: the token is spent - the next backup asks Google again (no consent screen) and uploads
  await page.evaluate(() => { const k = "poolMasterCounter.driveBrowserToken.v1"; const t = JSON.parse(sessionStorage.getItem(k)); t.expiresAt = Date.now() - 1000; sessionStorage.setItem(k, JSON.stringify(t)); });
  const before = google.uploads;
  await page.click("#btn-backup-now");
  for (let i = 0; i < 40 && google.uploads === before; i++) await sleep(250);
  const reqs = await page.evaluate(() => window.__gis.requests);
  check("an hour later: the next backup asks Google again (no consent screen this time) and still uploads", google.uploads === before + 1 && reqs.length === 2 && reqs[1].prompt === "" && reqs[1].hint === "ipad-tester@example.com", { uploads: google.uploads - before, reqs });

  // Import: the folder's backups listed and one read
  await closeModals();
  await page.click("#btn-restore"); await sleep(300);
  await page.click("#btn-bk-pick-drive");
  let rows = [];
  for (let i = 0; i < 30 && rows.length < 3; i++) { await sleep(250); rows = await page.evaluate(() => [...document.querySelectorAll("#bk-drive-list .bk-drive-row")].map((b) => b.textContent)); }
  check("⬇️ Restore › From Google Drive: the folder's backups listed (no API key)", rows.length === 3 && rows.some((r) => /old-backup\.json/.test(r)), rows);
  await page.evaluate(() => [...document.querySelectorAll("#bk-drive-list .bk-drive-row")].find((b) => /old-backup/.test(b.textContent)).click());
  for (let i = 0; i < 20; i++) { await sleep(250); if (await page.evaluate(() => !document.getElementById("bk-step-how").classList.contains("hidden"))) break; }
  await page.click("#btn-bk-add");
  let mario = false;
  for (let i = 0; i < 30 && !mario; i++) {
    await sleep(300);
    await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); });
    mario = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.some((p) => p.name === "Mario"); } catch (e) { return false; } });
  }
  check("...one picked: read from Drive and imported (Mario is here)", mario);

  // Disconnect
  await sleep(600); await closeModals(); await openPanel(); await sleep(300);
  await page.evaluate(() => document.getElementById("btn-drive-disconnect").click()); await sleep(300);
  await page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click());
  u = await waitUi((x) => /Not connected yet/.test(x.status));
  await sleep(500);
  const revoked = google.revoked;
  check("Disconnect: the token revoked, back to \"Not connected yet\"", revoked.length === 1 && /^tok-/.test(revoked[0]) && /Not connected yet/.test(u.status), { revoked, u });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close(); fakeGoogle.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
