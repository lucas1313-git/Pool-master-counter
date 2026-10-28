// Every score is kept, and so is in every backup:
// - a Straight Pool game to 10: the game keeps both players' points (10 and 7) and the race tally;
//   saved, they're in the players' game logs and in the backup file;
// - a race to 3: the game that ends it holds the race's final score (3-1);
// - a 4-player single-elimination tournament: the finished tournament keeps its game, race, every
//   match with its score, and the placings (1st, 2nd, the two semi-final losers sharing 3rd).
// Its own file server on 4250.
// usage: node tests/probe_scores.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4250, BASE = "http://localhost:" + PORT + "/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  await page.evaluateOnNewDocument(() => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) { if (blob && blob.type === "application/json") blob.text().then((t) => { window.__lastExport = t; }); return orig.call(URL, blob); };
    HTMLAnchorElement.prototype.click = function () {};
  });
  const open = async (currentGame, roster, race) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((cg, roster, race) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      if (roster) localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: roster.map((n, i) => ({ id: "p" + i, name: n, playing: true, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: cg, raceToWinsTarget: race, rotation: { enabled: false, order: [], every: 1 } }));
    }, currentGame, roster || null, race || 1);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(800);
  };
  const tapPlus = (name) => page.evaluate((name) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label") === "Add point for " + name).click(), name);
  const closeAll = () => page.evaluate(() => {
    for (let i = 0; i < 6; i++) {
      const shown = (x) => !x.classList.contains("hidden") && getComputedStyle(x).display !== "none" && x.getClientRects().length > 0;
      const o = [...document.querySelectorAll("[id$='-overlay']")].find(shown);
      if (!o) return;
      const b = [...o.querySelectorAll("button.btn-primary")].find((x) => x.getClientRects().length > 0 && !x.closest(".hidden"));
      if (b) b.click(); else return;
    }
  });
  const live = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory);
  const stats = async () => (await readBig(page, "playerStats")) || {};

  // ---- 1. Straight Pool to 10: both players' points ----
  await open({ gameType: "straight", target: 10, unit: "points", mode: "individual" }, ["Alex", "Sam"], 5);
  for (let i = 0; i < 7; i++) { await tapPlus("Sam"); await sleep(80); }
  for (let i = 0; i < 10; i++) { await tapPlus("Alex"); await sleep(80); }
  await sleep(400);
  await closeAll();
  let g = (await live())[0];
  check("Straight Pool to 10, Alex wins 10-7: the game keeps both scores and the tally", g && JSON.stringify(g.scores) === JSON.stringify({ Alex: 10, Sam: 7 }) && JSON.stringify(g.raceTally) === JSON.stringify({ Alex: 1, Sam: 0 }), g && { scores: g.scores, tally: g.raceTally });
  await page.evaluate(() => document.getElementById("btn-reset-session-tournament").click());
  await sleep(300);
  await page.click("#btn-save-session-save");
  await sleep(600);
  let st = await stats();
  const saved = (st.Alex ? st.Alex.sessions : []).flatMap((s) => s.games).find((x) => x.scores);
  check("...saved: Alex's game log has the 10-7", saved && saved.scores.Alex === 10 && saved.scores.Sam === 7, saved);
  await page.evaluate(() => { window.__lastExport = null; const p = document.getElementById("backup-panel"); if (p.classList.contains("collapsed")) document.getElementById("btn-toggle-backup-panel").click(); });
  await sleep(300);
  await page.evaluate(() => document.getElementById("btn-backup-now").click()); // (hidden behind the seated board)
  await sleep(300);
  await page.click("#btn-confirm-modal-ok");
  let raw = null;
  for (let i = 0; i < 30 && !raw; i++) { await sleep(200); raw = await page.evaluate(() => window.__lastExport); }
  const inBackup = raw ? JSON.parse(raw).playerStats.Sam.sessions.flatMap((s) => s.games).find((x) => x.scores) : null;
  check("...and the backup file has it too (Sam's log: 10-7)", inBackup && inBackup.scores.Alex === 10 && inBackup.scores.Sam === 7, inBackup);

  // ---- 2. Race to 3: the last game holds 3-1 ----
  await open({ gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, ["Kim", "Jo"], 3);
  for (const w of ["Kim", "Jo", "Kim", "Kim"]) { await tapPlus(w); await sleep(300); await closeAll(); await sleep(300); }
  await sleep(600);
  await closeAll();
  st = await stats();
  const raceWin = (st.Kim ? st.Kim.sessions : []).flatMap((s) => s.games).find((x) => x.wonRace);
  check("race to 3, Kim wins 3-1: the deciding game keeps the race's final score", raceWin && JSON.stringify(raceWin.raceTally) === JSON.stringify({ Kim: 3, Jo: 1 }) && raceWin.raceTarget === 3, raceWin && { tally: raceWin.raceTally, target: raceWin.raceTarget });

  // ---- 3. A 4-player single elimination keeps every match and the placings ----
  await open({ gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, ["Ann", "Ben", "Cat", "Dan"], 5);
  const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(400); };
  await page.evaluate(() => document.getElementById("btn-open-tournament").click());
  await sleep(500);
  await tap('input[name="tournament-format"][value="single"]');
  await tap("#btn-tournament-setup-next");
  await tap("#btn-tournament-setup-next");
  const checked = await page.evaluate(() => [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].filter((c) => c.checked).length);
  if (checked < 4) await tap("#tournament-select-all-checkbox");
  await tap("#btn-tournament-setup-next");
  await tap("#btn-tournament-start");
  await sleep(800);
  for (let guard = 0; guard < 12; guard++) {
    const play = await page.evaluate(() => { const b = [...document.querySelectorAll("#tournament-ready-list button.btn-primary")].find((x) => x.offsetParent && /Play/.test(x.textContent)); if (b) b.setAttribute("data-probe", "play"); return !!b; });
    if (!play) break;
    await page.click('[data-probe="play"]');
    await sleep(600);
    for (let rack = 0; rack < 6; rack++) {
      const plus = await page.evaluate(() => { const b = [...document.querySelectorAll(".btn-ball.plus")].find((x) => x.offsetParent); if (b) b.setAttribute("data-probe", "plus"); return !!b; });
      if (!plus) break;
      await page.click('[data-probe="plus"]');
      await sleep(500);
      await closeAll();
      await sleep(300);
      const backToList = await page.evaluate(() => [...document.querySelectorAll("#tournament-ready-list button.btn-primary")].some((x) => x.offsetParent && /Play/.test(x.textContent)));
      if (backToList) break;
    }
  }
  await sleep(1200);
  const result = await page.evaluate(() => (JSON.parse(localStorage.getItem("poolMasterCounter.tournamentResults.v1") || "[]"))[0] || null);
  check("the finished tournament keeps its game and race (8-Ball, race to the set number)", result && result.gameType === "8ball" && typeof result.raceTo === "number", result && { gameType: result.gameType, raceTo: result.raceTo });
  check("...every match: 3 (two semi-finals and the final), each with its score and winner", result && result.matches.length === 3 && result.matches.every((m) => typeof m.scoreA === "number" && typeof m.scoreB === "number" && (m.winner === m.a || m.winner === m.b)), result && result.matches);
  const pl = result ? result.placings : [];
  check("...placings: 1st the champion, 2nd the final's loser, the two semi-final losers sharing 3rd", pl.length === 3 && pl[0].place === 1 && pl[0].names.length === 1 && pl[0].names[0] === (result.championNames || [])[0] && pl[1].place === 2 && pl[1].names.length === 1 && pl[2].place === 3 && pl[2].names.length === 2, pl);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
