// 🎱 Game marks on the Mac's recording (2026-10-29 request): the scoreboard and the recording page in
// two tabs (a fake camera), Kim v Jo, 8-Ball, race to 3, recording:
// - every new game a game mark - two racks won, two marks ("🎱 Game 2 · 8-Ball · Kim v Jo", "Game 3"),
//   each a moment (start = end), kind "game", at the win;
// - a ⭐ cue (the "/" key, twice) stays a cue - no kind;
// - the cues page: the game marks blue lines on the recording's timeline, the ⭐ cue a gold block -
//   different colours; their rows a blue dot, the cue's gold; the legend says which is which;
//   a game mark picked: no clip to export (and the server says no); 🐢 slow motion on the cue
//   viewer: ½× and ⅛× (buttons, the "s" key), a frame on with "." (paused, 1/30 s);
// - 📁 Daily cue folders on the cues page: today's - "📁 Make today's folder now": "Pool Master Cues
//   <today> Jo - Kim" in the recordings folder with the ⭐ cue's clip (not the game marks); 🗑 Delete
//   (asked twice): to the Trash, the row says so;
// - ☑ the cues page's checked cues, together: the ⭐ cue checked - 📌 Save (keep forever): cut out
//   (in Clips) and kept (📌 on its row), the recording deleted: it stays; 📤 Share: "Share now (1)",
//   then the share menu with its MP4; ⬇ Export: downloaded; 🗑 Delete: asks, then gone;
// - not recording: no game mark;
// - no page errors.
// usage: node tests/probe_game_marks.js http://localhost:4235/ [screenshot dir]   (server: HOME=tests/tmphome PORT=4235 node server/server.js)
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2] || "http://localhost:4235/";
const OUT = process.argv[3];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 640, H = 360;
const ROOT = path.join(__dirname, "tmphome", "Movies", "Pool Master Counter");
function makeY4m(file) {
  const Y = Buffer.alloc(W * H, 120), U = Buffer.alloc(W * H / 4, 90), V = Buffer.alloc(W * H / 4, 160);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("YUV4MPEG2 W" + W + " H" + H + " F30:1 Ip A1:1 C420jpeg\nFRAME\n"), Y, U, V]));
}

(async () => {
  if (/:(4173|4174)\//.test(BASE)) { console.log("FAIL never the real server"); process.exit(1); }
  fs.rmSync(ROOT, { recursive: true, force: true });
  const y4m = path.join(__dirname, "tmphome", "game-marks.y4m");
  makeY4m(y4m);
  const browser = await puppeteer.launch({
    executablePath: EXE, headless: "new", defaultViewport: { width: 1200, height: 900 },
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--use-file-for-fake-video-capture=" + y4m, "--autoplay-policy=no-user-gesture-required"]
  });
  const errors = [];
  const cues = async () => { const r = await (await fetch(BASE + "api/rec/cues")).json(); return r.cues || []; };
  try {
    const board = await browser.newPage();
    board.on("pageerror", (e) => errors.push("board: " + e.message));
    await board.goto(BASE + "manifest.json");
    await board.evaluate(() => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "a", name: "Kim", playing: true, balls: 0 }, { id: "b", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 3, rotation: { enabled: false, order: [], every: 1 } }));
    });
    await board.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(800);
    const winRack = async (name) => {
      await board.evaluate((name) => [...document.querySelectorAll("#scoreboard .btn-ball.plus")].find((b) => b.getAttribute("aria-label").endsWith(" for " + name)).click(), name);
      await sleep(1200);
      await board.keyboard.press("Enter").catch(() => {}); // (the balls-left row: closed)
      await sleep(300);
    };
    // not recording yet: a rack won - no mark
    await winRack("Jo");
    const before = (await cues()).filter((c) => c.kind === "game").length;

    const rec = await browser.newPage();
    rec.on("pageerror", (e) => errors.push("record: " + e.message));
    await rec.goto(BASE + "manifest.json");
    await rec.evaluate(() => localStorage.setItem("poolMasterCounter.recordingConsent.v1", "probe"));
    await rec.goto(BASE + "record.html", { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 40; i++) { if (await rec.evaluate(() => document.getElementById("out").videoWidth > 0)) break; await sleep(250); }
    await sleep(600);
    await rec.click("#recordBtn");
    await sleep(2500);
    await board.bringToFront();
    const t1 = Date.now();
    await winRack("Kim");
    await sleep(800);
    // a ⭐ cue: "/" twice
    await board.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true })));
    await sleep(1500);
    await board.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true })));
    await sleep(800);
    const t2 = Date.now();
    await winRack("Jo");
    await sleep(1500);
    const all = await cues();
    const games = all.filter((c) => c.kind === "game").sort((a, b) => a.startedAt - b.startedAt), own = all.filter((c) => c.kind !== "game");
    check("not recording: a rack won - no game mark (" + before + ")", before === 0, before);
    check("recording: two racks won - two game marks: " + games.map((g) => g.name).join(" | "), games.length === 2 && games[0].name === "🎱 Game 3 · 8-Ball · Kim v Jo" && games[1].name === "🎱 Game 4 · 8-Ball · Kim v Jo", all);
    check("...each a moment at the win (start = end, within a second of it)", games.length === 2 && games.every((g) => g.startedAt === g.endedAt) && Math.abs(games[0].startedAt - t1) < 2500 && Math.abs(games[1].startedAt - t2) < 2500, games.map((g) => ({ s: g.startedAt - t1, e: g.endedAt - g.startedAt })));
    check("...a ⭐ cue (\"/\" twice) stays a cue - no kind", own.length === 1 && !own[0].kind && own[0].endedAt > own[0].startedAt, own);

    // the cues page
    await rec.evaluate(() => document.getElementById("recordBtn").click());
    await sleep(1500);
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push("cues: " + e.message));
    await page.evaluateOnNewDocument(() => {
      window.__shared = []; window.__downloads = [];
      navigator.canShare = () => true;
      navigator.share = (d) => { window.__shared.push((d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size }))); return Promise.resolve(); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
    });
    await page.goto(BASE + "cues.html", { waitUntil: "networkidle2" });
    await sleep(1500);
    const look = await page.evaluate(() => {
      const bg = (el) => el ? getComputedStyle(el).backgroundColor : null;
      const g = document.querySelectorAll(".cv-tl .c.g"), c = document.querySelectorAll(".cv-tl .c:not(.g)");
      const rows = [...document.querySelectorAll(".cv-rows tr[data-id]")];
      const dot = (tr) => tr ? getComputedStyle(tr.querySelector("td.n"), "::before").backgroundColor : null;
      return { gameLines: g.length, cueBlocks: c.length, gameColour: bg(g[0]), cueColour: bg(c[0]), gameRows: rows.filter((r) => r.classList.contains("game")).length, gameDot: dot(rows.find((r) => r.classList.contains("game"))), cueDot: dot(rows.find((r) => !r.classList.contains("game"))), legend: (document.querySelector(".cv-legend") || {}).textContent || "" };
    });
    if (OUT) await page.screenshot({ path: path.join(OUT, "game_marks_cues_page.png") });
    check("the cues page: 2 blue game lines and the gold ⭐ cue on the timeline - different colours (" + look.gameColour + " / " + look.cueColour + ")", look.gameLines === 2 && look.cueBlocks === 1 && look.gameColour && look.cueColour && look.gameColour !== look.cueColour, look);
    check("...the rows: a blue dot for the game marks, gold for the cue; the legend says which is which", look.gameRows === 2 && look.gameDot && look.cueDot && look.gameDot !== look.cueDot && /your cues/.test(look.legend) && /game starts/.test(look.legend), look);
    await page.evaluate(() => document.querySelector(".cv-rows tr.game td.n").click());
    await sleep(800);
    const exp = await page.evaluate(() => document.querySelector('[data-a="export"]').disabled);
    const res = await fetch(BASE + "api/rec/cues/" + games[0].id + "/clip", { method: "POST" });
    check("...a game mark picked: no clip to export (the button off; the server: " + res.status + ")", exp === true && res.status === 400, { exp, status: res.status });
    // 🐢 slow motion: the ⭐ cue played at ½×, then "s" "s" -> ⅛×; "." a frame on
    await page.evaluate(() => document.querySelector(".cv-rows tr:not(.game) td.n").click());
    await sleep(1500);
    await page.evaluate(() => document.querySelector('.cv-speed button[data-speed="0.5"]').click());
    await sleep(300);
    const half = await page.evaluate(() => document.querySelector(".cv-video").playbackRate);
    await page.keyboard.press("s");
    await page.keyboard.press("s");
    await sleep(200);
    const eighth = await page.evaluate(() => ({ rate: document.querySelector(".cv-video").playbackRate, on: document.querySelector(".cv-speed button.on").textContent, label: document.querySelector(".cv-rate").textContent }));
    const tb = await page.evaluate(() => document.querySelector(".cv-video").currentTime);
    await page.keyboard.press(".");
    await sleep(300);
    const ta = await page.evaluate(() => ({ t: document.querySelector(".cv-video").currentTime, paused: document.querySelector(".cv-video").paused }));
    if (OUT) await page.screenshot({ path: path.join(OUT, "slow_motion_cues.png") });
    // 📁 today's folder
    const folderRow = () => page.evaluate(() => [...document.querySelectorAll(".cv-folder")].map((f) => ({ date: f.getAttribute("data-date"), text: f.textContent })));
    let rows = await folderRow();
    await page.evaluate(() => document.querySelector(".cv-folder .cv-folder-make").click());
    for (let i = 0; i < 30; i++) { await sleep(500); if ((await folderRow()).some((r) => /1 clip of 1/.test(r.text))) break; }
    rows = await folderRow();
    const made = fs.existsSync(ROOT) ? fs.readdirSync(ROOT).filter((n) => /^Pool Master Cues /.test(n)) : [];
    const clips = made.length ? fs.readdirSync(path.join(ROOT, made[0])).filter((f) => /\.mp4$/.test(f)) : [];
    if (OUT) await page.screenshot({ path: path.join(OUT, "cue_folders.png"), fullPage: true });
    check("📁 Daily cue folders: today's made now - \"" + made[0] + "\", " + clips.length + " clip (the ⭐ cue, not the game marks)", made.length === 1 && / Jo - Kim$/.test(made[0]) && clips.length === 1 && rows.length === 1 && /1 clip of 1 cue/.test(rows[0].text), { made, clips, rows });
    await page.evaluate(() => document.querySelector('.cv-folder button[data-del="folder"]').click());
    await sleep(200);
    const asks = await page.evaluate(() => document.querySelector('.cv-folder button[data-del="folder"]').textContent);
    await page.evaluate(() => document.querySelector('.cv-folder button[data-del="folder"]').click());
    await sleep(1200);
    rows = await folderRow();
    const trashed = fs.existsSync(path.join(__dirname, "tmphome", ".Trash")) ? fs.readdirSync(path.join(__dirname, "tmphome", ".Trash")).filter((n) => /^Pool Master Cues /.test(n)) : [];
    check("...🗑 Delete (\"" + asks + "\", then again): to the Trash; the row says so", asks === "Delete this folder?" && trashed.length === 1 && !fs.readdirSync(ROOT).some((n) => /^Pool Master Cues /.test(n)) && /deleted/.test(rows[0].text), { asks, trashed, rows });
    trashed.forEach((n) => fs.rmSync(path.join(__dirname, "tmphome", ".Trash", n), { recursive: true, force: true }));
    check("🐢 slow motion on the cue viewer: ½× (" + half + "), \"s\" \"s\" -> ⅛× (" + eighth.rate + ", \"" + eighth.label + "\"), \".\" a frame on (" + (ta.t - tb).toFixed(3) + " s, paused)", half === 0.5 && eighth.rate === 0.125 && eighth.on === "⅛×" && ta.paused && ta.t - tb > 0.02 && ta.t - tb < 0.08, { half, eighth, tb, ta });
    // ☑ together - the ⭐ cue checked
    await page.evaluate(() => { const box = document.querySelector(".cv-rows tr:not(.game) input.cv-pick"); box.click(); });
    await sleep(300);
    const g0 = await page.evaluate(() => ({ picked: document.querySelector(".cv-picked").textContent, disabled: [...document.querySelectorAll(".cv-group button")].map((b) => b.getAttribute("data-g") + ":" + b.disabled) }));
    await page.evaluate(() => document.querySelector('.cv-group [data-g="keep"]').click());
    for (let i = 0; i < 20; i++) { await sleep(500); if ((await cues()).some((c) => c.keep && c.clip)) break; }
    let keptCue = (await cues()).find((c) => c.keep);
    await sleep(1200);
    const pin = await page.evaluate(() => !!document.querySelector(".cv-rows tr:not(.game) .kept"));
    check("☑ the ⭐ cue checked (" + g0.picked + "); 📌 Save (keep forever): cut out (" + (keptCue && keptCue.clip) + ") and kept, 📌 on its row", g0.picked === "1 checked" && keptCue && keptCue.clip && fs.existsSync(path.join(ROOT, "Clips", keptCue.clip)) && pin, { g0, keptCue, pin });
    await page.evaluate(() => document.querySelector('.cv-group [data-g="share"]').click());
    await sleep(2000);
    const ready = await page.evaluate(() => document.querySelector('.cv-group [data-g="share"]').textContent);
    await page.evaluate(() => document.querySelector('.cv-group [data-g="share"]').click());
    await sleep(400);
    const shared = await page.evaluate(() => window.__shared);
    check("...📤 Share: \"" + ready + "\", then the share menu with its MP4", /Share now \(1\)/.test(ready) && shared.length === 1 && shared[0].length === 1 && shared[0][0].type === "video/mp4" && shared[0][0].size > 0, { ready, shared });
    await page.evaluate(() => { window.__downloads = []; document.querySelector('.cv-group [data-g="export"]').click(); });
    await sleep(1500);
    const dls = await page.evaluate(() => window.__downloads);
    check("...⬇ Export: downloaded (" + dls.join(", ") + ")", dls.length === 1 && dls[0] === keptCue.clip, dls);
    // the recording deleted: the kept cue stays
    await page.evaluate(() => { const b = document.querySelector('.cv-sess button.cv-del[data-del="session"]'); b.click(); });
    await sleep(200);
    await page.evaluate(() => { const b = document.querySelector('.cv-sess button.cv-del[data-del="session"]'); b.click(); });
    await sleep(1500);
    const afterRec = await cues();
    check("...the recording deleted: the kept cue stays (" + afterRec.map((c) => c.kind || (c.keep ? "kept" : "cue")).join(", ") + ")", afterRec.length === 1 && afterRec[0].keep, afterRec);
    await page.evaluate(() => { const box = document.querySelector(".cv-rows input.cv-pick"); if (box && !box.checked) box.click(); });
    await sleep(300);
    await page.evaluate(() => document.querySelector(".cv-group-del").click());
    await sleep(200);
    const groupAsk = await page.evaluate(() => document.querySelector(".cv-group-del").textContent);
    await page.evaluate(() => document.querySelector(".cv-group-del").click());
    await sleep(1500);
    check("...🗑 Delete: \"" + groupAsk + "\", then gone", /Delete 1 cue\?/.test(groupAsk) && (await cues()).length === 0, { groupAsk });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    fs.rmSync(ROOT, { recursive: true, force: true });
    // (what this test sent to the test HOME's Trash)
    const trash = path.join(__dirname, "tmphome", ".Trash");
    if (fs.existsSync(trash)) fs.readdirSync(trash).filter((n) => /^Pool Master C/.test(n)).forEach((n) => fs.rmSync(path.join(trash, n), { recursive: true, force: true }));
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
