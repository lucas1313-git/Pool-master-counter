// ⏸ Pause the recording, not stop it (2026-10-30 request: "a pause recording button that would just
// pause not stop, so i can unpause and keep going on the same session ... and review"). Its own
// server (4305, a throwaway HOME), the scoreboard and the recording page in two tabs (a fake camera):
// - recording 10 s, ⏸ Pause: "▶ Resume" on the button, "⏸" on the badge, Mark and Auto cue off;
//   the file so far ended (the computer told: paused), the whole recording "⏸ paused · 0:1x so far";
// - paused, reviewed: the last seconds before the pause play from a finished file (no copy needed);
// - paused: M - "⏸ Paused - ▶ Resume first", no cue; "mark" said on the scoreboard: "The recording
//   is paused - ▶ Resume on the recording page"; a new game on the scoreboard: no game mark;
// - ▶ Resume (the P key) 6 s later: the same recording goes on - a new file, the pause kept
//   ({ from, to }), "● recording" again; the timeline shows the pause as a gap, and a click in the
//   gap plays from where it went on;
// - ⏸ again and ■ Stop while paused: the recording ends at the pause, not at the stop;
// - a new recording started: one left paused an hour ago (the page closed) is closed where it
//   paused; one written a moment ago (another page recording) isn't;
// - no page errors.
// usage: node tests/probe_record_pause.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 4305, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 640, H = 360;
function makeY4m(file) {
  const Y = Buffer.alloc(W * H, 120), U = Buffer.alloc(W * H / 4, 90), V = Buffer.alloc(W * H / 4, 160);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-record-pause-"));
  const HOME = path.join(TMP, "home"), ROOT = path.join(HOME, "Movies", "Pool Master Counter");
  fs.mkdirSync(ROOT, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], { env: Object.assign({}, process.env, { HOME, PORT: String(PORT) }), stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + "manifest.json")).ok) break; } catch (e) {} await sleep(250); }
  const y4m = path.join(TMP, "cam.y4m");
  makeY4m(y4m);
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1200, height: 1000 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"]
  });
  const errors = [];
  const api = async (p) => (await fetch(BASE + p)).json();
  const session = async (id) => ((await api("api/rec/sessions")).sessions || []).find((s) => s.id === id);
  const cues = async () => (await api("api/rec/cues")).cues || [];
  try {
    // the scoreboard: Kim v Jo, 8-Ball
    const board = await browser.newPage();
    board.on("pageerror", (e) => errors.push("board: " + e.message));
    await board.goto(BASE + "manifest.json");
    await board.evaluate(() => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "a", name: "Kim", playing: true, balls: 0 }, { id: "b", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    });
    await board.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(800);

    const rec = await browser.newPage();
    rec.on("pageerror", (e) => errors.push("record: " + e.message));
    await rec.goto(BASE + "manifest.json");
    await rec.evaluate(() => localStorage.setItem("poolMasterCounter.recordingConsent.v1", "probe"));
    await rec.goto(BASE + "record.html", { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 40; i++) { if (await rec.evaluate(() => document.getElementById("out").videoWidth > 0)) break; await sleep(250); }
    await sleep(600);
    await rec.click("#recordBtn");
    await sleep(10000);
    const id = (await api("api/rec/sessions")).sessions.find((s) => !s.endedAt).id;
    const ui = () => rec.evaluate(() => ({
      pause: document.getElementById("pauseBtn").textContent, badge: document.getElementById("recBadge").textContent, recText: document.getElementById("recText").textContent,
      markOff: document.getElementById("markBtn").disabled, autoOff: document.getElementById("autoBtn").disabled,
      what: document.querySelector(".cv-whole-what").textContent, gaps: document.querySelectorAll(".cv-wline .gap").length,
      wall: window.PMCRecorder.viewer.wallTime(), src: document.querySelector(".cv-video").getAttribute("src") || "", status: document.querySelector(".cv-status").textContent
    }));

    // ⏸ Pause
    const pausedAt = Date.now();
    await rec.click("#pauseBtn");
    await sleep(2500);
    await rec.evaluate(() => window.PMCRecorder.viewer.refresh());
    await sleep(800);
    let s1 = await session(id), u1 = await ui();
    if (OUT) await rec.screenshot({ path: path.join(OUT, "record_paused.png") });
    check("⏸ Pause: \"" + u1.pause + "\", badge \"" + u1.badge + "\", Mark and Auto cue off; the file so far ended, the computer told (" + (s1.pausedAt ? "paused" : "-") + "); \"" + u1.what + "\"", u1.pause === "▶ Resume" && /^⏸ 00:00:1\d$/.test(u1.badge) && u1.markOff && u1.autoOff && s1.pausedAt && Math.abs(s1.pausedAt - pausedAt) < 1500 && s1.parts.length === 1 && s1.parts[0].endedAt && /⏸ paused · 0:1\d so far/.test(u1.what) && /Paused/.test(u1.recText), { u1, s1 });

    // reviewed while paused: the last seconds before the pause
    await rec.evaluate(() => document.querySelector(".cv-wline").scrollIntoView({ block: "center" }));
    const lb = await rec.evaluate(() => { const r = document.querySelector(".cv-wline").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await rec.mouse.click(lb.x + lb.w * 0.85, lb.y + lb.h / 2);
    await sleep(1500);
    const u2 = await ui();
    const target = s1.startedAt + 0.85 * (s1.pausedAt - s1.startedAt);
    check("paused, reviewed: the last seconds before the pause play (" + ((u2.wall - target) / 1000).toFixed(1) + " s from the click) - from the finished file", u2.wall && u2.wall - target > -1500 && u2.wall - target < 3000 && !/\?live=/.test(u2.src) && /part-001\.mp4$/.test(u2.src), { u2, target });

    // paused: M, "mark" on the scoreboard, a new game
    const before = (await cues()).length;
    await rec.evaluate(() => document.body.focus());
    await rec.keyboard.press("m");
    await sleep(500);
    const toast = await rec.evaluate(() => document.getElementById("toast").textContent);
    await board.bringToFront();
    await sleep(1500);
    const said = await board.evaluate(() => { const r = window.PMCVoice.handleText("mark"); return r && r.result && r.result.text; });
    await board.evaluate(() => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for Kim")).click());
    await sleep(1500);
    await board.keyboard.press("Enter").catch(() => {});
    await sleep(800);
    const after = await cues();
    check("paused: M - \"" + toast + "\", no cue; \"mark\" said on the scoreboard - \"" + said + "\"; a new game - no game mark (" + (after.length - before) + " new)", /⏸ Paused - ▶ Resume first/.test(toast) && said === "The recording is paused - ▶ Resume on the recording page" && after.length === before, { toast, said, after });

    // ▶ Resume (P), 6 s after the pause
    await rec.bringToFront();
    await sleep(Math.max(0, 6000 - (Date.now() - pausedAt)));
    const resumedAt = Date.now();
    await rec.evaluate(() => document.body.focus());
    await rec.keyboard.press("p");
    await sleep(7000);
    await rec.evaluate(() => window.PMCRecorder.viewer.refresh());
    await sleep(800);
    const s2 = await session(id), u3 = await ui();
    const pause = (s2.pauses || [])[0] || {};
    check("▶ Resume (P): the same recording goes on - file 2 from " + ((s2.parts[1] ? s2.parts[1].startedAt - resumedAt : NaN) / 1000).toFixed(1) + " s, the pause kept (" + ((pause.to - pause.from) / 1000).toFixed(1) + " s), \"" + u3.pause + "\", \"" + u3.what + "\", the gap on the line", s2.parts.length === 2 && Math.abs(s2.parts[1].startedAt - resumedAt) < 1500 && !s2.pausedAt && pause.from && pause.to && Math.abs(pause.to - resumedAt) < 1500 && u3.pause === "⏸ Pause" && /● recording/.test(u3.what) && u3.gaps === 1 && /^● /.test(u3.badge), { s2, u3 });
    if (OUT) await rec.screenshot({ path: path.join(OUT, "record_resumed.png") });
    // a click in the gap: from where it went on
    const span = await rec.evaluate(() => { const l = document.querySelector(".cv-wline"); return { s: +l.getAttribute("data-s"), e: +l.getAttribute("data-e") }; });
    const lb2 = await rec.evaluate(() => { const r = document.querySelector(".cv-wline").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const inGap = (pause.from + pause.to) / 2;
    await rec.mouse.click(lb2.x + lb2.w * (inGap - span.s) / (span.e - span.s), lb2.y + lb2.h / 2);
    await sleep(1500);
    const u4 = await ui();
    check("...a click in the pause: plays from where it went on (" + ((u4.wall - s2.parts[1].startedAt) / 1000).toFixed(1) + " s into file 2)", u4.wall && u4.wall - s2.parts[1].startedAt >= -200 && u4.wall - s2.parts[1].startedAt < 3000 && /part-002\.mp4/.test(u4.src), { u4, part2: s2.parts[1] });

    // ⏸ again, ■ Stop while paused: ends at the pause
    await rec.click("#pauseBtn");
    const paused2 = Date.now();
    await sleep(4000);
    await rec.click("#recordBtn");
    await sleep(2500);
    const s3 = await session(id);
    check("⏸ again, ■ Stop while paused 4 s later: the recording ends at the pause (" + ((s3.endedAt - paused2) / 1000).toFixed(1) + " s off), not at the stop", s3.endedAt && Math.abs(s3.endedAt - paused2) < 1500 && !s3.pausedAt, s3);

    // a new recording: the one left paused an hour ago is closed; one written a moment ago isn't
    const mk = (name, s) => { fs.mkdirSync(path.join(ROOT, name)); fs.writeFileSync(path.join(ROOT, name, "part-001.mp4"), "x"); fs.writeFileSync(path.join(ROOT, name, "session.json"), JSON.stringify(Object.assign({ id: name, mime: "video/mp4", ext: "mp4" }, s))); };
    const h = Date.now() - 2 * 3600000;
    mk("2000-01-01 10h00", { startedAt: h, endedAt: null, pausedAt: h + 1800000, parts: [{ n: 1, file: "part-001.mp4", startedAt: h, endedAt: h + 1800000 }] });
    mk("2000-01-01 11h00", { startedAt: Date.now() - 60000, endedAt: null, parts: [{ n: 1, file: "part-001.mp4", startedAt: Date.now() - 60000, endedAt: null }] });
    await rec.click("#recordBtn");
    await sleep(3000);
    await rec.click("#recordBtn");
    await sleep(2000);
    const left = await session("2000-01-01 10h00"), busy = await session("2000-01-01 11h00");
    check("a new recording: one left paused an hour ago closed where it paused (" + (left && left.endedAt === h + 1800000) + "); one written a moment ago left alone (" + (busy && !busy.endedAt) + ")", left && left.endedAt === h + 1800000 && !left.pausedAt && busy && !busy.endedAt, { left, busy });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
