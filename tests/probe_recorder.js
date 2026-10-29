// The recording page and its cues, end to end: a fake camera (a still test
// picture: four coloured quarters, a yellow square in the middle) and a fake
// microphone; the scoreboard and the recording page in two tabs of one
// browser (they talk over a BroadcastChannel), the server keeping the video
// in <test HOME>/Movies/Pool Master Counter.
// Checks: the recording's own zoom (a crop - the yellow square bigger);
// the parts sent to the computer and a new file every few seconds (here);
// "mark" / "finish" said on the scoreboard make a cue named
// [player]-vs-[opponent]-[game]-[game N of raceto M]-[duration]-[date]-[time]-cued
// from the scoreboard, starting 20 s back (or at the recording's start) -
// never said out loud; the scoreboard's ⭐ Cue button and "/" key set and
// end one; the recording's sound goes quiet for a moment at a cue (so no
// cue sound is in the video); the cues page lists it and plays it from the
// recording; a clip cut with ffmpeg about as long as the cue; a cue deleted
// from its row; a recording deleted - to the Trash, not while it records;
// "mark" with nothing recording says so.
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
  const TRASH = path.join(__dirname, "tmphome", ".Trash");
  fs.rmSync(TRASH, { recursive: true, force: true });
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

  // "/" without a recording: the shot counter's pause, as always
  const slash = () => board.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true })));
  const shotTime = () => board.evaluate(() => document.getElementById("shot-counter-time").textContent);
  // (the shown time moves on a once-a-second tick: 2.2 s always sees it move, if it runs)
  const shotRuns = async () => { const a = await shotTime(); await sleep(2200); return a !== (await shotTime()); };
  await board.evaluate(() => { const c = document.getElementById("shot-counter-enabled-checkbox"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); });
  await sleep(300);
  const r0 = await shotRuns();
  await slash();
  const r1 = await shotRuns();
  check("\"/\" with nothing recording: starts / pauses the shot counter (as before)", !r0 && r1, { r0, r1 });

  // "mark" before anything records
  const early = await board.evaluate(() => window.PMCVoice.handleText("mark"));
  check("\"mark\" with no recording page: says so", early && early.result && early.result.ok === false && /recording page isn't open/.test(early.result.text), early && early.result);

  const rec = await browser.newPage();
  rec.on("pageerror", (e) => errors.push("record: " + e.message));
  await rec.goto(BASE + "manifest.json");
  await rec.evaluate(() => localStorage.setItem("pmc-recorder-settings", JSON.stringify({ sound: true }))); // (the fake microphone: a beep)
  await rec.evaluate(() => localStorage.setItem("poolMasterCounter.recordingConsent.v1", "probe")); // (asked already - see probe_local_recorder.js)
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
  check("the recording page hears the scoreboard: Luigi-vs-Luc · 8-Ball · game 4 of raceto 5", /Luigi-vs-Luc · 8-Ball · game 4 of raceto 5/.test(boardSeen), boardSeen);
  const st1 = await rec.evaluate(() => { const st = window.PMCRecorder.state(), s = window.PMCRecorder.recordedStream(); return { ducking: st.ducking, audio: s.getAudioTracks().length }; });
  check("the sound is recorded through a volume the cues can turn down", st1.ducking && st1.audio === 1, st1);
  // a cue turns the recorded sound down for a moment: the fake microphone's beep, measured in what's recorded
  const level = await rec.evaluate(async () => {
    // (each new file of the recording gets its sound afresh: listened to again then)
    const ctx = new AudioContext(), an = ctx.createAnalyser();
    let heard = null, src = null;
    const listen = () => { const st = window.PMCRecorder.recordedStream(); if (st === heard) return; heard = st; if (src) src.disconnect(); src = ctx.createMediaStreamSource(new MediaStream(st.getAudioTracks())); src.connect(an); };
    const buf = new Float32Array(an.fftSize);
    const peak = async (ms) => { let p = 0; const end = Date.now() + ms; while (Date.now() < end) { listen(); an.getFloatTimeDomainData(buf); for (const v of buf) p = Math.max(p, Math.abs(v)); await new Promise((r) => setTimeout(r, 20)); } return p; };
    const before = await peak(2500);
    window.PMCRecorder.duck(2600);
    await new Promise((r) => setTimeout(r, 150));
    const during = await peak(2200);
    await new Promise((r) => setTimeout(r, 400));
    const after = await peak(2500);
    ctx.close();
    return { before, during, after };
  });
  check("a cue silences the recorded sound for a moment, then it comes back", level.before > 0.02 && level.during < 0.002 && level.after > 0.02, level);

  // mark / finish said on the scoreboard (the recording tab in the background) - right
  // after the scorer switched to the next player: the cue is still Luigi's, as at its start
  await board.bringToFront();
  await board.evaluate(() => { window.__spoken = []; const s = window.speechSynthesis.speak.bind(window.speechSynthesis); window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); return s(u); }; });
  const cueBtn = () => board.evaluate(() => { const b = document.getElementById("btn-recorder-cue"); return { shown: !document.getElementById("recorder-cue-group").classList.contains("hidden") && b.offsetParent !== null, text: b.textContent, open: b.classList.contains("open"), h: Math.round(b.getBoundingClientRect().height) }; });
  let cb = await cueBtn();
  check("the score section shows ⭐ Cue while it records (44 px, like the row)", cb.shown && cb.text === "⭐ Cue" && !cb.open && cb.h === 44, cb);
  const switchedAt = Date.now();
  await board.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true })));
  await sleep(900);
  const switched = await rec.evaluate(() => window.PMCRecorder.state().board);
  check("the scorer switched to Luc just before the mark (the recorder heard it)", switched && switched.player === "Luc", switched);
  const m = await board.evaluate(() => window.PMCVoice.handleText("mark"));
  check("\"mark\" said on the scoreboard: Marked - shown, never said out loud (it would be in the video)", m.result && m.result.ok && /Marked/.test(m.result.text) && m.result.speak === "never", m.result);
  await sleep(300);
  check("...and the recording's sound went quiet for it", (await rec.evaluate(() => window.PMCRecorder.state().ducks)) >= 2);
  await sleep(6500);
  const f = await board.evaluate(() => window.PMCVoice.handleText("finish"));
  check("\"finish\": the cue is kept", f.result && f.result.ok, f.result);
  await sleep(1500);
  const cues = await (await fetch(BASE + "api/rec/cues")).json();
  const cue = cues.cues[0];
  const recStart = (await rec.evaluate(() => window.PMCRecorder.state())).id;
  check("the cue's name: Luigi-vs-Luc-8-Ball-game 4 of raceto 5-<duration>-<date>-<time>-cued", cue && /^Luigi-vs-Luc-8-Ball-game 4 of raceto 5-\d+s-\d{4}-\d{2}-\d{2}-\d{2}h\d{2}m\d{2}-cued$/.test(cue.name), cue && cue.name);
  const d0 = cue && new Date(cue.startedAt), p2 = (n) => String(n).padStart(2, "0");
  const startStamp = d0 ? d0.getFullYear() + "-" + p2(d0.getMonth() + 1) + "-" + p2(d0.getDate()) + "-" + p2(d0.getHours()) + "h" + p2(d0.getMinutes()) + "m" + p2(d0.getSeconds()) : "";
  check("...named for Luigi and the score as they stood at the cue's start, with its start time (not the mark's)", cue && cue.name.indexOf("Luigi-") === 0 && cue.name.indexOf(startStamp + "-cued") !== -1, { name: cue && cue.name, startStamp });
  check("...starting 20 s back - or at the recording's start, here 3 s back", cue && cue.markedAt - cue.startedAt >= 2500 && cue.markedAt - cue.startedAt <= 18000 && cue.endedAt - cue.markedAt >= 6000, cue);
  check("...and nothing was said out loud", (await board.evaluate(() => window.__spoken.length)) === 0, await board.evaluate(() => window.__spoken));

  // the "/" key (and ⭐ Cue): a cue, then its end
  await slash();
  await sleep(1200);
  const oc = await rec.evaluate(() => window.PMCRecorder.state().openCue);
  cb = await cueBtn();
  // (whose shot: the one selected at the cue's start, 20 s back - Luc only if that's after the switch)
  const shooter = oc && oc.startedAt > switchedAt + 1500 ? ["Luc", "Luigi"] : ["Luigi", "Luc"];
  check("\"/\" on the scoreboard: a cue - " + shooter.join("-vs-") + " (as at its start) - the button turns to ✔ End cue with its time", oc && oc.source === "key" && oc.player === shooter[0] && oc.opponent === shooter[1] && cb.open && /^✔ End cue 0:0\d$/.test(cb.text), { oc, cb });
  await sleep(2200);
  cb = await cueBtn();
  check("...counting", /0:0[2-9]/.test(cb.text), cb.text);
  await slash();
  await sleep(1500);
  const keyCue = (await (await fetch(BASE + "api/rec/cues")).json()).cues.find((c) => c.source === "key");
  cb = await cueBtn();
  check("\"/\" again: the cue ends and is kept, the button is ⭐ Cue again", keyCue && keyCue.endedAt && keyCue.name.indexOf(shooter.join("-vs-") + "-8-Ball-") === 0 && !cb.open && cb.text === "⭐ Cue" && !(await rec.evaluate(() => window.PMCRecorder.state().openCue)), { keyCue, cb });
  await board.click("#btn-recorder-cue");
  await sleep(1200);
  check("the ⭐ Cue button: a cue too", !!(await rec.evaluate(() => window.PMCRecorder.state().openCue)) && (await cueBtn()).open);
  await board.click("#btn-recorder-cue");
  await sleep(1200);
  check("...and ✔ End cue ends it", !(await rec.evaluate(() => window.PMCRecorder.state().openCue)) && !(await cueBtn()).open);
  check("still nothing said out loud", (await board.evaluate(() => window.__spoken.length)) === 0, await board.evaluate(() => window.__spoken));
  check("...and the shot counter kept running through the \"/\" cues (not paused by them)", await shotRuns());
  // not while it records: a recording can't be deleted
  const live = await fetch(BASE + "api/rec/sessions/" + encodeURIComponent(await rec.evaluate(() => window.PMCRecorder.state().id)), { method: "DELETE" });
  check("a recording can't be deleted while it records (409)", live.status === 409, live.status);

  // the cue viewer on the recording page, while it still records
  await rec.bringToFront();
  const dl = path.join(__dirname, "tmphome", "downloads");
  fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true });
  const cdp = await rec.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dl }).catch(() => cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: dl }));
  await rec.evaluate(() => window.PMCRecorder.viewer.refresh());
  await sleep(500);
  const vRow = await rec.evaluate((id) => { const r = document.querySelector('#cueViewer .cv-rows tr[data-id="' + id + '"]'); return r ? r.textContent : null; }, cue.id);
  check("the recording page's own cue viewer lists the cue, while recording", vRow && /Luigi-vs-Luc-8-Ball-game 4 of raceto 5-/.test(vRow), vRow);
  const liveBin = await rec.evaluate(() => { const b = document.querySelector('#cueViewer .cv-sess button.cv-del[data-del="session"]'); return b ? { disabled: b.disabled, title: b.title } : null; });
  check("...with the recordings below it - 🗑 off for the one recording now", liveBin && liveBin.disabled, liveBin);
  // a cue deleted from its row: a first click asks, a second deletes
  const bin = '#cueViewer .cv-rows button.cv-del[data-id="' + keyCue.id + '"]';
  await rec.click(bin);
  const asking = await rec.evaluate((s) => document.querySelector(s).textContent, bin);
  const stillThere = (await (await fetch(BASE + "api/rec/cues")).json()).cues.some((c) => c.id === keyCue.id);
  await rec.click(bin);
  await sleep(800);
  const gone = !(await (await fetch(BASE + "api/rec/cues")).json()).cues.some((c) => c.id === keyCue.id);
  check("🗑 on a cue's row: \"Delete?\" first, then it's deleted (the recording stays)", asking === "Delete?" && stillThere && gone && !(await rec.$(bin)), { asking, stillThere, gone });
  await rec.evaluate((id) => document.querySelector('#cueViewer .cv-rows tr[data-id="' + id + '"] td.n').click(), cue.id);
  let wallLive = null;
  for (let i = 0; i < 80; i++) { await sleep(250); wallLive = await rec.evaluate(() => { const v = document.querySelector("#cueViewer video"); return v.currentTime > 0.2 ? window.PMCRecorder.viewer.wallTime() : null; }); if (wallLive) break; }
  check("...and plays it from the recording still being made", wallLive && wallLive >= cue.startedAt - 1500 && wallLive <= cue.endedAt + 1000, { wallLive, start: cue.startedAt, end: cue.endedAt });
  const click = (a) => rec.evaluate((a) => document.querySelector('#cueViewer [data-a="' + a + '"]').click(), a);
  await click("s+1"); await click("s+1"); await click("e-1");
  const edited = await rec.evaluate(() => { const st = window.PMCRecorder.viewer.state(); return { dirty: st.dirty, s: st.sel.startedAt, e: st.sel.endedAt, name: st.sel.name, shown: document.querySelector("#cueViewer .cv-name").textContent }; });
  check("set by hand: start +2 s, end -1 s - the name's length and time follow, \"not saved\" shown", edited.dirty && edited.s === cue.startedAt + 2000 && edited.e === cue.endedAt - 1000 && /not saved/.test(edited.shown) && edited.name !== cue.name, edited);
  await click("save");
  await sleep(800);
  let stored = (await (await fetch(BASE + "api/rec/cues")).json()).cues.find((c) => c.id === cue.id);
  check("💾 saved on the computer", stored.startedAt === cue.startedAt + 2000 && stored.endedAt === cue.endedAt - 1000 && stored.name === edited.name, stored);
  // the start at the playhead
  await rec.evaluate((t) => window.PMCRecorder.viewer.seekTo(t, null, false), cue.startedAt + 3000);
  await sleep(1500);
  const here = await rec.evaluate(() => window.PMCRecorder.viewer.wallTime());
  await click("s-here");
  const atHere = await rec.evaluate(() => window.PMCRecorder.viewer.state().sel.startedAt);
  check("⟦ Set start here: the start at the playhead", here && Math.abs(atHere - here) < 300, { here, atHere });
  // export on the spot: saved, cut, downloaded
  await click("export");
  let exported = null;
  for (let i = 0; i < 60 && !exported; i++) { await sleep(500); const f = fs.readdirSync(dl).filter((n) => /\.mp4$/.test(n)); if (f.length) exported = f[0]; }
  stored = (await (await fetch(BASE + "api/rec/cues")).json()).cues.find((c) => c.id === cue.id);
  const want = (stored.endedAt - stored.startedAt) / 1000;
  const ed = exported ? ffprobeDuration(path.join(dl, exported)) : NaN;
  const exportStatus = await rec.evaluate(() => document.querySelector("#cueViewer .cv-status").textContent);
  check("⬇ Export while recording: saved, cut and downloaded - about as long as the set cue (" + exported + ")", exported && stored.startedAt === atHere && Math.abs(ed - want) < 2.5, { exported, ed, want, exportStatus });
  check("...and kept in the Clips folder", stored.clip && fs.existsSync(path.join(ROOT, "Clips", stored.clip)), stored.clip);
  // a cue of your own
  const before = (await (await fetch(BASE + "api/rec/cues")).json()).cues.length;
  await click("new");
  await sleep(1200);
  const after = (await (await fetch(BASE + "api/rec/cues")).json()).cues;
  check("＋ New cue here: a cue of your own at the playhead", after.length === before + 1 && after.some((c) => c.source === "by hand"), after.length);

  // the files: several parts, the finished ones indexed
  await sleep(1000);
  await rec.click("#recordBtn");
  await sleep(4000);
  const sessions = await (await fetch(BASE + "api/rec/sessions")).json();
  const s = sessions.sessions[0];
  const parts = s ? s.parts : [];
  check("recorded in parts (a new file every 5 s here), all ended", parts.length >= 3 && parts.every((p) => p.endedAt && p.bytes > 1000), parts.map((p) => ({ n: p.n, bytes: p.bytes, ended: !!p.endedAt })));
  const d1 = ffprobeDuration(path.join(ROOT, s.id, parts[0].file));
  check("a part is a real video of about 5 s", d1 > 3.5 && d1 < 7, d1);
  check("the recording stopped", !!s.endedAt);
  await board.bringToFront();
  await sleep(1200);
  const cueHidden = await board.evaluate(() => document.getElementById("recorder-cue-group").classList.contains("hidden"));
  await slash();
  const r2 = await shotRuns();
  check("recording stopped: ⭐ Cue hidden, \"/\" pauses the shot counter again", cueHidden && !r2, { cueHidden, r2 });

  // the cues page: the same viewer, and the recordings' timelines
  const cp = await browser.newPage();
  cp.on("pageerror", (e) => errors.push("cues: " + e.message));
  await cp.goto(BASE + "cues.html", { waitUntil: "domcontentloaded" });
  await sleep(1500);
  const rows = await cp.evaluate(() => Array.from(document.querySelectorAll(".cv-rows tr[data-id] td.n")).map((td) => td.textContent));
  check("the cues page lists them", rows.some((r) => r === stored.name), rows);
  await cp.evaluate((id) => document.querySelector('.cv-rows tr[data-id="' + id + '"] td.n').click(), cue.id);
  let wall = null;
  for (let i = 0; i < 80; i++) { await sleep(250); wall = await cp.evaluate(() => { const v = document.querySelector(".cv video"); return v.currentTime > 0.2 ? window.PMCCues.wallTime() : null; }); if (wall) break; }
  check("▶ plays it from the recording, from its (set) start", wall && wall >= stored.startedAt - 1500 && wall <= stored.endedAt, { wall, start: stored.startedAt, end: stored.endedAt });
  const timeline = await cp.evaluate(() => document.querySelectorAll(".cv-session .cv-tl .c").length);
  check("the recording's timeline shows the cues", timeline >= 2, timeline);

  // a recording deleted: to the Trash, with its cues; the exported clip stays
  const sbin = '.cv-sess button.cv-del[data-del="session"][data-id="' + s.id + '"]';
  await cp.click(sbin);
  const sAsk = await cp.evaluate((q) => document.querySelector(q).textContent, sbin);
  const sStill = fs.existsSync(path.join(ROOT, s.id));
  await cp.click(sbin);
  await sleep(1500);
  const trashed = fs.existsSync(TRASH) ? fs.readdirSync(TRASH) : [];
  const leftCues = (await (await fetch(BASE + "api/rec/cues")).json()).cues.filter((c) => c.session === s.id);
  const sessAfter = (await (await fetch(BASE + "api/rec/sessions")).json()).sessions.map((x) => x.id);
  check("🗑 Delete on a recording: asks first, then it goes to the Trash (with its parts)", sAsk === "Delete this recording?" && sStill && !fs.existsSync(path.join(ROOT, s.id)) && trashed.includes("Pool Master Counter " + s.id) && fs.existsSync(path.join(TRASH, "Pool Master Counter " + s.id, parts[0].file)) && !sessAfter.includes(s.id), { sAsk, sStill, trashed, sessAfter });
  check("...its cues with it, the exported clip kept", leftCues.length === 0 && fs.existsSync(path.join(ROOT, "Clips", stored.clip)), { left: leftCues.length });
  const shown = await cp.evaluate(() => ({ rows: document.querySelectorAll(".cv-rows tr[data-id]").length, sess: document.querySelectorAll(".cv-session").length, status: document.querySelector(".cv-status").textContent }));
  check("...and the page shows it gone", shown.rows === 0 && shown.sess === 0 && /in the Trash/.test(shown.status), shown);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
