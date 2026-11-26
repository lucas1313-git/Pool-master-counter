// The recording page's 🎥 Follow the shooter (2026-11-26, the user: "always see the full table but
// to have a small pan to see the player position ... especially for the recording ... a
// professional feeling to the shots"), with a fake camera: a still picture, grey, a red patch where
// a player stands at the left (outside a 2x zoom on the middle). The camera page's "framing" fed in
// as the scoreboard passes it on (BroadcastChannel "pmc-recorder", from another tab).
// Checks: on by default; nothing from the camera page -> waits, the zoom you chose; the table in
// view -> "ready", still your zoom; a player down on a shot at the left -> the crop glides (not a
// jump) to take them in with the whole table, the red patch now in the recorded picture, the
// dashed box in the small picture; they stand up -> kept a few seconds, then glides back to your
// zoom; a moved zoom is there at once; zoom 1x -> no room; another camera -> doesn't follow, says
// so; switched off -> your zoom; the camera's shots kept with the recording (their balls into the
// pockets: where a winning shot's clip ends) - GET /api/rec/<id>/shots.
// usage: node tests/probe_record_follow.js http://localhost:4235/   (server: HOME=tests/tmphome PORT=4235 node server/server.js)
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1200) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 640, H = 360;
const RED_BOX = [0.06, 0.55, 0.14, 0.75];
function stillY4m(file) {
  const px = (x, y) => (x / W >= RED_BOX[0] && x / W <= RED_BOX[2] && y / H >= RED_BOX[1] && y / H <= RED_BOX[3] ? [220, 30, 30] : [110, 110, 110]);
  const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = px(x, y); Y[y * W + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b); }
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) {
    const [r, g, b] = px(x * 2 + 0.5, y * 2 + 0.5);
    U[y * (W / 2) + x] = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
    V[y * (W / 2) + x] = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
  }
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}
const near = (a, b, tol) => typeof a === "number" && Math.abs(a - b) <= tol;
const rectNear = (r, w, tol) => !!r && near(r.x, w.x, tol) && near(r.y, w.y, tol) && near(r.s, w.s, tol);
(async () => {
  const y4m = path.join(__dirname, "tmphome", "follow-still.y4m");
  stillY4m(y4m);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  const rec = await browser.newPage();
  rec.on("pageerror", (e) => errors.push("record: " + e.message));
  await rec.goto(BASE + "manifest.json");
  await rec.evaluate(() => localStorage.setItem("pmc-recorder-settings", JSON.stringify({ sound: false, zoom: 2, cx: 0.5, cy: 0.5 })));
  await rec.goto(BASE + "record.html", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 60; i++) { if (await rec.evaluate(() => document.getElementById("out").videoWidth > 0)) break; await sleep(250); }
  await sleep(600);
  const st = () => rec.evaluate(() => Object.assign(window.PMCRecorder.state().follow, { text: document.getElementById("followText").textContent, on: document.getElementById("followToggle").checked,
    liveShown: !document.getElementById("liveBox").hidden, tableShown: !document.getElementById("tableBox").hidden }));
  // the red patch in the recorded picture (how much of it)
  const red = () => rec.evaluate(() => {
    const v = document.getElementById("out"), c = document.createElement("canvas");
    c.width = 160; c.height = 90;
    const x = c.getContext("2d");
    x.drawImage(v, 0, 0, 160, 90);
    const d = x.getImageData(0, 0, 160, 90).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 150 && d[i + 1] < 90 && d[i + 2] < 90) n++;
    return n;
  });
  const label = await rec.evaluate(() => document.getElementById("raw").srcObject.getVideoTracks()[0].label);
  const board = await browser.newPage();
  board.on("pageerror", (e) => errors.push("sender: " + e.message));
  await board.goto(BASE + "manifest.json");
  const send = (m) => board.evaluate((m) => { window.__ch = window.__ch || new BroadcastChannel("pmc-recorder"); window.__ch.postMessage(Object.assign({ at: Date.now() }, m)); }, m);
  const TABLE = [0.3, 0.32, 0.7, 0.68], SHOOTER = [0.05, 0.5, 0.15, 0.8];
  const framing = (o) => send(Object.assign({ type: "framing", table: TABLE, shooter: null, aiming: false, camera: label, aspect: W / H }, o || {}));
  const BASE_RECT = { x: 0.25, y: 0.25, s: 0.5 };
  // the table and the shooter with room around them: x 0.02-0.75, y 0.25-0.83 -> a square of 0.73
  const WITH_SHOOTER = { x: 0.02, y: 0.175, s: 0.73 };

  let s = await st();
  check("on by default; nothing from the camera page: \"" + s.text + "\", your zoom", s.on && s.why === "noCamera" && /waiting for the camera page/.test(s.text) && rectNear(s.target, BASE_RECT, 0.001) && rectNear(s.live, BASE_RECT, 0.005), s);
  const red0 = await red();
  check("the red patch (a player at the left) isn't in the recorded picture at your 2x zoom", red0 === 0, red0);

  await framing();
  await sleep(700);
  s = await st();
  check("the table in view: \"" + s.text + "\" - still your zoom (it has the table), the table dotted in the small picture", s.why === "table" && /ready/.test(s.text) && rectNear(s.target, BASE_RECT, 0.001) && s.tableShown && !s.liveShown, s);

  // a player down on a shot at the left (the camera page says so twice a second)
  const keepSending = (o, ms) => { let stop = false; (async () => { while (!stop) { await framing(o); await sleep(500); } })(); return () => { stop = true; }; };
  let stop = keepSending({ aiming: true, shooter: SHOOTER });
  await sleep(450);
  s = await st();
  check("down on a shot: the crop asked for takes them in with the whole table", s.why === "shooter" && rectNear(s.target, WITH_SHOOTER, 0.002) && /following the shooter/.test(s.text), s);
  check("...and glides there (not a jump): part way after half a second (size " + (s.live && s.live.s.toFixed(3)) + ")", s.live && s.live.s > 0.505 && s.live.s < 0.71, s.live);
  await sleep(3200);
  s = await st();
  check("...there after a few seconds", rectNear(s.live, WITH_SHOOTER, 0.01) && s.liveShown, s.live);
  const red1 = await red();
  check("the player is in the recorded picture now (" + red1 + " red points)", red1 > 150, red1);
  stop();

  // stood up: kept a few seconds, then back to your zoom
  stop = keepSending({ aiming: false, shooter: null });
  await sleep(2500);
  s = await st();
  check("stood up: still taken in for a few seconds", s.why === "shooter" && rectNear(s.live, WITH_SHOOTER, 0.01), s);
  await sleep(6500);
  s = await st();
  check("...then back to your zoom", s.why === "table" && rectNear(s.live, BASE_RECT, 0.01) && !s.liveShown, s);
  check("...the player out of the recorded picture again", (await red()) === 0);

  // the zoom moved: there at once
  await rec.evaluate(() => { const z = document.getElementById("zoom"); z.value = 2.5; z.dispatchEvent(new Event("input")); z.dispatchEvent(new Event("change")); });
  await sleep(450);
  s = await st();
  // (2.5x: 0.4 of the picture - less than the table with its room, 0.46: that's kept)
  check("zoom moved to 2.5x: there at once - as much as the table needs (0.46)", rectNear(s.target, { x: 0.27, y: 0.27, s: 0.46 }, 0.002) && rectNear(s.live, { x: 0.27, y: 0.27, s: 0.46 }, 0.005), s);
  await rec.evaluate(() => { const z = document.getElementById("zoom"); z.value = 1; z.dispatchEvent(new Event("input")); z.dispatchEvent(new Event("change")); });
  await sleep(700);
  s = await st();
  check("zoom 1x: \"" + s.text + "\"", s.why === "noRoom" && /no room/.test(s.text), s);
  await rec.evaluate(() => { const z = document.getElementById("zoom"); z.value = 2; z.dispatchEvent(new Event("input")); z.dispatchEvent(new Event("change")); });
  stop();

  // another camera on the camera page
  stop = keepSending({ aiming: true, shooter: SHOOTER, camera: "Some Other Camera" });
  await sleep(1200);
  s = await st();
  check("the camera page on another camera: \"" + s.text + "\" - your zoom", s.why === "otherCamera" && /Some Other Camera/.test(s.text) && rectNear(s.target, BASE_RECT, 0.001), s);
  stop();

  // switched off
  stop = keepSending({ aiming: true, shooter: SHOOTER });
  await sleep(800);
  await rec.evaluate(() => { const t = document.getElementById("followToggle"); t.checked = false; t.dispatchEvent(new Event("change")); });
  await sleep(3500);
  s = await st();
  const saved = await rec.evaluate(() => JSON.parse(localStorage.getItem("pmc-recorder-settings")).follow);
  check("switched off: your zoom, kept off", s.why === "off" && s.text === "" && rectNear(s.live, BASE_RECT, 0.01) && saved === false, { s, saved });
  stop();
  await rec.evaluate(() => { const t = document.getElementById("followToggle"); t.checked = true; t.dispatchEvent(new Event("change")); });

  // the camera's shots kept with the recording
  await rec.evaluate(() => window.PMCRecorder.start());
  let id = null;
  for (let i = 0; i < 40 && !id; i++) { await sleep(250); id = await rec.evaluate(() => window.PMCRecorder.state().id); }
  const now = Date.now();
  await send({ type: "shot", id: "end:" + now, phase: "end", shot: true, moved: 22, beganAt: now - 9000, aimAt: now - 8000, endedAt: now - 1000, shooter: "Luc", pockets: [now - 3000, now - 2500] });
  await send({ type: "shot", id: "end:" + (now + 1), phase: "end", shot: false, moved: 0, beganAt: now - 500, aimAt: null, endedAt: now - 200, shooter: null, pockets: [] });
  await sleep(1200);
  const kept = id ? await (await fetch(BASE + "api/rec/" + encodeURIComponent(id) + "/shots")).json() : null;
  check("the camera's shots kept with the recording (with their balls into the pockets) - not someone leaning over", kept && kept.shots.length === 1 && kept.shots[0].shot === true && kept.shots[0].aimAt === now - 8000 && kept.shots[0].endedAt === now - 1000 && JSON.stringify(kept.shots[0].pockets) === JSON.stringify([now - 3000, now - 2500]), kept);
  const session = id ? (await (await fetch(BASE + "api/rec/sessions")).json()).sessions.find((x) => x.id === id) : null;
  check("the recording notes it followed the shooter", session && session.crop && session.crop.follow === true, session && session.crop);
  await rec.evaluate(() => window.PMCRecorder.stop());
  await sleep(1500);

  await browser.close();
  if (id) fs.rmSync(path.join(__dirname, "tmphome", "Movies", "Pool Master Counter", id), { recursive: true, force: true });
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
