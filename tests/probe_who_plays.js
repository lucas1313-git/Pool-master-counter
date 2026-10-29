// Who's playing (P15), at 1180x820:
// - 8-Ball with four marked Playing and Winner Stays off: Winner Stays goes on by itself (the banner
//   says so), two at the table, the others in line; a rack gives a result to the two seated only -
//   the others' ratings don't move;
// - Winner Stays: no race (one rack each), the board shows "🔥 Kim: 3 in a row" and "Next up: …",
//   seat changes in the banner (no popup), never "on the hill";
// - "most wins in a row" (🎱 Game): 2 - Kim's second win in a row sends Kim to the line too;
// - a race for each pairing (🎱 Game: Winner Stays + Race to 2): Kim beats Jo 2-0, Jo goes, the
//   new pairing starts at 0-0, the session goes on (no race-won screen);
// - the Setup Wizard: two players added there are Playing - it reaches Start without the Standby
//   warning;
// - Teams (four playing 15 Ball Rotation, then Teams): split 2/2 (Kim, Ann - Jo, Bob); each team
//   one card with one + and one number, its players big ("Kim & Ann", "Team A" small), "Kim & Ann
//   0 – 0 Jo & Bob" over them, no member cards, no
//   scrolling at 1180x820; the team's + with nobody picked: the team's rack, nobody credited;
//   Kim picked: Kim credited;
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

  // ---- a race for each pairing ----
  await open(board());
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click('input[name="gs-race"][value="race"]');
  await page.evaluate(() => { const i = document.getElementById("gs-race-to"); i.value = "2"; i.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(100);
  const note = await page.evaluate(() => !document.getElementById("gs-pairing-note").classList.contains("hidden"));
  await page.click("#btn-game-sheet-apply");
  await sleep(700);
  await plusFor("Kim");
  const mid = { seated: await seated(), value: await page.evaluate(() => [...document.querySelectorAll("#scoreboard .stat-value")].map((v) => v.textContent.replace(/\s+/g, " ").trim())) };
  await plusFor("Kim");
  s = await st();
  const pair = { seated: await seated(), value: await page.evaluate(() => [...document.querySelectorAll("#scoreboard .stat-value")].map((v) => v.textContent.replace(/\s+/g, " ").trim())), milestone: await page.evaluate(() => !document.getElementById("milestone-overlay").classList.contains("hidden")), games: s.gameHistory.length, race: s.raceToWinsTarget };
  check("a race for each pairing (Winner Stays + Race to 2, said in the sheet): 1-0 Kim, still Kim v Jo", note && mid.seated.join() === "Kim,Jo" && mid.value[0] === "1 / 2", { note, mid });
  check("...2-0: Jo goes, Ann in, the new pairing at 0-0 - and the session goes on (no race-won screen)", pair.seated.join() === "Kim,Ann" && pair.value.join("|") === "0 / 2|0 / 2" && !pair.milestone && pair.games === 2 && pair.race === 2, pair);

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

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
