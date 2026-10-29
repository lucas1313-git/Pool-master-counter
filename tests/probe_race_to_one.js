// A race to 1 is no race: Quick Game's "🎱 Open play" and Current Session's "🎯 Single Game"
// keep a running tally of wins - no "won the tournament" popup, no fanfare, no new session, no
// tournament in the stats, no 🏁. Quick Game's "🏁 Race to [n]" is a real race (milestone exactly
// at n), remembered for next time; counts read "1 win", not "1 wins".
// The fanfare is spotted by counting Web Audio oscillators: a plain win makes ~18, Ode to Joy ~78.
// Serves the repo itself on 4245 (static files, like the GitHub site).
// usage: node tests/probe_race_to_one.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4245, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 820 }, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.__osc = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { const make = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__osc++; return make.apply(this, arguments); }; }
  });
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(700);

  const visible = (id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.classList.contains("hidden"); }, id);
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")));
  const cardNumber = (name) => page.evaluate((name) => {
    const plus = [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label") === "Add point for " + name);
    const card = plus && plus.closest(".player-panel");
    const v = card && card.querySelector(".stat-value");
    const l = card && card.querySelector(".stat-label");
    return v ? { value: v.childNodes[0].textContent.trim(), flag: v.textContent.indexOf("🏁") !== -1, label: l ? l.textContent : "" } : null;
  }, name);
  // one rack: + for that player, then "Nice!" on the rack popup; reports what showed up
  const winRack = async (name) => {
    const before = await page.evaluate(() => window.__osc);
    await page.evaluate((name) => [...document.querySelectorAll("#scoreboard button.btn-ball.plus")].find((b) => b.getAttribute("aria-label") === "Add point for " + name).click(), name);
    await sleep(350);
    const rackPopup = await visible("gamewin-overlay");
    if (rackPopup) await page.click("#btn-gamewin-close");
    await sleep(1600); // (the fanfare starts about a second after the announcement)
    const milestone = await visible("milestone-overlay");
    const headline = milestone ? await page.evaluate(() => document.getElementById("milestone-headline").textContent) : "";
    // (anything else that chained on - On the Hill etc. - out of the way)
    await page.evaluate(() => {
      document.querySelectorAll(".confirm-modal-overlay:not(.hidden), .onhill-overlay:not(.hidden)").forEach((o) => { const b = o.querySelector(".btn-primary"); if (b) b.click(); });
    });
    return { rackPopup, milestone, headline, osc: (await page.evaluate(() => window.__osc)) - before };
  };
  const closeMilestone = async () => { if (await visible("milestone-overlay")) { await page.click("#btn-milestone-close"); await sleep(400); } };
  const quickGame = async (opts) => {
    await page.evaluate(() => document.getElementById("btn-quick-game").click());
    await sleep(300);
    const shown = await page.evaluate(() => ({
      raceTo: document.getElementById("quick-game-race-raceto").checked,
      open: document.getElementById("quick-game-open-play").checked,
      n: document.getElementById("quick-game-race-to").value,
      text: document.querySelector(".quick-game-race-row").textContent.replace(/\s+/g, " ").trim()
    }));
    if (opts.open) await page.click("#quick-game-open-play");
    if (opts.race) {
      await page.click("#quick-game-race-to");
      await sleep(150); // (a tap selects the number, so typing replaces it)
      await page.keyboard.type(String(opts.race));
    }
    await page.type("#quick-game-player1", opts.names[0]);
    await page.type("#quick-game-player2", opts.names[1]);
    await page.click("#btn-quick-game-start");
    await sleep(700);
    return shown;
  };

  // ---- Quick Game: Open play ----
  const first = await quickGame({ open: true, names: ["Alex", "Sam"] });
  check("Quick Game asks: \"🏁 Race to [5] wins\" (picked) or \"🎱 Open play (no race)\"", first.raceTo && !first.open && first.n === "5" && /Race to\s*wins/.test(first.text) && /Open play \(no race\)/.test(first.text), first);
  const racks = [];
  for (let i = 0; i < 5; i++) racks.push(await winRack("Alex"));
  check("Open play, 5 racks for Alex: no \"won the tournament\" popup, ever", racks.every((r) => !r.milestone), racks);
  check("...no fanfare: every rack makes a plain win's sound (under 40 oscillators)", racks.every((r) => r.osc > 0 && r.osc < 40), racks.map((r) => r.osc));
  let a = await cardNumber("Alex"), s = await cardNumber("Sam");
  check("...the board keeps the tally: Alex 5, Sam 0, labelled \"Racks\" (no \"/ n\" - no race), no 🏁", a && a.value === "5" && s && s.value === "0" && a.label === "Racks" && !a.flag, { a, s });
  let st = await state();
  check("...one session, 5 games, none a race win (no tournament in the stats)", st.gameHistory.length === 5 && st.gameHistory.every((g) => !g.wonRace), st.gameHistory.map((g) => g.wonRace));
  const summary = await page.evaluate(() => document.getElementById("standings-panel-summary") ? document.getElementById("standings-panel-summary").textContent : "");
  check("...standings say \"Alex leads with 5 wins.\" (no \"race to 1\")", /Alex leads with 5 wins\./.test(summary) && !/race to/i.test(summary), summary);
  if (OUT) await page.screenshot({ path: path.join(OUT, "open_play_5_racks.png") });

  // ---- Quick Game: Race to 3 (and the choice is remembered) ----
  const second = await quickGame({ race: 3, names: ["Kim", "Jo"] });
  check("Quick Game remembers the last choice: Open play is picked this time", second.open && !second.raceTo, second);
  const race = [];
  for (let i = 0; i < 3; i++) race.push(await winRack("Kim"));
  check("Race to 3: no milestone after racks 1 and 2", !race[0].milestone && !race[1].milestone, race);
  check("...the milestone exactly at 3: \"Kim won the tournament with 3 wins! (race-to 3)\", with the fanfare", race[2].milestone && /Kim won the tournament with 3 wins! \(race-to 3\)/.test(race[2].headline) && race[2].osc >= 40, race[2]);
  st = await state();
  await closeMilestone();
  check("...Racing to shows 3 on the scoreboard", await page.evaluate(() => { const i = document.querySelector(".racing-to-input"); return !!i && i.value === "3"; }));
  await page.evaluate(() => document.getElementById("btn-quick-game").click());
  await sleep(300);
  const third = await page.evaluate(() => ({ raceTo: document.getElementById("quick-game-race-raceto").checked, n: document.getElementById("quick-game-race-to").value }));
  check("...and next time Quick Game offers \"Race to 3\"", third.raceTo && third.n === "3", third);
  await page.click("#btn-quick-game-cancel");
  await sleep(200);

  // ---- Current Session: Single Game ----
  await page.evaluate(() => {
    const r = document.getElementById("race-mode-single");
    r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(400);
  const single = [];
  for (let i = 0; i < 2; i++) single.push(await winRack("Kim"));
  a = await cardNumber("Kim");
  check("Single Game (Current Session): 2 racks, no popup, no fanfare, tally Kim 2, labelled \"Racks\"", single.every((r) => !r.milestone && r.osc < 40) && a && a.value === "2" && a.label === "Racks", { single, a });

  // ---- "1 win", not "1 wins": the leaderboard ranks 10+ games, so Lee wins one race to 2
  // against Max, then open play: Max wins 1 of his 10 games ----
  await quickGame({ race: 2, names: ["Lee", "Max"] });
  for (let i = 0; i < 2; i++) await winRack("Lee");
  await closeMilestone();
  await quickGame({ open: true, names: ["Lee", "Max"] });
  await winRack("Max");
  for (let i = 0; i < 7; i++) await winRack("Lee");
  await page.evaluate(() => document.getElementById("btn-open-leaderboard").click());
  await sleep(900);
  const lb = await page.evaluate(() => document.body.innerText);
  check("Leaderboard: Max \"1 win\", Lee \"1 tournament win\"; no \"1 wins\" or \"1 tournament wins\"", /\b1 win\b/.test(lb) && /\b1 tournament win\b/.test(lb) && !/\b1 wins\b/.test(lb) && !/\b1 tournament wins\b/.test(lb), (lb.match(/\b1 (win|wins|tournament wins?)\b/g) || []));
  if (OUT) await page.screenshot({ path: path.join(OUT, "leaderboard_one_win.png") });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
