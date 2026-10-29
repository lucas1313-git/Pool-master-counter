// League nights across devices (P23): two pages and the relay on a throwaway server (4278):
// - the host's league page and a second device (?join=1&table=1) both show the league;
// - (each device's own rating badges aside - ratings aren't relayed)
// - results recorded on both devices - "Ann beat Ben 5-3" typed on the second device, a forfeit
//   (Cat over Dan) and "Ann beat Cat 5-2" on the host - end with identical standings on both, the
//   three matches kept on the host only (the second device saves nothing of the league);
// - a forfeit is unrated (Cat's and Dan's ratings don't move);
// - the host deletes a match: both standings follow, identical;
// - ➕ Next week on the host: both say Week 2, and the next result is a week-2 match;
// - no page errors.
// usage: node tests/probe_league_relay.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4278, REAL = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LEAGUE = {
  id: "league-tue", name: "Tuesday", format: "apa8ball", isOrganizer: true, isOpen: true, createdAt: "2026-10-01T00:00:00.000Z",
  members: ["Ann", "Ben", "Cat", "Dan"].map((n) => ({ name: n, skillLevel: 5, leaguePoints: 0, matchesPlayed: 0, matchesWon: 0 })),
  matches: [], tableCount: 1, activeMatches: [], teams: [], useHandicap: false, handicapSystem: "apa", handicapBaseGames: 5
};

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-league-"));
  const server = spawn(process.execPath, [path.join(REPO, "server", "server.js")], { env: Object.assign({}, process.env, { HOME: home, PORT: String(PORT) }), stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  try {
    for (let i = 0; i < 60 && !/running on port/.test(log); i++) await sleep(150);
    const ctxGuest = await browser.createBrowserContext();
    const host = await browser.newPage();
    host.on("pageerror", (e) => errors.push("host: " + e.message));
    await host.setViewport({ width: 1180, height: 900 });
    await host.goto(REAL + "manifest.json");
    await host.evaluate((league) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.leagues.v1", JSON.stringify([league]));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: ["Ann", "Ben", "Cat", "Dan"].map((n, i) => ({ id: "p" + i, name: n, playing: i < 2, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
      localStorage.setItem("poolMasterCounter.ratings.v1", JSON.stringify({ Cat: { name: "Cat", rating: 430, gamesPlayed: 20, history: [] }, Dan: { name: "Dan", rating: 410, gamesPlayed: 20, history: [] } }));
    }, LEAGUE);
    await host.goto(REAL, { waitUntil: "networkidle2" });
    await sleep(800);
    await host.evaluate(() => document.getElementById("btn-group-session-host").click());
    await sleep(1200);
    await host.evaluate(() => document.getElementById("btn-open-league").click());
    await sleep(600);

    const guest = await ctxGuest.newPage();
    guest.on("pageerror", (e) => errors.push("guest: " + e.message));
    await guest.setViewport({ width: 1180, height: 900 });
    await guest.goto(REAL + "?join=1&table=1", { waitUntil: "networkidle2" });
    await sleep(1500);
    await guest.evaluate(() => document.getElementById("btn-open-league").click());
    await sleep(800);
    const standings = (pg) => pg.evaluate(() => [...document.querySelectorAll("#league-standings-body tr")].map((tr) => [...tr.children].slice(0, 4).map((td, i) => (i === 0 ? td.firstChild.textContent : td.querySelector("input") ? td.querySelector("input").value : td.textContent).replace(/\s+/g, " ").trim()).join("|")).join(" / "));
    const enter = async (pg, r) => {
      await pg.evaluate((r) => {
        const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event("change", { bubbles: true })); };
        set("league-result-a", r.a);
        set("league-result-b", r.b);
        set("league-result-kind", r.kind);
        if (r.kind === "played") { document.getElementById("league-result-score-a").value = r.sa; document.getElementById("league-result-score-b").value = r.sb; }
        else set("league-result-winner", r.winner);
        document.getElementById("btn-league-result-save").click();
      }, r);
      await sleep(1200);
    };
    const shown = await guest.evaluate(() => ({ guest: document.body.classList.contains("network-guest-mode"), league: !document.getElementById("view-league-page").classList.contains("hidden"), rows: document.querySelectorAll("#league-standings-body tr").length, form: document.getElementById("league-result-form").getClientRects().length > 0 }));
    check("the second device (?join=1&table=1) shows the host's league and its result form", shown.guest && shown.league && shown.rows === 4 && shown.form, shown);

    await enter(guest, { a: "Ann", b: "Ben", kind: "played", sa: 5, sb: 3 });
    const ratingsBefore = await host.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1")));
    await enter(host, { a: "Cat", b: "Dan", kind: "forfeit", winner: "Cat" });
    const ratingsAfter = await host.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.ratings.v1")));
    await enter(host, { a: "Ann", b: "Cat", kind: "played", sa: 5, sb: 2 });
    await sleep(800);
    const sh = await standings(host), sg = await standings(guest);
    const hostMatches = await host.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.leagues.v1"))[0].matches.map((m) => m.playerA + "-" + m.playerB + ":" + m.winner + (m.kind ? "(" + m.kind + ")" : "")));
    const guestSaved = await guest.evaluate(() => localStorage.getItem("poolMasterCounter.leagues.v1"));
    if (OUT) await guest.screenshot({ path: path.join(OUT, "league_second_device.png") });
    check("results on both devices (Ann-Ben typed on the second, a forfeit and Ann-Cat on the host): identical standings - " + sh, sh === sg && /Ann\|5\|4\|2-0/.test(sh) && hostMatches.length === 3, { sh, sg, hostMatches });
    check("...the three matches kept on the host; the second device saves nothing of the league", hostMatches.join() === "Ann-Ben:Ann,Cat-Dan:Cat(forfeit),Ann-Cat:Ann" && guestSaved === null, { hostMatches, guestSaved });
    check("...the forfeit is unrated: Cat's and Dan's ratings didn't move", ratingsBefore.Cat.rating === ratingsAfter.Cat.rating && ratingsBefore.Dan.rating === ratingsAfter.Dan.rating, { before: [ratingsBefore.Cat.rating, ratingsBefore.Dan.rating], after: [ratingsAfter.Cat.rating, ratingsAfter.Dan.rating] });

    // delete on the host
    await host.evaluate(() => { const row = [...document.querySelectorAll(".league-match-row")].find((li) => /Ann 5 – 3 Ben/.test(li.textContent)); row.querySelector(".league-match-delete").click(); });
    await sleep(300);
    await host.evaluate(() => document.getElementById("btn-confirm-modal-ok").click());
    await sleep(1200);
    const dh = await standings(host), dg = await standings(guest);
    check("the host deletes Ann's win over Ben: both standings follow, identical - " + dh, dh === dg && /Ben\|5\|0\|0-0/.test(dh) && dh !== sh, { dh, dg });

    // next week
    await host.click("#btn-league-next-week");
    await sleep(1200);
    const wk = [await host.evaluate(() => document.getElementById("league-season-week").textContent), await guest.evaluate(() => document.getElementById("league-season-week").textContent)];
    await enter(guest, { a: "Ben", b: "Dan", kind: "played", sa: 5, sb: 1 });
    const lastWeek = await host.evaluate(() => { const ms = JSON.parse(localStorage.getItem("poolMasterCounter.leagues.v1"))[0].matches; return ms[ms.length - 1].week; });
    check("➕ Next week on the host: both say \"" + wk[0] + "\", and the next result is a week-2 match", wk[0] === "Season 1 · Week 2" && wk[1] === wk[0] && lastWeek === 2, { wk, lastWeek });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    server.kill();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
