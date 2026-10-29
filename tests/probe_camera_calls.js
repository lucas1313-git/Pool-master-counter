// The camera's picks on the scoreboard (P25), an iPad at 1180x820, 14.1, Camera player
// recognition on, the camera's shots fed in as it sends them (PMCCameraBridge.handleCameraShot):
// - a score for the player the camera just picked tells the camera "picked: camera"; after a
//   player picked by hand (a number key) it says "picked: hand" - so the camera learns only from
//   a hand pick, or from its own pick when it was already sure (camera.html's handleTurnConfirmed);
// - "camera right X of Y tonight" in Visual Scoring, from the corrections: the camera picks Kim
//   and Kim scores (right); it picks Jo and the operator presses 1 for Kim (wrong); it picks Kim,
//   then Jo with nobody correcting (right) - "right 2 of 3"; Jo scores: "right 3 of 4";
// - it's still there after a reload; another day's count isn't shown;
// - no page errors.
// Its own file server on 4280.
// usage: node tests/probe_camera_calls.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4280, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
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
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setUserAgent(IPAD_UA);
    await page.setViewport({ width: 1180, height: 820, hasTouch: true });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: ["Kim", "Jo"].map((n, i) => ({ id: "p" + i, name: n, playing: true, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "straight", target: 100, unit: "points", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 }, cameraInputEnabled: true }));
    });
    const load = async () => {
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(900);
      await page.evaluate(() => { window.__turns = []; window.PMCCameraBridge.onTurnConfirmed((name, picked) => window.__turns.push(name + ":" + picked)); });
    };
    await load();
    const shot = async (name) => { await page.evaluate((n) => window.PMCCameraBridge.handleCameraShot(n, 0.9), name); await sleep(250); };
    const plus = async (name) => { await page.evaluate((n) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((x) => x.getAttribute("aria-label").endsWith(" for " + n)).click(), name); await sleep(300); };
    const selected = () => page.evaluate(() => { const B = window.PMCCameraBridge, p = B.getSelectedPlayerId(); return ["Kim", "Jo"].find((n) => B.resolvePlayerIdByName(n) === p) || p; });
    const turns = () => page.evaluate(() => window.__turns.slice());
    const line = () => page.evaluate(() => { const el = document.getElementById("camera-accuracy-line"); return el && !el.classList.contains("hidden") ? el.textContent : null; });

    await shot("Kim");
    const kimSel = await selected();
    await plus("Kim");
    await shot("Jo");
    await page.evaluate(() => document.body.focus());
    await page.keyboard.press("1");
    await sleep(300);
    const handSel = await selected();
    await plus("Kim");
    const t = await turns();
    check("the camera picks Kim (" + kimSel + " selected) and Kim scores: \"picked: camera\" to the camera", kimSel === "Kim" && t[0] === "Kim:camera", t);
    check("...it picks Jo, the operator presses 1 (" + handSel + " selected) and Kim scores: \"picked: hand\"", handSel === "Kim" && t[1] === "Kim:hand", t);
    await shot("Kim");
    await shot("Jo");
    const shown = await line();
    check("Visual Scoring: \"" + shown + "\" (Kim right, Jo corrected to Kim, Kim uncorrected)", shown === "📷 Camera right 2 of 3 tonight", shown);
    await plus("Jo");
    const after = await line(), t2 = await turns();
    check("...Jo, the camera's pick, scores: \"" + after + "\", \"picked: camera\"", after === "📷 Camera right 3 of 4 tonight" && t2[2] === "Jo:camera", { after, t2 });
    if (OUT) {
      await page.evaluate(() => { document.getElementById("btn-board-menu").click(); });
      await sleep(200);
      await page.evaluate(() => [...document.querySelectorAll("#board-menu-overlay button")].find((x) => /Camera/.test(x.textContent)).click());
      await sleep(600);
      await page.evaluate(() => document.getElementById("visual-scoring-panel").scrollIntoView());
      await sleep(400);
      await page.screenshot({ path: path.join(OUT, "camera_right_tonight.png") });
    }
    await load();
    check("...still there after a reload", (await line()) === "📷 Camera right 3 of 4 tonight", await line());
    await page.evaluate(() => localStorage.setItem("poolMasterCounter.cameraCalls.v1", JSON.stringify({ day: "2001-01-01", right: 5, total: 9 })));
    await load();
    check("...another day's count isn't shown", (await line()) === null, await line());
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
