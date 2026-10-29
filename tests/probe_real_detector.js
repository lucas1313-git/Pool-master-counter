// The real pose model on real pictures (P25): camera.html in same-device mode (?embedded=1 - the
// iPad / one-device path) with a fake camera playing a photo or a short clip, the model's own
// output watched (PMCCueDebug.posesOverride hands it back untouched):
// - the same model as the phone path: MultiPose, so more than one person can be found;
// - a picture with two or more people in it: at least two poses in one look, each with its own
//   track id (the old single-pose model found one, with no id at all);
// - the ids carry from one look to the next (a still photo: the same people, the same ids);
// - every pose gets a walking-path id (w1, w2...) and the model's own id is kept as rawId;
// - with a clip: how many people per look, how many ids, and how often a person kept their id
//   from one look to the next (printed; checked: someone kept theirs on most looks);
// - no page errors.
// The photo for the two-people check: any photo with two or more people standing in it. It was
// made with "Aniversário de Daiane Muniz em 2016.2.jpg" from Wikimedia Commons (public domain,
// https://commons.wikimedia.org/wiki/File:Anivers%C3%A1rio_de_Daiane_Muniz_em_2016.2.jpg) - four
// people round a pool table. A clip (.mp4/.mov/.webm, needs ffmpeg) is the first 12 s, at 15 fps.
// Only use footage of people who agreed to it.
// usage: node tests/probe_real_detector.js http://localhost:4235/ <photo or clip> [screenshot dir]
// against a test server (`HOME=tests/tmphome PORT=4235 node server/server.js`).
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE, MEDIA, OUT] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1280, H = 720;

// a photo -> a one-frame 1280x720 YUV4MPEG2 file (decoded by the browser, letterboxed)
async function photoToY4m(browser, photo, file) {
  const page = await browser.newPage();
  const b64 = fs.readFileSync(photo).toString("base64");
  const type = /\.png$/i.test(photo) ? "image/png" : "image/jpeg";
  const rgb = await page.evaluate(async (src, W, H) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const s = Math.min(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * s, h = img.naturalHeight * s;
    c.getContext("2d").drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    return Array.from(c.getContext("2d").getImageData(0, 0, W, H).data);
  }, "data:" + type + ";base64," + b64, W, H);
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
  if (!BASE || !MEDIA) { console.error("usage: node tests/probe_real_detector.js <base url> <photo or clip> [screenshot dir]"); process.exit(2); }
  const isClip = /\.(mp4|mov|m4v|webm|mkv|avi)$/i.test(MEDIA);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-real-detector-")), y4m = path.join(dir, "feed.y4m");
  if (isClip) {
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", MEDIA, "-t", "12", "-vf", "scale=" + W + ":" + H + ":force_original_aspect_ratio=decrease,pad=" + W + ":" + H + ":(ow-iw)/2:(oh-ih)/2,fps=15", "-pix_fmt", "yuv420p", y4m]);
  } else {
    const conv = await puppeteer.launch({ executablePath: EXE, headless: "new" });
    await photoToY4m(conv, MEDIA, y4m);
    await conv.close();
  }
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"]
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("pmc-camera-wizard-done", "1");
      localStorage.setItem("pmc-camera-settings", JSON.stringify({ debugOverlay: true })); // (the skeletons drawn, for the screenshot)
    });
    await page.goto(BASE + "camera.html?embedded=1", { waitUntil: "networkidle2" });
    // every look: the model's poses as it gave them; the ids they ended up with are read a look
    // later (the walking paths give each pose its id after this hook)
    await page.evaluate(() => {
      window.__looks = [];
      let last = null;
      window.PMCCueDebug.posesOverride = function (poses) {
        if (last) window.__looks.push(last.map((p) => ({ id: p.id, rawId: p.rawId, score: p.score, box: p.box ? { x: p.box.xMin, y: p.box.yMin, w: p.box.width, h: p.box.height } : null })));
        last = poses || [];
        return poses;
      };
    });
    await page.waitForFunction(() => window.__looks.length >= 3, { timeout: 180000, polling: 200 });
    const lookCount = isClip ? 120 : 12;
    await page.waitForFunction((n) => window.__looks.length >= n, { timeout: 240000, polling: 200 }, lookCount);
    const looks = await page.evaluate(() => window.__looks.slice(1));
    if (OUT) await page.screenshot({ path: path.join(OUT, "real_detector.png") });

    const counts = looks.map((l) => l.length);
    const most = Math.max(...counts);
    const many = looks.find((l) => l.length >= 2) || [];
    const rawIds = many.map((p) => p.rawId), ids = many.map((p) => p.id);
    console.log("people per look: " + counts.join(" "));
    if (!isClip) {
      check("same-device mode, a photo of several people: " + most + " found in one look (two or more - the single-pose model found one)", most >= 2, counts);
      check("...each with its own track id from the model (" + rawIds.join(", ") + ")", rawIds.length >= 2 && rawIds.every((i) => i !== undefined && i !== null) && new Set(rawIds).size === rawIds.length, many);
      check("...and its own walking-path id (" + ids.join(", ") + ")", ids.length >= 2 && ids.every((i) => /^w\d+$/.test(String(i))) && new Set(ids).size === ids.length, many);
      // the same people, the same ids: compare the ids of the people found in every look
      const sets = looks.filter((l) => l.length === most).map((l) => l.map((p) => p.id).sort().join());
      check("...the same ids look after look (" + sets.length + " looks with all " + most + ")", sets.length >= 3 && new Set(sets).size === 1, sets);
    } else {
      // a person kept their id from one look to the next: an id seen in a look is seen again in the next
      let kept = 0, pairs = 0;
      for (let i = 1; i < looks.length; i++) {
        const prev = new Set(looks[i - 1].map((p) => p.id));
        looks[i].forEach((p) => { if (prev.size) { pairs++; if (prev.has(p.id)) kept++; } });
      }
      const allIds = new Set(looks.flatMap((l) => l.map((p) => p.id)));
      console.log("clip: " + looks.length + " looks, up to " + most + " people at once, " + allIds.size + " ids in all, an id kept from one look to the next " + kept + " of " + pairs + " times");
      check("the clip: someone found (" + looks.filter((l) => l.length).length + " of " + looks.length + " looks)", looks.some((l) => l.length > 0), counts);
      check("...two people at once get two ids", most < 2 || (new Set(many.map((p) => p.id)).size === many.length && many.length >= 2), many);
      check("...a person keeps their id from one look to the next on most looks (" + kept + " of " + pairs + ")", pairs === 0 || kept / pairs >= 0.8, { kept, pairs });
    }
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
