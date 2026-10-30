// ⏹ Stop a race or a tournament early, a winner picked (2026-10-30 request). Its own server on 4300:
// - a race to 5, Kim 3 – Jo 2 (Jo won the last two): ☰ › ⏹ Stop the race… - who wins: No winner,
//   Most games won: Kim (3) (picked to start), In Fire 🔥: Jo (2 in a row); who decides: All
//   players, Kim, Jo;
// - In Fire, decided by Kim: the race-won screen for Jo, "⏹ Interrupted by Kim - in fire"; the
//   session archived; the Day Report: "Interrupted results by Kim: Jo wins the race to 5 (in fire)";
// - a new race, 1 – 1, No winner by All players: no race-won screen, the session ends; the Day
//   Report: "Interrupted results by all players: no winner (race to 5)";
// - a tournament (single elimination, 4, race to 2), Ann a rack up: ⋯ More › ⏹ Stop and pick the
//   winner - Most games won (Ann), by Ben: Ann champion, "⏹ Stopped early by Ben - most games won";
//   the Day Report: "Interrupted results by Ben: Ann wins the Single Elimination tournament ...";
// - another, No winner: the tournament closed (back to its setup), noted in the Day Report;
// - no page errors.
// usage: node tests/probe_stop_early.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4300, BASE = "http://localhost:" + PORT + "/";
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 900 } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__copied = [];
      try { Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true }); } catch (e) {}
    });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.celebrations.v1", "on");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: ["Kim", "Jo", "Ann", "Ben"].map((n, i) => ({ id: "p" + i, name: n, playing: i < 2, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    const win = async (name) => {
      await page.evaluate((name) => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
      await sleep(900);
      await page.keyboard.press("Escape").catch(() => {});
      await sleep(200);
    };
    const menu = async (key) => {
      await page.click("#btn-board-menu");
      await sleep(250);
      const ok = await page.evaluate((key) => { const r = [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((x) => x.dataset.menuKey === key); if (r) r.click(); return !!r; }, key);
      await sleep(400);
      return ok;
    };
    const sheet = () => page.evaluate(() => ({
      shown: !document.getElementById("stop-overlay").classList.contains("hidden"),
      standing: document.getElementById("stop-standing").textContent,
      how: [...document.querySelectorAll('#stop-how label')].map((l) => (l.querySelector("input").checked ? "*" : "") + l.textContent.trim()),
      by: [...document.querySelectorAll('#stop-by label')].map((l) => l.textContent.trim())
    }));
    const pick = (how, by) => page.evaluate((how, by) => {
      document.querySelector('input[name="stop-how"][value="' + how + '"]').click();
      document.querySelector('input[name="stop-by"][value="' + by + '"]').click();
      document.getElementById("btn-stop-confirm").click();
    }, how, by);
    const report = async () => {
      await page.evaluate(() => { window.__copied = []; document.getElementById("btn-day-report-copy").click(); });
      await sleep(600);
      return page.evaluate(() => window.__copied[window.__copied.length - 1] || "");
    };

    // ---- a race: Kim 3 – Jo 2, Jo the last two ----
    for (const n of ["Kim", "Kim", "Kim", "Jo", "Jo"]) await win(n);
    const opened = await menu("menu.stopRace");
    let s = await sheet();
    if (OUT) await page.screenshot({ path: path.join(OUT, "stop_race_sheet.png") });
    check("☰ › ⏹ Stop the race…: Kim 3 – Jo 2 - No winner, Most games won: Kim (3) picked, In Fire 🔥: Jo (2 in a row); All players, Kim, Jo", opened && s.shown && /Kim 3 – Jo 2/.test(s.standing) && s.how[0] === "No winner" && s.how[1] === "*Most games won: Kim (3)" && s.how[2] === "In Fire 🔥: Jo (2 in a row)" && s.by.join() === "All players,Kim,Jo", s);
    await pick("fire", "Kim");
    await sleep(1500);
    const won = await page.evaluate(() => ({ up: !document.getElementById("milestone-overlay").classList.contains("hidden"), head: document.getElementById("milestone-headline").textContent, details: document.getElementById("milestone-details").textContent, games: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory.length }));
    if (OUT) await page.screenshot({ path: path.join(OUT, "stop_race_won.png") });
    check("In Fire, decided by Kim: the race-won screen for Jo, \"⏹ Interrupted by Kim - in fire\"; the session archived", won.up && /Jo/.test(won.head) && /Interrupted/.test(won.details) && /by Kim - in fire/.test(won.details) && won.games === 0, won);
    await page.keyboard.press("Enter");
    await sleep(400);
    let text = await report();
    check("...the Day Report: \"Interrupted results by Kim: Jo wins the race to 5 (in fire)\"", /⏹ .*Interrupted results by Kim: Jo wins the race to 5 \(in fire\)/.test(text), text.slice(0, 1200));

    // ---- a new race, 1 – 1, no winner ----
    await win("Kim");
    await win("Jo");
    await menu("menu.stopRace");
    await pick("none", "*");
    await sleep(1200);
    const after = await page.evaluate(() => ({ up: !document.getElementById("milestone-overlay").classList.contains("hidden"), games: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory.length, banner: document.getElementById("win-banner").textContent }));
    text = await report();
    check("No winner, by All players: no race-won screen, the session ends; the Day Report: \"Interrupted results by all players: no winner (race to 5)\"", !after.up && after.games === 0 && /stopped/.test(after.banner) && /Interrupted results by all players: no winner \(race to 5\)/.test(text), { after, text: text.slice(0, 1200) });

    // ---- a tournament ----
    const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(350); };
    const T = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
    const startTournament = async () => {
      await page.evaluate(() => document.getElementById("btn-open-tournament").click());
      await sleep(500);
      await tap('input[name="tournament-format"][value="single"]');
      await tap("#btn-tournament-setup-next");
      await page.evaluate(() => { const i = document.getElementById("tournament-race-to"); i.value = 2; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
      await tap("#btn-tournament-setup-next");
      const checked = await page.evaluate(() => [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].filter((c) => c.checked).length);
      if (checked < 4) await tap("#tournament-select-all-checkbox");
      await tap("#btn-tournament-setup-next");
      await page.evaluate(() => { const r = document.querySelector('input[name="tournament-seed-mode"][value="manual"]'); if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); } });
      await tap("#btn-tournament-start");
      await sleep(800);
      let t = await T();
      if (!(t.activeMatches || []).length) { await page.evaluate(() => { const b = [...document.querySelectorAll(".tournament-play-btn, #tournament-ready-list button.btn-primary")].find((x) => x.offsetParent); if (b) b.click(); }); await sleep(500); t = await T(); }
      return t;
    };
    let t = await startTournament();
    const m = [].concat(...t.wb).find((x) => x.id === t.activeMatches[0].matchId);
    await page.evaluate((name) => { const panel = [...document.querySelectorAll("#tournament-current-match-panel .player-panel")].find((p) => p.textContent.includes(name)); panel.querySelector(".btn-ball.plus").click(); }, m.a);
    await sleep(700);
    await page.evaluate(() => document.getElementById("btn-tournament-more").click());
    await sleep(300);
    await page.evaluate(() => document.getElementById("btn-tournament-menu-stop").click());
    await sleep(400);
    s = await sheet();
    check("a tournament, " + m.a + " a rack up: ⋯ More › ⏹ Stop and pick the winner - Most games won: " + m.a + " (1); all four can decide", s.shown && s.how[1] === "*Most games won: " + m.a + " (1)" && s.by.length === 5, s);
    await pick("most", "Ben");
    await sleep(800);
    t = await T();
    const banner = await page.evaluate(() => document.getElementById("tournament-champion-banner").textContent);
    if (OUT) await page.screenshot({ path: path.join(OUT, "stop_tournament.png") });
    check("...most games won, by Ben: " + t.champion + " champion, the banner: \"⏹ Stopped early by Ben - most games won\"", t.champion === m.a && /Stopped early by Ben - most games won/.test(banner), { champion: t.champion, banner });
    text = await report();
    check("...the Day Report: \"Interrupted results by Ben: " + m.a + " wins the Single Elimination tournament (most games won, 4 players)\"", new RegExp("Interrupted results by Ben: " + m.a + " wins the Single Elimination tournament \\(most games won, 4 players\\)").test(text), text.slice(0, 1400));
    // another one, no winner
    await page.evaluate(() => document.getElementById("btn-tournament-abandon").click());
    await sleep(500);
    t = await startTournament();
    await page.evaluate(() => document.getElementById("btn-tournament-more").click());
    await sleep(300);
    await page.evaluate(() => document.getElementById("btn-tournament-menu-stop").click());
    await sleep(400);
    await pick("none", "Kim");
    await sleep(800);
    t = await T();
    const setupShown = await page.evaluate(() => !!document.querySelector("#tournament-setup-step-1") && !!document.querySelector("#tournament-setup-step-1").offsetParent);
    text = await report();
    check("another, No winner: the tournament closed (its setup again); the Day Report: \"Interrupted results by Kim: no winner (Single Elimination tournament, 4 players)\"", !t && setupShown && /Interrupted results by Kim: no winner \(Single Elimination tournament, 4 players\)/.test(text), { t: !!t, setupShown, text: text.slice(0, 1400) });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
