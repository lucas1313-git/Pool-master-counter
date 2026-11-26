// The camera page's balls into the pockets (a 🏆 winning shot's clip ends 2 s after the ball went
// in - 2026-11-26, the user: "when the ball goes in + 2 seconds") and its "framing" (the recording
// page's 🎥 Follow the shooter), on a synthetic table at 20 frames a second: still; an arm reaching
// over the top-left pocket and away; still; the black ball rolling into the bottom-right pocket
// while the cue ball rolls on for 2 s more; still. A listener on the relay (/ws-camera) hears what
// the camera sends.
// Checks: the arm over a pocket isn't a ball going in; the black ball is - at the bottom-right
// pocket, about when it went in, and the shot's end says so ("pocketAgo"), its last motion (the
// cue ball) about 2 s later; "framing": the table's box in the camera's own picture, the same with
// the camera page zoomed 2x and turned upside down (its picture changed, not the camera's); a
// person's box (framingOf) from the zoomed, turned picture back into the camera's.
// usage: node tests/probe_pocket_drop.js http://localhost:4235/   (server: HOME=tests/tmphome PORT=4235 node server/server.js)
const puppeteer = require("puppeteer-core");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// table 100 x 50 in at 3.6 px per inch from (60, 45) in a 480 x 270 picture - a ball is ~8 px across
const W = 480, H = 270, PX = 3.6, X0 = 60, Y0 = 45, FPS = 20;
const BALL = 1.125 * PX, POCKET = 2.4 * PX;
const at = (xin, yin) => [X0 + xin * PX, Y0 + yin * PX];
const POCKETS = [[0, 0], [100, 0], [100, 50], [0, 50], [50, 0], [50, 50]].map(([x, y]) => at(x, y));
function felt(x, y) { const l = 0.6 + 0.4 * Math.exp(-(((x - 240) ** 2) / (2 * 160 * 160) + ((y - 135) ** 2) / (2 * 90 * 90))); return [34 * l, 128 * l, 66 * l]; }
const RED = at(60, 15);
function frame(o) {
  return (x, y) => {
    if (o.arm && x >= o.arm[0] && x <= o.arm[0] + 10 * PX && y >= o.arm[1] && y <= o.arm[1] + 5 * PX) return [70, 50, 40];
    const near = (c, r) => (x - c[0]) ** 2 + (y - c[1]) ** 2 <= r * r;
    if (o.cue && near(o.cue, BALL)) return [236, 234, 222];
    if (o.black && near(o.black, BALL)) return [22, 22, 24];
    if (near(RED, BALL)) return [205, 32, 30];
    if (POCKETS.some((p) => near(p, POCKET))) return [12, 12, 12];
    if (x < X0 - 2 * PX || x > X0 + 102 * PX || y < Y0 - 2 * PX || y > Y0 + 52 * PX) return [60, 52, 48]; // (the floor)
    if (x < X0 || x > X0 + 100 * PX || y < Y0 || y > Y0 + 50 * PX) return [90, 50, 25]; // (the rails)
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
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const CUE0 = at(25, 25), CUE1 = at(55, 30), BLACK0 = at(82, 36), BLACK1 = at(100, 50);
const ARM_OUT = at(-14, -1), ARM_IN = at(-2, -1);
// 0-2 s still; 2-3 s the arm in over the top-left pocket and out; 3-7 s still; 7-8 s the black ball
// rolls into the bottom-right pocket (in at 7.75 s), the cue ball rolling 7-10 s; 10-17 s still
const FRAMES = []
  .concat(repeat(40, frame({ cue: CUE0, black: BLACK0 })))
  .concat(Array.from({ length: 20 }, (_, i) => frame({ cue: CUE0, black: BLACK0, arm: lerp(ARM_OUT, ARM_IN, i < 10 ? (i + 1) / 10 : (20 - i) / 10) })))
  .concat(repeat(80, frame({ cue: CUE0, black: BLACK0 })))
  .concat(Array.from({ length: 60 }, (_, i) => frame({ cue: lerp(CUE0, CUE1, (i + 1) / 60), black: i < 15 ? lerp(BLACK0, BLACK1, (i + 1) / 16) : null })))
  .concat(repeat(140, frame({ cue: CUE1, black: null })));
const DROP_AT_S = 155 / FPS, MOTION_END_S = 199 / FPS;

const CALIB = { tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: { h11: 1 / PX, h12: 0, h13: -X0 / PX, h21: 0, h22: 1 / PX, h23: -Y0 / PX, h31: 0, h32: 0 } };

function listen() {
  const heard = [];
  const ws = new WebSocket(BASE.replace(/^http/, "ws").replace(/\/$/, "") + "/ws-camera");
  ws.on("open", () => ws.send(JSON.stringify({ type: "hello", role: "listener" })));
  ws.on("message", (d) => { try { const m = JSON.parse(d.toString()); if (m.type === "shot" || m.type === "framing") heard.push(Object.assign({ heardAt: Date.now() }, m)); } catch (e) {} });
  return { heard, close: () => ws.close() };
}
const near = (a, b, tol) => typeof a === "number" && Math.abs(a - b) <= tol;
const boxNear = (a, b, tol) => Array.isArray(a) && a.length === 4 && a.every((v, i) => near(v, b[i], tol));

(async () => {
  const dir = path.join(__dirname, "tmphome");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "pocket-drop.y4m");
  y4m(file, FRAMES);
  const errors = [];
  const rel = listen();
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1000, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + file] });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate((cal) => {
    localStorage.clear();
    localStorage.setItem("pmc-camera-wizard-done", "1");
    localStorage.setItem("pmc-camera-calibration", JSON.stringify(cal));
  }, CALIB);
  await page.goto(BASE + "camera.html", { waitUntil: "domcontentloaded" });

  // the video's start, as the camera page sees it: the first framing after the page is up
  let end = null;
  for (let i = 0; i < 160 && !end; i++) { await sleep(250); end = rel.heard.find((m) => m.type === "shot" && m.phase === "end" && m.shot); }
  const events = await page.evaluate(() => window.PMCCueDebug.pocketEvents());
  const zones = await page.evaluate(() => window.PMCCueDebug.pocketZoneSizes());
  check("six pockets watched, each a patch of cloth", zones.length === 6 && zones.every((z) => z.pixels > 30 && z.min >= 2 && z.max > z.min), zones);
  check("the arm reaching over the top-left pocket: not a ball going in", !events.some((e) => e.pocket === 0), events);
  check("the black ball going into the bottom-right pocket: seen", events.some((e) => e.pocket === 2), events);
  check("...and nothing else (the cue ball rolled nowhere near a pocket)", events.length >= 1 && events.every((e) => e.pocket === 2), events);
  check("the shot (the black ball, the cue ball rolling on) ended: a shot", !!end, rel.heard.filter((m) => m.type === "shot").map((m) => m.phase + (m.phase === "end" ? ":" + m.shot : "")));
  if (end) {
    const drop = end.pocketAgo && end.pocketAgo[0];
    check("...its end says when the ball went in (pocketAgo, one ball)", Array.isArray(end.pocketAgo) && end.pocketAgo.length === 1, end);
    const gap = drop - end.endAgo, want = (MOTION_END_S - DROP_AT_S) * 1000;
    check("...in about " + (want / 1000).toFixed(2) + " s before the table was still again (" + (gap / 1000).toFixed(2) + " s)", near(gap, want, 900), { drop, endAgo: end.endAgo });
    const last = await page.evaluate(() => window.PMCCueDebug.lastShot());
    check("...the ball's pocket kept with it (the bottom-right one)", last && last.pockets && last.pockets.length === 1 && last.pockets[0].pocket === 2, last);
  }

  // framing: the table in the camera's own picture
  const TABLE = [X0 / W, Y0 / H, (X0 + 100 * PX) / W, (Y0 + 50 * PX) / H];
  const framings = rel.heard.filter((m) => m.type === "framing");
  const f1 = framings[framings.length - 1];
  check("framing sent about twice a second", framings.length >= 10, framings.length);
  check("framing: the table's box in the camera's picture", f1 && boxNear(f1.table, TABLE, 0.01), { got: f1 && f1.table, want: TABLE });
  check("framing: nobody down on a shot - no shooter", f1 && f1.shooter === null && f1.aiming === false, f1);
  check("framing: the camera's name and its picture's shape", f1 && typeof f1.camera === "string" && f1.camera.length > 0 && near(f1.aspect, W / H, 0.01), f1);

  // zoomed 2x and turned upside down on the camera page: the camera's picture is the same
  await page.evaluate(() => {
    const zi = document.getElementById("zoomInput"), ft = document.getElementById("flip180Toggle");
    ft.checked = true; ft.dispatchEvent(new Event("change"));
    zi.value = 1.6; zi.dispatchEvent(new Event("change"));
  });
  await sleep(4000);
  // (nobody at the table: the camera looks at it every 3 s or so)
  const since = Date.now();
  let f2 = null;
  for (let i = 0; i < 40 && !f2; i++) { await sleep(250); f2 = rel.heard.filter((m) => m.type === "framing" && m.heardAt > since).pop(); }
  check("zoomed 1.6x + upside down: the table's box the same in the camera's picture", f2 && boxNear(f2.table, TABLE.map((v) => Math.max(0, Math.min(1, v))), 0.012), { got: f2 && f2.table, want: TABLE });
  // a person standing at video (x, y) of the zoomed, turned picture -> the camera's picture
  const shown = await page.evaluate(() => [document.getElementById("video").videoWidth, document.getElementById("video").videoHeight]);
  const kps = [[300, 200], [340, 200], [310, 260], [330, 260], [300, 330], [340, 330]].map(([x, y]) => ({ x, y, score: 0.9 }));
  const box = await page.evaluate((k) => window.PMCCueDebug.framingOf(k), kps);
  const toCam = (x, y) => { const z = 1.6; let u = x / shown[0], v = y / shown[1]; u = 1 - u; v = 1 - v; return [0.5 + (u - 0.5) / z, 0.5 + (v - 0.5) / z]; };
  const size = 130, a = toCam(340 + 0.08 * size, 330 + 0.06 * size), b = toCam(300 - 0.08 * size, 200 - 0.15 * size);
  check("a person's box from the zoomed, turned picture: in the camera's picture (head and feet room kept)", boxNear(box, [a[0], a[1], b[0], b[1]], 0.003), { box, want: [a[0], a[1], b[0], b[1]], shown });

  await browser.close();
  rel.close();
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
