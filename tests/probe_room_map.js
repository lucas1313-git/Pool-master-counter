// Room map: a synthetic camera looking at a synthetic room, checked against the truth.
// - Camera: the table's calibration (from where its corners land in the picture) gives back the
//   camera's lens, position and height; a mirrored corner order and a straight-down view too.
// - Room shape: a depth map ray-traced from a known room (floor, walls, ceiling, a cabinet, the
//   table) in metres along the view, as the depth model gives them - 7% too long, as a model may
//   be - the plan must find the scale from the table, the floor, the cabinet where it is and as
//   tall as it is, the far walls, the camera.
// - People: synthetic walkers (3D bodies projected through the same camera, fed to the real
//   detection loop through PMCCueDebug.posesOverride) - their spot on the map, who they are,
//   where someone who walked out of view could be, and the SVG with every debugging id.
// usage: node tests/probe_room_map.js http://localhost:4237/ [screenshot.png]
// against a test server (`HOME=tests/tmphome PORT=4237 node server/server.js`).
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
const SHOT = process.argv[3];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " - " + detail : ""));
}

const FELT = 30; // floor to felt, as the page assumes
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

// A pinhole camera at C looking at target (table inches, z up from the felt), f pixels.
function makeCamera(C, target, f, W, H) {
  const z = norm(sub(target, C)), x = norm(cross(z, [0, 0, 1])), y = cross(z, x);
  return {
    C, f, W, H,
    project(P) { const d = sub(P, C), Z = dot(d, z); return Z > 0 ? { u: W / 2 + f * dot(d, x) / Z, v: H / 2 + f * dot(d, y) / Z, Z } : null; },
    // a pixel's ray, scaled so its forward part is 1 (a distance along it is the depth)
    ray(u, v) { const a = (u - W / 2) / f, b = (v - H / 2) / f; return [x[0] * a + y[0] * b + z[0], x[1] * a + y[1] * b + z[1], x[2] * a + y[2] * b + z[2]]; }
  };
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
// pixel -> table homography, as the page's own calibration computes it
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
function calibrationFor(cam, mirrored, noisePx) {
  // (noisePx: corners tapped up to that many pixels off, the same each run)
  const off = [[0.8, -0.6], [-0.9, 0.7], [0.6, 0.9], [-0.7, -0.8]];
  const px = TABLE.map((p, i) => { const q = cam.project([p[0], p[1], 0]); return [q.u + (noisePx || 0) * off[i][0], q.v + (noisePx || 0) * off[i][1]]; });
  if (!mirrored) return { tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: homography(px, TABLE) };
  // the same corners, the short side tapped first: x runs along the width - a mirror image of the room's axes
  return { tableLength: 100, tableWidth: 50, xExtent: 50, yExtent: 100, h: homography(px, [[0, 0], [0, 100], [50, 100], [50, 0]]) };
}

// ---- the synthetic room (table inches, z up from the felt) ----
const ROOM = { x0: -120, x1: 230, y0: -110, y1: 160, floor: -FELT, ceiling: 96 - FELT };
const BOXES = [
  { name: "cabinet", x0: 175, x1: 205, y0: 0, y1: 30, z0: -FELT, z1: 40 - FELT },
  { name: "table", x0: -5, x1: 105, y0: -5, y1: 55, z0: -FELT, z1: 0 }
];
function castRay(o, d) {
  let best = Infinity;
  const plane = (axis, v, inside) => { if (Math.abs(d[axis]) < 1e-9) return; const t = (v - o[axis]) / d[axis]; if (t > 1e-6 && t < best) { const p = [o[0] + t * d[0], o[1] + t * d[1], o[2] + t * d[2]]; if (inside(p)) best = t; } };
  const inRoom = (p) => p[0] >= ROOM.x0 - 1e-6 && p[0] <= ROOM.x1 + 1e-6 && p[1] >= ROOM.y0 - 1e-6 && p[1] <= ROOM.y1 + 1e-6 && p[2] >= ROOM.floor - 1e-6 && p[2] <= ROOM.ceiling + 1e-6;
  plane(2, ROOM.floor, inRoom); plane(2, ROOM.ceiling, inRoom);
  plane(0, ROOM.x0, inRoom); plane(0, ROOM.x1, inRoom); plane(1, ROOM.y0, inRoom); plane(1, ROOM.y1, inRoom);
  BOXES.forEach((b) => {
    let t0 = -Infinity, t1 = Infinity;
    [[0, b.x0, b.x1], [1, b.y0, b.y1], [2, b.z0, b.z1]].forEach(([a, lo, hi]) => {
      if (Math.abs(d[a]) < 1e-12) { if (o[a] < lo || o[a] > hi) t0 = Infinity; return; }
      let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    });
    if (t0 <= t1 && t0 > 1e-6 && t0 < best) best = t0;
  });
  return best;
}
// the depth model's kind of output: metres along the view, its scale a little off
function depthMap(cam, gridW) {
  const P = 14, gridH = Math.round(gridW * cam.H / cam.W), w = gridW * P, h = gridH * P, data = new Array(w * h);
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const u = (j + 0.5) * cam.W / w, v = (i + 0.5) * cam.H / h, t = castRay(cam.C, cam.ray(u, v));
    data[i * w + j] = isFinite(t) ? t / 39.37 * 1.07 : 20;
  }
  return { w, h, data, metric: true };
}

// ---- synthetic people: a body standing at (x, y), projected through the camera ----
const NAMES = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
  "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];
const BODY = { nose: [0, 64], left_eye: [-1.5, 66], right_eye: [1.5, 66], left_ear: [-3, 65], right_ear: [3, 65], left_shoulder: [-8, 56], right_shoulder: [8, 56],
  left_elbow: [-9, 44], right_elbow: [9, 44], left_wrist: [-9, 32], right_wrist: [9, 32], left_hip: [-6, 36], right_hip: [6, 36],
  left_knee: [-6, 19], right_knee: [6, 19], left_ankle: [-6, 3], right_ankle: [6, 3] };
function bodyPose(cam, x, y) {
  const side = norm([-(cam.C[1] - y), cam.C[0] - x, 0]); // across the camera's line of sight
  const kps = NAMES.map((n) => {
    const [o, hgt] = BODY[n], q = cam.project([x + side[0] * o, y + side[1] * o, hgt - FELT]);
    return q ? { name: n, x: q.u, y: q.v, score: 0.9 } : { name: n, x: 0, y: 0, score: 0 };
  });
  const hip = kps.filter((k) => /hip/.test(k.name));
  const inFrame = hip.every((k) => k.score > 0 && k.x >= 0 && k.x <= cam.W && k.y >= 0 && k.y <= cam.H);
  return inFrame ? { score: 0.9, keypoints: kps } : null;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 1100 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
  });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => { const t = m.text(); if (/\[PMC (room map|paths)\]/.test(t)) logs.push(t); });
  page.on("pageerror", (e) => logs.push("PAGE ERROR " + e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("pmc-camera-wizard-done", "1"); localStorage.setItem("pmc-camera-settings", JSON.stringify({ labsEnabled: true })); }); // (the Room map is in Labs)
  await page.goto(BASE + "camera.html?embedded=1", { waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.getElementById("video").videoWidth > 0, { timeout: 60000, polling: 100 });
  const { W, H } = await page.evaluate(() => ({ W: document.getElementById("video").videoWidth, H: document.getElementById("video").videoHeight }));
  const f = W / 2 / Math.tan(40 * Math.PI / 180); // 80 degrees across
  const cam = makeCamera([-50, -70, 66], [55, 30, -8], f, W, H);
  const cal = calibrationFor(cam, false);

  // ---- 1: the camera, from the calibration ----
  const geo = await page.evaluate((c, w, h, mc, steep) => {
    const D = window.PMCRoomMapDebug, out = {};
    window.__setCal = (x) => localStorage.setItem("pmc-camera-calibration", JSON.stringify(x));
    // (solveCameraModel reads the table's size from the live calibration)
    localStorage.setItem("pmc-camera-calibration", JSON.stringify(c));
    return out;
  }, cal, W, H);
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.getElementById("video").videoWidth > 0 && window.PMCRoomMapDebug.cameraModel(), { timeout: 60000, polling: 100 });
  let m = await page.evaluate(() => { const m = window.PMCRoomMapDebug.cameraModel(); return { f: m.f, C: m.C, up: m.up, height: m.height, fromTable: m.fromTable, fitPx: m.fitPx, hfov: m.hfov }; });
  check("lens worked out from the table", m.fromTable && Math.abs(m.f - f) / f < 0.02, "f " + m.f.toFixed(1) + " (true " + f.toFixed(1) + "), " + m.hfov.toFixed(1) + " deg");
  check("camera position and height", Math.hypot(m.C[0] - cam.C[0], m.C[1] - cam.C[1], m.C[2] - cam.C[2]) < 2 && m.up === 1 && m.fitPx < 0.5,
    "C " + m.C.map((v) => v.toFixed(1)).join(",") + " (true " + cam.C.join(",") + "), up " + m.up + ", corners " + m.fitPx.toFixed(2) + "px off");
  const onRay = await page.evaluate((pts) => pts.map((p) => window.PMCRoomMapDebug.pointOnRay(p.u, p.v, p.h)),
    [[150, -40, 6], [150, -40, 3 - FELT], [-30, 120, 24]].map(([x, y, h]) => { const q = cam.project([x, y, h]); return { u: q.u, v: q.v, h }; }));
  const truth = [[150, -40], [150, -40], [-30, 120]];
  const errs = onRay.map((p, i) => (p ? Math.hypot(p.x - truth[i][0], p.y - truth[i][1]) : Infinity));
  check("a point at hip, ankle, shoulder height lands where it stands", errs.every((e) => e < 0.5), errs.map((e) => e.toFixed(2)).join(", ") + " in");
  const fovCheck = await page.evaluate(() => {
    const poly = window.PMCRoomMapDebug.visibleFloor(400);
    const inside = (x, y) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; };
    return { n: poly.length, front: inside(150, 80), behind: inside(-110, -100), side: inside(-60, 140) };
  });
  check("what the camera sees of the floor", fovCheck.front && !fovCheck.behind, JSON.stringify(fovCheck));

  const mirrored = await page.evaluate((c, w, h) => { const m = window.PMCRoomMapDebug.solveCameraModel(c.h, w, h); return { C: m.C, up: m.up, f: m.f }; }, calibrationFor(cam, true), W, H);
  check("corners tapped the other way round: the same camera, axes swapped", mirrored.up === -1 && Math.abs(mirrored.C[0] - cam.C[1]) < 2 && Math.abs(mirrored.C[1] - cam.C[0]) < 2 && Math.abs(Math.abs(mirrored.C[2]) - 66) < 2,
    "C " + mirrored.C.map((v) => v.toFixed(1)).join(",") + ", up " + mirrored.up);
  const steep = await page.evaluate((c, w, h) => { const m = window.PMCRoomMapDebug.solveCameraModel(c.h, w, h); return { fromTable: m.fromTable, hfov: m.hfov, height: m.height }; },
    calibrationFor(makeCamera([50, 25, 90], [52, 26, 0], f, W, H), false, 1.5), W, H);
  check("nearly straight down at the table, corners a pixel or two off: the lens is assumed, not guessed wildly", !steep.fromTable && steep.hfov === 78, JSON.stringify(steep));
  const noisy = await page.evaluate((c, w, h) => { const m = window.PMCRoomMapDebug.solveCameraModel(c.h, w, h); return { fromTable: m.fromTable, hfov: m.hfov, C: m.C }; }, calibrationFor(cam, false, 1.5), W, H);
  check("the usual slanted view, corners a pixel or two off: still worked out", noisy.fromTable && Math.abs(noisy.hfov - 80) < 6 && Math.hypot(noisy.C[0] - cam.C[0], noisy.C[1] - cam.C[1], noisy.C[2] - cam.C[2]) < 10,
    noisy.hfov.toFixed(1) + " deg, C " + noisy.C.map((v) => v.toFixed(1)).join(","));

  // ---- 2: the room's shape from a depth map ----
  const depth = depthMap(cam, 46);
  const plan = await page.evaluate((d) => window.PMCRoomMapDebug.planFromDepth({ w: d.w, h: d.h, data: Float32Array.from(d.data), metric: true }), depth);
  const fit = plan.fit;
  check("scale from the table: its sides measure right, the cloth flat", Math.abs(fit.sides[0] - 100) < 1 && Math.abs(fit.sides[1] - 50) < 0.5 && fit.clothRmsIn < 0.5 && Math.abs(fit.scale * 1.07 - 1) < 0.01,
    "sides " + fit.sides.map((v) => v.toFixed(2)).join(" x ") + ", scale " + fit.scale.toFixed(4) + " (1/1.07 = 0.9346), cloth rms " + fit.clothRmsIn.toFixed(2) + "in");
  check("the floor found: 30in below the cloth, level with it", !fit.floorAssumed && Math.abs(fit.clothAboveFloorIn - 30) < 1 && fit.floorTiltDeg < 1, fit.clothAboveFloorIn.toFixed(2) + "in, " + fit.floorTiltDeg.toFixed(2) + " deg, rms " + fit.floorRmsIn.toFixed(2));
  check("the camera from the depth alone", Math.hypot(fit.camera.x - cam.C[0], fit.camera.y - cam.C[1]) < 3 && Math.abs(fit.camera.h - (cam.C[2] + FELT)) < 2, "(" + fit.camera.x.toFixed(1) + ", " + fit.camera.y.toFixed(1) + "), " + fit.camera.h.toFixed(1) + "in up (true " + cam.C[0] + ", " + cam.C[1] + ", " + (cam.C[2] + FELT) + ")");
  const centroid = (o) => { let x = 0, y = 0; for (let q = 0; q < o.cells.length; q += 2) { x += (o.cells[q] + 0.5) * plan.cell; y += (o.cells[q + 1] + 0.5) * plan.cell; } return [x / (o.cells.length / 2), y / (o.cells.length / 2)]; };
  const cabinet = plan.objects.find((o) => { const [x, y] = centroid(o); return Math.hypot(x - 190, y - 15) < 20; });
  check("the cabinet: where it is, as tall as it is", cabinet && cabinet.hMax >= 35 && cabinet.hMax <= 45,
    cabinet ? cabinet.id + " at " + centroid(cabinet).map((v) => v.toFixed(0)).join(",") + ", " + cabinet.hLow + "-" + cabinet.hMax + "in high" : plan.objects.map((o) => o.id + "@" + centroid(o).map(Math.round)).join(" "));
  const wallCells = (test) => plan.objects.reduce((n, o) => { for (let q = 0; q < o.cells.length; q += 2) if (test((o.cells[q] + 0.5) * plan.cell, (o.cells[q + 1] + 0.5) * plan.cell)) n++; return n; }, 0);
  const farWall = wallCells((x, y) => Math.abs(x - 230) < 10), sideWall = wallCells((x, y) => Math.abs(y - 160) < 10), openFloor = wallCells((x, y) => x > 110 && x < 160 && y > 60 && y < 130);
  check("the far walls, and open floor left open", farWall > 10 && sideWall > 10 && openFloor === 0, "far wall " + farWall + " squares, side wall " + sideWall + ", open floor " + openFloor + " (" + plan.objects.length + " things)");

  // ---- 3: people ----
  await page.evaluate((p) => {
    // two players with samples (any samples - names come from the walking paths here)
    const d = () => Array.from({ length: 208 }, (_, i) => (i === 3 ? 1 : 0));
    const st = { alice: { displayName: "Alice", descriptors: [d(), d(), d()], info: [null, null, null] }, bob: { displayName: "Bob", descriptors: [d(), d(), d()], info: [null, null, null] } };
    localStorage.setItem("pmc-camera-local-enrollments", JSON.stringify(st));
  }, plan);
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(() => document.getElementById("video").videoWidth > 0 && window.PMCRoomMapDebug.cameraModel() && Object.keys(window.PMCCameraDebug.getEnrollments()).length === 2, { timeout: 60000, polling: 100 });
  await page.evaluate(() => {
    window.__people = []; window.__poses = []; window.__ticks = 0; window.__truth = {};
    window.PMCCueDebug.posesOverride = function () {
      window.__ticks++;
      window.__poses = [];
      window.__people.forEach((p, who) => {
        p.x += p.vx || 0; p.y += p.vy || 0;
        const pose = window.__bodyPose(p.x, p.y);
        if (!pose) return;
        pose.who = who;
        window.__poses.push(pose);
      });
      return window.__poses;
    };
  });
  await page.exposeFunction("__noop", () => 0);
  // the body builder lives in the page too (the camera's numbers passed in)
  await page.evaluate((camSpec, names, body, felt) => {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const { C, target, f, W, H } = camSpec, z = norm(sub(target, C)), x = norm(cross(z, [0, 0, 1])), y = cross(z, x);
    const project = (P) => { const d = sub(P, C), Z = dot(d, z); return Z > 0 ? { u: W / 2 + f * dot(d, x) / Z, v: H / 2 + f * dot(d, y) / Z } : null; };
    window.__bodyPose = (px, py) => {
      const side = norm([-(C[1] - py), C[0] - px, 0]);
      const kps = names.map((n) => { const [o, hgt] = body[n], q = project([px + side[0] * o, py + side[1] * o, hgt - felt]); return q ? { name: n, x: q.u + (Math.random() - 0.5), y: q.v + (Math.random() - 0.5), score: 0.9 } : { name: n, x: 0, y: 0, score: 0 }; });
      const hips = kps.filter((k) => /hip/.test(k.name));
      return hips.every((k) => k.score > 0 && k.x >= 0 && k.x <= W && k.y >= 0 && k.y <= H) ? { score: 0.9, keypoints: kps } : null;
    };
  }, { C: cam.C, target: [55, 30, -8], f, W, H }, NAMES, BODY, FELT);
  await page.waitForFunction(() => window.__ticks > 2, { timeout: 60000, polling: 100 });
  const looks = async (n) => { const t = await page.evaluate(() => window.__ticks); await page.waitForFunction((k) => window.__ticks >= k, { timeout: 60000, polling: 20 }, t + n); };
  const pathOf = (who) => page.evaluate((w) => { const pose = window.__poses.find((q) => q.who === w); return pose ? pose.id : null; }, who);

  // Alice walks along the near long side, then stands; Bob stands at the far end
  await page.evaluate(() => { window.__people = [{ x: 10, y: -45, vx: 9, vy: 0 }, { x: 150, y: 60, vx: 0, vy: 0 }]; });
  await looks(10);
  await page.evaluate(() => { window.__people[0].vx = 0; });
  await looks(6);
  const ida = await pathOf(0), idb = await pathOf(1);
  await page.evaluate((a, b) => {
    const paths = window.PMCCueDebug.getWalkingPaths();
    paths.find((p) => p.id === a).name = "Alice";
    paths.find((p) => p.id === b).name = "Bob";
  }, ida, idb);
  await looks(4);
  let st = await page.evaluate((a, b) => { const t = window.PMCRoomMapDebug.tracks(); return { a: t[a] && { pos: t[a].pos, probs: t[a].probs, points: t[a].points.length }, b: t[b] && { pos: t[b].pos, probs: t[b].probs } }; }, ida, idb);
  const alice = await page.evaluate(() => window.__people[0]);
  check("Alice on the map where she stands", st.a && Math.hypot(st.a.pos.x - alice.x, st.a.pos.y - alice.y) < 3, st.a ? "(" + st.a.pos.x.toFixed(1) + ", " + st.a.pos.y.toFixed(1) + ") vs (" + alice.x.toFixed(1) + ", " + alice.y.toFixed(1) + ")" : "no track");
  check("Bob too", st.b && Math.hypot(st.b.pos.x - 150, st.b.pos.y - 60) < 3, st.b ? "(" + st.b.pos.x.toFixed(1) + ", " + st.b.pos.y.toFixed(1) + ")" : "no track");
  check("the way Alice walked is kept", st.a && st.a.points >= 8, st.a && st.a.points + " points");
  check("who is who: each path's name, nobody twice", st.a.probs.Alice >= 0.6 && st.b.probs.Bob >= 0.6 && st.a.probs.Bob < 0.2 && st.b.probs.Alice < 0.2,
    "track " + ida + ": " + JSON.stringify(Object.fromEntries(Object.entries(st.a.probs).map(([k, v]) => [k, +v.toFixed(2)]))) + ", track " + idb + ": " + JSON.stringify(Object.fromEntries(Object.entries(st.b.probs).map(([k, v]) => [k, +v.toFixed(2)]))));

  // Bob walks off out of the picture (towards the camera's right edge)
  await page.evaluate(() => { const b = window.__people[1]; b.vx = 5; b.vy = -12; });
  await page.waitForFunction(() => !window.__poses.some((q) => q.who === 1), { timeout: 30000, polling: 50 });
  const goneAt = await page.evaluate(() => ({ x: window.__people[1].x, y: window.__people[1].y }));
  await page.evaluate(() => { window.__people[1].hidden = true; window.__people[1].vx = 0; window.__people[1].vy = 0; });
  await looks(10);
  await page.evaluate(() => document.getElementById("tabRoomMap").click());
  await new Promise((r) => setTimeout(r, 400));
  const bobGhost = await page.evaluate(() => { const p = window.PMCRoomMapDebug.players().bob; return p && { inView: p.inView, last: p.last }; });
  const svg1 = await page.evaluate(() => document.getElementById("roomMapSvg").innerHTML);
  check("Bob out of view: last seen where he left, a zone of where he could be", bobGhost && bobGhost.inView < 0.5 && bobGhost.last && Math.hypot(bobGhost.last.x - goneAt.x, bobGhost.last.y - goneAt.y) < 25 && /Bob - out of view \d+s/.test(svg1),
    bobGhost ? "last (" + bobGhost.last.x.toFixed(0) + ", " + bobGhost.last.y.toFixed(0) + "), left the picture near (" + goneAt.x.toFixed(0) + ", " + goneAt.y.toFixed(0) + "), in view " + bobGhost.inView.toFixed(2) : "none");
  check("the zone leaves out what the camera sees", /mask="url\(#rmOutOfView\)"/.test(svg1) && /<mask id="rmOutOfView"/.test(svg1), (svg1.match(/>[^<]*out of view[^<]*</g) || []).join(" ") + " | " + svg1.length + " chars: " + (svg1.match(/<text[^>]*>[^<]*<\/text>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(" / ").slice(0, 400));

  if (SHOT) await (await page.$("#roomMapPanel")).screenshot({ path: SHOT.replace(/\.png$/, "-out-of-view.png") });
  // the room's shape on the map, and every id
  await page.evaluate(() => window.PMCCameraDebug.takeEmptySnapshot());
  await page.evaluate((p) => window.PMCRoomMapDebug.setPlan(p), plan);
  await page.evaluate(() => window.PMCRoomMapDebug.render());
  const svg2 = await page.evaluate(() => document.getElementById("roomMapSvg").innerHTML);
  const ids = { table: /T {2}100×50in/.test(svg2), cam: /CAM {2}8\.0 ft up/.test(svg2), fov: />FOV</.test(svg2), objects: /class="rm-obj [a-z]+"/.test(svg2) && />o1 \d+in</.test(svg2), paths: new RegExp(">Alice {2}" + ida + "<").test(svg2), odds: /Alice \d+%/.test(svg2) };
  check("the map shows T, CAM, FOV, o1.., the walking path ids and the odds", Object.values(ids).every(Boolean), JSON.stringify(ids));
  const people = await page.evaluate(() => document.getElementById("roomMapPeople").textContent);
  check("the list below: tracks and players", new RegExp(ida).test(people) && /Bob.*out of view/.test(people), people.slice(0, 160));

  // Bob walks back in along the way he left: the same walking path, in view again
  await page.evaluate(() => { const b = window.__people[1]; b.hidden = false; b.x -= 5 * 2; b.y += 12 * 2; b.vx = -5; b.vy = 12; });
  await page.waitForFunction(() => window.__poses.some((q) => q.who === 1), { timeout: 30000, polling: 50 });
  await page.evaluate(() => { const b = window.__people[1]; b.vx = 0; b.vy = 0; });
  await looks(6);
  const back = await page.evaluate(() => { const p = window.PMCRoomMapDebug.players().bob; return { id: (window.__poses.find((q) => q.who === 1) || {}).id, inView: p.inView }; });
  check("Bob back in view on his path: same track, in view", back.id === idb && back.inView >= 0.5, back.id + " (was " + idb + "), in view " + back.inView.toFixed(2));

  // time spent, then the picture
  await page.evaluate(() => { document.getElementById("roomMapOpt-dwell").click(); });
  await new Promise((r) => setTimeout(r, 400));
  const dwell = await page.evaluate(() => /s here<\/title>/.test(document.getElementById("roomMapSvg").innerHTML));
  check("time spent squares", dwell);
  if (SHOT) {
    const el = await page.$("#roomMapPanel");
    await el.screenshot({ path: SHOT });
    console.log("screenshot: " + SHOT);
  }
  check("no page errors", !logs.some((l) => /PAGE ERROR/.test(l)), logs.filter((l) => /PAGE ERROR/.test(l)).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + (results.length - failed) + "/" + results.length + " passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
