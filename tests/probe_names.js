// One name per idea (P18), at 1180x820:
// - the board: Kim beats Jo one rack in an 8-Ball race to 15 - Recent Games says "Kim won 8-Ball", no
//   "(target 1)"; then Jo wins 9 (10 games: the Leaderboard's all-time minimum);
// - ☰ Menu: "All players" once (in Stats), no "Global stats"; the header says "📊 All players";
// - the Leaderboard: Kim "1 win" (not "1 wins"), Jo "9 wins"; the MVP formula folded under
//   "ⓘ How the MVP score works", closed;
// - the tournament page heading follows the format: Elimination, Round Robin, Swiss;
// - a player's page says "💾 Save to history";
// - in French: Kim "1 victoire", Jo "9 victoires";
// - no page errors.
// Screenshots of the board, the leaderboard and the tournament page when given a directory.
// Its own file server on 4272.
// usage: node tests/probe_names.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4272, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1180, height: 820, hasTouch: true });
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
    localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
    localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({
      players: [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }],
      playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 15, rotation: { enabled: false, order: [], every: 1 }
    }));
  });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(900);
  const menuRows = () => page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].map((b) => ({ key: b.dataset.menuKey, text: b.textContent.trim() })));
  const menuPick = async (key) => { await page.evaluate((key) => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === key).click(), key); await sleep(250); };

  // ---- the board ----
  await page.evaluate(() => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => /Kim/.test(b.getAttribute("aria-label"))).click());
  await sleep(900);
  const board = await page.evaluate(() => ({ status: document.getElementById("board-status").textContent, recent: (document.querySelector("#history-list li") || {}).textContent || "" }));
  check("the board: 8-Ball race to 15, Kim wins a rack - Recent Games \"Kim won 8-Ball\", no \"(target 1)\"", /8-Ball · Race to 15/.test(board.status) && /Kim.*won 8-Ball/.test(board.recent) && !/target/.test(board.recent), board);
  if (OUT) await page.screenshot({ path: path.join(OUT, "names_board.png") });
  for (let i = 0; i < 9; i++) {
    await page.evaluate(() => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => /\bJo\b/.test(b.getAttribute("aria-label"))).click());
    await sleep(700);
  }
  await sleep(600);
  await page.evaluate(() => { const x = document.querySelector("#win-banner .win-banner-close"); if (x) x.click(); });

  // ---- ☰ Menu: All players once ----
  await page.click("#btn-board-menu");
  await sleep(250);
  const top = await menuRows();
  const all = top.slice();
  const parents = await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row.has-children")].map((b) => b.dataset.menuKey));
  for (const key of parents) {
    await menuPick(key);
    all.push(...(await menuRows()).map((r) => ({ key: r.key, text: r.text, under: key })));
    await page.click("#btn-board-menu-back");
    await sleep(200);
  }
  await page.evaluate(() => document.getElementById("btn-board-menu-close").click());
  const allPlayers = all.filter((r) => /All players|Global stats/i.test(r.text));
  const header = await page.evaluate(() => document.getElementById("btn-open-global-stats").textContent.trim());
  check("☰ Menu: \"All players\" once (Stats), no \"Global stats\"; the header says \"📊 All players\"", allPlayers.length === 1 && allPlayers[0].under === "menu.stats" && !all.some((r) => /global/i.test(r.key + r.text)) && header === "📊 All players", { allPlayers, header });

  // ---- the Leaderboard ----
  await page.evaluate(() => document.getElementById("btn-open-leaderboard").click());
  await sleep(700);
  const lb = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#leaderboard-list li")].map((li) => li.textContent.replace(/\s+/g, " "));
    const d = document.querySelector("details.leaderboard-formula");
    return { kim: rows.find((r) => /Kim/.test(r)) || "", jo: rows.find((r) => /Jo/.test(r) && !/Kim/.test(r)) || "", formula: d ? { open: d.open, summary: d.querySelector("summary").textContent.trim(), visible: document.getElementById("leaderboard-formula-note").getClientRects().length > 0 && d.open } : null };
  });
  check("the Leaderboard: Kim \"1 win\" (not \"1 wins\") in 10 games, Jo \"9 wins\"", /\b1 win\b/.test(lb.kim) && !/\b1 wins\b/.test(lb.kim) && /\b10 games\b/.test(lb.kim) && /\b9 wins\b/.test(lb.jo), lb);
  check("...the MVP formula folded under \"ⓘ How the MVP score works\", closed", lb.formula && !lb.formula.open && lb.formula.summary === "ⓘ How the MVP score works" && !lb.formula.visible, lb.formula);
  if (OUT) await page.screenshot({ path: path.join(OUT, "names_leaderboard.png") });
  await page.evaluate(() => document.getElementById("btn-leaderboard-back") && document.getElementById("btn-leaderboard-back").click());
  await sleep(400);

  // ---- the tournament heading ----
  await page.evaluate(() => document.getElementById("btn-open-tournament").click());
  await sleep(700);
  const heads = {};
  for (const f of ["double", "single", "roundrobin", "swiss"]) {
    await page.evaluate((f) => { const r = document.querySelector('input[name="tournament-format"][value="' + f + '"]'); r.click(); }, f);
    await sleep(200);
    heads[f] = await page.evaluate(() => document.getElementById("tournament-new-heading").textContent.trim());
    if (OUT && f === "roundrobin") await page.screenshot({ path: path.join(OUT, "names_tournament.png") });
  }
  check("the tournament page heading follows the format: Elimination ×2, Round Robin, Swiss", heads.double === "New Elimination Tournament" && heads.single === "New Elimination Tournament" && heads.roundrobin === "New Round Robin Tournament" && heads.swiss === "New Swiss Tournament", heads);
  await page.evaluate(() => { const r = document.querySelector('input[name="tournament-format"][value="double"]'); r.click(); });

  // ---- a player's page ----
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(900);
  await page.evaluate(() => document.querySelector("#scoreboard .player-name").click());
  await sleep(200);
  await page.evaluate(() => document.querySelector(".player-link-icon") && document.querySelector(".player-link-icon").click());
  await sleep(600);
  const save = await page.evaluate(() => ({ page: !document.getElementById("view-player-page").classList.contains("hidden"), text: document.getElementById("btn-player-page-export").textContent.trim(), back: document.getElementById("btn-return-to-global-stats").textContent.trim() }));
  check("a player's page: \"💾 Save to history\", back to \"📊 All players\"", save.page && save.text === "💾 Save to history" && save.back === "📊 All players", save);

  // ---- French plurals ----
  await page.evaluate(() => localStorage.setItem("poolMasterCounter.language.v1", "french"));
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(1200);
  await page.evaluate(() => document.getElementById("btn-open-leaderboard").click());
  await sleep(700);
  const fr = await page.evaluate(() => { const rows = [...document.querySelectorAll("#leaderboard-list li")].map((li) => li.textContent.replace(/\s+/g, " ")); return { kim: rows.find((r) => /Kim/.test(r)) || "", jo: rows.find((r) => /Jo/.test(r) && !/Kim/.test(r)) || "" }; });
  check("in French: Kim \"1 victoire\", Jo \"9 victoires\"", /\b1 victoire\b/.test(fr.kim) && !/\b1 victoires\b/.test(fr.kim) && /\b9 victoires\b/.test(fr.jo), fr);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
