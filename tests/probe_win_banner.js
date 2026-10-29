// One tap per rack: the win goes in at once and a banner says so - no popup to dismiss. On the
// scoreboard (Quick Game, Race to 5, Kim v Jo):
// - the race takes exactly 5 taps on Kim's + and nothing else: after each rack the banner
//   ("Kim won rack 3 · 3–0"), never a dialog, no toast saying the same thing again; one race-won
//   screen at the end, which closes itself after about 6 s and offers 🔁 Rematch / 👥 New players;
// - nothing appears under the + tap point for 600 ms (looked at 50-550 ms after the tap) - the
//   race-won screen too comes only after;
// - ↩ Undo in the banner takes the last rack back (2–0 again);
// - 🎱 Balls left opens a small stepper only when tapped (nothing takes the keyboard), + sets 0;
// - one banner announces both "on the hill" and the game changing (Race to 3, the rotation
//   switching game every game);
// - Celebrations Off: the race won is a line in the banner, no full screen;
// - no page errors.
// Its own file server on 4258.
// usage: node tests/probe_win_banner.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4258, BASE = "http://localhost:" + PORT + "/";
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 820 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fresh = async (extra) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((extra) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      Object.keys(extra || {}).forEach((k) => localStorage.setItem(k, extra[k]));
    }, extra);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(700);
  };
  const quickGame = async (race, a, b) => {
    await page.evaluate(() => document.getElementById("btn-quick-game").click());
    await sleep(300);
    await page.click("#quick-game-race-to");
    await sleep(150);
    await page.keyboard.type(String(race));
    await page.type("#quick-game-player1", a);
    await page.type("#quick-game-player2", b);
    await page.click("#btn-quick-game-start");
    await sleep(800);
  };
  const plusOf = (name) => page.evaluate((name) => {
    const b = [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((x) => x.getAttribute("aria-label") === "Add point for " + name);
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }, name);
  const shown = () => page.evaluate(() => ({
    banner: document.getElementById("win-banner").classList.contains("hidden") ? null : document.getElementById("win-banner").textContent,
    pending: document.getElementById("win-banner").classList.contains("win-banner-pending"),
    dialogs: [...document.querySelectorAll("[id$='-overlay']")].filter((o) => !o.classList.contains("hidden") && o.getClientRects().length > 0).map((o) => o.id),
    toast: document.getElementById("page-toast").classList.contains("hidden") ? "" : document.getElementById("page-toast").textContent,
    milestone: !document.getElementById("milestone-overlay").classList.contains("hidden"),
    focus: document.activeElement ? document.activeElement.tagName : ""
  }));
  // a tap on +, and what's under that point 50-550 ms later
  const tapPlus = async (name) => {
    const pt = await plusOf(name);
    await page.mouse.click(pt.x, pt.y);
    const under = [];
    for (const t of [50, 200, 400, 550]) {
      await sleep(t === 50 ? 50 : 150);
      under.push(await page.evaluate((x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.closest("button") || e).getAttribute("aria-label") || e.id || e.className : ""; }, pt.x, pt.y));
    }
    return { pt, under };
  };
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));

  // ---- a race to 5, Kim wins it ----
  await fresh();
  await quickGame(5, "Kim", "Jo");
  const racks = [];
  for (let i = 1; i <= 5; i++) {
    const tap = await tapPlus("Kim");
    await sleep(250);
    racks.push(Object.assign(await shown(), { underPlus: tap.under }));
    if (i === 3 && OUT) await page.screenshot({ path: path.join(OUT, "banner_rack3.png") });
    if (i < 5) await sleep(500);
  }
  check("Race to 5: racks 1-4 - the banner each time (\"Kim won rack 3 · 3–0\"), never a dialog",
    racks.slice(0, 4).every((r, i) => r.banner && r.banner.indexOf("Kim won rack " + (i + 1) + " · " + (i + 1) + "–0") !== -1 && r.dialogs.length === 0), racks.map((r) => ({ b: r.banner && r.banner.slice(0, 60), d: r.dialogs })));
  check("...no toast saying the same again, nothing put in the keyboard's way (no field focused)", racks.every((r) => !/won rack|Kim won/.test(r.toast) && r.focus !== "INPUT"), racks.map((r) => ({ t: r.toast, f: r.focus })));
  check("...nothing new under the + for 600 ms after each tap (the + itself every time it's looked at)", racks.every((r) => r.underPlus.every((u) => u === "Add point for Kim")), racks.map((r) => r.underPlus));
  const after4 = racks[3].banner || "";
  check("...rack 4 says Kim is on the hill", /Kim is on the hill/.test(after4), after4);
  check("...the 5th tap: the race-won screen (full screen) comes only after 600 ms - till 550 ms the + is still what's under the finger, at 800 ms it's up",
    racks[4].underPlus.every((u) => u === "Add point for Kim") && racks[4].milestone, racks[4]);
  await sleep(500);
  let s5 = await shown();
  const state5 = await st();
  check("...then exactly one race-won screen - 5 taps in all, nothing else to tap - and the race is already archived (a new session)", s5.milestone && s5.dialogs.length === 1 && s5.dialogs[0] === "milestone-overlay" && state5.gameHistory.length === 0, { s5, games: state5.gameHistory.length });
  const buttons = await page.evaluate(() => [...document.querySelectorAll("#milestone-overlay button")].filter((b) => b.offsetParent).map((b) => b.textContent.trim()));
  check("...it offers 🔁 Rematch and 👥 New players", buttons.includes("🔁 Rematch") && buttons.includes("👥 New players"), buttons);
  if (OUT) await page.screenshot({ path: path.join(OUT, "race_won.png") });
  await sleep(6200);
  s5 = await shown();
  check("...and closes itself after about 6 s", !s5.milestone, s5);

  // ---- Undo in the banner ----
  await fresh();
  await quickGame(5, "Kim", "Jo");
  for (let i = 0; i < 3; i++) { await tapPlus("Kim"); await sleep(700); }
  await page.click("#btn-win-banner-undo");
  await sleep(500);
  const undone = await st();
  const kimId = undone.players.find((p) => p.name === "Kim").id;
  const bannerAfterUndo = (await shown()).banner || "";
  check("↩ Undo in the banner takes the last rack back: Kim 2 again, 2 games", undone.playerWins[kimId] === 2 && undone.gameHistory.length === 2 && /Undone/.test(bannerAfterUndo), { wins: undone.playerWins[kimId], games: undone.gameHistory.length, bannerAfterUndo });

  // ---- 🎱 Balls left ----
  await tapPlus("Kim");
  await sleep(700);
  const before = await page.evaluate(() => !!document.getElementById("win-banner-balls-value"));
  await page.click("#btn-win-banner-balls");
  await sleep(200);
  await page.evaluate(() => document.querySelector("#win-banner .balls-left-btn.plus").click());
  await sleep(300);
  const balls = await page.evaluate(() => ({ value: document.getElementById("win-banner-balls-value").textContent, focus: document.activeElement.tagName, saved: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory[0].ballsLeftOnTable }));
  check("🎱 Balls left: a stepper only once tapped (no field focused); + sets 0, saved on the game", !before && balls.value === "0" && balls.saved === 0 && balls.focus !== "INPUT", { before, balls });

  // ---- on the hill AND a game change, in one banner ----
  await fresh({});
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2") || "null");
  });
  await quickGame(3, "Kim", "Jo");
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
    st.rotation = { enabled: true, order: [{ gameType: "8ball", target: 1, unit: "rack" }, { gameType: "9ball", target: 1, unit: "rack" }], every: 1 };
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(st));
  });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  await tapPlus("Kim");
  await sleep(700);
  await tapPlus("Kim");
  await sleep(400);
  const both = (await shown()).banner || "";
  check("one banner announces both: Kim on the hill and the game changing", /Kim is on the hill/.test(both) && /Now playing/.test(both), both);
  if (OUT) await page.screenshot({ path: path.join(OUT, "banner_both.png") });

  // ---- Celebrations Off ----
  await fresh({ "poolMasterCounter.celebrations.v1": "off" });
  await quickGame(2, "Kim", "Jo");
  await tapPlus("Kim");
  await sleep(700);
  await tapPlus("Kim");
  await sleep(1200);
  const off = await shown();
  check("Celebrations Off: the race won is a line in the banner (\"🏆 Kim won the race to 2!\"), no full screen", !off.milestone && /Kim won the race to 2/.test(off.banner || ""), off);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
