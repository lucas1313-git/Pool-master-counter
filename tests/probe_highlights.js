// ✨ Tonight's highlights through the Mac's recorder (P35): the real server (HOME=tests/tmphome,
// port 4235 - see tests/README); tonight's recording put in its folder (30 s of test picture and
// a tone), four cues (Kim v Jo x3, Kim v Lee), the night's games on the board (a race won, a rack
// won with a break-and-run tag), Kim and Jo said yes, Lee didn't:
// - ☰ › ✨ Tonight's highlights: everyone on tonight's cues, Kim and Jo ticked; three clips picked
//   (the race, the break-and-run, the rack), Lee's cue left out and named;
// - 9:16, 🎬 Make the reel: made on the Mac (POST /api/rec/reel) - a 1080 x 1920 MP4 with no sound,
//   about as long as the three clips; it plays in the sheet; 📤 Share hands the file over;
// - Lee says yes: four clips;
// - no page errors.
// usage: node tests/probe_highlights.js http://localhost:4235/ [screenshot dir]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2] || "http://localhost:4235/";
const OUT = process.argv[3];
const TMPHOME = path.join(__dirname, "tmphome");
const FF = "/opt/homebrew/bin/";
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, "0");

(async () => {
  if (/:(4173|4174)\//.test(BASE)) { console.log("FAIL never the real server"); process.exit(1); }
  // tonight's recording, in the test server's folder
  const root = path.join(TMPHOME, "Movies", "Pool Master Counter");
  fs.rmSync(root, { recursive: true, force: true });
  const t0 = Date.now() - 120000;
  const d = new Date(t0), id = d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + "h" + pad2(d.getMinutes());
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(FF + "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=30:size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:v", "libx264", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, "part-001.mp4")]);
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ id, startedAt: t0, endedAt: t0 + 30000, mime: "video/mp4", ext: "mp4", parts: [{ n: 1, file: "part-001.mp4", startedAt: t0, endedAt: t0 + 30000 }] }));
  const cue = (n, a, b, player, opponent) => ({ id: "c" + n, name: "Cue " + n, session: id, startedAt: t0 + a * 1000, endedAt: t0 + b * 1000, player, opponent, source: "button", createdAt: new Date().toISOString() });
  fs.writeFileSync(path.join(root, "cues.json"), JSON.stringify([cue(1, 1, 5, "Kim", "Jo"), cue(2, 8, 12, "Jo", "Kim"), cue(3, 15, 19, "Kim", "Lee"), cue(4, 22, 27, "Kim", "Jo")]));
  const games = [
    { ts: new Date(t0 + 6000).toISOString(), gameType: "9ball", gameLabel: "9-Ball", winnerNames: ["Kim"], opponentNames: ["Jo"], wonRace: false, raceTally: { Kim: 1, Jo: 0 } },
    { ts: new Date(t0 + 13000).toISOString(), gameType: "9ball", gameLabel: "9-Ball", winnerNames: ["Jo"], opponentNames: ["Kim"], tags: ["breakAndRun"], raceTally: { Jo: 1, Kim: 1 } },
    { ts: new Date(t0 + 20000).toISOString(), gameType: "9ball", gameLabel: "9-Ball", winnerNames: ["Kim"], opponentNames: ["Lee"], raceTally: { Kim: 1, Lee: 0 } },
    { ts: new Date(t0 + 28000).toISOString(), gameType: "9ball", gameLabel: "9-Ball", winnerNames: ["Kim"], opponentNames: ["Jo"], wonRace: true, raceTally: { Kim: 2, Jo: 1 } }
  ];

  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 900 } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__shared = [];
      navigator.canShare = () => true;
      navigator.share = (data) => { window.__shared.push((data.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size }))); return Promise.resolve(); };
    });
    await page.goto(BASE + "manifest.json");
    await page.evaluate((games) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      localStorage.setItem("poolMasterCounter.contacts.v1", JSON.stringify({ Kim: { email: "", highlightsOk: true }, Jo: { email: "", highlightsOk: true }, Lee: { email: "" } }));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "a", name: "Kim", playing: true, balls: 0 }, { id: "b", name: "Jo", playing: true, balls: 0 }, { id: "c", name: "Lee", playing: false, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: games.slice().reverse(), currentGame: { gameType: "9ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 2, rotation: { enabled: false, order: [], every: 1 } }));
    }, games);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
    await page.click("#btn-board-menu");
    await sleep(250);
    await page.evaluate(() => [...document.querySelectorAll("#board-menu-list .board-menu-row")].find((b) => b.dataset.menuKey === "menu.highlights").click());
    await page.waitForFunction(() => document.getElementById("btn-highlights-build") || /Nothing recorded/.test(document.getElementById("highlights-body").textContent), { timeout: 8000 });
    const sheet = () => page.evaluate(() => ({
      people: [...document.querySelectorAll(".highlights-ok input")].map((b) => b.getAttribute("data-name") + (b.checked ? "+" : "-")),
      picks: [...document.querySelectorAll("#highlights-picks li")].map((li) => li.textContent),
      leftOut: (document.querySelector(".highlights-left-out") || {}).textContent || "",
      text: document.getElementById("highlights-body").textContent.slice(0, 400)
    }));
    let s = await sheet();
    check("✨ Tonight's highlights: everyone on tonight's cues - Kim and Jo said yes, Lee didn't (" + s.people.join(" ") + ")", s.people.join() === "Jo+,Kim+,Lee-", s);
    check("...three clips: the rack, the break-and-run, the race - Lee's cue left out and named", s.picks.length === 3 && /Kim  1 – 0  Jo/.test(s.picks[0]) && /Break & run/.test(s.picks[1]) && /wins the race/.test(s.picks[2]) && /Lee/.test(s.leftOut), s);
    await page.evaluate(() => document.querySelector('input[name="highlights-aspect"][value="9:16"]').click());
    await sleep(200);
    if (OUT) await page.screenshot({ path: path.join(OUT, "highlights_sheet.png") });
    await page.click("#btn-highlights-build");
    await page.waitForFunction(() => window.PMCHighlightsDebug || /couldn't/.test(document.getElementById("highlights-status").textContent), { timeout: 60000 });
    const made = await page.evaluate(() => ({ status: document.getElementById("highlights-status").textContent, file: window.PMCHighlightsDebug && { name: window.PMCHighlightsDebug.file.name, type: window.PMCHighlightsDebug.file.type, size: window.PMCHighlightsDebug.file.size, where: window.PMCHighlightsDebug.where } }));
    const reels = fs.existsSync(path.join(root, "Highlights")) ? fs.readdirSync(path.join(root, "Highlights")) : [];
    let info = null;
    if (reels.length) info = JSON.parse(execFileSync(FF + "ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", path.join(root, "Highlights", reels[0])]).toString());
    const v = info && info.streams.find((x) => x.codec_type === "video");
    // (a frame of it, with its score bug, for the screenshots)
    if (OUT && reels.length) execFileSync(FF + "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", "11", "-i", path.join(root, "Highlights", reels[0]), "-frames:v", "1", "-vf", "scale=540:-2", path.join(OUT, "highlights_reel_frame.png")]);
    check("🎬 Make the reel, 9:16: made on the Mac - " + (v ? v.width + " x " + v.height : "-") + ", " + (info ? Number(info.format.duration).toFixed(1) : "-") + " s, no sound (" + made.status + ")", made.file && made.file.where === "server" && made.file.type === "video/mp4" && made.file.size > 10000 && v && v.width === 1080 && v.height === 1920 && Math.abs(Number(info.format.duration) - 13) < 1.5 && !info.streams.some((x) => x.codec_type === "audio"), { made, reels, info });
    await page.waitForFunction(() => { const vid = document.getElementById("highlights-video"); return vid && vid.readyState >= 1 && vid.duration > 5; }, { timeout: 10000 }).catch(() => {});
    const plays = await page.evaluate(() => { const vid = document.getElementById("highlights-video"); return vid ? { w: vid.videoWidth, h: vid.videoHeight, d: vid.duration } : null; });
    if (OUT) await page.screenshot({ path: path.join(OUT, "highlights_made.png") });
    check("...it plays in the sheet (" + (plays ? plays.w + " x " + plays.h + ", " + (plays.d || 0).toFixed(1) + " s" : "-") + ")", plays && plays.w === 1080 && plays.h === 1920 && plays.d > 10, plays);
    await page.click("#btn-highlights-share");
    await sleep(300);
    const shared = await page.evaluate(() => window.__shared);
    check("...📤 Share hands the file over (" + JSON.stringify(shared[0] || []) + ")", shared.length === 1 && shared[0][0].type === "video/mp4" && shared[0][0].size === made.file.size, shared);
    await page.evaluate(() => [...document.querySelectorAll(".highlights-ok input")].find((b) => b.getAttribute("data-name") === "Lee").click());
    await sleep(300);
    s = await sheet();
    check("Lee says yes: four clips", s.picks.length === 4 && !s.leftOut, s);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.contacts.v1")).Lee.highlightsOk);
    check("...kept with Lee's contact (backups have it)", stored === true, stored);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
