// Ratings that stay right:
// - 600 rated games (past the 500-point history cap): three starts in a row give the same ratings
//   and games played (no game re-rated because it fell off a long history), histories in time order;
// - merging another iPad's backup ("Add to what's here") gives the ratings you'd get playing every
//   game on one device - not whichever device's number came last;
// - "José" typed as one character or as e + accent (a Mac file), or "Jo  Bob" with two spaces, is
//   one player, in the stats and in the ratings;
// - "reset all ratings" stays reset after a restart;
// - the rules: both players of a game move by the same amount (ratings always add up), team games
//   are rated (each side by its average), a longer game counts more (a Straight Pool game to 100
//   about 2.7 times a rack), and an old team game from before stays unrated until a recompute.
// Its own file server on 4247; players' game logs are seeded straight into storage.
// usage: node tests/probe_ratings.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4247, BASE = "http://localhost:" + PORT + "/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-ratings-"));

// Players' saved game logs for these games: [winner, loser, isoTs]
function statsFor(games) {
  const out = {};
  const add = (name, g, won) => {
    const date = g[2].slice(0, 10);
    if (!out[name]) out[name] = { name, sessions: [] };
    let s = out[name].sessions.find((x) => x.date === date);
    if (!s) { s = { date, wins: 0, gamesWon: [], opponents: [], games: [], wonTournament: false }; out[name].sessions.push(s); }
    s.games.push({ ts: g[2], gameType: "8ball", gameLabel: "8-Ball", target: 1, result: won ? "won" : "lost", winnerNames: [g[0]], opponentNames: won ? [g[1]] : [g[0]], teammateNames: [], isTeam: false });
    if (won) { s.wins++; s.gamesWon.push("8-Ball"); }
    const opp = won ? g[1] : g[0];
    if (s.opponents.indexOf(opp) === -1) s.opponents.push(opp);
  };
  games.forEach((g) => { add(g[0], g, true); add(g[1], g, false); });
  return out;
}
const ts = (dayOffset, minute) => new Date(Date.UTC(2026, 8, 1 + dayOffset, 18, minute)).toISOString();

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
  // A fresh app holding these stores (raw localStorage values), with these players on the roster.
  async function open(stores, roster) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "manifest.json");
    await page.evaluate((stores, roster) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      Object.keys(stores).forEach((k) => localStorage.setItem(k, JSON.stringify(stores[k])));
      if (roster) localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: roster.map((n, i) => ({ id: "p" + i, name: n, playing: true, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    }, stores, roster || null);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    return page;
  }
  const ratings = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1") || "{}"));
  const brief = (r) => { const o = {}; Object.keys(r).sort().forEach((k) => { o[k] = { rating: r[k].rating, games: r[k].gamesPlayed }; }); return o; };
  const STATS = "poolMasterCounter.playerStats.v1", RATINGS = "poolMasterCounter.ratings.v1";

  // ---- 1. 600 games: the same after every start ----
  const many = [];
  for (let i = 0; i < 600; i++) many.push([i % 3 ? "Alice" : "Bob", i % 3 ? "Bob" : "Alice", ts(Math.floor(i / 20), i % 20)]);
  let page = await open({ [STATS]: statsFor(many) }, ["Alice", "Bob"]);
  const r1 = await ratings(page);
  await page.reload({ waitUntil: "networkidle2" }); await sleep(900);
  const r2 = await ratings(page);
  await page.reload({ waitUntil: "networkidle2" }); await sleep(900);
  const r3 = await ratings(page);
  check("600 games rated once: Alice and Bob each 600 games played", r1.Alice && r1.Alice.gamesPlayed === 600 && r1.Bob.gamesPlayed === 600, brief(r1));
  check("...three starts in a row: the same ratings and games played (nothing re-rated)", JSON.stringify(brief(r1)) === JSON.stringify(brief(r2)) && JSON.stringify(brief(r2)) === JSON.stringify(brief(r3)), [brief(r1), brief(r2), brief(r3)]);
  const sorted = (h) => h.every((x, i) => i === 0 || h[i - 1].ts <= x.ts);
  check("...both move by the same amount: Alice + Bob still add up to 800", r3.Alice.rating + r3.Bob.rating === 800, { alice: r3.Alice.rating, bob: r3.Bob.rating });
  check("...histories keep the last 500 points, in time order", r3.Alice.history.length === 500 && sorted(r3.Alice.history) && sorted(r3.Bob.history), { len: r3.Alice.history.length });
  await page.close();

  // ---- 2. Merging another iPad's backup = all the games on one device ----
  const tableA = [], tableB = [];
  for (let i = 0; i < 30; i++) tableA.push([i % 6 ? "Bob" : "Carl", i % 6 ? "Carl" : "Bob", ts(i, 0)]);
  tableB.push(["Dan", "Bob", ts(10, 30)], ["Dan", "Bob", ts(20, 30)]); // (in between table A's games)
  const devB = await open({ [STATS]: statsFor(tableB) });
  const backupB = await devB.evaluate(() => JSON.stringify({ exportedAt: new Date().toISOString(),
    state: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")),
    playerStats: JSON.parse(localStorage.getItem("poolMasterCounter.playerStats.v1")),
    ratings: JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1")),
    ratedGames: JSON.parse(localStorage.getItem("poolMasterCounter.ratedGames.v1") || "null") }));
  await devB.close();
  const file = path.join(TMP, "table-b.json");
  fs.writeFileSync(file, backupB);
  page = await open({ [STATS]: statsFor(tableA) }); // (no one seated: the panels show)
  const beforeMerge = brief(await ratings(page));
  // (with ranked players and no one seated the app opens on the Leaderboard - back to the game)
  await page.evaluate(() => { const v = document.getElementById("view-leaderboard-page"); if (v && !v.classList.contains("hidden")) document.getElementById("btn-leaderboard-play-top").click(); });
  await sleep(400);
  await page.evaluate(() => { const p = document.getElementById("backup-panel"); if (p.classList.contains("collapsed")) document.getElementById("btn-toggle-backup-panel").click(); });
  await sleep(300);
  await page.click("#btn-restore");
  await sleep(300);
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click("#btn-bk-pick-file")]);
  await chooser.accept([file]);
  await sleep(800);
  await page.click("#btn-bk-add");
  await sleep(1500);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); } });
  await sleep(2500);
  const merged = brief(await ratings(page));
  await page.close();
  const ref = await open({ [STATS]: statsFor(tableA.concat(tableB)) });
  const oneDevice = brief(await ratings(ref));
  await ref.close();
  check("merging table B's iPad into table A's: Bob, Carl and Dan rated as if every game was on one device", ["Bob", "Carl", "Dan"].every((n) => merged[n] && oneDevice[n] && merged[n].rating === oneDevice[n].rating && merged[n].games === oneDevice[n].games), { beforeMerge, merged, oneDevice });
  check("...Bob: 32 games played (30 + 2), not one device's count", merged.Bob && merged.Bob.games === 32, merged.Bob);
  check("...and the three still add up to 1200", merged.Bob.rating + merged.Carl.rating + merged.Dan.rating === 1200, merged);

  // ---- 2b. Team games are rated; a longer game counts more ----
  const game = (w, l, t, extra) => Object.assign({ ts: t, gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: w, opponentNames: l, teammateNames: [], isTeam: w.length > 1 }, extra || {});
  const logs = {};
  const put = (name, g, won) => { (logs[name] = logs[name] || { name, sessions: [{ date: g.ts.slice(0, 10), wins: 0, gamesWon: [], opponents: [], games: [] }] }).sessions[0].games.push(Object.assign({}, g, { result: won ? "won" : "lost" })); };
  const seedGame = (g) => { g.winnerNames.forEach((n) => put(n, g, true)); g.opponentNames.forEach((n) => put(n, g, false)); };
  seedGame(game(["Kai"], ["Lin"], ts(5, 0)));
  seedGame(game(["Mo"], ["Ned"], ts(5, 5), { gameType: "straight", gameLabel: "Straight Pool", target: 100, unit: "points" }));
  seedGame(game(["Ola", "Pia"], ["Quin", "Rex"], ts(5, 10), { teamRated: true }));
  seedGame(game(["Sol", "Tam"], ["Uma", "Vic"], ts(5, 15))); // (an old team game: no teamRated)
  page = await open({ [STATS]: logs });
  const rr = brief(await ratings(page));
  check("an 8-Ball rack between two new players: +12 / -12", rr.Kai && rr.Kai.rating === 412 && rr.Lin.rating === 388, { Kai: rr.Kai, Lin: rr.Lin });
  check("...a Straight Pool game to 100 counts about 2.7 racks: +32 / -32", rr.Mo && rr.Mo.rating === 432 && rr.Ned.rating === 368, { Mo: rr.Mo, Ned: rr.Ned });
  check("...a team game moves all four players (each side by its average)", rr.Ola && rr.Ola.rating > 400 && rr.Pia.rating > 400 && rr.Quin.rating < 400 && rr.Rex.rating < 400, { Ola: rr.Ola, Quin: rr.Quin });
  check("...an old team game from before team games were rated stays unrated", !rr.Sol && !rr.Uma, { Sol: rr.Sol, Uma: rr.Uma });
  await page.close();

  // ---- 2c. Live: a regular beats a newcomer - the card's preview is what happens, both move the same ----
  const regLog = [];
  for (let i = 0; i < 25; i++) regLog.push([i % 2 ? "Reg" : "Old", i % 2 ? "Old" : "Reg", ts(6, i)]);
  page = await open({ [STATS]: statsFor(regLog) }, ["Reg", "Newb"]);
  const before = await ratings(page);
  const preview = await page.evaluate(() => { const plus = [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label") === "Add point for Reg"); const card = plus.closest(".player-panel"); const p = card.querySelector(".rating-pronostic"); return p ? p.textContent : null; });
  await page.evaluate(() => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label") === "Add point for Reg").click());
  await sleep(500);
  const after2 = await ratings(page);
  const regGain = after2.Reg.rating - before.Reg.rating, newbLoss = after2.Newb.rating - 400;
  check("a regular (8 a game) beats a newcomer (24): both move the same, " + regGain + " / " + newbLoss + ", as the card said (" + preview + ")", regGain > 0 && regGain === -newbLoss && preview && preview.replace(/\s/g, "").indexOf("+" + regGain + "/") === 0, { regGain, newbLoss, preview });
  await page.close();

  // ---- 3. One player, however the name was typed ----
  const nfd = "José", nfc = "José";
  const jose = statsFor([[nfd, "Ana", ts(1, 0)], ["Ana", nfd, ts(1, 5)], [nfd, "Ana", ts(1, 10)]]);
  const jobo = statsFor([["Jo  Bob", "Ana", ts(2, 0)]]);
  const seeded = Object.assign({}, jose, jobo);
  seeded.Ana.sessions = seeded.Ana.sessions.concat(jobo.Ana.sessions);
  page = await open({ [STATS]: seeded, [RATINGS]: { [nfd]: { name: nfd, rating: 480, gamesPlayed: 3, history: [{ ts: ts(1, 0), rating: 410, delta: 10, fromGame: true }, { ts: ts(1, 5), rating: 470, delta: 60 }, { ts: ts(1, 10), rating: 480, delta: 10, fromGame: true }] } } }, [nfc, "Jo Bob", "Ana"]);
  const keys = await page.evaluate(() => ({ stats: Object.keys(JSON.parse(localStorage.getItem("poolMasterCounter.playerStats.v1") || "{}")), ratings: Object.keys(JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1") || "{}")) }));
  const joseKeys = (list) => list.filter((k) => k.normalize("NFC").toLowerCase() === nfc.toLowerCase());
  check("\"José\" from a Mac file (e + accent) and \"José\" on the roster: one player in the stats and in the ratings", joseKeys(keys.stats).length === 1 && joseKeys(keys.ratings).length === 1 && joseKeys(keys.stats)[0] === nfc, keys);
  check("...\"Jo  Bob\" (two spaces) and \"Jo Bob\": one player", keys.stats.filter((k) => /^jo\s+bob$/i.test(k)).length === 1 && keys.stats.indexOf("Jo Bob") !== -1, keys.stats);
  await page.close();

  // ---- 4. "Reset all ratings" stays reset ----
  const few = [];
  for (let i = 0; i < 12; i++) few.push(["Eve", "Fay", ts(3, i)]);
  page = await open({ [STATS]: statsFor(few) }, ["Eve", "Fay"]);
  const rated = brief(await ratings(page));
  await page.evaluate(() => document.getElementById("btn-reset-all-ratings").click());
  await sleep(300);
  for (let i = 0; i < 2; i++) { await page.click("#btn-confirm-modal-ok"); await sleep(400); }
  await page.reload({ waitUntil: "networkidle2" }); await sleep(900);
  const after = brief(await ratings(page));
  check("reset all ratings, then a restart: Eve and Fay stay at 400 (their games aren't rated again)", rated.Eve.rating > 400 && after.Eve.rating === 400 && after.Fay.rating === 400 && after.Eve.games === 0, { rated, after });
  await page.close();

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
