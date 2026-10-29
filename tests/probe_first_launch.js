// First launch in three taps (P16), from empty storage at 1180x820:
// - one screen: two names, game chips (8, 9, 10, Straight, One Pocket), a race stepper (5), Start -
//   and no email, phone or rating asked anywhere;
// - "Kim", "Jo", Start: a scorable 8-Ball race to 5 on the board in 1 tap (at most 3 allowed);
// - then three tips on the board, once - each beside what it points at (the +, ↩ Undo, 🎱 Game);
//   Got it, and a restart shows neither the first screen nor the tips again;
// - 9-Ball chip and the race stepper (+1): a 9-Ball race to 6;
// - nothing typed: "Player 1" v "Player 2";
// - under it: More setups opens the Setup Wizard, Restore a backup opens the restore;
// - the wizard is in ☰ Menu › More; a player's page offers 📇 Email & phone (the Contact Sheet, at
//   their row);
// - no page errors.
// Its own file server on 4269.
// usage: node tests/probe_first_launch.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4269, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  let page = null, taps = 0;
  const open = async () => {
    if (page) await page.close();
    page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 820, hasTouch: true });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => localStorage.clear());
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
    taps = 0;
  };
  const tap = async (sel) => { taps++; await page.click(sel); await sleep(400); };
  const shown = (sel) => page.evaluate((sel) => { const e = document.querySelector(sel); return !!(e && !e.classList.contains("hidden") && e.getClientRects().length); }, sel);
  const asked = () => page.evaluate(() => [...document.querySelectorAll('input[type="email"], input[type="tel"], #onboarding-rating-input, #new-player-rating')].filter((e) => e.getClientRects().length && e.offsetParent !== null).map((e) => e.id || e.type));

  // ---- the first screen ----
  await open();
  const first = await page.evaluate(() => ({
    shown: !document.getElementById("first-run-overlay").classList.contains("hidden"),
    oldWelcome: !document.getElementById("onboarding-overlay").classList.contains("hidden"),
    names: [document.getElementById("first-run-p1").placeholder, document.getElementById("first-run-p2").placeholder],
    games: [...document.querySelectorAll('input[name="first-run-game"]')].map((r) => r.closest("label").textContent.trim()),
    race: document.getElementById("first-run-race").value
  }));
  check("first launch: one screen - two names, the games (8, 9, 10, Straight, One Pocket), race 5 - not the old welcome", first.shown && !first.oldWelcome && first.names.join() === "Player 1,Player 2" && first.games.join() === "8-Ball,9-Ball,10-Ball,Straight Pool,One Pocket" && first.race === "5", first);
  check("...no email, phone or rating asked", (await asked()).length === 0, await asked());
  if (OUT) await page.screenshot({ path: path.join(OUT, "first_screen.png") });
  await page.type("#first-run-p1", "Kim");
  await page.type("#first-run-p2", "Jo");
  await tap("#btn-first-run-start");
  await sleep(500);
  const board = await page.evaluate(() => ({
    focus: document.getElementById("app").classList.contains("focus-mode") && !document.getElementById("app").classList.contains("hidden"),
    names: [...document.querySelectorAll("#scoreboard .player-name")].map((n) => n.textContent.replace(/\d.*$/, "").trim()),
    line: document.getElementById("board-status").textContent,
    plus: [...document.querySelectorAll("#scoreboard .btn-ball.plus")].filter((b) => !b.disabled).length
  }));
  check("\"Kim\", \"Jo\", Start: a scorable 8-Ball race to 5 on the board in " + taps + " tap(s) - at most 3", taps <= 3 && board.focus && board.names.join() === "Kim,Jo" && /^8-Ball · Race to 5/.test(board.line) && board.plus === 2, { taps, board });
  const tips = await page.evaluate(() => {
    const box = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const plus = document.querySelector("#scoreboard .btn-ball.plus").getBoundingClientRect(), undo = document.getElementById("btn-board-undo").getBoundingClientRect(), game = document.getElementById("btn-board-game").getBoundingClientRect();
    const u = document.getElementById("board-tip-undo").getBoundingClientRect(), g = document.getElementById("board-tip-game").getBoundingClientRect();
    return { shown: !document.getElementById("board-tips").classList.contains("hidden"), overlap: u.right > g.left && u.left < g.right && u.bottom > g.top && u.top < g.bottom, plus: box("board-tip-plus"), undo: box("board-tip-undo"), game: box("board-tip-game"), targets: { plus: { t: plus.top, l: plus.left, r: plus.right }, undo: { b: undo.bottom, l: undo.left, r: undo.right }, game: { b: game.bottom, l: game.left, r: game.right } } };
  });
  const near = (tip, x1, x2) => tip.r > x1 - 40 && tip.l < x2 + 40;
  check("...then three tips (none over another): \"Tap + to score\" just above a +, \"Undo is here\" under ↩ Undo, \"Game settings here\" under 🎱 Game", tips.shown && !tips.overlap && tips.plus.b <= tips.targets.plus.t && tips.targets.plus.t - tips.plus.b < 40 && near(tips.plus, tips.targets.plus.l, tips.targets.plus.r) && tips.undo.t >= tips.targets.undo.b && near(tips.undo, tips.targets.undo.l, tips.targets.undo.r) && tips.game.t >= tips.targets.game.b && near(tips.game, tips.targets.game.l, tips.targets.game.r), tips);
  if (OUT) await page.screenshot({ path: path.join(OUT, "first_tips.png") });
  await page.click("#btn-board-tips-ok");
  await sleep(300);
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(1200);
  const again = { first: await shown("#first-run-overlay"), tips: await shown("#board-tips"), names: await page.evaluate(() => [...document.querySelectorAll("#scoreboard .player-name")].length) };
  check("...Got it - and a restart shows neither again (the board, Kim v Jo)", !again.first && !again.tips && again.names === 2, again);

  // ---- 9-Ball, race 6 ----
  await open();
  await page.type("#first-run-p1", "Ann");
  await page.type("#first-run-p2", "Bob");
  await tap('input[name="first-run-game"][value="9ball"]');
  await tap('.first-run-step[data-step="1"]');
  await tap("#btn-first-run-start");
  const nine = await page.evaluate(() => document.getElementById("board-status").textContent);
  check("9-Ball chip, race stepper +1, Start (3 taps): a 9-Ball race to 6", taps === 3 && /^9-Ball · Race to 6/.test(nine), { taps, nine });

  // ---- nothing typed ----
  await open();
  await tap("#btn-first-run-start");
  const defaults = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.filter((p) => p.playing).map((p) => p.name));
  check("nothing typed, Start: \"Player 1\" v \"Player 2\"", defaults.join() === "Player 1,Player 2", defaults);

  // ---- under it ----
  await open();
  await page.click("#btn-first-run-more");
  await sleep(500);
  check("More setups: the Setup Wizard", await shown("#wizard-overlay"));
  await open();
  await page.click("#btn-first-run-restore");
  await sleep(600);
  check("Restore a backup: the restore opens", await shown("#bk-restore-overlay"));

  // ---- the wizard in the menu; contact details later ----
  await open();
  await page.click("#btn-first-run-start");
  await sleep(900);
  await page.evaluate(() => { const t = document.getElementById("btn-board-tips-ok"); if (t.offsetParent || !document.getElementById("board-tips").classList.contains("hidden")) t.click(); });
  await sleep(200);
  await page.click("#btn-board-menu");
  await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.more").click());
  await sleep(150);
  await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.wizard").click());
  await sleep(500);
  check("☰ Menu › More › Game Setup Wizard", await shown("#wizard-overlay"));
  await page.evaluate(() => { document.getElementById("wizard-overlay").classList.add("hidden"); });
  await page.evaluate(() => document.querySelector("#scoreboard .player-name").click());
  await page.evaluate(() => { window.__openStats = true; });
  await page.evaluate(() => document.querySelector(".player-link-icon") && document.querySelector(".player-link-icon").click());
  await sleep(600);
  const onPage = await shown("#view-player-page");
  await page.evaluate(() => document.getElementById("btn-player-page-contact").click());
  await sleep(600);
  const contact = await page.evaluate(() => ({ sheet: !document.getElementById("view-contact-sheet-page").classList.contains("hidden"), row: [...document.querySelectorAll(".contact-sheet-row")].some((li) => li.dataset.name === "Player 1") }));
  check("a player's page: 📇 Email & phone opens the Contact Sheet at their row", onPage && contact.sheet && contact.row, { onPage, contact });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
