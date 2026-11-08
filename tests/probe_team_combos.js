// Each pair its own team, its own score (2026-11-08 request: "if Luigi plays with Luc, and they lose
// then Luigi plays with Chris, the wins Luigi had with Luc should not show; however if they play
// again, these wins need to be reloaded - each team combination an entity keeping its own score"),
// at 1180x820 - Rotating Teams, 8-Ball, Luigi & Luc (A) v Bob & Chris (B):
// - Luigi & Luc win two: "Luigi & Luc 2 – 0 Bob & Chris";
// - partners changed (Luc to B, Chris to A): "Luigi & Chris 0 – 0 Luc & Bob" - not Team A's 2;
//   Luigi & Chris win one, Luc & Bob one: 1 – 1;
// - back to the first pairs: "Luigi & Luc 2 – 0 Bob & Chris" again;
// - the standings: every pair with its own wins (Luigi & Luc 2, Luigi & Chris 1, Luc & Bob 1);
// - ↩ Undo (Luc & Bob's win, pairs changed since): back to Luigi & Chris 1 – 0 Luc & Bob;
// - a reload: the same;
// - no page errors.
// Its own file server on 4308.
// usage: node tests/probe_team_combos.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4308, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATE = JSON.stringify({
  players: [["luigi", "Luigi", "A"], ["luc", "Luc", "A"], ["bob", "Bob", "B"], ["chris", "Chris", "B"]].map(([id, name, teamId]) => ({ id, name, teamId, playing: true, balls: 0 })),
  playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, rotatingTeamsEnabled: true,
  currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "teams", queueEnabled: false }, raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 }
});

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
  await page.evaluate((state) => {
    localStorage.clear();
    ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
    localStorage.setItem("poolMasterCounter.state.v2", state);
  }, STATE);
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
  await sleep(700);
  const header = () => page.evaluate(() => (document.querySelector("#scoreboard .teams-header") || {}).textContent || "");
  const win = async (team) => {
    await page.evaluate((t) => document.querySelector('#scoreboard .team-card[data-team-id="' + t + '"] .btn-ball.plus').click(), team);
    await sleep(800);
    await page.keyboard.press("Enter").catch(() => {}); // (the balls-left row: closed)
    await sleep(400);
  };
  // a player to a team letter, with the button beside them (the Players list)
  const toTeam = async (name, letter) => {
    // (the Players list is drawn on the full page - 🔍 Show all)
    await page.evaluate(() => { if (document.getElementById("app").classList.contains("focus-mode")) document.getElementById("btn-board-show-all").click(); });
    await sleep(300);
    await page.evaluate((name, letter) => {
      const li = [...document.querySelectorAll("#roster-list li")].find((x) => x.querySelector(".team-toggle") && new RegExp("^\\W*" + name + "(?![A-Za-z])").test(x.textContent));
      [...li.querySelectorAll(".team-toggle button")].find((b) => b.textContent === letter).click();
    }, name, letter);
    await sleep(500);
  };

  await win("A");
  await win("A");
  const h1 = await header();
  check("Luigi & Luc win two: \"" + h1 + "\"", h1 === "Luigi & Luc 2 – 0 Bob & Chris", h1);

  await toTeam("Luc", "B");
  await toTeam("Chris", "A");
  const h2 = await header();
  check("partners changed (Luc to B, Chris to A): \"" + h2 + "\" - not Team A's 2", h2 === "Luigi & Chris 0 – 0 Luc & Bob", h2);
  if (OUT) await page.screenshot({ path: path.join(OUT, "team_combos_new_pairs.png") });
  await win("A");
  await win("B");
  const h3 = await header();
  check("...Luigi & Chris win one, Luc & Bob one: \"" + h3 + "\"", h3 === "Luigi & Chris 1 – 1 Luc & Bob", h3);

  await toTeam("Luc", "A");
  await toTeam("Chris", "B");
  const h4 = await header();
  check("back to the first pairs: \"" + h4 + "\" - their 2 again", h4 === "Luigi & Luc 2 – 0 Bob & Chris", h4);

  const rows = await page.evaluate(() => [...document.querySelectorAll("#team-standings-list li")].map((li) => ({ name: li.querySelector(".standings-name").textContent.replace(/\d{3,}.*$/, "").trim(), text: li.textContent.replace(/\s+/g, " ") })));
  const rowWins = (who) => { const r = rows.find((x) => x.name.indexOf(who) === 0); return r ? r : null; };
  check("the standings: every pair with its own wins - " + rows.map((r) => r.name).join(" | "), rows.length === 4 && rows[0].name.indexOf("Luigi & Luc") === 0 && !!rowWins("Luigi & Chris") && !!rowWins("Luc & Bob") && !!rowWins("Bob & Chris"), rows);

  await page.evaluate(() => document.getElementById("btn-board-undo").click());
  await sleep(800);
  const h5 = await header();
  check("↩ Undo (Luc & Bob's win - the pairs changed since): \"" + h5 + "\"", h5 === "Luigi & Chris 1 – 0 Luc & Bob", h5);

  await page.reload({ waitUntil: "networkidle2" });
  await sleep(1200);
  const h6 = await header();
  check("a reload: \"" + h6 + "\"", h6 === "Luigi & Chris 1 – 0 Luc & Bob", h6);
  await toTeam("Luc", "A");
  await toTeam("Chris", "B");
  const h7 = await header();
  check("...and the first pairs again: \"" + h7 + "\"", h7 === "Luigi & Luc 2 – 0 Bob & Chris", h7);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
