// ✨ Tonight's highlights on the iPad (P35) - no Mac: the in-app recorder (🎞️ Everything) on a
// fake camera (a moving test picture), three cues marked on Kim v Jo, the night's games on the
// board, Kim and Jo said yes:
// - ☰ › ✨ Tonight's highlights: the three cued clips picked, "made on this device as it plays";
// - 16:9, 🎬 Make the reel: each clip cut by the device's recorder, played into a canvas with
//   its score bug and recorded - a 1280 x 720 video that decodes (ffprobe), as long as the
//   clips, no sound;
// - no page errors.
// Its own file server on 4292 (no /api - the device's own recorder).
// usage: node tests/probe_highlights_device.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4292, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const FF = fs.existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/" : "";
function makeY4m(file) {
  const W = 320, H = 180, N = 30, parts = [Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F10:1 Ip A1:1 C420jpeg\n")];
  for (let f = 0; f < N; f++) {
    const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4, 128), V = Buffer.alloc(W * H / 4, 128);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Y[y * W + x] = ((x + f * 8) % 64 < 32) ^ ((y + f * 3) % 48 < 24) ? 200 : 40;
    parts.push(Buffer.from("FRAME\n"), Y, U, V);
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-hl-device-"));
  const y4m = path.join(TMP, "moving.y4m");
  makeY4m(y4m);
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 1000 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      localStorage.setItem("poolMasterCounter.recordingConsent.v1", new Date().toISOString());
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "a", name: "Kim", playing: true, balls: 0 }, { id: "b", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], currentGame: { gameType: "9ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 } }));
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
    // record everything; three cues
    await page.evaluate(() => { const m = document.getElementById("lrec-mode"); m.value = "full"; m.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.evaluate(() => document.getElementById("btn-lrec-start").click());
    await sleep(2500);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.PMCLocalRecorder.mark("button"));
      await sleep(2500);
      await page.evaluate(() => window.PMCLocalRecorder.finish("button"));
      await sleep(1500);
    }
    await page.evaluate(() => document.getElementById("btn-lrec-start").click());
    await sleep(1500);
    const cues = await page.evaluate(() => window.PMCLocalRecorder.cues());
    // the night's games: a rack won at the end of each cue, the race at the last
    await page.evaluate((cues) => {
      const st = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
      st.gameHistory = cues.map((c, i) => ({ ts: new Date(c.endedAt + 500).toISOString(), gameType: "9ball", gameLabel: "9-Ball", winnerNames: ["Kim"], opponentNames: ["Jo"], wonRace: i === cues.length - 1, raceTally: { Kim: i + 1, Jo: 0 } })).reverse();
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(st));
      localStorage.setItem("poolMasterCounter.contacts.v1", JSON.stringify({ Kim: { email: "", highlightsOk: true }, Jo: { email: "", highlightsOk: true } }));
    }, cues);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
    await page.click("#btn-board-menu");
    await sleep(250);
    await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.highlights").click());
    await page.waitForFunction(() => document.getElementById("btn-highlights-build") || /Nothing recorded/.test(document.getElementById("highlights-body").textContent), { timeout: 8000 });
    const s = await page.evaluate(() => ({ picks: [...document.querySelectorAll("#highlights-picks li")].map((li) => li.textContent), text: document.getElementById("highlights-body").textContent }));
    check("three cues on the device (" + cues.length + "): three clips picked, made on this device", cues.length === 3 && s.picks.length === 3 && /Made on this device/.test(s.text) && /wins the race/.test(s.picks[2]), s);
    const t0 = Date.now();
    await page.click("#btn-highlights-build");
    await page.waitForFunction(() => window.PMCHighlightsDebug || /couldn't/.test(document.getElementById("highlights-status").textContent), { timeout: 120000 });
    const took = Date.now() - t0;
    if (OUT) await page.screenshot({ path: path.join(OUT, "highlights_device.png") });
    const status = await page.evaluate(() => document.getElementById("highlights-status").textContent);
    const b64 = await page.evaluate(async () => {
      if (!window.PMCHighlightsDebug) return "";
      const buf = new Uint8Array(await window.PMCHighlightsDebug.file.arrayBuffer());
      let str = "";
      for (let i = 0; i < buf.length; i += 0x8000) str += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(str);
    });
    const file = path.join(TMP, "reel" + (b64 ? ".mp4" : ""));
    let info = null, decodes = false;
    if (b64) {
      fs.writeFileSync(file, Buffer.from(b64, "base64"));
      try { info = JSON.parse(execFileSync(FF + "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file]).toString()); } catch (e) {}
      try { execFileSync(FF + "ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }); decodes = true; } catch (e) {}
    }
    const v = info && info.streams.find((x) => x.codec_type === "video");
    if (OUT && decodes) execFileSync(FF + "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-sseof", "-2", "-i", file, "-frames:v", "1", path.join(OUT, "highlights_device_frame.png")]);
    const clipSeconds = await page.evaluate(() => { const c = window.PMCHighlightsDebug; return c ? c.clips : 0; });
    check("🎬 Make the reel, 16:9, on the device (" + Math.round(took / 1000) + " s): " + (v ? v.width + " x " + v.height : "-") + ", it decodes, no sound (" + status + ")", !!b64 && v && v.width === 1280 && v.height === 720 && decodes && !info.streams.some((x) => x.codec_type === "audio") && clipSeconds === 3, { status, info, decodes });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
