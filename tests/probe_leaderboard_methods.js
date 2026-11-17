// The Leaderboard's ways to pick the leader (2026-11-17, the user: "up to 3 different ways to
// calculate ... keep the default as is but propose 3 great ways to motivate players that don't play
// as often as others"; then: "performance should exclude players that have not played enough for
// a valid q-score, they should be onboarded already, same for all ratings"), at 1180x820:
// - 4 months ago Ace (10-10 with Mid) and Low (7-13 with Reg) played 20 games each - their rating
//   established; in the last 40 days, 7 nights: Reg beats Mid 5-3 every night; Ace comes 3 nights
//   and beats Reg 8 of 9; Low comes 2 nights and loses 6 of 7 to Mid; New, brand new, beats Reg
//   3-0 two nights ago (3 rated games: provisional); Reg and New are the Sharks, Ace and Mid the Owls;
// - ⭐ MVP score (the default, on first, all time): the 4, New under the 10 games; no score on the
//   rows, no note, "ⓘ How the MVP score works" and the formula as before;
// - Last 30 Days, 📈 Performance: Ace first (MVP tag), the 4 ranked, Low last, New not (his 3-0
//   would put him second): "Not ranked yet, rating still provisional: New (3 of 20 games)."; each
//   row's score, big; ❓ on Ace: "📈 Performance: Ace is ahead" and what each score is made of; the
//   formula has log₂ and "established rating (20 games or more)";
// - Teams: both ranked, "Not counted for their team yet ... New (3 of 20 games)";
// - 🔟 Last 10 games: Ace "8½ / 10" first, New not;
// - 🌙 Best 3 nights: Ace first; Low's ❓: "1 night not had yet, at the rating";
// - the choice kept after a reload; 📤 Share says "Ranked by 🌙 Best 3 nights" and the scores;
// - New plays 17 more (9-8 with Mid): 20 games, established - ranked, the note gone;
// - in French: "🌙 3 meilleures soirées", "Comment ce classement est calculé";
// - no page errors.
// Its own file server on 4313.
// usage: node tests/probe_leaderboard_methods.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4313, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the players' game logs: nights some days ago, 8 p.m. local, a game every 10 minutes (newPlayed:
// New's 17 more games, 3 nights ago)
function logs(newPlayed) {
  const out = {};
  const add = (name, day, ts, won, opp) => {
    const log = (out[name] = out[name] || { name, sessions: [] });
    let s = log.sessions.find((x) => x.date === day);
    if (!s) log.sessions.push((s = { date: day, wins: 0, gamesWon: [], opponents: [], games: [] }));
    s.games.push({ ts, gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", result: won ? "won" : "lost", winnerNames: [won ? name : opp], opponentNames: [opp], teammateNames: [], isTeam: false });
    if (won) s.wins += 1;
  };
  const game = (at, winner, loser) => {
    const ts = new Date(at).toISOString();
    const d = new Date(at);
    const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    add(winner, day, ts, true, loser);
    add(loser, day, ts, false, winner);
  };
  const now = new Date();
  const evening = (ago) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 20, 0).getTime();
  // (settled in long ago: 20 games each)
  for (let i = 0, t = evening(121); i < 20; i++) i % 2 ? game((t += 600000), "Mid", "Ace") : game((t += 600000), "Ace", "Mid");
  for (let i = 0, t = evening(120); i < 20; i++) i < 7 ? game((t += 600000), "Low", "Reg") : game((t += 600000), "Reg", "Low");
  if (newPlayed) for (let i = 0, t = evening(3); i < 17; i++) i < 9 ? game((t += 600000), "New", "Mid") : game((t += 600000), "Mid", "New");
  [40, 33, 26, 19, 12, 5, 2].forEach((ago) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ago, 20, 0).getTime();
    let t = start;
    const next = () => (t += 10 * 60000);
    [1, 1, 0, 1, 0, 1, 0, 1].forEach((regWins) => (regWins ? game(next(), "Reg", "Mid") : game(next(), "Mid", "Reg")));
    if (ago === 26 || ago === 2) [1, 1, 1].forEach(() => game(next(), "Ace", "Reg"));
    if (ago === 12) [1, 0, 1].forEach((w) => (w ? game(next(), "Ace", "Reg") : game(next(), "Reg", "Ace")));
    if (ago === 5) [0, 1, 0, 0].forEach((w) => (w ? game(next(), "Low", "Mid") : game(next(), "Mid", "Low")));
    if (ago === 2) [0, 0, 0].forEach(() => game(next(), "Mid", "Low"));
    if (ago === 2) [1, 1, 1].forEach(() => game(next(), "New", "Reg"));
  });
  return out;
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
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1180, height: 820 });
  await page.evaluateOnNewDocument(() => {
    window.__shares = [];
    navigator.share = (data) => { window.__shares.push(data.text || ""); return Promise.resolve(); };
  });
  await page.goto(BASE + "manifest.json");
  await page.evaluate((logs) => {
    localStorage.clear();
    ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
    localStorage.setItem("poolMasterCounter.playerStats.v1", JSON.stringify(logs));
    localStorage.setItem("poolMasterCounter.contacts.v1", JSON.stringify({ Reg: { clubTeam: "Sharks" }, New: { clubTeam: "Sharks" }, Ace: { clubTeam: "Owls" }, Mid: { clubTeam: "Owls" } }));
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({
      players: ["Reg", "Mid", "Ace", "Low", "New"].map((n) => ({ id: n.toLowerCase(), name: n, playing: n === "Reg" || n === "Mid", balls: 0 })),
      playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
      currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 }
    }));
  }, logs());
  const openBoard = async () => {
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    await page.evaluate(() => document.getElementById("btn-open-leaderboard").click());
    await sleep(700);
  };
  const read = () => page.evaluate(() => ({
    rows: [...document.querySelectorAll("#leaderboard-list li")].map((li) => ({
      name: li.querySelector(".leaderboard-name-btn").firstChild.textContent.trim(),
      mvp: !!li.querySelector(".leaderboard-mvp-tag"),
      score: (li.querySelector(".leaderboard-method-score-value") || {}).textContent || null,
      label: (li.querySelector(".leaderboard-method-score-label") || {}).textContent || null
    })),
    active: [...document.querySelectorAll(".leaderboard-method-btn.is-active")].map((b) => b.dataset.method),
    hint: document.getElementById("leaderboard-method-hint").textContent,
    note: document.getElementById("leaderboard-onboarding-note").classList.contains("hidden") ? null : document.getElementById("leaderboard-onboarding-note").textContent,
    toggle: document.getElementById("leaderboard-formula-toggle").textContent,
    formula: document.getElementById("leaderboard-formula-note").textContent,
    empty: document.getElementById("leaderboard-empty-hint").classList.contains("hidden") ? null : document.getElementById("leaderboard-empty-hint").textContent
  }));
  const period = async (p) => { await page.evaluate((p) => [...document.querySelectorAll("#leaderboard-period-filter .period-btn")].find((b) => b.dataset.period === p).click(), p); await sleep(900); };
  const view = async (v) => { await page.evaluate((v) => document.getElementById("leaderboard-view-" + v).click(), v); await sleep(800); };
  const NOTE = "Not ranked yet, rating still provisional: New (3 of 20 games).";
  const pick = async (m) => { await page.evaluate((m) => document.querySelector('.leaderboard-method-btn[data-method="' + m + '"]').click(), m); await sleep(800); };
  const explain = async (name) => {
    await page.evaluate((name) => [...document.querySelectorAll("#leaderboard-list li")].find((li) => li.querySelector(".leaderboard-name-btn").firstChild.textContent.trim() === name).querySelector(".leaderboard-explain-btn").click(), name);
    await sleep(300);
    const text = await page.evaluate(() => document.getElementById("confirm-modal-message").textContent);
    await page.keyboard.press("Escape");
    await page.evaluate(() => { const ok = document.getElementById("confirm-modal-ok"); if (ok && !document.getElementById("confirm-modal-overlay").classList.contains("hidden")) ok.click(); });
    await sleep(250);
    return text;
  };
  const names = (r) => r.rows.map((x) => x.name).join(", ");
  try {
    await openBoard();

    // ---- ⭐ the MVP score: the default, as it was ----
    let r = await read();
    check("⭐ MVP score on first, all time (" + names(r) + "): the 4, New (3 games) under the 10; no score on the rows, no note; \"" + r.toggle + "\"",
      r.active.join() === "mvp" && names(r).split(", ").sort().join() === "Ace,Low,Mid,Reg" && r.rows.every((x) => x.score === null) && r.note === null && r.toggle === "ⓘ How the MVP score works" && /^MVP score = \(wins ÷ \(games \+ 10\)\)/.test(r.formula) && /wins, rating/.test(r.hint), r);
    if (OUT) await page.screenshot({ path: path.join(OUT, "lb_mvp.png"), fullPage: true });

    // ---- 📈 Performance, the last 30 days ----
    await period("month");
    await pick("performance");
    r = await read();
    check("📈 Performance, Last 30 Days (" + names(r) + " - " + r.rows.map((x) => x.score).join(", ") + "): Ace first with the MVP tag, the 4, Low last, New not; each score big",
      r.active.join() === "performance" && r.rows.length === 4 && r.rows[0].name === "Ace" && r.rows[0].mvp && r.rows[3].name === "Low" && !r.rows.some((x) => x.name === "New") && r.rows.every((x) => /^\d+$/.test(x.score) && x.label === "performance") && Number(r.rows[0].score) > Number(r.rows[1].score), r);
    check("...the note: \"" + r.note + "\"", r.note === NOTE, r);
    check("...its hint and formula: \"" + r.hint + "\"", /not how often/.test(r.hint) && r.toggle === "ⓘ How this ranking works" && /log₂\(\(games won \+ 2\) ÷ \(games lost \+ 2\)\)/.test(r.formula) && /Only players with an established rating \(20 games or more\) are ranked, from 3 games in this period\.$/.test(r.formula), r);
    let why = await explain("Ace");
    check("...❓ on Ace: " + JSON.stringify(why.slice(0, 260)), /^📈 Performance: Ace is ahead, \d+ vs \w+'s \d+\./.test(why) && /• Ace: opponents rated \d+ on average, won 8 and lost 1 \(\+\d+\) = \d+/.test(why), why);
    if (OUT) await page.screenshot({ path: path.join(OUT, "lb_performance.png"), fullPage: true });
    await view("teams");
    r = await read();
    check("...Teams (" + names(r) + " - " + r.rows.map((x) => x.score).join(", ") + "): both ranked, \"" + r.note + "\"", r.rows.length === 2 && r.note === "Not counted for their team yet, rating still provisional: New (3 of 20 games).", r);
    await view("players");

    // ---- 🔟 Last 10 games ----
    await pick("last10");
    r = await read();
    check("🔟 Last 10 games (" + names(r) + " - " + r.rows.map((x) => x.score).join(", ") + "): Ace \"8½ / 10\" first, New not", r.rows[0].name === "Ace" && r.rows[0].score === "8½ / 10" && r.rows.length === 4 && r.rows.every((x) => / \/ 10$/.test(x.score)) && r.note === NOTE, r);
    why = await explain("Ace");
    check("...❓: \"won 8 of 9 games, + ½ for the 1 not played yet\"", /• Ace: won 8 of 9 games, \+ ½ for the 1 not played yet \(half a win each\) = 8½/.test(why), why);

    // ---- 🌙 Best 3 nights ----
    await pick("bestNights");
    r = await read();
    check("🌙 Best 3 nights (" + names(r) + " - " + r.rows.map((x) => x.score).join(", ") + "): Ace first, Low ranked (2 nights), New not", r.rows[0].name === "Ace" && r.rows.some((x) => x.name === "Low") && !r.rows.some((x) => x.name === "New") && r.rows.every((x) => /^\d+$/.test(x.score) && x.label === "best nights") && /established rating \(20 games or more\)/.test(r.formula), r);
    why = await explain("Low");
    check("...❓ on Low: 2 nights and \"1 night not had yet, at the rating\" - " + JSON.stringify(why.slice(0, 300)), /• Low's best nights: .+ · .+ · 1 night not had yet, at the rating \d+ → \d+/.test(why), why);
    if (OUT) await page.screenshot({ path: path.join(OUT, "lb_best_nights.png"), fullPage: true });

    // ---- kept after a reload; 📤 Share ----
    await openBoard();
    await period("month");
    r = await read();
    check("the choice kept after a reload: " + r.active.join(), r.active.join() === "bestNights" && r.rows[0].name === "Ace", r);
    await page.evaluate(() => document.getElementById("btn-leaderboard-share").click());
    await sleep(400);
    const shared = await page.evaluate(() => window.__shares[window.__shares.length - 1] || "");
    check("📤 Share: \"Ranked by 🌙 Best 3 nights\", Ace first with the score", /^🏆 Players Leaderboard — Pool Master Counter\nRanked by 🌙 Best 3 nights\n\n🥇 Ace \(MVP\) — \d+ best nights • /.test(shared), shared.slice(0, 400));

    // ---- the week: nobody's had a night of 3 games in it but last nights ----
    await period("week");
    r = await read();
    check("Last 7 Days, best nights (" + names(r) + "): who played in it - Ace, Reg, Mid, Low, not New", r.rows.length === 4 && r.rows[0].name === "Ace" && r.note === NOTE, r);

    // ---- New plays 17 more: 20 games, his rating established ----
    await page.evaluate((logs) => localStorage.setItem("poolMasterCounter.playerStats.v1", JSON.stringify(logs)), logs(true));
    await openBoard();
    await period("month");
    await pick("performance");
    r = await read();
    check("New at 20 games (" + names(r) + " - " + r.rows.map((x) => x.score).join(", ") + "): ranked, the note gone", r.rows.length === 5 && r.rows.some((x) => x.name === "New") && r.note === null, r);

    // ---- in French ----
    await page.evaluate(() => localStorage.setItem("poolMasterCounter.language.v1", "french"));
    await openBoard();
    await pick("bestNights");
    r = await read();
    const frBtn = await page.evaluate(() => document.querySelector('.leaderboard-method-btn[data-method="bestNights"]').textContent);
    check("in French: \"" + frBtn + "\", \"" + r.toggle + "\", \"" + (r.rows[0] || {}).label + "\"", frBtn === "🌙 3 meilleures soirées" && r.toggle === "ⓘ Comment ce classement est calculé" && (r.rows[0] || {}).label === "meilleures soirées", r);

    // ---- back to the MVP score ----
    await pick("mvp");
    r = await read();
    check("back to ⭐: the MVP board as before (" + names(r) + ")", r.active.join() === "mvp" && r.rows.every((x) => x.score === null) && r.toggle === "ⓘ Comment le score MVP est calculé", r);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
