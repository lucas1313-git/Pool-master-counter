// Who's at the table, with a calibrated camera (P25): camera.html in same-device mode, a synthetic
// camera above the near side of a 100 x 50 table (its calibration from where the corners land in
// the picture), synthetic people standing at known spots (their bodies projected through it):
// - "Max distance from the rail" (30 in) turns people away again: 100 in off the near rail isn't
//   at the table (the old signed distance said -100, always "close enough");
// - the feet are taken on the floor, not on the felt's plane: 12 in beyond the FAR rail is at the
//   table, 40 in beyond it isn't (the felt's plane put those feet over the table - "0 in");
// - Table tab › ✏️ Draw the playing area: four taps on the floor round the table but short of the
//   x = 100 end, Done - kept with the calibration, the taps back in table inches within 2 in;
// - with it: the player 12 in beyond the far rail still counts, the one 10 in off that end doesn't
//   (and isn't the one picked when both stand there); Remove the outline: they count again;
// - no page errors.
// usage: node tests/probe_play_area.js http://localhost:4235/ [screenshot dir]
// against a test server (`HOME=tests/tmphome PORT=4235 node server/server.js`).
const puppeteer = require("puppeteer-core");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FELT = 30;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
function makeCamera(C, target, f, W, H) {
  const z = norm(sub(target, C)), x = norm(cross(z, [0, 0, 1])), y = cross(z, x);
  return { C, f, W, H, project(P) { const d = sub(P, C), Z = dot(d, z); return Z > 0 ? { u: W / 2 + f * dot(d, x) / Z, v: H / 2 + f * dot(d, y) / Z } : null; } };
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = M[r][c] / M[c][c]; for (let q = c; q <= n; q++) M[r][q] -= k * M[c][q]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function homography(px, real) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [pX, pY] = px[i], [rX, rY] = real[i];
    A.push([pX, pY, 1, 0, 0, 0, -pX * rX, -pY * rX]); b.push(rX);
    A.push([0, 0, 0, pX, pY, 1, -pX * rY, -pY * rY]); b.push(rY);
  }
  const h = solve(A, b);
  return { h11: h[0], h12: h[1], h13: h[2], h21: h[3], h22: h[4], h23: h[5], h31: h[6], h32: h[7] };
}
const TABLE = [[0, 0], [100, 0], [100, 50], [0, 50]];
const NAMES = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
  "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];
const BODY = { nose: [0, 64], left_eye: [-1.5, 66], right_eye: [1.5, 66], left_ear: [-3, 65], right_ear: [3, 65], left_shoulder: [-8, 56], right_shoulder: [8, 56],
  left_elbow: [-9, 44], right_elbow: [9, 44], left_wrist: [-9, 32], right_wrist: [9, 32], left_hip: [-6, 36], right_hip: [6, 36],
  left_knee: [-6, 19], right_knee: [6, 19], left_ankle: [-6, 3], right_ankle: [6, 3] };
function bodyPose(cam, x, y) {
  const side = norm([-(cam.C[1] - y), cam.C[0] - x, 0]);
  return { score: 0.9, keypoints: NAMES.map((n) => { const [o, hgt] = BODY[n], q = cam.project([x + side[0] * o, y + side[1] * o, hgt - FELT]); return { name: n, x: q.u, y: q.v, score: 0.9 }; }) };
}

(async () => {
  if (!BASE) { console.error("usage: node tests/probe_play_area.js <base url> [screenshot dir]"); process.exit(2); }
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 1000 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("pmc-camera-wizard-done", "1"); });
    await page.goto(BASE + "camera.html?embedded=1", { waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.getElementById("video").videoWidth > 0, { timeout: 60000, polling: 100 });
    const { W, H } = await page.evaluate(() => ({ W: document.getElementById("video").videoWidth, H: document.getElementById("video").videoHeight }));
    const cam = makeCamera([50, -110, 80], [50, 30, -12], W / 2 / Math.tan(40 * Math.PI / 180), W, H);
    const cal = { tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: homography(TABLE.map((p) => { const q = cam.project([p[0], p[1], 0]); return [q.u, q.v]; }), TABLE) };
    await page.evaluate((c) => localStorage.setItem("pmc-camera-calibration", JSON.stringify(c)), cal);
    await page.reload({ waitUntil: "networkidle2" });
    await page.waitForFunction(() => document.getElementById("video").videoWidth > 0 && window.PMCRoomMapDebug && window.PMCRoomMapDebug.cameraModel(), { timeout: 60000, polling: 100 });

    const spots = { far12: [50, 62], far40: [50, 90], end10: [110, 25], near100: [50, -100] };
    const poses = {};
    Object.keys(spots).forEach((k) => { poses[k] = bodyPose(cam, spots[k][0], spots[k][1]); });
    const atTable = () => page.evaluate((poses) => { const out = {}; Object.keys(poses).forEach((k) => { const r = window.PMCCueDebug.atTable(poses[k]); out[k] = r ? { within: r.within, dist: Math.round(r.dist * 10) / 10, inArea: r.inArea } : null; }); return out; }, poses);
    let a = await atTable();
    check("100 in off the near rail: not at the table (" + a.near100.dist + " in)", a.near100 && !a.near100.within && a.near100.dist > 90, a.near100);
    check("12 in beyond the FAR rail: at the table (" + a.far12.dist + " in, the feet on the floor); 40 in beyond: not (" + a.far40.dist + " in)", a.far12.within && Math.abs(a.far12.dist - 12) < 2 && !a.far40.within && Math.abs(a.far40.dist - 40) < 3, a);
    check("10 in off the x = 100 end: at the table, no playing area yet (" + a.end10.dist + " in)", a.end10.within && a.end10.inArea, a.end10);

    // the playing area, tapped on the Table tab
    await page.click("#tabCalibrate");
    await sleep(300);
    const box0 = await page.evaluate(() => ({ shown: !document.getElementById("playAreaBox").hidden, status: document.getElementById("playAreaStatus").textContent }));
    await page.click("#playAreaDrawBtn");
    await sleep(200);
    await page.evaluate(() => document.getElementById("overlay").scrollIntoView({ block: "center" }));
    await sleep(300);
    const AREA = [[-20, -20], [85, -20], [85, 80], [-20, 80]]; // (inside the picture as the page crops it)
    for (const p of AREA) {
      const q = cam.project([p[0], p[1], -FELT]);
      const at = await page.evaluate((u, v) => {
        const ov = document.getElementById("overlay"), vid = document.getElementById("video"), r = ov.getBoundingClientRect();
        const scale = Math.max(ov.width / vid.videoWidth, ov.height / vid.videoHeight), ox = (ov.width - vid.videoWidth * scale) / 2, oy = (ov.height - vid.videoHeight * scale) / 2;
        return { x: r.left + (u * scale + ox) * r.width / ov.width, y: r.top + (v * scale + oy) * r.height / ov.height };
      }, q.u, q.v);
      await page.mouse.click(at.x, at.y);
      await sleep(120);
    }
    const tapping = await page.evaluate(() => document.getElementById("playAreaStatus").textContent);
    await page.evaluate(() => document.getElementById("playAreaDoneBtn").click());
    await sleep(300);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("pmc-camera-calibration")).playArea);
    const close = saved && saved.length === 4 && saved.every((p, i) => Math.hypot(p[0] - AREA[i][0], p[1] - AREA[i][1]) <= 2);
    check("Table tab › ✏️ Draw the playing area (\"" + box0.status + "\"), four taps (\"" + tapping + "\"), Done: kept with the calibration - " + JSON.stringify(saved), box0.shown && /Points tapped: 4/.test(tapping) && close, { box0, tapping, saved });
    if (OUT) {
      await page.evaluate(() => document.getElementById("overlay").scrollIntoView({ block: "center" }));
      await sleep(700);
      await page.screenshot({ path: path.join(OUT, "play_area.png") });
    }
    a = await atTable();
    const picked = await page.evaluate((p) => { const s = window.PMCCueDebug.selectActive([p.end10, p.far12]); return s === null ? null : s === undefined ? "none" : s.keypoints[11].x; }, poses);
    check("with it: 12 in beyond the far rail still counts; 10 in off the left-out end doesn't (inside: " + a.end10.inArea + ")", a.far12.within && !a.end10.within && !a.end10.inArea, a);
    check("...and isn't the one picked when both stand there", picked !== null && Math.abs(picked - poses.far12.keypoints[11].x) < 0.01, picked);
    await page.evaluate(() => document.getElementById("playAreaClearBtn").click());
    await sleep(300);
    a = await atTable();
    const after = await page.evaluate(() => ({ kept: "playArea" in JSON.parse(localStorage.getItem("pmc-camera-calibration")), status: document.getElementById("playAreaStatus").textContent }));
    check("Remove the outline: the end counts again (\"" + after.status + "\")", a.end10.within && !after.kept, { a, after });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
