// A real shot clock (P31), an iPad board, 14.1, Kim and Jo, the shot clock on (30 s) - the page's
// clock under the test's control (Date.now moved on by hand, the clock's tick run straight away):
// - waiting at 30 at the start; a tap on it starts it;
// - 20 s on: a beep at 10 - and the clock goes giant on the board, at least 40% of the screen;
//   5 s more: a beep at 5; 5 s more: the buzzer at 0 - each once, nothing else played;
// - a tap: back to 30, running;
// - Kim's extension: +25 s (30 -> 55 left); Kim's second in the same rack: refused; Jo's: +25 s;
//   a new rack - Kim's extension is back;
// - a ball in (+1 for Kim): the clock starts again at 30;
// - voice: "extension for Jo" (a new rack: allowed), "reset clock";
// - 35 s chosen in the Game sheet: the clock starts at 35;
// - no page errors.
// Its own file server on 4288.
// usage: node tests/probe_shot_clock.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4288, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

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
    // the page's clock: real time plus whatever the test moves it on by
    await page.evaluateOnNewDocument(() => {
      const realNow = Date.now.bind(Date);
      window.__shift = 0;
      Date.now = () => realNow() + window.__shift;
    });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "pa", name: "Kim", playing: true, balls: 0 }, { id: "pb", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "straight", target: 100, unit: "points", mode: "individual", shotCounterEnabled: true, shotCounterBeepSec: 30 }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    // move the clock on, then let the page's own 1-second tick run once more (and read it)
    const advance = async (ms) => { await page.evaluate((ms) => { window.__shift += ms; }, ms); await sleep(1150); };
    const clock = () => page.evaluate(() => {
      const g = document.getElementById("shot-clock-giant"), r = g.getBoundingClientRect();
      return { shown: document.getElementById("shot-counter-time").textContent, giant: !g.classList.contains("hidden"), area: g.classList.contains("hidden") ? 0 : (r.width * r.height) / (innerWidth * innerHeight), events: window.PMCShotClockDebug.events.map((e) => e.kind + (e.player ? ":" + e.player : "")) };
    });
    const events = async () => (await clock()).events.filter((e) => /beep|buzzer/.test(e));

    let c = await clock();
    await page.evaluate(() => document.getElementById("shot-counter-widget").click());
    await sleep(200);
    const started = await clock();
    check("the shot clock waits at 30 to start; a tap on it starts it", c.shown === "30" && !c.giant && started.shown === "30", { c, started });
    await advance(20000);
    c = await clock();
    if (OUT) await page.screenshot({ path: path.join(OUT, "shot_clock_giant.png") });
    check("20 s on: a beep at 10, and the clock giant on the board (" + Math.round(c.area * 100) + "% of the screen)", c.shown === "10" && c.giant && c.area >= 0.4 && (await events()).join() === "beep10", c);
    await advance(5000);
    check("5 s more: a beep at 5", (await events()).join() === "beep10,beep5", await events());
    await advance(5000);
    c = await clock();
    if (OUT) await page.screenshot({ path: path.join(OUT, "shot_clock_out.png") });
    check("5 s more: the buzzer at 0 - each sound once", c.shown === "0" && (await events()).join() === "beep10,beep5,buzzer", c);
    await advance(3000);
    check("...and nothing more while it sits at 0", (await events()).join() === "beep10,beep5,buzzer", await events());
    await page.evaluate(() => document.getElementById("shot-clock-giant").click());
    await sleep(200);
    c = await clock();
    check("a tap on the giant clock: back to 30, running, the giant clock gone", c.shown === "30" && !c.giant, c);

    // extensions
    await page.keyboard.press("1"); // (Kim up)
    await sleep(200);
    await page.evaluate(() => document.getElementById("shot-counter-extend").click());
    await sleep(200);
    const k1 = await clock();
    await page.evaluate(() => document.getElementById("shot-counter-extend").click());
    await sleep(200);
    const k2 = await clock();
    await page.keyboard.press("2"); // (Jo up)
    await sleep(200);
    await page.evaluate(() => document.getElementById("shot-counter-extend").click());
    await sleep(200);
    const j1 = await clock();
    // (the clock runs in real time between the taps: a second either way)
    const about = (shown, want) => Math.abs(+shown - want) <= 1;
    check("Kim's extension: " + k1.shown + " left (30 + 25)", about(k1.shown, 55) && k1.events.filter((e) => e === "extension:Kim").length === 1, k1);
    check("...Kim's second in the same rack: refused (" + k2.shown + "); Jo's: " + j1.shown, about(k2.shown, 55) && k2.events.filter((e) => /^extension/.test(e)).length === 1 && about(j1.shown, 80) && j1.events.includes("extension:Jo"), { k2, j1 });
    // a ball in: the next shot
    await advance(9000);
    await page.evaluate(() => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((x) => / for Kim$/.test(x.getAttribute("aria-label"))).click());
    await sleep(300);
    c = await clock();
    check("a ball in for Kim: the clock starts again at " + c.shown, c.shown === "30", c);
    await page.evaluate(() => window.PMCVoice.handleText("extension for Kim"));
    await sleep(300);
    const sameRack = await clock();
    check("voice \"extension for Kim\" in the same rack: refused", sameRack.events.filter((e) => e === "extension:Kim").length === 1, sameRack);
    // a new rack: 9-ball, Kim wins one - everyone's extension back
    await page.evaluate(() => window.PMCVoice.handleText("play 9-ball"));
    await sleep(300);
    await page.evaluate(() => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((x) => / for Kim$/.test(x.getAttribute("aria-label"))).click());
    await sleep(500);
    await page.evaluate(() => { document.querySelectorAll("#win-banner button").length; }); // (the win banner may stay up)
    await page.evaluate(() => window.PMCVoice.handleText("extension for Kim"));
    await sleep(300);
    const newRack = await clock();
    check("a new rack (Kim wins a 9-ball rack): Kim's extension is back - voice \"extension for Kim\": " + newRack.shown, newRack.events.filter((e) => e === "extension:Kim").length === 2 && about(newRack.shown, 55), newRack);
    await page.evaluate(() => window.PMCVoice.handleText("reset clock"));
    await sleep(300);
    check("voice \"reset clock\": 30 again", (await clock()).shown === "30", await clock());
    // 35 s in the Game sheet
    await page.click("#btn-board-game");
    await sleep(300);
    await page.evaluate(() => document.querySelector('.gs-step[data-for="gs-shot-beep"][data-step="5"]').click());
    await page.click("#btn-game-sheet-apply");
    await sleep(500);
    await page.evaluate(() => window.PMCVoice.handleText("reset clock"));
    await sleep(300);
    const s35 = await clock();
    check("35 s chosen in the Game sheet: the clock starts at " + s35.shown, s35.shown === "35", s35);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
