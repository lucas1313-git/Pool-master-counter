// 🏁 Two races at once (2026-11-01 request: "a new player coming in ... 2 parallel race-to: the one
// already started and a new one with the new player in it ... the new player playing or not shall
// define what is the race-to we are scoring"), at 1180x820:
// - Kim v Jo, 8-Ball, race to 3, Kim 2 – 1 Jo; Luc (new) takes Jo's seat (⇄): asked - "Luc hasn't
//   played in this race (Kim 2 – 1 Jo, race to 3). A second race?" - 🏁 Race 2: Luc v Kim / Luc
//   waits / Luc joins this race; Winner Stays not switched on by itself meanwhile;
// - 🏁 Race 2: Luc v Kim - the board scores race 2 (0 – 0), the top bar "🏁 Race 2 · race 1: Kim 2 –
//   1 Jo"; Luc wins a rack: race 2 Luc 1, race 1 untouched;
// - Jo back for Luc (⇄): "🏁 Back to race 1: Kim 2 – 1 Jo", the board Kim 2, Jo 1, the top bar
//   "🏁 Race 1 · race 2: Kim 0 – 1 Luc"; ↩ Undo of nothing new keeps it;
// - Kim wins race 1 (3 – 1): the race-won screen for Kim; race 2 for everyone with Winner Stays
//   (2026-11-02): Kim stays, Luc (next in line) in, Jo to the back, race 2's score kept - then every
//   rack the winner stays and the wins add up (never back to 0 - 0) till Luc wins race 2;
//   Luc 1 – 0 Kim, "🏁 Race 2 goes on: …", one race again (the top bar has no 🏁);
// - ↩ Undo this win: both races back - race 1 Kim 2 – 1 Jo on the board, race 2 waiting (Luc 1);
// - "Luc waits": race 1 goes on with Kim v Jo, "🏁 Race 1 · race 2 when Luc plays";
// - Luc set Playing in the roster (three at the table): Race 2 v Kim or v Jo; v Jo - Jo and Luc;
// - no page errors.
// Its own file server on 4307.
// usage: node tests/probe_two_races.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4307, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATE = JSON.stringify({
  players: [{ id: "kim", name: "Kim", playing: true, balls: 0 }, { id: "jo", name: "Jo", playing: true, balls: 0 }, { id: "luc", name: "Luc", playing: false, balls: 0 }],
  playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
  currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual", queueEnabled: false }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 }
});

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
  const open = async () => {
    if (page) await page.close();
    page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 820, hasTouch: true });
    await page.goto(BASE + "manifest.json");
    await page.evaluate((state) => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.state.v2", state);
    }, STATE);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
    await sleep(700);
  };
  // a rack for a player - and what the banner said, read at once
  // (keepOpen: the race-winning rack - Enter would close the race-won screen too)
  const win = async (name, keepOpen) => {
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
    await sleep(700);
    const said = await page.evaluate(() => document.getElementById("win-banner").textContent);
    if (!keepOpen) await page.keyboard.press("Enter").catch(() => {}); // (the balls-left row: closed)
    await sleep(400);
    return said;
  };
  // ⇄ on `out`'s card, `inn` from the bench
  const swap = async (out, inn) => {
    await page.evaluate((out) => [...document.querySelectorAll("#scoreboard .card-swap-btn")].find((b) => b.getAttribute("aria-label").indexOf(out) !== -1).click(), out);
    await sleep(300);
    await page.evaluate((inn) => [...document.querySelectorAll("#bench-list .bench-row")].find((b) => b.textContent.indexOf(inn) !== -1).click(), inn);
    await sleep(900);
  };
  const look = () => page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
    const name = (id) => (s.players.find((p) => p.id === id) || {}).name;
    const wins = {};
    Object.keys(s.playerWins || {}).forEach((id) => { if (s.playerWins[id]) wins[name(id)] = s.playerWins[id]; });
    const chooser = document.getElementById("tournament-chooser-overlay");
    return {
      seated: s.players.filter((p) => p.playing).map((p) => p.name), wins, queue: s.currentGame.queueEnabled, race: s.raceToWinsTarget, kind: s.currentGame.queueRaceKind || null,
      line: (s.queue || []).map(name).filter(Boolean),
      second: s.secondRace ? { active: s.secondRace.active, parked: Object.keys(s.secondRace.parked.playerWins || {}).filter((id) => s.secondRace.parked.playerWins[id]).map((id) => name(id) + " " + s.secondRace.parked.playerWins[id]).join(", ") } : null,
      status: document.getElementById("board-status").textContent,
      chooser: chooser ? { title: chooser.querySelector(".confirm-modal-message").textContent, choices: [...chooser.querySelectorAll("button")].map((b) => b.textContent) } : null,
      milestone: !document.getElementById("milestone-overlay").classList.contains("hidden") ? document.getElementById("milestone-overlay").textContent.replace(/\s+/g, " ").slice(0, 80) : ""
    };
  });

  await open();
  await win("Kim");
  await win("Jo");
  await win("Kim");
  await swap("Jo", "Luc");
  let a = await look();
  if (OUT) await page.screenshot({ path: path.join(OUT, "two_races_ask.png") });
  check("Kim 2 – 1 Jo (race to 3), Luc takes Jo's seat: asked - \"" + (a.chooser && a.chooser.title) + "\" - " + (a.chooser ? a.chooser.choices.join(" / ") : "") + "; Winner Stays not on by itself", a.chooser && a.chooser.title === "Luc hasn't played in this race (Kim 2 – 1 Jo, race to 3). A second race?" && a.chooser.choices.join("|") === "🏁 Race 2: Luc v Kim - race 1 waits|Luc waits - race 1 goes on, race 2 when Luc plays|Luc joins this race" && !a.queue, a);

  await page.evaluate(() => document.getElementById("btn-race2-with-0").click());
  await sleep(900);
  let b = await look();
  check("🏁 Race 2: Luc v Kim - at the table " + b.seated.join(" v ") + ", race 2 scored (" + JSON.stringify(b.wins) + "), race 1 waiting (" + (b.second && b.second.parked) + "), the top bar \"" + b.status + "\"", b.seated.join() === "Kim,Luc" && Object.keys(b.wins).length === 0 && b.second && b.second.active === "second" && b.second.parked === "Kim 2, Jo 1" && /🏁 Race 2 · race 1: Kim 2 – 1 Jo/.test(b.status) && !b.chooser, b);
  await win("Luc");
  let c = await look();
  check("...Luc wins a rack: race 2 " + JSON.stringify(c.wins) + ", race 1 untouched (" + (c.second && c.second.parked) + ")", JSON.stringify(c.wins) === '{"Luc":1}' && c.second.parked === "Kim 2, Jo 1" && !c.milestone, c);

  const back = await (async () => { await swap("Luc", "Jo"); return page.evaluate(() => document.getElementById("win-banner").textContent); })();
  let d = await look();
  if (OUT) await page.screenshot({ path: path.join(OUT, "two_races_back.png") });
  check("Jo back for Luc: \"" + (back.match(/🏁 Back to race 1[^)]*\)/) || [""])[0] + "\" - the board " + JSON.stringify(d.wins) + ", the top bar \"" + d.status + "\"", /🏁 Back to race 1: Kim 2 – 1 Jo \(race to 3\)/.test(back) && JSON.stringify(d.wins) === '{"Kim":2,"Jo":1}' && d.seated.join() === "Kim,Jo" && /🏁 Race 1 · race 2: Kim 0 – 1 Luc/.test(d.status) && d.second.active === "first", { back, d });

  const won = await win("Kim", true);
  await sleep(800);
  let e = await look();
  check("Kim wins race 1 (3 – 1): the race-won screen (\"" + e.milestone.slice(0, 40) + "\"); race 2 for everyone, Winner Stays - Kim stays, Luc (next in line) in: " + e.seated.join(" v ") + ", line " + e.line.join(", ") + ", race 2's score kept " + JSON.stringify(e.wins) + " (\"" + e.status + "\")", /Kim/.test(e.milestone) && e.seated.join() === "Kim,Luc" && e.line[0] === "Jo" && JSON.stringify(e.wins) === '{"Luc":1}' && !e.second && e.queue === true && e.kind === "line" && e.race === 3 && /Winner stays/.test(e.status) && !/🏁/.test(e.status), { e, won });
  const goesOn = await page.evaluate(() => document.getElementById("win-banner").textContent);
  check("...the banner: \"" + (goesOn.match(/🏁 Race 2 for everyone[^🏁✕]*/) || [""])[0].trim() + "\"", /🏁 Race 2 for everyone now, Winner Stays: Kim v Luc, Jo next \(Kim 0 – 1 Luc, race to 3\)/.test(goesOn), goesOn);

  await page.evaluate(() => document.getElementById("btn-milestone-undo").click());
  await sleep(300);
  await page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click()); // (it asks first)
  await sleep(1200);
  let f = await look();
  check("↩ Undo this win: both races back - at the table " + f.seated.join(" v ") + ", race 1 " + JSON.stringify(f.wins) + ", race 2 waiting (" + (f.second && f.second.parked) + "), Winner Stays off", f.seated.join() === "Kim,Jo" && JSON.stringify(f.wins) === '{"Kim":2,"Jo":1}' && f.second && f.second.active === "first" && f.second.parked === "Luc 1" && !f.queue, f);

  // race 1 won again, then race 2 for everyone: every rack the winner stays, the wins add up
  await win("Kim", true);
  await sleep(800);
  await page.evaluate(() => document.getElementById("btn-milestone-close").click());
  await sleep(400);
  await win("Luc");
  let h2 = await look();
  check("race 2, Winner Stays: Luc beats Kim - Kim to the back, Jo in (" + h2.seated.join(" v ") + ", line " + h2.line.join(", ") + "); the wins add up - " + JSON.stringify(h2.wins) + ", not 0 - 0", h2.seated.join() === "Jo,Luc" && h2.line[0] === "Kim" && JSON.stringify(h2.wins) === '{"Luc":2}' && !h2.milestone, h2);
  await win("Luc", true);
  await sleep(800);
  let h3 = await look();
  check("...Luc beats Jo: 3 - race 2 won (\"" + h3.milestone.slice(0, 40) + "\"), a new race (" + JSON.stringify(h3.wins) + "), Winner Stays on: " + h3.seated.join(" v ") + ", line " + h3.line.join(", "), /Luc/.test(h3.milestone) && JSON.stringify(h3.wins) === "{}" && h3.queue === true && h3.seated.join() === "Kim,Luc" && h3.line[0] === "Jo" && !h3.second, h3);

  // "Luc waits": race 1 goes on
  await open();
  await win("Kim");
  await swap("Jo", "Luc");
  await page.evaluate(() => document.getElementById("btn-race2-waits").click());
  await sleep(900);
  let g = await look();
  check("Luc waits: race 1 goes on - " + g.seated.join(" v ") + " " + JSON.stringify(g.wins) + ", \"" + g.status + "\"", g.seated.join() === "Kim,Jo" && JSON.stringify(g.wins) === '{"Kim":1}' && g.second && g.second.active === "first" && /🏁 Race 1 · race 2 when Luc plays/.test(g.status), g);
  await win("Kim");
  await win("Kim", true);
  await sleep(800);
  let w2 = await look();
  check("...Kim wins race 1: not a fresh 0 - 0 with Kim v Jo - race 2 for everyone: Kim stays, Luc (next in line) in (" + w2.seated.join(" v ") + ", line " + w2.line.join(", ") + "), Winner Stays", /Kim/.test(w2.milestone) && w2.seated.join() === "Kim,Luc" && w2.line[0] === "Jo" && w2.queue === true && w2.kind === "line" && !w2.second, w2);

  // Luc set Playing in the roster (three at the table): a race 2 against either
  await open();
  await win("Kim");
  await page.evaluate(() => [...document.querySelectorAll("#roster-list li")].find((li) => /Luc/.test(li.textContent)).querySelector(".btn-playing").click());
  await sleep(900);
  let h = await look();
  await page.evaluate(() => document.getElementById("btn-race2-with-1").click());
  await sleep(900);
  let i = await look();
  check("Luc set Playing in the roster: " + (h.chooser ? h.chooser.choices.slice(0, 2).join(" / ") : "-") + "; Luc v Jo - " + i.seated.join(" v ") + ", race 1 waiting (" + (i.second && i.second.parked) + ")", h.chooser && h.chooser.choices[0] === "🏁 Race 2: Luc v Kim - race 1 waits" && h.chooser.choices[1] === "🏁 Race 2: Luc v Jo - race 1 waits" && !h.queue && i.seated.join() === "Jo,Luc" && i.second && i.second.active === "second" && i.second.parked === "Kim 1", { h, i });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
