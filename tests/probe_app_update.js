// 🆕 A new version shows after one reload (2026-10-30: the service worker answers with the page it
// kept and fetches the new one for next time, so an update took a second reload - "I still can't
// see Show all"). Its own file server on 4303 serving the app as version A, then B, then C (the
// page's ?v= tags renamed, a marker in the page), at 1180x820:
// - version A opened (the service worker takes over), B put on the server, one reload: version B
//   shows (taken at once - just opened, nothing touched), no update bar;
// - C put on the server (slow to arrive), one reload and a key pressed at once: the page isn't
//   reloaded under the player's hands - "🆕 A new version of the app is ready 🔄 Update now" under
//   the top bar; 🔄 Update now: version C, the bar gone;
// - no page errors.
// usage: node tests/probe_app_update.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4303, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
  const tag = /js\/app\.js\?v=([^"]+)"/.exec(html)[1];
  let version = "A", slow = 0;
  const pageOf = (v) => html.split("?v=" + tag).join("?v=probe" + v).replace("</head>", '<meta name="pmc-probe-version" content="' + v + '">\n</head>');
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p === "/" || p === "/index.html") {
      const v = version;
      return setTimeout(() => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(pageOf(v)); }, slow);
    }
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  try {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 820, hasTouch: true });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "k", name: "Kim", playing: true, balls: 0 }, { id: "j", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    });
    const shown = () => page.evaluate(() => {
      const m = document.querySelector('meta[name="pmc-probe-version"]'), bar = document.getElementById("update-ready");
      return { v: m ? m.content : null, controlled: !!navigator.serviceWorker.controller, bar: bar && !bar.classList.contains("hidden") ? bar.textContent.replace(/\s+/g, " ").trim() : "" };
    });

    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1500);
    const a = await shown();

    // B on the server, one reload, nothing touched
    version = "B";
    await page.reload({ waitUntil: "load" });
    await sleep(5000);
    const b = await shown();
    check("version A open (" + JSON.stringify(a) + "), B on the server, one reload: version B shows (" + b.v + "), no update bar", a.v === "A" && a.controlled && b.v === "B" && !b.bar, { a, b });

    // C on the server, slow to arrive; one reload and a key pressed at once
    // (C arrives 6 s after the reload - the key's pressed well before, however slow the page is to load)
    version = "C"; slow = 6000;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.getElementById("board-status") && document.getElementById("board-status").textContent.trim(), { timeout: 5000 }).catch(() => {});
    await page.keyboard.press("Shift");
    let c1 = null;
    for (let i = 0; i < 30; i++) { await sleep(500); c1 = await shown(); if (c1.bar || c1.v !== "B") break; }
    if (OUT) await page.screenshot({ path: path.join(OUT, "app_update_bar.png") });
    slow = 0;
    const nav = page.waitForNavigation({ waitUntil: "load", timeout: 8000 }).catch(() => null);
    await page.click("#btn-update-ready");
    await nav;
    await sleep(1500);
    const c2 = await shown();
    check("C on the server, a key pressed at once: not reloaded under the player's hands (" + c1.v + ") - \"" + c1.bar + "\"; 🔄 Update now: version " + c2.v + ", the bar gone", c1.v === "B" && c1.bar === "🆕 A new version of the app is ready 🔄 Update now" && c2.v === "C" && !c2.bar, { c1, c2 });
    await ctx.close();
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
