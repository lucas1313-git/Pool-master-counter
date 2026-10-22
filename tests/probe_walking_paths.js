// Walking paths: synthetic people walked through camera.html's real detection loop (the pose
// model's output replaced via PMCCueDebug.posesOverride), checking that a player who drops out of
// view and turns up again along their walking path keeps their track id and name - and that
// nobody else picks them up.
// usage: node tests/probe_walking_paths.js http://localhost:4236/ [--calibrated]
// against a test server (`HOME=tests/tmphome PORT=4236 node server/server.js`).
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
const CALIBRATED = process.argv.includes("--calibrated");
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " - " + detail : ""));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
  });
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (m) => { const t = m.text(); if (/\[PMC (paths|shooting)\]/.test(t)) logs.push(t); });
  await page.goto(BASE + "manifest.json");
  await page.evaluate((calibrated) => {
    localStorage.clear();
    // 0.25 inch per pixel, the table's corner at pixel (80, 160)
    if (calibrated) localStorage.setItem("pmc-camera-calibration", JSON.stringify({ tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: { h11: 0.25, h12: 0, h13: -20, h21: 0, h22: 0.25, h23: -40, h31: 0, h32: 0 } }));
  }, CALIBRATED);
  await page.goto(BASE + "camera.html?embedded=1", { waitUntil: "networkidle2" });

  // Synthetic people: { x, y } = hip centre in video pixels (60px torso), vx/vy = pixels walked
  // per look, hidden = walking on behind something (moves, but the camera doesn't see them).
  await page.evaluate(() => {
    const NAMES = ["nose", "left_eye", "right_eye", "left_ear", "right_ear", "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
      "left_wrist", "right_wrist", "left_hip", "right_hip", "left_knee", "right_knee", "left_ankle", "right_ankle"];
    function build(p) {
      const j = () => (Math.random() - 0.5) * 3, T = 60, a = p.bent ? 50 * Math.PI / 180 : 0;
      const sx = p.x + Math.sin(a) * T, sy = p.y - Math.cos(a) * T;
      const at = {
        nose: [sx + (p.bent ? 14 : 0), sy - 22], left_eye: [sx - 5, sy - 26], right_eye: [sx + 5, sy - 26], left_ear: [sx - 10, sy - 22], right_ear: [sx + 10, sy - 22],
        left_shoulder: [sx - 18, sy], right_shoulder: [sx + 18, sy], left_elbow: [sx - 22, sy + 28], right_elbow: [sx + 22, sy + 28],
        left_wrist: [sx - 22, sy + 52], right_wrist: [sx + 22, sy + 52], left_hip: [p.x - 12, p.y], right_hip: [p.x + 12, p.y],
        left_knee: [p.x - 12, p.y + 45], right_knee: [p.x + 12, p.y + 45], left_ankle: [p.x - 12, p.y + 90], right_ankle: [p.x + 12, p.y + 90]
      };
      // hipsHidden: the table hides everything from the hips down - the model's guesses there are
      // faint and wrong
      const low = (n) => p.hipsHidden && /hip|knee|ankle/.test(n);
      return { score: 0.9, keypoints: NAMES.map((n) => ({ name: n, x: at[n][0] + j() + (low(n) ? 40 : 0), y: at[n][1] + j() + (low(n) ? 70 : 0), score: low(n) ? 0.1 : 0.9 })) };
    }
    window.__ticks = 0; window.__people = []; window.__poses = []; window.__ups = [];
    window.addEventListener("message", (e) => { if (e.data && e.data.type === "player_up") window.__ups.push(e.data); });
    window.PMCCueDebug.posesOverride = function () {
      window.__ticks++;
      window.__poses = [];
      window.__people.forEach((p, who) => {
        p.x += p.vx || 0; p.y += p.vy || 0;
        if (p.hidden) return;
        const pose = build(p);
        pose.who = who;
        window.__poses.push(pose);
      });
      return window.__poses;
    };
  });
  // Models load and the (fake) camera starts on their own.
  await page.waitForFunction(() => window.__ticks > 2, { timeout: 120000, polling: 100 });

  async function looks(n) {
    const t = await page.evaluate(() => window.__ticks);
    await page.waitForFunction((m) => window.__ticks >= m, { timeout: 60000, polling: 20 }, t + n);
  }
  const set = (people) => page.evaluate((p) => { window.__people = p; }, people);
  const patch = (who, props) => page.evaluate((w, p) => Object.assign(window.__people[w], p), who, props);
  // Track id of each person in view, by person (undefined = not in view).
  const ids = () => page.evaluate(() => window.__people.map((p, who) => { const pose = window.__poses.find((q) => q.who === who); return pose ? pose.id : undefined; }));
  const nameOf = (id) => page.evaluate((i) => { const p = window.PMCCueDebug.getWalkingPaths().find((q) => q.id === i); return p ? p.name : null; }, id);
  const setName = (id, name) => page.evaluate((i, n) => { window.PMCCueDebug.getWalkingPaths().find((q) => q.id === i).name = n; }, id, name);
  async function reset() {
    await set([]);
    await looks(2);
    await page.evaluate(() => { window.PMCCueDebug.getWalkingPaths().length = 0; window.__ups = []; });
  }
  const msPerLook = await page.evaluate(async () => { const n0 = window.__ticks; await new Promise((r) => setTimeout(r, 3000)); return 3000 / Math.max(1, window.__ticks - n0); });
  // A walk of about 45 inches a second, in this mode's pixels.
  const ipp = CALIBRATED ? 0.25 : 20 / 60;
  const walk = Math.round(45 / ipp * msPerLook / 1000);
  console.log("mode " + (CALIBRATED ? "calibrated (inches)" : "uncalibrated (pixels)") + ", one look every " + Math.round(msPerLook) + "ms, walking " + walk + "px a look");

  // A: walks left to right, behind something for ~2s, comes out further along.
  await reset();
  await set([{ x: 60, y: 280, vx: walk }]);
  await looks(4);
  let [id0] = await ids();
  await setName(id0, "Alex");
  await patch(0, { hidden: true });
  await looks(Math.round(2000 / msPerLook));
  await patch(0, { hidden: false });
  await looks(2);
  let [idA] = await ids();
  check("A: walker back in view further along keeps the track id", idA === id0, id0 + " -> " + idA);
  check("A: and the name", (await nameOf(idA)) === "Alex");

  // B: the same walk, but someone turns up back where they came from - not them.
  await reset();
  await set([{ x: 260, y: 280, vx: walk }]);
  await looks(4);
  [id0] = await ids();
  await setName(id0, "Alex");
  await set([{ x: 40, y: 280, hidden: true }]);
  await looks(4);
  await patch(0, { hidden: false });
  await looks(2);
  const [idB] = await ids();
  check("B: someone behind them, off their path, is someone new", idB !== id0, id0 + " -> " + idB);
  check("B: and doesn't get the name", (await nameOf(idB)) === null);

  // C: standing still, out of view for ~3s, back on the same spot.
  await reset();
  await set([{ x: 320, y: 280 }]);
  await looks(4);
  [id0] = await ids();
  await setName(id0, "Sam");
  await patch(0, { hidden: true });
  await looks(Math.round(3000 / msPerLook));
  await patch(0, { hidden: false, x: 326, y: 284 });
  await looks(2);
  const [idC] = await ids();
  check("C: player standing still, back where they vanished, keeps id + name", idC === id0 && (await nameOf(idC)) === "Sam", id0 + " -> " + idC);

  // D: two named players standing close together both vanish; one body turns up between them.
  await reset();
  await set([{ x: 280, y: 280 }, { x: 340, y: 280 }]);
  await looks(4);
  const two = await ids();
  await setName(two[0], "Alex"); await setName(two[1], "Sam");
  await set([{ x: 310, y: 280, hidden: true }]);
  await looks(4);
  await patch(0, { hidden: false });
  await looks(2);
  const [idD] = await ids();
  check("D: a body either of two lost players could be gets neither", idD !== two[0] && idD !== two[1] && (await nameOf(idD)) === null, JSON.stringify(two) + " -> " + idD);

  // E: two people walk past each other about 20 inches apart; ids stay with each.
  await reset();
  const apart = Math.round(20 / ipp);
  await set([{ x: 100, y: 260, vx: walk }, { x: 560, y: 260 + apart, vx: -walk }]);
  await looks(2);
  const ab = await ids();
  await page.waitForFunction(() => window.__people[0].x > 520, { timeout: 60000, polling: 20 });
  const ba = await ids();
  check("E: walkers passing each other keep their own ids", ab[0] === ba[0] && ab[1] === ba[1], JSON.stringify(ab) + " -> " + JSON.stringify(ba));

  // E2: the same, but the one nearer the camera hides the other as they pass.
  await reset();
  await set([{ x: 100, y: 260, vx: walk }, { x: 560, y: 260 + apart, vx: -walk }]);
  await looks(2);
  const cd = await ids();
  await page.waitForFunction(() => window.__people[0].x > window.__people[1].x - 70, { timeout: 60000, polling: 20 });
  await patch(0, { hidden: true });
  await page.waitForFunction(() => window.__people[0].x > window.__people[1].x + 70, { timeout: 60000, polling: 20 });
  await patch(0, { hidden: false });
  await looks(2);
  const dc = await ids();
  check("E2: a walker hidden while passing behind another comes out with their own id", cd[0] === dc[0] && cd[1] === dc[1], JSON.stringify(cd) + " -> " + JSON.stringify(dc));

  // H: walking along behind the table - hips out of sight for a while - stays one path.
  await reset();
  await set([{ x: 60, y: 280, vx: Math.round(walk / 2) }]);
  await looks(4);
  const h0 = (await ids())[0], hIds = [];
  await patch(0, { hipsHidden: true });
  for (let i = 0; i < 6; i++) { await looks(1); hIds.push((await ids())[0]); }
  await patch(0, { hipsHidden: false });
  await looks(3);
  hIds.push((await ids())[0]);
  const hPaths = await page.evaluate(() => window.PMCCueDebug.getWalkingPaths().length);
  check("H: hips hidden behind the table while walking: same id all along", hIds.every((i) => i === h0) && hPaths === 1, h0 + " -> " + JSON.stringify(hIds) + ", paths " + hPaths);

  // F: gone longer than paths are kept (12s): a new person.
  await reset();
  await set([{ x: 320, y: 280 }]);
  await looks(4);
  [id0] = await ids();
  await setName(id0, "Sam");
  await patch(0, { hidden: true });
  await new Promise((r) => setTimeout(r, 13000));
  await patch(0, { hidden: false });
  await looks(2);
  const [idF] = await ids();
  check("F: back after 13s is a fresh path (no name)", idF !== id0 && (await nameOf(idF)) === null, id0 + " -> " + idF);

  // G: end to end - a named player vanishes, and comes back on their path bent over a shot: the
  // shot is theirs (nobody is enrolled, so nothing else could name them).
  if (!CALIBRATED) {
    await reset();
    await set([{ x: 80, y: 280, vx: walk }]);
    await looks(4);
    [id0] = await ids();
    await setName(id0, "Alex");
    await patch(0, { hidden: true });
    await looks(4);
    await patch(0, { hidden: false, vx: 0, bent: true });
    await looks(8);
    const [idG] = await ids();
    const ups = await page.evaluate(() => window.__ups);
    check("G: back in view on their path and bent over a shot: credited to them", idG === id0 && ups.some((u) => u.player_name === "Alex"),
      "ups=" + JSON.stringify(ups.map((u) => u.player_name + " " + u.certainty)) + " " + (logs.filter((s) => /SHOOTING DETECTED/.test(s)).pop() || ""));
    // ...and a stranger bent over somewhere else gets nothing.
    await reset();
    await set([{ x: 520, y: 280, bent: true }]);
    await looks(8);
    const ups2 = await page.evaluate(() => window.__ups);
    check("G: a stranger bent over elsewhere isn't credited to anyone", ups2.length === 0, JSON.stringify(ups2));
  }

  console.log("\n" + results.filter((r) => r.ok).length + "/" + results.length + " passed");
  console.log(logs.filter((s) => /paths\]/.test(s)).slice(-6).join("\n"));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
