// The turn order as a hint for the camera: in a points game, the scorer
// switching the selected player on the score card tells the camera that
// player is up next ("expected-shooter"); the camera leans that way when looks
// don't settle who's at the table - never against a clear recognition.
// Checks: the scoreboard sends it on a keypad switch in Straight Pool, not in
// 8-Ball, not for the camera's own pick; the relay passes it from the
// scoreboard to the camera; the camera page keeps it (for Playing players only)
// and uses it to break ties and for a shooter nobody's looks name, but not
// over a clear match of someone else.
// usage: node tests/probe_expected_shooter.js http://localhost:4236/   (HOME=tests/tmphome PORT=4236 node server/server.js)
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
  const errors = [];

  // 1. the scoreboard
  const board = await browser.newPage();
  board.on("pageerror", (e) => errors.push("board: " + e.message));
  await board.goto(BASE + "manifest.json");
  await board.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await board.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(600);
  await board.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    window.PMCVoice.handleText("Luigi plays against Luc");
    window.PMCVoice.handleText("play straight pool");
    window.__sent = [];
    window.PMCCameraBridge.onCameraCommand((m) => { if (m.type === "expected-shooter") window.__sent.push(m.player_name); });
  });
  await sleep(500);
  const key = (k) => board.evaluate((k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })), k);
  await key("1"); await sleep(200); await key("2"); await sleep(200);
  let sent = await board.evaluate(() => window.__sent.slice());
  check("Straight Pool: switching the player on the keypad tells the camera who's up next", sent.length === 2 && sent[1] !== sent[0], sent);
  await key("2"); await sleep(200);
  check("...the same player again: nothing new", (await board.evaluate(() => window.__sent.length)) === 2);
  const pickedByCamera = await board.evaluate(() => {
    const before = window.__sent.length;
    // the camera's own pick (its player_up): the other player
    const st = JSON.parse(localStorage.getItem("poolMasterCounter.state.v2"));
    const other = st.players.find((p) => p.id !== window.PMCCameraBridge.getSelectedPlayerId());
    window.PMCCameraBridge.selectPlayer(other.id, false);
    return window.__sent.length - before;
  });
  check("...the camera's own pick isn't sent back to it", pickedByCamera === 0, pickedByCamera);
  await board.evaluate(() => window.PMCVoice.handleText("play 8-ball"));
  await sleep(300);
  await key("1"); await sleep(200); await key("2"); await sleep(200);
  check("8-Ball (racks): no turn-order hint", (await board.evaluate(() => window.__sent.length)) === 2);

  // 2. the relay: scoreboard (listener) -> camera
  const relayed = await board.evaluate((base) => new Promise((resolve) => {
    const url = base.replace(/^http/, "ws") + "ws-camera";
    const cam = new WebSocket(url), lis = new WebSocket(url);
    let got = null;
    cam.onopen = () => cam.send(JSON.stringify({ type: "hello", role: "camera" }));
    cam.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === "expected-shooter") got = m; };
    lis.onopen = () => { lis.send(JSON.stringify({ type: "hello", role: "listener" })); setTimeout(() => lis.send(JSON.stringify({ type: "expected-shooter", player_name: "Luigi", ts: 123 })), 400); };
    setTimeout(() => { cam.close(); lis.close(); resolve(got); }, 1500);
  }), BASE);
  check("the relay passes it from the scoreboard to the camera", relayed && relayed.player_name === "Luigi" && relayed.ts === 123, relayed);

  // 3. the camera page
  const cam = await browser.newPage();
  cam.on("pageerror", (e) => errors.push("camera: " + e.message));
  await cam.goto(BASE + "camera.html?embedded=1", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const msg = (m) => cam.evaluate((m) => window.postMessage(m, location.origin), m);
  await msg({ type: "roster", names: ["Luigi", "Luc", "Kim"], playing: ["Luigi", "Luc"], known: ["Luigi", "Luc", "Kim"] });
  await msg({ type: "expected-shooter", player_name: "Kim" });
  await sleep(200);
  check("camera: a player not Playing isn't expected", (await cam.evaluate(() => window.PMCCueDebug.expectedShooter())) === null);
  await msg({ type: "expected-shooter", player_name: "Luigi" });
  await sleep(200);
  check("camera: Luigi expected next", (await cam.evaluate(() => window.PMCCueDebug.expectedShooter())) === "Luigi");
  const r = await cam.evaluate(() => {
    const d = window.PMCCueDebug;
    return {
      tieRunnerUp: d.expectedTieBreak({ name: "Luc", runnerUp: "Luigi", distance: 0.8, threshold: 1.2, clear: false }),
      clearOther: d.expectedTieBreak({ name: "Luc", runnerUp: "Luigi", distance: 0.8, threshold: 1.2, clear: true }),
      tooFar: d.expectedTieBreak({ name: "Luigi", distance: 1.5, threshold: 1.2, clear: true }),
      noLooks: d.expectedFallback(null),
      unsure: d.expectedFallback({ name: "Luc", distance: 0.9, threshold: 1.2, clear: false }),
      clearLuc: d.expectedFallback({ name: "Luc", distance: 0.5, threshold: 1.2, clear: true })
    };
  });
  check("camera: looks that don't settle it, Luigi next closest: Luigi", r.tieRunnerUp === "Luigi", r);
  check("camera: a clear match of Luc stays Luc", r.clearOther === null && r.clearLuc === null, r);
  check("camera: a shooter nobody's looks name (or unsure): Luigi", r.noLooks === "Luigi" && r.unsure === "Luigi", r);
  check("camera: too far from anyone's looks to break a tie: no", r.tooFar === null, r);
  const logged = await cam.evaluate(() => document.getElementById("recognizeLog").textContent);
  check("camera: logged \"Expected next: Luigi\"", /Expected next: Luigi/.test(logged), logged.slice(0, 200));

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
