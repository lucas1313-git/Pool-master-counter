// End of the night (P17), at 1180x820:
// - Kim beats Jo 5-2 in a race to 5, then 3 more racks (Kim, Kim, Jo): no file downloads at all
//   during play (a new player list used to download itself);
// - ☰ Menu › 🌙 End night › 📤 Share in 3 taps: the sheet shows 10 games, the MVP (Kim 7–3), the
//   standings with rating changes and the matchup "Kim 7 – 3 Jo"; Share sends the report's text and
//   the picture card - no backup file; tonight's report is in the archive;
// - the Leaderboard and the Day Report count the same games (Kim: 7 wins in 10 games - the race
//   won isn't an 11th);
// - resets are in Backup & Restore only (not in the menu);
// - a Straight Pool game's final score: "100–87" in Recent Games and in the Day Report;
// - no page errors.
// Its own file server on 4271.
// usage: node tests/probe_end_night.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4271, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1180, height: 820, hasTouch: true });
  // every download the page starts
  const downloads = [];
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-dl-"));
  const cdp = await page.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: dlDir, eventsEnabled: true });
  cdp.on("Browser.downloadWillBegin", (e) => downloads.push(e.suggestedFilename));
  page.on("framenavigated", () => {});
  await page.evaluateOnNewDocument(() => {
    window.__shares = [];
    navigator.canShare = () => true;
    navigator.share = (data) => { window.__shares.push({ text: data.text || "", files: (data.files || []).map((f) => ({ name: f.name, type: f.type })) }); return Promise.resolve(); };
  });
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
    localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({
      players: [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }],
      playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 }
    }));
  });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(900);
  const plus = async (name) => {
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
    await sleep(800);
    await page.evaluate(() => { const m = document.getElementById("milestone-overlay"); if (!m.classList.contains("hidden")) document.getElementById("btn-milestone-rematch").click(); });
    await sleep(200);
  };
  for (const n of ["Jo", "Jo", "Kim", "Kim", "Kim", "Kim", "Kim", "Kim", "Kim", "Jo"]) await plus(n);
  await sleep(800);
  check("a race to 5 (5-2) and 3 more racks: no file downloaded during play", downloads.length === 0, downloads);

  // ---- End night, Share: 3 taps ----
  let taps = 0;
  await page.click("#btn-board-menu"); taps++;
  await sleep(250);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.endNight").click()); taps++;
  await sleep(600);
  const sheet = await page.evaluate(() => {
    const body = document.getElementById("end-night-body");
    return { shown: !document.getElementById("end-night-overlay").classList.contains("hidden"), text: body.textContent, rows: [...body.querySelectorAll(".end-night-table tr")].map((tr) => [...tr.children].map((td) => td.textContent)) };
  });
  check("☰ Menu › 🌙 End night: 10 games, MVP Kim (7–3), the standings with rating changes, \"Kim 7 – 3 Jo\"", sheet.shown && /10 games tonight/.test(sheet.text) && /MVP: Kim \(7–3\)/.test(sheet.text) && /Kim 7 – 3 Jo/.test(sheet.text) && sheet.rows.length === 2 && sheet.rows[0][0] === "Kim" && sheet.rows[0][1] === "7–3" && /^▲\d+/.test(sheet.rows[0][2]) && /^▼\d+/.test(sheet.rows[1][2]), sheet);
  if (OUT) await page.screenshot({ path: path.join(OUT, "end_night.png") });
  await page.click("#btn-end-night-share"); taps++;
  await sleep(800);
  const shares = await page.evaluate(() => window.__shares);
  const last = shares[shares.length - 1] || {};
  check("...📤 Share (" + taps + " taps in all): the report's text and the picture card - no backup", taps <= 3 && /Kim 7 – 3 Jo/.test(last.text || "") && (last.files || []).length === 1 && last.files[0].type === "image/png", { taps, files: last.files, text: (last.text || "").slice(0, 200) });
  const archive = (await readBig(page, "reportArchive")) || [];
  const today = await page.evaluate(() => { const d = new Date(); if (d.getHours() < 5) d.setDate(d.getDate() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
  check("...tonight's report is in the archive", archive.some((e) => e.dateStr === today), archive.map((e) => e.dateStr));
  await page.click("#btn-end-night-done");
  await sleep(200);

  // ---- the Leaderboard and the Day Report agree ----
  await page.click("#btn-board-menu");
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.stats").click());
  await sleep(150);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.leaderboard").click());
  await sleep(600);
  const lb = await page.evaluate(() => { const li = [...document.querySelectorAll("#leaderboard-list li")].find((x) => /Kim/.test(x.textContent)); return li ? li.textContent.replace(/\s+/g, " ") : document.getElementById("leaderboard-list").textContent.slice(0, 300); });
  check("the Leaderboard counts what the Day Report counts: Kim 7 wins in 10 games (the race won isn't an 11th)", /\b7 wins\b/.test(lb) && /\b10 games\b/.test(lb), lb);
  await page.evaluate(() => document.getElementById("btn-leaderboard-back") && document.getElementById("btn-leaderboard-back").click());
  await sleep(400);

  // ---- resets in Backup & Restore only ----
  await page.click("#btn-board-menu");
  await sleep(200);
  const resets = await page.evaluate(() => ({ menu: [...document.querySelectorAll("#board-menu-list .board-menu-row")].map((b) => b.dataset.menuKey).filter((k) => /reset/i.test(k || "")), inBackup: document.getElementById("backup-panel").contains(document.getElementById("resets-panel")) }));
  check("resets live in Backup & Restore only (not in the menu)", resets.menu.length === 0 && resets.inBackup, resets);
  await page.click("#btn-board-menu-close");

  // ---- a Straight Pool game's score ----
  const ts = new Date().toISOString();
  await page.evaluate((ts) => {
    const s = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
    s.gameHistory.unshift({ ts, gameType: "straight", gameLabel: "Straight Pool", target: 100, unit: "points", winnerNames: ["Kim"], winnerIds: [s.players.find((p) => p.name === "Kim").id], opponentNames: ["Jo"], isTeam: false, summary: "Kim won Straight Pool (target 100)", scores: { Kim: 100, Jo: 87 } });
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(s));
  }, ts);
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(900);
  await page.evaluate(() => { document.getElementById("btn-toggle-focus").click(); const b = document.getElementById("btn-toggle-history-panel"); if (document.getElementById("history-panel").classList.contains("collapsed")) b.click(); });
  await sleep(300);
  const recent = await page.evaluate(() => (document.querySelector("#history-list li") || {}).textContent || "");
  await page.evaluate(() => document.getElementById("btn-toggle-focus").click());
  await sleep(300);
  await page.click("#btn-board-menu");
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.endNight").click());
  await sleep(500);
  await page.click("#btn-end-night-share");
  await sleep(600);
  const report = (await page.evaluate(() => window.__shares[window.__shares.length - 1].text)) || "";
  check("a Straight Pool game's score: \"100–87\" in Recent Games and in the Day Report", /Straight Pool/.test(recent) && /100–87/.test(recent) && /100–87/.test(report), { recent, report: report.slice(0, 600) });

  check("no file downloaded at any point", downloads.length === 0, downloads);
  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
