// Breaks, fouls, safeties and innings on the board (P24), an iPad at 1180x820:
// - ☰ 🎱 Game › "Track breaks, fouls & innings": the event bar under the board - who's at the
//   table, ⤵ Miss, 🛡️ Safety, ⚠️ Foul −1, Break foul −2, ⋯, and +2 / +5 / +10 in 14.1;
// - 14.1: Kim +5 +5, Miss; Jo plays safe; Kim +5: Kim's high run is 10 (not 15), innings Kim 2 /
//   Jo 1, Jo 1 safety;
// - Jo's fouls on three turns in a row: ⚠️ 2 fouls on Jo's card after two, and the third costs 16
//   (−1, −1, −16: Jo −18) and re-racks with Jo breaking;
// - 9-Ball, the loser breaks: Kim wins a rack - the banner offers the rack's tags (Break & run,
//   Golden break); tapped, the game keeps it; "🎱 Jo breaks" next; ⋯ › Jo concedes credits Kim;
// - 15-ball rotation, three players at 48-40-30: +2 for the leader - 50-40-30 ends the frame (a
//   fixed 61 never would);
// - Kim's player page: innings, high run, break & run, racks won on the break, safeties;
// - no page errors.
// Its own file server on 4279.
// usage: node tests/probe_events.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4279, BASE = "http://localhost:" + PORT + "/";
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
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setUserAgent(IPAD_UA);
  await page.setViewport({ width: 1180, height: 820, hasTouch: true });
  const S = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
  const seed = async (players, game, extra) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((players, game, extra) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(Object.assign({ players: players.map((p, i) => ({ id: "p" + i, name: p[0], playing: true, balls: p[1] || 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: game, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }, extra || {})));
    }, players, game, extra || {});
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
  };
  const bar = () => page.evaluate(() => { const b = document.getElementById("event-bar"); return { shown: !b.classList.contains("hidden"), who: (b.querySelector(".event-bar-who") || {}).textContent || "", buttons: [...b.querySelectorAll(".event-btn")].map((x) => x.textContent), chips: [...b.querySelectorAll(".event-chip")].map((x) => x.textContent) }; });
  const press = async (cls) => { await page.evaluate((cls) => document.querySelector("#event-bar ." + cls).click(), cls); await sleep(350); };
  const chip = async (n) => { await page.evaluate((n) => [...document.querySelectorAll("#event-bar .event-chip")].find((c) => c.textContent === "+" + n).click(), n); await sleep(350); };
  const score = async (name) => (await S()).players.find((p) => p.name === name).balls;

  // ---- 14.1, switched on in the Game sheet ----
  await seed([["Kim"], ["Jo"]], { gameType: "straight", target: 100, unit: "points", mode: "individual" });
  await page.click("#btn-board-game");
  await sleep(300);
  await page.click("#gs-track-events");
  await sleep(150);
  const breakRow = await page.evaluate(() => !document.getElementById("gs-break-rule-row").classList.contains("hidden"));
  await page.click("#btn-game-sheet-apply");
  await sleep(600);
  let b = await bar();
  check("☰ 🎱 Game › Track breaks, fouls & innings (who breaks: shown): the event bar - Kim at the table, Miss, Safety, Foul −1, Break foul −2, ⋯, +2 +5 +10", breakRow && b.shown && /^Kim at the table/.test(b.who) && b.buttons.length === 5 && /Foul −1/.test(b.buttons[2]) && /Break foul/.test(b.buttons[3]) && b.chips.join() === "+2,+5,+10", b);
  await chip(5); await chip(5);
  await press("event-miss");
  b = await bar();
  const joUp = /^Jo at the table/.test(b.who);
  await press("event-safety");
  await chip(5);
  let s = await S();
  if (OUT) await page.screenshot({ path: path.join(OUT, "event_bar_straight.png") });
  check("14.1: Kim +5 +5, Miss (Jo up); Jo safe; Kim +5 - Kim's high run 10 (not 15), innings Kim 2 / Jo 1, Jo 1 safety", joUp && s.turns.best.Kim === 10 && s.turns.run === 5 && s.turns.innings.Kim === 2 && s.turns.innings.Jo === 1 && s.turns.safeties.Jo === 1 && (await score("Kim")) === 15, s.turns);
  // Jo's three fouls on three turns
  await press("event-miss");                 // Kim -> Jo
  await press("event-foul");                 // Jo foul 1 -> Kim
  await press("event-miss");                 // Kim -> Jo
  await press("event-foul");                 // Jo foul 2 -> Kim
  const warn = await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].map((p) => ({ name: p.querySelector(".player-name").firstChild.textContent, tag: (p.querySelector(".card-foul-tag") || {}).textContent || "" })));
  if (OUT) await page.screenshot({ path: path.join(OUT, "event_bar_two_fouls.png") });
  await press("event-miss");                 // Kim -> Jo
  await press("event-foul");                 // Jo foul 3
  s = await S();
  const notice = await page.evaluate(() => [...document.querySelectorAll("#win-banner .win-banner-notice")].map((n) => n.textContent).join(" | "));
  check("Jo's fouls on three turns in a row: ⚠️ 2 fouls on Jo's card after two; the third costs 16 (Jo −18) and re-racks, Jo breaking", warn.find((w) => w.name === "Jo").tag === "⚠️ 2 fouls" && !warn.find((w) => w.name === "Kim").tag && (await score("Jo")) === -18 && /re-rack/i.test(notice) && s.currentGame.breakerName === "Jo" && (s.turns.foulsInRow.Jo || 0) === 0, { warn, jo: await score("Jo"), notice, breaker: s.currentGame.breakerName });

  // ---- 9-Ball, the loser breaks ----
  await seed([["Kim"], ["Jo"]], { gameType: "9ball", target: 1, unit: "rack", mode: "individual", trackEvents: true, breakRule: "loser", breakerName: "Kim" });
  b = await bar();
  check("9-Ball: no chips (a rack game), \"🎱 Kim breaks\" on the board", b.shown && !b.chips.length && /Kim breaks/.test(await page.evaluate(() => document.getElementById("board-status").textContent)), b);
  await page.evaluate(() => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((x) => x.getAttribute("aria-label").endsWith(" Kim")).click());
  await sleep(900);
  const tags = await page.evaluate(() => [...document.querySelectorAll("#win-banner .win-banner-tag")].map((t) => t.dataset.tag));
  if (OUT) await page.screenshot({ path: path.join(OUT, "event_tags_banner.png") });
  await page.evaluate(() => document.querySelector('#win-banner .win-banner-tag[data-tag="breakAndRun"]').click());
  await sleep(400);
  s = await S();
  const status9 = await page.evaluate(() => document.getElementById("board-status").textContent);
  check("Kim wins a rack: the banner offers Break & run and Golden break; tapped, the game keeps it; the loser (Jo) breaks next", tags.join() === "breakAndRun,goldenBreak" && JSON.stringify(s.gameHistory[0].tags) === '["breakAndRun"]' && s.gameHistory[0].breakerName === "Kim" && /Jo breaks/.test(status9), { tags, g: s.gameHistory[0], status9 });
  await page.evaluate(() => { const x = document.querySelector("#win-banner .win-banner-close"); if (x) x.click(); });
  await press("event-more");
  await page.evaluate(() => [...document.querySelectorAll("#tournament-chooser-overlay button")].find((x) => /Jo concedes/.test(x.textContent)).click());
  await sleep(600);
  s = await S();
  check("⋯ › Jo concedes: the rack to Kim, tagged conceded", s.gameHistory.length === 2 && s.gameHistory[0].winnerNames[0] === "Kim" && JSON.stringify(s.gameHistory[0].tags) === '["conceded"]', s.gameHistory[0]);

  // ---- 15-ball rotation, three players ----
  await seed([["Kim", 48], ["Jo", 40], ["Ann", 30]], { gameType: "15ballrotation", target: 61, unit: "points", mode: "individual", trackEvents: true, breakerName: "Kim" });
  b = await bar();
  await page.evaluate(() => { localStorage.setItem("x", "1"); });
  await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel")].find((p) => p.querySelector(".player-name").firstChild.textContent === "Kim").querySelector(".stat-value").click());
  await sleep(300);
  await chip(2);
  await sleep(600);
  s = await S();
  if (OUT) await page.screenshot({ path: path.join(OUT, "event_bar_rotation.png") });
  check("15-ball rotation, three players at 48-40-30: +2 for Kim - 50-40-30 ends the frame (chips 1-15)", b.chips.length === 15 && s.gameHistory.length === 1 && s.gameHistory[0].winnerNames[0] === "Kim" && JSON.stringify(s.gameHistory[0].scores) === JSON.stringify({ Kim: 50, Jo: 40, Ann: 30 }), { chips: b.chips.length, g: s.gameHistory[0] });

  // ---- the player page ----
  await seed([["Kim"], ["Jo"]], { gameType: "9ball", target: 1, unit: "rack", mode: "individual", trackEvents: true, breakRule: "winner", breakerName: "Kim" }, {
    gameHistory: [
      { ts: new Date(Date.now() - 600000).toISOString(), gameType: "9ball", gameLabel: "9-Ball", target: 1, unit: "rack", winnerNames: ["Kim"], winnerIds: ["p0"], opponentNames: ["Jo"], isTeam: false, summary: "Kim won 9-Ball", breakerName: "Kim", tags: ["breakAndRun"], turns: { innings: { Kim: 1, Jo: 0 }, best: { Kim: 9 }, safeties: {}, fouls: {} } },
      { ts: new Date(Date.now() - 1200000).toISOString(), gameType: "9ball", gameLabel: "9-Ball", target: 1, unit: "rack", winnerNames: ["Jo"], winnerIds: ["p1"], opponentNames: ["Kim"], isTeam: false, summary: "Jo won 9-Ball", breakerName: "Kim", tags: null, turns: { innings: { Kim: 3, Jo: 3 }, best: { Kim: 4, Jo: 6 }, safeties: { Kim: 2 }, fouls: {} } }
    ]
  });
  await page.evaluate(() => document.querySelector("#scoreboard .player-name").click());
  await sleep(200);
  await page.evaluate(() => document.querySelector(".player-link-icon") && document.querySelector(".player-link-icon").click());
  await sleep(800);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#player-page-synopsis-body *")].map((e) => e.textContent).join(" | "));
  check("Kim's player page: innings 4, high run 9, break & run 50% (1/2), racks won on the break 50% (1/2), safeties 2", /Innings[^|]*4/.test(rows) && /High run[^|]*9/.test(rows) && /Break & run[^|]*50% \(1\/2\)/.test(rows) && /Racks won on the break[^|]*50% \(1\/2\)/.test(rows) && /Safeties[^|]*2/.test(rows), rows.slice(0, 900));

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
