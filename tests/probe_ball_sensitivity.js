// Ball detection sensitivity, against the empty-room snapshot. A synthetic
// table: green felt under a lamp (bright in the middle, the corners less
// than half as bright), first empty - the snapshot is taken from it - then
// with a red ball, the cue ball and a "hard" ball: the felt's own colour,
// just 30% darker. The camera page is opened twice in one browser profile
// (the snapshot kept in between), as on a real evening.
// Checks: at 5 (standard) the red ball and the cue ball, not the hard one;
// at 10 the hard one too, and still no false ball in the dark corners (the
// snapshot knows the lighting); at 1 the red ball still; the pink preview
// on the picture; the setting kept; the scoreboard's Capture Settings field.
// usage: node tests/probe_ball_sensitivity.js http://localhost:4235/ [screenshot dir]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// table 100 x 50 in, 10 px per inch, from (140,110) - a ball is ~22px across
const W = 1280, H = 720, PX = 10, X0 = 140, Y0 = 110;
const at = (xin, yin) => [X0 + xin * PX, Y0 + yin * PX];
const BALLS = { red: at(40, 20), hard: at(70, 30), cue: at(20, 35) };
const R = 11;
function light(x, y) { return 0.42 + 0.58 * Math.exp(-(((x - 640) ** 2) / (2 * 380 * 380) + ((y - 360) ** 2) / (2 * 230 * 230))); }
function felt(x, y) { const l = light(x, y); return [34 * l, 128 * l, 66 * l]; }
function pixel(x, y, withBalls) {
  if (withBalls) {
    const inBall = (c) => (x - c[0]) ** 2 + (y - c[1]) ** 2 <= R * R;
    if (inBall(BALLS.red)) return [205, 32, 30];
    if (inBall(BALLS.cue)) return [236, 234, 222];
    if (inBall(BALLS.hard)) return felt(x, y).map((v) => v * 0.7);
  }
  return felt(x, y);
}
function makeY4m(file, withBalls) {
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = pixel(x, y, withBalls);
    Y[y * W + x] = Math.max(0, Math.min(255, Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
  }
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
    const [r, g, b] = pixel(x * 2 + 0.5, y * 2 + 0.5, withBalls);
    U[y * (W / 2) + x] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)));
    V[y * (W / 2) + x] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)));
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}

async function openCamera(y4m, profile, errors) {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", userDataDir: profile, defaultViewport: { width: 1100, height: 1300 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m]
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { browser, page };
}
async function waitPicture(page) {
  for (let i = 0; i < 60; i++) {
    if (await page.evaluate(() => { const v = document.getElementById("video"); return v.videoWidth > 0 && v.readyState >= 2; })) break;
    await sleep(250);
  }
  await sleep(1200);
}

(async () => {
  const dir = path.join(__dirname, "tmphome");
  const emptyFile = path.join(dir, "felt-empty.y4m"), ballsFile = path.join(dir, "felt-balls.y4m");
  const profile = path.join(dir, "ball-sensitivity-profile");
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });
  makeY4m(emptyFile, false);
  makeY4m(ballsFile, true);
  const errors = [];

  // 1. the empty table: calibrate, take the snapshot
  let { browser, page } = await openCamera(emptyFile, profile, errors);
  await page.goto(BASE + "manifest.json");
  await page.evaluate((cal) => {
    localStorage.clear();
    localStorage.setItem("pmc-camera-wizard-done", "1");
    localStorage.setItem("pmc-camera-calibration", JSON.stringify(cal));
    localStorage.setItem("pmc-camera-settings", JSON.stringify({ ballTrackingEnabled: true }));
  }, { tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: { h11: 1 / PX, h12: 0, h13: -X0 / PX, h21: 0, h22: 1 / PX, h23: -Y0 / PX, h31: 0, h32: 0 } });
  await page.goto(BASE + "camera.html", { waitUntil: "domcontentloaded" });
  await waitPicture(page);
  const snap = await page.evaluate(() => window.PMCBallDebug.takeEmptySnapshot());
  check("the empty table: snapshot taken and kept", snap && snap.saved, snap);
  await browser.close();

  // 2. the same table with balls
  ({ browser, page } = await openCamera(ballsFile, profile, errors));
  await page.goto(BASE + "camera.html", { waitUntil: "domcontentloaded" });
  await waitPicture(page);
  const place = await page.evaluate(() => {
    const z = document.getElementById("zoomBar"), b = document.getElementById("ballSensitivityBar");
    return { after: z.nextElementSibling === b, gap: Math.round(b.getBoundingClientRect().top - z.getBoundingClientRect().bottom) };
  });
  check("the ball sensitivity slider sits right under the picture, below the zoom", place.after && place.gap >= 0 && place.gap < 20, place);
  const at5 = async (s) => {
    await page.evaluate((v) => { const i = document.getElementById("ballSensitivityInput"); i.value = String(v); i.dispatchEvent(new Event("input")); }, s);
    await sleep(300);
    return page.evaluate((balls) => {
      const st = window.PMCBallDebug.preview();
      const o = document.getElementById("overlay"), v = document.getElementById("video");
      const ctx = o.getContext("2d");
      const scale = Math.max(o.width / v.videoWidth, o.height / v.videoHeight);
      const ox = (o.width - v.videoWidth * scale) / 2, oy = (o.height - v.videoHeight * scale) / 2;
      const pinkAt = (p) => { const d = ctx.getImageData(Math.round(p[0] * scale + ox), Math.round(p[1] * scale + oy), 1, 1).data; return d[0] > 150 && d[2] > 100 && d[1] < 140; };
      return Object.assign(st, { pinkHard: pinkAt(balls.hard), hint: document.getElementById("ballSensitivityHint").textContent });
    }, BALLS);
  };
  let p5 = await at5(5);
  check("sensitivity 5 (standard): the red ball and the cue ball, compared with the snapshot", p5.usedSnapshot && p5.objectCount === 1 && p5.cuePresent, p5);
  check("...the hard ball (felt colour, 30% darker) isn't seen at 5", !p5.pinkHard, p5);
  let p10 = await at5(10);
  check("sensitivity 10: the hard ball found too (2 balls + cue)", p10.usedSnapshot && p10.objectCount === 2 && p10.cuePresent, p10);
  check("...shown pink on the picture", p10.pinkHard, p10);
  if (OUT) await page.screenshot({ path: OUT + "/ball_sensitivity_10.png" });
  check("...and no false ball in the dark corners: the snapshot knows the lighting", p10.foreignFraction < 0.02, p10);
  let p1 = await at5(1);
  check("sensitivity 1: the red ball and the cue ball still", p1.objectCount === 1 && p1.cuePresent, p1);
  check("the hint under the slider says what it sees", /1 ball seen at 1 \+ the cue ball - compared with the empty-room snapshot/.test(p1.hint), p1.hint);
  await page.evaluate(() => { const i = document.getElementById("ballSensitivityInput"); i.value = "8"; i.dispatchEvent(new Event("change")); });
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("pmc-camera-settings")).ballSensitivity);
  check("letting go keeps the sensitivity", kept === 8, kept);

  // without the snapshot, the felt's one colour: the lamp's dark corners
  // read as "not felt" at a high sensitivity
  await page.evaluate(() => window.PMCCameraDebug && window.PMCCameraDebug.forgetEmptyRoom ? window.PMCCameraDebug.forgetEmptyRoom() : document.getElementById("emptyRoomClearBtn").click());
  await sleep(300);
  const noSnap = await at5(10);
  check("(for comparison) no snapshot, sensitivity 10: the lamp's dark corners count as not felt", !noSnap.usedSnapshot && noSnap.foreignFraction > p10.foreignFraction + 0.05, { noSnap: noSnap.foreignFraction, withSnap: p10.foreignFraction });
  await browser.close();

  // the scoreboard's field
  const b2 = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const board = await b2.newPage();
  board.on("pageerror", (e) => errors.push("board: " + e.message));
  await board.goto(BASE + "manifest.json");
  await board.evaluate(() => { localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await board.goto(BASE, { waitUntil: "networkidle2" });
  const field = await board.evaluate(() => { const i = document.getElementById("capture-ball-sensitivity"); return i ? { min: i.min, max: i.max, value: i.value } : null; });
  check("the scoreboard's Capture Settings: Ball detection sensitivity 1-10", field && field.min === "1" && field.max === "10", field);
  await b2.close();

  fs.rmSync(profile, { recursive: true, force: true });
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
