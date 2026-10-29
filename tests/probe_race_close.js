// Races always end, played through the scoreboard:
// - Race to 3: the 3rd win closes and archives the race at once (one race win in the stats, a
//   fresh session), its race-won screen after; a reload changes nothing; a page gone between the
//   winning rack and the close (the saved "race closed" flag) closes it at start-up, once;
// - a board left at 6 wins of a race to 5 (from before this fix) closes at start-up;
// - the race lowered mid-match under someone's wins (Race to 5, Kim on 3, lowered to 3): it asks;
//   Cancel puts the race back at 5 and nothing ends; OK ends it - "Kim won the tournament with 3
//   wins! (race-to 3)", archived once;
// - no page errors.
// Its own file server on 4255.
// usage: node tests/probe_race_close.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4255, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 700) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readBig = (page, name) => page.evaluate((name) => new Promise((resolve) => {
  const gen = localStorage.getItem("poolMasterCounter.bigStoreGen.v1") || "0";
  const req = indexedDB.open("pmc-big", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("kv");
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    try {
      const get = req.result.transaction("kv", "readonly").objectStore("kv").get(name + "@" + gen);
      get.onsuccess = () => { resolve(get.result === undefined ? null : get.result); req.result.close(); };
      get.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  };
}), name);

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
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const visible = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.classList.contains("hidden"); }, id);
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
  const headline = () => page.evaluate(() => document.getElementById("milestone-headline").textContent);
  // race wins in the archived stats, per name
  const raceWins = async () => {
    const st = (await readBig(page, "playerStats")) || {};
    const out = {};
    Object.keys(st).forEach((n) => (st[n].sessions || []).forEach((s) => (s.games || []).forEach((g) => { if (g.wonRace && g.result === "won") out[n] = (out[n] || 0) + 1; })));
    return out;
  };
  const fresh = async () => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => { localStorage.clear(); indexedDB.deleteDatabase("pmc-big"); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(700);
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
    await sleep(700);
  };
  // one rack: + for that player; the popup closed unless keepOpen
  const winRack = async (name, keepOpen) => {
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label") === "Add point for " + name).click(), name);
    await sleep(400);
    if (keepOpen) return;
    if (await visible("gamewin-overlay")) await page.click("#btn-gamewin-close");
    await sleep(500);
    await page.evaluate(() => document.querySelectorAll(".onhill-overlay:not(.hidden) .btn-primary").forEach((b) => b.click()));
    await sleep(200);
  };
  const reload = async () => { await page.goto(BASE, { waitUntil: "networkidle2" }); await sleep(1200); };

  // ---- a reload with the final popup open ----
  await fresh();
  await quickGame(3, "Kim", "Jo");
  await winRack("Kim");
  await winRack("Kim");
  await winRack("Kim", true);
  let st = await state();
  let wins = await raceWins();
  check("Race to 3: Kim's 3rd win closes the race at once - archived (Kim 1 race win), a fresh session, nothing left pending",
    st.gameHistory.length === 0 && !st.raceClosedPending && wins.Kim === 1 && !wins.Jo, { games: st.gameHistory.length, pending: st.raceClosedPending, wins });
  await sleep(600);
  check("...its race-won screen: \"Kim won the tournament with 3 wins!\"", (await visible("milestone-overlay")) && /Kim won the tournament with 3 wins/.test(await headline()), await headline());
  await reload();
  wins = await raceWins();
  check("...reloaded: nothing more (still 1 race win, no race-won screen again)", wins.Kim === 1 && !(await visible("milestone-overlay")), wins);

  // ---- the page gone between the winning rack and the race closing ----
  await fresh();
  await page.evaluate(() => {
    const players = [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }];
    const now = Date.now();
    const g = (i) => ({ ts: new Date(now - (5 - i) * 60000).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: ["Kim"], winnerIds: ["k"], opponentNames: ["Jo"], isTeam: false, summary: "Kim won", wonRace: i === 2, raceTarget: 3, raceCount: i === 2 ? 3 : 0 });
    const games = [g(0), g(1), g(2)].reverse();
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players, playerWins: { k: 3, j: 0 }, teamWins: {}, teamMvpWins: {}, gameHistory: games, gamesPlayedCount: 3,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 },
      raceClosedPending: { ts: games[0].ts, names: "Kim", count: 3, target: 3 } }));
  });
  await reload();
  st = await state();
  wins = await raceWins();
  const m1 = await visible("milestone-overlay");
  check("the page gone between the winning rack and the close (the saved flag): at start-up the race closes - \"Kim won the tournament with 3 wins!\", a fresh session, 1 race win",
    m1 && /Kim won the tournament with 3 wins/.test(await headline()) && st.gameHistory.length === 0 && !st.raceClosedPending && wins.Kim === 1 && !wins.Jo, { m1, games: st.gameHistory.length, pending: st.raceClosedPending, wins });
  if (OUT) await page.screenshot({ path: path.join(OUT, "closed_after_reload.png") });
  await page.click("#btn-milestone-close");
  await sleep(300);
  await reload();
  wins = await raceWins();
  check("...reloaded again: nothing more (still 1 race win, no popup)", wins.Kim === 1 && !(await visible("milestone-overlay")), wins);

  // ---- a board left past its race (from before this fix) ----
  await fresh();
  await page.evaluate(() => {
    const players = [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }];
    const now = Date.now();
    const g = (i, w) => ({ ts: new Date(now - (10 - i) * 60000).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: [w === "k" ? "Kim" : "Jo"], winnerIds: [w], opponentNames: [w === "k" ? "Jo" : "Kim"], isTeam: false, summary: "won", wonRace: i === 4, raceTarget: 5, raceCount: i === 4 ? 5 : 0 });
    const games = [g(0, "k"), g(1, "k"), g(2, "k"), g(3, "k"), g(4, "k"), g(5, "k")].reverse();
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players, playerWins: { k: 6, j: 0 }, teamWins: {}, teamMvpWins: {}, gameHistory: games, gamesPlayedCount: 6,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
  });
  await reload();
  st = await state();
  wins = await raceWins();
  check("a board left at 6 wins of a race to 5: closed at start-up - Kim's race archived once, a fresh session",
    (await visible("milestone-overlay")) && st.gameHistory.length === 0 && wins.Kim === 1, { games: st.gameHistory.length, wins, headline: await headline() });
  await page.click("#btn-milestone-close");
  await sleep(300);

  // ---- the race lowered mid-match ----
  await fresh();
  await quickGame(5, "Kim", "Jo");
  await winRack("Kim");
  await winRack("Jo");
  await winRack("Kim");
  await winRack("Kim");
  const setRace = async (n) => {
    await page.evaluate((n) => {
      const box = document.getElementById("race-to-wins");
      box.focus();
      box.value = String(n);
      box.dispatchEvent(new Event("input"));
      box.dispatchEvent(new Event("change"));
      box.blur();
    }, n);
    await sleep(400);
  };
  await setRace(3);
  let ask = await page.evaluate(() => ({ shown: !document.getElementById("confirm-modal-overlay").classList.contains("hidden"), text: document.getElementById("confirm-modal-message").textContent }));
  check("Race to 5, Kim on 3, the race lowered to 3: it asks (\"Kim already has 3 wins — past the new race to 3\")", ask.shown && /Kim already has 3 wins/.test(ask.text) && /race to 3/.test(ask.text), ask);
  if (OUT) await page.screenshot({ path: path.join(OUT, "lowered_ask.png") });
  await page.click("#btn-confirm-modal-cancel");
  await sleep(400);
  st = await state();
  check("...Cancel: the race is back at 5, nothing ended (Kim still on 3)", st.raceToWinsTarget === 5 && st.playerWins[Object.keys(st.playerWins).find((id) => st.players.find((p) => p.id === id && p.name === "Kim"))] === 3 && st.gameHistory.length === 4 && !(await visible("milestone-overlay")),
    { race: st.raceToWinsTarget, games: st.gameHistory.length });
  await setRace(3);
  await page.click("#btn-confirm-modal-ok");
  await sleep(1200);
  st = await state();
  wins = await raceWins();
  check("...lowered again, OK: \"Kim won the tournament with 3 wins! (race-to 3)\", archived once, a fresh session",
    (await visible("milestone-overlay")) && /Kim won the tournament with 3 wins! \(race-to 3\)/.test(await headline()) && wins.Kim === 1 && st.gameHistory.length === 0, { headline: await headline(), wins, games: st.gameHistory.length });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
