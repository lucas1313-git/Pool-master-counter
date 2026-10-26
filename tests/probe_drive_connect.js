// Google Drive signed in with the user's own OAuth client (server/google-drive.js
// and Backup & Transfer's 🔗 Google Drive sign-in), against a fake Google: its
// sign-in page (straight back with a code), token endpoint (PKCE checked,
// refresh tokens), revoke, and a small Drive (about, files, alt=media,
// resumable uploads). The scoreboard's server is started by this test with
// a throwaway HOME and PMC_GOOGLE_* pointing at the fake.
// Checks: the client saved on this computer only (bad ID refused, the secret
// never sent back, the file readable by this user only); Connect -> Google's
// sign-in -> back -> "Connected as ..."; backups upload into the linked
// folder (the right parent, a complete backup, no secret or token in it);
// Import lists the folder's backups and reads one through the sign-in (a
// private folder, no API key); the access token renewed from the refresh
// token; Disconnect revokes it; a sign-in Google ended -> "press Connect
// again"; set-up refused from another device.
// usage: node tests/probe_drive_connect.js     (starts its own servers on 4237 and 4299)
const puppeteer = require("puppeteer-core");
const http = require("http");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 4237, GPORT = 4299, BASE = "http://localhost:" + PORT + "/", G = "http://localhost:" + GPORT;
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = path.join(__dirname, "tmphome", "drive-connect-home");
const CLIENT_ID = "123456-test.apps.googleusercontent.com", SECRET = "GOCSPX-test-secret-value";
const FOLDER = "1FAKEpoolBackupsFolder01", LINK = "https://drive.google.com/drive/folders/" + FOLDER;
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---- a fake Google ----
const google = { codes: {}, refresh: {}, access: {}, files: [], sessions: {}, calls: { refresh: 0, revoked: [] }, rejectRefresh: false };
google.files.push({ id: "1OLDbackupFileId0001", name: "old-backup.json", parents: [FOLDER], modifiedTime: "2026-10-01T10:00:00Z", mimeType: "application/json",
  content: JSON.stringify({ exportedAt: "2026-10-01T10:00:00Z", state: { players: [{ id: "p-mario", name: "Mario", playing: false, balls: 0 }], currentGame: { gameType: "8ball", unit: "rack", target: 1, mode: "individual" }, gameHistory: [] } }) });
function body(req) { return new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c).toString("utf8"))); }); }
function json(res, status, obj, headers) { res.writeHead(status, Object.assign({ "Content-Type": "application/json" }, headers || {})); res.end(JSON.stringify(obj)); }
function bearer(req) { const t = (req.headers.authorization || "").replace(/^Bearer /, ""); return google.access[t] ? t : null; }
const fakeGoogle = http.createServer(async (req, res) => {
  const u = new URL(req.url, G), p = u.pathname;
  if (p === "/auth") {
    const q = Object.fromEntries(u.searchParams);
    if (q.client_id !== CLIENT_ID || q.response_type !== "code" || q.access_type !== "offline" || !/auth\/drive$/.test(q.scope) || q.code_challenge_method !== "S256") return json(res, 400, { error: "bad auth request", q });
    const code = "code-" + crypto.randomBytes(4).toString("hex");
    google.codes[code] = { challenge: q.code_challenge, redirect: q.redirect_uri };
    res.writeHead(302, { Location: q.redirect_uri + "?code=" + code + "&state=" + encodeURIComponent(q.state) + "&scope=" + encodeURIComponent(q.scope) });
    return res.end();
  }
  if (p === "/token" && req.method === "POST") {
    const f = Object.fromEntries(new URLSearchParams(await body(req)));
    if (f.client_id !== CLIENT_ID || f.client_secret !== SECRET) return json(res, 401, { error: "invalid_client" });
    if (f.grant_type === "authorization_code") {
      const c = google.codes[f.code];
      if (!c || c.redirect !== f.redirect_uri || b64url(crypto.createHash("sha256").update(f.code_verifier || "").digest()) !== c.challenge) return json(res, 400, { error: "invalid_grant", error_description: "code / PKCE" });
      delete google.codes[f.code];
      const r = "refresh-" + crypto.randomBytes(4).toString("hex"), a = "access-" + crypto.randomBytes(4).toString("hex");
      google.refresh[r] = true; google.access[a] = true;
      return json(res, 200, { access_token: a, expires_in: 61, refresh_token: r, token_type: "Bearer" });
    }
    if (f.grant_type === "refresh_token") {
      google.calls.refresh++;
      if (google.rejectRefresh || !google.refresh[f.refresh_token]) return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
      const a = "access-" + crypto.randomBytes(4).toString("hex");
      google.access[a] = true;
      return json(res, 200, { access_token: a, expires_in: 61, token_type: "Bearer" });
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }
  if (p === "/revoke") { const f = Object.fromEntries(new URLSearchParams(await body(req))); google.calls.revoked.push(f.token); delete google.refresh[f.token]; return json(res, 200, {}); }
  if (p.startsWith("/upload/session/") && req.method === "PUT") {
    if (!bearer(req)) return json(res, 401, { error: { message: "no auth" } });
    const s = google.sessions[p.split("/").pop()];
    const file = { id: "1UP" + crypto.randomBytes(6).toString("hex"), name: s.name, parents: s.parents, mimeType: s.mimeType, modifiedTime: new Date().toISOString(), content: await body(req) };
    google.files.push(file);
    return json(res, 200, { id: file.id, name: file.name });
  }
  if (!bearer(req)) return json(res, 401, { error: { message: "Request had invalid authentication credentials." } });
  if (p === "/upload/drive/v3/files" && u.searchParams.get("uploadType") === "resumable") {
    const meta = JSON.parse(await body(req)), sid = crypto.randomBytes(5).toString("hex");
    google.sessions[sid] = meta;
    return json(res, 200, {}, { Location: G + "/upload/session/" + sid });
  }
  if (p === "/drive/v3/about") return json(res, 200, { user: { emailAddress: "tester@example.com", displayName: "Tester" } });
  if (p === "/drive/v3/files") {
    const m = (u.searchParams.get("q") || "").match(/'([^']+)' in parents/);
    const list = google.files.filter((f) => m && f.parents.includes(m[1])).sort((a, b) => (a.modifiedTime < b.modifiedTime ? 1 : -1)).map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, mimeType: f.mimeType }));
    return json(res, 200, { files: list });
  }
  const fm = p.match(/^\/drive\/v3\/files\/([^/]+)$/);
  if (fm) {
    if (fm[1] === FOLDER) return json(res, 200, { id: FOLDER, name: "Pool Backups", mimeType: "application/vnd.google-apps.folder" });
    const f = google.files.find((x) => x.id === fm[1]);
    if (!f) return json(res, 404, { error: { message: "File not found" } });
    if (u.searchParams.get("alt") === "media") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(f.content); }
    return json(res, 200, { id: f.id, name: f.name, mimeType: f.mimeType });
  }
  json(res, 404, { error: { message: "no such fake endpoint " + p } });
});

function lanIp() { for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) if (i.family === "IPv4" && !i.internal) return i.address; return null; }

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(path.join(HOME, "Library", "CloudStorage"), { recursive: true }); // (no Drive for desktop here)
  await new Promise((ok) => fakeGoogle.listen(GPORT, ok));
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: Object.assign({}, process.env, { HOME, PORT: String(PORT), PMC_CLOUD_STORAGE: path.join(HOME, "Library", "CloudStorage"), PMC_CLIPBOARD_FILE: path.join(HOME, "clip.txt"),
      PMC_GOOGLE_AUTH_URL: G + "/auth", PMC_GOOGLE_TOKEN_URL: G + "/token", PMC_GOOGLE_REVOKE_URL: G + "/revoke", PMC_GOOGLE_API: G }), stdio: "ignore"
  });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + "manifest.json")).ok) break; } catch (e) {} await sleep(250); }

  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(600);
  await page.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    const b = document.getElementById("btn-toggle-backup-panel");
    if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click();
    // Backup & Restore › More options: the Drive folder and the owner's sign-in setup (on the Mac)
    document.getElementById("bk-more").open = true;
  });
  await sleep(800);
  const ui = () => page.evaluate(() => {
    const vis = (id) => !document.getElementById(id).classList.contains("hidden") && document.getElementById(id).offsetParent !== null;
    return { status: document.getElementById("drive-connect-status").textContent, setup: vis("drive-connect-setup"), secret: vis("drive-client-secret-input"), connect: vis("btn-drive-connect"), disconnect: vis("btn-drive-disconnect"), backup: document.getElementById("drive-backup-status").textContent };
  });
  const waitUi = async (f) => { let u; for (let i = 0; i < 40; i++) { u = await ui(); if (f(u)) break; await sleep(250); } return u; };
  const toast = () => page.evaluate(() => { const t = [...document.querySelectorAll("#page-toast, #win-toast")].find((x) => !x.classList.contains("hidden") && x.textContent.trim()); return t ? t.textContent : ""; });
  const type = (id, v) => page.evaluate((id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event("input", { bubbles: true })); }, id, v);

  let u = await ui();
  u = await waitUi((x) => /no sign-in needed/.test(x.status));
  check("no sign-in set up: no Connect (nothing it could do), \"no sign-in needed\" here; the owner's setup (ID and secret) under More options", /no sign-in needed/.test(u.status) && u.setup && u.secret && !u.connect, u);

  // the client: a wrong ID refused, then saved
  await type("drive-client-id-input", "not-a-client-id"); await type("drive-client-secret-input", SECRET);
  await page.click("#btn-drive-save-client"); await sleep(600);
  check("a wrong client ID: refused, says why", /isn't a client ID/.test(await toast()), await toast());
  await type("drive-client-id-input", CLIENT_ID); await type("drive-client-secret-input", SECRET);
  await page.click("#btn-drive-save-client");
  u = await waitUi((x) => /Not connected yet/.test(x.status));
  const cfgFile = path.join(HOME, ".pool-master-counter", "google-drive.json");
  const mode = fs.existsSync(cfgFile) ? (fs.statSync(cfgFile).mode & 0o777).toString(8) : null;
  const statusJson = await (await fetch(BASE + "api/drive/status")).text();
  const typedLeft = await page.evaluate(() => document.getElementById("drive-client-secret-input").value);
  check("saved: \"Not connected yet: press Connect\", the secret field emptied", /Not connected yet/.test(u.status) && u.connect && typedLeft === "", { u, typedLeft });
  check("...kept on this computer only, readable by this user only (600), never sent back", mode === "600" && JSON.parse(fs.readFileSync(cfgFile, "utf8")).clientSecret === SECRET && statusJson.indexOf(SECRET) === -1, { mode, statusJson });

  // Connect: Google's sign-in, straight back
  const newTab = new Promise((ok) => browser.once("targetcreated", (t) => ok(t)));
  await page.click("#btn-drive-connect");
  const tab = await (await newTab).page();
  let tabText = "";
  for (let i = 0; i < 40; i++) { await sleep(250); try { tabText = await tab.evaluate(() => document.body ? document.body.innerText : ""); } catch (e) {} if (/connected/i.test(tabText)) break; }
  check("Connect: Google's sign-in (code + PKCE checked) and back - \"Google Drive connected (tester@example.com)\"", /Google Drive connected \(tester@example\.com\)/.test(tabText), tabText);
  u = await waitUi((x) => /Connected to Google as/.test(x.status));
  check("the scoreboard: \"Connected to Google as tester@example.com\", Disconnect offered", /Connected to Google as tester@example\.com/.test(u.status) && u.disconnect && !u.connect, u);

  // the folder: backups upload into it
  await page.evaluate((l) => { const i = document.getElementById("drive-folder-link-input"); i.value = l; i.dispatchEvent(new Event("change", { bubbles: true })); }, LINK);
  u = await waitUi((x) => /upload straight into/.test(x.backup));
  check("the folder link: \"Backups upload straight into “Pool Backups” (Google Drive, signed in)\"", /Backups upload straight into “Pool Backups” \(Google Drive, signed in\)/.test(u.backup), u.backup);
  await page.click("#btn-backup-now");
  let up = null;
  for (let i = 0; i < 40 && !up; i++) { await sleep(250); up = google.files.find((f) => /all-data/.test(f.name)); }
  const upData = up ? JSON.parse(up.content) : null;
  check("All Data: uploaded into the folder through the Drive API (" + (up && up.name) + ")", up && up.parents[0] === FOLDER && upData.state.players.length === 2 && upData.driveFolderLink === LINK, up && { parents: up.parents });
  check("...no client secret, no sign-in token in the backup", up && up.content.indexOf(SECRET) === -1 && !Object.keys(google.refresh).some((r) => up.content.indexOf(r) !== -1));
  await sleep(300);
  check("...says so", /Saved in your Drive folder “Pool Backups”/.test(await toast()), await toast());

  // Restore › From Google Drive: the folder's backups listed and read through the sign-in
  await page.click("#btn-restore"); await sleep(300);
  await page.click("#btn-bk-pick-drive");
  let rows = [];
  for (let i = 0; i < 30 && rows.length < 2; i++) { await sleep(250); rows = await page.evaluate(() => [...document.querySelectorAll("#bk-drive-list .bk-drive-row")].map((b) => b.textContent)); }
  check("⬇️ Restore › From Google Drive: the folder's backups listed (no API key, a private folder)", rows.length === 2 && rows.some((r) => /old-backup\.json/.test(r)), rows);
  await page.evaluate(() => [...document.querySelectorAll("#bk-drive-list .bk-drive-row")].find((b) => /old-backup/.test(b.textContent)).click());
  for (let i = 0; i < 20; i++) { await sleep(250); if (await page.evaluate(() => !document.getElementById("bk-step-how").classList.contains("hidden"))) break; }
  await page.click("#btn-bk-add");
  let mario = false;
  for (let i = 0; i < 30 && !mario; i++) {
    await sleep(300);
    await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); });
    mario = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.some((p) => p.name === "Mario"); } catch (e) { return false; } });
  }
  check("...one picked, \"Add to what's here\": read through the sign-in and imported (Mario is here)", mario);
  check("the access token renewed from the refresh token along the way", google.calls.refresh >= 1, google.calls);

  // Disconnect: revoked (the import's own messages closed first)
  const closeModals = async () => { for (let i = 0; i < 10; i++) { const open = await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) { document.getElementById("btn-confirm-modal-ok").click(); return true; } return false; }); if (!open) break; await sleep(400); } };
  const openPanel = () => page.evaluate(() => { const b = document.getElementById("btn-toggle-backup-panel"); if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click(); });
  await sleep(800); await closeModals(); await openPanel(); await sleep(400);
  await page.evaluate(() => document.getElementById("btn-drive-disconnect").click()); await sleep(400);
  await page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click());
  u = await waitUi((x) => /Not connected yet/.test(x.status));
  check("Disconnect: the sign-in revoked at Google, back to \"Not connected yet\"", google.calls.revoked.length === 1 && /^refresh-/.test(google.calls.revoked[0]) && /Not connected yet/.test(u.status), { revoked: google.calls.revoked, u });

  // a sign-in Google ended: "press Connect again"
  const tab2 = new Promise((ok) => browser.once("targetcreated", (t) => ok(t)));
  await closeModals(); await openPanel();
  await page.evaluate(() => document.getElementById("btn-drive-connect").click());
  await (await tab2).page();
  await waitUi((x) => /Connected to Google as/.test(x.status));
  google.rejectRefresh = true;
  await sleep(1500); // (the access token is near its end: the next call renews - and Google refuses)
  await page.evaluate(() => { const i = document.getElementById("drive-folder-link-input"); i.value = i.value + " "; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(1500);
  await page.reload({ waitUntil: "networkidle2" });
  await page.evaluate(() => { const b = document.getElementById("btn-toggle-backup-panel"); if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click(); });
  u = await waitUi((x) => /ended the sign-in/.test(x.status));
  check("a sign-in Google ended (expired / withdrawn): \"press Connect again\"", /Google ended the sign-in.*press Connect again/.test(u.status), u.status);

  // set up from another device: refused
  const ip = lanIp();
  if (ip) {
    const r = await fetch("http://" + ip + ":" + PORT + "/api/drive/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: CLIENT_ID, clientSecret: "x".repeat(20) }) }).catch(() => null);
    const st = r ? await (await fetch("http://" + ip + ":" + PORT + "/api/drive/status")).json() : null;
    check("from another device: the client can't be changed (403), and the page says to connect on the Mac", r && r.status === 403 && st && st.local === false, { status: r && r.status, st });
  } else console.log("SKIP from another device (no network address)");

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  server.kill();
  fakeGoogle.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
