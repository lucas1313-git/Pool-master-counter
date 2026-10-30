// At the table (2026-10-29 requests), on the board, by the number pad and by tapping:
// - 🎱 Balls left: a rack of 8-Ball won (keypad "1" then "+") - the balls-left row opens by
//   itself; the number pad types it ("1" "2" = 12), Enter keeps it and closes the banner, and
//   the pad selects players again after; another rack: "3", then the ✔ OK button;
// - the rack that wins a race (to 2): the race-won screen covers the board - it has the row too, the
//   number pad types into it ("6"), Enter closes it; the archived race keeps 6;
// - 9-Ball: no balls-left row - "2" selects player 2 as always;
// - a points game (Straight Pool to 5): won - the row opens, "7" + Enter keeps 7;
// - 🔄 the game rotation (8-Ball, 9-Ball, every game): a rack won - no popup while the balls left
//   are typed; Enter - then a big "9-Ball" popup, the rotation with 9-Ball lit; Enter closes it;
//   a 9-Ball rack won (no balls left): the "8-Ball" popup at once;
// - the game rotation's timeline on the board (8/9/10, every 3): the games in order with 8-Ball lit,
//   the ◀ ● ▶ track, "8-Ball (1 of 3 games)" - no field on the board; ▶ moves it on;
// - 🎱 Winner Stays on the board: shown with a third player on the roster, off; ticked - Winner
//   Stays on (the Players section's switch too), "Next up: Lee"; a two-player roster: not shown;
// - ☰ Menu, first page: 📋 Standings (opens the standings) and 🔍 See all (the full page);
// - no page errors.
// Its own file server on 4293.
// usage: node tests/probe_table_requests.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4293, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

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
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const load = async (players, game, extra) => {
      await page.goto(BASE + "manifest.json");
      await page.evaluate((players, game, extra) => {
        localStorage.clear();
        localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
        localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
        localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
        localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
        localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(Object.assign({ players: players.map((n, i) => ({ id: "p" + i, name: n, playing: i < 2, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: Object.assign({ mode: "individual" }, game), raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }, extra || {})));
      }, players, game, extra || null);
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(900);
    };
    const key = async (k) => { await page.keyboard.press(k); await sleep(250); };
    const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
    const banner = () => page.evaluate(() => {
      const b = document.getElementById("win-banner");
      const v = document.getElementById("win-banner-balls-value");
      const pop = document.getElementById("gamechange-overlay");
      return { shown: !!b && !b.classList.contains("hidden"), balls: v ? v.textContent : null, ok: !!document.getElementById("btn-win-banner-balls-ok"), popup: !pop.classList.contains("hidden") ? { game: (document.getElementById("gamechange-game") || {}).textContent, lit: (pop.querySelector(".gamechange-step.is-now") || {}).textContent, text: pop.textContent.replace(/\s+/g, " ").slice(0, 200) } : null };
    });
    const selected = () => page.evaluate(() => { const c = document.querySelector("#scoreboard .player-panel.keypad-selected, #scoreboard .is-keypad-selected"); return c ? c.textContent.slice(0, 20) : ""; });

    // ---- 🎱 Balls left from the number pad: 8-Ball ----
    await load(["Kim", "Jo"], { gameType: "8ball", target: 1, unit: "rack" });
    await key("1");
    await key("NumpadAdd");
    await sleep(400);
    let b = await banner();
    if (OUT) await page.screenshot({ path: path.join(OUT, "balls_left_keypad.png") });
    check("a rack of 8-Ball won from the number pad: the balls-left row opens by itself, with ✔ OK", b.shown && b.balls !== null && b.ok, b);
    await key("1");
    await key("2");
    b = await banner();
    let saved = (await st()).gameHistory[0].ballsLeftOnTable;
    check("...the number pad types it: \"1\" \"2\" = " + b.balls + " (saved " + saved + ")", b.balls === "12" && saved === 12, { b, saved });
    await key("Enter");
    b = await banner();
    check("...Enter keeps it and closes the banner", !b.shown && (await st()).gameHistory[0].ballsLeftOnTable === 12, b);
    await key("2");
    const sel = await page.evaluate(() => document.querySelector("#scoreboard .player-panel.keypad-selected") ? document.querySelector("#scoreboard .player-panel.keypad-selected").textContent : (document.querySelector("[data-keypad-player-id].is-selected, .keypad-selected") || {}).textContent || "");
    await key("NumpadAdd");
    await sleep(400);
    b = await banner();
    const won2 = await st();
    check("...after it the number pad works as always: \"2\" + gives Jo the next rack", won2.gameHistory.length === 2 && won2.gameHistory[0].winnerNames[0] === "Jo" && b.shown, { games: won2.gameHistory.map((g) => g.winnerNames), b, sel });
    await key("3");
    await page.click("#btn-win-banner-balls-ok");
    await sleep(300);
    b = await banner();
    check("...\"3\" then the ✔ OK button: kept (3), the banner gone", !b.shown && (await st()).gameHistory[0].ballsLeftOnTable === 3, b);

    // ---- the rack that wins a race: the race-won screen ----
    await load(["Kim", "Jo"], { gameType: "8ball", target: 1, unit: "rack" }, { raceToWinsTarget: 2 });
    await key("1");
    await key("NumpadAdd");
    await key("Enter");
    await key("1");
    await key("NumpadAdd");
    await sleep(1200);
    const screen = () => page.evaluate(() => ({ up: !document.getElementById("milestone-overlay").classList.contains("hidden"), row: !document.getElementById("milestone-balls-row").classList.contains("hidden"), value: document.getElementById("milestone-balls-value").textContent }));
    let ms = await screen();
    await key("6");
    const typed = await screen();
    if (OUT) await page.screenshot({ path: path.join(OUT, "race_won_balls_left.png") });
    await key("Enter");
    const closed = await screen();
    const archived = await page.evaluate(() => new Promise((resolve) => {
      const fromLs = localStorage.getItem("poolMasterCounter.playerStats.v1");
      const pick = (stats) => { const kim = stats && (stats.Kim || stats[Object.keys(stats).find((k) => /kim/i.test(k))]); const games = kim ? [].concat(...(kim.sessions || []).map((x) => x.games || [])) : []; return games.map((g) => g.ballsLeftOnTable); };
      if (fromLs) return resolve(pick(JSON.parse(fromLs)));
      const gen = localStorage.getItem("poolMasterCounter.bigStoreGen.v1") || "0";
      const req = indexedDB.open("pmc-big", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("kv");
      req.onerror = () => resolve(null);
      req.onsuccess = () => { const get = req.result.transaction("kv", "readonly").objectStore("kv").get("playerStats@" + gen); get.onsuccess = () => { resolve(pick(get.result)); req.result.close(); }; get.onerror = () => resolve(null); };
    }));
    check("the rack that wins a race: the race-won screen has the balls-left row; the number pad types \"6\" there; Enter closes it; the archived race keeps 6", ms.up && ms.row && typed.value === "6" && !closed.up && (archived || []).includes(6), { ms, typed, closed, archived });

    // ---- 9-Ball: nothing ----
    await load(["Kim", "Jo"], { gameType: "9ball", target: 1, unit: "rack" });
    await key("1");
    await key("NumpadAdd");
    await sleep(400);
    b = await banner();
    await key("2");
    const nine = await st();
    await key("NumpadAdd");
    await sleep(400);
    const nine2 = await st();
    check("9-Ball: no balls-left row; \"2\" selects Jo as always (\"+\" gives Jo the rack)", b.shown && b.balls === null && nine2.gameHistory.length === 2 && nine2.gameHistory[0].winnerNames[0] === "Jo", { b, games: nine2.gameHistory.map((g) => g.winnerNames) });

    // ---- a points game: Straight Pool to 5 ----
    await load(["Kim", "Jo"], { gameType: "straight", target: 5, unit: "points" });
    await key("1");
    for (let i = 0; i < 5; i++) await key("NumpadAdd");
    await sleep(400);
    b = await banner();
    const opened = b.balls !== null;
    await key("7");
    await key("Enter");
    const sp = await st();
    check("a points game won (Straight Pool to 5): the row opens; \"7\" + Enter keeps 7", opened && sp.gameHistory[0] && sp.gameHistory[0].ballsLeftOnTable === 7 && !(await banner()).shown, { opened, game: sp.gameHistory[0] });

    // ---- 🔄 the game rotation: 8-Ball, 9-Ball, every game ----
    await load(["Kim", "Jo"], { gameType: "8ball", target: 1, unit: "rack" }, { rotation: { enabled: true, every: 1, order: [{ gameType: "8ball", target: 1, unit: "rack" }, { gameType: "9ball", target: 1, unit: "rack" }] } });
    await key("1");
    await key("NumpadAdd");
    await sleep(500);
    b = await banner();
    check("the rotation moves to 9-Ball on a rack won: no popup while the balls left are typed", b.shown && b.balls !== null && !b.popup, b);
    await key("4");
    await key("Enter");
    await sleep(300);
    b = await banner();
    if (OUT) await page.screenshot({ path: path.join(OUT, "game_change_popup.png") });
    check("...Enter: then a big \"" + (b.popup && b.popup.game) + "\" popup, the rotation with " + (b.popup && b.popup.lit) + " lit", b.popup && b.popup.game === "9-Ball" && b.popup.lit === "9-Ball" && /8-Ball → 9-Ball/.test(b.popup.text) && (await st()).gameHistory[0].ballsLeftOnTable === 4, b);
    await key("Enter");
    b = await banner();
    check("...Enter closes it", !b.popup, b);
    await key("1");
    await key("NumpadAdd");
    await sleep(500);
    b = await banner();
    check("a 9-Ball rack won (no balls left there): the \"" + (b.popup && b.popup.game) + "\" popup at once", b.popup && b.popup.game === "8-Ball" && b.balls === null, b);
    await key("Enter");

    // ---- the game rotation's timeline on the board ----
    await load(["Kim", "Jo"], { gameType: "8ball", target: 1, unit: "rack" }, { gamesPlayedCount: 1, rotation: { enabled: true, every: 3, order: [{ gameType: "8ball", target: 1, unit: "rack" }, { gameType: "9ball", target: 1, unit: "rack" }, { gameType: "10ball", target: 1, unit: "rack" }] } });
    const tl = () => page.evaluate(() => { const row = document.getElementById("rotation-position-row"); return { shown: !!row.offsetParent, seq: [...row.querySelectorAll(".rotation-sequence-step")].map((x) => x.textContent + (x.classList.contains("is-now") ? "*" : "")).join(" "), text: document.getElementById("rotation-position-text").textContent, fields: [...row.querySelectorAll("input")].filter((x) => x.offsetParent).length, dots: row.querySelectorAll(".rotation-position-node").length }; });
    let t1 = await tl();
    if (OUT) await page.screenshot({ path: path.join(OUT, "rotation_timeline_board.png") });
    check("the game rotation's timeline on the board: " + t1.seq + " · " + t1.text + " (" + t1.dots + " dots), no field", t1.shown && t1.seq === "8-Ball* 9-Ball 10-Ball" && t1.text === "8-Ball (1 of 3 games)" && t1.dots === 3 && t1.fields === 0, t1);
    await page.click("#btn-rotation-position-next");
    await sleep(300);
    await page.click("#btn-rotation-position-next");
    await sleep(300);
    t1 = await tl();
    check("...▶ ▶: on to 9-Ball (" + t1.seq + ")", t1.seq === "8-Ball 9-Ball* 10-Ball" && (await st()).currentGame.gameType === "9ball", t1);
    await page.keyboard.press("Enter").catch(() => {});

    // ---- 🎱 Winner Stays on the board ----
    await load(["Kim", "Jo", "Lee"], { gameType: "8ball", target: 1, unit: "rack" });
    const ws = () => page.evaluate(() => { const r = document.getElementById("board-winner-stays"); return { shown: !r.classList.contains("hidden") && !!r.offsetParent, on: document.getElementById("board-winner-stays-checkbox").checked, players: document.getElementById("queue-mode-checkbox").checked, line: document.getElementById("winner-stays-line").textContent }; });
    let w = await ws();
    check("🎱 Winner Stays on the board: shown with a third player on the roster, off", w.shown && !w.on, w);
    await page.click("#board-winner-stays-checkbox");
    await sleep(400);
    w = await ws();
    if (OUT) await page.screenshot({ path: path.join(OUT, "winner_stays_board.png") });
    check("...ticked: Winner Stays on (the Players section's switch too) - \"" + w.line + "\"", w.on && w.players && (await st()).currentGame.queueEnabled === true && /Lee/.test(w.line), w);
    await load(["Kim", "Jo"], { gameType: "8ball", target: 1, unit: "rack" });
    w = await ws();
    check("...a two-player roster: not shown", !w.shown, w);

    // ---- ☰ Menu: Standings and See all on its first page ----
    await page.click("#btn-board-menu");
    await sleep(250);
    const rows = await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].map((r) => r.dataset.menuKey));
    if (OUT) await page.screenshot({ path: path.join(OUT, "menu_first_page.png") });
    await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((r) => r.dataset.menuKey === "menu.standings").click());
    await sleep(600);
    const standings = await page.evaluate(() => { const p = document.getElementById("standings-panel"); return { visible: !!p && !!p.offsetParent, collapsed: p.classList.contains("collapsed") }; });
    check("☰ Menu, first page: 📋 Standings and 🔍 See all - Standings opens the standings", rows.includes("menu.standings") && rows.includes("menu.allSettings") && standings.visible && !standings.collapsed, { rows, standings });
    await page.click("#btn-board-menu").catch(() => {});
    await sleep(250);
    await page.evaluate(() => { const r = [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((x) => x.dataset.menuKey === "menu.allSettings"); if (r) r.click(); });
    await sleep(400);
    const full = await page.evaluate(() => !document.getElementById("app").classList.contains("focus-mode"));
    check("...🔍 See all: the full page", full, full);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
