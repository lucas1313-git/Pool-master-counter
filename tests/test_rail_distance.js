// "Max distance from the rail" (P25), the real functions pulled out of camera.html:
// - the distance from the table is 0 on or over the bed and the straight-line distance to the
//   nearest rail or corner outside it - never negative (it was the signed distance to the nearest
//   rail line, negative outside the table, so the limit never turned anyone away);
// - the side: the rail nearest (inside) or the one it's beyond (outside);
// - feet go down the camera's line of sight to the floor (a synthetic camera above the near side,
//   the calibration's homography from its picture of the table's corners): someone 12 in beyond
//   the far rail is 12 in out, where the felt's plane put their feet over the table; someone 12 in
//   off the near rail is 12 in out, not further;
// - at the table: within the rail limit, and inside the playing area when one is drawn (a person
//   10 in off the end rail, outside the outline, isn't); someone 100 in away isn't.
// usage: node tests/test_rail_distance.js
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "camera.html"), "utf8").split("\n");
function extract(name) {
  const re = new RegExp("^  function " + name + "\\(");
  const start = src.findIndex((l) => re.test(l));
  if (start < 0) return "function " + name + "() { throw new Error('" + name + " missing'); }";
  if (/\}\s*$/.test(src[start]) && (src[start].match(/\{/g) || []).length === (src[start].match(/\}/g) || []).length) return src[start];
  let end = start;
  while (src[end] !== "  }") end++;
  return src.slice(start, end + 1).join("\n");
}
const NAMES = ["nearestRailSide", "distanceToNearestRail", "feetOnFloor", "insidePlayArea", "feetAtTable", "calibXExtent", "calibYExtent",
  "solveLinearSystem", "computeHomography", "applyHomography", "invertHomography", "applyInverseHomography", "solveCameraModel",
  "pixelRay", "projectToPixel", "pointOnRay", "v3dot", "v3scale", "v3sub", "v3len", "v3norm", "v3cross"];
const W = 1280, H = 720;
const F = new Function(
  "var FELT_HEIGHT_IN = 30, ANKLE_ABOVE_FELT_IN = 3 - FELT_HEIGHT_IN, ASSUMED_HFOV_DEG = 78, MIN_TILT_FOR_LENS_DEG = 15, MAP_RANGE_IN = 420, FEET_MODEL_MAX_FIT_PX = 12;\n" +
  "var calibration = null, settings = { railDistanceInches: 30 };\n" +
  "function cameraModel() { return calibration ? solveCameraModel(calibration.h, " + W + ", " + H + ") : null; }\n" +
  NAMES.map(extract).join("\n") +
  "\nreturn { set: function (c) { calibration = c; }, " + NAMES.join(",") + " };")();

let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 900) : "")); if (!ok) fails++; }
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// the distance, uncalibrated (the table's size from the arguments): 100 long (y), 50 wide (x)
F.set(null);
const d = (x, y) => F.distanceToNearestRail({ x, y }, 100, 50);
const side = (x, y) => F.nearestRailSide({ x, y }, 100, 50).side;
check("on the bed: 0 (the middle, a rail, a corner)", d(25, 50) === 0 && d(0, 50) === 0 && d(50, 100) === 0, [d(25, 50), d(0, 50), d(50, 100)]);
check("outside: 10 in off a rail is 10 (each of the four)", d(25, -10) === 10 && d(25, 110) === 10 && d(-10, 50) === 10 && d(60, 50) === 10, [d(25, -10), d(25, 110), d(-10, 50), d(60, 50)]);
check("...off a corner: straight to it (6 and 8 out: 10)", d(-6, -8) === 10, d(-6, -8));
check("...never negative: 100 in away is 100, over the 30 in limit (the old signed distance was -100)", d(25, -100) === 100 && d(25, -100) > 30);
check("the side: nearest rail inside, the rail it's beyond outside", side(25, 2) === 0 && side(25, 98) === 1 && side(2, 50) === 2 && side(48, 50) === 3 && side(25, -10) === 0 && side(25, 120) === 1 && side(-5, 50) === 2 && side(55, 50) === 3);

// a synthetic camera: above the near (y = 0) side, 70 in above the felt, looking at the middle
const L = 100, Wd = 50, f = 900;
const C = [50, -60, 70], target = [50, 25, 0];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const n = Math.hypot(...a); return a.map((v) => v / n); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const fwd = norm(sub(target, C)), right = norm(cross(fwd, [0, 0, 1])), down = cross(fwd, right);
const toPixel = (P) => { const v = sub(P, C), z = dot(v, fwd); return { x: W / 2 + f * dot(v, right) / z, y: H / 2 + f * dot(v, down) / z }; };
const corners = [[0, 0], [L, 0], [L, Wd], [0, Wd]];
const h = F.computeHomography(corners.map((c) => { const p = toPixel([c[0], c[1], 0]); return [p.x, p.y]; }), corners);
F.set({ tableLength: L, tableWidth: Wd, xExtent: L, yExtent: Wd, h });
const m = F.solveCameraModel(h, W, H);
check("the camera model from the calibration: " + Math.round(m.height) + " in above the felt (70), table corners back within " + m.fitPx.toFixed(2) + " px", near(m.height, 70, 1) && m.fitPx < 1, m);

const feet = (x, y) => toPixel([x, y, 3 - 30]); // ankles 3 in off the floor
const farFeet = feet(50, Wd + 12), felt = F.applyHomography(h, farFeet.x, farFeet.y), floor = F.feetOnFloor(farFeet);
check("someone 12 in beyond the FAR rail: on the floor they're 12 in out (" + floor.y.toFixed(1) + "), where the felt's plane put them over the table (" + felt.y.toFixed(1) + ")", near(floor.y, Wd + 12, 0.5) && felt.y < Wd && near(F.distanceToNearestRail(floor, Wd, L), 12, 0.5), { floor, felt });
const nearFeet = feet(50, -12), feltN = F.applyHomography(h, nearFeet.x, nearFeet.y), floorN = F.feetOnFloor(nearFeet);
check("someone 12 in off the NEAR rail: 12 in out (" + floorN.y.toFixed(1) + "), not " + (-feltN.y).toFixed(1) + " as on the felt's plane", near(floorN.y, -12, 0.5) && feltN.y < -14, { floorN, feltN });

// at the table
const at = (x, y) => F.feetAtTable(feet(x, y));
check("at the table: 12 in beyond the far rail yes; 100 in off the near rail no", at(50, Wd + 12).within && !at(50, -100).within, [at(50, Wd + 12), at(50, -100)]);
check("...10 in off the end rail (x = 110): yes, with no playing area drawn", at(L + 10, 25).within && at(L + 10, 25).inArea);
F.set({ tableLength: L, tableWidth: Wd, xExtent: L, yExtent: Wd, h, playArea: [[-40, -40], [80, -40], [80, Wd + 40], [-40, Wd + 40]] });
const endSide = at(L + 10, 25), farSide = at(50, Wd + 12);
check("...a playing area that leaves out the x = 100 end: the person 10 in off that end isn't at the table, the far-side player still is", !endSide.within && !endSide.inArea && near(endSide.dist, 10, 0.5) && farSide.within, { endSide, farSide });
check("uncalibrated or no feet: can't tell (null - not gated)", F.feetAtTable(null) === null && (F.set(null), F.feetAtTable(feet(50, 0))) === null);

console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
