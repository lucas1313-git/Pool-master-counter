// The 🎯 Auto cue, end to end on the scoreboard and the recording page (two
// tabs, BroadcastChannel), the camera's shots fed in as the scoreboard gets
// them (PMCCameraBridge.reportShot, "ms ago" times - see
// tests/probe_shot_detect.js for the camera's own side). A fake camera (a
// still picture) for the recording.
// Checks: no camera watching -> the button is dimmed, a press says so, no
// cue; pressed, then a shot begins and ends -> kept from 5 s before the
// player got down on it to 5 s after the balls stopped, named as usual,
// the button counting meanwhile; a shot just before the press (look-back)
// -> that one; a shot going on at the press that turns out to be nobody's
// shot, and nothing else -> no clip after the wait ("No shot within ...");
// pressed again -> cancelled; "auto cue" said; the recording page's own
// button and A key; the same shot heard twice (two scoreboards) counted
// once.
// usage: node tests/probe_auto_cue.js http://localhost:4235/   (server: HOME=tests/tmphome PORT=4235 node server/server.js)
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 640, H = 360;
function stillY4m(file) {
  const Y = Buffer.alloc(W * H, 90), U = Buffer.alloc(W * H / 4, 100), V = Buffer.alloc(W * H / 4, 110);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}
const near = (a, b, tol) => typeof a === "number" && Math.abs(a - b) <= tol;

(async () => {
  const ROOT = path.join(__dirname, "tmphome", "Movies", "Pool Master Counter");
  fs.rmSync(ROOT, { recursive: true, force: true });
  const y4m = path.join(__dirname, "tmphome", "auto-still.y4m");
  stillY4m(y4m);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const board = await browser.newPage();
  board.on("pageerror", (e) => errors.push("board: " + e.message));
  await board.goto(BASE + "manifest.json");
  await board.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await board.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  const say = (t) => board.evaluate((t) => window.PMCVoice.handleText(t), t);
  await board.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  for (const t of ["Luigi plays against Luc", "play 8-ball", "race to 5"]) { await say(t); await sleep(400); }
  await board.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true })));

  const rec = await browser.newPage();
  rec.on("pageerror", (e) => errors.push("record: " + e.message));
  await rec.goto(BASE + "manifest.json");
  await rec.evaluate(() => localStorage.setItem("pmc-recorder-settings", JSON.stringify({ sound: false, autoWait: 8 })));
  await rec.evaluate(() => localStorage.setItem("poolMasterCounter.recordingConsent.v1", "probe")); // (asked already - see probe_local_recorder.js)
  await rec.goto(BASE + "record.html", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 40; i++) { if (await rec.evaluate(() => document.getElementById("out").videoWidth > 0)) break; await sleep(250); }
  await rec.click("#recordBtn");
  await sleep(1000);
  await board.bringToFront();

  const shot = (m) => board.evaluate((m) => window.PMCCameraBridge.reportShot(Object.assign({ ts: Date.now() + Math.random() }, m)), m);
  const autoBtn = () => board.evaluate(() => { const b = document.getElementById("btn-recorder-auto"); return { shown: b.offsetParent !== null, text: b.textContent, open: b.classList.contains("open"), off: b.classList.contains("off"), h: Math.round(b.getBoundingClientRect().height) }; });
  const toastText = () => board.evaluate(() => { const t = [...document.querySelectorAll("#page-toast, #win-toast, .toast")].find((x) => !x.classList.contains("hidden") && x.textContent.trim()); return t ? t.textContent : ""; });
  const cues = async () => (await (await fetch(BASE + "api/rec/cues")).json()).cues;
  const recState = () => rec.evaluate(() => window.PMCRecorder.state());

  // A. no camera watching
  await sleep(1300);
  let b = await autoBtn();
  const barH = await board.evaluate(() => Math.round(document.getElementById("btn-board-game").getBoundingClientRect().height));
  check("🎯 Auto cue in the board's top bar while it records (as tall as its other buttons) - dimmed: no camera watching the table", b.shown && b.text === "🎯 Auto cue" && b.off && b.h === barH, { b, barH });
  await board.click("#btn-recorder-auto");
  await sleep(300);
  let t = await toastText();
  check("...pressed: says it needs the camera, nothing started", /needs the camera watching the table/.test(t) && !(await recState()).auto, t);

  // the camera watching (it says so every 3 s)
  await shot({ phase: "watch", ok: true });
  await board.evaluate(() => setInterval(() => window.PMCCameraBridge.reportShot({ phase: "watch", ok: true, ts: Date.now() + Math.random() }), 3000));
  await sleep(1300);
  b = await autoBtn();
  check("the camera says it watches the table: the button is lit, the recording page shows it", !b.off && (await rec.evaluate(() => document.getElementById("shotText").textContent)) === "Shots: the camera is watching the table", b);

  // B. pressed ("*"), then the shot: down on it, the balls roll, still again
  await sleep(6000); // (so 5 s before the shot is inside the recording)
  const pressB = Date.now();
  await board.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "*", bubbles: true })));
  await sleep(1300);
  b = await autoBtn();
  check("\"*\" while recording: an auto cue - the button counts \"Finding the shot 0:01\"", b.open && /^🎯 Finding the shot 0:0[0-2]$/.test(b.text), b);
  const beginB = Date.now();
  await shot({ phase: "begin", aiming: true });
  await sleep(1300);
  b = await autoBtn();
  check("a shot begins: \"🎯 Shot 0:01\"", /^🎯 Shot 0:0[0-2]$/.test(b.text), b);
  await sleep(1200);
  const endB = Date.now();
  await shot({ phase: "end", shot: true, moved: 30, beganAgo: endB - beginB, aimAgo: endB - beginB - 200, endAgo: 2500, shooter: "Luigi" });
  await sleep(1200);
  b = await autoBtn();
  check("the balls stopped: \"Keeping 5 s more\"", b.text === "🎯 Keeping 5 s more", b);
  let cueB = null;
  for (let i = 0; i < 20 && !cueB; i++) { await sleep(500); cueB = (await cues()).find((c) => /^auto/.test(c.source) && c.markedAt >= pressB - 2000); }
  const aimB = beginB + 200, stopB = endB - 2500;
  check("kept, from 5 s before the player got down on it to 5 s after the balls stopped", cueB && near(cueB.startedAt, aimB - 5000, 400) && near(cueB.endedAt, stopB + 5000, 400), cueB && { start: cueB.startedAt - (aimB - 5000), end: cueB.endedAt - (stopB + 5000) });
  check("...named as usual: Luigi-vs-Luc-8-Ball-..., the camera's shot noted", cueB && /^Luigi-vs-Luc-8-Ball-game 1 of raceto 5-\d+s-/.test(cueB.name) && cueB.source === "auto (key)" && cueB.cameraShooter === "Luigi", cueB);
  await sleep(400);
  t = await toastText();
  b = await autoBtn();
  check("...the scoreboard says so (\"Kept: ...\") and the button is back", /Kept: Luigi-vs-Luc/.test(t) && b.text === "🎯 Auto cue" && !b.open, { t, b });

  // C. a shot just before the press: that one (look-back)
  const beginC = Date.now();
  await shot({ phase: "begin", aiming: true });
  await sleep(1500);
  const endC = Date.now();
  await shot({ phase: "end", shot: true, moved: 12, beganAgo: endC - beginC, aimAgo: endC - beginC, endAgo: 300, shooter: "Luc" });
  await shot({ phase: "end", shot: true, moved: 12, beganAgo: endC - beginC, aimAgo: endC - beginC, endAgo: 300, shooter: "Luc", ts: 12345 });
  await shot({ phase: "end", shot: true, moved: 12, beganAgo: endC - beginC, aimAgo: endC - beginC, endAgo: 300, shooter: "Luc", ts: 12345 });
  const seen = await rec.evaluate(() => window.PMCRecorder.shotsSeen().length);
  await sleep(2000);
  await board.click("#btn-recorder-auto");
  let cueC = null;
  for (let i = 0; i < 20 && !cueC; i++) { await sleep(500); cueC = (await cues()).find((c) => /^auto/.test(c.source) && c.cameraShooter === "Luc"); }
  check("a shot 2 s before the press (looking back up to 15 s): that one kept", cueC && near(cueC.startedAt, beginC - 5000, 400) && near(cueC.endedAt, endC - 300 + 5000, 400), cueC);
  check("the same shot heard twice (two scoreboards open): counted once", seen === 3, seen);

  // D. a shot going on at the press that's nobody's shot, then nothing: no clip
  await sleep(1500);
  await rec.evaluate(() => { const i = document.getElementById("autoBack"); i.value = "1"; i.dispatchEvent(new Event("change")); });
  const before = (await cues()).length;
  const beginD = Date.now();
  await shot({ phase: "begin", aiming: false });
  await sleep(500);
  await board.click("#btn-recorder-auto");
  await sleep(1500);
  await shot({ phase: "end", shot: false, moved: 0, beganAgo: Date.now() - beginD, aimAgo: null, endAgo: 200 });
  await sleep(1000);
  const waiting = await recState();
  await sleep(8000);
  t = await toastText();
  check("someone leaned over the table (not a shot) and no shot came within the wait (8 s here): no clip", waiting.auto && waiting.auto.state === "waiting" && (await cues()).length === before && /No shot within 8 s - no clip/.test(t), { state: waiting.auto, t });

  // E. pressed again: cancelled
  await board.click("#btn-recorder-auto");
  await sleep(600);
  await board.click("#btn-recorder-auto");
  await sleep(1300);
  check("pressed again: cancelled", !(await recState()).auto && (await autoBtn()).text === "🎯 Auto cue");

  // F. said: "auto cue", twice
  const v1 = await say("auto cue");
  const v2 = await say("auto cue");
  check("\"auto cue\" said: started, then cancelled - never said out loud", v1.result && v1.result.ok && /finding the shot/.test(v1.result.text) && v1.result.speak === "never" && v2.result && /cancelled/.test(v2.result.text), { v1: v1.result, v2: v2.result });

  // G. the recording page's own button and A key
  await rec.bringToFront();
  await rec.click("#autoBtn");
  await sleep(300);
  const g1 = await rec.evaluate(() => ({ auto: !!window.PMCRecorder.state().auto, text: document.getElementById("autoBtn").textContent, badge: !document.getElementById("autoBadge").hidden }));
  await rec.keyboard.press("a");
  await sleep(300);
  const g2 = await rec.evaluate(() => !!window.PMCRecorder.state().auto);
  check("the recording page: 🎯 Auto cue starts one (✖ Cancel auto cue, a badge on the picture), A cancels it", g1.auto && g1.text === "✖ Cancel auto cue" && g1.badge && !g2, { g1, g2 });

  // H. the recording stops: the auto cue goes with it, the button hides
  await rec.click("#autoBtn");
  await sleep(300);
  await rec.click("#recordBtn");
  await sleep(1500);
  await board.bringToFront();
  await sleep(1500);
  check("the recording stopped: no auto cue left, the cue buttons hidden", !(await recState()).auto && (await board.evaluate(() => document.getElementById("recorder-cue-group").classList.contains("hidden"))));

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
