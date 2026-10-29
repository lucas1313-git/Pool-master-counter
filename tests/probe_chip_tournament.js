// A chip tournament on the screen (P34): 12 players (ratings 320-650), 3 tables, race to 1:
// - the wizard: 🪙 Chip Tournament, its chip chart (3 rows by default);
// - started: 3 games on 3 tables at once, the chips board with everyone (4, 3 or 2 chips by rating);
// - 8 games played on the boards: 8 chips gone, the next two in line on the free table each time;
// - 📺 Next up (the TV): the 3 tables live, the next two in line, everyone's chips - a screenshot;
// - played out: one champion with chips, everyone else out; the banner; 12 placings;
// - no page errors.
// Its own file server on 4291.
// usage: node tests/probe_chip_tournament.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4291, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1600, height: 900 } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(350); };
    const T = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
    const names = ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay", "Gus", "Hal", "Ivy", "Jon", "Kit", "Lou"];
    await page.goto(BASE + "manifest.json");
    await page.evaluate((names) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      const ratings = {};
      names.forEach((n, i) => { ratings[n] = { rating: 320 + i * 30, gamesPlayed: 40, history: [] }; });
      localStorage.setItem("poolMasterCounter.ratings.v1", JSON.stringify(ratings));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: names.map((n, i) => ({ id: "p" + i, name: n, playing: false, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    }, names);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(700);
    await page.evaluate(() => document.getElementById("btn-open-tournament").click());
    await sleep(500);
    await tap('input[name="tournament-format"][value="chips"]');
    const chart = await page.evaluate(() => ({ shown: !document.getElementById("tournament-chips-chart-row").classList.contains("hidden"), rows: document.querySelectorAll("#tournament-chips-chart .chips-chart-row").length, heading: document.getElementById("tournament-new-heading").textContent }));
    check("the wizard: 🪙 Chip Tournament - its chip chart (" + chart.rows + " rows), \"" + chart.heading + "\"", chart.shown && chart.rows === 3 && /Chip Tournament/.test(chart.heading), chart);
    await tap("#btn-tournament-setup-next");
    await page.evaluate(() => { const i = document.getElementById("tournament-race-to"); i.value = 1; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
    await tap("#btn-tournament-setup-next");
    const checked = await page.evaluate(() => [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].filter((c) => c.checked).length);
    if (checked < names.length) await tap("#tournament-select-all-checkbox");
    await tap("#btn-tournament-setup-next");
    await page.evaluate(() => {
      const r = document.querySelector('input[name="tournament-seed-mode"][value="manual"]');
      if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
      const tc = document.getElementById("tournament-table-count");
      tc.value = 3; tc.dispatchEvent(new Event("input", { bubbles: true })); tc.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await tap("#btn-tournament-start");
    await sleep(900);
    let t = await T();
    const board = () => page.evaluate(() => [...document.querySelectorAll("#tournament-chips-standings .chips-row")].map((r) => r.querySelector(".chips-name").textContent + " " + r.querySelector(".chips-dots").textContent + " " + r.querySelector(".chips-status").textContent));
    let rows = await board();
    const expectChips = (n, i) => (320 + i * 30 <= 399 ? 4 : 320 + i * 30 <= 549 ? 3 : 2);
    check("started: 3 games on 3 tables at once (" + (t.activeMatches || []).map((a) => a.table).sort().join(",") + ")", t.format === "chips" && t.activeMatches.length === 3 && t.activeMatches.map((a) => a.table).sort().join() === "1,2,3", t && { active: t.activeMatches, line: t.line });
    check("...the chips board: all 12, chips by rating (4 / 3 / 2)", rows.length === 12 && names.every((n, i) => t.chips[n] === expectChips(n, i)), { rows, chips: t.chips });
    const total = () => Object.values(t.chips).reduce((a, b) => a + b, 0);
    const startTotal = total();

    // play: the first board's first player wins its game
    const playOne = async () => {
      const ok = await page.evaluate(() => { const b = document.querySelector("#tournament-current-match-panel .player-panel .btn-ball.plus"); if (b) { b.click(); return true; } return false; });
      await sleep(450);
      await page.evaluate(() => {
        for (let i = 0; i < 4; i++) {
          const o = [...document.querySelectorAll("[id$='-overlay']")].find((x) => !x.classList.contains("hidden") && getComputedStyle(x).display !== "none" && x.getClientRects().length);
          if (!o) return;
          const b = [...o.querySelectorAll("button.btn-primary")].find((x) => x.getClientRects().length);
          if (b) b.click(); else return;
        }
      });
      await sleep(150);
      return ok;
    };
    let busyEveryTime = true;
    for (let g = 0; g < 8; g++) {
      await playOne();
      t = await T();
      if (t.activeMatches.length !== 3) busyEveryTime = false;
    }
    check("8 games played on the boards: 8 chips gone (" + startTotal + " -> " + total() + "), 3 tables busy after every game", total() === startTotal - 8 && t.games.filter((m) => m.winner).length === 8 && busyEveryTime, { line: t.line, active: t.activeMatches.length });

    // the TV: Next up
    await page.evaluate(() => document.getElementById("btn-tournament-next-up").click());
    await sleep(700);
    const tv = await page.evaluate(() => {
      const box = document.getElementById("tournament-next-up");
      const next = box.querySelector(".next-up-chips-next");
      return { mode: document.body.getAttribute("data-tournament-tv"), tables: box.querySelectorAll(".next-up-table").length, next: next ? next.textContent : "", chips: box.querySelectorAll(".chips-standings-tv .chips-row").length, text: box.textContent.slice(0, 600) };
    });
    if (OUT) await page.screenshot({ path: path.join(OUT, "chips_tv_next_up.png") });
    check("📺 Next up: the 3 tables live, the next game from the line (\"" + tv.next + "\"), everyone's chips (" + tv.chips + " rows)", tv.mode === "next" && tv.tables === 3 && /^Next up: \w+ v \w+$/.test(tv.next) && tv.chips === 12, tv);
    await page.evaluate(() => document.getElementById("btn-tournament-next-up").click());
    await sleep(400);

    // played out
    for (let g = 0; g < 60; g++) {
      t = await T();
      if (t.champion) break;
      if (!(await playOne())) {
        await page.evaluate(() => { const b = [...document.querySelectorAll(".tournament-play-btn, #tournament-ready-list button.btn-primary")].find((x) => x.offsetParent); if (b) b.click(); });
        await sleep(400);
      }
    }
    t = await T();
    const alive = Object.keys(t.chips).filter((n) => t.chips[n] > 0);
    const placings = await page.evaluate(() => [...document.querySelectorAll("#tournament-placings li")].map((li) => li.textContent));
    const banner = await page.evaluate(() => document.getElementById("tournament-champion-banner").textContent);
    rows = await board();
    if (OUT) await page.screenshot({ path: path.join(OUT, "chips_champion.png") });
    check("played out (" + t.games.length + " games): " + t.champion + " the only one with chips, everyone else out", !!t.champion && alive.length === 1 && alive[0] === t.champion && t.bustOrder.length === 11 && t.games.length === startTotal - t.chips[t.champion], { champion: t.champion, alive, games: t.games.length });
    check("...the banner and 12 placings (" + placings[0] + " ... " + placings[11] + ")", banner.includes(t.champion) && placings.length === 12 && placings[0].includes(t.champion) && placings[11].includes(t.bustOrder[0]), { banner, placings });
    check("...the chips board: 👑 " + t.champion + " first, the rest struck out", rows[0].includes("👑 " + t.champion) && rows.slice(1).every((r) => /Out ·/.test(r)), rows);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
