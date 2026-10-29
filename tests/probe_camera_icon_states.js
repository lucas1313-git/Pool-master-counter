// The score cards' camera icons: the scoreboard with two players and the same-device camera
// (camera.html in its iframe, fake video, a synthetic calibrated camera), driven through each
// state - recognized (green), suspected (yellow: a walking path carrying the name), located (blue:
// out of view, the camera has an idea where), none (light grey) - and the icon's size: twice the
// old 30px, without moving the player's name down. No fading with time (2026-10-16, per the user):
// while recognition is on for a player, the icon keeps the best colour reached; benched, it starts
// over; the camera stopping greys everything after 10 s.
// usage: node tests/probe_camera_icon_states.js http://localhost:4237/ [screenshot dir]
// against a test server (`HOME=tests/tmphome PORT=4237 node server/server.js`).
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
const SHOTS = process.argv[3];
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " - " + detail : ""));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The app opens on the board (Focus Mode, where the icon grows with the card); the sizes below
// are the normal layout's, so 🔍 Show All once it's up.
const showAll = async (pg) => {
  await pg.waitForFunction(() => document.getElementById("app") && document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
  await pg.evaluate(() => document.getElementById("btn-toggle-focus").click());
};

// a synthetic camera (as in probe_room_map.js): table inches, z up from the felt
const FELT = 30;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
function camSpec(W, H) { return { C: [-50, -70, 66], target: [55, 30, -8], f: W / 2 / Math.tan(40 * Math.PI / 180), W, H }; }
function project(spec, P) {
  const z = norm(sub(spec.target, spec.C)), x = norm(cross(z, [0, 0, 1])), y = cross(z, x), d = sub(P, spec.C), Z = dot(d, z);
  return { u: spec.W / 2 + spec.f * dot(d, x) / Z, v: spec.H / 2 + spec.f * dot(d, y) / Z };
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
function calibration(spec) {
  const T = [[0, 0], [100, 0], [100, 50], [0, 50]], A = [], b = [];
  T.forEach(([rX, rY]) => {
    const q = project(spec, [rX, rY, 0]);
    A.push([q.u, q.v, 1, 0, 0, 0, -q.u * rX, -q.v * rX]); b.push(rX);
    A.push([0, 0, 0, q.u, q.v, 1, -q.u * rY, -q.v * rY]); b.push(rY);
  });
  const h = solve(A, b);
  return { tableLength: 100, tableWidth: 50, xExtent: 100, yExtent: 50, h: { h11: h[0], h12: h[1], h13: h[2], h21: h[3], h22: h[4], h23: h[5], h31: h[6], h32: h[7] } };
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(500);
  // two players in the game, the camera on this device
  await page.evaluate(() => {
    const key = "poolMasterCounter.state.v2", st = JSON.parse(localStorage.getItem(key));
    st.players = [{ id: "pa", name: "Alice", voice: 0, playing: true, teamId: null, balls: 0 }, { id: "pb", name: "Bob", voice: 1, playing: true, teamId: null, balls: 0 }];
    st.cameraInputEnabled = true; st.cameraWizardCompleted = true; st.sameDeviceCameraSetUp = true;
    localStorage.setItem(key, JSON.stringify(st));
    localStorage.setItem("pmc-camera-wizard-done", "1");
    const d = () => Array.from({ length: 208 }, (_, i) => (i === 3 ? 1 : 0));
    localStorage.setItem("pmc-camera-local-enrollments", JSON.stringify({ alice: { displayName: "Alice", descriptors: [d(), d(), d()], info: [null, null, null] }, bob: { displayName: "Bob", descriptors: [d(), d(), d()], info: [null, null, null] } }));
  });
  await page.reload({ waitUntil: "networkidle2" }); await showAll(page);
  await page.waitForFunction(() => document.querySelectorAll(".scorecard-camera-badge").length === 2, { timeout: 30000, polling: 200 });
  // the camera's iframe: started, its video's size known
  await page.waitForFunction(() => { const f = document.getElementById("same-device-camera-iframe"); try { return f && f.contentWindow.PMCCueDebug && f.contentDocument.getElementById("video").videoWidth > 0; } catch (e) { return false; } }, { timeout: 90000, polling: 250 });
  const frame = await (await page.$("#same-device-camera-iframe")).contentFrame();
  const { W, H } = await frame.evaluate(() => ({ W: document.getElementById("video").videoWidth, H: document.getElementById("video").videoHeight }));
  const spec = camSpec(W, H);
  await frame.evaluate((cal) => localStorage.setItem("pmc-camera-calibration", JSON.stringify(cal)), calibration(spec));
  await frame.evaluate(() => location.reload());
  await page.waitForFunction(() => { const f = document.getElementById("same-device-camera-iframe"); try { return f.contentWindow.PMCRoomMapDebug && f.contentWindow.PMCRoomMapDebug.cameraModel(); } catch (e) { return false; } }, { timeout: 90000, polling: 250 });
  const cam = await (await page.$("#same-device-camera-iframe")).contentFrame();
  // synthetic people, projected through the synthetic camera
  await cam.evaluate((spec, felt) => {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const z = norm(sub(spec.target, spec.C)), x = norm(cross(z, [0, 0, 1])), y = cross(z, x);
    const project = (P) => { const d = sub(P, spec.C), Z = dot(d, z); return { u: spec.W / 2 + spec.f * dot(d, x) / Z, v: spec.H / 2 + spec.f * dot(d, y) / Z }; };
    const BODY = { nose: [0, 64], left_eye: [-1.5, 66], right_eye: [1.5, 66], left_ear: [-3, 65], right_ear: [3, 65], left_shoulder: [-8, 56], right_shoulder: [8, 56], left_elbow: [-9, 44], right_elbow: [9, 44], left_wrist: [-9, 32], right_wrist: [9, 32], left_hip: [-6, 36], right_hip: [6, 36], left_knee: [-6, 19], right_knee: [6, 19], left_ankle: [-6, 3], right_ankle: [6, 3] };
    window.__people = []; window.__poses = []; window.__ticks = 0;
    window.PMCCueDebug.posesOverride = function () {
      window.__ticks++;
      window.__poses = [];
      window.__people.forEach((p, who) => {
        p.x += p.vx || 0; p.y += p.vy || 0;
        if (p.hidden) return;
        const side = norm([-(spec.C[1] - p.y), spec.C[0] - p.x, 0]);
        const kps = Object.keys(BODY).map((n) => { const [o, h] = BODY[n], q = project([p.x + side[0] * o, p.y + side[1] * o, h - felt]); return { name: n, x: q.u, y: q.v, score: 0.9 }; });
        window.__poses.push({ score: 0.9, keypoints: kps, who });
      });
      return window.__poses;
    };
  }, spec, FELT);
  await cam.waitForFunction(() => window.__ticks > 2, { timeout: 60000, polling: 100 });
  const looks = async (n) => { const t = await cam.evaluate(() => window.__ticks); await cam.waitForFunction((k) => window.__ticks >= k, { timeout: 60000, polling: 20 }, t + n); };
  // (the app may give players ids of its own: find each card's by name)
  const ids = await page.evaluate(() => Array.from(document.querySelectorAll(".scorecard-camera-badge")).map((b) => ({ id: b.dataset.playerId, name: b.closest(".player-panel").querySelector(".player-name").textContent.trim() })));
  console.log("cards:", JSON.stringify(ids));
  const idOf = { pa: (ids.find((c) => /Alice/.test(c.name)) || {}).id, pb: (ids.find((c) => /Bob/.test(c.name)) || {}).id };
  const badge = (id) => page.evaluate((pid) => {
    const b = document.querySelector('.scorecard-camera-badge[data-player-id="' + pid + '"]');
    return (b.className.match(/cam-[a-z]+/) || [""])[0];
  }, idOf[id]);
  const colour = (id) => page.evaluate((pid) => getComputedStyle(document.querySelector('.scorecard-camera-badge[data-player-id="' + pid + '"]')).color, idOf[id]);
  const shot = async (name) => { if (!SHOTS) return; const el = await page.$(".scoreboard") || await page.$("#app"); await el.screenshot({ path: SHOTS + "/" + name }); };

  check("nobody seen: both icons light grey", (await badge("pa")) === "cam-none" && (await badge("pb")) === "cam-none", (await badge("pa")) + " " + (await colour("pa")));
  // size: 60px, and the name where it was (the card's top padding unchanged)
  const geo = await page.evaluate((pid) => {
    const b = document.querySelector('.scorecard-camera-badge[data-player-id="' + pid + '"]'), icon = b.querySelector(".scorecard-camera-badge-icon").getBoundingClientRect();
    const panel = b.closest(".player-panel"), name = panel.querySelector(".player-name").getBoundingClientRect(), pr = panel.getBoundingClientRect();
    return { w: icon.width, h: icon.height, padTop: getComputedStyle(panel).paddingTop, nameTop: name.top - pr.top, iconBottom: icon.bottom - pr.top, iconTop: icon.top - pr.top };
  }, idOf.pa);
  check("the icon is twice the size (60px), the card's top padding still 52px", geo.w === 60 && geo.h === 60 && geo.padTop === "52px", JSON.stringify(geo));
  await shot("icons-none.png");

  // Alice walks in, her walking path named: someone in view taken for her - yellow
  await cam.evaluate(() => { window.__people = [{ x: 30, y: -45, vx: 0, vy: 0 }]; });
  await looks(4);
  await cam.evaluate(() => { const p = window.PMCCueDebug.getWalkingPaths().find((q) => q.id === window.__poses[0].id); p.name = "Alice"; });
  await looks(3);
  await sleep(300);
  check("followed along her walking path: Alice yellow", (await badge("pa")) === "cam-suspected" && (await colour("pa")) === "rgb(255, 214, 10)", (await badge("pa")) + " " + (await colour("pa")));
  await shot("icons-suspected.png");

  // a sure look at Bob (appearance): green
  await cam.evaluate(() => window.PMCCameraDebug.notePlayerSighting("Bob", true));
  await looks(2);
  await sleep(300);
  check("recognized by how he looks: Bob green", (await badge("pb")) === "cam-recognized" && (await colour("pb")) === "rgb(46, 204, 113)", (await badge("pb")) + " " + (await colour("pb")));
  await shot("icons-recognized.png");
  const flashing = await page.evaluate((pid) => getComputedStyle(document.querySelector('.scorecard-camera-badge[data-player-id="' + pid + '"] .scorecard-camera-badge-icon')).animationName, idOf.pb);
  check("no flashing", flashing === "none", flashing);

  // Alice walks out of the picture: out of view, the camera knows roughly where - blue
  await cam.evaluate(() => { window.__people[0].hidden = true; });
  await sleep(1800);
  await looks(2);
  await sleep(300);
  check("out of view, her walking path lost a moment ago: Alice stays yellow (no fading)", (await badge("pa")) === "cam-suspected" && (await colour("pa")) === "rgb(255, 214, 10)", await badge("pa"));
  const mapSaysWhere = await cam.evaluate(() => { const p = window.PMCRoomMapDebug.players().alice; return p && p.last ? [Math.round(p.last.x), Math.round(p.last.y)] : null; });
  check("...and the room map has a spot for her", !!mapSaysWhere, JSON.stringify(mapSaysWhere));
  await shot("icons-located.png");

  // Bob's sure look runs out, and nothing else knows anything about him: grey again
  await sleep(1000);
  await looks(2);
  await sleep(300);
  check("Bob's look runs out, nothing else on him: still green (no fading)", (await badge("pb")) === "cam-recognized", await badge("pb"));
  // after Alice's walking path is long gone (12 s), the room map still has her: still blue
  await sleep(12500);
  await looks(2);
  await sleep(300);
  check("her walking path forgotten, 12 s later: Alice still yellow", (await badge("pa")) === "cam-suspected", await badge("pa"));

  // a re-render of the score cards keeps the colours (no white blink until the next message)
  await page.evaluate(() => { document.querySelector(".keypad-select-trigger").click(); });
  await sleep(100);
  check("after the score cards are drawn again: Alice still yellow", (await badge("pa")) === "cam-suspected", await badge("pa"));

  // Bob benched: recognition is off for him - his colour starts over (grey when he's back, until seen)
  const toggleBob = () => page.evaluate(() => { const row = [...document.querySelectorAll("#roster-list li.roster-row")].find((r) => /Bob/.test(r.textContent)); row.querySelector(".btn-playing").click(); });
  await toggleBob();
  await looks(3);
  await sleep(400);
  const camHasBob = await cam.evaluate(() => Object.keys(window.PMCCameraDebug.playerStates()).some((n) => /bob/i.test(n)));
  check("Bob benched: the camera drops his colour", !camHasBob, String(camHasBob));
  await toggleBob();
  await looks(3);
  await sleep(400);
  check("...back in the game: grey until seen again", (await badge("pb")) === "cam-none", await badge("pb"));

  // the camera page goes away: after 10 s nothing is known
  await page.evaluate(() => { document.getElementById("same-device-camera-iframe").src = "about:blank"; });
  await sleep(10600);
  check("the camera stops talking: grey after 10 s", (await badge("pa")) === "cam-none" && (await badge("pb")) === "cam-none", (await badge("pa")) + " " + (await badge("pb")));
  check("no page errors", !errors.length, errors.join(" | "));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + (results.length - failed) + "/" + results.length + " passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
