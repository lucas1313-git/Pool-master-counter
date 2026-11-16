// 🏁 Races on this day, ↺ Reset (2026-11-16, the user: "i need to be able to reset a race to in
// particular in a particular day. by example, i need to reset the last race to as it was not
// rightly recorded"). Its own file server on 4311, at 1180x900:
// - yesterday, saved (older racks: no race kept with them, only their score): a race to 3 Bob won
//   3-1 over Luc, then one stopped by hand, Chris 2-1 Bob; Publish Daily Report, 📅 that day:
//   "🏁 Races on this day" lists both - times, game, racks, "🏆 Bob won · Bob 3 – 1 Luc", "⏹ Stopped
//   · Chris 2 – 1 Bob";
// - ↺ Reset on the stopped one, asked first: its 3 racks out of every player's games, their Q-Score
//   changes taken back (Chris back to where he was, Bob by the same); the race won kept; the list
//   shows one race; Recover Data has "Race reset - Race to 3, ..." - and Recover brings it all back;
// - today, on the board (race to 3, Bob v Luc): each rack kept with its race (the first rack's
//   time); the list says "▶ On the board now · Bob 1 – 1 Luc"; ↺ Reset: the board back to 0 - 0,
//   the racks and their Q-Score changes gone;
// - Bob then wins it 3-0: those racks one race; the next rack is another (its own time);
// - no page errors.
// usage: node tests/probe_race_reset.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4311, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, "0");

// yesterday's two races, as saved before racks kept their race: each player's own copy of each rack
function yesterday() {
  // (the pool day before today's - a pool day runs 5 a.m. to 5 a.m.)
  const d = new Date(); if (d.getHours() < 5) d.setDate(d.getDate() - 1);
  d.setDate(d.getDate() - 1); d.setHours(21, 0, 0, 0);
  const day = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const at = (min) => new Date(d.getTime() + min * 60000).toISOString();
  const racks = [
    { ts: at(10), w: "Bob", l: "Luc", tally: { Bob: 1, Luc: 0 } },
    { ts: at(20), w: "Luc", l: "Bob", tally: { Bob: 1, Luc: 1 } },
    { ts: at(30), w: "Bob", l: "Luc", tally: { Bob: 2, Luc: 1 } },
    { ts: at(40), w: "Bob", l: "Luc", tally: { Bob: 3, Luc: 1 }, won: true },
    { ts: at(50), w: "Chris", l: "Bob", tally: { Chris: 1, Bob: 0 } },
    { ts: at(60), w: "Bob", l: "Chris", tally: { Chris: 1, Bob: 1 } },
    { ts: at(70), w: "Chris", l: "Bob", tally: { Chris: 2, Bob: 1 }, won: true, stopped: true }
  ];
  const stats = {}, ratings = {};
  const rating = { Bob: 1500, Luc: 1500, Chris: 1500 };
  racks.forEach((r) => {
    [r.w, r.l].forEach((me) => {
      const won = me === r.w;
      const s = (stats[me] = stats[me] || { name: me, sessions: [{ date: day, wins: 0, gamesWon: [], opponents: [], games: [], wonTournament: false }] }).sessions[0];
      s.games.push({ ts: r.ts, gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", result: won ? "won" : "lost", winnerNames: [r.w], opponentNames: won ? [r.l] : [r.w], teammateNames: [], isTeam: false,
        raceTarget: 3, wonRace: !!r.won, raceCount: r.won ? 3 : null, raceInterrupted: r.stopped ? { by: "Luc", how: "lead" } : null, raceTally: r.tally, scores: null });
      if (won) { s.wins++; s.gamesWon.push("8-Ball"); }
      if (s.opponents.indexOf(won ? r.l : r.w) === -1) s.opponents.push(won ? r.l : r.w);
      const delta = won ? 12 : -12;
      rating[me] += delta;
      (ratings[me] = ratings[me] || { rating: 1500, gamesPlayed: 0, history: [] }).history.push({ ts: r.ts, rating: rating[me], delta, fromGame: true });
      ratings[me].rating = rating[me];
      ratings[me].gamesPlayed++;
    });
  });
  return { day, racks, stats, ratings };
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
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 900 });
    const y = yesterday();
    const players = [{ id: "b", name: "Bob", playing: true, balls: 0 }, { id: "l", name: "Luc", playing: true, balls: 0 }, { id: "c", name: "Chris", playing: false, balls: 0 }];
    await page.goto(BASE + "manifest.json");
    await page.evaluate((st, stats, ratings) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      localStorage.setItem("poolMasterCounter.state.v2", st);
      localStorage.setItem("poolMasterCounter.playerStats.v1", JSON.stringify(stats));
      localStorage.setItem("poolMasterCounter.ratings.v1", JSON.stringify(ratings));
    }, JSON.stringify({ players, playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, raceToWinsTarget: 3,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual", queueEnabled: false }, rotation: { enabled: false, order: [], every: 1 } }), y.stats, y.ratings);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    // (the players' games and Recover Data are kept in IndexedDB - js/big-store.js)
    const stored = async () => { await sleep(300); return page.evaluate(async () => ({
      state: JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")),
      stats: await window.PMCBigStore.load("playerStats", {}),
      ratings: JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1") || "{}"),
      snaps: await window.PMCBigStore.load("resetSnapshots", [])
    })); };
    const tsOf = (stats) => { const s = {}; Object.keys(stats).forEach((n) => (stats[n].sessions || []).forEach((x) => (x.games || []).forEach((g) => (s[g.ts] = true)))); return Object.keys(s).sort(); };
    const ratingOf = (r) => { const o = {}; Object.keys(r).forEach((n) => (o[n] = r[n].rating)); return o; };
    const okModal = async () => { await page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click()); await sleep(500); };
    const races = () => page.evaluate(() => ({
      shown: !document.getElementById("day-races").classList.contains("hidden"),
      rows: [...document.querySelectorAll("#day-races-list .day-race")].map((li) => ({ title: li.querySelector(".day-race-title").textContent, result: li.querySelector(".day-race-result").textContent, button: li.querySelector(".day-race-reset").textContent, aria: li.querySelector(".day-race-reset").getAttribute("aria-label"), onBoard: li.classList.contains("is-on-board") }))
    }));
    const pickDay = async (day) => {
      await page.evaluate((day) => {
        if (document.getElementById("app").classList.contains("focus-mode")) document.getElementById("btn-toggle-focus").click();
        if (document.getElementById("day-notes-panel").classList.contains("collapsed")) document.getElementById("btn-toggle-day-notes-panel").click();
      }, day);
      await sleep(400);
      await page.evaluate((day) => { const b = document.querySelector('.report-calendar-day[data-date="' + day + '"]'); if (b) b.click(); }, day);
      await sleep(500);
    };
    const reset = async (n) => {
      await page.evaluate((n) => { document.getElementById("day-races").scrollIntoView(); document.querySelectorAll("#day-races-list .day-race-reset")[n].click(); }, n);
      await sleep(300);
      return page.evaluate(() => !document.getElementById("confirm-modal-overlay").classList.contains("hidden") && document.getElementById("confirm-modal-message").textContent);
    };

    // yesterday's two races
    await pickDay(y.day);
    let list = await races();
    if (OUT) { await page.evaluate(() => document.getElementById("report-calendar").scrollIntoView()); await sleep(200); await page.screenshot({ path: path.join(OUT, "race_reset_list.png") }); }
    const t = (min) => new Date(new Date(y.racks[0].ts).getTime() + (min - 10) * 60000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    check("📅 yesterday: \"🏁 Races on this day\" lists the race won and the one stopped: " + list.rows.map((r) => r.title + " / " + r.result).join(" | "),
      list.shown && list.rows.length === 2 &&
      list.rows[0].title === "Race to 3 · 8-Ball · " + t(10) + " – " + t(40) + " · 4 games" && list.rows[0].result === "🏆 Bob won · Bob 3 – 1 Luc" &&
      list.rows[1].title === "Race to 3 · 8-Ball · " + t(50) + " – " + t(70) + " · 3 games" && list.rows[1].result === "⏹ Stopped · Chris 2 – 1 Bob" &&
      list.rows.every((r) => r.button === "↺ Reset" && /^Reset this race: Race to 3, /.test(r.aria)), list);

    const before = await stored();
    const asked = await reset(1);
    check("↺ Reset asks first: \"" + asked + "\"", /^Reset this race\? Race to 3, .*\(3 games\)\. All its racks come out of every record/.test(asked || "") && !/on the board/.test(asked), asked);
    await okModal();
    const after = await stored();
    const gone = y.racks.slice(4).map((r) => r.ts), kept = y.racks.slice(0, 4).map((r) => r.ts);
    check("its 3 racks out of every player's games, the race won kept", JSON.stringify(tsOf(after.stats)) === JSON.stringify(kept) && !(after.stats.Chris && after.stats.Chris.sessions.length), tsOf(after.stats));
    const rb = ratingOf(before.ratings), ra = ratingOf(after.ratings);
    check("their Q-Score changes taken back: Chris " + rb.Chris + " → " + ra.Chris + ", Bob " + rb.Bob + " → " + ra.Bob + ", Luc stays " + ra.Luc,
      ra.Chris === 1500 && ra.Bob === rb.Bob + 12 && ra.Luc === rb.Luc && after.ratings.Bob.history.every((h) => gone.indexOf(h.ts) === -1), { rb, ra });
    list = await races();
    check("the list: the race won only", list.rows.length === 1 && /^🏆 Bob won/.test(list.rows[0].result), list);
    const snap = after.snaps[0];
    check("Recover Data has it: \"" + (snap && snap.label) + "\"", snap && /^Race reset — Race to 3, .+, .+ – .+$/.test(snap.label) && snap.data.prunedSessions.Chris && snap.data.prunedSessions.Chris[0].games.length === 3 && snap.data.prunedSessions.Bob[0].games.length === 3 && snap.data.ratingHistory.Chris.length === 3, snap && snap.data.ratingHistory);

    // Recover: all back
    await page.evaluate(() => {
      const panel = document.getElementById("backup-panel");
      if (panel && panel.classList.contains("collapsed")) document.getElementById("btn-toggle-backup-panel").click();
      const d = document.getElementById("bk-recover"); if (d) d.open = true;
    });
    await sleep(600);
    const opened = await page.evaluate(() => {
      const row = [...document.querySelectorAll("#recover-data-list .recover-data-row")].find((r) => /Race reset/.test(r.textContent));
      if (!row) return false;
      row.querySelector("button").click();
      return true;
    });
    await sleep(400);
    await page.evaluate(() => {
      document.querySelectorAll("#recover-players-checklist input[type=checkbox], #recover-games-checklist input[type=checkbox]").forEach((c) => { if (!c.checked) c.click(); });
      document.getElementById("btn-recover-restore").click();
    });
    await sleep(500);
    const back = await stored();
    check("Recover brings the race back: its racks and Q-Scores", opened && JSON.stringify(tsOf(back.stats)) === JSON.stringify(y.racks.map((r) => r.ts).sort()) && ratingOf(back.ratings).Chris === rb.Chris, { opened, ts: tsOf(back.stats), r: ratingOf(back.ratings) });

    // today, on the board
    const voice = async (list) => { for (const t of list) { await page.evaluate((t) => window.PMCVoice.handleText(t), t); await sleep(450); } };
    const r0 = ratingOf((await stored()).ratings);
    await voice(["Bob wins the game", "Luc wins the game"]);
    let s = (await stored()).state;
    const live = s.gameHistory.slice().reverse();
    check("each rack on the board kept with its race - the first rack's time", live.length === 2 && live.every((g) => g.raceId === live[0].ts), live.map((g) => [g.ts, g.raceId]));
    await page.evaluate(() => { const b = document.getElementById("btn-report-calendar-latest"); if (b && !b.classList.contains("hidden")) b.click(); });
    await sleep(500);
    const today = await page.evaluate(() => { const d = new Date(); if (d.getHours() < 5) d.setDate(d.getDate() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
    await pickDay(today);
    list = await races();
    check("today: \"▶ On the board now · Bob 1 – 1 Luc\"", list.rows.length === 1 && list.rows[0].onBoard && list.rows[0].result === "▶ On the board now · Bob 1 – 1 Luc", list);
    const asked2 = await reset(0);
    check("asked: it's the race on the board, back to 0", /It's the race on the board: its score goes back to 0\.$/.test(asked2 || ""), asked2);
    await okModal();
    const z = await stored();
    check("the board back to 0 - 0, the racks gone, their Q-Score changes too", z.state.gameHistory.length === 0 && !(z.state.playerWins.b) && !(z.state.playerWins.l) && JSON.stringify(ratingOf(z.ratings)) === JSON.stringify(r0) && tsOf(z.stats).length === 7, { gh: z.state.gameHistory.length, pw: z.state.playerWins, r: ratingOf(z.ratings), r0 });
    const cards = await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-panel .player-wins, #scoreboard .player-panel .wins-count")].map((e) => e.textContent.trim()));
    list = await races();
    check("the list for today: empty, hidden", !list.shown && list.rows.length === 0, list);

    // a race won, then the next: two races
    await voice(["Bob wins the game", "Bob wins the game", "Bob wins the game"]);
    await sleep(1500);
    await page.evaluate(() => { document.querySelectorAll(".milestone-overlay:not(.hidden) button, #milestone-overlay:not(.hidden) .btn-primary").forEach((b) => { if (/nice|continue|ok|close|next/i.test(b.textContent)) b.click(); }); });
    await sleep(500);
    await voice(["Luc wins the game"]);
    const w = await stored();
    const todays = [];
    Object.keys(w.stats).forEach((n) => (w.stats[n].sessions || []).forEach((x) => (x.games || []).forEach((g) => { if (g.result === "won" && g.ts > y.racks[6].ts) todays.push(g); })));
    (w.state.gameHistory || []).forEach((g) => { if (!todays.some((x) => x.ts === g.ts)) todays.push(g); });
    todays.sort((a, b) => a.ts.localeCompare(b.ts));
    check("Bob's 3-0: one race (the first rack's time); the next rack another, its own: " + todays.map((g) => g.raceId === todays[0].ts ? "A" : g.raceId === g.ts ? "own" : "?").join(","),
      todays.length === 4 && todays.slice(0, 3).every((g) => g.raceId === todays[0].ts) && todays[2].wonRace && todays[3].raceId === todays[3].ts, todays.map((g) => [g.ts, g.raceId, g.wonRace]));
    await pickDay(today);
    list = await races();
    if (OUT) { await page.evaluate(() => document.getElementById("day-races").scrollIntoView()); await sleep(200); await page.screenshot({ path: path.join(OUT, "race_reset_today.png") }); }
    check("today's list: the race Bob won, and the one on the board: " + list.rows.map((r) => r.result).join(" | "), list.rows.length === 2 && list.rows[0].result === "🏆 Bob won · Bob 3 – 0 Luc" && list.rows[1].result === "▶ On the board now · Luc 1 – 0 Bob", list);

    // a phone: the list fits, ↺ Reset on screen
    await page.setViewport({ width: 390, height: 844 }); // (touch left as it was: changing it reloads the page)
    await sleep(500);
    const phone = await page.evaluate(() => {
      document.getElementById("day-races").scrollIntoView();
      const b = document.querySelector("#day-races-list .day-race-reset").getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth, left: b.left, right: b.right, height: b.height };
    });
    if (OUT) await page.screenshot({ path: path.join(OUT, "race_reset_phone.png") });
    check("on a phone (390 wide): no sideways scroll, ↺ Reset on screen and big enough", phone.scroll <= 390 && phone.left >= 0 && phone.right <= 390 && phone.height >= 44, phone);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
