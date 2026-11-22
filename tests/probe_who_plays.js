// Who's playing (P15), at 1180x820:
// - 8-Ball with four marked Playing and Winner Stays off: Winner Stays goes on by itself (the banner
//   says so), two at the table, the others in line; a rack gives a result to the two seated only -
//   the others' ratings don't move;
// - Winner Stays: no race (one rack each), the board shows "🔥 Kim: 3 in a row" and "Next up: …",
//   seat changes in the banner (no popup), never "on the hill";
// - "most wins in a row" (🎱 Game): 2 - Kim's second win in a row sends Kim to the line too;
// - Winner Stays + Race to 3 (🎱 Game): one race for everyone - Kim beats Jo (Jo to the back, Ann in,
//   1 / 3), Ann (on the hill, Bob in, the wins kept), Bob: 3 of 3, the race-won screen;
// - the Setup Wizard: two players added there are Playing - it reaches Start without the Standby
//   warning;
// - Teams (four playing 15 Ball Rotation, then Teams): split 2/2 (Kim, Ann - Jo, Bob); each team
//   one card with one + and one number, its players big ("Kim & Ann", "Team A" small), "Kim & Ann
//   0 – 0 Jo & Bob" over them, no member cards, no
//   scrolling at 1180x820; the team's + with nobody picked: the team's rack, nobody credited;
//   Kim picked: Kim credited;
// - Teams (race to 7, Winner Stays on) to Individual in 🎱 Game: two at the table, the others in line,
//   the race to 7 everyone's; a rack sends the loser to the back;
// - Straight Pool with four Playing: all four at the table, each on their own count, no Winner Stays
//   by itself; the first to the target wins against the three others (ratings moved for all four);
//   Winner Stays ticked by hand still seats two - unticked, everyone comes back to the table;
// - a rack game: tapping a player's number wins them the rack; a points game: it picks the
//   player, no point;
// - ▶️ New game (Bob v Chris, both on the board, race to 7) with Winner Stays on: it stays on, Luc next; a rack: the loser
//   to the line;
// - no page errors.
// Its own file server on 4268.
// usage: node tests/probe_who_plays.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4268, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function board(opts) {
  opts = opts || {};
  const four = [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }, { id: "a", name: "Ann", playing: true, balls: 0 }, { id: "b", name: "Bob", playing: true, balls: 0 }];
  return JSON.stringify({
    players: four, playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
    currentGame: Object.assign({ gameType: "8ball", target: 1, unit: "rack", mode: "individual", queueEnabled: false }, opts.game || {}), raceToWinsTarget: opts.race || 1, rotation: { enabled: false, order: [], every: 1 }
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
    await page.setViewport({ width: w || 1180, height: h || 820, hasTouch: true });
    await page.goto(BASE + "manifest.json");
    await page.evaluate((state) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      if (state) localStorage.setItem("poolMasterCounter.state.v2", state);
    }, state);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
    await sleep(700);
  };
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
  const ratings = () => page.evaluate(() => { const r = JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1") || localStorage.getItem("poolMasterCounter.playerRatings.v1") || "{}"); const out = {}; Object.keys(r).forEach((k) => { out[k] = r[k] && r[k].rating; }); return out; });
  const seated = () => page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel .player-name")].map((n) => n.textContent.replace(/\d.*$/, "").trim()));
  const banner = () => page.evaluate(() => document.getElementById("win-banner").classList.contains("hidden") ? "" : document.getElementById("win-banner").textContent);
  const plusFor = async (name) => {
    await page.evaluate((name) => { const b = [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((x) => x.getAttribute("aria-label").endsWith(" for " + name)); b.click(); }, name);
    await sleep(900);
  };
  const line = () => page.evaluate(() => { const el = document.getElementById("winner-stays-line"); return el.classList.contains("hidden") ? "" : el.textContent; });

  // ---- 8-Ball, four Playing, Winner Stays off ----
  await open(board());
  let s = await st();
  const auto = { queue: s.currentGame.queueEnabled, seated: await seated(), banner: await banner(), line: await line() };
  check("8-Ball with four Playing: Winner Stays goes on by itself - two at the table, the banner says so, the next one shown", auto.queue === true && auto.seated.join() === "Kim,Jo" && /two at a time/.test(auto.banner) && /Next up: Ann/.test(auto.line), auto);
  if (OUT) await page.screenshot({ path: path.join(OUT, "who_auto.png") });
  const before = await ratings();
  await plusFor("Kim");
  s = await st();
  const after = await ratings();
  const game = s.gameHistory[0] || {};
  const moved = Object.keys(after).filter((k) => after[k] !== before[k]);
  check("...a rack: a result for the two at the table only (Kim beat Jo) - Ann's and Bob's ratings don't move", JSON.stringify(game.winnerNames) === JSON.stringify(["Kim"]) && JSON.stringify(game.opponentNames) === JSON.stringify(["Jo"]) && !moved.some((k) => /ann|bob/i.test(k)), { winners: game.winnerNames, opponents: game.opponentNames, moved });
  // Kim wins two more: Ann, then Bob
  const popups = [];
  for (const i of [1, 2]) {
    await plusFor("Kim");
    popups.push(await page.evaluate(() => [...document.querySelectorAll("[id$='-overlay']")].filter((o) => !o.classList.contains("hidden") && o.getClientRects().length).map((o) => o.id)));
  }
  const ws = { seated: await seated(), line: await line(), banner: await banner(), tag: await page.evaluate(() => (document.querySelector("#scoreboard .card-streak-tag") || {}).textContent || ""), status: await page.evaluate(() => document.getElementById("board-status").textContent) };
  check("Winner Stays (Kim beat Jo, Ann, Bob): \"🔥 Kim: 3 in a row\" and \"Next up: Ann (then Bob)\" on the board, Kim's card tagged", /Kim: 3 in a row/.test(ws.line) && /Next up: Ann \(then Bob\)/.test(ws.line) && /3 in a row/.test(ws.tag) && ws.seated.join() === "Kim,Jo", ws);
  check("...seat changes said in the banner (with the streak, not a 3-0 that was against three players), never a popup; no race (no \"on the hill\")", popups.every((p) => p.length === 0) && /Jo is in!/.test(ws.banner) && /Kim won rack 3 · 🔥 3 in a row/.test(ws.banner) && !/3–0/.test(ws.banner) && !/on the hill/i.test(ws.banner) && !/Race to/.test(ws.status), { popups, ws });
  if (OUT) await page.screenshot({ path: path.join(OUT, "who_streak.png") });

  // ---- most wins in a row: 2 ----
  await open(board());
  await page.click("#btn-board-game");
  await sleep(300);
  await page.evaluate(() => { const i = document.getElementById("gs-max-streak"); i.value = "2"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.click("#btn-game-sheet-apply");
  await sleep(700);
  await plusFor("Kim"); // Kim beats Jo - Ann comes in
  await plusFor("Kim"); // Kim beats Ann - 2 in a row: Kim sits too
  s = await st();
  const maxed = { seated: await seated(), banner: await banner(), max: s.currentGame.queueMaxStreak };
  check("most wins in a row 2: Kim's second win in a row sends Kim to the line too (the banner says so)", maxed.max === 2 && !maxed.seated.includes("Kim") && /2 in a row and sits out/.test(maxed.banner), maxed);

  // ---- Winner Stays + a race: one race for everyone (2026-11-15: "bob just won 7 of a race to 7 ...
  // when he got 6 games he didn't get the popup on the hill, when he won 7 the race didn't finish") ----
  await open(board());
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click('input[name="gs-race"][value="race"]');
  await page.evaluate(() => { const i = document.getElementById("gs-race-to"); i.value = "3"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(100);
  const note = await page.evaluate(() => document.getElementById("gs-pairing-note").classList.contains("hidden") ? "" : document.getElementById("gs-pairing-note").textContent);
  await page.click("#btn-game-sheet-apply");
  await sleep(700);
  const values = () => page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].map((c) => c.querySelector(".player-name").textContent.replace(/\d.*$/, "").trim() + " " + c.querySelector(".stat-value").textContent.replace(/\s+/g, " ").trim()).join(", "));
  await plusFor("Kim"); // Kim beats Jo - Ann comes in
  const w1 = { seated: await seated(), values: await values(), line: await line() };
  check("Winner Stays + Race to 3, one race for everyone (said in the sheet: \"" + note + "\"): Kim beats Jo - Jo to the back, Ann in, Kim 1 / 3", /race is everyone's/.test(note) && w1.seated.join() === "Kim,Ann" && w1.values === "Kim 1 / 3, Ann 0 / 3" && /Next up: Bob \(then Jo\)/.test(w1.line), w1);
  await plusFor("Kim"); // Kim beats Ann - Bob comes in, Kim on the hill
  const w2 = { seated: await seated(), values: await values(), banner: await banner(), hill: await page.evaluate(() => !!document.querySelector("#scoreboard .player-panel.is-on-hill")) };
  check("...Kim beats Ann: 2 / 3 - \"on the hill\" in the banner and on the card, Bob in (the wins add up, not 0 - 0)", w2.seated.join() === "Kim,Bob" && w2.values === "Kim 2 / 3, Bob 0 / 3" && /on the hill/i.test(w2.banner) && w2.hill, w2);
  await plusFor("Kim"); // Kim beats Bob - 3 of 3
  const w3 = { milestone: await page.evaluate(() => document.getElementById("milestone-overlay").classList.contains("hidden") ? "" : document.getElementById("milestone-overlay").textContent.replace(/\s+/g, " ").trim().slice(0, 80)) };
  check("...Kim beats Bob: 3 of 3 - the race is won (the race-won screen), not left open", /Kim/.test(w3.milestone) && /Congratulations|won/i.test(w3.milestone), w3);

  // ---- the Setup Wizard ----
  await open(null);
  await page.evaluate(() => document.getElementById("btn-open-wizard").click());
  await sleep(500);
  const step = () => page.evaluate(() => [1, 2, 3, 4, 5].find((n) => !document.getElementById("wizard-step-" + n).classList.contains("hidden")));
  let guard = 0;
  while ((await step()) === 1 && guard++ < 3) { await page.click("#wizard-btn-next"); await sleep(300); }
  for (const n of ["Kim", "Jo"]) {
    await page.type("#wizard-new-player-name", n);
    await page.evaluate(() => document.getElementById("wizard-add-player-form").requestSubmit());
    await sleep(300);
  }
  await page.click("#wizard-btn-next"); // -> who's playing
  await sleep(300);
  await page.click("#wizard-btn-next"); // -> past it
  await sleep(300);
  const wiz = await page.evaluate(() => ({ warning: !document.getElementById("wizard-playing-warning").classList.contains("hidden"), playing: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.filter((p) => p.playing).map((p) => p.name) }));
  const at = await step();
  check("Setup Wizard: the two added there are Playing - past \"who's playing\" with no Standby warning", wiz.playing.join() === "Kim,Jo" && !wiz.warning && at > 3, { wiz, at });

  // ---- Teams ----
  await open(board({ game: { gameType: "15ballrotation", target: 61, unit: "points" } }));
  check("15 Ball Rotation keeps all four at the table (more than two can play it)", (await seated()).length === 4, await seated());
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click('input[name="gs-mode"][value="teams"]');
  await page.select("#gs-game-type", "8ball");
  await page.click("#btn-game-sheet-apply");
  await sleep(800);
  s = await st();
  const split = { A: s.players.filter((p) => p.playing && p.teamId === "A").map((p) => p.name), B: s.players.filter((p) => p.playing && p.teamId === "B").map((p) => p.name) };
  check("...Teams: split 2/2 (Kim, Ann - Jo, Bob)", split.A.join() === "Kim,Ann" && split.B.join() === "Jo,Bob", split);
  const teams = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("#scoreboard .team-card")];
    return { cards: cards.length, plus: cards.map((c) => c.querySelectorAll(".btn-ball.plus").length), numbers: cards.map((c) => c.querySelectorAll(".stat-value").length), members: document.querySelectorAll("#scoreboard .member-card").length, header: (document.querySelector("#scoreboard .teams-header") || {}).textContent, names: cards.map((c) => c.querySelector(".team-card-name").textContent + "/" + c.querySelector(".team-card-members").textContent), scroll: document.documentElement.scrollHeight > innerHeight + 2 };
  });
  check("...one card per team: one +, one number, its players big (\"Kim & Ann\" / Team A), \"Kim & Ann 0 – 0 Jo & Bob\" over them, no member cards, no scrolling", teams.cards === 2 && teams.plus.join() === "1,1" && teams.numbers.join() === "1,1" && teams.members === 0 && teams.header === "Kim & Ann 0 – 0 Jo & Bob" && teams.names.join() === "Kim & Ann/Team A,Jo & Bob/Team B" && !teams.scroll, teams);
  if (OUT) await page.screenshot({ path: path.join(OUT, "who_teams.png") });
  await page.evaluate(() => document.querySelector('#scoreboard .team-card[data-team-id="A"] .btn-ball.plus').click());
  await sleep(900);
  s = await st();
  const r1 = { teamA: s.teamWins.A, mvp: s.teamMvpWins, header: await page.evaluate(() => document.querySelector("#scoreboard .teams-header").textContent) };
  await page.evaluate(() => [...document.querySelectorAll('#scoreboard .team-card[data-team-id="A"] .team-credit-chip')].find((c) => /Kim/.test(c.textContent)).click());
  await sleep(300);
  await page.evaluate(() => document.querySelector('#scoreboard .team-card[data-team-id="A"] .btn-ball.plus').click());
  await sleep(900);
  s = await st();
  check("...Team A's + with nobody picked: Team A's rack, nobody credited; with Kim picked: credited to Kim", r1.teamA === 1 && Object.keys(r1.mvp || {}).length === 0 && /Kim & Ann 1 – 0 Jo & Bob/.test(r1.header) && s.teamWins.A === 2 && s.teamMvpWins[s.players.find((p) => p.name === "Kim").id] === 1 && Object.keys(s.teamMvpWins).length === 1, { r1, wins: s.teamWins, mvp: s.teamMvpWins });

  // ---- Teams (race to 7, Winner Stays on from before) -> Individual ----
  // (2026-11-15: "why are the player not swapping automatically anymore" - all four stayed at the
  // table with nobody in line, and the teams' race became each pairing's race to 7)
  const teamsBoard = JSON.parse(board({ game: { mode: "teams", queueEnabled: true }, race: 7 }));
  teamsBoard.players.forEach((p, i) => { p.teamId = i % 2 ? "B" : "A"; });
  await open(JSON.stringify(teamsBoard));
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click('input[name="gs-mode"][value="individual"]');
  await page.click("#btn-game-sheet-apply");
  await sleep(800);
  s = await st();
  const toInd = { seated: await seated(), line: await line(), race: s.raceToWinsTarget, banner: await banner(), status: await page.evaluate(() => document.getElementById("board-status").textContent) };
  check("Teams (race to 7, Winner Stays on) to Individual: two at the table, the others in line, the race to 7 everyone's", toInd.seated.join() === "Kim,Jo" && /Next up: Ann \(then Bob\)/.test(toInd.line) && toInd.race === 7 && /two at a time/.test(toInd.banner) && /Race to 7/.test(toInd.status), toInd);
  await plusFor("Kim");
  const swapped = { seated: await seated(), line: await line() };
  check("...a rack: Jo to the back of the line, Ann in", swapped.seated.join() === "Kim,Ann" && /Next up: Bob \(then Jo\)/.test(swapped.line), swapped);

  // ---- a player's number tapped in a rack game wins the rack (2026-11-15: "clicking a player number should
  // make the player win the rack"); a points game keeps picking the player ----
  await open(board());
  await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].find((c) => /Jo/.test(c.querySelector(".player-name").textContent)).querySelector(".stat-value").click());
  await sleep(900);
  s = await st();
  const tapped = { winner: s.gameHistory[0] && s.gameHistory[0].winnerNames, seated: await seated() };
  check("8-Ball: tapping Jo's number wins Jo the rack (Kim to the line, Ann in)", JSON.stringify(tapped.winner) === '["Jo"]' && tapped.seated.join() === "Jo,Ann", tapped);
  const twoUp = JSON.parse(board({ game: { gameType: "straight", target: 25, unit: "points" } }));
  twoUp.players.slice(2).forEach((p) => { p.playing = false; });
  await open(JSON.stringify(twoUp));
  await page.evaluate(() => document.querySelectorAll("#scoreboard .player-panel .stat-value")[1].click());
  await sleep(500);
  s = await st();
  const points = { balls: s.players.map((p) => p.balls || 0), selected: await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel.is-keypad-selected .player-name")].map((n) => n.textContent.replace(/\d.*$/, "").trim())) };
  check("...Straight Pool: tapping Jo's number picks Jo, no point", points.balls.every((b) => b === 0) && points.selected.join() === "Jo", points);

  // ---- Straight Pool with four Playing (2026-11-22: "I need to be able to play multiple players when I play
  // straight pool"): everyone at the table, each on their own count - Winner Stays stays off; the first to the
  // target wins against the three others; Winner Stays by hand still seats two ----
  await open(board({ game: { gameType: "straight", target: 3, unit: "points" } }));
  s = await st();
  const allUp = { queue: !!s.currentGame.queueEnabled, seated: await seated(), banner: await banner(), line: await line() };
  check("Straight Pool with four Playing: all four at the table, Winner Stays not turned on, no \"two at a time\"", allUp.queue === false && allUp.seated.join() === "Kim,Jo,Ann,Bob" && !/two at a time/.test(allUp.banner) && !/Next up/.test(allUp.line), allUp);
  if (OUT) await page.screenshot({ path: path.join(OUT, "who_straight_four.png") });
  const sr0 = await ratings();
  await plusFor("Jo");
  await plusFor("Ann");
  await plusFor("Ann");
  s = await st();
  const sMid = { balls: s.players.map((p) => p.balls || 0), games: s.gameHistory.length };
  await plusFor("Ann");
  await sleep(600);
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);
  s = await st();
  const sr1 = await ratings(), sg = s.gameHistory[0] || {};
  const sWon = { mid: sMid, winner: sg.winnerNames, losers: (sg.opponentNames || []).slice().sort(), scores: sg.scores, seated: await seated(), queue: !!s.currentGame.queueEnabled, up: sr1.Ann > (sr0.Ann || 400), down: ["Kim", "Jo", "Bob"].map((n) => sr1[n] < (sr0[n] || 400)) };
  check("...each on their own count (Jo 1, Ann 2, nobody else); Ann first to 3: Ann wins against Kim, Jo and Bob - her rating up, theirs down, all four still at the table", sMid.balls.join() === "0,1,2,0" && sMid.games === 0 && JSON.stringify(sWon.winner) === '["Ann"]' && sWon.losers.join() === "Bob,Jo,Kim" && sWon.up && sWon.down.every(Boolean) && sWon.seated.join() === "Kim,Jo,Ann,Bob" && sWon.queue === false, sWon);
  await page.evaluate(() => document.getElementById("board-winner-stays-checkbox").click());
  await sleep(700);
  s = await st();
  const byHand = { queue: !!s.currentGame.queueEnabled, seated: await seated(), line: await line() };
  check("...🎱 Winner Stays ticked by hand: two at the table, the others in line - still there for who wants it", byHand.queue === true && byHand.seated.length === 2 && /Next up/.test(byHand.line), byHand);
  await page.evaluate(() => document.getElementById("board-winner-stays-checkbox").click());
  await sleep(700);
  s = await st();
  const offAgain = { queue: !!s.currentGame.queueEnabled, seated: (await seated()).slice().sort(), banner: await banner() };
  check("...and unticked: everyone back at the table, the banner says who", offAgain.queue === false && offAgain.seated.join() === "Ann,Bob,Jo,Kim" && /everyone is back at the table/.test(offAgain.banner), offAgain);

  // ---- ▶️ New game with Winner Stays on: it stays on (2026-11-15: "the loser is still staying, we
  // don't have the player rotation working anymore" - New game had turned it off) ----
  const three = JSON.parse(board({ game: { queueEnabled: true } }));
  three.players = [{ id: "l", name: "Luc", playing: true, balls: 0 }, { id: "b", name: "Bob", playing: false, balls: 0 }, { id: "c", name: "Chris", playing: true, balls: 0 }];
  await open(JSON.stringify(three));
  await page.click("#btn-board-menu");
  await sleep(300);
  await page.click('[data-menu-key="menu.newGame"]');
  await sleep(400);
  await page.type("#quick-game-player1", "Bob");
  await page.type("#quick-game-player2", "Chris");
  await page.evaluate(() => { document.getElementById("quick-game-race-raceto").click(); const i = document.getElementById("quick-game-race-to"); i.value = "7"; i.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click("#btn-quick-game-start");
  await sleep(900);
  s = await st();
  const ng = { seated: await seated(), line: await line(), queue: s.currentGame.queueEnabled, race: s.raceToWinsTarget, banner: await banner() };
  check("▶️ New game (Bob v Chris, race to 7) with Winner Stays on: still on - Bob v Chris, Luc next (\"" + ng.line + "\")", ng.queue === true && ng.seated.join() === "Bob,Chris" && /Next up: Luc/.test(ng.line) && ng.race === 7 && /Winner Stays is on - Bob v Chris, Luc is next/.test(ng.banner), ng);
  await page.keyboard.press("Escape");
  await plusFor("Bob");
  const ngRack = { seated: await seated(), line: await line() };
  check("...Bob wins a rack: Chris to the line, Luc in", ngRack.seated.slice().sort().join() === "Bob,Luc" && /Next up: Chris/.test(ngRack.line), ngRack);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
