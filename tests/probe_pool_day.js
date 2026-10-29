// A night is one "pool day" (5 a.m. to 5 a.m.), and saving keeps all of it:
// - "Save & Start New Session" files every day still on the board, for every name in it (a player
//   since removed too) - a night from 21:10 to 00:20, saved a week later, keeps every game, all
//   under the night's own date; its report is archived under that date too;
// - past 200 games the oldest go into the players' stats before they leave the board;
// - a new Quick Game saves the games on the board first; "Start Without Saving" still drops them;
// - importing a backup with a 19:00-01:00 night keeps all 13 games in Los Angeles and in Manila.
// Its own file server on 4246; the browser's time zone is emulated per page.
// usage: node tests/probe_pool_day.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4246, BASE = "http://localhost:" + PORT + "/";
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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-pool-day-"));

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

  // A fresh page in a time zone; `seed` (run in the page, so local times are that zone's) returns
  // the app's saved state to start from, or null for an empty app.
  async function open(tz, seed, arg) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(tz + ": " + e.message));
    await page.emulateTimezone(tz);
    await page.goto(BASE + "manifest.json");
    await page.evaluate((seedSrc, arg) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      const state = seedSrc ? new Function("arg", "return (" + seedSrc + ")(arg)")(arg) : null;
      if (state) localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(state));
    }, seed ? seed.toString() : null, arg === undefined ? null : arg);
    await page.goto(BASE, { waitUntil: "networkidle2" }); await showAll(page);
    await sleep(900);
    return page;
  }
  // a saved state with these games (each [winner, loser, y, m, d, hh, mm] in local time)
  const seedGames = function (arg) {
    const players = arg.roster.map((n, i) => ({ id: "p" + i, name: n, playing: true, balls: 0 }));
    const idOf = (n) => (players.find((p) => p.name === n) || { id: "x-" + n }).id;
    const games = arg.games.map(([w, l, y, mo, d, h, mi]) => ({
      ts: new Date(y, mo - 1, d, h, mi).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack",
      winnerNames: [w], opponentNames: [l], winnerIds: [idOf(w)], isTeam: false, summary: w + " won 8-Ball"
    })).reverse(); // (newest first, as the app keeps them)
    const playerWins = {};
    games.forEach((g) => { playerWins[g.winnerIds[0]] = (playerWins[g.winnerIds[0]] || 0) + 1; });
    return { players, playerWins, teamWins: {}, teamMvpWins: {}, gameHistory: games, gamesPlayedCount: games.length,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 } };
  };
  const stats = async (page) => (await readBig(page, "playerStats")) || {};
  const gamesOf = (st, name) => { const e = st[name]; const out = []; (e ? e.sessions : []).forEach((s) => (s.games || []).forEach((g) => out.push({ date: s.date, ts: g.ts, result: g.result }))); return out; };
  const saveAndStartNew = async (page, skip) => {
    await page.evaluate(() => document.getElementById("btn-reset-session-tournament").click());
    await sleep(300);
    await page.click(skip ? "#btn-save-session-skip" : "#btn-save-session-save");
    await sleep(500);
  };
  const winRack = async (page, name) => {
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label") === "Add point for " + name).click(), name);
    await sleep(300);
    await page.evaluate(() => { const o = document.getElementById("gamewin-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-gamewin-close").click(); });
    await sleep(300);
  };

  // ---- 1. A night past midnight, saved a week later ----
  const NIGHT = { roster: ["Alex", "Sam"], games: [
    ["Alex", "Sam", 2026, 10, 20, 21, 10], ["Kim", "Alex", 2026, 10, 20, 22, 0], ["Sam", "Alex", 2026, 10, 20, 23, 20],
    ["Alex", "Sam", 2026, 10, 20, 23, 50], ["Alex", "Sam", 2026, 10, 21, 0, 20]] };
  let page = await open("America/Los_Angeles", seedGames, NIGHT);
  await saveAndStartNew(page);
  let st = await stats(page);
  const alex = gamesOf(st, "Alex"), kim = gamesOf(st, "Kim");
  check("Save & Start New Session a week later: all 5 of Alex's games are in his stats (21:10 to 00:20)", alex.length === 5, alex);
  check("...all under the night's own date, 2026-10-20 (00:20 belongs to the night, not to the 21st)", alex.every((g) => g.date === "2026-10-20"), alex.map((g) => g.date));
  check("...Kim (not on the roster) keeps the game he played", kim.length === 1 && kim[0].result === "won", kim);
  check("...and the board is cleared", (await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory.length)) === 0);
  await page.reload({ waitUntil: "networkidle2" }); await showAll(page);
  await sleep(1200);
  const archive = ((await readBig(page, "reportArchive")) || []).map((e) => ({ d: e.dateStr, n: (e.gameTs || []).length }));
  check("the night's report is archived once, under 2026-10-20, with all 5 games (nothing under the 21st)", archive.length === 1 && archive[0].d === "2026-10-20" && archive[0].n === 5, archive);
  await page.close();

  // ---- 2. Past 200 games: the oldest go into the stats before they leave the board ----
  const MANY = { roster: ["Alex", "Sam"], games: [] };
  for (let i = 0; i < 205; i++) MANY.games.push([i % 3 ? "Alex" : "Sam", i % 3 ? "Sam" : "Alex", 2026, 10, 22, 12 + Math.floor(i / 60), i % 60]);
  page = await open("Europe/Paris", seedGames, MANY);
  await winRack(page, "Alex");
  let board = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory.length);
  st = await stats(page);
  check("206 games: the board keeps 200, the 6 oldest are already in Alex's stats", board === 200 && gamesOf(st, "Alex").length === 6, { board, saved: gamesOf(st, "Alex").length });
  await saveAndStartNew(page);
  st = await stats(page);
  const uniq = new Set(gamesOf(st, "Alex").map((g) => g.ts));
  check("...Save & Start New Session: all 206 in Alex's stats, none twice", uniq.size === 206 && gamesOf(st, "Alex").length === 206, { unique: uniq.size, total: gamesOf(st, "Alex").length });
  await page.close();

  // ---- 3. A new Quick Game saves the board first; Start Without Saving still drops it ----
  page = await open("Europe/Paris", null);
  const quickGame = async (a, b) => {
    await page.evaluate(() => document.getElementById("btn-quick-game").click());
    await sleep(300);
    await page.click("#quick-game-open-play");
    await page.type("#quick-game-player1", a);
    await page.type("#quick-game-player2", b);
    await page.click("#btn-quick-game-start");
    await sleep(700);
  };
  await quickGame("Lee", "Max");
  await winRack(page, "Lee");
  await winRack(page, "Max");
  await quickGame("Ana", "Bo");
  st = await stats(page);
  check("open play Lee 1 - Max 1, then a new Quick Game: both games are in their stats", gamesOf(st, "Lee").length === 2 && gamesOf(st, "Max").length === 2, { lee: gamesOf(st, "Lee"), max: gamesOf(st, "Max") });
  await winRack(page, "Ana");
  await saveAndStartNew(page, true);
  st = await stats(page);
  check("...Ana wins a rack, then Start Without Saving: not in her stats", gamesOf(st, "Ana").length === 0, gamesOf(st, "Ana"));
  await page.close();

  // ---- 4. Importing a 19:00-01:00 night keeps all 13 games, west and east of UTC ----
  for (const tz of ["America/Los_Angeles", "Asia/Manila"]) {
    page = await open(tz, null);
    const backup = await page.evaluate(() => {
      const games = [];
      for (let i = 0; i < 13; i++) {
        const t = new Date(2026, 9, 15, 19, 0); t.setMinutes(t.getMinutes() + i * 30); // 19:00 ... 01:00
        games.unshift({ ts: t.toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: [i % 2 ? "Pat" : "Lou"], opponentNames: [i % 2 ? "Lou" : "Pat"], winnerIds: ["x"], isTeam: false, summary: "won" });
      }
      return JSON.stringify({ exportedAt: new Date(2026, 9, 16, 9, 0).toISOString(), state: { players: [{ id: "a", name: "Pat", playing: false, balls: 0 }, { id: "b", name: "Lou", playing: false, balls: 0 }], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, gameHistory: games } });
    });
    const file = path.join(TMP, "night-" + tz.replace("/", "-") + ".json");
    fs.writeFileSync(file, backup);
    await page.evaluate(() => { const p = document.getElementById("backup-panel"); if (p.classList.contains("collapsed")) document.getElementById("btn-toggle-backup-panel").click(); });
    await sleep(300);
    await page.click("#btn-restore");
    await sleep(300);
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click("#btn-bk-pick-file")]);
    await chooser.accept([file]);
    await sleep(800);
    await page.click("#btn-bk-add");
    await sleep(1500);
    await page.evaluate(() => { for (let i = 0; i < 5; i++) { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); } });
    await sleep(500);
    st = await stats(page);
    const pat = gamesOf(st, "Pat");
    check(tz + ": the imported 19:00-01:00 night keeps all 13 games, under 2026-10-15", pat.length === 13 && pat.every((g) => g.date === "2026-10-15"), { n: pat.length, dates: [...new Set(pat.map((g) => g.date))] });
    await page.close();
  }

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
