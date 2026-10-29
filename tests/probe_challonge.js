// Challonge pushes on screen, against a fake Challonge (tests/challonge_mock.js) answering the
// app's calls inside the browser - nothing reaches the real one:
// - a day's games: Review Before Pushing lists exactly what goes ("➕ Ann 2–1 Bob", ...) and says
//   the pairs that haven't played aren't sent; Push sends just that, to a private tournament named
//   "<venue> — <date> — Open play" (the venue typed in the ☁️ Challonge panel);
// - more games later: the list shows the update ("✏️ ... Challonge has Ann 2–1 Bob"), the new pair,
//   and "✓ already on Challonge"; Push sends the 2 changes only;
// - 🔒 Close Tournament: a confirm names the never-played pairs, then they go as 1-1 ties and it
//   closes; a game unticked after it was sent shows as "⚠️ ... fix it on Challonge" and stays
//   unticked after Push;
// - a round robin tournament: ☁️ Push opens the same dialog for the tournament (no date, no games
//   list), its 2 played matches and nothing for the rest;
// - a Race to 2: nothing goes to Challonge by itself; the 🏆 screen's ☁️ button, after a confirm,
//   sends it as its own closed tournament (public, the panel's Private unticked), and the day's
//   push then leaves its games out;
// - no page errors.
// Its own file server on 4253.
// usage: node tests/probe_challonge.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { createFakeChallonge } = require("./challonge_mock");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4253, BASE = "http://localhost:" + PORT + "/";
const PROXY = "https://pool-master-counter-challonge-proxy.poolmastercounter.workers.dev/v2.1";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 700) : "")); if (!ok) fails++; }
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
  const fake = createFakeChallonge("jsonapi");
  const elsewhere = [];
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const url = req.url();
    if (url.startsWith(BASE)) return req.continue();
    if (url.startsWith(PROXY)) {
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS" } });
      const body = req.postData() ? JSON.parse(req.postData()) : undefined;
      const res = await fake.api(req.method(), url.slice(PROXY.length), body);
      return req.respond({ status: res.status, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(res.body || {}) });
    }
    elsewhere.push(url);
    req.abort();
  });
  const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(350); };
  const visible = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.classList.contains("hidden") && e.getClientRects().length > 0; }, id);
  const planShown = () => page.evaluate(() => ({
    lines: [...document.querySelectorAll("#challonge-push-review-matchups li")].map((li) => li.textContent),
    note: document.getElementById("challonge-push-review-plan-note").textContent,
    games: document.querySelectorAll("#challonge-push-review-games-list input[type=checkbox]").length,
    gameText: document.getElementById("challonge-push-review-games-list").textContent,
    dateRow: !document.getElementById("challonge-push-date-input").parentNode.classList.contains("hidden"),
    dayPart: !document.getElementById("challonge-push-review-day-part").classList.contains("hidden"),
    summary: document.getElementById("challonge-push-review-summary").textContent,
    close: !document.getElementById("btn-challonge-close-tournament").classList.contains("hidden")
  }));
  const waitStatus = async (re) => {
    for (let i = 0; i < 40; i++) {
      const s = await page.evaluate(() => document.getElementById("challonge-push-review-status").textContent);
      if (re.test(s)) return s;
      await sleep(150);
    }
    return page.evaluate(() => document.getElementById("challonge-push-review-status").textContent);
  };
  const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
  const g = (w, l, m) => ({ ts: minutesAgo(m), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: [w], opponentNames: [l], winnerIds: ["x"], isTeam: false, summary: w + " won 8-Ball" });
  const players = ["Ann", "Bob", "Cat", "Dan"].map((n, i) => ({ id: "p" + i, name: n, playing: true, balls: 0 }));
  const stateWith = (games) => ({ players, playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: games, gamesPlayedCount: games.length,
    currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 } });

  // ---- a day's games ----
  await page.goto(BASE + "manifest.json");
  await page.evaluate((state) => {
    localStorage.clear();
    localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
    localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
    localStorage.setItem("poolMasterCounter.challongeClientId.v1", "probe-client-id");
    localStorage.setItem("poolMasterCounter.challongeClientSecret.v1", "probe-client-secret");
    localStorage.setItem("poolMasterCounter.challongeToken.v2", JSON.stringify({ access_token: "probe-token", expires_at: Date.now() + 30 * 864e5 }));
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(state));
  }, stateWith([g("Cat", "Dan", 6), g("Ann", "Bob", 7), g("Bob", "Ann", 8), g("Ann", "Bob", 9)]));
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  const panel = await page.evaluate(() => {
    const v = document.getElementById("challonge-venue-input");
    v.value = "Joe's Bar";
    v.dispatchEvent(new Event("change"));
    return { venueLeague: document.getElementById("challonge-venue-input-league").value, priv: document.getElementById("challonge-private-checkbox").checked };
  });
  check("☁️ Challonge panel: Private ticked by default; the venue typed in one panel shows in the League one too", panel.priv && panel.venueLeague === "Joe's Bar", panel);
  await page.evaluate(() => document.getElementById("btn-day-report-push-challonge").click());
  await sleep(500);
  let shown = await planShown();
  check("Review Before Pushing (a day): the date, 4 games, and exactly what goes: \"➕ Ann 2–1 Bob\", \"➕ Cat 1–0 Dan\"",
    shown.dateRow && shown.dayPart && shown.games === 4 && JSON.stringify(shown.lines) === JSON.stringify(["➕ Ann 2–1 Bob", "➕ Cat 1–0 Dan"]), shown);
  check("...and says the 4 pairs who haven't played aren't sent (🔒 Close asks first)", /4 pairs haven't played each other\. Nothing is sent for them/.test(shown.note) && !shown.close, shown.note);
  if (OUT) await page.screenshot({ path: path.join(OUT, "review_day.png") });
  await page.click("#btn-challonge-push-confirm");
  let status = await waitStatus(/pushed/);
  let ct = fake.latest();
  check("Push: \"2 match scores pushed\"; Challonge has the 2 results only, a private tournament named \"Joe's Bar — <date> — Open play\"",
    /2 match scores pushed/.test(status) && JSON.stringify(fake.results(ct)) === JSON.stringify(["Ann 2-1 Bob", "Cat 1-0 Dan"]) && ct.private === true && /^Joe's Bar — \d{4}-\d\d-\d\d — Open play$/.test(ct.name),
    { status, results: ct && fake.results(ct), name: ct && ct.name, private: ct && ct.private });

  // ---- more games later ----
  await page.evaluate((more) => {
    const st = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
    st.gameHistory = more.concat(st.gameHistory);
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(st));
  }, [g("Ann", "Cat", 2), g("Bob", "Ann", 3)]);
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  await page.evaluate(() => document.getElementById("btn-day-report-push-challonge").click());
  await sleep(500);
  shown = await planShown();
  check("later, 2 more games: \"✏️ Ann 2–2 Bob (tie) — Challonge has Ann 2–1 Bob\", \"➕ Ann 1–0 Cat\", \"✓ Cat 1–0 Dan — already on Challonge\"",
    JSON.stringify(shown.lines) === JSON.stringify(["✏️ Ann 2–2 Bob (tie) — Challonge has Ann 2–1 Bob", "➕ Ann 1–0 Cat", "✓ Cat 1–0 Dan — already on Challonge"]) && shown.close, shown);
  if (OUT) await page.screenshot({ path: path.join(OUT, "review_update.png") });
  const logBefore = fake.log.length;
  await page.click("#btn-challonge-push-confirm");
  status = await waitStatus(/pushed/);
  check("...Push sends those 2 only", /2 match scores pushed/.test(status) && fake.log.length - logBefore === 2 && fake.results(ct).includes("Ann 2-2 Bob tie") && fake.results(ct).includes("Ann 1-0 Cat"), { status, sent: fake.log.length - logBefore, results: fake.results(ct) });

  // ---- 🔒 Close ----
  await page.click("#btn-challonge-close-tournament");
  await sleep(400);
  const ask = await page.evaluate(() => ({ shown: !document.getElementById("confirm-modal-overlay").classList.contains("hidden"), text: document.getElementById("confirm-modal-message").textContent }));
  check("🔒 Close Tournament asks first, naming the 3 never-played pairs (sent as 1–1 ties, not a real result)",
    ask.shown && /3 pairs never played each other/.test(ask.text) && /not a real result/.test(ask.text) && ["Ann – Dan", "Bob – Cat", "Bob – Dan"].every((p) => ask.text.includes("• " + p)), ask);
  if (OUT) await page.screenshot({ path: path.join(OUT, "close_confirm.png") });
  await page.click("#btn-confirm-modal-ok");
  status = await waitStatus(/closed/i);
  check("...OK: the 3 ties go, the tournament closes on Challonge", ct.state === "complete" && fake.results(ct).filter((s) => / 1-1 .* tie$/.test(s)).length === 3 && /3 never-played pairs sent as 1–1 ties/.test(status), { status, state: ct.state, results: fake.results(ct) });
  // a game left out after it was sent: shown as something to fix on Challonge; still left out after Push
  await page.evaluate(() => {
    const box = [...document.querySelectorAll("#challonge-push-review-games-list label")].find((l) => /Ann won 8-Ball against Cat/.test(l.textContent)).querySelector("input");
    box.click();
  });
  await sleep(300);
  shown = await planShown();
  check("unticking Ann's win over Cat (already sent): \"⚠️ Ann – Cat: Challonge has Ann 1–0 Cat, but that's no longer a result here\"",
    shown.lines.some((l) => l.startsWith("⚠️ Ann – Cat: Challonge has Ann 1–0 Cat, but that's no longer a result here")), shown.lines);
  await page.click("#btn-challonge-push-confirm");
  status = await waitStatus(/pushed/);
  const stillOut = await page.evaluate(() => !([...document.querySelectorAll("#challonge-push-review-games-list label")].find((l) => /Ann won 8-Ball against Cat/.test(l.textContent)).querySelector("input").checked));
  check("...after Push the game is still unticked, and the result says 1 result on Challonge needs fixing there", stillOut && /1 result on Challonge is no longer a result here/.test(status), { stillOut, status });
  await page.click("#btn-challonge-push-review-close");
  await sleep(300);

  // ---- a round robin tournament ----
  const tournamentsBefore = Object.keys(fake.tournaments).length;
  await page.evaluate(() => document.getElementById("btn-open-tournament").click());
  await sleep(500);
  await tap('input[name="tournament-format"][value="roundrobin"]');
  await tap("#btn-tournament-setup-next");
  await tap("#btn-tournament-setup-next");
  const checked = await page.evaluate(() => [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].filter((c) => c.checked).length);
  if (checked < 4) await tap("#tournament-select-all-checkbox");
  await tap("#btn-tournament-setup-next");
  await tap("#btn-tournament-start");
  await sleep(800);
  const tourney = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
  for (let guard = 0; guard < 80; guard++) {
    const t = await tourney();
    if (t && t.matches.filter((m) => m.winner).length >= 2) break;
    await page.evaluate(() => {
      // (any popup in the way: its main button - the rack popup, a match win, ...)
      for (let i = 0; i < 6; i++) {
        const o = [...document.querySelectorAll("[id$='-overlay']")].find((x) => !x.classList.contains("hidden") && getComputedStyle(x).display !== "none" && x.getClientRects().length > 0);
        const b = o && [...o.querySelectorAll("button.btn-primary")].find((x) => x.getClientRects().length > 0 && !x.closest(".hidden"));
        if (!b) break;
        b.click();
      }
      const plus = [...document.querySelectorAll(".btn-ball.plus")].find((x) => x.offsetParent && !x.disabled);
      if (plus) { plus.click(); return; }
      const play = [...document.querySelectorAll("button")].find((x) => x.offsetParent && !x.disabled && x.textContent.trim() === "Play");
      if (play) play.click();
    });
    await sleep(400);
  }
  await page.evaluate(() => document.querySelectorAll(".milestone-overlay:not(.hidden) .btn-primary").forEach((b) => b.click()));
  await sleep(300);
  await page.evaluate(() => document.getElementById("btn-tournament-push-challonge").click());
  await sleep(500);
  shown = await planShown();
  const played = (await tourney()).matches.filter((m) => m.winner).length;
  check("a round robin tournament (" + played + " of 6 played): ☁️ Push opens the dialog for it - no date, no games list - " + played + " \"➕\" lines, and nothing yet for Challonge",
    !shown.dateRow && !shown.dayPart && /Round Robin, 4 players/.test(shown.summary) && shown.lines.length === played && shown.lines.every((l) => /^➕ /.test(l)) && Object.keys(fake.tournaments).length === tournamentsBefore, shown);
  check("...the unplayed matches aren't sent (the note says Close asks first)", new RegExp((6 - played) + " pairs haven't played").test(shown.note), shown.note);
  if (OUT) await page.screenshot({ path: path.join(OUT, "review_tournament.png") });
  await page.click("#btn-challonge-push-confirm");
  status = await waitStatus(/pushed/);
  ct = fake.latest();
  check("...Push: a round robin on Challonge with those " + played + " results, the other " + (6 - played) + " open; named \"Joe's Bar — <date> — Round Robin\"",
    fake.results(ct).length === played && ct.matches.filter((m) => m.state === "open").length === 6 - played && /^Joe's Bar — .* — Round Robin$/.test(ct.name), { status, name: ct.name, results: fake.results(ct) });
  await page.click("#btn-challonge-push-review-close");
  await sleep(300);
  // (Abandon lives in ⋯ More while it runs)
  await page.evaluate(() => { document.getElementById("btn-tournament-more").click(); const b = document.getElementById("btn-tournament-menu-abandon"); if (b) b.click(); });
  await sleep(300);
  await page.evaluate(() => document.querySelectorAll(".confirm-modal-overlay:not(.hidden) .btn-primary").forEach((b) => b.click()));
  await sleep(500);

  // ---- a Race to 2 ----
  await page.evaluate(() => {
    const box = document.getElementById("challonge-private-checkbox-league");
    box.checked = false;
    box.dispatchEvent(new Event("change"));
  });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  const before = Object.keys(fake.tournaments).length;
  await page.evaluate(() => document.getElementById("btn-quick-game").click());
  await sleep(300);
  await page.evaluate(() => { document.getElementById("quick-game-race-raceto").checked = true; const n = document.getElementById("quick-game-race-to"); n.value = "2"; n.dispatchEvent(new Event("input")); n.dispatchEvent(new Event("change")); });
  await page.type("#quick-game-player1", "Kim");
  await page.type("#quick-game-player2", "Jo");
  await page.click("#btn-quick-game-start");
  await sleep(700);
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for Kim")).click());
    await sleep(350);
    if (await visible("gamewin-overlay")) await page.click("#btn-gamewin-close");
    await sleep(900);
    await page.evaluate(() => document.querySelectorAll(".onhill-overlay:not(.hidden) .btn-primary").forEach((b) => b.click()));
  }
  await sleep(600);
  const race = await page.evaluate(() => ({ milestone: !document.getElementById("milestone-overlay").classList.contains("hidden"), button: !document.getElementById("btn-milestone-challonge").classList.contains("hidden") }));
  check("Race to 2 won: nothing went to Challonge by itself; the 🏆 screen offers ☁️ Push this race to Challonge", race.milestone && race.button && Object.keys(fake.tournaments).length === before, { race, tournaments: Object.keys(fake.tournaments).length - before });
  if (OUT) await page.screenshot({ path: path.join(OUT, "race_won.png") });
  await page.click("#btn-milestone-challonge");
  await sleep(400);
  const raceAsk = await page.evaluate(() => document.getElementById("confirm-modal-message").textContent);
  check("...it asks first, listing the result (\"➕ Kim 2–0 Jo\")", /as its own tournament, and close it there/.test(raceAsk) && raceAsk.includes("➕ Kim 2–0 Jo"), raceAsk);
  await page.click("#btn-confirm-modal-ok");
  for (let i = 0; i < 30 && Object.keys(fake.tournaments).length === before; i++) await sleep(150);
  await sleep(800);
  ct = fake.latest();
  check("...OK: its own tournament, \"Joe's Bar — Race to 2 (Kim, <date>)\", public (Private unticked), Kim 2-0 Jo, closed",
    Object.keys(fake.tournaments).length === before + 1 && /^Joe's Bar — Race to 2 \(Kim, \d{4}-\d\d-\d\d\)$/.test(ct.name) && ct.private === false && JSON.stringify(fake.results(ct)) === JSON.stringify(["Jo 0-2 Kim"]) && ct.state === "complete",
    { name: ct && ct.name, private: ct && ct.private, results: ct && fake.results(ct), state: ct && ct.state });
  await page.click("#btn-milestone-close");
  await sleep(400);
  await page.evaluate(() => document.getElementById("btn-day-report-push-challonge").click());
  await sleep(500);
  shown = await planShown();
  check("the day's push now leaves the race's games out (sent with the race)", shown.games === 6 && !/Kim/.test(shown.gameText), { games: shown.games, text: shown.gameText.slice(0, 300) });

  check("nothing went anywhere but this page and the fake Challonge", elsewhere.filter((u) => /challonge/i.test(u)).length === 0, elsewhere);
  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
