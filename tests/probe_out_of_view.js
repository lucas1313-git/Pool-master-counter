// Out of view: a named player who walks out of the camera's picture keeps
// their tag - an arrow and their name at the edge they left by - and gets
// their name back when they come in again at that edge, even minutes later
// (here 14 s, past the 12 s a hidden player is looked for). Someone hidden in
// the middle of the picture for as long doesn't; two named players gone the
// same way leave the next one in nameless. On the room map, the tag stays at
// a spot just out of the camera's sight, the way they were going, in a circle
// that stops growing at 5 ft. Synthetic people through camera.html's real
// detection loop (PMCCueDebug.posesOverride), as tests/probe_walking_paths.js.
// usage: node tests/probe_out_of_view.js http://localhost:4236/   (HOME=tests/tmphome PORT=4236 node server/server.js)
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE + "camera.html?embedded=1", { waitUntil: "networkidle2" });
  await page.evaluate(() => {
    const NAMES = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
      "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];
    function build(p) {
      const j = () => (Math.random() - 0.5) * 3, sx = p.x, sy = p.y - 60;
      const at = {
        nose: [sx, sy - 22], left_eye: [sx - 5, sy - 26], right_eye: [sx + 5, sy - 26], left_ear: [sx - 10, sy - 22], right_ear: [sx + 10, sy - 22],
        left_shoulder: [sx - 18, sy], right_shoulder: [sx + 18, sy], left_elbow: [sx - 22, sy + 28], right_elbow: [sx + 22, sy + 28],
        left_wrist: [sx - 22, sy + 52], right_wrist: [sx + 22, sy + 52], left_hip: [p.x - 12, p.y], right_hip: [p.x + 12, p.y],
        left_knee: [p.x - 12, p.y + 45], right_knee: [p.x + 12, p.y + 45], left_ankle: [p.x - 12, p.y + 90], right_ankle: [p.x + 12, p.y + 90]
      };
      return { score: 0.9, keypoints: NAMES.map((n) => ({ name: n, x: at[n][0] + j(), y: at[n][1] + j(), score: 0.9 })) };
    }
    window.__ticks = 0; window.__people = []; window.__poses = [];
    window.PMCCueDebug.posesOverride = function () {
      window.__ticks++;
      window.__poses = [];
      window.__people.forEach((p, who) => {
        p.x += p.vx || 0;
        if (p.hidden) return;
        const pose = build(p); pose.who = who; window.__poses.push(pose);
      });
      return window.__poses;
    };
  });
  await page.waitForFunction(() => window.__ticks > 2, { timeout: 120000, polling: 100 });
  const W = await page.evaluate(() => document.getElementById("video").videoWidth);
  const looks = async (n) => { const t = await page.evaluate(() => window.__ticks); await page.waitForFunction((m) => window.__ticks >= m, { timeout: 60000, polling: 20 }, t + n); };
  const set = (people) => page.evaluate((p) => { window.__people = p; }, people);
  const patch = (who, props) => page.evaluate((w, p) => Object.assign(window.__people[w], p), who, props);
  const ids = () => page.evaluate(() => window.__people.map((p, who) => { const pose = window.__poses.find((q) => q.who === who); return pose ? pose.id : undefined; }));
  const paths = () => page.evaluate(() => window.PMCCueDebug.getWalkingPaths().map((p) => ({ id: p.id, name: p.name, exited: p.exited ? p.exited.side : null })));
  const setName = (id, name) => page.evaluate((i, n) => { window.PMCCueDebug.getWalkingPaths().find((q) => q.id === i).name = n; }, id, name);
  const reset = async () => { await set([]); await looks(2); await page.evaluate(() => { window.PMCCueDebug.getWalkingPaths().length = 0; }); };

  // A: walks out of the right edge, comes back in there 14 s later
  await reset();
  await set([{ x: W - 140, y: 300, vx: 12 }]);
  await looks(4);
  let [id0] = await ids();
  await setName(id0, "Luigi");
  await looks(6);                                   // walks on to the edge...
  await patch(0, { hidden: true, vx: 0 });          // ...and out
  await looks(4);
  let p = (await paths()).find((q) => q.id === id0);
  check("A: walked out at the right edge - marked as gone that way", p && p.exited === "right", p);
  const tagDrawn = await page.evaluate(() => {
    const o = document.getElementById("overlay"), d = o.getContext("2d").getImageData(Math.round(o.width * 0.7), 0, Math.round(o.width * 0.3), o.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n;
  });
  check("A: a tag at the right edge of the picture (name, time, arrow)", tagDrawn > 300, tagDrawn);
  await sleep(14000);
  p = (await paths()).find((q) => q.id === id0);
  check("A: still kept after 14 s (a hidden player would be dropped at 12)", p && p.name === "Luigi", p);
  await set([{ x: W - 30, y: 310, vx: -10 }]);
  await looks(3);
  let [idBack] = await ids();
  check("A: coming back in at that edge, they get their path and name back", idBack === id0, { id0, idBack });

  // B: hidden in the middle of the picture for 14 s - not kept, comes back nameless
  await reset();
  await set([{ x: Math.round(W / 2), y: 300 }]);
  await looks(4);
  [id0] = await ids();
  await setName(id0, "Luc");
  await patch(0, { hidden: true });
  await sleep(14000);
  await patch(0, { hidden: false });
  await looks(3);
  [idBack] = await ids();
  check("B: hidden mid-picture for 14 s: a new, nameless path (no guessing)", idBack !== id0 && !(await paths()).find((q) => q.id === idBack).name, { id0, idBack });

  // C: two named players walk out the same way - the next one in gets neither
  await reset();
  await set([{ x: W - 150, y: 260, vx: 14 }, { x: W - 150, y: 360, vx: 14 }]);
  await looks(4);
  const [a, b] = await ids();
  await setName(a, "Luigi"); await setName(b, "Bob");
  await looks(6);
  await patch(0, { hidden: true, vx: 0 }); await patch(1, { hidden: true, vx: 0 });
  await sleep(14000);
  await set([{ x: W - 30, y: 300, vx: -10 }]);
  await looks(3);
  [idBack] = await ids();
  const pc = (await paths()).find((q) => q.id === idBack);
  check("C: two gone the same way: the one coming in gets neither name", idBack !== a && idBack !== b && pc && !pc.name, { a, b, idBack, pc });

  // D: the room map's tag spot
  const z = await page.evaluate(() => {
    const fov = [{ x: -100, y: -100 }, { x: 200, y: -100 }, { x: 200, y: 150 }, { x: -100, y: 150 }];
    const now = Date.now();
    const going = window.PMCRoomMapDebug.mapZone({ x: 150, y: 20, at: now - 60000, v: { x: 40, y: 0 } }, now, false, fov);
    const still = window.PMCRoomMapDebug.mapZone({ x: 150, y: 20, at: now - 3000, v: { x: 0, y: 0 } }, now, false, fov);
    return { going, goingOut: !window.PMCRoomMapDebug.pointInPolygon(going, fov), still, stillOut: !window.PMCRoomMapDebug.pointInPolygon(still, fov) };
  });
  check("D: on the room map the tag sits just out of the camera's sight, the way they went", z.goingOut && z.going.x > 200 && z.going.x < 240 && Math.abs(z.going.y - 20) < 1, z.going);
  check("D: ...its circle stops growing at 5 ft", z.going.r === 60, z.going.r);
  check("D: standing still when lost: pushed out of sight away from the table", z.stillOut, z.still);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
