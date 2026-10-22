// A new day: players' samples from an earlier day keep counting for everything but the shirt.
// Seeds camera.html's same-device sample store with yesterday's samples (synthetic colour counts:
// shirt, trousers, sleeves, cap) and checks who today's frames are taken for - a player in a new
// shirt (even another player's old shirt colour) is still themselves; a stranger in a player's old
// shirt is nobody; the appearance models and the "plenty pressed" count only use today's samples;
// a day runs 5 a.m. to 5 a.m.
// usage: node tests/probe_new_day_shirts.js http://localhost:4237/
// against a test server (`HOME=tests/tmphome PORT=4237 node server/server.js`).
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " - " + detail : ""));
}

// Colour bins: hue bin * 4 + saturation bin (12 hues x 4).
const RED = 2, KHAKI = 6, GREEN = 18, BLUE = 30, BROWN = 3, BLOND = 7, BLACKISH = 42, GREY = 46;
const DAY = 24 * 3600 * 1000;

// The page's own descriptor layout (analyzePose): torso, legs, sleeves, cap histograms (48 each),
// aspect, legs/sleeves/cap seen, then each region's dark/mid/light split.
function descriptor(look, seen) {
  seen = Object.assign({ legs: true, sleeves: true, cap: true }, seen || {});
  const region = (bin, on) => {
    const h = new Array(48).fill(0);
    if (!on) return h;
    const main = 0.72 + Math.random() * 0.1;
    h[bin] = main;
    h[bin + 1] = 1 - main;
    return h;
  };
  const tone = (on) => (on ? [0.2, 0.6, 0.2] : [0, 0, 0]);
  return region(look.shirt, true).concat(region(look.legs, seen.legs), region(look.shirt, seen.sleeves), region(look.cap, seen.cap),
    [look.aspect + (Math.random() - 0.5) * 0.02, seen.legs ? 1 : 0, seen.sleeves ? 1 : 0, seen.cap ? 1 : 0],
    tone(true), tone(seen.legs), tone(seen.sleeves), tone(seen.cap)).map((v) => Math.round(v * 10000) / 10000);
}
// OSNet's numbers as a sample keeps them (512 bytes, base64) - random, just to be there.
function fakeEmb(n) {
  let bin = "";
  for (let i = 0; i < n; i++) bin += String.fromCharCode(Math.floor(Math.random() * 256));
  return Buffer.from(bin, "binary").toString("base64");
}
function samples(name, look, at, n, opts) {
  opts = opts || {};
  const entry = { displayName: name, descriptors: [], info: [] };
  for (let i = 0; i < n; i++) {
    entry.descriptors.push(descriptor(look));
    const info = { kind: i % 2 ? "shooting" : "identify", at: at + i * 7000, bend: i % 2 ? 50 : 5, torso: 10, leg: 3, pos: null, pose: i % 2 ? "bent" : "upright" };
    if (opts.emb) { info.emb = fakeEmb(512); info.embDino = fakeEmb(384); }
    entry.info.push(info);
  }
  return entry;
}
function merge(a, b) {
  return { displayName: a.displayName, descriptors: a.descriptors.concat(b.descriptors), info: a.info.concat(b.info) };
}

const ALICE_THEN = { shirt: RED, legs: BLUE, cap: BROWN, aspect: 0.5 };
const BOB_THEN = { shirt: BLUE, legs: KHAKI, cap: BLOND, aspect: 0.42 };
const ALICE_NOW = Object.assign({}, ALICE_THEN, { shirt: GREEN });
const BOB_NOW = Object.assign({}, BOB_THEN, { shirt: RED }); // Alice's shirt colour yesterday
const STRANGER = { shirt: RED, legs: BLACKISH, cap: GREY, aspect: 0.47 };

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
  });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => { const t = m.text(); if (/\[PMC new day\]/.test(t)) logs.push(t); });
  page.on("pageerror", (e) => logs.push("PAGE ERROR " + e.message));
  const now = Date.now();
  const yesterday = now - 3 * DAY;

  async function open(store) {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((s) => {
      localStorage.clear();
      localStorage.setItem("pmc-camera-local-enrollments", JSON.stringify(s));
    }, store);
    await page.goto(BASE + "camera.html?embedded=1", { waitUntil: "networkidle2" });
    await page.waitForFunction(() => window.PMCCameraDebug && Object.keys(window.PMCCameraDebug.getEnrollments()).length > 0, { timeout: 60000, polling: 100 });
  }
  const match = (d, pose) => page.evaluate((q, p) => {
    const m = window.PMCCameraDebug.findBestMatch(q, p || null);
    return m && { name: m.name, distance: m.distance, threshold: m.threshold, clear: m.clear, runnerUp: m.runnerUp };
  }, d, pose);
  const confident = (m) => !!m && m.distance <= m.threshold && m.clear;
  const show = (m) => (m ? m.name + " " + m.distance.toFixed(2) + (m.clear ? "" : " (unclear)") + " vs " + m.runnerUp : "nobody");

  // ---- 1: only yesterday's samples ----
  await open({ alice: samples("Alice", ALICE_THEN, yesterday, 30, { emb: true }), bob: samples("Bob", BOB_THEN, yesterday + 3600000, 12, { emb: true }) });

  const days = await page.evaluate(() => {
    const D = window.PMCCameraDebug.playDayOf;
    const t = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
    return { lateNight: D(t(15, 23, 0)), small: D(t(16, 4, 30)), morning: D(t(16, 5, 30)), none: D(undefined) };
  });
  check("a night past midnight is one day; a new day starts at 5 a.m.", days.lateNight === days.small && days.morning !== days.small && days.none === null, JSON.stringify(days));

  let m = await match(descriptor(BOB_NOW), "upright");
  check("Bob in a new shirt (Alice's colour yesterday) is Bob", confident(m) && m.name === "Bob", show(m));
  const old = await page.evaluate((frame) => {
    const e = window.PMCCameraDebug.getEnrollments(), H = window.PMCCameraDebug.histogramDistance;
    return { aliceSameDay: H(frame, e.alice.descriptors[0], false), bobSameDay: H(frame, e.bob.descriptors[0], false), aliceOtherDay: H(frame, e.alice.descriptors[0], true), bobOtherDay: H(frame, e.bob.descriptors[0], true) };
  }, descriptor(BOB_NOW));
  check("(compared shirts and all, Bob would be no closer to his own samples than to Alice's)", old.bobSameDay > 1.2 && old.aliceSameDay > 1.2 && old.bobOtherDay < 1.2 && old.aliceOtherDay > 1.2,
    Object.keys(old).map((k) => k + " " + old[k].toFixed(2)).join(", "));

  m = await match(descriptor(ALICE_NOW), "upright");
  check("Alice in a new shirt is Alice", confident(m) && m.name === "Alice", show(m));
  m = await match(descriptor(STRANGER), "upright");
  check("a stranger in Alice's shirt from yesterday is nobody", !confident(m), show(m));
  m = await match(descriptor(ALICE_NOW, { legs: false, sleeves: true, cap: false }), "bent");
  check("only a shirt in view, nothing from today to compare it with: nobody", !confident(m), show(m));
  m = await match(descriptor(ALICE_NOW, { legs: false }), "bent");
  check("bent over, trousers behind the table: Alice by the rest", confident(m) && m.name === "Alice", show(m));

  // Models: ready, but nobody has a sample of today - recognition stays on colours
  await page.waitForFunction(() => { const a = window.PMCCameraDebug.appearance(); return a.models.osnet.state !== "loading" && a.models.dino.state !== "loading" && (a.models.osnet.state === "ready" || a.models.dino.state === "ready"); }, { timeout: 180000, polling: 250 });
  let ap = await page.evaluate(() => window.PMCCameraDebug.appearance());
  check("appearance models leave yesterday's samples out", ap.combo.length === 0 && ap.method === "colour" && Object.keys(ap.combos).length === 0, "combo [" + ap.combo + "], method " + ap.method + ", checks " + JSON.stringify(ap.combos));
  const plenty = await page.evaluate(() => window.PMCCameraDebug.hasPlentyPressedSamples("Alice"));
  check("30 presses yesterday aren't \"plenty\" today (the camera keeps adding its own)", plenty === false);
  const list = await page.evaluate(() => document.getElementById("playerList").textContent);
  check("the Enroll tab says today's shirt isn't seen yet", /none today - today's shirt not seen yet/.test(list), list.replace(/\s+/g, " ").slice(0, 160));

  // ---- 2: plenty of presses yesterday, a few samples today ----
  const alice = merge(samples("Alice", ALICE_THEN, yesterday, 30, { emb: true }), samples("Alice", ALICE_NOW, now - 20 * 60000, 4, { emb: true }));
  const bob = merge(samples("Bob", BOB_THEN, yesterday + 3600000, 12, { emb: true }), samples("Bob", BOB_NOW, now - 15 * 60000, 4, { emb: true }));
  await open({ alice: alice, bob: bob });
  const plenty2 = await page.evaluate(() => window.PMCCameraDebug.hasPlentyPressedSamples("Alice"));
  check("...nor with 4 more today", plenty2 === false);

  m = await match(descriptor(ALICE_NOW, { legs: false, cap: false }), "bent");
  check("with today's samples, today's shirt counts: Alice by her shirt alone", confident(m) && m.name === "Alice", show(m));
  m = await match(descriptor(STRANGER), "upright");
  check("the stranger in Alice's old shirt is still nobody", !confident(m), show(m));
  m = await match(descriptor(BOB_NOW), "upright");
  check("Bob is Bob", confident(m) && m.name === "Bob", show(m));

  await page.waitForFunction(() => { const a = window.PMCCameraDebug.appearance(); return a.models.osnet.state !== "loading" && a.models.dino.state !== "loading" && a.combo.length > 0 && Object.keys(a.combos).length > 0; }, { timeout: 180000, polling: 250 });
  ap = await page.evaluate(() => window.PMCCameraDebug.appearance());
  const tested = Object.keys(ap.combos).map((k) => ap.combos[k].tested);
  check("models: everyone has a sample of today, their self-check tests today's samples only", ap.combo.length > 0 && tested.every((t) => t <= 8), "combo [" + ap.combo + "], tested " + tested.join("/"));
  const rows = await page.evaluate(() => document.getElementById("playerList").textContent.replace(/\s+/g, " "));
  check("the Enroll tab counts today's samples", /34 samples, 17 shooting, 4 today/.test(rows) && /16 samples, 8 shooting, 4 today/.test(rows), rows.slice(0, 200));
  const selfCheck = await page.evaluate(() => { const c = window.PMCCameraDebug.getEnrollCheck(); return Object.keys(c).map((k) => k + " " + c[k].right + "/" + c[k].tested).join(", "); });
  check("self-check runs across days", /alice \d+\/\d+/.test(selfCheck) && /bob \d+\/\d+/.test(selfCheck), selfCheck);

  // ---- 3: the clock passes 5 a.m. (all in one go - the page checks the real clock every 30 s) ----
  const next = await page.evaluate((frame) => {
    const D = window.PMCCameraDebug, d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(6, 0, 0, 0);
    const rolled = D.checkNewDay(d.getTime()), ap = D.appearance(), m = D.findBestMatch(frame, "upright");
    const out = { rolled: rolled, combo: ap.combo, method: ap.method, list: document.getElementById("playerList").textContent.replace(/\s+/g, " "),
      m: m && { name: m.name, distance: m.distance, threshold: m.threshold, clear: m.clear, runnerUp: m.runnerUp } };
    D.checkNewDay(Date.now());
    return out;
  }, descriptor(Object.assign({}, ALICE_NOW, { shirt: KHAKI })));
  check("at 5 a.m. today's samples become yesterday's: models wait, list says none today", next.rolled === true && next.combo.length === 0 && next.method === "colour" && /none today/.test(next.list), "combo [" + next.combo + "]");
  check("the next day, Alice in yet another shirt is still Alice", confident(next.m) && next.m.name === "Alice", show(next.m));
  check("the new day is logged", logs.some((l) => /a new day - shirts are learned afresh/.test(l)), logs.join(" | "));

  check("no page errors", !logs.some((l) => /PAGE ERROR/.test(l)), logs.filter((l) => /PAGE ERROR/.test(l)).join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + (results.length - failed) + "/" + results.length + " passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
