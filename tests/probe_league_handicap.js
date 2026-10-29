// League handicaps and points on screen, an APA 8-Ball and an APA 9-Ball league played through the
// league page:
// - 8-Ball, an SL7 v an SL6: the board's header says "Race 5–4" and each side's target follows
//   APA's chart; won 5-0 it's a shutout, 3-0 in the standings; an SL7 v an SL3 is "Race 6–2", and
//   the SL3 winning with the SL7 on the hill is 2-1;
// - the 📊 chart shows APA's grid: 6 by 6, "5/4" where a 7 meets a 6, and says how points work;
// - 9-Ball, an SL2 v an SL6: "Points 19–46"; each side has "9-ball +2", which never takes a score
//   past the race (18 + 2 = 19); the SL6 who made 30 gets 5 of the 20 points (15-5);
// - ✏️ that match to 19-35: the SL2 still won (they reached their 19) - 14-6;
// - no page errors.
// Its own file server on 4254.
// usage: node tests/probe_league_handicap.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4254, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 700) : "")); if (!ok) fails++; }
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const member = (name, sl) => ({ name, skillLevel: sl, leaguePoints: 0, matchesPlayed: 0, matchesWon: 0 });
  const leagues = [
    { id: "lg8", name: "Eight", isOrganizer: true, format: "apa8ball", handicapSystem: "apa", useHandicap: true, handicapBaseGames: 5, queueMode: "none", tableCount: 1,
      members: [member("Ann", 7), member("Ben", 6), member("Cat", 3)], teams: [], matches: [], activeMatches: [] },
    { id: "lg9", name: "Nine", isOrganizer: true, format: "apa9ball", handicapSystem: "apa", useHandicap: true, handicapBaseGames: 38, queueMode: "none", tableCount: 1,
      members: [member("Dee", 2), member("Eve", 6)], teams: [], matches: [], activeMatches: [] }
  ];
  await page.goto(BASE + "manifest.json");
  await page.evaluate((leagues) => {
    localStorage.clear();
    localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
    localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
    localStorage.setItem("poolMasterCounter.leagues.v1", JSON.stringify(leagues));
  }, leagues);
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(700);
  await page.evaluate(() => document.getElementById("btn-open-league").click());
  await sleep(600);
  const stored = (id) => page.evaluate((id) => JSON.parse(localStorage.getItem("poolMasterCounter.leagues.v1")).find((l) => l.id === id), id);
  const pickLeague = async (id) => {
    const sel = await page.evaluate(() => { const s = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "lg9")); return s ? "#" + s.id : null; });
    if (sel) { await page.select(sel, id); await sleep(500); }
  };
  // a match on table 1: the two names picked, Start
  const start = async (a, b) => {
    await page.evaluate((a, b) => {
      const sels = [...document.querySelectorAll("select")].filter((s) => s.offsetParent && [...s.options].some((o) => o.value === a) && [...s.options].some((o) => o.value === b));
      sels[0].value = a; sels[0].dispatchEvent(new Event("change"));
      sels[1].value = b; sels[1].dispatchEvent(new Event("change"));
      const btn = sels[0].closest(".row").parentNode.querySelector("button.btn-primary");
      btn.click();
    }, a, b);
    await sleep(500);
  };
  const board = () => page.evaluate(() => ({
    header: (document.querySelector("#league-current-match-panel .tournament-now-playing") || {}).textContent || "",
    targets: [...document.querySelectorAll("#league-current-match-panel .stat-label")].map((x) => x.textContent),
    nine: [...document.querySelectorAll("#league-current-match-panel .league-nine-ball")].map((b) => b.textContent)
  }));
  const tap = async (name, times, nine) => {
    for (let i = 0; i < times; i++) {
      const ok = await page.evaluate((name, nine) => {
        const b = nine
          ? [...document.querySelectorAll("#league-current-match-panel .league-nine-ball")].find((x) => x.getAttribute("aria-label").includes(name))
          : [...document.querySelectorAll("#league-current-match-panel button.btn-ball.plus")].find((x) => x.getAttribute("aria-label") === "Add point for " + name);
        if (b) b.click();
        return !!b;
      }, name, nine);
      if (!ok) return false;
      await sleep(60);
    }
    await sleep(300);
    // (whatever pops up after a win - the next-up proposal etc.)
    await page.evaluate(() => document.querySelectorAll(".confirm-modal-overlay:not(.hidden) .btn-ghost").forEach((b) => b.offsetParent && b.click()));
    await sleep(200);
    return true;
  };
  const pointsOf = (lg, n) => lg.members.find((m) => m.name === n).leaguePoints;

  // ---- APA 8-Ball ----
  await pickLeague("lg8");
  await start("Ann", "Ben");
  let b = await board();
  check("8-Ball, Ann (SL7) v Ben (SL6): the header says \"Race 5–4\", the targets 5 and 4", /Race 5–4/.test(b.header) && b.targets.join("|") === "Target 5|Target 4" && !b.nine.length, b);
  if (OUT) { await page.evaluate(() => document.getElementById("league-current-match-panel").scrollIntoView({ block: "center" })); await page.screenshot({ path: path.join(OUT, "race_5_4.png") }); }
  await tap("Ann", 5);
  let lg = await stored("lg8");
  check("...Ann wins 5-0: a shutout, Ann 3 points, Ben 0", lg.matches.length === 1 && pointsOf(lg, "Ann") === 3 && pointsOf(lg, "Ben") === 0, { matches: lg.matches, members: lg.members });
  await start("Ann", "Cat");
  b = await board();
  check("Ann (SL7) v Cat (SL3): \"Race 6–2\"", /Race 6–2/.test(b.header) && b.targets.join("|") === "Target 6|Target 2", b);
  await tap("Ann", 5);
  await tap("Cat", 2);
  lg = await stored("lg8");
  check("...Cat wins 2-5 with Ann on the hill: Cat 2 points, Ann 1 (2-1)", lg.matches.length === 2 && pointsOf(lg, "Cat") === 2 && pointsOf(lg, "Ann") === 4, lg.members);
  await page.evaluate(() => document.getElementById("btn-league-handicap-chart-open").click());
  await sleep(400);
  const chart = await page.evaluate(() => {
    const g = document.getElementById("league-handicap-chart-grid");
    const rows = [...g.querySelectorAll("tbody tr")].map((tr) => [...tr.children].map((c) => c.textContent));
    return { shown: !g.classList.contains("hidden"), rows, main: !document.getElementById("league-handicap-chart-main-table").classList.contains("hidden"),
      note: document.getElementById("league-handicap-chart-points-note").textContent, explain: document.getElementById("league-handicap-chart-explain").textContent };
  });
  const row7 = chart.rows.find((r) => r[0] === "7") || [];
  check("📊 the chart: APA's 6 by 6 grid (\"5/4\" where a 7 meets a 6), not a per-player list", chart.shown && !chart.main && chart.rows.length === 6 && chart.rows.every((r) => r.length === 7) && row7[5] === "5/4", chart);
  check("...and how points work: shutout 3-0, on the hill 2-1", /3-0/.test(chart.note) && /on the hill/.test(chart.note), chart.note);
  if (OUT) await page.screenshot({ path: path.join(OUT, "chart_grid.png") });
  await page.evaluate(() => document.getElementById("btn-league-handicap-chart-close").click());
  await sleep(300);

  // ---- APA 9-Ball ----
  await pickLeague("lg9");
  await start("Dee", "Eve");
  b = await board();
  check("9-Ball, Dee (SL2) v Eve (SL6): \"Points 19–46\", and \"9-ball +2\" on both sides", /Points 19–46/.test(b.header) && b.targets.join("|") === "Target 19|Target 46" && b.nine.length === 2 && b.nine.every((t) => t === "9-ball +2"), b);
  if (OUT) { await page.evaluate(() => document.getElementById("league-current-match-panel").scrollIntoView({ block: "center" })); await page.screenshot({ path: path.join(OUT, "nine_ball.png") }); }
  await tap("Eve", 30);
  await tap("Dee", 18);
  const before = await page.evaluate(() => [...document.querySelectorAll("#league-current-match-panel .stat-value")].map((v) => v.textContent));
  await tap("Dee", 1, true);
  lg = await stored("lg9");
  const m9 = lg.matches[0] || {};
  check("...Dee at 18 makes the 9-ball: 19, not 20 (never past the race) - the match is hers", before.join("|") === "18|30" && m9.scoreA === 19 && m9.scoreB === 30 && m9.winner === "Dee", { before, m9 });
  check("...Eve (SL6) made 30: 5 of the 20 points - Dee 15, Eve 5", pointsOf(lg, "Dee") === 15 && pointsOf(lg, "Eve") === 5, lg.members);
  // ✏️ to 19-35: Dee still reached her race
  await page.evaluate(() => document.querySelector("#league-match-list .league-match-edit").click());
  await sleep(300);
  await page.evaluate(() => {
    const a = document.getElementById("tournament-score-a"), bb = document.getElementById("tournament-score-b");
    a.value = "19"; bb.value = "35";
    [a, bb].forEach((x) => x.dispatchEvent(new Event("input")));
    document.querySelector("#tournament-score-overlay .btn-primary").click();
  });
  await sleep(500);
  lg = await stored("lg9");
  check("✏️ to 19-35: Dee still won (she reached her 19) - 14-6", lg.matches[0].winner === "Dee" && pointsOf(lg, "Dee") === 14 && pointsOf(lg, "Eve") === 6, { m: lg.matches[0], members: lg.members });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
