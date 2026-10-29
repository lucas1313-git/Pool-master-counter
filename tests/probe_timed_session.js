// Timed sessions end correctly, on the scoreboard:
// - a 30-minute session with 20 minutes left survives a reload with 20 minutes left (not a fresh 30);
//   paused, it stays paused at what it had;
// - with the shot counter on too, the countdown shows beside it (same row), not hidden;
// - time up with "finish the rack" on: "⏰ Last rack", nothing ends yet; the next win ends it - and
//   the leader can be someone waiting (Winner Stays benched Ann, 2 wins), level with Bob on wins but
//   ahead head-to-head: "Ann wins with 2 wins", a tournament won in Ann's stats (a timed session);
// - level after every tie-break (Ann waiting and Bob, 1 win each, never played each other, same
//   racks): it asks - one-rack playoff or share; the playoff seats only them, Bob wins it: "Bob wins
//   with 2 wins", the seats back as they were;
// - the rule off ("stop now"): time up ends it at once;
// - no page errors.
// Its own file server on 4256.
// usage: node tests/probe_timed_session.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4256, BASE = "http://localhost:" + PORT + "/";
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
// "19:58" -> seconds
const secs = (t) => { const m = /(\d+):(\d\d)(?::(\d\d))?/.exec(t || ""); if (!m) return null; return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]; };

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
  const visible = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.classList.contains("hidden") && e.getClientRects().length > 0; }, id);
  const widget = () => page.evaluate(() => ({ text: document.getElementById("timed-tournament-time").textContent, shown: !document.getElementById("timed-tournament-widget").classList.contains("hidden") }));
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
  // a session: players [name, playing, wins], games [winner, loser] (oldest first), the clock
  const seed = async (opts) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((o) => {
      localStorage.clear();
      indexedDB.deleteDatabase("pmc-big");
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      const now = Date.now();
      const players = o.players.map(([n, playing], i) => ({ id: "p" + i, name: n, playing, balls: 0 }));
      const id = (n) => players.find((p) => p.name === n).id;
      const wins = {};
      const games = o.games.map(([w, l], i) => {
        wins[id(w)] = (wins[id(w)] || 0) + 1;
        const scores = {}; scores[w] = 1; scores[l] = 0;
        return { ts: new Date(now - (o.games.length - i) * 120000).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: [w], winnerIds: [id(w)], opponentNames: [l], isTeam: false, summary: w + " won", scores };
      }).reverse();
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({
        players, playerWins: wins, teamWins: {}, teamMvpWins: {}, gameHistory: games, gamesPlayedCount: games.length,
        currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual", queueEnabled: !!o.queue, timedTournamentEnabled: true, timedTournamentMinutes: 30,
          timedTournamentFinishRack: o.finishRack !== false, shotCounterEnabled: !!o.shotCounter, shotCounterBeepSec: 30 },
        raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 },
        timedClock: { accumulatedMs: o.pausedMs || 0, runningSince: o.pausedMs ? null : now - (30 * 60000 - o.leftMs), timeUp: false }
      }));
    }, opts);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
  };
  const winRack = async (name) => {
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
    await sleep(400);
    if (await visible("gamewin-overlay")) await page.click("#btn-gamewin-close");
    await sleep(700);
  };
  const headline = () => page.evaluate(() => document.getElementById("milestone-headline").textContent);

  // ---- 20 minutes left survives a reload ----
  await seed({ players: [["Ann", true], ["Bob", true]], games: [["Ann", "Bob"]], leftMs: 20 * 60000, shotCounter: true });
  let w = await widget();
  check("a 30-minute session with 20 minutes left: the countdown shows ~20:00", w.shown && secs(w.text) >= 19 * 60 + 50 && secs(w.text) <= 20 * 60, w);
  const row = await page.evaluate(() => {
    const a = document.getElementById("shot-counter-widget").getBoundingClientRect(), b = document.getElementById("timed-tournament-widget").getBoundingClientRect();
    return { shot: !document.getElementById("shot-counter-widget").classList.contains("hidden"), sameRow: Math.abs(a.top + a.height / 2 - (b.top + b.height / 2)) < 30 && a.width > 0 && b.width > 0 };
  });
  check("...with the shot counter on too, the countdown shows beside it (same row)", row.shot && row.sameRow, row);
  if (OUT) await page.screenshot({ path: path.join(OUT, "timers_side_by_side.png") });
  await sleep(2000);
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(1200);
  w = await widget();
  check("...reloaded: still ~20 minutes left, not a fresh 30:00", w.shown && secs(w.text) >= 19 * 60 + 45 && secs(w.text) < 20 * 60, w);
  // paused at 12:00 left
  await seed({ players: [["Ann", true], ["Bob", true]], games: [], leftMs: 0, pausedMs: 18 * 60000 });
  await sleep(1500);
  w = await widget();
  check("paused with 12 minutes left: a reload keeps it paused at 12:00", w.text === "12:00", w);

  // ---- time up, finish the rack; a benched leader, ahead head-to-head ----
  await seed({ players: [["Ann", false], ["Bob", true], ["Cat", true]], queue: true, games: [["Ann", "Bob"], ["Ann", "Cat"], ["Bob", "Cat"], ["Bob", "Cat"]], leftMs: 2000 });
  await sleep(3500);
  w = await widget();
  check("time up with \"finish the rack\": \"⏰ Last rack\", nothing ended yet", /Last rack/.test(w.text) && !(await visible("milestone-overlay")), w);
  if (OUT) await page.screenshot({ path: path.join(OUT, "last_rack.png") });
  await winRack("Cat");
  await sleep(600);
  const st1 = await state();
  check("...the next win ends it: Ann (waiting, 2 wins, level with Bob but 1-0 up head-to-head) - \"Ann wins with 2 wins\"",
    (await visible("milestone-overlay")) && /Ann wins with 2 wins/.test(await headline()) && st1.gameHistory.length === 0, { headline: await headline(), games: st1.gameHistory.length });
  const stats = (await readBig(page, "playerStats")) || {};
  const annWon = (stats.Ann ? stats.Ann.sessions : []).some((s) => (s.games || []).some((g) => g.wonRace && g.timedSession && g.result === "won"));
  const bobWon = (stats.Bob ? stats.Bob.sessions : []).some((s) => (s.games || []).some((g) => g.wonRace && g.result === "won"));
  check("...a tournament won in Ann's stats (a timed session), none for Bob", annWon && !bobWon, Object.keys(stats));
  await page.click("#btn-milestone-close");
  await sleep(300);

  // ---- level after every tie-break: a playoff ----
  // (Ann waiting with 1 win; Bob takes the last rack off Cat: Ann and Bob 1 each, never played)
  await seed({ players: [["Ann", false], ["Bob", true], ["Cat", true]], games: [["Ann", "Cat"]], leftMs: 2000 });
  await sleep(3500);
  await winRack("Bob");
  await sleep(500);
  const chooser = await page.evaluate(() => { const o = document.getElementById("tournament-chooser-overlay"); return o ? { text: o.textContent, buttons: [...o.querySelectorAll("button")].map((b) => b.textContent) } : null; });
  check("Ann and Bob level on wins, head-to-head and racks: it asks - one-rack playoff or share (no Cancel)",
    !!chooser && /Ann & Bob/.test(chooser.text) && chooser.buttons.length === 2 && /playoff/i.test(chooser.buttons[0]) && /Share/.test(chooser.buttons[1]), chooser);
  if (OUT) await page.screenshot({ path: path.join(OUT, "playoff_ask.png") });
  await page.evaluate(() => document.querySelector("#tournament-chooser-overlay button.btn-primary").click());
  await sleep(600);
  const seated = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.filter((p) => p.playing).map((p) => p.name));
  w = await widget();
  check("...the playoff seats only Ann and Bob - Ann back from waiting (\"🎱 Playoff\")", JSON.stringify(seated) === JSON.stringify(["Ann", "Bob"]) && /Playoff/.test(w.text), { seated, w });
  await winRack("Bob");
  await sleep(600);
  const st2 = await state();
  check("...Bob wins it: \"Bob wins with 2 wins\", the seats back as they were (Cat at the table, Ann waiting)", (await visible("milestone-overlay")) && /Bob wins with 2 wins/.test(await headline()) && st2.players.find((p) => p.name === "Cat").playing && !st2.players.find((p) => p.name === "Ann").playing,
    { headline: await headline() });
  await page.click("#btn-milestone-close");
  await sleep(300);

  // ---- the rule off: time up ends it at once ----
  await seed({ players: [["Ann", true], ["Bob", true]], games: [["Ann", "Bob"]], leftMs: 2000, finishRack: false });
  await sleep(3500);
  check("\"finish the rack\" off: time up ends it at once - \"Ann wins with 1 win\"", (await visible("milestone-overlay")) && /Ann wins with 1 win/.test(await headline()), await headline());

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
