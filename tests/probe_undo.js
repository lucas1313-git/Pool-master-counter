// Real undo, and changing who won any game - on the scoreboard:
// - Race to 5, Kim v Jo: racks Kim, Jo, Kim, then ↩ Undo twice on the board (no confirm): the
//   board, the game log and both ratings exactly as after rack 1;
// - the board's ↩ Undo is its own shape and at least 10 mm (52 CSS px on an iPad) from every +;
// - Straight Pool to 100 won at 100-87 (Kim was on 99): ↩ Undo brings back 99-87, no game logged;
// - Winner Stays (Ann, Bob seated, Cat waiting): Bob wins, Ann goes to wait, Cat sits; ↩ Undo:
//   Ann and Bob seated again, Cat first in line;
// - 🔄 Change winner in the banner, then Jo: the rack is Jo's (Kim's win gone, Jo's rating up);
// - Recent Games: ✏️ on a past game (not the last) gives Ann's win to Bob - the Leaderboard goes
//   from Ann 8 / Bob 4 wins to 7 / 5; 🗑 removes a game (asks first) and the wins follow;
// - no page errors.
// Its own file server on 4259.
// usage: node tests/probe_undo.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4259, BASE = "http://localhost:" + PORT + "/";
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fresh = async (seedState) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((seed) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      if (seed) localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(seed));
    }, seedState || null);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(800);
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
  const plus = async (name) => {
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((x) => x.getAttribute("aria-label") === "Add point for " + name).click(), name);
    await sleep(700);
  };
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
  const ratings = () => page.evaluate(() => {
    const r = JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1") || "{}");
    const out = {};
    Object.keys(r).forEach((k) => { out[r[k].name || k] = { rating: Math.round(r[k].rating * 1000) / 1000, n: (r[k].history || []).length, games: r[k].gamesPlayed }; });
    return out;
  });
  const board = async () => {
    const s = await st();
    const byName = {};
    s.players.forEach((p) => { byName[p.name] = { balls: p.balls, playing: p.playing, wins: s.playerWins[p.id] || 0 }; });
    return { players: byName, games: s.gameHistory.map((g) => g.winnerNames.join()), count: s.gamesPlayedCount, queue: (s.queue || []).map((id) => (s.players.find((p) => p.id === id) || {}).name).filter(Boolean) };
  };
  const undo = async () => { await page.click("#btn-board-undo"); await sleep(500); };
  const confirmShown = () => page.evaluate(() => !document.getElementById("confirm-modal-overlay").classList.contains("hidden"));

  // ---- three racks, two undos ----
  await fresh();
  await quickGame(5, "Kim", "Jo");
  await plus("Kim");
  const board1 = await board(), ratings1 = await ratings();
  await plus("Jo");
  await plus("Kim");
  const board3 = await board();
  await undo();
  const askedAfterUndo = await confirmShown();
  await undo();
  const boardBack = await board(), ratingsBack = await ratings();
  check("racks Kim, Jo, Kim: then two ↩ Undo - the board and game log as after rack 1", board3.games.length === 3 && JSON.stringify(boardBack) === JSON.stringify(board1), { board1, boardBack });
  check("...the ratings too (Kim's and Jo's, their histories)", JSON.stringify(ratingsBack) === JSON.stringify(ratings1), { ratings1, ratingsBack });
  check("...no confirm asked", !askedAfterUndo);
  const geo = await page.evaluate(() => {
    const u = document.getElementById("btn-board-undo").getBoundingClientRect();
    const dist = [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].map((b) => {
      const r = b.getBoundingClientRect();
      const dx = Math.max(0, r.left - u.right, u.left - r.right), dy = Math.max(0, r.top - u.bottom, u.top - r.bottom);
      return Math.round(Math.hypot(dx, dy));
    });
    const cs = getComputedStyle(document.getElementById("btn-board-undo"));
    return { min: Math.min(...dist), radius: cs.borderTopLeftRadius, border: cs.borderTopStyle };
  });
  check("the board's ↩ Undo: its own shape (round ends, dashed) and " + geo.min + " px from the nearest + (10 mm on an iPad is 52)", geo.min >= 52 && geo.border === "dashed" && parseFloat(geo.radius) >= 20, geo);
  if (OUT) await page.screenshot({ path: path.join(OUT, "board_undo.png") });

  // ---- Straight Pool at 99-87 ----
  await fresh({
    players: [{ id: "k", name: "Kim", playing: true, balls: 99 }, { id: "j", name: "Jo", playing: true, balls: 87 }],
    playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
    currentGame: { gameType: "straight", target: 100, unit: "points", mode: "individual" }, raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 }
  });
  await plus("Kim");
  const won = await board();
  await undo();
  const sp = await board();
  check("Straight Pool won at 100-87, then ↩ Undo: 99-87 again, no game logged", won.games.length === 1 && won.players.Kim.balls === 0 && sp.players.Kim.balls === 99 && sp.players.Jo.balls === 87 && sp.games.length === 0, { won, sp });

  // ---- Winner Stays seating ----
  await fresh({
    players: [{ id: "a", name: "Ann", playing: true, balls: 0 }, { id: "b", name: "Bob", playing: true, balls: 0 }, { id: "c", name: "Cat", playing: false, balls: 0 }],
    playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, queue: ["c"],
    currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual", queueEnabled: true }, raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 }
  });
  const ws0 = await board();
  await plus("Bob");
  const ws1 = await board();
  await undo();
  const ws2 = await board();
  check("Winner Stays: Bob wins, Ann waits, Cat sits - ↩ Undo: Ann and Bob seated, Cat waiting, the line as it was",
    !ws1.players.Ann.playing && ws1.players.Cat.playing && ws2.players.Ann.playing && ws2.players.Bob.playing && !ws2.players.Cat.playing && JSON.stringify(ws2) === JSON.stringify(ws0), { ws0, ws1, ws2 });

  // ---- 🔄 Change winner ----
  await fresh();
  await quickGame(5, "Kim", "Jo");
  const r0 = await ratings();
  await plus("Kim");
  await page.click("#btn-win-banner-change");
  await sleep(300);
  if (OUT) await page.screenshot({ path: path.join(OUT, "change_winner.png") });
  await page.evaluate(() => [...document.querySelectorAll("#win-banner .win-banner-winner")].find((b) => b.textContent === "Jo").click());
  await sleep(800);
  const cw = await board(), r1 = await ratings();
  check("🔄 Change winner, then Jo: the rack is Jo's - Kim 0, Jo 1, one game", cw.players.Kim.wins === 0 && cw.players.Jo.wins === 1 && cw.games.join() === "Jo", cw);
  check("...Jo's rating went up, Kim's down (from where they started)", r1.Jo.rating > (r0.Jo ? r0.Jo.rating : 400) && r1.Kim.rating < (r0.Kim ? r0.Kim.rating : 400) && r1.Kim.games === 1, { r0, r1 });

  // ---- Recent Games: edit a past game, delete one ----
  const now = Date.now();
  const games = [];
  // Ann 8, Bob 4 (oldest first)
  ["Ann", "Bob", "Ann", "Ann", "Bob", "Ann", "Ann", "Bob", "Ann", "Ann", "Bob", "Ann"].forEach((w, i) => {
    const l = w === "Ann" ? "Bob" : "Ann";
    games.push({ ts: new Date(now - (12 - i) * 300000).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: [w], winnerIds: [w === "Ann" ? "a" : "b"], opponentNames: [l], isTeam: false, summary: w + " won 8-Ball (target 1)", scores: { [w]: 1, [l]: 0 } });
  });
  await fresh({
    players: [{ id: "a", name: "Ann", playing: true, balls: 0 }, { id: "b", name: "Bob", playing: true, balls: 0 }],
    playerWins: { a: 8, b: 4 }, teamWins: {}, teamMvpWins: {}, gameHistory: games.slice().reverse(), gamesPlayedCount: 12,
    currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 }
  });
  const leader = async () => {
    await page.evaluate(() => document.getElementById("btn-open-leaderboard").click());
    await sleep(900);
    const rows = await page.evaluate(() => [...document.querySelectorAll(".leaderboard-row")].map((r) => r.textContent));
    await page.evaluate(() => { const b = document.getElementById("btn-leaderboard-play-top") || document.querySelector("#view-leaderboard-page .screen-back-btn"); if (b) b.click(); });
    await sleep(600);
    const wins = (n) => { const row = rows.find((r) => r.indexOf(n) !== -1) || ""; const m = /(\d+) wins?\b/.exec(row); return m ? +m[1] : null; };
    return { Ann: wins("Ann"), Bob: wins("Bob") };
  };
  const lb0 = await leader();
  // the 5th game from now (an Ann win, not the last): Recent Games lists newest first
  await page.evaluate(() => { const p = document.getElementById("history-panel"); if (p && p.classList.contains("collapsed")) p.querySelector(".panel-toggle").click(); });
  await sleep(300);
  const pastIdx = await page.evaluate(() => [...document.querySelectorAll("#history-list li")].findIndex((li, i) => i >= 3 && /Ann/.test((li.querySelector(".history-winner") || {}).textContent || "")));
  await page.evaluate((i) => document.querySelectorAll("#history-list li")[i].querySelector(".history-edit").click(), pastIdx);
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll("#tournament-chooser-overlay button")].find((b) => b.textContent === "Bob").click());
  await sleep(800);
  const lb1 = await leader();
  const ed = await board();
  check("Recent Games ✏️ on a past game (not the last): Ann's win given to Bob - the Leaderboard goes from Ann " + lb0.Ann + " / Bob " + lb0.Bob + " to " + lb1.Ann + " / " + lb1.Bob,
    lb0.Ann === 8 && lb0.Bob === 4 && lb1.Ann === 7 && lb1.Bob === 5 && ed.players.Ann.wins === 7 && ed.players.Bob.wins === 5, { lb0, lb1, ed: ed.players });
  if (OUT) await page.screenshot({ path: path.join(OUT, "recent_games.png") });
  await page.evaluate(() => { const p = document.getElementById("history-panel"); if (p && p.classList.contains("collapsed")) p.querySelector(".panel-toggle").click(); });
  await sleep(300);
  await page.evaluate(() => document.querySelector("#history-list li .history-delete").click());
  await sleep(300);
  const asked = await confirmShown();
  await page.click("#btn-confirm-modal-ok");
  await sleep(800);
  const del = await board();
  check("🗑 asks first, then the newest game (Ann's) is gone: 11 games, Ann 6 wins", asked && del.games.length === 11 && del.players.Ann.wins === 6, { asked, games: del.games.length, ann: del.players.Ann });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
