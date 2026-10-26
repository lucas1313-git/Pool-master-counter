// The camera page's shots (for the recording's 🎯 Auto cue), on a synthetic
// table: a looping video - the table still, the cue ball rolling to another
// spot, still again - and another where a dark "arm" sweeps across the
// cloth and nothing moves. A listener on the relay (/ws-camera) hears what
// the camera sends.
// Checks: the camera says it's watching the table ("watch", ok); a rolled
// cue ball = a shot (begin, then end with shot: true, the balls moved, "ms
// ago" times about as long as the rolling plus the settling); an arm over
// the cloth = something happened, not a shot; no table calibrated = "watch"
// with ok false and why.
// usage: node tests/probe_shot_detect.js http://localhost:4235/   (server: HOME=tests/tmphome PORT=4235 node server/server.js)
const puppeteer = require("puppeteer-core");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// table 100 x 50 in at 5 px per inch from (70, 55) in a 640 x 360 picture - a ball is ~11 px across
const W = 640, H = 360, PX = 5, X0 = 70, Y0 = 55, R = 6, FPS = 4;
const at = (xin, yin) => [X0 + xin * PX, Y0 + yin * PX];
function felt(x, y) { const l = 0.55 + 0.45 * Math.exp(-(((x - 320) ** 2) / (2 * 200 * 200) + ((y - 180) ** 2) / (2 * 120 * 120))); return [34 * l, 128 * l, 66 * l]; }
const OTHERS = [[at(60, 15), [205, 32, 30]], [at(75, 35), [240, 200, 40]], [at(30, 30), [20, 20, 20]]];
function frame(cue, arm) {
  return (x, y) => {
    if (arm && x >= arm[0] && x <= arm[0] + 70 && y >= arm[1] && y <= arm[1] + 26) return [70, 50, 40];
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
// a shot: 4 s still at A, 1.5 s rolling to B, 8 s still at B (then the loop jumps back to A)
const SHOT = repeat(16, frame(A)).concat(Array.from({ length: 6 }, (_, i) => frame([A[0] + (B[0] - A[0]) * (i + 1) / 7, A[1] + (B[1] - A[1]) * (i + 1) / 7]))).concat(repeat(32, frame(B)));
// not a shot: an arm sweeps across the cloth for 1.5 s, nothing moves
const ARM = repeat(16, frame(A)).concat(Array.from({ length: 6 }, (_, i) => frame(A, [X0 + 60 + i * 50, Y0 + 100]))).concat(repeat(32, frame(A)));

const CALIB = { tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: { h11: 1 / PX, h12: 0, h13: -X0 / PX, h21: 0, h22: 1 / PX, h23: -Y0 / PX, h31: 0, h32: 0 } };

function listen() {
  const heard = [];
  const ws = new WebSocket(BASE.replace(/^http/, "ws").replace(/\/$/, "") + "/ws-camera");
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", role: "listener" })));
  ws.on("message", (d) => { try { const m = JSON.parse(d.toString()); if (m.type === "shot") heard.push(Object.assign({ heardAt: Date.now() }, m)); } catch (e) {} });
  return { heard, close: () => ws.close() };
}
async function camera(file, calib, errors) {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1000, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + file] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate((cal) => {
    localStorage.clear();
    localStorage.setItem("pmc-camera-wizard-done", "1");
    if (cal) localStorage.setItem("pmc-camera-calibration", JSON.stringify(cal));
  }, calib);
  await page.goto(BASE + "camera.html", { waitUntil: "domcontentloaded" });
  return { browser, page };
}

(async () => {
  const dir = path.join(__dirname, "tmphome");
  fs.mkdirSync(dir, { recursive: true });
  const shotFile = path.join(dir, "shot-roll.y4m"), armFile = path.join(dir, "shot-arm.y4m");
  y4m(shotFile, SHOT);
  y4m(armFile, ARM);
  const errors = [];

  // 1. the cue ball rolls: a shot
  let rel = listen();
  let { browser, page } = await camera(shotFile, CALIB, errors);
  let end = null;
  for (let i = 0; i < 120 && !end; i++) { await sleep(500); end = rel.heard.find((m) => m.phase === "end" && m.shot); }
  const watch = rel.heard.find((m) => m.phase === "watch");
  check("the camera says it's watching the table", watch && watch.ok === true, rel.heard.slice(0, 3));
  check("the cue ball rolled to another spot: a shot (begin, then end with shot: true)", !!end && rel.heard.some((m) => m.phase === "begin" && m.heardAt <= end.heardAt), rel.heard.map((m) => m.phase + (m.phase === "end" ? ":" + m.shot : "")));
  if (end) {
    const lasted = end.beganAgo - end.endAgo, sinceEnd = end.endAgo;
    check("...the balls moved (" + end.moved + " points of the table changed)", end.moved >= 5, end);
    check("...it lasted about as long as the rolling (1.5 s, measured " + (lasted / 1000).toFixed(1) + " s)", lasted >= 500 && lasted <= 4500, end);
    check("...and was said a few seconds after the balls stopped (" + (sinceEnd / 1000).toFixed(1) + " s)", sinceEnd >= 1500 && sinceEnd <= 5000, end);
    check("...nobody aimed (no player in this picture): no aim time, no shooter", end.aimAgo === null && end.shooter === null, end);
  }
  await browser.close();
  rel.close();

  // 2. an arm over the cloth, nothing moves: not a shot
  rel = listen();
  ({ browser, page } = await camera(armFile, CALIB, errors));
  let armEnd = null;
  for (let i = 0; i < 120 && !armEnd; i++) { await sleep(500); armEnd = rel.heard.find((m) => m.phase === "end"); }
  check("an arm swept over the cloth: noticed (begin / end)...", !!armEnd, rel.heard.map((m) => m.phase));
  check("...but not a shot - the balls are where they were", armEnd && armEnd.shot === false && armEnd.moved < 5, armEnd);
  await sleep(6000);
  check("...and no shot from it afterwards either", !rel.heard.some((m) => m.phase === "end" && m.shot), rel.heard.filter((m) => m.phase === "end"));
  await browser.close();
  rel.close();

  // 3. no table calibrated: says why
  rel = listen();
  ({ browser, page } = await camera(shotFile, null, errors));
  let w = null;
  for (let i = 0; i < 60 && !w; i++) { await sleep(500); w = rel.heard.find((m) => m.phase === "watch"); }
  check("no table calibrated: \"watch\" with ok false - calibrate the table", w && w.ok === false && /calibrate/.test(w.why || ""), w);
  await browser.close();
  rel.close();

  check("no page errors", errors.length === 0, errors);
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
