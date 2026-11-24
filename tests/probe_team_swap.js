// ⇄ A team's player switched from the board (2026-11-24, the user: "when we play team rotation i need
// to be able to switch the teams players from the score board directly, so clicking on a button
// would let me remove a player and if there is only one player standby, the stand player will take
// the spot of the seleced loser"), at 1180x900, Rotating Teams:
// - Kim & Jo (A) v Ann & Ben (B), Lee standing by: each team card has ⇄ Kim / ⇄ Jo, ⇄ Ann / ⇄ Ben;
// - ⇄ Jo: Lee takes Jo's spot at once - on team A with Kim, the banner "⇄ Lee in for Jo", Jo now
//   standing by, no sheet;
// - two standing by (Jo, Max): ⇄ Ben opens the bench sheet with both; Max picked - on team B;
// - team Winner Stays, team C (Cat & Dan) waiting its turn, Lee standing by: ⇄ Kim - Lee in at once
//   (C's players aren't counted as standing by);
// - no page errors.
// Its own file server on 4331.
// usage: node tests/probe_team_swap.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = process.env.PMC_SITE || path.join(__dirname, "..");
const PORT = 4331, BASE = "http://localhost:" + PORT + "/";
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
    const seed = async (players, extra) => {
      await page.goto(BASE + "manifest.json");
      await page.evaluate((players, extra) => {
        localStorage.clear();
        ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
        localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(Object.assign({
          players: players.map(([n, team, playing], i) => ({ id: "p" + i, name: n, playing, teamId: team, balls: 0 })),
          playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, rotatingTeamsEnabled: true,
          currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "teams" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 }
        }, extra || {})));
      }, players, extra);
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(1000);
    };
    const cards = () => page.evaluate(() => [...document.querySelectorAll("#scoreboard .team-card")].map((c) => ({ team: c.dataset.teamId, name: c.querySelector(".team-card-name").textContent, swaps: [...c.querySelectorAll(".team-swap-btn")].map((b) => b.textContent) })));
    const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.map((p) => p.name + ":" + (p.playing ? p.teamId : "standby")));
    const swap = (name) => page.evaluate((name) => [...document.querySelectorAll("#scoreboard .team-swap-btn")].find((b) => b.textContent === "⇄ " + name).click(), name);
    const sheet = () => page.evaluate(() => ({ up: !document.getElementById("bench-sheet-overlay").classList.contains("hidden"), title: document.getElementById("bench-sheet-title").textContent, rows: [...document.querySelectorAll("#bench-list .bench-row-name")].map((x) => x.textContent) }));
    const notice = () => page.evaluate(() => (document.getElementById("win-banner") || {}).innerText || "");

    // ---- one standing by ----
    await seed([["Kim", "A", true], ["Jo", "A", true], ["Ann", "B", true], ["Ben", "B", true], ["Lee", null, false]]);
    let c = await cards();
    if (OUT) await page.screenshot({ path: path.join(OUT, "team_swap_cards.png") });
    check("Rotating Teams, Kim & Jo v Ann & Ben, Lee standing by: each team card has a ⇄ per player " + JSON.stringify(c.map((x) => x.swaps)),
      c.length === 2 && c[0].swaps.join() === "⇄ Kim,⇄ Jo" && c[1].swaps.join() === "⇄ Ann,⇄ Ben", c);
    await swap("Jo");
    await sleep(500);
    let s = await st();
    let sh = await sheet();
    let n = await notice();
    c = await cards();
    check("⇄ Jo: Lee takes his spot at once - " + s.join(", ") + "; \"" + n.replace(/\s+/g, " ").slice(0, 40) + "\"; no sheet",
      s.indexOf("Lee:A") !== -1 && s.indexOf("Jo:standby") !== -1 && s.indexOf("Kim:A") !== -1 && /Lee in for Jo/.test(n) && !sh.up && c[0].swaps.join() === "⇄ Kim,⇄ Lee", { s, sh, n, c });

    // ---- two standing by: pick ----
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
      state.players.push({ id: "p9", name: "Max", playing: false, teamId: null, balls: 0 });
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(state));
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    await swap("Ben");
    await sleep(400);
    sh = await sheet();
    check("two standing by (Jo, Max): ⇄ Ben opens the bench sheet - \"" + sh.title + "\" " + JSON.stringify(sh.rows), sh.up && /Ben/.test(sh.title) && sh.rows.slice().sort().join() === "Jo,Max", sh);
    await page.evaluate(() => [...document.querySelectorAll("#bench-list .bench-row")].find((b) => /Max/.test(b.textContent)).click());
    await sleep(500);
    s = await st();
    check("...Max picked: on team B with Ann - " + s.join(", "), s.indexOf("Max:B") !== -1 && s.indexOf("Ann:B") !== -1 && s.indexOf("Ben:standby") !== -1, s);

    // ---- team Winner Stays: the waiting team's players don't count ----
    await seed([["Kim", "A", true], ["Jo", "A", true], ["Ann", "B", true], ["Ben", "B", true], ["Cat", "C", false], ["Dan", "C", false], ["Lee", null, false]], {
      // (no teamBenched: the app gives seeded players real ids on load - the waiting team is then all of C)
      teamQueue: ["C"], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "teams", queueEnabled: true }
    });
    await swap("Kim");
    await sleep(500);
    s = await st();
    sh = await sheet();
    check("team Winner Stays, team C (Cat & Dan) waiting its turn, Lee standing by: ⇄ Kim - Lee in at once (" + s.join(", ") + ")", s.indexOf("Lee:A") !== -1 && s.indexOf("Kim:standby") !== -1 && s.indexOf("Cat:standby") !== -1 && !sh.up, { s, sh });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
