// The scoreboard is the home screen (P13 step 1). With Kim v Jo playing a race to 5:
// - the app opens on the board (Focus Mode) at 1180x820, 820x1180, 390x844 and 1920x1080,
//   with the first + fully on the first screen;
// - ☰ Menu › More › Everything brings the panels back, and the next launch is on the board again;
// - a toast never takes a tap meant for what's under it (scrolled down, the board's top row
//   sits right under it);
// - building a rotation lineup from the board (🎱 Game › Edit the lineup…) opens Games
//   Rotations where it can be seen (a jump to a panel used to scroll to one the board hides);
// - nobody playing: the board says so and offers ▶️ New game, which opens Quick Game and
//   lands on the board with the two players;
// - the welcome (☰ Menu › Players › Welcome a new player) then "Get to it now": Luc alone on the
//   board, with "Nobody to play against yet" and ▶️ New game, which opens Quick Game with Luc filled in;
// - no page errors.
// Its own file server on 4260.
// usage: node tests/probe_board_home.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4260, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 700) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seededBoard() {
  const now = Date.now();
  const g = (i, w, l, wid) => ({ ts: new Date(now - (5 - i) * 300000).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: [w], winnerIds: [wid], opponentNames: [l], isTeam: false, summary: w + " won 8-Ball (target 1)", scores: { [w]: 1, [l]: 0 } });
  return JSON.stringify({
    players: [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }, { id: "a", name: "Ann", playing: false, balls: 0 }, { id: "b", name: "Bob", playing: false, balls: 0 }, { id: "c", name: "Cat", playing: false, balls: 0 }],
    playerWins: { k: 2, j: 1 }, teamWins: {}, teamMvpWins: {}, gameHistory: [g(2, "Kim", "Jo", "k"), g(1, "Jo", "Kim", "j"), g(0, "Kim", "Jo", "k")], gamesPlayedCount: 3,
    currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 }
  });
}

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
  const open = async (w, h, state) => {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: w, height: h, isMobile: w < 1000, hasTouch: w < 1300 });
    await page.goto(BASE + "manifest.json");
    await page.evaluate((state) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      if (state) localStorage.setItem("poolMasterCounter.state.v2", state);
    }, state);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    return page;
  };
  const home = (page) => page.evaluate(() => {
    const plus = document.querySelector("#scoreboard button.btn-ball.plus");
    const r = plus && plus.getBoundingClientRect();
    return { focus: document.getElementById("app").classList.contains("focus-mode"), plusTop: r ? Math.round(r.top) : null, plusBottom: r ? Math.round(r.bottom) : null, h: innerHeight, header: !!document.querySelector(".app-header").offsetParent };
  });

  // ---- the board at the four sizes ----
  for (const [w, h] of [[1180, 820], [820, 1180], [390, 844], [1920, 1080]]) {
    const page = await open(w, h, seededBoard());
    const s = await home(page);
    check(w + "x" + h + ": opens on the board (Focus Mode, no header), the first + fully on the first screen", s.focus && !s.header && s.plusTop !== null && s.plusTop >= 0 && s.plusBottom <= s.h, s);
    if (OUT) await page.screenshot({ path: path.join(OUT, "home_" + w + "x" + h + ".png") });
    await page.close();
  }

  // ---- Show All, then the next launch ----
  let page = await open(1180, 820, seededBoard());
  await page.click("#btn-board-menu");
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.more").click());
  await sleep(150);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.allSettings").click());
  await sleep(300);
  const all = await page.evaluate(() => ({ focus: document.getElementById("app").classList.contains("focus-mode"), panels: [...document.querySelectorAll("#app > .panel, #app .panel")].filter((p) => p.offsetParent).length }));
  check("☰ Menu › More › Everything (the full page) brings the panels back", !all.focus && all.panels > 3, all);
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(900);
  const again = await home(page);
  check("...and the next launch is on the board again", again.focus && again.plusBottom <= again.h, again);
  // a toast over the top row never takes the tap meant for what's under it
  const toastTap = await page.evaluate(() => {
    const t = document.getElementById("page-toast");
    t.textContent = "✔ Finished - the cue is kept"; t.classList.remove("hidden");
    const r = t.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    t.classList.add("hidden");
    return { under: e ? e.id || e.className : null, shown: r.height > 0 };
  });
  check("a toast never takes a tap: what's under it gets it", toastTap.shown && toastTap.under !== "page-toast", toastTap);

  // ---- a rotation lineup to build, from the board (🎱 Game › Edit the lineup…) ----
  await page.evaluate(() => { if (!document.getElementById("app").classList.contains("focus-mode")) document.getElementById("btn-toggle-focus").click(); });
  await sleep(200);
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click('input[name="gs-rotation"][value="8-9"]');
  await sleep(100);
  await page.click("#btn-gs-edit-lineup");
  await sleep(1200);
  const rot = await page.evaluate(() => {
    const p = document.getElementById("rotation-panel");
    const r = p.getBoundingClientRect();
    return { shown: !!p.offsetParent, open: !p.classList.contains("collapsed"), top: Math.round(r.top), h: innerHeight };
  });
  check("a lineup to build, from the board (🎱 Game › Edit the lineup…): Games Rotations opens where it can be seen", rot.shown && rot.open && rot.top >= -5 && rot.top < rot.h, rot);
  await page.close();

  // ---- nobody playing ----
  page = await open(1180, 820, null);
  const empty = await page.evaluate(() => {
    const b = document.getElementById("btn-empty-new-game");
    return { focus: document.getElementById("app").classList.contains("focus-mode"), hint: (document.querySelector("#scoreboard .empty-hint") || {}).textContent, button: b && b.offsetParent ? b.textContent.trim() : null, bottom: b ? Math.round(b.getBoundingClientRect().bottom) : null, h: innerHeight };
  });
  check("nobody playing: the board says so and offers ▶️ New game on the first screen", empty.focus && /Nobody is playing yet/.test(empty.hint || "") && empty.button === "▶️ New game" && empty.bottom <= empty.h, empty);
  if (OUT) await page.screenshot({ path: path.join(OUT, "home_empty.png") });
  await page.click("#btn-empty-new-game");
  await sleep(400);
  const modal = await page.evaluate(() => !document.getElementById("quick-game-overlay").classList.contains("hidden"));
  check("...▶️ New game opens Quick Game", modal);
  await page.type("#quick-game-player1", "Kim");
  await page.type("#quick-game-player2", "Jo");
  await page.click("#btn-quick-game-start");
  await sleep(900);
  const started = await page.evaluate(() => ({ focus: document.getElementById("app").classList.contains("focus-mode"), names: [...document.querySelectorAll("#scoreboard .player-name")].map((n) => n.textContent.trim().replace(/\s+/g, " ")) }));
  check("...and starting it lands on the board with Kim and Jo", started.focus && started.names.some((n) => n.startsWith("Kim")) && started.names.some((n) => n.startsWith("Jo")), started);
  await page.close();

  // ---- the welcome (☰ Menu › Players › Welcome a new player), "Get to it now", then one player on the board ----
  page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1180, height: 820, hasTouch: true });
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(900);
  await page.click("#btn-board-menu"); await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.players").click()); await sleep(150);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.welcomePlayer").click()); await sleep(400);
  await page.click("#btn-onboarding-go"); await sleep(300);
  await page.type("#onboarding-name-input", "Luc");
  await page.click("#btn-onboarding-go"); await sleep(300);
  await page.click("#btn-onboarding-go"); await sleep(300);
  await page.click("#btn-onboarding-manual"); await sleep(800);
  const solo = await page.evaluate(() => {
    const row = document.getElementById("board-solo-row");
    const r = row.getBoundingClientRect();
    return { focus: document.getElementById("app").classList.contains("focus-mode"), cards: document.querySelectorAll("#scoreboard .player-panel").length, row: row.offsetParent ? row.textContent.replace(/\s+/g, " ").trim() : null, top: Math.round(r.top), h: innerHeight };
  });
  check("the welcome (☰ Menu › Players) then \"Get to it now\": the board with Luc alone says \"Nobody to play against yet\" and offers ▶️ New game", solo.focus && solo.cards === 1 && /Nobody to play against yet\. ▶️ New game/.test(solo.row || ""), solo);
  if (OUT) await page.screenshot({ path: path.join(OUT, "home_solo.png"), fullPage: true });
  await page.click("#btn-solo-new-game");
  await sleep(400);
  const pre = await page.evaluate(() => ({ p1: document.getElementById("quick-game-player1").value, focus: document.activeElement.id }));
  check("...▶️ New game opens Quick Game with Luc filled in, the opponent's field ready", pre.p1 === "Luc" && pre.focus === "quick-game-player2", pre);
  await page.keyboard.type("Jo");
  await page.click("#btn-quick-game-start");
  await sleep(900);
  const duo = await page.evaluate(() => ({ names: [...document.querySelectorAll("#scoreboard .player-name")].map((n) => n.textContent.trim()), row: !!document.getElementById("board-solo-row").offsetParent }));
  check("...and Luc v Jo are on the board, the row gone", duo.names.length === 2 && duo.names.some((n) => n.startsWith("Luc")) && duo.names.some((n) => n.startsWith("Jo")) && !duo.row, duo);
  await page.close();

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
