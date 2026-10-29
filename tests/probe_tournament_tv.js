// Tournament screens fit for a TV (P20), at 1920x1080:
// - the player picker: tonight's roster checked from the start (a past player not), 🔎 search,
//   ➕ walk-in added and checked; no Challonge line when Challonge isn't set up; Swiss shows a Rounds
//   box, round robin doesn't;
// - the live match board like the casual one: the names, the match score giant (at least 120 px)
//   with "/ 3", "Race to 3" on its banner, one + per player in a one-rack game; 📺 TV fills the
//   screen (the score bigger still), Escape leaves; Abandon is in ⋯ More, not on the page;
// - round robin: a circle of 3-1 wins ends level after head-to-head, rack difference and racks
//   won - the standings show "=1" three times, every finished card its score, nobody struck out
//   or crowned; a playoff is asked for; played, Ben takes it and the placings read 1st Ben, 2nd Ann,
//   3rd Cat; 📺 Full-screen bracket;
// - no page errors.
// Its own file server on 4275.
// usage: node tests/probe_tournament_tv.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4275, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
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
  await page.setViewport({ width: 1920, height: 1080 });
  const tap = async (sel) => { await page.click(sel); await sleep(300); };
  const T = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
  const closePopups = () => page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      const o = [...document.querySelectorAll("[id$='-overlay']")].find((x) => !x.classList.contains("hidden") && getComputedStyle(x).display !== "none" && x.getClientRects().length);
      if (!o) return;
      const b = [...o.querySelectorAll("button.btn-primary")].find((x) => x.getClientRects().length);
      if (b) b.click(); else return;
    }
  });
  // plays the next match: Play on its card, then Enter score
  const playMatch = async (winner, loser, w, l) => {
    await page.evaluate((a, b) => {
      const card = [...document.querySelectorAll(".tournament-match-card")].find((c) => { const s = [...c.querySelectorAll(".tournament-match-side")].map((x) => x.textContent); return s.some((x) => x.startsWith(a)) && s.some((x) => x.startsWith(b)) && c.querySelector(".tournament-play-btn"); });
      if (card) card.querySelector(".tournament-play-btn").click();
    }, winner, loser);
    await sleep(500);
    await page.evaluate(() => document.querySelector(".tournament-enter-score").click());
    await page.waitForSelector("#tournament-score-a", { timeout: 3000 });
    await page.evaluate((winner, w, l) => {
      const label = document.getElementById("tournament-score-a").closest("label") || document.getElementById("tournament-score-a").parentElement;
      const aIsWinner = label.textContent.indexOf(winner) !== -1;
      document.getElementById("tournament-score-a").value = aIsWinner ? w : l;
      document.getElementById("tournament-score-b").value = aIsWinner ? l : w;
      document.getElementById("btn-tournament-score-save").click();
    }, winner, w, l);
    await sleep(700);
    await closePopups();
    await sleep(300);
  };

  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
    localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
    localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: ["Ann", "Ben", "Cat"].map((n, i) => ({ id: "p" + i, name: n, playing: i < 2, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [{ ts: new Date(Date.now() - 86400000 * 3).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: ["Old Timer"], winnerIds: ["x"], opponentNames: ["Ann"], isTeam: false, summary: "Old Timer won 8-Ball" }], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
  });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  await page.evaluate(() => document.getElementById("btn-open-tournament").click());
  await sleep(500);
  const status = await page.evaluate(() => { const s = document.getElementById("tournament-challonge-status-line"); return { text: s.textContent, shown: s.getClientRects().length > 0 }; });
  check("no Challonge line when Challonge isn't set up", !status.shown && status.text === "", status);
  await tap('input[name="tournament-format"][value="swiss"]');
  const swissRounds = await page.evaluate(() => document.getElementById("tournament-swiss-rounds-row").getClientRects().length > 0);
  await tap('input[name="tournament-format"][value="roundrobin"]');
  const rrRounds = await page.evaluate(() => document.getElementById("tournament-swiss-rounds-row").getClientRects().length > 0);
  check("Swiss shows a Rounds box, round robin doesn't", swissRounds && !rrRounds, { swissRounds, rrRounds });
  await tap("#btn-tournament-setup-next");
  await page.evaluate(() => { const i = document.getElementById("tournament-race-to"); i.value = 3; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
  await tap("#btn-tournament-setup-next");
  const checks = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#tournament-player-checklist .tournament-player-check-row")].map((li) => { const c = li.querySelector("input[type=checkbox]"); return [c.value, { checked: c.checked, shown: !li.classList.contains("hidden") }]; })));
  const c1 = await checks();
  check("the picker: tonight's roster checked from the start (Ann, Ben and Cat - seated or not), the past player (Old Timer) not", c1.Ann && c1.Ann.checked && c1.Ben.checked && c1.Cat.checked && c1["Old Timer"] && !c1["Old Timer"].checked, c1);
  await page.type("#tournament-player-search", "ca");
  await sleep(200);
  const c2 = await checks();
  check("...🔎 \"ca\": only Cat shown", Object.keys(c2).filter((k) => c2[k].shown).join() === "Cat", c2);
  await page.evaluate(() => { const s = document.getElementById("tournament-player-search"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.type("#tournament-walkin-name", "Eve");
  await tap("#btn-tournament-walkin");
  const c3 = await checks();
  const eveOnRoster = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.some((p) => p.name === "Eve"));
  check("...➕ walk-in \"Eve\": on tonight's roster and checked", c3.Eve && c3.Eve.checked && eveOnRoster, { c3, eveOnRoster });
  await page.evaluate(() => { const c = [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].find((x) => x.value === "Eve"); c.click(); });
  await tap("#btn-tournament-setup-next");
  await tap("#btn-tournament-start");
  await sleep(800);

  // ---- the live board ----
  const top = await page.evaluate(() => ({ abandon: (() => { const b = document.getElementById("btn-tournament-abandon"); return b && b.getClientRects().length > 0; })(), more: document.getElementById("btn-tournament-more").getClientRects().length > 0 }));
  await page.click("#btn-tournament-more");
  await sleep(300);
  const menu = await page.evaluate(() => { const b = document.getElementById("btn-tournament-menu-abandon"); return b ? { text: b.textContent, danger: b.classList.contains("btn-danger") } : null; });
  await page.keyboard.press("Escape");
  await sleep(300);
  check("Abandon isn't on the page while it runs - it's in ⋯ More (red)", !top.abandon && top.more && menu && menu.danger && /Abandon/.test(menu.text), { top, menu });
  await page.evaluate(() => [...document.querySelectorAll(".tournament-play-btn")][0].click());
  await sleep(600);
  await page.evaluate(() => document.querySelector("#tournament-current-match-panel .btn-ball.plus").click());
  await sleep(500);
  const board = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("#tournament-current-match-panel .tournament-side-panel")];
    return {
      banner: (document.querySelector(".tournament-now-playing") || {}).textContent,
      sides: panels.map((p) => ({ name: p.querySelector(".player-name").textContent, score: p.querySelector(".tournament-match-score").textContent.trim(), px: parseFloat(getComputedStyle(p.querySelector(".tournament-match-score")).fontSize), plus: p.querySelectorAll(".btn-ball.plus").length, minus: p.querySelectorAll(".btn-ball.minus").length }))
    };
  });
  check("the live board at 1920x1080: names, the match score giant (" + (board.sides[0] || {}).px + " px ≥ 120) with \"/ 3\", \"Race to 3\" on its banner, one + per player and no −", board.sides.length === 2 && board.sides.every((s) => s.px >= 120 && / \/ 3/.test(s.score) && s.plus === 1 && s.minus === 0) && /Race to 3/.test(board.banner) && /^1 \/ 3/.test(board.sides[0].score), board);
  if (OUT) await page.screenshot({ path: path.join(OUT, "tournament_board_1920.png") });
  await page.evaluate(() => document.querySelector(".tournament-tv-btn").click());
  await sleep(500);
  const tv = await page.evaluate(() => { const p = document.getElementById("tournament-current-match-panel"); const r = p.getBoundingClientRect(); return { mode: document.body.getAttribute("data-tournament-tv"), w: r.width, h: r.height, px: parseFloat(getComputedStyle(document.querySelector(".tournament-match-score")).fontSize) }; });
  if (OUT) await page.screenshot({ path: path.join(OUT, "tournament_tv_1920.png") });
  await page.keyboard.press("Escape");
  await sleep(400);
  const tvOff = await page.evaluate(() => document.body.getAttribute("data-tournament-tv"));
  check("📺 TV: the live match fills the screen (" + Math.round(tv.w) + "x" + Math.round(tv.h) + "), the score " + tv.px + " px; Escape leaves", tv.mode === "match" && tv.w >= 1900 && tv.h >= 1060 && tv.px >= 200 && tvOff === null, { tv, tvOff });
  // undo that rack (back to 0-0), then the scores entered
  await page.evaluate(() => document.querySelector(".tournament-undo-rack").click());
  await sleep(400);
  await page.evaluate(() => document.querySelector(".tournament-enter-score").click());
  await page.waitForSelector("#tournament-score-a", { timeout: 3000 });
  const firstPair = await page.evaluate(() => [document.getElementById("tournament-score-a").parentElement.textContent, document.getElementById("tournament-score-b").parentElement.textContent]);
  await page.evaluate(() => document.querySelector("#tournament-score-overlay [data-dialog-close]").click());
  await sleep(300);
  // the circle: Ann beats Ben 3-1, Ben beats Cat 3-1, Cat beats Ann 3-1
  const circle = { "Ann|Ben": "Ann", "Ben|Cat": "Ben", "Ann|Cat": "Cat" };
  for (let i = 0; i < 3; i++) {
    const t = await T();
    const live = t.activeMatches[0] && t.matches.find((m) => m.id === t.activeMatches[0].matchId);
    const next = live || t.matches.find((m) => !m.winner);
    const k = [next.a, next.b].sort().join("|");
    const w = circle[k], l = next.a === w ? next.b : next.a;
    if (live) {
      await page.evaluate(() => document.querySelector(".tournament-enter-score").click());
      await page.waitForSelector("#tournament-score-a", { timeout: 3000 });
      await page.evaluate((a, w) => { document.getElementById("tournament-score-a").value = a === w ? 3 : 1; document.getElementById("tournament-score-b").value = a === w ? 1 : 3; document.getElementById("btn-tournament-score-save").click(); }, next.a, w);
      await sleep(700);
      await closePopups();
      await sleep(300);
    } else {
      await playMatch(w, l, 3, 1);
    }
  }
  await sleep(500);
  const rr = await page.evaluate(() => ({
    standings: [...document.querySelectorAll("#tournament-rr-standings .tournament-rr-standings-row")].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
    scores: document.querySelectorAll("#tournament-rr-matches .tournament-match-side-score").length,
    losers: document.querySelectorAll("#tournament-rr-matches .is-loser").length,
    crowns: [...document.querySelectorAll("#tournament-rr-matches .tournament-match-side")].filter((s) => /👑/.test(s.textContent)).length,
    prompt: !!document.getElementById("btn-tournament-playoff"),
    ask: (document.querySelector(".tournament-playoff-prompt p") || {}).textContent
  }));
  const t3 = await T();
  check("round robin, a circle of 3-1 wins: \"=1\" three times (level after head-to-head, rack difference, racks won), every finished card's score, nobody struck out or crowned", rr.standings.length === 3 && rr.standings.every((s) => /^=1/.test(s) && /1–1/.test(s)) && rr.scores === 6 && rr.losers === 0 && rr.crowns === 0, rr);
  check("...no champion yet - a playoff is asked for (\"" + (rr.ask || "").slice(0, 60) + "...\")", rr.prompt && !t3.champion && (t3.playoffPending || []).length === 3, { prompt: rr.prompt, champion: t3.champion, pending: t3.playoffPending });
  if (OUT) await page.screenshot({ path: path.join(OUT, "tournament_playoff_ask.png") });
  await page.click("#btn-tournament-playoff");
  await sleep(600);
  // Ben wins both of his; Ann beats Cat
  const po = { "Ann|Ben": "Ben", "Ben|Cat": "Ben", "Ann|Cat": "Ann" };
  for (let i = 0; i < 3; i++) {
    const t = await T();
    const live = t.activeMatches[0] && t.playoff.matches.find((m) => m.id === t.activeMatches[0].matchId);
    const next = live || t.playoff.matches.find((m) => !m.winner);
    if (!next) break;
    const w = po[[next.a, next.b].sort().join("|")];
    if (!live) {
      await page.evaluate((a, b) => {
        const card = [...document.querySelectorAll(".tournament-playoff-col .tournament-match-card")].find((c) => { const s = [...c.querySelectorAll(".tournament-match-side")].map((x) => x.textContent); return s.some((x) => x.startsWith(a)) && s.some((x) => x.startsWith(b)); });
        if (card && card.querySelector(".tournament-play-btn")) card.querySelector(".tournament-play-btn").click();
      }, next.a, next.b);
      await sleep(500);
    }
    await page.evaluate(() => document.querySelector(".tournament-enter-score").click());
    await page.waitForSelector("#tournament-score-a", { timeout: 3000 });
    await page.evaluate((a, w) => { document.getElementById("tournament-score-a").value = a === w ? 3 : 0; document.getElementById("tournament-score-b").value = a === w ? 0 : 3; document.getElementById("btn-tournament-score-save").click(); }, next.a, w);
    await sleep(700);
    await closePopups();
    await sleep(300);
  }
  await sleep(500);
  const done = await page.evaluate(() => ({ placings: [...document.querySelectorAll("#tournament-placings li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()), banner: document.getElementById("tournament-champion-banner").textContent, standings: [...document.querySelectorAll("#tournament-rr-standings .tournament-rr-standings-place")].map((x) => x.textContent) }));
  const t4 = await T();
  const results = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournamentResults.v1") || "[]"));
  check("...the playoff: Ben takes it - placings 1st Ben, 2nd Ann, 3rd Cat (the standings 1, 2, 3 too), stored with the result", t4.champion === "Ben" && done.placings.join("|") === "1st Ben|2nd Ann|3rd Cat" && done.standings.join() === "1,2,3" && results[0] && JSON.stringify(results[0].placings) === JSON.stringify([{ place: 1, names: ["Ben"] }, { place: 2, names: ["Ann"] }, { place: 3, names: ["Cat"] }]), { champion: t4.champion, done, stored: results[0] && results[0].placings });
  await page.evaluate(() => document.getElementById("btn-tournament-bracket-tv").click());
  await sleep(500);
  const btv = await page.evaluate(() => { const r = document.getElementById("tournament-active-panel").getBoundingClientRect(); return { mode: document.body.getAttribute("data-tournament-tv"), w: r.width, h: r.height, standings: document.getElementById("tournament-rr-standings").getClientRects().length > 0 }; });
  if (OUT) await page.screenshot({ path: path.join(OUT, "tournament_bracket_tv_1920.png") });
  check("📺 Full-screen bracket: the standings and matches fill the screen", btv.mode === "bracket" && btv.w >= 1900 && btv.h >= 1060 && btv.standings, btv);
  await page.keyboard.press("Escape");
  await sleep(300);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
