// Two new games (2026-11-23, the user: "add 2 new games to the game selections: reversed 8 ball a
// rack game, 38 points 9 ball a point game default 38"), at 1180x900:
// - both in every game list: the 🎱 Game sheet, the Current Game picker, the Games Rotation
//   builder, the tournament's;
// - 🎱 Game › Reversed 8-Ball: 1 rack filled in; applied, the board says "Reversed 8-Ball"; Kim's +
//   wins the rack - the banner, the game saved as 8ballreversed; the 8-Ball family's "Balls left"
//   on the banner, 7 left = a skunk;
// - 🎱 Game › 38 Points 9-Ball: 38 points filled in; applied, the board says "38 Points 9-Ball";
//   each + one point, − takes one back; Kim's 38th point wins the game - saved as 9ball38, to 38
//   points;
// - a rotation of the two: both labels in it;
// - no page errors.
// Its own file server on 4330.
// usage: node tests/probe_new_games.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = process.env.PMC_SITE || path.join(__dirname, "..");
const PORT = 4330, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
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
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.celebrations.v1", "off");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: ["Kim", "Jo"].map((n, i) => ({ id: "p" + i, name: n, playing: true, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 } }));
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1000);

    // ---- every game list ----
    const lists = await page.evaluate(() => {
      document.getElementById("btn-board-game").click();
      const ids = (sel) => [...document.querySelectorAll(sel + " option")].map((o) => o.value + "=" + o.textContent);
      const out = { sheet: ids("#gs-game-type"), current: ids("#game-type"), rotation: ids("#rotation-add-type"), tournament: ids("#tournament-game-type") };
      document.getElementById("btn-game-sheet-cancel").click();
      return out;
    });
    const has = (l) => l.indexOf("8ballreversed=Reversed 8-Ball") !== -1 && l.indexOf("9ball38=38 Points 9-Ball") !== -1;
    check("both games in every list - 🎱 Game sheet, Current Game, Games Rotation, tournament", has(lists.sheet) && has(lists.current) && has(lists.rotation) && has(lists.tournament), lists);

    const pickGame = async (id) => {
      await page.evaluate(() => document.getElementById("btn-board-game").click());
      await sleep(300);
      const filled = await page.evaluate((id) => {
        const sel = document.getElementById("gs-game-type");
        sel.value = id;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { target: document.getElementById("gs-target").value, unit: document.getElementById("gs-unit").value };
      }, id);
      await page.evaluate(() => document.getElementById("btn-game-sheet-apply").click());
      await sleep(700);
      return filled;
    };
    const plus = (name) => page.evaluate((name) => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
    const board = () => page.evaluate(() => (document.getElementById("board-topbar") || document.body).innerText.replace(/\s+/g, " "));

    // ---- Reversed 8-Ball ----
    let filled = await pickGame("8ballreversed");
    let top = await board();
    await plus("Kim");
    await sleep(800);
    let s = await saved();
    let banner = await page.evaluate(() => document.getElementById("win-banner").innerText.replace(/\s+/g, " "));
    let game = (s.gameHistory || [])[0] || {};
    if (OUT) await page.screenshot({ path: path.join(OUT, "reversed_8ball.png") });
    check("Reversed 8-Ball: " + filled.target + " " + filled.unit + " filled in; the board: \"" + top.slice(0, 60) + "\"; Kim's + wins the rack (\"" + banner.slice(0, 40) + "\"), saved as " + game.gameType,
      filled.target === "1" && filled.unit === "rack" && /Reversed 8-Ball/.test(top) && /Kim won/.test(banner) && game.gameType === "8ballreversed" && game.result !== "lost", { filled, top, banner, game });
    // the 8-Ball family's balls left: 7 = a skunk
    // (the stepper opens by itself after a rack of the 8-Ball family; its first + is 0)
    const skunk = await page.evaluate(async () => {
      const plusB = document.querySelector("#win-banner .balls-left-btn.plus");
      if (!plusB) return { button: false };
      for (let i = 0; i < 8; i++) {
        document.querySelector("#win-banner .balls-left-btn.plus").click();
        await new Promise((r) => setTimeout(r, 60));
      }
      await new Promise((r) => setTimeout(r, 300));
      const g = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory[0];
      return { button: true, left: g.ballsLeftOnTable, skunk: !!g.skunk };
    });
    check("...the 8-Ball family's 🎱 Balls left on the banner: 7 left = a skunk (" + JSON.stringify(skunk) + ")", skunk.button && skunk.left === 7 && skunk.skunk, skunk);

    // ---- 38 Points 9-Ball ----
    await page.keyboard.press("Escape");
    filled = await pickGame("9ball38");
    top = await board();
    await plus("Kim");
    await plus("Kim");
    await sleep(200);
    const two = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.find((p) => p.name === "Kim").balls);
    await page.evaluate(() => [...document.querySelectorAll("#scoreboard .btn-ball.minus")].find((b) => / Kim$/.test(b.getAttribute("aria-label"))).click());
    await sleep(200);
    const one = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.find((p) => p.name === "Kim").balls);
    for (let i = 1; i < 37; i++) await plus("Kim");
    await sleep(200);
    const at37 = await saved();
    await plus("Kim");
    await sleep(900);
    s = await saved();
    game = (s.gameHistory || []).find((g) => g.gameType === "9ball38") || {};
    if (OUT) await page.screenshot({ path: path.join(OUT, "points_9ball38.png") });
    check("38 Points 9-Ball: " + filled.target + " " + filled.unit + " filled in; the board: \"" + top.slice(0, 60) + "\"; + + = " + two + ", − = " + one + "; 37 - still playing (" + at37.gameHistory.filter((g) => g.gameType === "9ball38").length + " won), the 38th wins: " + game.gameType + " to " + game.target + " " + game.unit,
      filled.target === "38" && filled.unit === "points" && /38 Points 9-Ball/.test(top) && two === 2 && one === 1 && at37.gameHistory.filter((g) => g.gameType === "9ball38").length === 0 && game.target === 38 && game.unit === "points" && (game.winnerNames || []).indexOf("Kim") !== -1, { filled, top, two, one, game });

    // ---- a rotation of the two ----
    const rot = await page.evaluate(() => {
      const st = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
      st.rotation = { enabled: true, order: [{ gameType: "8ballreversed", target: 1, unit: "rack" }, { gameType: "9ball38", target: 38, unit: "points" }], every: 1 };
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(st));
      return true;
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1000);
    const rotText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
    check("a rotation of the two: both labels on the board", rot && /Reversed 8-Ball/.test(rotText) && /38 Points 9-Ball/.test(rotText), rotText.slice(0, 300));
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
