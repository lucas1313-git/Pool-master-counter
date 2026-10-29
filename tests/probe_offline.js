// Works offline, survives Safari, backs itself up (P21), at 1180x820:
// - a fresh device starts empty: no players, no saved lists, nothing fetched from players/ or
//   stats/ (the old repo seed is gone) - the first-run screen;
// - load once (the service worker installs and takes over), go offline, reload: the board opens
//   with Kim and Jo, in English, and the + still scores;
// - a damaged saved scoreboard: its raw text kept under poolMasterCounter.stateDamaged.* (still
//   there after the fresh start's first save), and the app says so;
// - persistent storage asked for at the first save, the answer shown in Backup & Restore;
// - "💾 Last backup 9 days ago" under the top bar once games were played since; Later hides it for
//   a day; Back up now backs up and it goes;
// - an iPad in Safari: the Add to Home Screen tip once; Got it, and a reload doesn't show it again;
// - no page errors.
// Its own file server on 4276.
// usage: node tests/probe_offline.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4276, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

(async () => {
  const requested = [];
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    requested.push(p);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  const fresh = async (ua) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    if (ua) await page.setUserAgent(ua);
    await page.setViewport({ width: 1180, height: 820, hasTouch: true });
    return { ctx, page };
  };
  const seed = async (page, state, extra) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((state, extra) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      Object.keys(extra || {}).forEach((k) => localStorage.setItem(k, extra[k]));
      if (state !== null) localStorage.setItem("poolMasterCounter.state.v2", typeof state === "string" ? state : JSON.stringify(state));
    }, state, extra || {});
  };
  const KIM_JO = (games) => ({ players: [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: games || [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } });

  // ---- a fresh device ----
  {
    const { ctx, page } = await fresh();
    requested.length = 0;
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
    const s = await page.evaluate(() => ({ players: (JSON.parse(localStorage.getItem("poolMasterCounter.state.v2") || "null") || { players: [] }).players.map((p) => p.name), rosters: localStorage.getItem("poolMasterCounter.rosters.v1"), firstRun: !document.getElementById("first-run-overlay").classList.contains("hidden") }));
    const seedFetches = requested.filter((p) => /^\/(players|stats)\//.test(p));
    check("a fresh device starts empty: no players, no saved lists, nothing fetched from players/ or stats/ - the first-run screen", s.players.length === 0 && (s.rosters === null || s.rosters === "[]") && seedFetches.length === 0 && s.firstRun, { s, seedFetches });
    await ctx.close();
  }

  // ---- offline ----
  {
    const { ctx, page } = await fresh();
    await seed(page, KIM_JO());
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1500);
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    const caches = await page.evaluate(async () => (await window.caches.keys()));
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "load" });
    await sleep(2500);
    const off = await page.evaluate(() => ({ online: navigator.onLine, status: document.getElementById("board-status").textContent, names: [...document.querySelectorAll("#scoreboard .player-name")].map((n) => n.textContent.replace(/\d.*$/, "").trim()) }));
    await page.evaluate(() => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" Kim")).click());
    await sleep(800);
    const scored = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).playerWins || {}).reduce((a, b) => a + b, 0));
    if (OUT) await page.screenshot({ path: path.join(OUT, "offline_board.png") });
    check("offline: loaded once (the service worker took over: " + caches.join(", ") + "), offline, reloaded - the board opens with Kim and Jo, in English, and the + scores", controlled && !off.online && off.names.join() === "Kim,Jo" && /8-Ball · Race to 5/.test(off.status) && scored === 1, { controlled, caches, off, scored });
    await page.setOfflineMode(false);
    await ctx.close();
  }

  // ---- a damaged save ----
  {
    const { ctx, page } = await fresh();
    const raw = '{"players":[{"id":"k","name":"Kim"';
    await seed(page, raw);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1500);
    const notice = await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); return !o.classList.contains("hidden") ? document.getElementById("confirm-modal-message").textContent : ""; });
    await page.evaluate(() => document.getElementById("btn-confirm-modal-cancel").click());
    // the fresh start's first save
    await page.evaluate(() => document.getElementById("btn-first-run-start") && document.getElementById("btn-first-run-start").click());
    await sleep(800);
    const kept = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.indexOf("poolMasterCounter.stateDamaged.") === 0).map((k) => localStorage.getItem(k)));
    const nowState = await page.evaluate(() => localStorage.getItem("poolMasterCounter.state.v2"));
    check("a damaged saved scoreboard: kept as it was under poolMasterCounter.stateDamaged.* (after the fresh start's first save too), and the app says so", kept.length === 1 && kept[0] === raw && nowState !== raw && /couldn't be read/.test(notice), { kept, notice });
    // persistent storage asked for at the first save, shown in Backup & Restore
    const persist = await page.evaluate(() => ({ asked: !!localStorage.getItem("poolMasterCounter.persistAsked.v1"), text: document.getElementById("bk-persist").textContent }));
    check("persistent storage asked for at the first save; Backup & Restore says what the browser answered", persist.asked && /🔒|⚠️/.test(persist.text), persist);
    await ctx.close();
  }

  // ---- the backup reminder ----
  {
    const { ctx, page } = await fresh();
    const game = { ts: new Date().toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: ["Kim"], winnerIds: ["k"], opponentNames: ["Jo"], isTeam: false, summary: "Kim won 8-Ball" };
    await seed(page, KIM_JO([game]), { "poolMasterCounter.lastBackup.v1": JSON.stringify({ at: Date.now() - 9 * 86400000, where: "device", file: "x.json" }) });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
    const r1 = await page.evaluate(() => ({ shown: !document.getElementById("backup-reminder").classList.contains("hidden"), text: document.getElementById("backup-reminder-text").textContent }));
    if (OUT) await page.screenshot({ path: path.join(OUT, "backup_reminder.png") });
    await page.click("#btn-backup-reminder-later");
    await sleep(200);
    const r2 = await page.evaluate(() => ({ shown: !document.getElementById("backup-reminder").classList.contains("hidden"), snooze: +localStorage.getItem("poolMasterCounter.backupReminderSnooze.v1") }));
    check("\"💾 Last backup 9 days ago\" under the top bar (games since); Later hides it for a day", r1.shown && /Last backup 9 days ago - 1 game since/.test(r1.text) && !r2.shown && r2.snooze > Date.now() + 23 * 3600000, { r1, r2 });
    await page.evaluate(() => localStorage.removeItem("poolMasterCounter.backupReminderSnooze.v1"));
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1200);
    const dl = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-dl-"));
    const cdp = await page.target().createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl });
    await page.click("#btn-backup-reminder-now");
    await sleep(600);
    // (Back up now asks for the file's name first)
    await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (!o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click(); });
    await sleep(1500);
    const r3 = await page.evaluate(() => ({ shown: !document.getElementById("backup-reminder").classList.contains("hidden"), last: JSON.parse(localStorage.getItem("poolMasterCounter.lastBackup.v1")).at }));
    check("...Back up now: backed up, and the reminder goes", !r3.shown && Date.now() - r3.last < 60000, r3);
    await ctx.close();
  }

  // ---- an iPad in Safari ----
  {
    const { ctx, page } = await fresh(IPAD_UA);
    await seed(page, KIM_JO());
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(3500);
    const tip = await page.evaluate(() => ({ shown: !document.getElementById("home-screen-tip").classList.contains("hidden"), text: document.getElementById("home-screen-tip").textContent }));
    if (OUT) await page.screenshot({ path: path.join(OUT, "home_screen_tip.png") });
    await page.click("#btn-home-screen-tip-ok");
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(3500);
    const again = await page.evaluate(() => !document.getElementById("home-screen-tip").classList.contains("hidden"));
    check("an iPad in Safari: the Add to Home Screen tip once; Got it, and a reload doesn't show it again", tip.shown && /Home Screen/.test(tip.text) && !again, { tip, again });
    await ctx.close();
    const desk = await fresh();
    await seed(desk.page, KIM_JO());
    await desk.page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(3500);
    const deskTip = await desk.page.evaluate(() => !document.getElementById("home-screen-tip").classList.contains("hidden"));
    check("...not on a desktop browser", !deskTip);
    await desk.ctx.close();
  }

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
