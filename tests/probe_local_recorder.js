// 🎬 Record this session - recording and its cues in the app itself, on a
// device with no local server (the GitHub site on an iPad). The site from a
// plain file server (no /api, like GitHub Pages) on 4247, a fake camera
// (a moving test picture) and a fake microphone.
// Checks: the panel shows only without a server, and not on an iPhone; the
// header's 🎬 Record opens it; sound off until turned on; the first recording
// asks first (tell everyone at the table), its 🖨️ "Camera in use" sign prints;
// recording: the score card's ⭐ Cue there (no
// 🎯 Auto cue - recognition is off), "/" sets a cue and ends it, named as
// usual; stopped: kept on this device (its fragments indexed); ⬇ Save clip:
// an ordinary MP4 about as long as the cue (ffprobe, decodes cleanly);
// ⬇ Save the recording: the whole video; on a tablet: Save prepares, then
// "📤 Share it now" opens the share sheet from that tap; 🗑 asks first.
// usage: node tests/probe_local_recorder.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4247, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const TMP = path.join(__dirname, "tmphome", "local-recorder");
const FF = fs.existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/" : "";
// a moving picture (encoders treat a still one too kindly): 3 s, looped by Chrome
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
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
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
  async function open(opts) {
    opts = opts || {};
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    if (opts.ua) await page.setUserAgent(opts.ua);
    await page.evaluateOnNewDocument((tablet) => {
      window.__downloads = []; window.__shares = []; window.__opened = []; window.__printed = [];
      window.print = () => { const s = document.getElementById("pmc-camera-sign"); window.__printed.push(s ? s.textContent : null); };
      window.open = (u) => { window.__opened.push(u); return null; };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push({ name: this.download, url: this.href }); return; } return click.call(this); };
      if (tablet) {
        window.__tap = false;
        window.addEventListener("click", () => { window.__tap = true; }, true);
        window.addEventListener("click", () => { window.__tap = false; }, false);
        Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
        navigator.canShare = (d) => !!(d && d.files && d.files.length);
        navigator.share = (d) => { window.__shares.push({ duringTap: window.__tap, name: d.files[0].name, size: d.files[0].size, keys: Object.keys(d).sort().join(",") }); return Promise.resolve(); };
      }
    }, !!opts.tablet);
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => { localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
    return page;
  }
  const fileOut = async (page, d, name) => {
    const b64 = await page.evaluate(async (url) => { const buf = new Uint8Array(await (await fetch(url)).arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); return btoa(s); }, d.url);
    const f = path.join(TMP, name);
    fs.writeFileSync(f, Buffer.from(b64, "base64"));
    return f;
  };
  const probe = (f) => { try { return parseFloat(execFileSync(FF + "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString()); } catch (e) { return NaN; } };
  const decodes = (f) => { try { execFileSync(FF + "ffmpeg", ["-v", "error", "-i", f, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }); return true; } catch (e) { return false; } };

  // ---- an iPhone: no panel ----
  let page = await open({ ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  check("an iPhone: no 🎬 Record this session", await page.evaluate(() => document.getElementById("local-record-panel").classList.contains("hidden")));
  await page.close();

  // ---- the GitHub site, a computer ----
  page = await open();
  await page.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  for (const t of ["Luigi plays against Luc", "play 8-ball", "race to 5"]) { await page.evaluate((t) => window.PMCVoice.handleText(t), t); await sleep(300); }
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true })));
  check("no local server: 🎬 Record this session is there", await page.evaluate(() => !document.getElementById("local-record-panel").classList.contains("hidden")));
  await page.evaluate(() => document.getElementById("btn-open-recorder").click());
  await sleep(800);
  const opened = await page.evaluate(() => ({ expanded: !document.getElementById("local-record-panel").classList.contains("collapsed"), popup: window.__opened.length }));
  check("the header's 🎬 Record opens it (not the recording page, which needs the Mac)", opened.expanded && opened.popup === 0, opened);

  const soundDefault = await page.evaluate(() => document.getElementById("lrec-sound").checked);
  check("sound is off until turned on (\"🎙️ Record sound too ... ask first\")", soundDefault === false && /ask first/.test(await page.evaluate(() => document.getElementById("lrec-sound").parentNode.textContent)));
  await page.click("#btn-lrec-start");
  await sleep(700);
  const consent = await page.evaluate(() => { const o = document.getElementById("pmc-rec-consent"); return o ? o.textContent : null; });
  check("the first recording on this device asks first: tell everyone at the table (no recording yet)", !!consent && /Tell everyone at the table/.test(consent) && !(await page.evaluate(() => window.PMCLocalRecorder._state().recording)), consent);
  await page.click("#pmc-rec-consent-print");
  await sleep(700);
  const printed = await page.evaluate(() => window.__printed);
  check("...🖨️ the \"Camera in use\" sign prints (sound off: \"No sound is recorded\")", printed.length === 1 && /CAMERA IN USE/.test(printed[0]) && /No sound is recorded/.test(printed[0]), printed);
  await page.click("#pmc-rec-consent-go");
  for (let i = 0; i < 40; i++) { if (await page.evaluate(() => window.PMCLocalRecorder._state().recording)) break; await sleep(250); }
  await sleep(1500);
  let st = await page.evaluate(() => ({ s: window.PMCLocalRecorder._state(), status: document.getElementById("lrec-status").textContent, preview: !document.getElementById("lrec-preview").classList.contains("hidden"), cueBtn: !document.getElementById("recorder-cue-group").classList.contains("hidden"), auto: !document.getElementById("btn-recorder-auto").classList.contains("hidden") }));
  check("● Start recording: recording (" + st.s.mime + "), the picture shown, \"● Recording 0:0x\"", st.s.recording && /mp4/.test(st.s.mime) && st.preview && /^● Recording 0:0\d/.test(st.status), st);
  check("...the score card's ⭐ Cue is there; 🎯 Auto cue isn't (player recognition is off)", st.cueBtn && !st.auto, st);
  if (OUT) await (await page.$("#local-record-panel")).screenshot({ path: OUT + "/local_recording.png" });
  await sleep(6000);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true })));
  await sleep(500);
  const cueOn = await page.evaluate(() => ({ cue: window.PMCLocalRecorder._state().cue, btn: document.getElementById("btn-recorder-cue").textContent }));
  check("\"/\": a cue - from 20 s back (here the recording's start), Luigi-vs-Luc's", cueOn.cue && cueOn.cue.player === "Luigi" && cueOn.cue.opponent === "Luc" && /End cue/.test(cueOn.btn), cueOn);
  await sleep(4000);
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true })));
  await sleep(2500);
  await page.click("#btn-lrec-start"); // stop
  for (let i = 0; i < 40; i++) { if (!(await page.evaluate(() => window.PMCLocalRecorder._state().recording))) break; await sleep(250); }
  await sleep(1000);
  const kept = await page.evaluate(async () => { const s = await window.PMCLocalRecorder._all("sessions"), c = await window.PMCLocalRecorder._all("cues"); return { sessions: s.map((x) => ({ ended: !!x.endedAt, bytes: x.bytes, frags: (x.fragments || []).length, init: !!x.init })), cues: c.map((x) => ({ name: x.name, len: x.endedAt - x.startedAt })) }; });
  const cue = kept.cues[0] || {};
  check("stopped: the recording kept on this device (its fragments indexed), the cue with it", kept.sessions.length === 1 && kept.sessions[0].ended && kept.sessions[0].frags >= 1 && kept.sessions[0].init && kept.cues.length === 1, kept);
  check("...the cue named as usual: Luigi-vs-Luc-8-Ball-game 1 of raceto 5-<length>-<date>-<time>-cued", /^Luigi-vs-Luc-8-Ball-game 1 of raceto 5-\d+s-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}m\d{2}-cued$/.test(cue.name), cue.name);

  // ⬇ Save clip (a computer: downloaded)
  await page.evaluate(() => [...document.querySelectorAll("#lrec-cues .lrec-save")][0].click());
  let d = null;
  for (let i = 0; i < 40 && !d; i++) { await sleep(250); d = await page.evaluate(() => window.__downloads[0] || null); }
  const clip = d ? await fileOut(page, d, "clip.mp4") : null;
  const clipLen = clip ? probe(clip) : NaN;
  check("⬇ Save clip: an ordinary MP4 about as long as the cue (" + (cue.len / 1000).toFixed(1) + " s -> " + (clipLen || 0).toFixed(1) + " s), it decodes cleanly", d && /\.mp4$/.test(d.name) && Math.abs(clipLen - cue.len / 1000) < 2.5 && decodes(clip), { d, clipLen, len: cue.len });
  await page.evaluate(() => [...document.querySelectorAll("#lrec-sessions .lrec-save")][0].click());
  let d2 = null;
  for (let i = 0; i < 40 && !d2; i++) { await sleep(250); d2 = await page.evaluate(() => window.__downloads[1] || null); }
  const whole = d2 ? await fileOut(page, d2, "whole.mp4") : null;
  const wholeLen = whole ? probe(whole) : NaN;
  check("⬇ Save the recording: the whole video (" + (wholeLen || 0).toFixed(1) + " s), it decodes", d2 && wholeLen > 12 && decodes(whole), { d2, wholeLen });
  if (OUT) await (await page.$("#local-record-panel")).screenshot({ path: OUT + "/local_after.png" });
  await page.close();

  // ---- a tablet: Save prepares, then "Share it now" opens the share sheet from that tap ----
  page = await open({ tablet: true });
  await page.evaluate(() => { const b = document.getElementById("btn-toggle-local-record-panel"); if (document.getElementById("local-record-panel").classList.contains("collapsed")) b.click(); });
  await sleep(800);
  const saveBtn = "#lrec-cues .lrec-save";
  await page.click(saveBtn);
  let label = "";
  for (let i = 0; i < 40; i++) { await sleep(250); label = await page.evaluate((s) => document.querySelector(s).textContent, saveBtn); if (/Share it now/.test(label)) break; }
  const before = await page.evaluate(() => window.__shares.length);
  await page.click(saveBtn);
  await sleep(500);
  const shares = await page.evaluate(() => window.__shares);
  check("a tablet: ⬇ Save clip prepares it, then \"📤 Share it now\" - that tap opens the share sheet with the clip", /Share it now/.test(label) && before === 0 && shares.length === 1 && shares[0].duringTap && /\.mp4$/.test(shares[0].name) && shares[0].size > 10000 && shares[0].keys === "files", { label, shares });

  // 🗑 asks first
  const bin = "#lrec-cues .lrec-del";
  await page.click(bin); await sleep(200);
  const asking = await page.evaluate((s) => document.querySelector(s).textContent, bin);
  await page.click(bin); await sleep(800);
  const left = await page.evaluate(async () => (await window.PMCLocalRecorder._all("cues")).length);
  check("🗑 on a cue: \"Delete?\" first, then gone (the recording stays)", asking === "Delete?" && left === 0, { asking, left });
  const sbin = "#lrec-sessions .lrec-del";
  await page.click(sbin); await sleep(200); await page.click(sbin); await sleep(1200);
  const gone = await page.evaluate(async () => ({ s: (await window.PMCLocalRecorder._all("sessions")).length, c: (await window.PMCLocalRecorder._all("chunks")).length }));
  check("🗑 on the recording: gone from this device, its pieces too", gone.s === 0 && gone.c === 0, gone);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
