// 🆕 An update that arrives over a bad connection doesn't cost the app its saved copy (2026-11-22:
// "not loading in my tablet" - a new version's worker installed while the files weren't coming,
// took over with an empty cache and deleted the old one: nothing left to open the app from).
// Its own file server on 4311, at 1180x820:
// - the app opened (the worker in charge, the app kept); a new version's worker registered while
//   the server answers 500 to everything: it doesn't take over - the old cache is still there;
// - no network at all, the page reloaded: the app opens all the same (from the saved copy);
// - the server back: the new version's worker registered again takes over, its cache whole, the
//   old one gone;
// - no page errors.
// usage: node tests/probe_update_bad_network.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4311, BASE = "http://localhost:" + PORT + "/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let down = false;
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p === "/sw.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return fs.createReadStream(path.join(REPO, "sw.js")).pipe(res); } // (the worker's own file always comes: it was the rest that didn't)
    if (down) { res.writeHead(500); return res.end("down"); }
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  try {
    const page = await (await browser.createBrowserContext()).newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewport({ width: 1180, height: 820, hasTouch: true });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => { localStorage.clear(); ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1")); });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 20000 });
    await page.reload({ waitUntil: "networkidle2" }); // (a second visit: the words too go through the worker, and are kept)
    await sleep(1500);
    const kept = () => page.evaluate(async () => {
      const out = {};
      for (const k of (await caches.keys()).filter((k) => k.indexOf("pmc-shell-") === 0)) { const c = await caches.open(k), keys = await c.keys(); out[k] = { files: keys.length, page: keys.some((r) => /index\.html$/.test(r.url)) }; }
      return out;
    });
    const first = await kept(), old = Object.keys(first)[0];
    check("the app opened: the worker in charge, the app kept (" + old + ", " + (first[old] || {}).files + " files with the page)", Object.keys(first).length === 1 && first[old].page && first[old].files > 20, first);

    // a new version's worker, while nothing comes from the server
    down = true;
    const reg = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.register("sw.js?v=probeNEW");
      const w = r.installing || r.waiting;
      if (w) await new Promise((ok) => { w.addEventListener("statechange", () => { if (w.state === "redundant" || w.state === "activated") ok(); }); setTimeout(ok, 8000); });
      return { state: w ? w.state : "none", active: r.active && r.active.scriptURL.replace(/.*\//, "") };
    });
    await sleep(800);
    const during = await kept();
    check("a new version's worker registered while the server is down: it doesn't take over (" + reg.state + ") - the old cache is still there, whole", reg.state === "redundant" && !!during[old] && during[old].page && during[old].files === first[old].files, { reg, during });
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: "load" }).catch(() => {});
    await sleep(2500);
    const off = await page.evaluate(() => ({ board: !!document.getElementById("board-topbar") && !!document.getElementById("btn-board-menu"), text: document.body.innerText.slice(0, 60) }));
    check("no network at all, the page reloaded: the app opens all the same, in English", off.board && /Menu/.test(off.text), off);
    await page.setOfflineMode(false);

    // the server back: the new version goes in whole
    down = false;
    const again = await page.evaluate(async () => {
      const r = await navigator.serviceWorker.register("sw.js?v=probeNEW");
      const w = r.installing || r.waiting || r.active;
      if (w && w.state !== "activated") await new Promise((ok) => { w.addEventListener("statechange", () => { if (w.state === "redundant" || w.state === "activated") ok(); }); setTimeout(ok, 20000); });
      return { state: w ? w.state : "none" };
    });
    await sleep(1200);
    const after = await kept();
    check("the server back: the new version's worker takes over, its cache whole, the old one gone", again.state === "activated" && !after[old] && after["pmc-shell-probeNEW"] && after["pmc-shell-probeNEW"].page && after["pmc-shell-probeNEW"].files > 20, { again, after });
    check("no page errors", errors.length === 0, errors);
  } finally {
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})();
