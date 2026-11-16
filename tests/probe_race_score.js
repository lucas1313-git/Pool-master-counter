// The race score on the score cards and in the voice (2026-11-16, the user: "when it is not a point
// game, I need to see the race score there is no use to see the rack score ever. the voice should
// also tell the race score, except when it is a point based game"), the number pad's voice on, at
// 1180x820:
// - Winner Stays, 8-Ball, race to 3 - Bob, Luc, Chris: the cards say RACE, "0 / 3";
// - Bob wins a rack: "Bob wins, 1 to 0" (no "won the game"); again (v Chris): "Bob wins, 2 to 0" -
//   the cards "2 / 3" and "0 / 3";
// - 2 on the number pad (Luc): "Luc playing, 0 to 2" - no "total 0 points", no "0 points";
// - Bob on the hill: said after the score; Luc's number clicked (wins him the rack): "Luc wins, 1
//   to 2"; Bob wins the race: "Bob wins the race, 3 to 1";
// - a game of 3 racks (8-Ball to 3, race to 2): the card's big number is the race ("0 / 2"), its
//   racks small ("Racks: 1 / 3" after a +);
// - Straight Pool (a points game): the card shows the points, the number pad says "points" as before;
// - no page errors.
// Its own file server on 4312.
// usage: node tests/probe_race_score.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4312, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const board = (game, race, extra) => JSON.stringify(Object.assign({
  players: [{ id: "bob", name: "Bob", playing: true, balls: 0 }, { id: "luc", name: "Luc", playing: true, balls: 0 }, { id: "chris", name: "Chris", playing: true, balls: 0 }],
  playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
  currentGame: Object.assign({ mode: "individual", queueEnabled: true }, game), raceToWinsTarget: race, rotation: { enabled: false, order: [], every: 1 }
}, extra || {}));

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
  let page = null;
  const open = async (state) => {
    if (page) await page.close();
    page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 820 });
    // (what's said, in order - the scoring sounds' wait skipped)
    await page.evaluateOnNewDocument(() => { window.__said = []; if (window.speechSynthesis) window.speechSynthesis.speak = (u) => window.__said.push(u.text); });
    await page.goto(BASE + "manifest.json");
    await page.evaluate((state) => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo", "keypadSpeechEnabled"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.state.v2", state);
    }, state);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
    await sleep(700);
  };
  // what was said since last asked (it waits for the win's fanfare, ~3 s)
  const said = async (ms) => { await sleep(ms || 3600); return page.evaluate(() => window.__said.splice(0)); };
  const cards = () => page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].map((p) => ({
    name: (p.querySelector(".player-name, .name") || {}).textContent,
    label: (p.querySelector(".stat-label") || {}).textContent || "",
    value: p.querySelector(".stat-value").textContent.replace(/\s+/g, " ").trim(),
    mini: (p.querySelector(".stat-mini") || {}).textContent || ""
  })));
  const plus = async (name) => {
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
    await sleep(500);
  };
  const closeBanner = async () => { await page.keyboard.press("Enter").catch(() => {}); await sleep(400); };
  try {
    // ---- Winner Stays, race to 3 ----
    await open(board({ gameType: "8ball", target: 1, unit: "rack" }, 3));
    let c = await cards();
    check("the cards say RACE, \"0 / 3\": " + JSON.stringify(c.map((x) => x.label + " " + x.value)), c.length === 2 && c.every((x) => /^race$/i.test(x.label) && x.value === "0 / 3"), c);
    await plus("Bob");
    let s = await said();
    check("Bob wins a rack: " + JSON.stringify(s), JSON.stringify(s) === JSON.stringify(["Bob wins, 1 to 0"]), s);
    await closeBanner();
    await plus("Bob");
    s = await said();
    c = await cards();
    check("again, v Chris: " + JSON.stringify(s) + " - the cards " + c.map((x) => x.value).join(", "), JSON.stringify(s) === JSON.stringify(["Bob wins, 2 to 0. Bob is on the hill"]) && c.map((x) => x.value).join() === "2 / 3,0 / 3", { s, c });
    await closeBanner();
    await said(200);
    await page.keyboard.press("2");
    s = await said(600);
    check("2 on the number pad (Luc): " + JSON.stringify(s), JSON.stringify(s) === JSON.stringify(["Luc playing, 0 to 2"]), s);
    await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].find((p) => /Luc/.test(p.textContent)).querySelector(".stat-value").click());
    s = await said();
    check("Luc's number clicked (wins him the rack): " + JSON.stringify(s), JSON.stringify(s) === JSON.stringify(["Luc wins, 1 to 2"]), s);
    await closeBanner();
    // (Luc stays, Bob's back: Luc v Bob, then Bob wins the race)
    c = await cards();
    const bobSeated = c.some((x) => /Bob/.test(x.name || ""));
    if (!bobSeated) { await plus("Luc"); await said(); await closeBanner(); }
    await plus("Bob");
    s = await said();
    check("Bob wins the race: " + JSON.stringify(s), s.length === 1 && /^Bob wins the race, 3 to [12]$/.test(s[0]), { s, c });
    if (OUT) await page.screenshot({ path: path.join(OUT, "race_won.png") });

    // ---- a game of 3 racks, race to 2 ----
    await open(board({ gameType: "8ball", target: 3, unit: "rack", queueEnabled: false }, 2, { players: [{ id: "bob", name: "Bob", playing: true, balls: 0 }, { id: "luc", name: "Luc", playing: true, balls: 0 }] }));
    await plus("Bob");
    c = await cards();
    const bob = c.find((x) => /Bob/.test(x.name || "")) || c[0];
    check("a game of 3 racks: the race big, its racks small - " + JSON.stringify(bob), /^race$/i.test(bob.label) && bob.value === "0 / 2" && /Racks: 1 \/ 3/.test(bob.mini), c);
    if (OUT) await page.screenshot({ path: path.join(OUT, "three_racks.png") });

    // ---- Straight Pool ----
    await open(board({ gameType: "straight", target: 100, unit: "points", queueEnabled: false }, 1, { players: [{ id: "bob", name: "Bob", playing: true, balls: 12 }, { id: "luc", name: "Luc", playing: true, balls: 30 }] }));
    c = await cards();
    await page.keyboard.press("1");
    s = await said(600);
    check("Straight Pool: the points on the cards (" + c.map((x) => x.value).join(", ") + "), the number pad says the points: " + JSON.stringify(s), c.map((x) => x.value).join() === "12,30" && s.some((t) => /12 points/.test(t)), { c, s });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
