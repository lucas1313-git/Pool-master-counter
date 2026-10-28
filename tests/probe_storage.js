// Storage you can trust:
// - storage full: the next score shows a big red "NOT SAVED" bar ("storage is full"), with Back up
//   now and See storage; once there's room again the next save takes it away;
// - Backup & Restore shows how full the storage is and what's using it;
// - importing a backup that doesn't fit changes nothing ("Add to what's here" and "Replace"): every
//   key is as it was, and the alert says so;
// - a backup carries everything but videos: the camera page's room plan / tags / map options / view,
//   Quick Game's race, the Drive folder link.
// Its own file server on 4249; storage is filled on purpose with a junk key.
// usage: node tests/probe_storage.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4249, BASE = "http://localhost:" + PORT + "/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-storage-"));

(async () => {
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 820 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.dismiss());
  await page.evaluateOnNewDocument(() => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) { if (blob && blob.type === "application/json") blob.text().then((t) => { window.__lastExport = t; }); return orig.call(URL, blob); };
    HTMLAnchorElement.prototype.click = function () {}; // (no real downloads)
  });
  const fresh = async (extra) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((extra) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      Object.keys(extra || {}).forEach((k) => localStorage.setItem(k, extra[k]));
    }, extra || null);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(800);
  };
  // fill the storage with a junk key until nothing more fits, then give back `leave` characters
  const fill = (leave) => page.evaluate((leave) => {
    let junk = "", step = 1 << 20;
    while (step >= 64) {
      try { localStorage.setItem("zz-junk", junk + "x".repeat(step)); junk += "x".repeat(step); } catch (e) { step = step >> 1; }
    }
    if (leave) localStorage.setItem("zz-junk", junk.slice(0, Math.max(0, junk.length - leave)));
    return junk.length;
  }, leave || 0);
  const banner = () => page.evaluate(() => { const b = document.getElementById("not-saved-banner"); return { shown: !b.classList.contains("hidden"), text: b.textContent.replace(/\s+/g, " ").trim() }; });
  const addPlayers = (names) => page.evaluate(async (names) => {
    for (const n of names) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
  }, names);
  const winRack = async (name) => {
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label") === "Add point for " + name).click(), name);
    await sleep(300);
    await page.evaluate(() => { const o = document.getElementById("gamewin-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-gamewin-close").click(); });
    await sleep(300);
  };

  // ---- 1. Storage full: NOT SAVED, said on screen; room again: gone ----
  await fresh();
  await addPlayers(["Alex", "Sam"]);
  await sleep(400);
  await fill(0);
  await winRack("Alex");
  let b = await banner();
  check("storage full, Alex wins a rack: a big \"⚠️ NOT SAVED\" bar - \"storage is full\", with Back up now and See storage", b.shown && /NOT SAVED/.test(b.text) && /storage is full/.test(b.text) && /Back up now/.test(b.text) && /See storage/.test(b.text), b);
  await page.click("#btn-not-saved-storage");
  await sleep(500);
  const meter = await page.evaluate(() => ({ line: document.getElementById("bk-storage-line").textContent, full: document.getElementById("bk-storage").classList.contains("is-full"), list: [...document.querySelectorAll("#bk-storage-list li")].map((li) => li.textContent), open: document.getElementById("bk-storage-details").open }));
  check("...See storage: \"Storage on this device: X of about N MB used\", marked almost full, \"What's using it\" open with the junk under \"Everything else\"", /^Storage on this device: [\d.]+ of about [\d.]+ MB used \(\d+%\)\. Almost full/.test(meter.line) && meter.full && meter.open && meter.list.some((l) => /^Everything else: /.test(l)), meter);
  await page.evaluate(() => localStorage.removeItem("zz-junk"));
  await winRack("Sam");
  b = await banner();
  check("...room again: the next save takes the bar away", !b.shown, b);

  // ---- 2. A backup carries everything but videos ----
  const extras = { "pmc-room-plan": "{\"w\":12}", "pmc-camera-room-tags": "[\"rail\"]", "pmc-room-map-options": "{\"zones\":true}", "pmc-camera-view": "\"table\"", "poolMasterCounter.quickGameRace.v1": "7", "poolMasterCounter.driveFolderLink.v1": "https://drive.google.com/drive/folders/1TESTfolderLink" };
  await fresh(extras);
  await page.evaluate(() => { window.__lastExport = null; const p = document.getElementById("backup-panel"); if (p.classList.contains("collapsed")) document.getElementById("btn-toggle-backup-panel").click(); });
  await sleep(300);
  await page.click("#btn-backup-now");
  await sleep(300);
  await page.click("#btn-confirm-modal-ok");
  let raw = null;
  for (let i = 0; i < 30 && !raw; i++) { await sleep(200); raw = await page.evaluate(() => window.__lastExport); }
  const backup = raw ? JSON.parse(raw) : {};
  const s = backup.settings || {};
  check("a backup has the camera page's room plan, tags, map options and view, and Quick Game's race", s["pmc-room-plan"] === extras["pmc-room-plan"] && s["pmc-camera-room-tags"] === extras["pmc-camera-room-tags"] && s["pmc-room-map-options"] === extras["pmc-room-map-options"] && s["pmc-camera-view"] === extras["pmc-camera-view"] && s["poolMasterCounter.quickGameRace.v1"] === "7", Object.keys(s));
  check("...and the Drive folder link", backup.driveFolderLink === extras["poolMasterCounter.driveFolderLink.v1"], backup.driveFolderLink);

  // ---- 3. An import that doesn't fit changes nothing ----
  // a backup with ~1.5 MB of game logs; here: Alex & Sam, a saved list, a note
  const bigStats = {};
  for (let p = 0; p < 6; p++) {
    const games = [];
    for (let i = 0; i < 700; i++) games.push({ ts: new Date(Date.UTC(2026, 5, 1, 12, 0, p * 1000 + i)).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, result: i % 2 ? "won" : "lost", winnerNames: ["P" + p], opponentNames: ["Q" + p], teammateNames: [], isTeam: false });
    bigStats["P" + p] = { name: "P" + p, sessions: [{ date: "2026-06-01", wins: 350, gamesWon: [], opponents: ["Q" + p], games }] };
  }
  const bigFile = path.join(TMP, "big.json");
  fs.writeFileSync(bigFile, JSON.stringify({ exportedAt: "2026-06-02T09:00:00.000Z", state: { players: [{ id: "x1", name: "Pat", playing: false, balls: 0 }], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, gameHistory: [] }, playerStats: bigStats, rosters: [{ id: "r1", label: "Big night", players: ["Pat"] }] }));
  const keysNow = () => page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== "zz-junk") o[k] = localStorage.getItem(k); } return o; });
  const tryImport = async (how) => {
    await page.evaluate(() => { const p = document.getElementById("backup-panel"); if (p.classList.contains("collapsed")) document.getElementById("btn-toggle-backup-panel").click(); });
    await sleep(300);
    await page.click("#btn-restore");
    await sleep(300);
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click("#btn-bk-pick-file")]);
    await chooser.accept([bigFile]);
    await sleep(900);
    await page.click(how === "add" ? "#btn-bk-add" : "#btn-bk-replace");
    await sleep(900);
    if (how === "replace") { await page.click("#btn-squash-confirm"); await sleep(1500); }
    else {
      // ("Merge this backup into your existing data?" - yes)
      const asks = await page.evaluate(() => /Merge this backup/.test(document.getElementById("confirm-modal-message").textContent));
      if (asks) { await page.click("#btn-confirm-modal-ok"); await sleep(1500); }
    }
    return page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); return o && !o.classList.contains("hidden") ? document.getElementById("confirm-modal-message").textContent : ""; });
  };
  for (const how of ["add", "replace"]) {
    await fresh();
    await addPlayers(["Alex", "Sam"]);
    await winRack("Alex");
    await page.evaluate(() => { localStorage.setItem("poolMasterCounter.dayNotes.v1", JSON.stringify({ "2026-10-20": "keep me" })); localStorage.setItem("poolMasterCounter.rosters.v1", JSON.stringify([{ id: "mine", label: "Mine", players: ["Alex", "Sam"] }])); });
    await fill(400000); // (room for the small keys, not for 1.5 MB of game logs)
    const before = await keysNow();
    const said = await tryImport(how);
    const after = await keysNow();
    const changed = Object.keys(Object.assign({}, before, after)).filter((k) => before[k] !== after[k] && !/lastBackup|leaderboard|pendingArchive|focusMode/.test(k));
    check((how === "add" ? "Add to what's here" : "Replace what's here") + ", storage too full for the backup: \"Nothing was changed...\", and every key is as it was", /^Nothing was changed: this device's storage is full/.test(said) && changed.length === 0, { said, changed });
    await page.evaluate(() => { localStorage.removeItem("zz-junk"); const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); });
    await sleep(1500);
  }

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
