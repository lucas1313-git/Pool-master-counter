// Room tags: the camera page tags everything in the empty-room snapshot
// (camera/segment.js - DINOv2 + Meta's ADE20K head) and keeps the tags; the
// table's rails and pockets come from the calibration. A fake camera plays a
// still room photo (any photo of a room with a pool table; the check was made
// with the public-domain "Pool Table—Valley Forge Farm.jpg" from Wikimedia
// Commons, https://commons.wikimedia.org/wiki/File:Pool_Table%E2%80%94Valley_Forge_Farm.jpg).
// Checks: the snapshot gets tagged (a pool table, chairs...); the tags are
// kept and come back after a reload without running the model again; a
// "person" inside a tagged picture is set aside, a bigger one isn't; a
// "person" on a tagged chair that looks just like the empty room is set
// aside; 4 rails and 6 pockets; the tags drawn on the picture; forgetting
// the snapshot forgets the tags.
// usage: node tests/probe_room_tags.js http://localhost:4235/ <room photo> [screenshot dir]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, PHOTO, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1280, H = 720;

// the photo -> a one-frame 1280x720 YUV4MPEG2 file (decoded by the browser)
async function photoToY4m(browser, photo, file) {
  const page = await browser.newPage();
  const b64 = fs.readFileSync(photo).toString("base64");
  const rgb = await page.evaluate(async (src, W, H) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const s = W / img.naturalWidth, h = img.naturalHeight * s;
    c.getContext("2d").drawImage(img, 0, (H - h) / 2, W, h);
    return Array.from(c.getContext("2d").getImageData(0, 0, W, H).data);
  }, "data:image/jpeg;base64," + b64, W, H);
  await page.close();
  const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
  for (let i = 0; i < W * H; i++) Y[i] = Math.round(0.299 * rgb[i * 4] + 0.587 * rgb[i * 4 + 1] + 0.114 * rgb[i * 4 + 2]);
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
    let r = 0, g = 0, b = 0;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const p = ((y * 2 + dy) * W + x * 2 + dx) * 4; r += rgb[p] / 4; g += rgb[p + 1] / 4; b += rgb[p + 2] / 4; }
    U[y * W / 2 + x] = Math.max(0, Math.min(255, Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b)));
    V[y * W / 2 + x] = Math.max(0, Math.min(255, Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b)));
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}

(async () => {
  if (!BASE || !PHOTO) { console.error("usage: node tests/probe_room_tags.js <base url> <room photo> [screenshot dir]"); process.exit(2); }
  const dir = path.join(__dirname, "tmphome"), y4m = path.join(dir, "room-tags.y4m"), profile = path.join(dir, "room-tags-profile");
  fs.mkdirSync(dir, { recursive: true });
  fs.rmSync(profile, { recursive: true, force: true });
  const conv = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  await photoToY4m(conv, PHOTO, y4m);
  await conv.close();

  const errors = [];
  const launch = () => puppeteer.launch({
    executablePath: EXE, headless: "new", userDataDir: profile, defaultViewport: { width: 1100, height: 1300 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m]
  });
  let browser = await launch();
  let page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("pmc-camera-wizard-done", "1");
    localStorage.setItem("pmc-camera-settings", JSON.stringify({ labsEnabled: true })); // (room tags are in Labs)
    // a table across the lower middle of the picture (100 x 50 in, 6 px per inch)
    localStorage.setItem("pmc-camera-calibration", JSON.stringify({ tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: { h11: 1 / 6, h12: 0, h13: -340 / 6, h21: 0, h22: 1 / 6, h23: -400 / 6, h31: 0, h32: 0 } }));
  });
  const waitPicture = async () => {
    for (let i = 0; i < 80; i++) {
      if (await page.evaluate(() => { const v = document.getElementById("video"); return v.videoWidth > 0 && v.readyState >= 2; })) break;
      await sleep(250);
    }
    await sleep(1000);
  };
  await page.goto(BASE + "camera.html", { waitUntil: "domcontentloaded" });
  await waitPicture();

  const snap = await page.evaluate(() => window.PMCBallDebug.takeEmptySnapshot());
  check("snapshot taken", snap && snap.saved, snap);
  let tags = null;
  const t0 = Date.now();
  for (let i = 0; i < 120 && !tags; i++) { await sleep(500); tags = await page.evaluate(() => window.PMCBallDebug.roomTags()); }
  const took = ((Date.now() - t0) / 1000).toFixed(1);
  const names = tags ? Array.from(new Set(tags.regions.map((r) => r.name))) : [];
  check("the snapshot is tagged (" + took + " s, the model loading included): " + names.slice(0, 12).join(", "), !!tags && names.includes("pool table") && names.includes("chair"), names);
  const status = await page.evaluate(() => document.getElementById("roomTagsStatus").textContent);
  check("the Table tab lists them", /^Tagged: .*pool table.*chair.*table: 4 rails, 6 pockets\./.test(status), status);
  const stored = await page.evaluate(() => { const t = JSON.parse(localStorage.getItem("pmc-camera-room-tags") || "null"), e = JSON.parse(localStorage.getItem("pmc-camera-empty-room") || "null"); return t && e ? { same: t.at === e.at, gw: t.gw, gh: t.gh, bytes: t.labels.length } : null; });
  check("kept with the snapshot (its own time)", stored && stored.same && stored.gw === 46, stored);

  // a "person" inside a tagged picture (painting, TV...) / bigger than it
  const pic = tags && tags.regions.filter((r) => r.kind === "picture").sort((p, q) => q.area - p.area)[0];
  if (pic) {
    // a small figure right on one of the picture's own patches
    const cw = W / tags.gw, ch = H / tags.gh, c = pic.cells[0], cx = c % tags.gw, cy = (c - cx) / tags.gw;
    const inner = { x0: (cx + 0.2) * cw, x1: (cx + 0.8) * cw, y0: (cy + 0.1) * ch, y1: (cy + 0.9) * ch };
    const bigger = { x0: pic.x0 - 40, x1: pic.x1 + 40, y0: pic.y0 - 60, y1: pic.y1 + 260 };
    const a = await page.evaluate((b) => window.PMCBallDebug.roomTagRejects(b), inner);
    const b = await page.evaluate((b) => window.PMCBallDebug.roomTagRejects(b), bigger);
    check("a \"person\" inside the tagged " + pic.name + " is set aside", a && a.kind === "picture", a);
    check("...one bigger than it (someone standing in front) isn't", !b || b.kind !== "picture", b);
  } else check("(the photo has a tagged picture to try)", false, names);

  // a "person" on a tagged chair that looks just like the empty room
  const chair = tags && tags.regions.filter((r) => r.kind === "seat").sort((p, q) => q.area - p.area)[0];
  if (chair) {
    const box = { x0: chair.x0 + 2, x1: chair.x1 - 2, y0: chair.y0 + 2, y1: chair.y1 - 2 };
    let r = null;
    for (let i = 0; i < 20 && !r; i++) { await sleep(400); r = await page.evaluate((b) => window.PMCBallDebug.roomTagRejects(b), box); }
    check("a \"person\" on the tagged " + chair.name + ", looking just like the empty room, is the " + chair.name, r && (r.kind === "seat" || r.kind === "furniture"), r);
  } else check("(the photo has a tagged seat to try)", false, names);

  const tt = await page.evaluate(() => { const t = window.PMCBallDebug.tableTags(); return t ? { rails: t.rails.length, pockets: t.pockets.length, corners: t.pockets.filter((p) => p.name === "corner pocket").length } : null; });
  check("the table: 4 rails, 6 pockets (4 corners, 2 sides)", tt && tt.rails === 4 && tt.pockets === 6 && tt.corners === 4, tt);

  await page.click("#tabCalibrate");
  await page.evaluate(() => { const t = document.getElementById("showRoomTagsToggle"); t.checked = true; t.dispatchEvent(new Event("change")); });
  await sleep(1200);
  const drawn = await page.evaluate(() => { const o = document.getElementById("overlay"), d = o.getContext("2d").getImageData(0, 0, o.width, o.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
  check("\"Show the tags on the picture\" draws them", drawn > 2000, drawn);
  if (OUT) await page.screenshot({ path: OUT + "/room_tags.png" });
  await browser.close();

  // reloaded: the tags come back from storage, no model run
  browser = await launch();
  page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "camera.html", { waitUntil: "domcontentloaded" });
  let again = null;
  for (let i = 0; i < 20 && !again; i++) { await sleep(300); again = await page.evaluate(() => window.PMCBallDebug.roomTags()); }
  const loadedModel = await page.evaluate(() => performance.getEntriesByType("resource").some((e) => /segment\.bin/.test(e.name)));
  check("after a reload the tags are back from storage, without running the model", again && again.regions.length === tags.regions.length && !loadedModel, { regions: again && again.regions.length, loadedModel });
  await page.evaluate(() => document.getElementById("emptyRoomClearBtn").click());
  await sleep(300);
  const gone = await page.evaluate(() => ({ tags: window.PMCBallDebug.roomTags(), stored: localStorage.getItem("pmc-camera-room-tags") }));
  check("forgetting the snapshot forgets its tags", !gone.tags && !gone.stored, gone);
  await browser.close();

  fs.rmSync(profile, { recursive: true, force: true });
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
