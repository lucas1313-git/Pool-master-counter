// A simpler camera (P27), the scoreboard on an iPad-sized screen with this device's camera (a
// synthetic table video: still, the cue ball rolling across, still again - looped):
// - before any camera: no Visual Scoring under the board;
// - Simple mode in five steps: 1 📷 Set Up Camera, 2 Use this device's camera, 3 Start this
//   device's camera, 4 Simple mode (the camera page's setup checklist), 5 the table calibrated
//   (Table tab, four corners) - the checklist then says all done and goes;
// - the checklist showed the models' download as it went; DINOv2, the depth model and room tags
//   never downloaded (DINOv2 off by default, the rest in Labs, off); no Room map or Enroll tab;
// - Simple mode: the rolled cue ball is a shot on the board - "🎯 1 shot tonight", the player up
//   (Kim, on the number pad) lights, and the selection stays where it was (no names from the
//   camera, no appearance models loaded);
// - nobody near the table: one look a second;
// - the camera moved (the picture shifted, as a knock would): "📷 The camera has moved since the
//   table was calibrated" over the board, OK hides it; moved back: the camera says so;
// - no page errors.
// Its own file server on 4285.
// usage: node tests/probe_camera_simple.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4285, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".bin": "application/octet-stream" };

// the table: 100 x 50 in at 5 px per inch from (70, 55) in a 640 x 360 picture, a dark room round it
const W = 640, H = 360, PX = 5, X0 = 70, Y0 = 55, R = 6, FPS = 4;
const at = (xin, yin) => [X0 + xin * PX, Y0 + yin * PX];
const onTable = (x, y) => x >= X0 && x <= X0 + 100 * PX && y >= Y0 && y <= Y0 + 50 * PX;
function felt(x, y) { const l = 0.55 + 0.45 * Math.exp(-(((x - 320) ** 2) / (2 * 200 * 200) + ((y - 180) ** 2) / (2 * 120 * 120))); return [34 * l, 128 * l, 66 * l]; }
const OTHERS = [[at(60, 15), [205, 32, 30]], [at(75, 35), [240, 200, 40]], [at(30, 30), [20, 20, 20]]];
function frame(cue) {
  return (x, y) => {
    if (!onTable(x, y)) return (Math.floor(x / 40) + Math.floor(y / 40)) % 2 ? [52, 40, 32] : [38, 30, 26]; // (a floor with edges to see)
    const near = (c) => (x - c[0]) ** 2 + (y - c[1]) ** 2 <= R * R;
    if (cue && near(cue)) return [236, 234, 222];
    for (const [c, col] of OTHERS) if (near(c)) return col;
    return felt(x, y);
  };
}
function y4m(file, frames) {
  const parts = [Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F" + FPS + ":1 Ip A1:1 C420jpeg\n")];
  for (const px of frames) {
    const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = px(x, y); Y[y * W + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b); }
    for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
      const [r, g, b] = px(x * 2 + 0.5, y * 2 + 0.5);
      U[y * (W / 2) + x] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)));
      V[y * (W / 2) + x] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)));
    }
    parts.push(Buffer.from("FRAME\n"), Y, U, V);
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}
const repeat = (n, f) => Array.from({ length: n }, () => f);
const A = at(20, 25), B = at(80, 22);
// 8 s still at A, 1.5 s rolling to B, 8 s still at B (then the loop jumps back to A: a second "shot")
const SHOT = repeat(32, frame(A)).concat(Array.from({ length: 6 }, (_, i) => frame([A[0] + (B[0] - A[0]) * (i + 1) / 7, A[1] + (B[1] - A[1]) * (i + 1) / 7]))).concat(repeat(32, frame(B)));

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-simple-"));
  const file = path.join(TMP, "table.y4m");
  y4m(file, SHOT);
  const fetched = [];
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    fetched.push(p);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Content-Length": fs.statSync(f).size });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + file, "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push("board: " + e.message));
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
      localStorage.setItem("pmc-camera-wizard-done", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "pa", name: "Kim", playing: true, balls: 0 }, { id: "pb", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "straight", target: 100, unit: "points", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(800);
    const vsHidden = await page.evaluate(() => document.getElementById("visual-scoring-panel").classList.contains("hidden"));
    check("before any camera: no Visual Scoring under the board", vsHidden);

    // ---- the five steps ----
    let steps = 0;
    await page.evaluate(() => { document.getElementById("btn-toggle-focus") && document.getElementById("app").classList.contains("focus-mode") && document.getElementById("btn-toggle-focus").click(); });
    await page.evaluate(() => document.getElementById("btn-open-camera-wizard-header").click()); steps++;
    await sleep(500);
    const vsShown = await page.evaluate(() => !document.getElementById("visual-scoring-panel").classList.contains("hidden"));
    await page.evaluate(() => document.getElementById("camera-wizard-path-same-device").click()); steps++;
    await sleep(300);
    await page.evaluate(() => document.getElementById("btn-camera-wizard-start-same-device").click()); steps++;
    await page.waitForFunction(() => { const f = document.getElementById("same-device-camera-iframe"); try { return f && f.contentWindow.PMCCueDebug && f.contentDocument.getElementById("video").videoWidth > 0; } catch (e) { return false; } }, { timeout: 90000, polling: 200 });
    let frameH = await page.$("#same-device-camera-iframe");
    let cam = await frameH.contentFrame();
    cam.page().on("pageerror", () => {});
    const sawProgress = [];
    const watchList = async () => { const t = await cam.evaluate(() => { const el = document.getElementById("setupChecklist"); return el && !el.hidden ? el.textContent : null; }).catch(() => null); if (t) sawProgress.push(t); };
    for (let i = 0; i < 20; i++) { await watchList(); if (await cam.evaluate(() => /ready/.test(document.getElementById("labelModels").textContent))) break; await sleep(300); }
    await watchList();
    const before = await cam.evaluate(() => ({ tabs: [...document.querySelectorAll(".tab-btn")].filter((b) => !b.hidden).map((b) => b.id), list: document.getElementById("setupChecklist").textContent }));
    await cam.evaluate(() => { const t = document.getElementById("simpleModeToggleTop"); t.checked = true; t.dispatchEvent(new Event("change", { bubbles: true })); }); steps++;
    await sleep(500);
    // 5: the table calibrated - Table tab, four corners (the long side first)
    await cam.evaluate(() => { document.getElementById("tabCalibrate").click(); const size = document.getElementById("tableSizeSelect"); size.value = "9"; size.dispatchEvent(new Event("change")); document.getElementById("showManualCalibrationBtn").click(); const s = document.getElementById("firstEdgeSelect"); s.value = "length"; s.dispatchEvent(new Event("change")); document.getElementById("startCalibrationBtn").click(); });
    await cam.evaluate(() => document.getElementById("overlay").scrollIntoView({ block: "center" }));
    await sleep(300);
    for (const [cx, cy] of [[X0, Y0], [X0 + 100 * PX, Y0], [X0 + 100 * PX, Y0 + 50 * PX], [X0, Y0 + 50 * PX]]) {
      // (a tap on the picture, where that corner is)
      await cam.evaluate((u, v) => {
        const ov = document.getElementById("overlay"), vid = document.getElementById("video"), r = ov.getBoundingClientRect();
        const scale = Math.max(ov.width / vid.videoWidth, ov.height / vid.videoHeight), ox = (ov.width - vid.videoWidth * scale) / 2, oy = (ov.height - vid.videoHeight * scale) / 2;
        ov.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + (u * scale + ox) * r.width / ov.width, clientY: r.top + (v * scale + oy) * r.height / ov.height }));
      }, cx, cy);
      await sleep(150);
    }
    steps++;
    await sleep(800);
    const after = await cam.evaluate(() => ({ cal: JSON.parse(localStorage.getItem("pmc-camera-calibration") || "null"), listHidden: document.getElementById("setupChecklist").hidden, tabs: [...document.querySelectorAll(".tab-btn")].filter((b) => !b.hidden).map((b) => b.id), work: window.PMCCueDebug.work() }));
    const progress = sawProgress.find((t) => /%/.test(t)) || sawProgress[0] || "";
    check("Simple mode in " + steps + " steps (Set Up Camera, this device's camera, Start, Simple mode, the table calibrated): the checklist all done and gone", steps <= 5 && vsShown && after.cal && Math.abs(after.cal.xExtent - 100) < 1 && after.listHidden, { steps, vsShown, after, before });
    check("...the checklist showed the models' download as it went: \"" + progress.slice(0, 120) + "\"", /Downloading the models|Models downloaded/.test(progress) && /of \d/.test(before.list), { sawProgress: sawProgress.slice(0, 3), before });
    const heavy = fetched.filter((p) => /dinov2|\/depth\/|\/segment\//.test(p));
    check("...DINOv2, the depth model and room tags never downloaded; no Room map tab; in Simple mode no Enroll tab and no appearance model loaded", heavy.length === 0 && !before.tabs.includes("tabRoomMap") && !after.tabs.includes("tabEnroll") && after.work.models.length === 0 && after.work.simple, { heavy, before: before.tabs, after: after.tabs, work: after.work });

    // ---- a shot ----
    await page.evaluate(() => { document.getElementById("btn-close-same-device-camera") && document.getElementById("btn-close-same-device-camera").click(); });
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }))); // Kim up, on the number pad
    await sleep(300);
    await page.evaluate(() => {
      window.__pulses = [];
      new MutationObserver((ms) => ms.forEach((m) => { if (m.target.classList && m.target.classList.contains("camera-shot-pulse")) window.__pulses.push(m.target.dataset.playerId); })).observe(document.getElementById("scoreboard"), { attributes: true, subtree: true, attributeFilter: ["class"] });
    });
    const selectedBefore = await page.evaluate(() => window.PMCCameraBridge.getSelectedPlayerId());
    await page.waitForFunction(() => { const el = document.getElementById("camera-table-line"); return el && /1 shot/.test(el.textContent); }, { timeout: 45000, polling: 250 }).catch(() => {});
    const shot = await page.evaluate(() => ({ line: document.getElementById("camera-table-line").textContent, pulses: window.__pulses.slice(), selected: window.PMCCameraBridge.getSelectedPlayerId(), kim: window.PMCCameraBridge.resolvePlayerIdByName("Kim") }));
    check("Simple mode: the rolled cue ball is a shot on the board - \"" + shot.line + "\", the player up (Kim) lights, the selection stays", /1 shot tonight/.test(shot.line) && shot.pulses.includes(shot.kim) && shot.selected === selectedBefore && shot.selected === shot.kim, shot);
    if (OUT) {
      await page.evaluate(() => document.getElementById("visual-scoring-panel").scrollIntoView({ block: "start" }));
      await sleep(300);
      await page.screenshot({ path: path.join(OUT, "simple_mode_board.png") });
    }

    // ---- nobody near the table ----
    frameH = await page.$("#same-device-camera-iframe");
    cam = await frameH.contentFrame();
    // (looks counted while the camera says it's idle - the video's rolling ball wakes it now and then)
    await cam.evaluate(() => {
      window.__idleLooks = 0; window.__idleTenths = 0;
      window.PMCCueDebug.posesOverride = (p) => { if (window.PMCCueDebug.work().idle) window.__idleLooks++; return []; };
      setInterval(() => { if (window.PMCCueDebug.work().idle) window.__idleTenths++; }, 100);
    });
    await sleep(12000);
    const idle = await cam.evaluate(() => ({ looks: window.__idleLooks, seconds: window.__idleTenths / 10 }));
    const perSecond = idle.looks / Math.max(1, idle.seconds);
    check("nobody near the table: one look a second (" + idle.looks + " looks in " + idle.seconds + " s idle)", idle.seconds >= 4 && perSecond <= 1.3, idle);

    // ---- the camera moved ----
    const kept = await cam.evaluate(() => window.PMCCueDebug.checkMoved());
    await cam.evaluate(() => window.PMCCueDebug.setViewOffset({ dx: 3, dy: 0 }));
    await cam.evaluate(() => window.PMCCueDebug.checkMoved());
    const moved = await cam.evaluate(() => window.PMCCueDebug.checkMoved());
    await sleep(400);
    const banner = await page.evaluate(() => { const b = document.getElementById("camera-trouble-banner"); return { shown: !b.classList.contains("hidden"), text: b.textContent, amber: b.classList.contains("camera-moved") }; });
    if (OUT) await page.screenshot({ path: path.join(OUT, "camera_moved_banner.png") });
    check("the camera moved (the picture shifted): \"" + banner.text.trim() + "\" over the board", kept.kept && moved.moved && banner.shown && banner.amber && /has moved/.test(banner.text), { kept, moved, banner });
    await page.evaluate(() => document.querySelector("#camera-trouble-banner .camera-trouble-ok").click());
    await sleep(200);
    const gone = await page.evaluate(() => document.getElementById("camera-trouble-banner").classList.contains("hidden"));
    await cam.evaluate(() => window.PMCCueDebug.setViewOffset(null));
    const back = await cam.evaluate(() => window.PMCCueDebug.checkMoved());
    check("...OK hides it; moved back, the camera says it's back", gone && !back.moved, { gone, back });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
