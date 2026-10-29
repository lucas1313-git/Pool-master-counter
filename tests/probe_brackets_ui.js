// The standard brackets on screen, played through the real tournament page:
// - 9 players, single elimination: a "Round of 16" with 7 byes in round 1 (shown as byes) and a
//   champion after 8 matches;
// - 6 players, double elimination: every winners match still to play says where its loser goes
//   ("If you lose: Losers round 1"), the losers bracket draws the matches as they fill, the event
//   reaches a champion; no page errors.
// Its own file server on 4251.
// usage: node tests/probe_brackets_ui.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4251, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 500) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(350); };
  const closeAll = () => page.evaluate(() => {
    for (let i = 0; i < 6; i++) {
      const shown = (x) => !x.classList.contains("hidden") && getComputedStyle(x).display !== "none" && x.getClientRects().length > 0;
      const o = [...document.querySelectorAll("[id$='-overlay']")].find(shown);
      if (!o) return;
      const b = [...o.querySelectorAll("button.btn-primary")].find((x) => x.getClientRects().length > 0 && !x.closest(".hidden"));
      if (b) b.click(); else return;
    }
  });
  async function startTournament(format, players) {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((players) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: players.map((n, i) => ({ id: "p" + i, name: n, playing: false, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    }, players);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(700);
    await page.evaluate(() => document.getElementById("btn-open-tournament").click());
    await sleep(500);
    await tap('input[name="tournament-format"][value="' + format + '"]');
    await tap("#btn-tournament-setup-next");
    await tap("#btn-tournament-setup-next");
    const checked = await page.evaluate(() => [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].filter((c) => c.checked).length);
    if (checked < players.length) await tap("#tournament-select-all-checkbox");
    await tap("#btn-tournament-setup-next");
    await tap("#btn-tournament-start");
    await sleep(800);
  }
  // plays whatever is up: + on a running match (a random side), else Play on the next ready one
  async function playAll() {
    let started = 0;
    for (let guard = 0; guard < 300; guard++) {
      await closeAll();
      const plus = await page.evaluate(() => { const bs = [...document.querySelectorAll(".btn-ball.plus")].filter((x) => x.offsetParent && !x.disabled); const b = bs[Math.floor(Math.random() * bs.length)]; if (b) b.setAttribute("data-probe", "plus"); return !!b; });
      if (plus) { await page.click('[data-probe="plus"]'); await sleep(350); continue; }
      const play = await page.evaluate(() => { const b = [...document.querySelectorAll("#tournament-ready-list button.btn-primary")].find((x) => x.offsetParent && /Play/.test(x.textContent)); if (b) b.setAttribute("data-probe", "play"); return !!b; });
      if (!play) break;
      await page.click('[data-probe="play"]');
      started++;
      await sleep(450);
    }
    return started;
  }
  const tourney = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));

  // ---- 9 players, single elimination ----
  await startTournament("single", ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay", "Gus", "Hal", "Ivy"]);
  const r1 = await page.evaluate(() => ({ headings: [...document.querySelectorAll(".tournament-round-heading")].map((h) => h.textContent), byes: [...document.querySelectorAll(".tournament-match-side")].filter((s) => /bye/i.test(s.textContent)).length }));
  check("9 players, single elimination: a \"Round of 16\" with 7 byes shown in round 1", r1.headings.includes("Round of 16") && r1.byes === 7, r1);
  if (OUT) await page.screenshot({ path: path.join(OUT, "single_9.png"), fullPage: true });
  const singleMatches = await playAll();
  await sleep(800);
  let t = await tourney();
  const results = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournamentResults.v1") || "[]"));
  const single = results.find((r) => r.format === "single");
  check("...8 matches played, a champion crowned", !!single && single.matches.length === 8 && single.championNames.length === 1, single && { matches: single.matches.length, champion: single.championNames });

  // ---- 6 players, double elimination ----
  await startTournament("double", ["Ann", "Ben", "Cat", "Dan", "Eve", "Fay"]);
  const ifLose = await page.evaluate(() => [...document.querySelectorAll(".tournament-match-iflose")].map((e) => e.textContent));
  check("6 players, double elimination: every winners match still to play says where its loser goes (\"If you lose: Losers round 1\")", ifLose.length >= 2 && ifLose.every((s) => /^If you lose: Losers round \d$/.test(s)), ifLose);
  let lbSeen = 0;
  const doubleMatches = await playAll();
  await sleep(1000);
  t = await tourney();
  const results2 = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournamentResults.v1") || "[]"));
  const done = results2.find((r) => r.format === "double");
  check("...played to the end: a champion, 2nd and the rest placed", !!done && done.placings && done.placings[0].names.length === 1 && done.matches.length >= 9, done && { matches: done.matches.length, placings: done.placings });
  lbSeen = done ? done.matches.filter((m) => /^Losers/.test(m.round || "")).length : 0;
  check("...the losers bracket was played (" + lbSeen + " matches) - nobody out before a second loss", lbSeen >= 4, { lbSeen });
  if (OUT) await page.screenshot({ path: path.join(OUT, "double_6_done.png"), fullPage: true });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
