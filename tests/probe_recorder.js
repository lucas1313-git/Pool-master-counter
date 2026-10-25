// The recording page and its cues, end to end: a fake camera (a still test
// picture: four coloured quarters, a yellow square in the middle) and a fake
// microphone; the scoreboard and the recording page in two tabs of one
// browser (they talk over a BroadcastChannel), the server keeping the video
// in <test HOME>/Movies/Pool Master Counter.
// Checks: the recording's own zoom (a crop - the yellow square bigger);
// the parts sent to the computer and a new file every few seconds (here);
// "mark" / "finish" said on the scoreboard make a cue named
// [player]-[game]-[game N of raceto M]-[duration]-[date]-[time]-cued from the
// scoreboard, starting 20 s back (or at the recording's start); the cues page
// lists it and plays it from the recording; a clip cut with ffmpeg about as
// long as the cue; "mark" with nothing recording says so.
// usage: node tests/probe_recorder.js http://localhost:4235/   (server: HOME=tests/tmphome PORT=4235 node server/server.js)
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const [BASE] = process.argv.slice(2);
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1280, H = 720;
const ROOT = path.join(__dirname, "tmphome", "Movies", "Pool Master Counter");
function ffprobeDuration(file) {
  try { return parseFloat(execFileSync(fs.existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString()); } catch (e) { return NaN; }
}
function makeY4m(file) {
  const yuv = { red: [76, 85, 255], green: [150, 44, 21], blue: [29, 255, 107], white: [235, 128, 128], yellow: [210, 16, 146] };
  const at = (x, y) => (Math.abs(x - W / 2) < 40 && Math.abs(y - H / 2) < 40 ? "yellow" : y < H / 2 ? (x < W / 2 ? "red" : "green") : x < W / 2 ? "blue" : "white");
  const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4), V = Buffer.alloc(W * H / 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Y[y * W + x] = yuv[at(x, y)][0];
  for (let y = 0; y < H / 2; y++) for (let x = 0; x < W / 2; x++) { const c = yuv[at(x * 2, y * 2)]; U[y * W / 2 + x] = c[1]; V[y * W / 2 + x] = c[2]; }
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}

(async () => {
  fs.rmSync(ROOT, { recursive: true, force: true });
  const y4m = path.join(__dirname, "tmphome", "rec-test.y4m");
  makeY4m(y4m);
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1200, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"]
  });
  const errors = [];
  const board = await browser.newPage();
  board.on("pageerror", (e) => errors.push("board: " + e.message));
  await board.goto(BASE + "manifest.json");
  await board.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await board.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  // a game: Luigi against Luc, 8-ball, race to 5, Luigi 2 - Luc 1, Luigi selected
  const say = (t) => board.evaluate((t) => window.PMCVoice.handleText(t), t);
  await board.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  for (const t of ["Luigi plays against Luc", "play 8-ball", "race to 5", "Luigi wins the game", "nice game", "Luc wins the game", "nice game", "Luigi wins the game", "nice game"]) { await say(t); await sleep(400); }
  await board.keyboard.press("Digit1").catch(() => {});
  await board.evaluate(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true })); });
  await sleep(500);

  // "mark" before anything records
  const early = await board.evaluate(() => window.PMCVoice.handleText("mark"));
  check("\"mark\" with no recording page: says so", early && early.result && early.result.ok === false && /recording page isn't open/.test(early.result.text), early && early.result);

  const rec = await browser.newPage();
  rec.on("pageerror", (e) => errors.push("record: " + e.message));
  await rec.goto(BASE + "manifest.json");
  await rec.evaluate(() => localStorage.setItem("pmc-recorder-settings", JSON.stringify({ sound: false }))); // (no fake microphone here)
  await rec.goto(BASE + "record.html", { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 40; i++) { if (await rec.evaluate(() => document.getElementById("out").videoWidth > 0)) break; await sleep(250); }
  await sleep(800);
  const st0 = await rec.evaluate(() => window.PMCRecorder.state());
  check("the recording page opens the camera on its own, with a crop in a worker", st0.cropSupported && (await rec.evaluate(() => document.getElementById("camText").textContent)).indexOf("Camera: ") === 0, st0);

  const colourAt = (x, y) => rec.evaluate((x, y) => {
    const v = document.getElementById("out"), c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    const ctx = c.getContext("2d"); ctx.drawImage(v, 0, 0);
    const [r, g, b] = ctx.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data;
    return r > 170 && g > 150 && b < 110 ? "yellow" : r > 150 && g < 110 && b < 110 ? "red" : "?" + [r, g, b];
  }, x, y);
  const plain = await colourAt(0.5 + 50 / W, 0.5);
  await rec.evaluate(() => { const z = document.getElementById("zoom"); z.value = "2"; z.dispatchEvent(new Event("input")); z.dispatchEvent(new Event("change")); });
  await sleep(700);
  const zoomed = await colourAt(0.5 + 50 / W, 0.5);
  check("the recording's own zoom: 2x crop (the yellow square now reaches 50 px right of centre)", plain !== "yellow" && zoomed === "yellow", { plain, zoomed });

  // record, with a new file every 5 s
  await rec.evaluate(() => window.PMCRecorder.setPartMs(5000));
  await rec.click("#recordBtn");
  await sleep(3000);
  const boardSeen = await rec.evaluate(() => document.getElementById("boardText").textContent);
  check("the recording page hears the scoreboard: Luigi · 8-Ball · game 4 of raceto 5", /Luigi · 8-Ball · game 4 of raceto 5/.test(boardSeen), boardSeen);

  // mark / finish said on the scoreboard (the recording tab in the background) - right
  // after the scorer switched to the next player: the cue is still Luigi's, as at its start
  await board.bringToFront();
  await board.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));
  await sleep(900);
  const switched = await rec.evaluate(() => window.PMCRecorder.state().board);
  check("the scorer switched to Luc just before the mark (the recorder heard it)", switched && switched.player === "Luc", switched);
  const m = await board.evaluate(() => window.PMCVoice.handleText("mark"));
  check("\"mark\" said on the scoreboard: Marked", m.result && m.result.ok && /Marked/.test(m.result.text), m.result);
  await sleep(6500);
  const f = await board.evaluate(() => window.PMCVoice.handleText("finish"));
  check("\"finish\": the cue is kept", f.result && f.result.ok, f.result);
  await sleep(1500);
  const cues = await (await fetch(BASE + "api/rec/cues")).json();
  const cue = cues.cues[0];
  const recStart = (await rec.evaluate(() => window.PMCRecorder.state())).id;
  check("the cue's name: Luigi-8-Ball-game 4 of raceto 5-<duration>-<date>-<time>-cued", cue && /^Luigi-8-Ball-game 4 of raceto 5-\d+s-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}m\d{2}-cued$/.test(cue.name), cue && cue.name);
  const d0 = cue && new Date(cue.startedAt), p2 = (n) => String(n).padStart(2, "0");
  const startStamp = d0 ? d0.getFullYear() + "-" + p2(d0.getMonth() + 1) + "-" + p2(d0.getDate()) + "-" + p2(d0.getHours()) + "h" + p2(d0.getMinutes()) + "m" + p2(d0.getSeconds()) : "";
  check("...named for Luigi and the score as they stood at the cue's start, with its start time (not the mark's)", cue && cue.name.indexOf("Luigi-") === 0 && cue.name.indexOf(startStamp + "-cued") !== -1, { name: cue && cue.name, startStamp });
  check("...starting 20 s back - or at the recording's start, here 3 s back", cue && cue.markedAt - cue.startedAt >= 2500 && cue.markedAt - cue.startedAt <= 4500 && cue.endedAt - cue.markedAt >= 6000, cue);

  // the files: several parts, the finished ones indexed
  await sleep(3000);
  await rec.bringToFront();
  await rec.click("#recordBtn");
  await sleep(4000);
  const sessions = await (await fetch(BASE + "api/rec/sessions")).json();
  const s = sessions.sessions[0];
  const parts = s ? s.parts : [];
  check("recorded in parts (a new file every 5 s here), all ended", parts.length >= 3 && parts.every((p) => p.endedAt && p.bytes > 1000), parts.map((p) => ({ n: p.n, bytes: p.bytes, ended: !!p.endedAt })));
  const d1 = ffprobeDuration(path.join(ROOT, s.id, parts[0].file));
  check("a part is a real video of about 5 s", d1 > 3.5 && d1 < 7, d1);
  check("the recording stopped", !!s.endedAt);

  // the cues page
  const cp = await browser.newPage();
  cp.on("pageerror", (e) => errors.push("cues: " + e.message));
  await cp.goto(BASE + "cues.html", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const row = await cp.evaluate(() => document.querySelector("#cueRows tr td.name") && document.querySelector("#cueRows tr td.name").textContent);
  check("the cues page lists it", row && row.indexOf("Luigi-8-Ball-game 4 of raceto 5-") === 0, row);
  await cp.evaluate(() => document.querySelector('#cueRows button[data-act="play"]').click());
  let wall = null;
  for (let i = 0; i < 80; i++) { await sleep(250); wall = await cp.evaluate(() => { const v = document.getElementById("player"); return v.currentTime > 0.2 ? window.PMCCues.wallTime() : null; }); if (wall) break; }
  check("▶ plays it from the recording, from the cue's start", wall && wall >= cue.startedAt - 1500 && wall <= cue.endedAt, { wall, start: cue.startedAt, end: cue.endedAt });
  const timeline = await cp.evaluate(() => document.querySelectorAll(".session .timeline .cue").length);
  check("the recording's timeline shows the cue", timeline >= 1, timeline);

  // a clip
  const clip = await (await fetch(BASE + "api/rec/cues/" + cue.id + "/clip", { method: "POST" })).json();
  const clipFile = path.join(ROOT, "Clips", clip.file || "-");
  const cd = ffprobeDuration(clipFile);
  check("✂ a clip of the cue (" + (clip.file || clip.error) + "), about as long", fs.existsSync(clipFile) && Math.abs(cd - (cue.endedAt - cue.startedAt) / 1000) < 3, { cd, want: (cue.endedAt - cue.startedAt) / 1000, clip });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
