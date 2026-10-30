// ⏪ The whole recording, while it records (2026-10-30 request: "navigate the full recording while it
// records, so we can get back in time and add cues"). Its own server (4304, a throwaway HOME), the
// recording page with a fake camera, a new file every 8 s, a 🎱 game mark (Kim v Jo, 8-Ball) 3 s in:
// - "⏪ The whole recording" under the cue player: "● recording · 0:2x so far", the blue game line,
//   the red live end, 🔴 Live; nothing played yet - "Click or drag the line...";
// - dragged back along it: the time under the finger ("hh:mm:ss · 0:1x ago"), and let go: plays
//   from there - the first file (finished), the moment dragged to;
// - ◀ 10 s / 10 s ▶ and ← →: 10 s back / on, across files;
// - ＋ Add a cue here (the N key): a cue at the playhead, named after the game then
//   ("Kim v Jo-8-Ball-..."), in this recording, open to set its start and end, gold on the line;
// - the file still being recorded, clicked into: there, the picture ready (a copy of it as it is
//   now, to jump in); playing or paused as it was;
// - 🔴 Live: the newest seconds, up to the end of what's recorded - "That's the latest recorded";
//   stopped: the copies gone;
// - the cues page: a recording never stopped (the page closed) isn't "● recording" - its length
//   up to its last file's writing, and it can be deleted; a recording of 2 hours played: "1 h" shows an hour around the playhead, "10 min"
//   ten minutes, "All" the two hours;
// - no page errors.
// usage: node tests/probe_live_timeline.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 4304, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const FF = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((f) => fs.existsSync(f));
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 640, H = 360;
function makeY4m(file) {
  const Y = Buffer.alloc(W * H, 120), U = Buffer.alloc(W * H / 4, 90), V = Buffer.alloc(W * H / 4, 160);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}
const pad2 = (n) => String(n).padStart(2, "0");
const folderId = (t) => { const d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + "h" + pad2(d.getMinutes()); };

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-live-timeline-"));
  const HOME = path.join(TMP, "home"), ROOT = path.join(HOME, "Movies", "Pool Master Counter");
  fs.mkdirSync(ROOT, { recursive: true });
  // a finished recording of 2 hours, yesterday (its files short - only the times count here)
  const old0 = Date.now() - 26 * 3600000, oldId = folderId(old0);
  fs.mkdirSync(path.join(ROOT, oldId));
  const parts = [];
  for (let n = 1; n <= 12; n++) {
    const file = "part-" + String(n).padStart(3, "0") + ".mp4";
    execFileSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=4:size=160x120:rate=10", "-c:v", "libx264", "-g", "10", "-pix_fmt", "yuv420p", path.join(ROOT, oldId, file)]);
    parts.push({ n, file, startedAt: old0 + (n - 1) * 600000, endedAt: old0 + n * 600000 });
  }
  fs.writeFileSync(path.join(ROOT, oldId, "session.json"), JSON.stringify({ id: oldId, startedAt: old0, endedAt: old0 + 7200000, mime: "video/mp4", ext: "mp4", parts }));
  // ...and one never stopped (the page closed 3 hours ago): no end, its last file not written since
  const lost0 = Date.now() - 4 * 3600000, lostId = folderId(lost0);
  fs.mkdirSync(path.join(ROOT, lostId));
  fs.copyFileSync(path.join(ROOT, oldId, "part-001.mp4"), path.join(ROOT, lostId, "part-001.mp4"));
  fs.utimesSync(path.join(ROOT, lostId, "part-001.mp4"), new Date(lost0 + 3600000), new Date(lost0 + 3600000));
  fs.writeFileSync(path.join(ROOT, lostId, "session.json"), JSON.stringify({ id: lostId, startedAt: lost0, endedAt: null, mime: "video/mp4", ext: "mp4", parts: [{ n: 1, file: "part-001.mp4", startedAt: lost0, endedAt: null, bytes: 0 }] }));
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], { env: Object.assign({}, process.env, { HOME, PORT: String(PORT) }), stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + "manifest.json")).ok) break; } catch (e) {} await sleep(250); }
  const y4m = path.join(TMP, "cam.y4m");
  makeY4m(y4m);
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1200, height: 1000 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"]
  });
  const errors = [];
  const api = async (p, body) => (await fetch(BASE + p, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)).json();
  try {
    const rec = await browser.newPage();
    rec.on("pageerror", (e) => errors.push("record: " + e.message));
    await rec.goto(BASE + "manifest.json");
    await rec.evaluate(() => localStorage.setItem("poolMasterCounter.recordingConsent.v1", "probe"));
    await rec.goto(BASE + "record.html", { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 40; i++) { if (await rec.evaluate(() => document.getElementById("out").videoWidth > 0)) break; await sleep(250); }
    await sleep(600);
    await rec.evaluate(() => window.PMCRecorder.setPartMs(8000));
    await rec.click("#recordBtn");
    await sleep(1500);
    const live = ((await api("api/rec/sessions")).sessions || []).find((s) => !s.endedAt);
    const t0 = live.startedAt;
    await api("api/rec/cues", { kind: "game", markedAt: t0 + 3000, startedAt: t0 + 3000, endedAt: t0 + 3000, duration: 0, name: "🎱 Game 2 · 8-Ball · Kim v Jo", customName: true, matchup: "Kim v Jo", gameType: "8ball", gameLabel: "8-Ball", position: "", source: "game", session: live.id });
    await sleep(22000);
    await rec.evaluate(() => window.PMCRecorder.viewer.refresh());
    await sleep(1200);
    const state = () => rec.evaluate(() => {
      const v = window.PMCRecorder.viewer, st = v.state(), box = document.querySelector(".cv-whole"), video = document.querySelector(".cv-video");
      return {
        shown: box && !box.hidden, what: box && box.querySelector(".cv-whole-what").textContent, at: box && box.querySelector(".cv-wat").textContent,
        games: box ? box.querySelectorAll(".cv-wline .c.g").length : 0, gold: box ? box.querySelectorAll(".cv-wline .c:not(.g)").length : 0,
        liveEnd: box && !box.querySelector(".cv-wlive").hidden, goLive: box && !box.querySelector(".cv-golive").hidden,
        wall: v.wallTime(), session: st.play && st.play.session.id, index: st.play && st.play.index, paused: video.paused, src: video.getAttribute("src") || "",
        s: box && +box.querySelector(".cv-wline").getAttribute("data-s"), e: box && +box.querySelector(".cv-wline").getAttribute("data-e")
      };
    });
    let a = await state();
    if (OUT) await rec.screenshot({ path: path.join(OUT, "live_timeline.png"), fullPage: true });
    check("\"⏪ The whole recording\": \"" + a.what + "\", the blue game line, the red live end, 🔴 Live; \"" + a.at + "\"", a.shown && new RegExp("● recording · 0:2\\d so far").test(a.what) && a.games === 1 && a.liveEnd && a.goLive && /Click or drag the line/.test(a.at), a);

    // dragged back along it, let go: plays from there
    const box = await rec.evaluate(() => { const r = document.querySelector(".cv-wline").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await rec.evaluate(() => document.querySelector(".cv-wline").scrollIntoView({ block: "center" }));
    await sleep(300);
    const lb = await rec.evaluate(() => { const r = document.querySelector(".cv-wline").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const y = lb.y + lb.h / 2;
    await rec.mouse.move(lb.x + lb.w * 0.8, y);
    await rec.mouse.down();
    await rec.mouse.move(lb.x + lb.w * 0.5, y, { steps: 5 });
    await rec.mouse.move(lb.x + lb.w * 0.2, y, { steps: 5 });
    const mid = await rec.evaluate(() => { const b = document.querySelector(".cv-wbubble"); return b.hidden ? "" : b.textContent; });
    const target = a.s + 0.2 * (a.e - a.s);
    await rec.mouse.up();
    await sleep(2500);
    let b = await state();
    check("dragged back: \"" + mid + "\" under the finger; let go - plays from there (" + ((b.wall - target) / 1000).toFixed(1) + " s off, file " + (b.index + 1) + ", the first - finished)", /^\d\d:\d\d:\d\d · 0:\d\d ago$/.test(mid) && b.session === live.id && b.index === 0 && Math.abs(b.wall - target) < 3500 && !b.paused && !/\?t=/.test(b.src), { mid, b, target });

    // 10 s on (into the next file), 10 s back; → ←
    let w0 = b.wall;
    await rec.evaluate(() => document.querySelector('.cv-whole [data-w="10000"]').click());
    await sleep(1500);
    const f1 = await state();
    await rec.evaluate(() => document.querySelector('.cv-whole [data-w="-10000"]').click());
    await sleep(1500);
    const f2 = await state();
    await rec.evaluate(() => document.body.focus());
    await rec.keyboard.press("ArrowRight");
    await sleep(1500);
    const f3 = await state();
    await rec.keyboard.press("ArrowLeft");
    await sleep(1500);
    const f4 = await state();
    const d = (x, y) => (x.wall - y.wall) / 1000;
    check("10 s ▶ (+" + d(f1, b).toFixed(1) + " s, file " + (f1.index + 1) + "), ◀ 10 s (" + d(f2, f1).toFixed(1) + "), → (+" + d(f3, f2).toFixed(1) + "), ← (" + d(f4, f3).toFixed(1) + ")", d(f1, b) > 8 && d(f1, b) < 13.5 && f1.index > b.index && d(f2, f1) < -6.5 && d(f2, f1) > -11 && d(f3, f2) > 8 && d(f3, f2) < 13.5 && d(f4, f3) < -6.5 && d(f4, f3) > -11, { b, f1, f2, f3, f4 });

    // ＋ Add a cue here: N
    await rec.evaluate(() => document.querySelector(".cv-video").pause());
    await sleep(300);
    const here = (await state()).wall;
    await rec.keyboard.press("n");
    await sleep(1500);
    const all = (await api("api/rec/cues")).cues || [];
    const added = all.find((c) => c.source === "by hand");
    const after = await state();
    const editing = await rec.evaluate(() => { const st = window.PMCRecorder.viewer.state(); return { sel: st.sel && st.sel.id, edit: !document.querySelector(".cv-edit").hidden, status: document.querySelector(".cv-status").textContent }; });
    check("＋ Add a cue here (N): a cue at the playhead (" + (added ? ((added.startedAt - here) / 1000).toFixed(1) : "-") + " s off), \"" + (added && added.name) + "\", this recording, open to set (\"" + editing.status + "\"), gold on the line", added && Math.abs(added.startedAt - here) < 1000 && /^Kim v Jo-8-Ball-/.test(added.name) && added.session === live.id && editing.sel === added.id && editing.edit && /A cue at \d\d:\d\d:\d\d/.test(editing.status) && after.gold === 1, { added, editing, after });

    // into the file still being recorded (from here a file a minute long, 7 s into it): clicked 3 s
    // into it (paused - as the player was) - there, the picture ready (a copy of it as it is now)
    await rec.evaluate(() => window.PMCRecorder.setPartMs(60000));
    const since = Date.now();
    let lp = null;
    for (let i = 0; i < 60; i++) { const ss = ((await api("api/rec/sessions")).sessions || []).find((x) => x.id === live.id); lp = ss.parts[ss.parts.length - 1]; if (lp.startedAt > since - 1000 && !lp.endedAt && Date.now() - lp.startedAt > 7000) break; await sleep(500); }
    await rec.evaluate(() => window.PMCRecorder.viewer.refresh());
    await sleep(1000);
    await rec.evaluate(() => document.querySelector(".cv-wline").scrollIntoView({ block: "center" }));
    const lb2 = await rec.evaluate(() => { const r = document.querySelector(".cv-wline").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    const s2 = await state(), target2 = lp.startedAt + 3000;
    await rec.mouse.click(lb2.x + lb2.w * (target2 - s2.s) / (Date.now() - s2.s), lb2.y + lb2.h / 2);
    await sleep(2500);
    const g1 = await state();
    const copies = fs.readdirSync(path.join(ROOT, live.id)).filter((n) => /\.live-\d+\.mp4$/.test(n));
    const err = await rec.evaluate(() => { const v = document.querySelector(".cv-video"); return { error: v.error && v.error.message, ready: v.readyState }; });
    check("into the file still being recorded (file " + (g1.index + 1) + ", paused as it was): there (" + ((g1.wall - target2) / 1000).toFixed(1) + " s off), the picture ready - a copy of it as it is now (" + copies.join(", ") + ")", /\?live=/.test(g1.src) && Math.abs(g1.wall - target2) < 1000 && g1.paused && !err.error && err.ready >= 2 && copies.length >= 1, { g1, target2, copies, lp, err });

    // 🔴 Live: the newest seconds, then "That's the latest recorded"
    await sleep(4000);
    await rec.evaluate(() => document.querySelector(".cv-whole .cv-golive").click());
    await sleep(2500);
    const l1 = await state();
    const behind = (Date.now() - 2500 - l1.wall) / 1000;
    await sleep(9000);
    const l2 = await state();
    const latest = await rec.evaluate(() => document.querySelector(".cv-status").textContent);
    check("🔴 Live: the newest seconds (" + behind.toFixed(1) + " s behind), played to the end of what's recorded: \"" + latest + "\"", l1.wall && behind < 11 && !l1.paused && /\?live=/.test(l1.src) && l2.paused && /That's the latest recorded/.test(latest), { l1, l2, latest });
    await rec.evaluate(() => document.getElementById("recordBtn").click());
    await sleep(3000);
    const leftover = fs.readdirSync(path.join(ROOT, live.id)).filter((n) => /\.live-/.test(n));
    check("stopped: the copies gone (" + leftover.length + " left)", leftover.length === 0, leftover);

    // the cues page: a 2-hour recording, zoomed
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push("cues: " + e.message));
    await page.goto(BASE + "cues.html", { waitUntil: "networkidle2" });
    await sleep(1500);
    const lost = await page.evaluate((lostId) => { const row = [...document.querySelectorAll(".cv-session")].find((x) => x.textContent.indexOf(lostId) !== -1); return row ? { text: row.querySelector(".cv-session-head").textContent, del: row.querySelector(".cv-del").disabled } : null; }, lostId);
    check("a recording never stopped (the page closed 3 h ago): not \"● recording\" (" + (lost && lost.text) + "), can be deleted", lost && !/recording/.test(lost.text) && /1:00:00/.test(lost.text) && !lost.del, lost);
    await page.evaluate((oldId) => {
      const tl = [...document.querySelectorAll(".cv-session")].find((x) => x.textContent.indexOf(oldId) !== -1).querySelector(".cv-tl");
      const r = tl.getBoundingClientRect();
      tl.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + r.width * 0.3, clientY: r.top + 5 }));
    }, oldId);
    await sleep(1500);
    const zoom = async (z) => { await page.evaluate((z) => document.querySelector('.cv-zoom [data-z="' + z + '"]').click(), z); await sleep(300); return page.evaluate(() => { const l = document.querySelector(".cv-wline"), st = window.PMCCues.state(); return { what: document.querySelector(".cv-whole-what").textContent, span: (+l.getAttribute("data-e") - +l.getAttribute("data-s")) / 60000, s: +l.getAttribute("data-s"), t: window.PMCCues.wallTime(), session: st.play && st.play.session.id, ticks: [...l.querySelectorAll(".tk")].map((x) => x.textContent) }; }); };
    const z60 = await zoom(3600000), z10 = await zoom(600000), zAll = await zoom(0);
    if (OUT) await page.screenshot({ path: path.join(OUT, "live_timeline_cues_page.png") });
    check("the cues page, a 2-hour recording played (\"" + zAll.what + "\"): 1 h - " + z60.span + " min around the playhead, 10 min - " + z10.span + " (" + z10.ticks.join(" ") + "), All - " + zAll.span, z60.session === oldId && z60.span === 60 && z60.t > z60.s && z60.t < z60.s + 3600000 && z10.span === 10 && z10.t > z10.s && z10.t < z10.s + 600000 && z10.ticks.length >= 3 && zAll.span === 120 && zAll.what.indexOf(oldId) === 0 && /2:00:00$/.test(zAll.what), { z60, z10, zAll });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
