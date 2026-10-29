// A tournament director can fix things (P6):
// - a wrong rack on a live board: "↩ Undo last rack" - the rack, its game and its rating change gone;
// - a finished match's result changed (✏️) after the next round was set up but not played: the
//   right player moves on, the racks and ratings follow the entered score; once that next match is
//   being played, the change is refused, naming it;
// - a walkover (⋯ › "X forfeits"): the other side through, no game, no rating change;
// - a withdrawal mid-event (round robin): their matches go to their opponents, the event finishes;
// - a late player into an open round-1 bye;
// - "⚠️ Reset Tournament" (a new session) leaves a tournament in progress alone;
// - Abandon takes out only this tournament's racks and rating changes - not a casual game meanwhile;
// - a league match's score changed and a match deleted: the standings follow.
// Its own file server on 4252.
// usage: node tests/probe_tournament_fixes.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4252, BASE = "http://localhost:" + PORT + "/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 600) : "")); if (!ok) fails++; }
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(350); };
  const T = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
  const ratings = () => page.evaluate(() => { const r = JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1") || "{}"); const o = {}; Object.keys(r).forEach((k) => { o[k] = { rating: r[k].rating, games: r[k].gamesPlayed }; }); return o; });
  const live = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory.length);
  const modalText = () => page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); return o && !o.classList.contains("hidden") ? document.getElementById("confirm-modal-message").textContent : ""; });
  const okModal = () => page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); });
  const closeWinPopups = () => page.evaluate(() => {
    for (let i = 0; i < 4; i++) {
      const o = [...document.querySelectorAll("[id$='-overlay']")].find((x) => !x.classList.contains("hidden") && x.id !== "confirm-modal-overlay" && getComputedStyle(x).display !== "none" && x.getClientRects().length);
      if (!o) return;
      const b = [...o.querySelectorAll("button.btn-primary")].find((x) => x.getClientRects().length);
      if (b) b.click(); else return;
    }
  });
  const chooser = (re) => page.evaluate((src) => { const re = new RegExp(src); const b = [...document.querySelectorAll("#tournament-chooser-overlay button")].find((x) => re.test(x.textContent)); if (b) { b.click(); return true; } return false; }, re.source);
  const enterScore = async (a, b) => {
    await page.waitForSelector("#tournament-score-a", { timeout: 3000 });
    await page.evaluate((a, b) => { document.getElementById("tournament-score-a").value = a; document.getElementById("tournament-score-b").value = b; document.getElementById("btn-tournament-score-save").click(); }, a, b);
    await sleep(600);
  };
  // a match card's ⋯ / ✏️ by its two players
  const cardTools = (a, b) => page.evaluate((a, b) => {
    const card = [...document.querySelectorAll(".tournament-match-card")].find((c) => { const s = [...c.querySelectorAll(".tournament-match-side")].map((x) => x.textContent); return s.some((x) => x.includes(a)) && s.some((x) => x.includes(b)); });
    const btn = card && card.querySelector(".tournament-match-tools-btn");
    if (btn) btn.click();
    return !!btn;
  }, a, b);
  async function start(format, players, raceTo, extraState) {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((players, extra) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(Object.assign({ players: players.map((n, i) => ({ id: "p" + i, name: n, playing: false, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }, extra || {})));
    }, players, extraState || null);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(700);
    if (!format) return;
    await page.evaluate(() => document.getElementById("btn-open-tournament").click());
    await sleep(500);
    await tap('input[name="tournament-format"][value="' + format + '"]');
    await tap("#btn-tournament-setup-next");
    await page.evaluate((r) => { const i = document.getElementById("tournament-race-to"); i.value = r; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); }, raceTo);
    await tap("#btn-tournament-setup-next");
    const checked = await page.evaluate(() => [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].filter((c) => c.checked).length);
    if (checked < players.length) await tap("#tournament-select-all-checkbox");
    await tap("#btn-tournament-setup-next");
    // (seeded in the order given, so the draw is known)
    await page.evaluate(() => { const r = document.querySelector('input[name="tournament-seed-mode"][value="manual"]'); if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); } });
    await tap("#btn-tournament-start");
    await sleep(800);
  }
  const plusFor = (name) => page.evaluate((name) => { const panel = [...document.querySelectorAll("#tournament-current-match-panel .player-panel")].find((p) => p.textContent.includes(name)); const b = panel && panel.querySelector(".btn-ball.plus"); if (b) b.click(); return !!b; }, name);

  // ---- 1-2. Single elimination, 4 players, race to 2 ----
  await start("single", ["Ann", "Ben", "Cat", "Dan"], 2);
  let t = await T();
  const first = t.wb[0][0];
  const before = await ratings();
  if (!(t.activeMatches || []).length) await page.evaluate((id) => { const b = [...document.querySelectorAll(".tournament-play-btn, #tournament-ready-list button.btn-primary")].find((x) => x.offsetParent); if (b) b.click(); }, first.id);
  await sleep(500);
  t = await T();
  const act = t.activeMatches[0];
  const m1 = t.wb[0].find((m) => m.id === act.matchId);
  await plusFor(m1.b); // a rack for the wrong player
  await sleep(400);
  const afterWrong = { r: await ratings(), live: await live() };
  await page.evaluate(() => document.querySelector(".tournament-undo-rack").click());
  await sleep(500);
  const afterUndo = { r: await ratings(), live: await live(), active: (await T()).activeMatches[0] };
  // (no record and a record at the start - 400, 0 games - are the same rating)
  const norm = (r) => { const o = {}; Object.keys(r).sort().forEach((k) => { if (!(r[k].rating === 400 && r[k].games === 0)) o[k] = r[k]; }); return o; };
  const same = (x, y) => JSON.stringify(norm(x)) === JSON.stringify(norm(y));
  check("a rack for the wrong player, then ↩ Undo last rack: score back to 0-0, its game gone, ratings exactly as before", afterWrong.live === 1 && afterUndo.live === 0 && afterUndo.active.aWins === 0 && afterUndo.active.bWins === 0 && same(afterUndo.r, before), { afterWrong, afterUndo, before });
  // play m1 out: A wins 2-0
  await plusFor(m1.a); await sleep(300); await plusFor(m1.a); await sleep(500); await closeWinPopups(); await sleep(300);
  t = await T();
  let final = t.wb[1][0];
  check("..." + m1.a + " wins 2-0 and moves to the final", [final.a, final.b].includes(m1.a), [final.a, final.b]);
  // change it to 1-2: the other player moves on instead
  await cardTools(m1.a, m1.b);
  await sleep(300);
  await chooser(/Change the result/);
  await enterScore(1, 2);
  t = await T();
  const m1b = t.wb[0].find((m) => m.id === m1.id);
  final = t.wb[1][0];
  check("✏️ Change the result to 1-2 (the final not started): " + m1.b + " is through instead, 3 racks on record", m1b.winner === m1.b && [final.a, final.b].includes(m1.b) && ![final.a, final.b].includes(m1.a) && m1b.racks.length === 3 && (await live()) === 3, { winner: m1b.winner, final: [final.a, final.b], racks: m1b.racks.length });
  // the other semi by walkover, then start the final: m1 can't change any more
  const m2 = t.wb[0].find((m) => m.id !== m1.id);
  const ratingsBeforeWo = await ratings(), liveBeforeWo = await live();
  // (one table: the only match ready starts by itself - the walkover comes from its board)
  const m2live = (await T()).activeMatches.some((a) => a.matchId === m2.id);
  if (m2live) await page.evaluate(() => document.querySelector(".tournament-walkover").click());
  else await cardTools(m2.a, m2.b);
  await sleep(300);
  await chooser(new RegExp(m2.b + " forfeits"));
  await sleep(600);
  t = await T();
  const m2b = t.wb[0].find((m) => m.id === m2.id);
  check("⋯ › \"" + m2.b + " forfeits\": " + m2.a + " through, marked a walkover, no game and no rating change", m2b.winner === m2.a && m2b.forfeit === m2.b && (await live()) === liveBeforeWo && same(await ratings(), ratingsBeforeWo), { winner: m2b.winner, forfeit: m2b.forfeit });
  await page.evaluate(() => { const b = [...document.querySelectorAll(".tournament-play-btn, #tournament-ready-list button.btn-primary")].find((x) => x.offsetParent && /Play/.test(x.textContent)); if (b) b.click(); });
  await sleep(500);
  await cardTools(m1.a, m1.b);
  await sleep(300);
  await chooser(/Change the result/);
  await enterScore(2, 0);
  const refused = await modalText();
  check("...the final now being played: changing the semi-final is refused, naming the final", /was already played from this result/.test(refused) && /Final/.test(refused), refused);
  await okModal();

  // ---- New Game (Reset Tournament / new session) leaves the tournament alone ----
  await page.evaluate(() => document.getElementById("btn-reset-session-tournament").click());
  await sleep(300);
  await page.evaluate(() => { const s = document.getElementById("btn-save-session-save"); if (s && s.offsetParent) s.click(); else document.getElementById("btn-confirm-modal-ok").click(); });
  await sleep(600);
  t = await T();
  check("\"⚠️ Reset Tournament\" (a new session) with a tournament in progress: the tournament is still there", !!t && !t.champion && t.wb.length === 2, !!t);

  // ---- Abandon: only this tournament's racks and ratings come out ----
  await start("single", ["Ann", "Ben", "Cat", "Dan"], 2, { players: [{ id: "p0", name: "Ann", playing: false, balls: 0 }, { id: "p1", name: "Ben", playing: false, balls: 0 }, { id: "p2", name: "Cat", playing: false, balls: 0 }, { id: "p3", name: "Dan", playing: false, balls: 0 }, { id: "p4", name: "Zed", playing: true, balls: 0 }, { id: "p5", name: "Yan", playing: true, balls: 0 }] });
  t = await T();
  if (!(t.activeMatches || []).length) await page.evaluate(() => { const b = [...document.querySelectorAll(".tournament-play-btn, #tournament-ready-list button.btn-primary")].find((x) => x.offsetParent); if (b) b.click(); });
  await sleep(400);
  t = await T();
  const am = t.wb[0].find((m) => m.id === t.activeMatches[0].matchId);
  await plusFor(am.a); await sleep(400);
  // a casual game meanwhile, on the main board
  await page.evaluate(() => document.getElementById("btn-tournament-back") ? document.getElementById("btn-tournament-back").click() : history.back());
  await sleep(500);
  await page.evaluate(() => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for Zed")).click());
  await sleep(500);
  await closeWinPopups();
  const casual = (await ratings()).Zed;
  await page.evaluate(() => document.getElementById("btn-open-tournament").click());
  await sleep(500);
  // (Abandon lives in ⋯ More while it runs)
  await page.evaluate(() => { document.getElementById("btn-tournament-more").click(); const b = document.getElementById("btn-tournament-menu-abandon"); if (b) b.click(); });
  await sleep(300);
  await okModal();
  await sleep(600);
  const afterAbandon = await ratings();
  const liveLeft = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory.map((g) => g.summary));
  check("Abandon: the tournament's rack and its rating change are gone; the casual game meanwhile (Zed) stays, rating and all", afterAbandon.Zed && afterAbandon.Zed.rating === casual.rating && !(afterAbandon[am.a] && afterAbandon[am.a].games) && liveLeft.length === 1 && /Zed/.test(liveLeft[0]), { afterAbandon, liveLeft, casual });

  // ---- Withdrawal mid-event (round robin) ----
  await start("roundrobin", ["Ann", "Ben", "Cat", "Dan"], 1);
  await page.evaluate(() => document.getElementById("btn-tournament-withdraw").click());
  await sleep(300);
  await chooser(/^Dan$/);
  await sleep(300);
  await okModal();
  await sleep(600);
  t = await T();
  const danMatches = t.matches.filter((m) => m.a === "Dan" || m.b === "Dan");
  check("round robin: Dan withdraws - all 3 of his matches go to his opponents as walkovers", danMatches.length === 3 && danMatches.every((m) => m.winner && m.winner !== "Dan" && m.forfeit === "Dan"), danMatches.map((m) => [m.a, m.b, m.winner, m.forfeit]));
  for (let i = 0; i < 12; i++) {
    const did = await page.evaluate(() => { const b = [...document.querySelectorAll(".btn-ball.plus")].find((x) => x.offsetParent); if (b) { b.click(); return "plus"; } const p = [...document.querySelectorAll(".tournament-play-btn")].find((x) => x.offsetParent); if (p) { p.click(); return "play"; } return null; });
    if (!did) break;
    await sleep(450); await closeWinPopups(); await sleep(200);
  }
  t = await T();
  check("...the others play on and the round robin finishes", !!t.champion, { champion: t.champion });

  // ---- A late player into a bye ----
  await start("single", ["Ann", "Ben", "Cat"], 1);
  await page.evaluate(() => document.getElementById("btn-tournament-late-player").click());
  await sleep(300);
  await page.evaluate(() => { document.getElementById("confirm-modal-input").value = "Dee"; document.getElementById("btn-confirm-modal-ok").click(); });
  await sleep(600);
  t = await T();
  const deeMatch = t.wb[0].find((m) => m.a === "Dee" || m.b === "Dee");
  check("3 players + a late player \"Dee\": Dee takes the round-1 bye spot and plays the top seed", !!deeMatch && deeMatch.a && deeMatch.b && !deeMatch.winner && t.players.includes("Dee"), t.wb[0].map((m) => [m.a, m.b, m.winner]));

  // ---- League: change a score, delete a match ----
  await start(null, ["Ann", "Ben"]);
  await page.evaluate(() => {
    const now = Date.now();
    const league = { id: "lg1", name: "Tuesday", isOrganizer: true, format: "apa8ball", handicapSystem: "apa", useHandicap: false, handicapBaseGames: 3,
      members: [{ name: "Ann", skillLevel: 4, leaguePoints: 2, matchesPlayed: 2, matchesWon: 1 }, { name: "Ben", skillLevel: 4, leaguePoints: 2, matchesPlayed: 2, matchesWon: 1 }],
      matches: [
        { id: "m1", ts: new Date(now - 7200000).toISOString(), playerA: "Ann", playerB: "Ben", targetA: 3, targetB: 3, scoreA: 3, scoreB: 1, winner: "Ann", leaguePointsA: 2, leaguePointsB: 0 },
        { id: "m2", ts: new Date(now - 3600000).toISOString(), playerA: "Ann", playerB: "Ben", targetA: 3, targetB: 3, scoreA: 0, scoreB: 3, winner: "Ben", leaguePointsA: 0, leaguePointsB: 2 }],
      activeMatches: [], sessionGameCounts: {}, tableCount: 1, teams: [] };
    localStorage.setItem("poolMasterCounter.leagues.v1", JSON.stringify([league]));
  });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(600);
  await page.evaluate(() => document.getElementById("btn-open-league").click());
  await sleep(600);
  const rows = await page.evaluate(() => [...document.querySelectorAll("#league-match-list .league-match-row")].map((li) => li.textContent));
  check("the league page lists the matches played, newest first, each with ✏️ and 🗑", rows.length === 2 && /Ann 0 – 3 Ben/.test(rows[0]) && /✏️/.test(rows[0]) && /🗑/.test(rows[0]), rows);
  await page.evaluate(() => document.querySelector("#league-match-list .league-match-edit").click());
  await enterScore(3, 2);
  let lg = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.leagues.v1"))[0]);
  const ann = lg.members.find((m) => m.name === "Ann"), ben = lg.members.find((m) => m.name === "Ben");
  check("✏️ the newest (0-3) becomes 3-2 for Ann: Ann 2 wins / 4 points, Ben 0 wins / 1 point (2 of 3: on the hill, APA 8-Ball's 2-1)", ann.matchesWon === 2 && ann.leaguePoints === 4 && ben.matchesWon === 0 && ben.leaguePoints === 1 && ann.matchesPlayed === 2, { ann, ben });
  await page.evaluate(() => document.querySelector("#league-match-list .league-match-delete").click());
  await sleep(300);
  await okModal();
  await sleep(500);
  lg = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.leagues.v1"))[0]);
  const ann2 = lg.members.find((m) => m.name === "Ann"), ben2 = lg.members.find((m) => m.name === "Ben");
  check("🗑 then delete it: one match left (3-1) - Ann 1 win / 2 points, Ben 1 played / 0 points", lg.matches.length === 1 && ann2.matchesWon === 1 && ann2.leaguePoints === 2 && ann2.matchesPlayed === 1 && ben2.leaguePoints === 0 && ben2.matchesPlayed === 1, { ann2, ben2, n: lg.matches.length });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
