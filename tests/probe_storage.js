// Storage you can trust:
// - storage full: the next score shows a big red "NOT SAVED" bar ("storage is full"), with Back up
//   now and See storage; once there's room again the next save takes it away;
// - Backup & Restore shows how full the storage is and what's using it;
// - a big backup (1.5 MB of game logs) now comes in with little room left - the game logs go to the
//   database (js/big-store.js); one that can't be written changes nothing ("Add to what's here" and
//   "Replace"): every key and the game logs are as they were, and the alert says so;
// - updating from an older version: game logs still in the browser's storage move into the database
//   on the first start (the old key cleared), survive a reload, and are in the backup;
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
// The app opens on the board (Focus Mode); this probe works in the panels, so 🔍 Show All once it's up.
const showAll = async (pg) => {
  await pg.waitForFunction(() => document.getElementById("app") && document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
  await pg.evaluate(() => document.getElementById("btn-toggle-focus").click());
};
// (game logs, report archive... live in IndexedDB - js/big-store.js - under the generation in use)
const readBig = (page, name) => page.evaluate((name) => new Promise((resolve) => {
  const gen = localStorage.getItem("poolMasterCounter.bigStoreGen.v1") || "0";
  const req = indexedDB.open("pmc-big", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("kv");
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    try {
      const get = req.result.transaction("kv", "readonly").objectStore("kv").get(name + "@" + gen);
      get.onsuccess = () => { resolve(get.result === undefined ? null : get.result); req.result.close(); };
      get.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  };
}), name);
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
    await page.goto(BASE, { waitUntil: "networkidle2" }); await showAll(page);
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
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
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
  await sleep(300);
  await page.evaluate(() => { const b = document.getElementById("btn-bk-to-drive-folder") || document.getElementById("btn-bk-to-downloads"); if (b) b.click(); }); // (where to: a computer asks - the Drive folder where it can, else Downloads)
  let raw = null;
  for (let i = 0; i < 30 && !raw; i++) { await sleep(200); raw = await page.evaluate(() => window.__lastExport); }
  const backup = raw ? JSON.parse(raw) : {};
  const s = backup.settings || {};
  check("a backup has the camera page's room plan, tags, map options and view, and Quick Game's race", s["pmc-room-plan"] === extras["pmc-room-plan"] && s["pmc-camera-room-tags"] === extras["pmc-camera-room-tags"] && s["pmc-room-map-options"] === extras["pmc-room-map-options"] && s["pmc-camera-view"] === extras["pmc-camera-view"] && s["poolMasterCounter.quickGameRace.v1"] === "7", Object.keys(s));
  check("...and the Drive folder link", backup.driveFolderLink === extras["poolMasterCounter.driveFolderLink.v1"], backup.driveFolderLink);

  // ---- 3. An import that doesn't fit changes nothing ----
  // a backup with ~1.5 MB of game logs and 300 KB of notes; here: Alex & Sam, a saved list, a note
  const bigStats = {};
  for (let p = 0; p < 6; p++) {
    const games = [];
    for (let i = 0; i < 700; i++) games.push({ ts: new Date(Date.UTC(2026, 5, 1, 12, 0, p * 1000 + i)).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, result: i % 2 ? "won" : "lost", winnerNames: ["P" + p], opponentNames: ["Q" + p], teammateNames: [], isTeam: false });
    bigStats["P" + p] = { name: "P" + p, sessions: [{ date: "2026-06-01", wins: 350, gamesWon: [], opponents: ["Q" + p], games }] };
  }
  const bigFile = path.join(TMP, "big.json");
  fs.writeFileSync(bigFile, JSON.stringify({ exportedAt: "2026-06-02T09:00:00.000Z", state: { players: [{ id: "x1", name: "Pat", playing: false, balls: 0 }], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, gameHistory: [] }, playerStats: bigStats, rosters: [{ id: "r1", label: "Big night", players: ["Pat"] }], dayNotes: { "2026-06-01": "n".repeat(300000) } })); // (notes stay in the browser's storage)
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
  // a) little room left: the game logs go to the database - it comes in
  await fresh();
  await addPlayers(["Alex", "Sam"]);
  await winRack("Alex");
  await fill(400000);
  let said = await tryImport("add");
  await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); });
  await sleep(2500);
  let logs = (await readBig(page, "playerStats")) || {};
  check("1.5 MB of game logs, little room left in the browser's storage: \"Add to what's here\" brings it in (the logs go to the database)", !/Nothing was changed/.test(said) && ["P0", "P5"].every((n) => logs[n] && logs[n].sessions[0].games.length === 700), { said, players: Object.keys(logs) });
  await page.evaluate(() => localStorage.removeItem("zz-junk"));
  // b) no room at all: nothing changes
  for (const how of ["add", "replace"]) {
    await fresh();
    await addPlayers(["Alex", "Sam"]);
    await winRack("Alex");
    await page.evaluate(() => { localStorage.setItem("poolMasterCounter.dayNotes.v1", JSON.stringify({ "2026-10-20": "keep me" })); localStorage.setItem("poolMasterCounter.rosters.v1", JSON.stringify([{ id: "mine", label: "Mine", players: ["Alex", "Sam"] }])); });
    await page.evaluate(() => document.getElementById("btn-reset-session-tournament").click());
    await sleep(300);
    await page.click("#btn-save-session-save"); // (Alex's game into his log, in the database)
    await sleep(600);
    const logsBefore = JSON.stringify((await readBig(page, "playerStats")) || {});
    await fill(0);
    const before = await keysNow();
    said = await tryImport(how);
    const after = await keysNow();
    const changed = Object.keys(Object.assign({}, before, after)).filter((k) => before[k] !== after[k] && !/lastBackup|leaderboard|pendingArchive|focusMode/.test(k));
    const logsAfter = JSON.stringify((await readBig(page, "playerStats")) || {});
    check((how === "add" ? "Add to what's here" : "Replace what's here") + ", no room at all: \"Nothing was changed...\" - every key, and the game logs, as they were", /^Nothing was changed: this device's storage is full/.test(said) && changed.length === 0 && logsAfter === logsBefore && /Alex/.test(logsAfter), { said, changed, logsSame: logsAfter === logsBefore });
    await page.evaluate(() => { localStorage.removeItem("zz-junk"); const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); });
    await sleep(1500);
  }

  // ---- 4. From an older version: the game logs move into the database ----
  const oldLogs = { Old: { name: "Old", sessions: [{ date: "2026-05-01", wins: 1, gamesWon: ["8-Ball"], opponents: ["Timer"], games: [{ ts: "2026-05-01T20:00:00.000Z", gameType: "8ball", gameLabel: "8-Ball", target: 1, result: "won", winnerNames: ["Old"], opponentNames: ["Timer"], teammateNames: [], isTeam: false }] }] } };
  await fresh({ "poolMasterCounter.playerStats.v1": JSON.stringify(oldLogs) });
  await sleep(500);
  const moved = { legacy: await page.evaluate(() => localStorage.getItem("poolMasterCounter.playerStats.v1")), db: await readBig(page, "playerStats") };
  check("an older version's game logs move into the database on the first start (the old key cleared)", moved.legacy === null && moved.db && moved.db.Old && moved.db.Old.sessions[0].games.length === 1, moved);
  await page.reload({ waitUntil: "networkidle2" }); await showAll(page);
  await sleep(800);
  await page.evaluate(() => { window.__lastExport = null; document.getElementById("btn-backup-now").click(); });
  await sleep(300);
  await page.click("#btn-confirm-modal-ok");
  await sleep(300);
  await page.evaluate(() => { const b = document.getElementById("btn-bk-to-drive-folder") || document.getElementById("btn-bk-to-downloads"); if (b) b.click(); }); // (where to: a computer asks - the Drive folder where it can, else Downloads)
  raw = null;
  for (let i = 0; i < 30 && !raw; i++) { await sleep(200); raw = await page.evaluate(() => window.__lastExport); }
  const again = raw ? JSON.parse(raw).playerStats : null;
  check("...still there after a reload, and in the backup file", again && again.Old && again.Old.sessions[0].games.length === 1, again && Object.keys(again));

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
