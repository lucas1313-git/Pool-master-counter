// The camera page's zoom and upside-down turn, with a fake camera playing a
// still test picture (four coloured quarters, a yellow square in the middle):
// the picture on #video zoomed / turned, pixel by pixel; the camera asked
// for more pixels when zooming; the table calibration and the furniture
// snapshot converted exactly (no recalibrating), back to the original
// when zoom and turn are undone; and the scoreboard's Capture Settings
// (Zoom, Camera mounted upside down) reaching the camera page.
// usage: node tests/probe_camera_zoom.js http://localhost:4235/
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the test picture, as a one-frame YUV4MPEG2 file the fake camera loops
const W = 1280, H = 720;
function makeY4m(file) {
  const yuv = { red: [76, 85, 255], green: [150, 44, 21], blue: [29, 255, 107], white: [235, 128, 128], yellow: [210, 16, 146] };
  const colourAt = (x, y) => (Math.abs(x - W / 2) < 40 && Math.abs(y - H / 2) < 40 ? "yellow" : y < H / 2 ? (x < W / 2 ? "red" : "green") : x < W / 2 ? "blue" : "white");
  const Y = Buffer.alloc(W * H), U = Buffer.alloc((W / 2) * (H / 2)), V = Buffer.alloc((W / 2) * (H / 2));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Y[y * W + x] = yuv[colourAt(x, y)][0];
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) { const c = yuv[colourAt(x * 2, y * 2)]; U[y * (W / 2) + x] = c[1]; V[y * (W / 2) + x] = c[2]; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}
// the colour of the test picture at a point of the RAW picture
const rawColour = (x, y) => (Math.abs(x - W / 2) < 40 && Math.abs(y - H / 2) < 40 ? "yellow" : y < H / 2 ? (x < W / 2 ? "red" : "green") : x < W / 2 ? "blue" : "white");
// output pixel -> raw pixel for a centred zoom z and a half turn
function toRaw(x, y, z, flip) {
  let u = x / W, v = y / H;
  if (flip) { u = 1 - u; v = 1 - v; }
  return [W * (0.5 + (u - 0.5) / z), H * (0.5 + (v - 0.5) / z)];
}
const H0 = { h11: 0.1, h12: 0.01, h13: -5, h21: 0.005, h22: 0.12, h23: -3, h31: 0.0001, h32: 0.00005 };
const applyH = (h, x, y) => { const d = h.h31 * x + h.h32 * y + 1; return [(h.h11 * x + h.h12 * y + h.h13) / d, (h.h21 * x + h.h22 * y + h.h23) / d]; };
const BG0 = Array.from({ length: 64 * 48 }, (_, i) => i % 251);
const POINTS = [[100, 100], [1180, 100], [100, 620], [1180, 620], [640, 360], [690, 340], [400, 200], [900, 520]];

(async () => {
  const y4m = path.join(__dirname, "tmphome", "zoom-test.y4m");
  fs.mkdirSync(path.dirname(y4m), { recursive: true });
  makeY4m(y4m);
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m]
  });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    window.__gumAsked = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { window.__gumAsked.push(c && c.video ? { w: c.video.width, h: c.video.height } : null); return gum(c); };
  });
  await page.goto(BASE + "manifest.json");
  await page.evaluate((h, bg) => {
    localStorage.clear();
    localStorage.setItem("pmc-camera-wizard-done", "1");
    localStorage.setItem("pmc-camera-calibration", JSON.stringify({ tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: h }));
    localStorage.setItem("pmc-camera-background-ref", JSON.stringify({ w: 64, h: 48, videoW: 1280, videoH: 720, gray: bg }));
  }, H0, BG0);
  await page.goto(BASE + "camera.html", { waitUntil: "domcontentloaded" });

  const waitPicture = async () => {
    for (let i = 0; i < 60; i++) {
      const ok = await page.evaluate(() => { const v = document.getElementById("video"); return v.videoWidth > 0 && v.readyState >= 2; });
      if (ok) break;
      await sleep(250);
    }
    await sleep(900);
  };
  const colours = () => page.evaluate((pts) => {
    const v = document.getElementById("video");
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(v, 0, 0);
    return pts.map(([x, y]) => {
      const [r, g, b] = ctx.getImageData(Math.round(x * c.width / 1280), Math.round(y * c.height / 720), 1, 1).data;
      if (r > 170 && g > 170 && b > 170) return "white";
      if (r > 170 && g > 150 && b < 110) return "yellow";
      if (r > 150 && g < 110 && b < 110) return "red";
      if (g > 130 && r < 110 && b < 110) return "green";
      if (b > 150 && r < 110 && g < 140) return "blue";
      return "?" + [r, g, b].join(",");
    });
  }, POINTS);
  const stored = () => page.evaluate(() => ({
    h: JSON.parse(localStorage.getItem("pmc-camera-calibration")).h,
    bg: JSON.parse(localStorage.getItem("pmc-camera-background-ref")),
    view: JSON.parse(localStorage.getItem("pmc-camera-view") || "null"),
    dims: [document.getElementById("video").videoWidth, document.getElementById("video").videoHeight]
  }));
  const setView = async (zoom, flip) => {
    await page.evaluate((z, f) => {
      const zi = document.getElementById("zoomInput"), ft = document.getElementById("flip180Toggle");
      if (ft.checked !== f) { ft.checked = f; ft.dispatchEvent(new Event("change")); }
      if (Number(zi.value) !== z) { zi.value = z; zi.dispatchEvent(new Event("change")); }
    }, zoom, flip);
    await sleep(500);
    await waitPicture();
  };
  const expectColours = (z, flip) => POINTS.map(([x, y]) => { const [rx, ry] = toRaw(x, y, z, flip); return rawColour(rx, ry); });
  const calibOk = (h, z, flip) => POINTS.every(([x, y]) => {
    const [rx, ry] = toRaw(x, y, z, flip);
    const a = applyH(h, x, y), b = applyH(H0, rx, ry);
    return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
  });

  await waitPicture();
  let col = await colours(), st = await stored();
  check("plain picture: the test picture as it is", JSON.stringify(col) === JSON.stringify(expectColours(1, false)), { col, want: expectColours(1, false) });
  check("plain: calibration untouched, the view noted", calibOk(st.h, 1, false) && st.view && st.view.zoom === 1 && !st.view.flip, st.view);
  const asked0 = await page.evaluate(() => window.__gumAsked.slice(-1)[0]);
  check("plain: the camera asked for 1280x720", asked0 && asked0.w.ideal === 1280, asked0);
  const place = await page.evaluate(() => {
    const v = document.getElementById("videoWrap").getBoundingClientRect(), z = document.getElementById("zoomBar").getBoundingClientRect();
    return { gap: Math.round(z.top - v.bottom), next: document.getElementById("videoWrap").nextElementSibling.id };
  });
  check("the zoom slider sits right under the picture", place.next === "zoomBar" && place.gap >= 0 && place.gap < 30, place);

  // dragging: the picture follows at once, with the stream already open
  const gum0 = await page.evaluate(() => window.__gumAsked.length);
  for (const z of ["1.1", "1.2", "1.3"]) {
    await page.evaluate((v) => { const zi = document.getElementById("zoomInput"); zi.value = v; zi.dispatchEvent(new Event("input")); }, z);
    await sleep(150);
  }
  await sleep(1000);
  col = await colours(); st = await stored();
  const gum1 = await page.evaluate(() => window.__gumAsked.length);
  check("dragging to 1.3x: the picture follows right away, no camera restart", JSON.stringify(col) === JSON.stringify(expectColours(1.3, false)) && gum1 === gum0, { col, want: expectColours(1.3, false), gum0, gum1 });
  check("dragging: the calibration follows exactly", calibOk(st.h, 1.3, false), st.h);
  await page.evaluate(() => { document.getElementById("zoomInput").dispatchEvent(new Event("change")); });
  await sleep(500);
  await waitPicture();
  const asked13 = await page.evaluate(() => ({ n: window.__gumAsked.length, last: window.__gumAsked.slice(-1)[0] }));
  col = await colours(); st = await stored();
  check("let go at 1.3x: the camera reopened at 1080p for the detail, same picture", asked13.n === gum1 + 1 && asked13.last.w.ideal === 1920 && JSON.stringify(col) === JSON.stringify(expectColours(1.3, false)) && calibOk(st.h, 1.3, false), { asked13, col });

  await setView(2, false);
  col = await colours(); st = await stored();
  check("zoom 2x: the middle of the picture, twice as big (the yellow square reaches 690,340)", JSON.stringify(col) === JSON.stringify(expectColours(2, false)), { col, want: expectColours(2, false) });
  const asked2 = await page.evaluate(() => window.__gumAsked.slice(-1)[0]);
  check("zoom 2x: the camera asked for 1080p (capped there - 4K made the phone hot for nothing)", asked2 && asked2.w.ideal === 1920, asked2);
  check("zoom 2x: the table calibration converted exactly", calibOk(st.h, 2, false), st.h);
  const bgOk2 = st.bg.gray.every((g, i) => {
    const x = i % 64, y = Math.floor(i / 64);
    const uo = 0.5 + ((x + 0.5) / 64 - 0.5) / 2, vo = 0.5 + ((y + 0.5) / 48 - 0.5) / 2;
    return g === BG0[Math.floor(vo * 48) * 64 + Math.floor(uo * 64)];
  });
  check("zoom 2x: the furniture snapshot converted", bgOk2);

  await setView(2, true);
  col = await colours(); st = await stored();
  check("zoom 2x + upside down: turned a half turn", JSON.stringify(col) === JSON.stringify(expectColours(2, true)), { col, want: expectColours(2, true) });
  check("zoom 2x + upside down: calibration still exact", calibOk(st.h, 2, true), st.h);

  await setView(1, true);
  col = await colours(); st = await stored();
  check("upside down only", JSON.stringify(col) === JSON.stringify(expectColours(1, true)) && calibOk(st.h, 1, true), { col, want: expectColours(1, true) });

  await setView(1, false);
  st = await stored();
  check("back to plain: the calibration is the original one again", calibOk(st.h, 1, false) && Object.keys(H0).every((k) => Math.abs(st.h[k] - H0[k]) < 1e-9 * Math.max(1, Math.abs(H0[k]))), st.h);
  check("back to plain: the furniture snapshot is the original one again (worked out from it each time)", JSON.stringify(st.bg.gray) === JSON.stringify(BG0));

  // from the scoreboard: Capture Settings with the same-device camera not running
  const board = await browser.newPage();
  board.on("pageerror", (e) => errors.push("board: " + e.message));
  await board.goto(BASE + "manifest.json");
  await board.evaluate(() => {
    localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
    localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
  });
  await board.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(600);
  await board.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
    s.sameDeviceCameraSetUp = true;
    localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify(s));
  });
  await board.reload({ waitUntil: "networkidle2" });
  await sleep(600);
  const fields = await board.evaluate(() => ({ zoom: !!document.getElementById("capture-zoom"), flip: !!document.getElementById("capture-flip180"), label: (document.querySelector("#camera-picture-frame") || {}).textContent || "" }));
  check("the scoreboard's Capture Settings: Zoom and Camera mounted upside down", fields.zoom && fields.flip && /Camera picture/.test(fields.label), fields);
  await board.evaluate(() => {
    const z = document.getElementById("capture-zoom"), f = document.getElementById("capture-flip180");
    document.getElementById("capture-settings-fields").disabled = false;
    z.value = "1.5"; z.dispatchEvent(new Event("change"));
    f.checked = true; f.dispatchEvent(new Event("change"));
  });
  const saved = await board.evaluate(() => JSON.parse(localStorage.getItem("pmc-camera-settings") || "{}"));
  check("set on the scoreboard (camera not running): kept for the camera page", saved.zoom === 1.5 && saved.flip180 === true, saved);
  await board.close();
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitPicture();
  col = await colours(); st = await stored();
  const ui = await page.evaluate(() => ({ zoom: document.getElementById("zoomInput").value, flip: document.getElementById("flip180Toggle").checked }));
  check("the camera page starts with the scoreboard's choice: zoom 1.5x, upside down", JSON.stringify(col) === JSON.stringify(expectColours(1.5, true)) && ui.zoom === "1.5" && ui.flip, { col, want: expectColours(1.5, true), ui });
  check("...and its calibration converted on the way", calibOk(st.h, 1.5, true), st.h);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
