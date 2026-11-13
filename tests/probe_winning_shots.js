// 🏆 Winning shots (2026-11-12 request: "extract all the winning shots at the end of all games in
// the video ... a 30 seconds extract of these and call it winning shot [player] vs [player]-[game
// type]-[score] ... these links to another color"). Its own server (4309, a throwaway HOME), a
// finished recording of 3 minutes in two files, the scoreboard's games in this browser's storage -
// a race to 2, Luc v Bob: the first rack saved in the players' game logs (Luc, 40 s in), the other
// two still in the open session (Bob 100 s in - across the two files - and Luc 170 s in), and a
// game before the recording; a second recording with no game in it:
// - 🏆 Winning shots on the recording: the three games, named "winning shot Luc vs Bob-8-Ball-1-0",
//   "winning shot Bob vs Luc-8-Ball-1-1", "winning shot Luc vs Bob-8-Ball-2-1", each cut into
//   Clips/ under that name, 30 s long (25 s before the win to 5 s after); the game before the
//   recording not among them;
// - green: their rows' names and ⬇ links, their marks on the recording's timeline; the legend;
// - pressed again: nothing made twice ("already in the list");
// - the recording with no game: "No game was won...";
// - record.html loads it too; no page errors.
// usage: node tests/probe_winning_shots.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 4309, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
const FF = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((f) => fs.existsSync(f));
const FFPROBE = FF && FF.replace(/ffmpeg$/, "ffprobe");
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, "0");
const folderId = (t) => { const d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + pad2(d.getHours()) + "h" + pad2(d.getMinutes()); };
const GREEN = "rgb(79, 209, 139)";

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-winning-shots-"));
  const HOME = path.join(TMP, "home"), ROOT = path.join(HOME, "Movies", "Pool Master Counter");
  fs.mkdirSync(ROOT, { recursive: true });
  // a recording of 3 minutes, an hour ago (on a whole second - the games' times are kept to the second): two files of 90 s
  const s0 = Math.floor((Date.now() - 3600000) / 60000) * 60000, id = folderId(s0);
  fs.mkdirSync(path.join(ROOT, id));
  const parts = [];
  for (let n = 1; n <= 2; n++) {
    const file = "part-00" + n + ".mp4";
    execFileSync(FF, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=90:size=160x120:rate=10", "-c:v", "libx264", "-g", "10", "-pix_fmt", "yuv420p", path.join(ROOT, id, file)]);
    parts.push({ n, file, startedAt: s0 + (n - 1) * 90000, endedAt: s0 + n * 90000 });
  }
  fs.writeFileSync(path.join(ROOT, id, "session.json"), JSON.stringify({ id, startedAt: s0, endedAt: s0 + 180000, mime: "video/mp4", ext: "mp4", parts }));
  // ...and one 10 minutes earlier with no game in it
  const e0 = s0 - 1200000, emptyId = folderId(e0);
  fs.mkdirSync(path.join(ROOT, emptyId));
  fs.copyFileSync(path.join(ROOT, id, "part-001.mp4"), path.join(ROOT, emptyId, "part-001.mp4"));
  fs.writeFileSync(path.join(ROOT, emptyId, "session.json"), JSON.stringify({ id: emptyId, startedAt: e0, endedAt: e0 + 90000, mime: "video/mp4", ext: "mp4", parts: [{ n: 1, file: "part-001.mp4", startedAt: e0, endedAt: e0 + 90000 }] }));

  // the scoreboard's games: a race to 2, Luc v Bob
  const game = (at, w, l, o) => Object.assign({ ts: new Date(at).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: [w], opponentNames: [l], isTeam: false, raceTarget: 2, wonRace: false, scores: null }, o || {});
  const g1 = game(s0 + 40000, "Luc", "Bob"), g2 = game(s0 + 100000, "Bob", "Luc"), g3 = game(s0 + 170000, "Luc", "Bob", { wonRace: true });
  const before = game(s0 - 600000, "Kim", "Jo", { gameLabel: "9-Ball", gameType: "9ball", raceTarget: 1 });
  // (the first rack and the game before: in the players' saved game logs - each player's own copy)
  const copy = (g, me) => Object.assign({}, g, { result: g.winnerNames[0] === me ? "won" : "lost", opponentNames: g.winnerNames[0] === me ? g.opponentNames : g.winnerNames, teammateNames: [] });
  const day = new Date(s0).toISOString().slice(0, 10);
  const playerStats = {
    Luc: { sessions: [{ date: day, games: [copy(g1, "Luc")] }] }, Bob: { sessions: [{ date: day, games: [copy(g1, "Bob")] }] },
    Kim: { sessions: [{ date: day, games: [copy(before, "Kim")] }] }, Jo: { sessions: [{ date: day, games: [copy(before, "Jo")] }] }
  };
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], { env: Object.assign({}, process.env, { HOME, PORT: String(PORT) }), stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + "manifest.json")).ok) break; } catch (e) {} await sleep(250); }
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1200, height: 1000 } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push("cues: " + e.message));
    await page.goto(BASE + "manifest.json");
    await page.evaluate((st, ps) => {
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [], gameHistory: st }));
      localStorage.setItem("poolMasterCounter.playerStats.v1", JSON.stringify(ps));
    }, [g3, g2], playerStats);
    await page.goto(BASE + "cues.html", { waitUntil: "networkidle2" });
    await sleep(1200);
    const press = async (sid) => {
      await page.evaluate((sid) => [...document.querySelectorAll(".cv-session")].find((x) => x.textContent.indexOf(sid) !== -1).querySelector(".cv-wins").click(), sid);
      for (let i = 0; i < 120; i++) {
        const st = await page.evaluate(() => ({ text: document.querySelector(".cv-status").textContent, busy: !!document.querySelector(".cv-wins:disabled") }));
        if (!st.busy && !/Looking|Cutting/.test(st.text)) return st.text;
        await sleep(250);
      }
      return "(still busy)";
    };
    const button = await page.evaluate((sid) => { const b = [...document.querySelectorAll(".cv-session")].find((x) => x.textContent.indexOf(sid) !== -1).querySelector(".cv-wins"); return b && { text: b.textContent, title: b.title, color: getComputedStyle(b).color }; }, id);
    check("the recording has \"" + (button && button.text) + "\" (green)", button && button.text === "🏆 Winning shots" && /winning shot \[player\] vs \[player\]-\[game\]-\[score\]/.test(button.title) && button.color === GREEN, button);

    const said = await press(id);
    check("🏆 pressed: \"" + said + "\"", /^🏆 3 winning shots, 30 s each - green in the list, and in .*Clips\.$/.test(said), said);
    const cues = (await (await fetch(BASE + "api/rec/cues")).json()).cues.filter((c) => c.kind === "win").sort((a, b) => a.winAt - b.winAt);
    const want = ["winning shot Luc vs Bob-8-Ball-1-0", "winning shot Bob vs Luc-8-Ball-1-1", "winning shot Luc vs Bob-8-Ball-2-1"];
    check("three winning shots, the game before the recording not among them: " + cues.map((c) => c.name).join(" | "), JSON.stringify(cues.map((c) => c.name)) === JSON.stringify(want), cues);
    const wins = [g1, g2, g3].map((g) => Date.parse(g.ts));
    check("each from 25 s before its win to 5 s after, in this recording", cues.length === 3 && cues.every((c, i) => c.winAt === wins[i] && c.startedAt === wins[i] - 25000 && c.endedAt === wins[i] + 5000 && c.session === id && c.clip === want[i] + ".mp4"), cues);
    const lengths = want.map((n) => { const f = path.join(ROOT, "Clips", n + ".mp4"); return fs.existsSync(f) ? +execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim() : null; });
    check("cut into Clips/ under their names, 30 s each (" + lengths.map((x) => x && x.toFixed(1)).join(", ") + " s - the second across the two files)", lengths.every((x) => x !== null && Math.abs(x - 30) <= 1.5), lengths);

    await sleep(300);
    const look = await page.evaluate((sid) => {
      const rows = [...document.querySelectorAll(".cv-rows tr.win")];
      const row = [...document.querySelectorAll(".cv-session")].find((x) => x.textContent.indexOf(sid) !== -1);
      return {
        rows: rows.map((r) => ({ name: r.querySelector("td.n").textContent, color: getComputedStyle(r.querySelector("td.n")).color, dot: getComputedStyle(r.querySelector("td.n"), "::before").backgroundColor, link: r.querySelector("a.cv-btn") && getComputedStyle(r.querySelector("a.cv-btn")).color })),
        marks: [...row.querySelectorAll(".cv-tl .c.w")].map((m) => getComputedStyle(m).backgroundColor),
        legend: document.querySelector(".cv-legend").textContent, info: document.querySelector(".cv-info").textContent
      };
    }, id);
    if (OUT) await page.screenshot({ path: path.join(OUT, "winning_shots.png"), fullPage: true });
    check("green: the three rows' names, dots and ⬇ links, their marks on the timeline; \"" + look.legend + "\"", look.rows.length === 3 && look.rows.every((r) => r.color === GREEN && r.dot === GREEN && r.link === GREEN) && look.marks.length === 3 && look.marks.every((c) => c === GREEN) && /🏆 winning shots/.test(look.legend) && /🏆 3/.test(look.info), look);

    const again = await press(id);
    const count = (await (await fetch(BASE + "api/rec/cues")).json()).cues.filter((c) => c.kind === "win").length;
    check("pressed again: \"" + again + "\", still " + count, again === "🏆 This recording's 3 winning shots are already in the list (in green)." && count === 3, again);

    const none = await press(emptyId);
    check("the recording with no game: \"" + none + "\"", none === "🏆 No game was won on this computer's scoreboard while this recording ran.", none);

    const rec = await (await fetch(BASE + "record.html")).text();
    check("record.html loads it too", /js\/lib\/night-timeline\.js/.test(rec) && /js\/lib\/winning-shots\.js/.test(rec) && /js\/big-store\.js/.test(rec) && rec.indexOf("winning-shots.js") < rec.indexOf("cue-viewer.js"));
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    server.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
