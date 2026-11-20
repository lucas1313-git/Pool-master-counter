// ⛰️🔥 The "On the hill" popup, back (2026-11-19, the user: "i want the popup "on the hill" to be back
// in the app" - gone since every win became one tap with a banner, 3225d933), at 1180x900:
// - a race to 3, Kim and Jo: Kim's first rack - no popup; his second (on the hill) - the popup,
//   once the finger has lifted (not within 600 ms) - not waiting for the banner's balls left -
//   "Kim is ON THE HILL — one more win takes the race to 3! Better step up. 👀", the banner's line
//   too; gone by itself after 5 s;
// - Jo on the hill too: the popup; a real tap on Kim's + (outside the popup's card) goes through -
//   the popup gone AND Kim's rack in (he wins the race);
// - the keypad: on the hill, the popup up - "1" then "+" put it away and score;
// - "Watch out!" closes it;
// - Celebrations Off: no popup, the banner's line only;
// - no page errors.
// Its own file server on 4327.
// usage: node tests/probe_on_hill.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = process.env.PMC_SITE || path.join(__dirname, "..");
const PORT = 4327, BASE = "http://localhost:" + PORT + "/";
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
    const fresh = async (celebrations) => {
      await page.goto(BASE + "manifest.json");
      await page.evaluate((celebrations) => {
        localStorage.clear();
        ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
        localStorage.setItem("poolMasterCounter.celebrations.v1", celebrations);
        localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: ["Kim", "Jo"].map((n, i) => ({ id: "p" + i, name: n, playing: true, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 } }));
      }, celebrations);
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(900);
    };
    const plus = (name) => page.evaluate((name) => {
      const b = [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((x) => x.getAttribute("aria-label").endsWith(" for " + name));
      const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, name);
    // a real tap (pointer events and all) on someone's +
    const tap = async (name) => {
      const p = await plus(name);
      await page.mouse.click(p.x, p.y);
    };
    const popup = () => page.evaluate(() => ({ up: !document.getElementById("onhill-overlay").classList.contains("hidden"), text: document.getElementById("onhill-message").textContent, banner: (document.getElementById("win-banner") || {}).textContent || "" }));
    const wins = () => page.evaluate(() => { const s = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")); return { kim: s.playerWins.p0 || 0, jo: s.playerWins.p1 || 0, games: (s.gameHistory || []).length }; });

    // ---- Kim's first rack: nothing; his second: on the hill ----
    await fresh("on");
    await tap("Kim");
    await sleep(900);
    const first = await popup();
    await tap("Kim");
    await sleep(150);
    const early = await popup();
    await sleep(900);
    const hill = await popup();
    if (OUT) await page.screenshot({ path: path.join(OUT, "on_hill.png") });
    check("Kim's first rack: no popup; his second: \"" + hill.text + "\" - after the finger lifted (not at 150 ms), the banner's line too",
      !first.up && !early.up && hill.up && hill.text === "Kim is ON THE HILL — one more win takes the race to 3! Better step up. 👀" && /Kim is on the hill/.test(hill.banner), { first, early, hill });
    await sleep(5200);
    check("...gone by itself after 5 s", !(await popup()).up);

    // ---- Jo on the hill too; a real tap on Kim's + goes through ----
    await tap("Jo");
    await sleep(900);
    await tap("Jo");
    await sleep(1000);
    const joHill = await popup();
    const before = await wins();
    await tap("Kim");
    await sleep(500);
    const after = await wins();
    const through = await popup();
    const raceWon = await page.evaluate(() => !document.getElementById("milestone-overlay").classList.contains("hidden") || /won the race/.test((document.getElementById("win-banner") || {}).textContent || ""));
    await sleep(1200);
    const milestone = await page.evaluate(() => ({ up: !document.getElementById("milestone-overlay").classList.contains("hidden"), head: document.getElementById("milestone-headline").textContent }));
    check("Jo on the hill: the popup (\"" + joHill.text.slice(0, 40) + "…\"); a real tap on Kim's + goes through it - gone, and Kim's rack in: he wins the race (" + milestone.head + ")",
      joHill.up && /^Jo is ON THE HILL/.test(joHill.text) && !through.up && milestone.up && /Kim/.test(milestone.head), { joHill, before, after, through, raceWon, milestone });

    // ---- the keypad: "1" then "+" put it away and score ----
    await fresh("on");
    await tap("Kim");
    await sleep(900);
    await tap("Kim");
    await sleep(1000);
    const kHill = await popup();
    await page.keyboard.press("1");
    await sleep(150);
    await page.keyboard.press("+");
    await sleep(1500);
    const kAfter = await page.evaluate(() => ({ up: !document.getElementById("onhill-overlay").classList.contains("hidden"), milestone: !document.getElementById("milestone-overlay").classList.contains("hidden"), head: document.getElementById("milestone-headline").textContent }));
    check("the keypad, the popup up: \"1\" then \"+\" put it away and score - Kim wins the race (" + kAfter.head + ")", kHill.up && !kAfter.up && kAfter.milestone && /Kim/.test(kAfter.head), { kHill, kAfter });

    // ---- "Watch out!" closes it ----
    await fresh("on");
    await tap("Jo");
    await sleep(900);
    await tap("Jo");
    await sleep(1000);
    const wHill = await popup();
    await page.evaluate(() => document.getElementById("btn-onhill-close").click());
    await sleep(200);
    check("\"Watch out!\" (" + (await page.evaluate(() => document.getElementById("btn-onhill-close").textContent)) + ") closes it", wHill.up && !(await popup()).up);

    // ---- Celebrations Off: the banner's line only ----
    await fresh("off");
    await tap("Kim");
    await sleep(900);
    await tap("Kim");
    await sleep(1300);
    const off = await popup();
    check("Celebrations Off: no popup, the banner's line only", !off.up && /Kim is on the hill/.test(off.banner), off);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
