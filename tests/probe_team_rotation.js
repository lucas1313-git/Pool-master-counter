// Winner Stays for teams (2026-11-01 request: "more than 2 teams ... managed as if they were players:
// one standby team, two playing teams, when a team loses the standby team automatically replaces
// it"; teams "A-B-C-... as many as there are players divided by 2"), at 1180x820:
// - six playing 15 Ball Rotation (Luigi and Luc both 🏷️ "Goofy"; Mike away, an old team C), then
//   🎱 Game: Teams, 8-Ball - three teams of two in turn: A Luigi & Bob, B Luc & Cat, C Ann & Dan
//   (the 🏷️ team names don't pair anyone - Luigi and Luc apart); Mike: no team, still away;
// - three teams at a two-sided game: Winner Stays goes on by itself - A v B at the table, C
//   waiting ("Next up: Ann & Dan"), the banner says so, the board's switch shown and on;
// - A wins a rack: B out, C in ("Ann & Dan are in! Luc & Cat wait their turn."), "🔥 Luigi & Bob:
//   1 in a row · Next up: Luc & Cat"; C wins: A out, B in; the standings keep all three teams;
// - ↩ Undo: back to A v C, Luc & Cat next;
// - 🎱 Game: 15 Ball Rotation (more can play it), Winner Stays off: all three teams at the table;
// - ten playing, Teams: five teams of two (A to E), two at the table, "Next up: … (then …)", the
//   team buttons A to F, "Team D" in the standings' names when nobody's on it… (labels for D on);
// - four playing, Teams: two teams (A B A B as before), no Winner Stays line;
// - no page errors.
// Its own file server on 4306.
// usage: node tests/probe_team_rotation.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4306, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function board(names, extra) {
  const players = names.map((n) => ({ id: n.toLowerCase(), name: n, playing: true, balls: 0 }));
  (extra || []).forEach((p) => players.push(p));
  return JSON.stringify({
    players, playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
    currentGame: { gameType: "15ballrotation", target: 61, unit: "points", mode: "individual", queueEnabled: false }, raceToWinsTarget: 1, rotation: { enabled: false, order: [], every: 1 }
  });
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
  let page = null;
  const open = async (state, contacts) => {
    if (page) await page.close();
    page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 820, hasTouch: true });
    await page.goto(BASE + "manifest.json");
    await page.evaluate((state, contacts) => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.state.v2", state);
      if (contacts) localStorage.setItem("poolMasterCounter.contacts.v1", contacts);
    }, state, contacts || null);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
    await sleep(700);
  };
  const st = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
  const sheet = async (mode, gameType, winnerStays) => {
    // (clicked in the page: the win banner can sit over the top bar)
    await page.evaluate(() => document.getElementById("btn-board-game").click());
    await sleep(300);
    if (mode) await page.evaluate((mode) => document.querySelector('input[name="gs-mode"][value="' + mode + '"]').click(), mode);
    if (gameType) await page.select("#gs-game-type", gameType);
    if (winnerStays !== undefined) await page.evaluate((on) => { const c = document.getElementById("gs-winner-stays"); if (c.checked !== on) c.click(); }, winnerStays);
    await page.evaluate(() => document.getElementById("btn-game-sheet-apply").click());
    await sleep(900);
  };
  const look = () => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
    const teams = {};
    s.players.forEach((p) => { if (p.teamId) (teams[p.teamId] = teams[p.teamId] || []).push(p.name); });
    const line = document.getElementById("winner-stays-line"), bn = document.getElementById("win-banner"), sw = document.getElementById("board-winner-stays");
    return {
      teams, queue: s.currentGame.queueEnabled,
      cards: [...document.querySelectorAll("#scoreboard .team-card")].map((c) => c.getAttribute("data-team-id")),
      waiting: s.players.filter((p) => p.teamId && !p.playing).map((p) => p.name),
      line: line.classList.contains("hidden") ? "" : line.textContent,
      banner: bn.classList.contains("hidden") ? "" : bn.textContent,
      switchShown: !sw.classList.contains("hidden"), switchOn: document.getElementById("board-winner-stays-checkbox").checked,
      standings: [...document.querySelectorAll("#team-standings-list li")].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
      header: (document.querySelector("#scoreboard .teams-header") || {}).textContent || ""
    };
  });
  // a team's rack - and what the win banner said (read at once: it closes by itself)
  const teamWin = async (id) => {
    await page.evaluate((id) => document.querySelector('#scoreboard .team-card[data-team-id="' + id + '"] .btn-ball.plus').click(), id);
    await sleep(700);
    const said = await page.evaluate(() => document.getElementById("win-banner").textContent);
    await page.keyboard.press("Enter").catch(() => {}); // (the balls-left row: closed)
    await sleep(400);
    return said;
  };

  // ---- six players, Luigi and Luc both "Goofy", Mike away with an old team C ----
  await open(board(["Luigi", "Luc", "Ann", "Bob", "Cat", "Dan"], [{ id: "mike", name: "Mike", playing: false, balls: 0, teamId: "C" }]), JSON.stringify({ Luigi: { clubTeam: "Goofy" }, Luc: { clubTeam: "Goofy" } }));
  await sheet("teams", "8ball");
  let a = await look();
  check("Teams with six: three teams of two in turn - A " + (a.teams.A || []).join(" & ") + ", B " + (a.teams.B || []).join(" & ") + ", C " + (a.teams.C || []).join(" & ") + " (Luigi and Luc, both 🏷️ Goofy, apart); Mike away: no team", (a.teams.A || []).join() === "Luigi,Bob" && (a.teams.B || []).join() === "Luc,Cat" && (a.teams.C || []).join() === "Ann,Dan" && !Object.values(a.teams).some((m) => m.indexOf("Mike") !== -1), a);
  check("...three teams at 8-Ball: Winner Stays on by itself - A v B (" + a.cards.join(" v ") + "), " + a.waiting.join(" & ") + " waiting, \"" + a.line + "\", the banner: \"" + a.banner.slice(0, 120) + "\", the board's switch shown and on", a.queue === true && a.cards.join() === "A,B" && a.waiting.join() === "Ann,Dan" && a.line === "Next up: Ann & Dan" && /Three teams or more: two at the table/.test(a.banner) && /Luigi & Bob v Luc & Cat, Ann & Dan wait their turn/.test(a.banner) && a.switchShown && a.switchOn, a);
  if (OUT) await page.screenshot({ path: path.join(OUT, "team_rotation_start.png") });

  const saidA = await teamWin("A");
  let b = await look();
  b.banner = saidA;
  check("A wins a rack: B out, C in (" + b.cards.join(" v ") + ") - \"" + (b.banner.match(/Ann & Dan are in![^.]*\./) || [""])[0] + "\", \"" + b.line + "\"", b.cards.join() === "A,C" && /Ann & Dan are in! Luc & Cat wait their turn\./.test(b.banner) && b.line === "🔥 Luigi & Bob: 1 in a row · Next up: Luc & Cat" && b.waiting.join() === "Luc,Cat", b);
  if (OUT) await page.screenshot({ path: path.join(OUT, "team_rotation_swap.png") });
  await teamWin("C");
  let c = await look();
  check("C wins: A out, B in (" + c.cards.join(" v ") + "), \"" + c.line + "\"; the standings keep all three teams: " + c.standings.join(" | "), c.cards.join() === "B,C" && c.line === "🔥 Ann & Dan: 1 in a row · Next up: Luigi & Bob" && c.standings.length === 3 && c.standings.some((r) => /Luigi & Bob/.test(r)) && c.standings.some((r) => /Luc & Cat/.test(r)) && c.standings.some((r) => /Ann & Dan/.test(r)), c);

  await page.evaluate(() => document.getElementById("btn-board-undo").click());
  await sleep(900);
  let u = await look();
  check("↩ Undo: back to A v C (" + u.cards.join(" v ") + "), \"" + u.line + "\"", u.cards.join() === "A,C" && /Next up: Luc & Cat$/.test(u.line) && u.waiting.join() === "Luc,Cat", u);

  await sheet(null, "15ballrotation", false);
  let f = await look();
  check("🎱 Game: 15 Ball Rotation, Winner Stays off: all three teams at the table (" + f.cards.join(", ") + "), nobody waiting", f.queue === false && f.cards.join() === "A,B,C" && f.waiting.length === 0 && !f.line, f);

  // ---- ten players: five teams ----
  await open(board(["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]));
  await sheet("teams", "9ball");
  let t = await look();
  const letters = await page.evaluate(() => { const row = document.querySelector("#roster-list .team-toggle"); return row ? [...row.querySelectorAll("button")].map((x) => x.textContent) : []; });
  check("ten players, Teams: five teams of two (" + Object.keys(t.teams).sort().map((k) => k + " " + t.teams[k].join("&")).join(", ") + "), A v B, \"" + t.line + "\", team buttons " + letters.join(" "), Object.keys(t.teams).sort().join() === "A,B,C,D,E" && Object.values(t.teams).every((m) => m.length === 2) && (t.teams.A || []).join() === "P1,P6" && t.cards.join() === "A,B" && t.line === "Next up: P3 & P8 (then P4 & P9, P5 & P10)" && letters.join("") === "ABCDE", { t, letters });
  if (OUT) await page.screenshot({ path: path.join(OUT, "team_rotation_ten.png") });

  // ---- four players: two teams, as before ----
  await open(board(["Kim", "Jo", "Ann", "Bob"]));
  await sheet("teams", "8ball");
  let four = await look();
  const fourLetters = await page.evaluate(() => { const row = document.querySelector("#roster-list .team-toggle"); return row ? [...row.querySelectorAll("button")].map((x) => x.textContent) : []; });
  const fourColumns = await page.evaluate(() => getComputedStyle(document.getElementById("scoreboard")).gridTemplateColumns.split(" ").length);
  check("four players, Teams: two teams A B A B as before (Kim & Ann - Jo & Bob), no Winner Stays line", (four.teams.A || []).join() === "Kim,Ann" && (four.teams.B || []).join() === "Jo,Bob" && four.cards.join() === "A,B" && !four.line && !four.switchShown, four);
  check("...team buttons A B only, no C (" + fourLetters.join(" ") + "), the board in two halves (" + fourColumns + " columns)", fourLetters.join("") === "AB" && fourColumns === 2, { fourLetters, fourColumns });

  // ---- six players in two threes: still only A B ----
  const threes = JSON.parse(board(["Kim", "Jo", "Ann", "Bob", "Cat", "Dan"]));
  threes.currentGame.mode = "teams";
  threes.players.forEach((p, i) => { p.teamId = i % 2 ? "B" : "A"; });
  await open(JSON.stringify(threes));
  const six = await look();
  const sixLetters = await page.evaluate(() => [...document.querySelectorAll("#roster-list .team-toggle")].map((row) => [...row.querySelectorAll("button")].map((x) => x.textContent).join("")));
  const sixColumns = await page.evaluate(() => getComputedStyle(document.getElementById("scoreboard")).gridTemplateColumns.split(" ").length);
  check("six players in two teams of three (A " + (six.teams.A || []).join(" & ") + ", B " + (six.teams.B || []).join(" & ") + "): team buttons " + sixLetters.join(" ") + " - no C, the board in two halves (" + sixColumns + " columns)", six.cards.join() === "A,B" && sixLetters.length === 6 && sixLetters.every((l) => l === "AB") && sixColumns === 2, { six, sixLetters, sixColumns });
  if (OUT) await page.screenshot({ path: path.join(OUT, "team_two_threes.png") });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
