// The Fargo Fair-Match race (P32), an 8-ball race to 9, "Use ratings to balance the race" on:
// - FargoRate on, Kim (Fargo 600) and Jo (Fargo 500) both linked: FargoRate's chart - Kim races
//   to 9, Jo to 5 - "Race to 5 · Fargo 500" on Jo's card, "Fargo Fair-Match" on the board;
// - a 200-point gap (Jo 400): 9 and 2, FargoRate's chart (the app's own math would say 3);
// - Jo not linked: the app's own ratings (Kim 500, Jo 300 here: 9 and 3), "Balanced race";
// - both linked but FargoRate off: the app's ratings too - then switched on (the Contact Sheet's
//   "Use real FargoRate ratings"): Fargo;
// - the hint under the setting shows only with FargoRate on;
// - a tournament (single elimination, fair races): a match between two linked players gets the
//   chart's races (9 and 5), its cards say "Fargo"; one without a link: the app's ratings;
// - nothing sent to FargoRate (every request off this server is blocked and counted);
// - no page errors.
// Its own file server on 4289.
// usage: node tests/probe_fargo_race.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4289, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

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
  const errors = [], outside = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    // (never FargoRate itself: anything off this server is blocked)
    await page.setRequestInterception(true);
    page.on("request", (r) => { if (r.url().startsWith(BASE) || r.url().startsWith("data:") || r.url().startsWith("blob:")) r.continue(); else { outside.push(r.url()); r.abort(); } });

    // contacts: name -> { fargo rating } (null: not linked)
    async function load(fargo, opts) {
      opts = opts || {};
      await page.goto(BASE + "manifest.json");
      await page.evaluate((fargo, opts) => {
        localStorage.clear();
        localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
        localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
        localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
        localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
        localStorage.setItem("poolMasterCounter.fargoEnabled.v1", opts.fargoOff ? "0" : "1");
        const contacts = {};
        Object.keys(fargo).forEach((n, i) => { if (fargo[n]) contacts[n] = { email: "", phone: "", fargoId: String(1000 + i), fargoName: n, fargoRating: fargo[n], fargoFetchedAt: Date.now() }; });
        localStorage.setItem("poolMasterCounter.contacts.v1", JSON.stringify(contacts));
        // the app's own ratings: Kim 500, Jo 300
        localStorage.setItem("poolMasterCounter.ratings.v1", JSON.stringify({ Kim: { rating: 500, gamesPlayed: 40 }, Jo: { rating: 300, gamesPlayed: 40 } }));
        localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "pa", name: "Kim", playing: !opts.tournament, balls: 0 }, { id: "pb", name: "Jo", playing: !opts.tournament, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 9, fairRaceEnabled: !opts.tournament, fairRaceTargets: null, rotation: { enabled: false, order: [], every: 1 } }));
      }, fargo, opts);
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(800);
    }
    const board = () => page.evaluate(() => {
      const notes = {};
      document.querySelectorAll("#scoreboard .player-panel").forEach((p) => {
        const name = p.querySelector(".player-name, h2, h3");
        const note = p.querySelector(".fair-race-note");
        notes[(p.textContent.match(/Kim|Jo/) || ["?"])[0]] = note ? note.textContent : "";
      });
      const hint = document.getElementById("fair-race-fargo-hint");
      return { notes, status: document.getElementById("board-status").textContent, hint: !!hint && !hint.classList.contains("hidden") };
    });

    await load({ Kim: 600, Jo: 500 });
    let b = await board();
    if (OUT) await page.screenshot({ path: path.join(OUT, "fargo_race_board.png") });
    check("Kim Fargo 600, Jo Fargo 500, race to 9: Kim " + b.notes.Kim + ", Jo " + b.notes.Jo + " - \"Fargo Fair-Match\" on the board", b.notes.Kim === "Race to 9 · Fargo 600" && b.notes.Jo === "Race to 5 · Fargo 500" && /Fargo Fair-Match/.test(b.status) && !/Balanced race/.test(b.status), b);
    check("...the hint under \"Use ratings to balance the race\" shows (FargoRate on)", b.hint, b);

    await load({ Kim: 600, Jo: 400 });
    b = await board();
    check("a 200-point gap (Jo 400): " + b.notes.Kim + " / " + b.notes.Jo + " (FargoRate's chart)", b.notes.Kim === "Race to 9 · Fargo 600" && b.notes.Jo === "Race to 2 · Fargo 400", b);

    await load({ Kim: 600, Jo: null });
    b = await board();
    check("Jo not linked: the app's own ratings (500 v 300) - " + b.notes.Kim + " / " + b.notes.Jo + ", \"Balanced race\"", b.notes.Kim === "Race to 9" && b.notes.Jo === "Race to 3" && /Balanced race/.test(b.status) && !/Fargo/.test(b.status), b);

    await load({ Kim: 600, Jo: 500 }, { fargoOff: true });
    b = await board();
    check("both linked, FargoRate off: the app's ratings - " + b.notes.Kim + " / " + b.notes.Jo + "; no hint", b.notes.Kim === "Race to 9" && b.notes.Jo === "Race to 3" && /Balanced race/.test(b.status) && !b.hint, b);
    await page.evaluate(() => { const c = document.getElementById("fargo-enabled-checkbox"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
    await sleep(500);
    b = await board();
    check("...FargoRate switched on (Contact Sheet): Fargo Fair-Match - " + b.notes.Kim + " / " + b.notes.Jo, b.notes.Kim === "Race to 9 · Fargo 600" && b.notes.Jo === "Race to 5 · Fargo 500" && /Fargo Fair-Match/.test(b.status) && b.hint, b);

    // ---- a tournament ----
    const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(350); };
    async function tournament(fargo) {
      await load(fargo, { tournament: true });
      await page.evaluate(() => document.getElementById("btn-open-tournament").click());
      await sleep(500);
      await tap('input[name="tournament-format"][value="single"]');
      await tap("#btn-tournament-setup-next");
      await page.evaluate(() => {
        const i = document.getElementById("tournament-race-to");
        i.value = 9; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true }));
        const f = document.getElementById("tournament-fair-race-checkbox");
        if (!f.checked) f.click();
      });
      await tap("#btn-tournament-setup-next");
      const checked = await page.evaluate(() => [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].filter((c) => c.checked).length);
      if (checked < 2) await tap("#tournament-select-all-checkbox");
      await tap("#btn-tournament-setup-next");
      await page.evaluate(() => { const r = document.querySelector('input[name="tournament-seed-mode"][value="manual"]'); if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); } });
      await tap("#btn-tournament-start");
      await sleep(800);
      let t = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
      if (t && !(t.activeMatches || []).length) {
        await page.evaluate(() => { const b = [...document.querySelectorAll(".tournament-play-btn, #tournament-ready-list button.btn-primary")].find((x) => x.offsetParent); if (b) b.click(); });
        await sleep(600);
        t = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
      }
      const a = t && t.activeMatches && t.activeMatches[0];
      const m = a && t.wb[0].find((x) => x.id === a.matchId);
      const races = m ? { [m.a]: a.raceToA, [m.b]: a.raceToB } : null;
      const notes = await page.evaluate(() => [...document.querySelectorAll("#tournament-current-match-panel .fair-race-note")].map((x) => x.textContent).sort());
      return { fair: t && t.fairRace, races, notes };
    }
    let tr = await tournament({ Kim: 600, Jo: 500 });
    if (OUT) await page.screenshot({ path: path.join(OUT, "fargo_race_tournament.png") });
    check("a tournament match, both linked (600 v 500), fair races: Kim " + (tr.races && tr.races.Kim) + ", Jo " + (tr.races && tr.races.Jo) + " - the cards: " + tr.notes.join(" | "), tr.fair && tr.races && tr.races.Kim === 9 && tr.races.Jo === 5 && tr.notes.join("|") === "Race to 5 · Fargo 500|Race to 9 · Fargo 600", tr);
    tr = await tournament({ Kim: 600, Jo: null });
    check("...Jo not linked: the app's ratings (500 v 300) - Kim " + (tr.races && tr.races.Kim) + ", Jo " + (tr.races && tr.races.Jo), tr.fair && tr.races && tr.races.Kim === 9 && tr.races.Jo === 3 && tr.notes.join("|") === "Race to 3|Race to 9", tr);
  } finally {
    check("nothing sent to FargoRate (or anywhere else off this server)", outside.length === 0, outside);
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
