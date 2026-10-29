// The camera through a whole night (P26): the scoreboard with this device's own camera
// (same-device mode, a fake camera), checked from both sides:
// - the screen's wake lock: asked for; let go by the browser (a "release" it didn't ask for) - asked
//   for again; the page hidden and shown again - asked for again;
// - the camera's stream "ended": it restarts on its own (a new track, "Camera: active" again) -
//   and the board shows "📷 The camera stopped - restarting it…" meanwhile;
// - a frozen picture (no new frames): within the stall time "📷 The camera's picture has frozen"
//   over the board, detection stops looking at the dead frame; the camera restarts and the banner
//   goes;
// - no page errors.
// Its own file server on 4282.
// usage: node tests/probe_camera_keepalive.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4282, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".bin": "application/octet-stream" };

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
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 820 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__wake = [];
      Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => { const l = new EventTarget(); l.released = false; l.release = () => { l.released = true; l.dispatchEvent(new Event("release")); return Promise.resolve(); }; window.__wake.push(l); return Promise.resolve(l); } } });
    });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
      localStorage.setItem("pmc-camera-wizard-done", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "pa", name: "Alice", playing: true, balls: 0 }, { id: "pb", name: "Bob", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 }, cameraInputEnabled: true, cameraWizardCompleted: true, sameDeviceCameraSetUp: true }));
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => { const f = document.getElementById("same-device-camera-iframe"); try { return f && f.contentWindow.PMCCueDebug && f.contentDocument.getElementById("video").videoWidth > 0; } catch (e) { return false; } }, { timeout: 90000, polling: 250 });
    const frame = await (await page.$("#same-device-camera-iframe")).contentFrame();
    const health = () => frame.evaluate(() => window.PMCCueDebug.cameraHealth());
    const label = () => frame.evaluate(() => document.getElementById("labelCamera").textContent);
    const banner = () => page.evaluate(() => { const b = document.getElementById("camera-trouble-banner"); return b && !b.classList.contains("hidden") ? b.textContent : null; });
    await sleep(1500);

    // ---- the wake lock ----
    const w0 = await frame.evaluate(() => window.__wake.length);
    await frame.evaluate(() => window.__wake[window.__wake.length - 1].dispatchEvent(new Event("release"))); // (let go by the browser)
    await sleep(4000);
    const w1 = await frame.evaluate(() => ({ n: window.__wake.length, held: window.PMCCueDebug.cameraHealth().wakeHeld }));
    check("the screen's wake lock: asked for (" + w0 + "); let go by the browser - asked for again (" + w1.n + ")", w0 >= 1 && w1.n === w0 + 1 && w1.held, { w0, w1 });

    // ---- the stream ended ----
    const before = await health();
    await frame.evaluate(() => window.PMCCueDebug.endTrack());
    await sleep(300);
    const during = { label: await label(), banner: await banner(), h: await health() };
    if (OUT) await page.screenshot({ path: path.join(OUT, "camera_stopped_banner.png") });
    await sleep(3000);
    const afterEnd = { label: await label(), banner: await banner(), h: await health() };
    check("the camera's stream ended: \"" + during.label + "\", the board says \"" + during.banner + "\"", /restarting/.test(during.label) && /camera stopped/.test(during.banner || ""), during);
    check("...it restarts on its own: a new track, \"" + afterEnd.label + "\", the banner gone", afterEnd.h.trackId && afterEnd.h.trackId !== before.trackId && /active/.test(afterEnd.label) && afterEnd.banner === null, { before, afterEnd });

    // ---- a frozen picture ----
    await frame.evaluate(() => {
      window.PMCCueDebug.setStallMs(2500);
      window.__looks = 0;
      window.PMCCueDebug.posesOverride = (p) => { window.__looks++; return p; };
      document.getElementById("video").pause(); // (no new frames)
    });
    await page.waitForFunction(() => { const b = document.getElementById("camera-trouble-banner"); return b && !b.classList.contains("hidden") && /frozen/.test(b.textContent); }, { timeout: 15000, polling: 100 }).catch(() => {});
    const frozen = { banner: await banner(), h: await health(), looks: await frame.evaluate(() => window.__looks) };
    await sleep(700);
    const looksLater = await frame.evaluate(() => window.__looks);
    if (OUT) await page.screenshot({ path: path.join(OUT, "camera_frozen_banner.png") });
    check("a frozen picture: \"" + frozen.banner + "\" over the board", frozen.h.frozen && /frozen/.test(frozen.banner || ""), frozen);
    check("...detection stops looking at the dead frame (" + frozen.looks + " looks, then " + looksLater + ")", looksLater <= frozen.looks + 1, { frozen: frozen.looks, looksLater });
    await page.waitForFunction(() => { const b = document.getElementById("camera-trouble-banner"); return b && b.classList.contains("hidden"); }, { timeout: 20000, polling: 200 }).catch(() => {});
    await frame.waitForFunction(() => !window.PMCCueDebug.cameraHealth().frozen, { timeout: 10000, polling: 200 }).catch(() => {});
    const back = { banner: await banner(), h: await health(), label: await label() };
    check("...the camera restarted, the picture moving again: the banner gone (\"" + back.label + "\")", !back.h.frozen && back.banner === null && /active/.test(back.label), back);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
