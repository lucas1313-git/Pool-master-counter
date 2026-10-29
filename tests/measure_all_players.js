// How long ☰ › 📊 All players takes to open on a big history (P29): 40 players, 5,000 games
// (each in both players' histories) over 200 nights, the CPU slowed down 4x (DevTools'
// throttling, as a slow tablet) - the time from the tap to the page drawn (two frames later).
// Also the time to the scoreboard from a cold load, and a + tap on the board (the median of 5). Prints one JSON line; not pass/fail unless
// --check (then: All Players under 300 ms).
// usage: node tests/measure_all_players.js [--check]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4287, BASE = "http://localhost:" + PORT + "/";
const CHECK = process.argv.includes("--check");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 40 players, 5,000 games: a few tables a night, 25 games a night
function history() {
  const names = Array.from({ length: 40 }, (_, i) => "Player " + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? "2" : ""));
  const stats = {};
  names.forEach((n) => { stats[n] = { name: n, sessions: [] }; });
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const games = ["8-Ball", "9-Ball", "10-Ball", "One Pocket"];
  for (let night = 0; night < 200; night++) {
    const day = new Date(2026, 0, 1 + night, 20);
    const date = day.getFullYear() + "-" + String(day.getMonth() + 1).padStart(2, "0") + "-" + String(day.getDate()).padStart(2, "0");
    const perPlayer = {};
    for (let g = 0; g < 25; g++) {
      const a = names[Math.floor(rnd() * 40)];
      let b = names[Math.floor(rnd() * 40)];
      if (b === a) b = names[(names.indexOf(a) + 1) % 40];
      const ts = new Date(day.getTime() + g * 6 * 60000).toISOString(), label = games[g % 4], aWon = rnd() < 0.5;
      [[a, b, aWon], [b, a, !aWon]].forEach(([me, other, won]) => {
        const s = perPlayer[me] = perPlayer[me] || { date, wins: 0, gamesWon: [], opponents: [], games: [] };
        if (won) { s.wins++; s.gamesWon.push(label); }
        if (s.opponents.indexOf(other) === -1) s.opponents.push(other);
        s.games.push({ ts, gameLabel: label, target: 1, result: won ? "won" : "lost", winnerNames: [won ? me : other], opponentNames: [other] });
      });
    }
    Object.keys(perPlayer).forEach((n) => stats[n].sessions.push(perPlayer[n]));
  }
  return { names, stats };
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 820 } });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const h = history();
    await page.goto(BASE + "manifest.json");
    await page.evaluate((stats, names) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.playerStats.v1", JSON.stringify(stats));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: names.slice(0, 4).map((n, i) => ({ id: "p" + i, name: n, playing: i < 2, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    }, h.stats, h.names);
    // a first load moves the history into IndexedDB (big-store) - then measured from a cold reload
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1500);
    const cdp = await page.target().createCDPSession();
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const t0 = Date.now();
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelectorAll("#scoreboard .player-panel").length > 0, { timeout: 60000, polling: 50 });
    const toBoard = Date.now() - t0;
    await sleep(2000);
    // a + tapped on the board: the tap to the board redrawn
    const taps = [];
    for (let i = 0; i < 5; i++) {
      taps.push(await page.evaluate(() => new Promise((done) => {
        const t = performance.now();
        document.querySelector("#scoreboard button.btn-ball.plus").click();
        requestAnimationFrame(() => requestAnimationFrame(() => done(Math.round(performance.now() - t))));
      })));
      await sleep(300);
    }
    taps.sort((a, b) => a - b);
    const allPlayers = await page.evaluate(() => new Promise((done) => {
      const t = performance.now();
      document.getElementById("btn-open-global-stats").click();
      requestAnimationFrame(() => requestAnimationFrame(() => done({ ms: Math.round(performance.now() - t), cards: document.querySelectorAll("#all-players-list > *").length })));
    }));
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const out = { players: h.names.length, games: 5000, cpuSlowdown: 4, toBoardMs: toBoard, allPlayersMs: allPlayers.ms, allPlayersCards: allPlayers.cards, tapMedianMs: taps[2], errors };
    console.log(JSON.stringify(out));
    if (CHECK) {
      const ok = allPlayers.ms < 300 && allPlayers.cards >= 40 && !errors.length;
      console.log((ok ? "PASS " : "FAIL ") + "All Players opens in under 300 ms at 4x slowdown with 5,000 games (" + allPlayers.ms + " ms, " + allPlayers.cards + " cards)");
      process.exitCode = ok ? 0 : 1;
    }
  } finally {
    await browser.close();
    site.close();
  }
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
