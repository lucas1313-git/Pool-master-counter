// The Leaderboard's ways to pick the leader (2026-11-17, the user: "up to 3 different ways to
// calculate ... keep the default as is but propose 3 great ways to motivate players that don't play
// as often as others"; then: "performance should exclude players that have not played enough for
// a valid q-score, they should be onboarded already, same for all ratings"), at 1180x820:
// - 4 months ago Ace (10-10 with Mid) and Low (7-13 with Reg) played 20 games each - their rating
//   established; in the last 40 days, 7 nights: Reg beats Mid 5-3 every night; Ace comes 3 nights
//   and beats Reg 8 of 9; Low comes 2 nights and loses 6 of 7 to Mid; New, brand new, beats Reg
//   3-0 two nights ago (3 rated games: provisional); Reg and New are the Sharks, Ace and Mid the Owls;
// - ⭐ MVP score (the default, on first, all time): the 4, New under the 10 games; no score on the
//   rows, no note, "ⓘ How the MVP score works" and the formula as before; Low's 30 balls in a row
//   count for nothing (2026-11-18, the user: "remove the "ball in a row" from the calculation") -
//   not in the formula, the row or 🧗;
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
    localStorage.setItem("poolMasterCounter.playerBestRuns.v1", JSON.stringify({ Low: { name: "Low", value: 30, ts: new Date().toISOString() } }));
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
      label: (li.querySelector(".leaderboard-method-score-label") || {}).textContent || null,
      text: li.textContent
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
  // ❓ then its 🧗 button: {button, text, back (the ❓ text again after ← Back)}
  const climb = async (name, shot) => {
    await page.evaluate((name) => [...document.querySelectorAll("#leaderboard-list li")].find((li) => li.querySelector(".leaderboard-name-btn").firstChild.textContent.trim() === name).querySelector(".leaderboard-explain-btn").click(), name);
    await sleep(300);
    // (the coloured results: "lb-won:won 25", ...)
    const spans = () => page.evaluate(() => [...document.querySelectorAll("#confirm-modal-message span")].map((x) => x.className + ":" + x.textContent));
    const first = await page.evaluate(() => ({ text: document.getElementById("confirm-modal-message").textContent, button: document.getElementById("btn-confirm-modal-extra").classList.contains("hidden") ? null : document.getElementById("btn-confirm-modal-extra").textContent }));
    const firstSpans = await spans();
    let text = first.text, back = null, button = null, climbSpans = [], look = null;
    if (first.button) {
      await page.evaluate(() => document.getElementById("btn-confirm-modal-extra").click());
      await sleep(300);
      text = await page.evaluate(() => document.getElementById("confirm-modal-message").textContent);
      button = await page.evaluate(() => document.getElementById("btn-confirm-modal-extra").textContent);
      climbSpans = await spans();
      look = await page.evaluate(() => {
        const msg = document.getElementById("confirm-modal-message"), px = (el) => el ? parseFloat(getComputedStyle(el).fontSize) : 0, one = (c) => msg.querySelector("." + c);
        return { text: px(msg), won: px(one("lb-won")), lost: px(one("lb-lost")), impact: px(one("lb-impact")), wonColor: one("lb-won") && getComputedStyle(one("lb-won")).color, lostColor: one("lb-lost") && getComputedStyle(one("lb-lost")).color, impactColor: one("lb-impact") && getComputedStyle(one("lb-impact")).color };
      });
      if (OUT && shot) await page.screenshot({ path: path.join(OUT, shot) });
      await page.evaluate(() => document.getElementById("btn-confirm-modal-extra").click());
      await sleep(300);
      back = (await page.evaluate(() => document.getElementById("confirm-modal-message").textContent)) === first.text;
    }
    await page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click());
    await sleep(250);
    return { first: first.button, button, text, back, firstSpans, climbSpans, look };
  };
  const names = (r) => r.rows.map((x) => x.name).join(", ");
  try {
    await openBoard();

    // ---- ⭐ the MVP score: the default, as it was ----
    let r = await read();
    check("⭐ MVP score on first, all time (" + names(r) + "): the 4, New (3 games) under the 10; no score on the rows, no note; \"" + r.toggle + "\"",
      r.active.join() === "mvp" && names(r).split(", ").sort().join() === "Ace,Low,Mid,Reg" && r.rows.every((x) => x.score === null) && r.note === null && r.toggle === "ⓘ How the MVP score works" && /^MVP score = \(wins ÷ \(games \+ 10\)\)/.test(r.formula) && /wins, rating/.test(r.hint), r);
    if (OUT) await page.screenshot({ path: path.join(OUT, "lb_mvp.png"), fullPage: true });
    const lowRow = r.rows.find((x) => x.name === "Low") || { text: "" };
    check("...Low's 30 balls in a row: not in the formula (\"" + r.formula.slice(-80) + "\") or on the row",
      !/best run|\{\{/.test(r.formula) && /A long run of balls in a row doesn't count\.$/.test(r.formula) && lowRow.text && !/ball run|30-/.test(lowRow.text) && /8 wins/.test(lowRow.text), { formula: r.formula, low: lowRow.text });
    let c = await climb("Low");
    check("⭐ ❓ → 🧗 on Low (#4): " + JSON.stringify(c.text.slice(0, 700)),
      c.first === "🧗 How to climb & why here" && c.button === "← Back" && c.back && c.text.startsWith("🧗 How Low can climb - #4 of 4, ⭐ MVP score: ") &&
      /\nTo pass Mid \(#3, [\d.]+\):\n• Beat Mid \d+ times in a row → Low [\d.]+, Mid [\d.]+\n• Win the next \d+ games, against anyone → Low [\d.]+\nThe gap is [\d.]+ points: a tournament win adds 3, a skunk win 1\./.test(c.text) &&
      /\n📋 What put Low at #4:\n• Wins: 8 ÷ \(27 games \+ 10\) × 100 = 21\.6\n• Rating: \d+ ÷ 20 = [\d.]+\n/.test(c.text) && /• vs Reg: won 7, lost 13 → \+[\d.]+\n• vs Mid: won 1, lost 6 → [−+][\d.]+$/.test(c.text) && !/Best run/.test(c.text), c);
    c = await climb("Reg");
    check("...on Reg (#1): \"How Reg stays on top\", what Ace would need - " + JSON.stringify(c.text.slice(0, 260)),
      c.text.startsWith("🧗 How Reg stays on top - #1 of 4, ⭐ MVP score: ") && /\nFor Ace \(#2, [\d.]+\) to pass Reg, it would take:\n• Beat Reg \d+ times in a row → Ace [\d.]+, Reg [\d.]+\n/.test(c.text) && !/The gap/.test(c.text), c);

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
    c = await climb("Reg", "lb_climb.png");
    check("...🧗 on Reg (#2): beat Ace 6 times, wins in a row alone not enough, by opponent, best win - " + JSON.stringify(c.text.slice(0, 700)),
      c.text.startsWith("🧗 How Reg can climb - #2 of 4, 📈 Performance: 421") && c.text.includes("\nTo pass Ace (#1, 591):\n• Beat Ace 6 times in a row → Reg 450, Ace 432\n• Wins in a row alone won't do it - even 50 isn't enough.\n(Worked out with today's ratings") &&
      c.text.includes("\n📋 What put Reg at #2:\nResults by opponent (→ what those games add to the score):\n• vs Mid (rated 419): won 25, lost 15 → +204\n• vs Ace (rated 429): won 1, lost 8 → −42\n• vs New (rated 426): won 0, lost 3 → −16\n") && /\nBest win: beat Ace \(rated 429\), .+\.\nCostliest loss: lost to Mid \(rated 419\), .+\.$/.test(c.text), c);
    check("...🧗 in colour: won green, lost red, a bit bigger; → +204 blue, bigger still - " + JSON.stringify({ spans: c.climbSpans.slice(0, 6), look: c.look }),
      ["lb-won:won 25", "lb-lost:lost 15", "lb-impact:→ +204", "lb-won:won 1", "lb-lost:lost 8", "lb-impact:→ −42"].every((x) => c.climbSpans.includes(x)) &&
      c.look.wonColor === "rgb(46, 204, 113)" && c.look.lostColor === "rgb(255, 92, 92)" && c.look.impactColor === "rgb(90, 180, 255)" &&
      c.look.won > c.look.text && c.look.lost > c.look.text && c.look.impact > c.look.won, c);
    check("...and ❓'s \"won 8 and lost 1 (+174)\" too: " + JSON.stringify(c.firstSpans), ["lb-won:won 8", "lb-lost:lost 1", "lb-won:won 26", "lb-lost:lost 26"].every((x) => c.firstSpans.includes(x)) && c.firstSpans.some((x) => /^lb-impact:\+\d+$/.test(x)), c.firstSpans);
    c = await climb("Low");
    check("...🧗 on Low (#4): \"Win 3 in a row against players rated around 419 → Low 377\"", c.text.includes("\n• Beat Mid 3 times in a row → Low 377, Mid 352\n• Win 3 in a row against players rated around 419 → Low 377\n"), c.text);
    await view("teams");
    r = await read();
    check("...Teams (" + names(r) + " - " + r.rows.map((x) => x.score).join(", ") + "): both ranked, \"" + r.note + "\"", r.rows.length === 2 && r.note === "Not counted for their team yet, rating still provisional: New (3 of 20 games).", r);
    c = await climb("Owls");
    check("...🧗 on the Owls: no beating a team, wins in a row - " + JSON.stringify(c.text.slice(0, 300)), c.text.includes("\nTo pass Sharks (#1, 421):\n• Win 2 in a row against players rated around 404 → Owls 422\n(Worked") && !/Beat /.test(c.text), c);
    await view("players");

    // ---- 🔟 Last 10 games ----
    await pick("last10");
    r = await read();
    check("🔟 Last 10 games (" + names(r) + " - " + r.rows.map((x) => x.score).join(", ") + "): Ace \"8½ / 10\" first, New not", r.rows[0].name === "Ace" && r.rows[0].score === "8½ / 10" && r.rows.length === 4 && r.rows.every((x) => / \/ 10$/.test(x.score)) && r.note === NOTE, r);
    why = await explain("Ace");
    check("...❓: \"won 8 of 9 games, + ½ for the 1 not played yet\"", /• Ace: won 8 of 9 games, \+ ½ for the 1 not played yet \(half a win each\) = 8½/.test(why), why);
    c = await climb("Ace");
    check("...🧗 on Ace (#1): what Mid would need, the 10 games themselves - " + JSON.stringify(c.text.slice(0, 400)),
      c.text.startsWith("🧗 How Ace stays on top - #1 of 4, 🔟 Last 10 games: 8½ / 10") && c.text.includes("\nFor Mid (#2, 6 / 10) to pass Ace, it would take:\n• Beat Ace 3 times in a row → Mid 8 / 10, Ace 6 / 10\n• Win the next 5 games, against anyone → Mid 9 / 10\n") &&
      c.text.includes("\nThe last 10 games, newest first:\n") && (c.text.match(/\n• ✅ .+: beat Reg/g) || []).length === 8 && (c.text.match(/\n• ❌ .+: lost to Reg/g) || []).length === 1 && c.text.endsWith("\n• 1 game not played yet: + ½"), c);

    // ---- 🌙 Best 3 nights ----
    await pick("bestNights");
    r = await read();
    check("🌙 Best 3 nights (" + names(r) + " - " + r.rows.map((x) => x.score).join(", ") + "): Ace first, Low ranked (2 nights), New not", r.rows[0].name === "Ace" && r.rows.some((x) => x.name === "Low") && !r.rows.some((x) => x.name === "New") && r.rows.every((x) => /^\d+$/.test(x.score) && x.label === "best nights") && /established rating \(20 games or more\)/.test(r.formula), r);
    why = await explain("Low");
    check("...❓ on Low: 2 nights and \"1 night not had yet, at the rating\" - " + JSON.stringify(why.slice(0, 300)), /• Low's best nights: .+ · .+ · 1 night not had yet, at the rating \d+ → \d+/.test(why), why);
    if (OUT) await page.screenshot({ path: path.join(OUT, "lb_best_nights.png"), fullPage: true });
    c = await climb("Low");
    check("...🧗 on Low: one night beating Mid 3 times, the nights and who they were against - " + JSON.stringify(c.text.slice(0, 500)),
      c.text.includes("\nTo pass Mid (#3, 385):\n• One night beating Mid 3 times in a row → Low 394, Mid 385\n• One night winning 3 in a row against players rated around 419 → Low 394\n") &&
      /\nThe 3 best nights:\n• 🌙 .+: 345 - won 1, lost 3 against opponents rated 419 on average \(Mid 1–3\)\n• 🌙 .+: 287 - won 0, lost 3 against opponents rated 419 on average \(Mid 0–3\)\n• 1 night not had yet, at the rating 309$/.test(c.text) &&
      ["lb-won:won 1", "lb-lost:lost 3", "lb-won:1", "lb-lost:3", "lb-won:won 0", "lb-won:0"].every((x) => c.climbSpans.includes(x)), c);

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
    c = await climb("Low");
    check("...🧗 in French: \"" + c.first + "\", " + JSON.stringify(c.text.slice(0, 120)), c.first === "🧗 Comment grimper et pourquoi ici" && c.button === "← Retour" && /\n📋 Ce qui a mis Low au n° \d :\nLes 3 meilleures soirées :\n/.test(c.text), c);
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
