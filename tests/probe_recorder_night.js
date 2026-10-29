// 🎬 Record this session through a whole night (P26) - the in-app recorder on a device with no
// local server, a fake camera (a moving test picture), the waits shortened (a 4 s rolling stretch
// for Highlights, 6 s parts, free space looked at every second):
// - ✨ Highlights is the default: after a cue and more recording, only what the cue covers is
//   kept (plus the recording's start) - fewer bytes than recorded; the cue's clip is still cut
//   and plays (ffprobe); the recording itself has no ▶ Play / ⬇ Save (it has gaps);
// - the screen is kept awake while recording (a wake lock asked for, let go after);
// - 🎞️ Everything, 14 s: saved in parts - three "⬇ Part n of 3" buttons; part 2 is an MP4 that
//   decodes, about 6 s long;
// - the camera lost mid-recording ("ended"): what was recorded is kept (an ended recording with
//   its pieces), and a new recording starts on its own;
// - the space runs low while recording: it stops, with a message, what was recorded kept (its
//   pieces and its cue); too little space to start: it doesn't, and says so;
// - no page errors.
// Its own file server on 4281.
// usage: node tests/probe_recorder_night.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4281, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
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
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-rec-night-"));
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
    await page.evaluateOnNewDocument(() => {
      // a wake lock that can be watched
      window.__wake = [];
      Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: () => { const l = new EventTarget(); l.released = false; l.release = () => { l.released = true; l.dispatchEvent(new Event("release")); return Promise.resolve(); }; window.__wake.push(l); return Promise.resolve(l); } } });
      // free space the test can turn down
      window.__free = null;
      const est = navigator.storage.estimate.bind(navigator.storage);
      navigator.storage.estimate = () => window.__free === null ? est() : Promise.resolve({ usage: 1e9, quota: 1e9 + window.__free });
    });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.homeScreenTipSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.recordingConsent.v1", new Date().toISOString());
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
    await page.evaluate(() => window.PMCLocalRecorder._setTiming({ bufferMs: 4000, pruneMs: 1000, partMs: 6000, spaceCheckMs: 1000 }));
    const st = () => page.evaluate(() => window.PMCLocalRecorder._state());
    // (screenshots: the 🎬 panel opened from the board)
    const showPanel = () => page.evaluate(() => { const b = document.getElementById("btn-open-recorder"); if (b) b.click(); }).then(() => sleep(600));
    const startStop = async () => { await page.evaluate(() => document.getElementById("btn-lrec-start").click()); await sleep(1500); };
    const sessions = () => page.evaluate(async () => (await window.PMCLocalRecorder._all("sessions")).sort((a, b) => a.startedAt - b.startedAt).map((s) => ({ id: s.id, mode: s.mode, endedAt: s.endedAt, bytes: s.bytes, keptBytes: s.keptBytes, fragments: (s.fragments || []).length })));
    const chunksOf = (id) => page.evaluate(async (id) => (await window.PMCLocalRecorder._bySession("chunks", id)).length, id);
    const fileOut = async (expr, name) => {
      const b64 = await page.evaluate(async (expr) => {
        const file = await eval(expr);
        const buf = new Uint8Array(await file.arrayBuffer()); let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
        return btoa(s);
      }, expr);
      const f = path.join(TMP, name);
      fs.writeFileSync(f, Buffer.from(b64, "base64"));
      return f;
    };
    // (seconds of picture: a part starts where the recording was then - its start time isn't 0)
    const duration = (f) => { try { const [start, d] = execFileSync(FF + "ffprobe", ["-v", "error", "-show_entries", "format=start_time,duration", "-of", "csv=p=0", f]).toString().trim().split(",").map(parseFloat); return d - (start > 0.5 && d > start ? start : 0); } catch (e) { return NaN; } };
    const decodes = (f) => { try { execFileSync(FF + "ffmpeg", ["-v", "error", "-i", f, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }); return true; } catch (e) { return false; } };

    // ---- ✨ Highlights, the default ----
    const modeDefault = await page.evaluate(() => document.getElementById("lrec-mode").value);
    await startStop();
    const wakeOn = await page.evaluate(() => window.__wake.length > 0 && !window.__wake[window.__wake.length - 1].released);
    await sleep(3000);
    await page.evaluate(() => window.PMCLocalRecorder.mark("test"));
    await sleep(3000);
    await page.evaluate(() => window.PMCLocalRecorder.finish("test"));
    await sleep(9000); // well past the 4 s rolling stretch
    const during = await st();
    await startStop();
    const wakeOff = await page.evaluate(() => window.__wake.every((l) => l.released));
    let ss = await sessions();
    const hl = ss[0], hlChunks = await chunksOf(hl.id);
    const hlRow = await page.evaluate(() => { const li = document.querySelector("#lrec-sessions li"); return { text: li.textContent, buttons: [...li.querySelectorAll("button")].map((b) => b.textContent) }; });
    check("✨ Highlights is the default (\"" + modeDefault + "\"); after a cue and 9 s more: " + hlChunks + " pieces kept, " + Math.round(hl.keptBytes / 1000) + " of " + Math.round(hl.bytes / 1000) + " KB", modeDefault === "highlights" && hl.mode === "highlights" && hl.keptBytes < hl.bytes * 0.8 && hlChunks >= 2, { hl, hlChunks, during });
    check("...no ▶ Play / ⬇ Save for the recording itself (it has gaps): " + JSON.stringify(hlRow.buttons), !hlRow.buttons.some((b) => /Play|Save the recording|Part/.test(b)), hlRow);
    const clip = await fileOut("window.PMCLocalRecorder._all('cues').then((c) => window.PMCLocalRecorder._clipFile(c[0]))", "highlight-clip.mp4");
    const clipLen = duration(clip);
    check("...the cue's clip is still cut: an MP4 of " + clipLen.toFixed(1) + " s that decodes", clipLen > 3 && decodes(clip), clipLen);
    check("the screen kept awake while recording (a wake lock asked for), let go after", wakeOn && wakeOff, await page.evaluate(() => window.__wake.map((l) => l.released)));

    // ---- 🎞️ Everything, saved in parts ----
    await page.evaluate(() => { const m = document.getElementById("lrec-mode"); m.value = "full"; m.dispatchEvent(new Event("change", { bubbles: true })); });
    await startStop();
    await sleep(13000);
    await startStop();
    ss = await sessions();
    const full = ss[ss.length - 1];
    const parts = await page.evaluate(() => [...document.querySelector("#lrec-sessions li").querySelectorAll("button.lrec-part")].map((b) => b.textContent));
    const part2 = await fileOut("window.PMCLocalRecorder._all('sessions').then((l) => { const s = l.sort((a, b) => b.startedAt - a.startedAt)[0]; return window.PMCLocalRecorder._partFile(s, 1, 3); })", "part2.mp4");
    const p2 = duration(part2);
    if (OUT) { await showPanel(); await page.evaluate(() => document.getElementById("lrec-sessions").scrollIntoView({ block: "center" })); await sleep(300); await page.screenshot({ path: path.join(OUT, "recorder_parts.png") }); }
    check("🎞️ Everything, 14 s: saved in parts - " + JSON.stringify(parts), full.mode === "full" && parts.length === 3 && /Part 1 of 3/.test(parts[0]), { full, parts });
    check("...part 2 is an MP4 that decodes, " + p2.toFixed(1) + " s", p2 > 4 && p2 < 9 && decodes(part2), p2);

    // ---- the camera lost mid-recording ----
    await startStop();
    await sleep(3000);
    const firstId = (await st()).id;
    await page.evaluate(() => window.PMCLocalRecorder._endCamera());
    await sleep(6000);
    const after = await st();
    ss = await sessions();
    const lostOne = ss.find((s) => s.id === firstId), lostChunks = await chunksOf(firstId);
    check("the camera lost (\"ended\"): what was recorded kept (" + lostChunks + " pieces, ended), and a new recording started on its own", lostOne && lostOne.endedAt && lostChunks > 0 && after.recording && after.id !== firstId, { lostOne, lostChunks, after });

    // ---- space running low ----
    await page.evaluate(() => window.PMCLocalRecorder.mark("before the space ran out"));
    await sleep(2500);
    await page.evaluate(() => window.PMCLocalRecorder.finish("x"));
    const runningId = (await st()).id;
    await page.evaluate(() => { window.__free = 100e6; });
    await sleep(3500);
    const stopped = await st(), status = await page.evaluate(() => document.getElementById("lrec-status").textContent);
    ss = await sessions();
    const lowOne = ss.find((s) => s.id === runningId), lowChunks = await chunksOf(runningId);
    const lowCues = await page.evaluate(async (id) => (await window.PMCLocalRecorder._all("cues")).filter((c) => c.session === id).length, runningId);
    if (OUT) { await showPanel(); await page.evaluate(() => document.getElementById("lrec-status").scrollIntoView({ block: "center" })); await sleep(300); await page.screenshot({ path: path.join(OUT, "recorder_out_of_space.png") }); }
    check("space runs low while recording: it stops - \"" + status + "\"", !stopped.recording && /running out of space/.test(status), { stopped, status });
    check("...what was recorded is kept: " + lowChunks + " pieces, ended, its cue", lowOne && lowOne.endedAt && lowChunks > 0 && lowCues === 1, { lowOne, lowChunks, lowCues });
    await startStop();
    const refused = await st(), status2 = await page.evaluate(() => document.getElementById("lrec-status").textContent);
    check("...too little space to start: it doesn't - \"" + status2 + "\"", !refused.recording && /Not enough space/.test(status2), { refused, status2 });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
