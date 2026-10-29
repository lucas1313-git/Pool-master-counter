// The board's layout (P13 steps 2-6). Kim v Jo (Ann, Bob on the bench), 8-Ball race to 5, at 1180x820:
// - top bar: ☰ Menu, one read-only line ("8-Ball · Race to 5"), ↩ Undo, 🎱 Game - and no setting
//   (select, box, switch) anywhere on the board;
// - 🎱 Game: one sheet, nothing changes until Apply (Cancel leaves it all); Apply sets Straight
//   Pool, race to 7 and Winner Stays together, says so in the banner, and the line follows;
//   rotation chips (8/9 alternate, 8/9/10), Teams split A/B (2/2), timed, shot clock, practice;
// - ☰ Menu: ▶️ New game, then Players, Tournament, League, Stats, Day Report, Backup & Restore,
//   Camera, Recording, Voice, Challonge, Resets, Help, Theme, Language (and More); a panel item
//   opens that panel where it can be seen; Tournament opens its page; Theme changes the theme;
//   Voice holds the speaking switch and its voice;
// - one primary: nothing running, the board's only primary is ▶️ New game; the header too;
// - each card: name, then score, then a + at least 130 px tall (25 mm on an 11-inch iPad), with
//   2 and with 4 players; no − on a rack game (Undo is the top bar's, 52+ px from every +); a
//   points game has a small round − beside its +;
// - ⇄ opens the bench: 60 px rows; Ann takes Kim's seat (same place), Kim goes to the bench;
// - drag handles only in Arrange mode (menu › Players › Arrange), gone after ✓ Done;
// - the highlight: picking a player (key 1) doesn't move anything on the cards; on the hill
//   (4 of a race to 5) lights that card only;
// - the same at 390x844: the top bar fits (no sideways scroll), the sheets fit the screen;
// - no page errors.
// Its own file server on 4266.
// usage: node tests/probe_board_layout.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4266, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function board(opts) {
  opts = opts || {};
  const players = [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }, { id: "a", name: "Ann", playing: !!opts.four, balls: 0 }, { id: "b", name: "Bob", playing: !!opts.four, balls: 0 }];
  return JSON.stringify({
    players, playerWins: opts.wins || { k: 2, j: 1 }, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 3,
    // (four at the table: Custom, by racks - 8-Ball is two at a time, Winner Stays would seat two)
    currentGame: Object.assign({ gameType: opts.four ? "custom" : "8ball", target: 1, unit: "rack", mode: "individual" }, opts.game || {}), raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 }
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
  let page = null;
  const open = async (state, w, h) => {
    if (page) await page.close();
    page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: w || 1180, height: h || 820, hasTouch: true, isMobile: (w || 1180) < 1000 });
    await page.goto(BASE + "manifest.json");
    await page.evaluate((state) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      if (state) localStorage.setItem("poolMasterCounter.state.v2", state);
    }, state);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
    await sleep(500);
  };
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
  const shown = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!(e && e.offsetParent !== null && !e.closest(".hidden")); }, sel);
  const menuClick = (key) => page.evaluate((key) => { const b = [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((x) => x.dataset.menuKey === key); if (!b) return false; b.click(); return true; }, key);
  const bannerText = () => page.evaluate(() => document.getElementById("win-banner").classList.contains("hidden") ? "" : document.getElementById("win-banner").textContent);

  // ---- the top bar ----
  await open(board());
  const bar = await page.evaluate(() => {
    const vis = (e) => e && e.offsetParent !== null;
    const panel = document.getElementById("scoreboard-panel");
    const settings = [...panel.querySelectorAll("select, input")].filter((e) => vis(e) && !e.closest(".board-sheet"));
    return {
      menu: vis(document.getElementById("btn-board-menu")), game: vis(document.getElementById("btn-board-game")),
      undo: !!document.querySelector("#board-topbar #btn-board-undo"),
      line: document.getElementById("board-status").textContent.trim(),
      lineControls: document.querySelectorAll("#board-status input, #board-status select, #board-status button").length,
      settings: settings.map((e) => e.id || e.name || e.type)
    };
  });
  check("top bar: ☰ Menu, one read-only line \"8-Ball · Race to 5\", ↩ Undo, 🎱 Game", bar.menu && bar.game && bar.undo && /^8-Ball · Race to 5/.test(bar.line) && bar.lineControls === 0, bar);
  check("...and no setting anywhere on the board (no select, box or switch)", bar.settings.length === 0, bar.settings);
  if (OUT) await page.screenshot({ path: path.join(OUT, "layout_board.png") });

  // ---- 🎱 Game ----
  await page.click("#btn-board-game");
  await sleep(300);
  await page.select("#gs-game-type", "straight");
  await page.click("#btn-game-sheet-cancel");
  await sleep(300);
  let s = await st();
  check("🎱 Game: nothing changes until Apply - Cancel leaves 8-Ball", s.currentGame.gameType === "8ball" && (await bannerText()) === "", { type: s.currentGame.gameType });
  await page.click("#btn-board-game");
  await sleep(300);
  const sheet = await page.evaluate(() => ({ rot: [...document.querySelectorAll('input[name="gs-rotation"]')].filter((r) => r.closest("label").offsetParent).map((r) => r.closest("label").textContent.trim()), fields: ["gs-game-type", "gs-target", "gs-race-to", "gs-winner-stays", "gs-timed", "gs-shot-clock", "gs-practice"].every((id) => !!document.getElementById(id)), teams: !!document.querySelector('input[name="gs-mode"][value="teams"]') }));
  check("...one sheet: game, target, race, rotation (Off, 8/9 alternate, 8/9/10), players/teams, Winner Stays, timed, shot clock, practice", sheet.fields && sheet.teams && JSON.stringify(sheet.rot) === JSON.stringify(["Off", "8/9 alternate", "8/9/10"]), sheet);
  if (OUT) await page.screenshot({ path: path.join(OUT, "layout_game_sheet.png") });
  await page.select("#gs-game-type", "straight");
  await page.click('input[name="gs-race"][value="race"]');
  await page.click('.gs-step[data-for="gs-race-to"][data-step="1"]');
  await page.click('.gs-step[data-for="gs-race-to"][data-step="1"]');
  await page.click("#gs-winner-stays");
  await page.click("#btn-game-sheet-apply");
  await sleep(700);
  s = await st();
  let line = await page.evaluate(() => document.getElementById("board-status").textContent);
  let banner = await bannerText();
  check("...Apply: Straight Pool to 100, race to 7, Winner Stays - all at once", s.currentGame.gameType === "straight" && s.currentGame.target === 100 && s.raceToWinsTarget === 7 && s.currentGame.queueEnabled === true, { type: s.currentGame.gameType, target: s.currentGame.target, race: s.raceToWinsTarget, q: s.currentGame.queueEnabled });
  check("...said in the banner, and the line follows", /Straight Pool to 100 points/.test(banner) && /Race to 7/.test(banner) && /Winner Stays on/.test(banner) && /^Straight Pool to 100 points · Race to 7 · Winner stays/.test(line), { banner, line });
  // rotation 8/9/10
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click('input[name="gs-rotation"][value="8-9-10"]');
  await page.click("#btn-game-sheet-apply");
  await sleep(700);
  s = await st();
  line = await page.evaluate(() => document.getElementById("board-status").textContent);
  check("...8/9/10 chip: the rotation 8-Ball, 9-Ball, 10-Ball, on - the game is the lineup's, the line says what's next", s.rotation.enabled && s.rotation.order.map((e) => e.gameType).join() === "8ball,9ball,10ball" && s.currentGame.gameType === "8ball" && /🔄 9-Ball/.test(line), { rot: s.rotation, line });
  // practice (nothing is saved from here - the line says so)
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click("#gs-practice");
  await page.click("#btn-game-sheet-apply");
  await sleep(400);
  await page.click("#btn-confirm-modal-ok"); // (practice asks first - see probe_legibility)
  await sleep(500);
  const practice = await page.evaluate(() => ({ on: document.getElementById("no-stats-checkbox").checked, badge: !document.getElementById("practice-badge").classList.contains("hidden") }));
  check("...Practice (not saved): on, and the board says so", practice.on && practice.badge, practice);
  // teams, timed, shot clock; practice off
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click('input[name="gs-rotation"][value="off"]');
  await page.click('input[name="gs-mode"][value="teams"]');
  await page.click("#gs-timed");
  await page.click("#gs-shot-clock");
  await page.click("#gs-practice");
  await page.click("#btn-game-sheet-apply");
  await sleep(800);
  s = await st();
  const teams = s.players.filter((p) => p.playing).map((p) => p.teamId).sort().join("");
  check("...Teams A and B: whoever's playing split 1/1 (Kim A, Jo B), rotation off, timed and shot clock on, practice off", s.currentGame.mode === "teams" && teams === "AB" && !s.rotation.enabled && s.currentGame.timedTournamentEnabled === true && s.currentGame.shotCounterEnabled === true && !(await page.evaluate(() => document.getElementById("no-stats-checkbox").checked)), { mode: s.currentGame.mode, teams, rot: s.rotation.enabled, timed: s.currentGame.timedTournamentEnabled, shot: s.currentGame.shotCounterEnabled });
  await open(board({ four: true }));
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click('input[name="gs-mode"][value="teams"]');
  await page.click("#btn-game-sheet-apply");
  await sleep(700);
  s = await st();
  const split = { A: s.players.filter((p) => p.playing && p.teamId === "A").map((p) => p.name), B: s.players.filter((p) => p.playing && p.teamId === "B").map((p) => p.name) };
  check("...with four playing: 2/2 (Kim, Ann - Jo, Bob)", split.A.join() === "Kim,Ann" && split.B.join() === "Jo,Bob", split);

  // ---- ☰ Menu ----
  await open(board());
  await page.click("#btn-board-menu");
  await sleep(300);
  const menu = await page.evaluate(() => [...document.querySelectorAll("#board-menu-list > li")].map((li) => ({ text: li.textContent.trim().replace(/\s+/g, " "), primary: !!li.querySelector(".is-primary"), h: Math.round(li.firstElementChild.getBoundingClientRect().height) })));
  const want = ["Players", "Tournament", "League", "Stats", "Day Report", "Backup & Restore", "Camera", "Recording", "Voice", "Challonge", "Resets", "Help", "Theme", "Language"];
  const has = want.filter((w) => menu.some((m) => m.text.indexOf(w) !== -1));
  check("☰ Menu: ▶️ New game first (the primary), then Players … Language (14 items, 60 px rows)", menu[0].primary && /New game/.test(menu[0].text) && has.length === want.length && menu.every((m) => m.h >= 60), { menu, missing: want.filter((w) => has.indexOf(w) === -1) });
  if (OUT) await page.screenshot({ path: path.join(OUT, "layout_menu.png") });
  await menuClick("menu.backup");
  await sleep(900);
  const bk = await page.evaluate(() => { const p = document.getElementById("backup-panel"), r = p.getBoundingClientRect(); return { focus: document.getElementById("app").classList.contains("focus-mode"), open: !p.classList.contains("collapsed"), top: Math.round(r.top), h: innerHeight, back: getComputedStyle(document.getElementById("btn-back-to-board")).display !== "none" }; });
  check("...Backup & Restore: the panel, open, where it can be seen - and 🎱 Back to the board", !bk.focus && bk.open && bk.top >= -5 && bk.top < bk.h && bk.back, bk);
  await page.click("#btn-back-to-board");
  await sleep(300);
  check("...🎱 Back to the board: the board again", await page.evaluate(() => document.getElementById("app").classList.contains("focus-mode")));
  await page.click("#btn-board-menu");
  await sleep(200);
  await menuClick("menu.tournament");
  await sleep(600);
  check("...Tournament: its page", await page.evaluate(() => !document.getElementById("view-tournament-page").classList.contains("hidden")));
  await open(board());
  await page.click("#btn-board-menu");
  await sleep(200);
  await page.select("#menu-theme-select", "paper-contrast");
  await sleep(200);
  check("...Theme: changed from the menu", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "paper-contrast");
  await menuClick("menu.voice");
  await sleep(200);
  const voice = await page.evaluate(() => ({ box: !document.getElementById("menu-voice-box").classList.contains("hidden"), inBox: document.getElementById("menu-voice-box").contains(document.getElementById("btn-toggle-keypad-speech")) && document.getElementById("menu-voice-box").contains(document.getElementById("keypad-speech-voice-select")) }));
  check("...Voice: the speaking switch and its voice, in the menu", voice.box && voice.inBox, voice);
  await page.click("#btn-board-menu-back");
  await sleep(150);
  await menuClick("menu.help");
  await sleep(500);
  check("...Help: opens", await page.evaluate(() => !document.getElementById("help-overlay").classList.contains("hidden")));

  // ---- one primary ----
  await open(null);
  const prim = await page.evaluate(() => ({
    board: [...document.querySelectorAll("#scoreboard-panel .btn-primary")].filter((b) => b.offsetParent).map((b) => b.textContent.trim()),
    header: [...document.querySelectorAll("#app .app-header .btn-primary")].map((b) => b.textContent.trim())
  }));
  check("nothing running: one primary on the board, ▶️ New game - and one in the header", JSON.stringify(prim.board) === JSON.stringify(["▶️ New game"]) && JSON.stringify(prim.header) === JSON.stringify(["▶️ New game"]), prim);

  // ---- the card ----
  const anatomy = () => page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].map((c) => {
    const r = (sel) => { const e = c.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), left: Math.round(b.left), right: Math.round(b.right) }; };
    const minus = c.querySelector(".btn-ball.minus");
    return { name: r(".player-name"), score: r(".stat-value"), plus: r(".btn-ball.plus"), minus: minus ? { shown: minus.offsetParent !== null, radius: getComputedStyle(minus).borderRadius, w: Math.round(minus.getBoundingClientRect().width) } : null, swap: !!c.querySelector(".card-swap-btn"), handle: !!c.querySelector(".score-card-drag-handle"), undo: !!c.querySelector("#btn-board-undo") };
  }));
  await open(board());
  let cards = await anatomy();
  const undoGap = await page.evaluate(() => { const u = document.getElementById("btn-board-undo").getBoundingClientRect(); return Math.min(...[...document.querySelectorAll("#scoreboard .btn-ball.plus")].map((p) => { const b = p.getBoundingClientRect(); const dx = Math.max(0, b.left - u.right, u.left - b.right), dy = Math.max(0, b.top - u.bottom, u.top - b.bottom); return Math.round(Math.hypot(dx, dy)); })); });
  check("each card: name, then score, then a + at least 130 px tall (2 players)", cards.length === 2 && cards.every((c) => c.name.bottom <= c.score.top + 4 && c.score.bottom <= c.plus.top + 4 && c.plus.h >= 130), cards);
  check("...8-Ball: no − on the card (↩ Undo is the top bar's, 52+ px from every +)", cards.every((c) => !c.minus && !c.undo) && undoGap >= 52, { cards, undoGap });
  check("...no drag handle outside Arrange", cards.every((c) => !c.handle));
  await open(board({ four: true }));
  cards = await anatomy();
  check("...4 players: still a + of 130+ px on every card", cards.length === 4 && cards.every((c) => c.plus.h >= 130), cards.map((c) => c.plus));
  await open(board({ game: { gameType: "straight", target: 100, unit: "points" } }));
  cards = await anatomy();
  check("...Straight Pool: a small round − beside the + (not another block)", cards.every((c) => c.minus && c.minus.shown && c.minus.radius === "50%" && c.minus.w <= 80 && c.plus.h >= 130), cards.map((c) => c.minus));
  if (OUT) await page.screenshot({ path: path.join(OUT, "layout_points.png") });

  // ---- ⇄ the bench ----
  await open(board());
  await page.evaluate(() => document.querySelector("#scoreboard .player-panel .card-swap-btn").click());
  await sleep(300);
  const bench = await page.evaluate(() => ({ title: document.getElementById("bench-sheet-title").textContent, rows: [...document.querySelectorAll("#bench-list .bench-row")].map((b) => ({ name: b.querySelector(".bench-row-name").textContent, h: Math.round(b.getBoundingClientRect().height) })) }));
  check("⇄ on Kim's card: \"Who plays instead of Kim?\" - Ann and Bob, 60 px rows", /Kim/.test(bench.title) && bench.rows.map((r) => r.name).join() === "Ann,Bob" && bench.rows.every((r) => r.h >= 60), bench);
  if (OUT) await page.screenshot({ path: path.join(OUT, "layout_bench.png") });
  await page.evaluate(() => document.querySelector("#bench-list .bench-row").click());
  await sleep(600);
  s = await st();
  const seats = await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-name")].map((n) => n.textContent.replace(/\d.*$/, "").trim()));
  check("...Ann sits in Kim's seat (first), Kim on the bench, the banner says so", seats.join() === "Ann,Jo" && !s.players.find((p) => p.name === "Kim").playing && /Ann in for Kim/.test(await bannerText()), { seats });

  // ---- ↕ Arrange ----
  await page.click("#btn-board-menu");
  await sleep(200);
  await menuClick("menu.players");
  await sleep(150);
  await menuClick("menu.arrange");
  await sleep(500);
  const arr = await page.evaluate(() => ({ handles: document.querySelectorAll("#scoreboard .score-card-drag-handle").length, done: !!document.getElementById("btn-arrange-done").offsetParent }));
  await page.click("#btn-arrange-done");
  await sleep(300);
  const after = await page.evaluate(() => document.querySelectorAll("#scoreboard .score-card-drag-handle").length);
  check("↕ Arrange (menu › Players): drag handles on every card and ✓ Done arranging; Done takes them away", arr.handles === 2 && arr.done && after === 0, { arr, after });

  // ---- the highlight ----
  await open(board({ wins: { k: 4, j: 1 } }));
  const tops = () => page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].map((c) => { const pr = c.getBoundingClientRect(); return { name: Math.round(c.querySelector(".player-name").getBoundingClientRect().top - pr.top), score: Math.round(c.querySelector(".stat-value").getBoundingClientRect().top - pr.top), size: getComputedStyle(c.querySelector(".stat-value")).fontSize, hill: c.classList.contains("is-on-hill"), sel: c.classList.contains("is-keypad-selected") }; }));
  const before = await tops();
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));
  await sleep(400);
  const picked = await tops();
  check("picking Jo (key 2) lights Jo's card without moving anything on it", picked[1].sel && picked[1].name === before[1].name && picked[1].score === before[1].score && picked[1].size === before[1].size, { before, picked });
  check("...on the hill (4 of a race to 5): Kim's card only", before[0].hill && !before[1].hill, before);
  if (OUT) await page.screenshot({ path: path.join(OUT, "layout_hill.png") });

  // ---- a phone ----
  await open(board(), 390, 844);
  const phone = await page.evaluate(() => { const t = document.getElementById("board-topbar").getBoundingClientRect(); return { doc: document.documentElement.scrollWidth, win: innerWidth, barRight: Math.round(t.right), line: document.getElementById("board-status").offsetParent !== null }; });
  check("390x844: the top bar fits, no sideways scroll", phone.doc <= phone.win && phone.barRight <= phone.win && phone.line, phone);
  await page.click("#btn-board-game");
  await sleep(300);
  const fit = await page.evaluate(() => { const c = document.querySelector("#game-sheet-overlay .board-sheet").getBoundingClientRect(); const a = document.getElementById("btn-game-sheet-apply").getBoundingClientRect(); return { top: Math.round(c.top), bottom: Math.round(c.bottom), applyBottom: Math.round(a.bottom), h: innerHeight }; });
  check("...the Game sheet fits the screen, Apply in reach", fit.top >= 0 && fit.bottom <= fit.h && fit.applyBottom <= fit.h, fit);
  if (OUT) await page.screenshot({ path: path.join(OUT, "layout_phone_game.png") });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
