// 🎱 Game marks on this device's own recording (2026-10-29 request) - no Mac: the in-app recorder
// (🎞️ Everything) on a fake camera, Kim v Jo, 8-Ball, race to 3:
// - a rack won while recording: a game mark ("🎱 Game 2 · 8-Ball · Kim v Jo", kind "game", a
//   moment at the win); a ⭐ cue (mark, finish) stays a cue;
// - the list: the game mark blue (its own border and name colour), the cue gold - different;
//   the game mark has ▶ Play and no ⬇ Save; the recording says "1 ⭐ · 1 🎱";
// - ▶ Play on the game mark plays the recording from there; 🐢 slow motion: ¼× plays at a quarter
//   speed (and stays for the next clip played), "1 frame ▶" pauses and moves on 1/30 s;
// - ☑ the checked cues together: two ⭐ cues checked ("2 checked"); 📌 Save (keep forever): kept,
//   with their own clip - the recording deleted, they stay and still play; ⬇ Export: two downloads;
//   📤 Share: "Share now (2)", then the share sheet with two MP4s; 🗑 Delete: asks, then gone;
// - not recording: no game mark;
// - no page errors.
// Its own file server on 4297 (no /api - the device's own recorder).
// usage: node tests/probe_game_marks_device.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4297, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
function makeY4m(file) {
  const W = 320, H = 180, N = 30, parts = [Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F10:1 Ip A1:1 C420jpeg\n")];
  for (let f = 0; f < N; f++) {
    const Y = Buffer.alloc(W * H), U = Buffer.alloc(W * H / 4, 128), V = Buffer.alloc(W * H / 4, 128);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) Y[y * W + x] = ((x + f * 8) % 64 < 32) ^ ((y + f * 3) % 48 < 24) ? 200 : 40;
    parts.push(Buffer.from("FRAME\n"), Y, U, V);
  }
  fs.writeFileSync(file, Buffer.concat(parts));
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-game-marks-"));
  const y4m = path.join(TMP, "moving.y4m");
  makeY4m(y4m);
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 1000 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"] });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__shared = []; window.__downloads = [];
      navigator.canShare = () => true;
      navigator.share = (d) => { window.__shared.push((d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size }))); return Promise.resolve(); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
    });
    await page.goto(BASE + "manifest.json");
    await page.evaluate(() => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.recordingConsent.v1", new Date().toISOString());
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "a", name: "Kim", playing: true, balls: 0 }, { id: "b", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 } }));
    });
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(1200);
    const winRack = async (name) => {
      await page.evaluate((name) => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
      await sleep(1000);
      await page.keyboard.press("Enter").catch(() => {});
      await sleep(400);
    };
    const all = () => page.evaluate(() => window.PMCLocalRecorder.cues());
    // not recording: nothing
    await winRack("Jo");
    const before = (await all()).length;
    // record everything
    await page.evaluate(() => { const m = document.getElementById("lrec-mode"); m.value = "full"; m.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.evaluate(() => document.getElementById("btn-lrec-start").click());
    await sleep(2500);
    const t1 = Date.now();
    await winRack("Kim");
    await sleep(800);
    await page.evaluate(() => window.PMCLocalRecorder.mark("button"));
    await sleep(2000);
    await page.evaluate(() => window.PMCLocalRecorder.finish("button"));
    await sleep(1500);
    const cues = await all();
    const games = cues.filter((c) => c.kind === "game"), own = cues.filter((c) => c.kind !== "game");
    check("not recording: a rack won - no game mark (" + before + ")", before === 0, before);
    check("recording: a rack won - a game mark \"" + (games[0] && games[0].name) + "\", a moment at the win; the ⭐ cue stays a cue", games.length === 1 && games[0].name === "🎱 Game 3 · 8-Ball · Kim v Jo" && games[0].startedAt === games[0].endedAt && Math.abs(games[0].startedAt - t1) < 2500 && own.length === 1 && own[0].endedAt > own[0].startedAt, cues);
    await page.evaluate(() => document.getElementById("btn-lrec-start").click());
    await sleep(1500);
    await page.evaluate(() => { const b = document.getElementById("btn-open-recorder"); if (b) b.click(); });
    await sleep(800);
    const list = await page.evaluate(() => {
      const g = document.querySelector("#lrec-cues li.lrec-game"), c = document.querySelector("#lrec-cues li.lrec-cue");
      const s = document.querySelector("#lrec-sessions li .lrec-meta");
      return { game: g ? { border: getComputedStyle(g).borderLeftColor, name: getComputedStyle(g.querySelector(".lrec-name")).color, buttons: [...g.querySelectorAll("button")].map((b) => b.textContent) } : null, cue: c ? { border: getComputedStyle(c).borderLeftColor, buttons: [...c.querySelectorAll("button")].map((b) => b.textContent) } : null, session: s ? s.textContent : "" };
    });
    if (OUT) await page.screenshot({ path: path.join(OUT, "game_marks_device.png") });
    check("the list: the game mark blue (" + (list.game && list.game.border) + "), the cue gold (" + (list.cue && list.cue.border) + ") - different", list.game && list.cue && list.game.border !== list.cue.border && list.game.name === list.game.border, list);
    check("...the game mark: ▶ Play, no ⬇ Save; the recording: 1 ⭐ · 1 🎱 (" + list.session + ")", list.game && list.game.buttons.some((b) => /Play/.test(b)) && !list.game.buttons.some((b) => /Save/.test(b)) && /1 ⭐ · 1 🎱/.test(list.session), list);
    await page.evaluate(() => [...document.querySelectorAll("#lrec-cues li.lrec-game button")].find((b) => /Play/.test(b.textContent)).click());
    await sleep(1500);
    const played = await page.evaluate(() => { const v = document.querySelector("#lrec-player video, video#lrec-player, .lrec-player video"); return v ? { src: !!v.src, t: v.currentTime } : null; });
    check("...▶ Play on it plays the recording from there", played && played.src, played);
    await page.evaluate(() => document.querySelector('#lrec-speed button[data-speed="0.25"]').click());
    await sleep(300);
    const slow = await page.evaluate(() => { const v = document.getElementById("lrec-player"); return { shown: !document.getElementById("lrec-speed").classList.contains("hidden"), rate: v.playbackRate, on: document.querySelector("#lrec-speed button.is-on").textContent }; });
    await page.evaluate(() => [...document.querySelectorAll("#lrec-cues li.lrec-cue button")].find((b) => /Play/.test(b.textContent)).click());
    await sleep(1500);
    const kept = await page.evaluate(() => document.getElementById("lrec-player").playbackRate);
    const t0 = await page.evaluate(() => document.getElementById("lrec-player").currentTime);
    await page.evaluate(() => document.querySelector('#lrec-speed button[data-step="1"]').click());
    await sleep(300);
    const step = await page.evaluate(() => ({ paused: document.getElementById("lrec-player").paused, t: document.getElementById("lrec-player").currentTime }));
    check("🐢 slow motion: ¼× (" + slow.rate + "), kept for the next clip played (" + kept + "); \"1 frame ▶\" pauses and moves on " + (step.t - t0).toFixed(3) + " s", slow.shown && slow.rate === 0.25 && slow.on === "¼×" && kept === 0.25 && step.paused && step.t - t0 > 0.02 && step.t - t0 < 0.08, { slow, kept, t0, step });
    // ---- ☑ together: a second ⭐ cue first (a new recording) ----
    await page.evaluate(() => document.getElementById("btn-lrec-start").click());
    await sleep(2000);
    await page.evaluate(() => window.PMCLocalRecorder.mark("button"));
    await sleep(2000);
    await page.evaluate(() => window.PMCLocalRecorder.finish("button"));
    await sleep(800);
    await page.evaluate(() => document.getElementById("btn-lrec-start").click());
    await sleep(1500);
    await page.evaluate(() => document.querySelectorAll("#lrec-cues li.lrec-cue .lrec-pick").forEach((b) => b.click()));
    await sleep(300);
    const g0 = await page.evaluate(() => ({ picked: document.getElementById("lrec-picked").textContent, buttons: [...document.querySelectorAll("#lrec-group button")].map((b) => b.disabled) }));
    await page.evaluate(() => document.querySelector('#lrec-group button[data-g="keep"]').click());
    await sleep(2500);
    const keptCues = await page.evaluate(async () => (await window.PMCLocalRecorder.cues()).filter((c) => c.kept).map((c) => ({ id: c.id, blob: !!c.keptClip && c.keptClip.size > 0 })));
    check("☑ two ⭐ cues checked (" + g0.picked + "); 📌 Save (keep forever): both kept with their own clip", g0.picked === "2 checked" && g0.buttons.every((d) => !d) && keptCues.length === 2 && keptCues.every((k) => k.blob), { g0, keptCues });
    // the recordings deleted: the kept cues stay, and play
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => { const b = document.querySelector("#lrec-sessions li button.lrec-del"); if (b) b.click(); });
      await sleep(200);
      await page.evaluate(() => { const b = document.querySelector("#lrec-sessions li button.lrec-del"); if (b) b.click(); });
      await sleep(800);
    }
    const left = await page.evaluate(async () => ({ sessions: (await window.PMCLocalRecorder._all("sessions")).length, cues: (await window.PMCLocalRecorder.cues()).map((c) => (c.kept ? "kept" : c.kind || "cue")) }));
    await page.evaluate(() => [...document.querySelectorAll("#lrec-cues li.lrec-kept button")].find((b) => /Play/.test(b.textContent)).click());
    await sleep(1200);
    const keptPlays = await page.evaluate(() => { const v = document.getElementById("lrec-player"); return !!v.src && v.readyState >= 1; });
    check("...the recordings deleted: the kept cues stay (" + left.cues.join(", ") + ") and still play", left.sessions === 0 && left.cues.filter((c) => c === "kept").length === 2 && !left.cues.includes("game") && keptPlays, { left, keptPlays });
    await page.evaluate(() => { window.__downloads = []; document.querySelector('#lrec-group button[data-g="export"]').click(); });
    await sleep(1500);
    const dls = await page.evaluate(() => window.__downloads);
    check("...⬇ Export: two downloads (" + dls.join(", ") + ")", dls.length === 2 && dls.every((d) => /\.mp4$/.test(d)), dls);
    await page.evaluate(() => document.querySelector('#lrec-group button[data-g="share"]').click());
    await sleep(1500);
    const ready = await page.evaluate(() => document.querySelector('#lrec-group button[data-g="share"]').textContent);
    await page.evaluate(() => document.querySelector('#lrec-group button[data-g="share"]').click());
    await sleep(300);
    const shared = await page.evaluate(() => window.__shared);
    check("...📤 Share: \"" + ready + "\", then the share sheet with two MP4s", /Share now \(2\)/.test(ready) && shared.length === 1 && shared[0].length === 2 && shared[0].every((f) => f.type === "video/mp4" && f.size > 0), { ready, shared });
    await page.evaluate(() => document.querySelector('#lrec-group button[data-g="delete"]').click());
    await sleep(200);
    const asks = await page.evaluate(() => document.querySelector('#lrec-group button[data-g="delete"]').textContent);
    await page.evaluate(() => document.querySelector('#lrec-group button[data-g="delete"]').click());
    await sleep(800);
    const after = await page.evaluate(async () => (await window.PMCLocalRecorder.cues()).length);
    if (OUT) await page.screenshot({ path: path.join(OUT, "group_device.png") });
    check("...🗑 Delete: \"" + asks + "\", then gone", /Delete 2\?/.test(asks) && after === 0, { asks, after });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
