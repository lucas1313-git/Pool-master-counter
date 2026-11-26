// 🏆 Winning shots (2026-11-12 request: "extract all the winning shots at the end of all games in
// the video ... a 30 seconds extract of these and call it winning shot [player] vs [player]-[game
// type]-[score] ... these links to another color"). Its own server (4309, a throwaway HOME), a
// finished recording of 3 minutes in two files, the scoreboard's games in this browser's storage -
// a race to 2, Luc v Bob: the first rack saved in the players' game logs (Luc, 40 s in), the other
// two still in the open session (Bob 100 s in - across the two files - and Luc 170 s in), and a
// game before the recording; a second recording with no game in it:
// a race to 4 begun before the recording (Luc 2 - 2 Bob), each rack kept with the race score:
// - 🏆 Winning shots on the recording: the three games, named with the race score and the time
//   (2026-11-16: "the winning shot names all say 1-0, use the race score ... I need to have the
//   time in the clips") "winning shot Luc vs Bob-8-Ball-3-2-<date>-<time>", "...Bob vs
//   Luc-8-Ball-3-3-...", "...Luc vs Bob-8-Ball-4-3-...", each cut into Clips/ under that name, 30 s
//   long (25 s before the win to 5 s after - Bob's, whose ball the camera saw go in at 82 s: 30 s
//   ending 2 s after that); the game before the recording not among them; the
//   first one already there under its old name ("...-8-Ball-1-0", its clip cut): named again, its
//   clip renamed with it, not made twice;
// - green: their rows' names and ⬇ links, their marks on the recording's timeline; the legend;
// - then the list is that day's winning shots, all of them, in the order won ("🏆 <day>: the day's 3
//   winning shots..."); ✕ Show every cue: every cue again (14 hand cues besides);
// - pressed again: nothing made twice ("already in the list ..., and in .../Clips"); one named with a
//   score since put right ("...-1-0-<time>" - a team race now counted per pair): named again, its
//   clip with it; one named by hand: kept;
// - the recording page's short list (compact): its newest 12 of 17 cues, "Show all 17" - none of
//   them a winning shot; 🏆 there: the day's 3 winning shots, all of them (2026-11-16, the user saw
//   only the last race's 5 of 31); ☑ All checks those 3;
// - 🎞 One video of the 3 winning shots and a cue of Luc's: one video in Highlights, 106 s, the four
//   in the order they happened, each with its caption - "Luc  3 – 2  Bob" / "8-Ball · Race to 4 ·
//   <time>", the cue "Luc  3 – 3  Bob" (the race as it stood then); after each winning shot its
//   score card, 3 s (2026-11-26: "in between every win, after the most recent one, a quick fade in
//   fade out of the score card ... when there is a race-to win, the transition could even be the
//   winning window") - the last one won the race to 4: the race-won screen's words, 5 s; a frame of
//   it and the cards in the screenshots;
// - its choices (2026-11-26: "i need to be able to have it or not as well as i want to decide if I
//   have the caption also the length of the fadein fade out"): score cards ☑, captions ☑, fade 0.4
//   s, on screen 3 s at first; captions off, fade 1, on screen 2: no caption pictures, cards of 2,
//   2 and 4 s, fade 1 - kept on this device; score cards off: their fade and time greyed, no card;
// - the Q-Scores on each card (2026-11-26: "I would like to see with a similar animation the
//   q-score of the winners going up", "on the left I want to see the q-score of the winner(s) and in
//   the right the q-score of the losers" - the app's rating): under each panel "Luc" "Rating", a
//   strip each - the old number over the new and the change ("412" / "420" "+8", "458" / "450"
//   "−8"); ☐ Ratings: none;
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
  // the camera's shots while it recorded (record.html keeps them - 2026-11-26: "when the ball goes in
  // + 2 seconds"): Bob's winning shot - down on it 70 s in, the ball in at 82 s, all still at 86 s
  // (the win entered at 100 s); none seen for the other two
  fs.writeFileSync(path.join(ROOT, id, "shots.json"), JSON.stringify([{ beganAt: s0 + 69000, aimAt: s0 + 70000, endedAt: s0 + 86000, shot: true, moved: 30, shooter: "", pockets: [s0 + 82000] }]));
  // ...and one 10 minutes earlier with no game in it
  const e0 = s0 - 1200000, emptyId = folderId(e0);
  fs.mkdirSync(path.join(ROOT, emptyId));
  fs.copyFileSync(path.join(ROOT, id, "part-001.mp4"), path.join(ROOT, emptyId, "part-001.mp4"));
  fs.writeFileSync(path.join(ROOT, emptyId, "session.json"), JSON.stringify({ id: emptyId, startedAt: e0, endedAt: e0 + 90000, mime: "video/mp4", ext: "mp4", parts: [{ n: 1, file: "part-001.mp4", startedAt: e0, endedAt: e0 + 90000 }] }));

  // the scoreboard's games: a race to 2, Luc v Bob
  const game = (at, w, l, o) => Object.assign({ ts: new Date(at).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", winnerNames: [w], opponentNames: [l], isTeam: false, raceTarget: 4, wonRace: false, scores: null }, o || {});
  const g1 = game(s0 + 40000, "Luc", "Bob", { raceTally: { Luc: 3, Bob: 2 } }), g2 = game(s0 + 100000, "Bob", "Luc", { raceTally: { Bob: 3, Luc: 3 } }), g3 = game(s0 + 170000, "Luc", "Bob", { wonRace: true, raceTally: { Luc: 4, Bob: 3 } });
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
  // 14 cues marked by hand near the end of the recording - newer than every winning shot (the
  // first one Luc's, against Bob)
  for (let i = 0; i < 14; i++) {
    await fetch(BASE + "api/rec/cues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ name: "hand " + (i + 1), startedAt: s0 + 150000 + i * 1000, endedAt: s0 + 155000 + i * 1000, session: id }, i ? {} : { player: "Luc", opponent: "Bob", gameLabel: "8-Ball", gameType: "8ball" })) });
  }
  // the first winning shot made before (its old name, the match's "1-0"), its clip cut
  const stamp = (t) => { const d = new Date(t); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + "-" + pad2(d.getHours()) + "h" + pad2(d.getMinutes()) + "m" + pad2(d.getSeconds()); };
  const g1at = Date.parse(g1.ts), oldName = "winning shot Luc vs Bob-8-Ball-1-0";
  const old = await (await fetch(BASE + "api/rec/cues", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "win", winAt: g1at, name: oldName, customName: true, startedAt: g1at - 25000, markedAt: g1at, endedAt: g1at + 5000, duration: 30000, player: "Luc", opponent: "Bob", matchup: "Luc v Bob", gameType: "8ball", gameLabel: "8-Ball", position: "1-0", source: "winning shot", session: id }) })).json();
  await fetch(BASE + "api/rec/cues/" + old.id + "/clip", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const oldClip = path.join(ROOT, "Clips", oldName + ".mp4"), hadOld = fs.existsSync(oldClip);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1200, height: 1000 } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push("cues: " + e.message));
    // (the captions' words, as drawn)
    await page.evaluateOnNewDocument(() => { window.__drawn = []; const f = CanvasRenderingContext2D.prototype.fillText; CanvasRenderingContext2D.prototype.fillText = function (t) { window.__drawn.push(String(t)); return f.apply(this, arguments); }; });
    await page.goto(BASE + "manifest.json");
    // (the Q-Scores: each game's point in the winner's and the loser's rating history)
    const ratings = {
      Luc: { name: "Luc", rating: 428, history: [{ ts: g1.ts, rating: 420, delta: 8, fromGame: true }, { ts: g2.ts, rating: 414.4, delta: -5.6, fromGame: true }, { ts: g3.ts, rating: 421.9, delta: 7.5, fromGame: true }] },
      Bob: { name: "Bob", rating: 449, history: [{ ts: g1.ts, rating: 450, delta: -8, fromGame: true }, { ts: g2.ts, rating: 455.6, delta: 5.6, fromGame: true }, { ts: g3.ts, rating: 448.1, delta: -7.5, fromGame: true }] }
    };
    await page.evaluate((st, ps, rt) => {
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [], gameHistory: st }));
      localStorage.setItem("poolMasterCounter.playerStats.v1", JSON.stringify(ps));
      localStorage.setItem("poolMasterCounter.ratings.v1", JSON.stringify(rt));
    }, [g3, g2], playerStats, ratings);
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
    check("🏆 pressed: \"" + said + "\"", /^🏆 1 winning shots named again, with the race score and the time\. 🏆 3 winning shots - green in the list, and in .*Clips\.$/.test(said), said);
    const cues = (await (await fetch(BASE + "api/rec/cues")).json()).cues.filter((c) => c.kind === "win").sort((a, b) => a.winAt - b.winAt);
    const wins = [g1, g2, g3].map((g) => Date.parse(g.ts));
    const want = ["winning shot Luc vs Bob-8-Ball-3-2-", "winning shot Bob vs Luc-8-Ball-3-3-", "winning shot Luc vs Bob-8-Ball-4-3-"].map((n, i) => n + stamp(wins[i]));
    check("three winning shots, with the race score and the time, the game before the recording not among them: " + cues.map((c) => c.name).join(" | "), JSON.stringify(cues.map((c) => c.name)) === JSON.stringify(want) && cues.map((c) => c.position).join(" ") === "3-2 3-3 4-3", cues);
    check("the one made before: named again (not made twice), its clip renamed with it", hadOld && cues[0].id === old.id && cues[0].clip === want[0] + ".mp4" && !fs.existsSync(oldClip) && fs.existsSync(path.join(ROOT, "Clips", want[0] + ".mp4")), { hadOld, first: cues[0], oldStill: fs.existsSync(oldClip) });
    check("each from 25 s before its win to 5 s after, in this recording - Bob's: 30 s ending 2 s after the camera saw its ball go in (82 s in)", cues.length === 3 && cues.every((c, i) => c.winAt === wins[i] && c.session === id && c.clip === want[i] + ".mp4" &&
      (i === 1 ? c.startedAt === s0 + 54000 && c.endedAt === s0 + 84000 && c.ballInAt === s0 + 82000 : c.startedAt === wins[i] - 25000 && c.endedAt === wins[i] + 5000)), cues);
    const lengths = want.map((n) => { const f = path.join(ROOT, "Clips", n + ".mp4"); return fs.existsSync(f) ? +execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim() : null; });
    check("cut into Clips/ under their names, 30 s each (" + lengths.map((x) => x && x.toFixed(1)).join(", ") + " s)", lengths.every((x) => x !== null && Math.abs(x - 30) <= 1.5), lengths);

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

    const listed = () => page.evaluate(() => ({ filter: document.querySelector(".cv-filter").hidden ? null : document.querySelector(".cv-filter span").textContent, rows: [...document.querySelectorAll(".cv-rows tr[data-id]")].map((r) => (r.classList.contains("win") ? "🏆 " : "") + r.querySelector("td.n").textContent) }));
    let shown = await listed();
    check("then the list: the day's winning shots, all of them, in the order won - \"" + shown.filter + "\"", /^🏆 .+: the day's 3 winning shots, in the order they were won\. ☑ All, then ⬇ Export, 📤 Share or 🎞 One video \(all of them in one, with captions\) takes them all\.$/.test(shown.filter || "") && JSON.stringify(shown.rows) === JSON.stringify(want.map((n) => "🏆 " + n)), shown);
    await page.evaluate(() => document.querySelector(".cv-filter button.cv-filter-off").click());
    await sleep(200);
    shown = await listed();
    check("✕ Show every cue: every cue again (" + shown.rows.length + ")", shown.filter === null && shown.rows.length === 17, shown);

    const again = await press(id);
    const count = (await (await fetch(BASE + "api/rec/cues")).json()).cues.filter((c) => c.kind === "win").length;
    check("pressed again: \"" + again + "\", still " + count, /^🏆 This recording's 3 winning shots are already in the list \(in green\), and in .+\/Clips\.$/.test(again) && count === 3, again);

    // one named with a score since put right ("...-1-0-<time>" - 2026-11-26, a team race now counted
    // per pair), one named by hand: the first named again, its clip with it; the other kept
    const patch = (c, body) => fetch(BASE + "api/rec/cues/" + c.id, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
    const wrongName = "winning shot Luc vs Bob-8-Ball-1-0-" + stamp(wins[2]);
    await patch(cues[2], { name: wrongName, position: "1-0", clipFollows: true });
    await patch(cues[1], { name: "Bob's great shot", position: "1-0", clipFollows: true });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1000);
    const fixedSaid = await press(id);
    const after = (await (await fetch(BASE + "api/rec/cues")).json()).cues.filter((c) => c.kind === "win").sort((a, b) => a.winAt - b.winAt);
    check("a winning shot named with a score since put right: named again (\"" + fixedSaid + "\") - " + after.map((c) => c.name + " [" + c.position + "]").join(" | ") + "; one named by hand kept",
      /^🏆 1 winning shots named again, with the race score and the time\. /.test(fixedSaid) && after[2].name === want[2] && after[2].position === "4-3" && fs.existsSync(path.join(ROOT, "Clips", want[2] + ".mp4")) && !fs.existsSync(path.join(ROOT, "Clips", wrongName + ".mp4")) && after[1].name === "Bob's great shot", { fixedSaid, after });
    await patch(cues[1], { name: want[1], position: "3-3", clipFollows: true });
    await press(id); // (the day's list again)

    // 🎞 One video: the 3 winning shots (☑ All on the day's list) and Luc's cue (hand 1)
    await page.evaluate(() => document.querySelector(".cv-pick-all").click());
    await page.evaluate(() => document.querySelector(".cv-filter button.cv-filter-off").click());
    await sleep(200);
    await page.evaluate(() => [...document.querySelectorAll(".cv-rows tr[data-id]")].find((r) => r.querySelector("td.n").textContent === "hand 1").querySelector("input.cv-pick").click());
    await sleep(200);
    const oneBtn = await page.evaluate(() => { const b = document.querySelector('.cv-group [data-g="one"]'); return { text: b.textContent, disabled: b.disabled, picked: document.querySelector(".cv-picked").textContent }; });
    check("☑ 4 checked, \"" + oneBtn.text + "\" there", oneBtn.text === "🎞 One video" && !oneBtn.disabled && oneBtn.picked === "4 checked", oneBtn);
    let reelBody = null;
    page.on("request", (r) => { if (/\/api\/rec\/reel$/.test(r.url())) reelBody = JSON.parse(r.postData()); });
    await page.evaluate(() => { window.__drawn = []; document.querySelector('.cv-group [data-g="one"]').click(); });
    let made = "";
    for (let i = 0; i < 480; i++) { made = await page.evaluate(() => document.querySelector(".cv-status").textContent); if (!/Making/.test(made)) break; await sleep(250); }
    const reelName = "Cues " + stamp(wins[0] - 25000).slice(0, 10) + " " + stamp(wins[0] - 25000).slice(11, 16) + "-" + stamp(s0 + 150000).slice(11, 16) + ".mp4";
    const reelFile = path.join(ROOT, "Highlights", reelName);
    const reelLen = fs.existsSync(reelFile) ? +execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", reelFile]).toString().trim() : null;
    check("🎞 \"" + made + "\" - " + reelName + ", " + (reelLen && reelLen.toFixed(1)) + " s (95 s of clips, 3 + 3 + 5 s of score cards)", /^🎞 One video: 4 clips, 1:46 - downloaded, and kept in .+Highlights \(.+\.mp4\)\.$/.test(made) && reelLen !== null && Math.abs(reelLen - 106) <= 3, { made, reelName, reelLen });
    const spans = reelBody ? reelBody.clips.map((c) => [c.from - s0, c.to - s0]) : null;
    check("the four in the order they happened, with the sound, each with its caption picture: " + JSON.stringify(spans), reelBody && reelBody.sound === true && JSON.stringify(spans) === JSON.stringify([[15000, 45000], [54000, 84000], [145000, 175000], [150000, 155000]].sort((a, b) => a[0] - b[0])) && reelBody.clips.every((c) => /^data:image\/png;base64,/.test(c.bug)), spans);
    const drawn = await page.evaluate(() => window.__drawn);
    const time = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    // (each card: "<winner> won!" on top, without the winner's number - it rolls in, old over new;
    // each side's Q-Score under its panel - its strip: the old number, the new and the change)
    const wantDrawn = ["Luc  3 – 2  Bob", "8-Ball · Race to 4 · " + time(wins[0]), "Luc won!", "8-Ball · Race to 4", "Luc", "Bob", "2", "Luc", "Rating", "Bob", "Rating", time(wins[0]), "412", "420", "+8", "458", "450", "−8", "2", "3",
      "Bob  3 – 3  Luc", "8-Ball · Race to 4 · " + time(wins[1]), "Bob won!", "8-Ball · Race to 4", "Bob", "Luc", "3", "Bob", "Rating", "Luc", "Rating", time(wins[1]), "450", "456", "+6", "420", "414", "−6", "2", "3",
      "Luc  4 – 3  Bob", "8-Ball · Race to 4 · " + time(wins[2]), "🎉🏆🎉", "Congratulations!", "Luc won the tournament with 4 wins! (race-to 4)", "8-Ball · Race to 4 wins", "Luc", "Bob", "3", "Luc", "Rating", "Bob", "Rating", time(wins[2]), "414", "422", "+8", "456", "448", "−8", "3", "4",
      "Luc  3 – 3  Bob", "8-Ball · Race to 4 · " + time(s0 + 150000)];
    check("the captions: who plays who, the race score, the game, the race to, the time; each winning shot's score card - the score after it, the race won: the race-won screen's words - " + JSON.stringify(drawn), JSON.stringify(drawn) === JSON.stringify(wantDrawn), { drawn, wantDrawn });
    const reelBodyFirst = reelBody;
    const cards = reelBody ? reelBody.clips.map((c) => (/^data:image\/png;base64,/.test(c.card || "") ? c.cardSecs : 0)) : null;
    check("a score card after each winning shot, 3 s - 5 s for the race won - none after the cue: " + JSON.stringify(cards) + ", " + (reelBody ? Math.round(JSON.stringify(reelBody).length / 1024) : "-") + " KB sent", JSON.stringify(cards) === JSON.stringify([3, 3, 5, 0]), cards);
    const rolls = reelBody ? reelBody.clips.map((c) => c.roll && /^data:image\/png;base64,/.test(c.roll.strip) && /^data:image\/png;base64,/.test(c.roll.flash) && [c.roll.x, c.roll.y, c.roll.w, c.roll.h].every((v) => v > 0)) : null;
    check("...each with its roll (the winner's old number into the new, its glow): " + JSON.stringify(rolls), JSON.stringify(rolls) === JSON.stringify([true, true, true, undefined]), rolls);
    const qrolls = reelBody ? reelBody.clips.map((c) => (c.qroll || []).filter((q) => /^data:image\/png;base64,/.test(q.strip) && [q.x, q.y, q.w, q.h].every((v) => v > 0)).length) : null;
    check("...and the Q-Scores rolling, the winner's and the loser's: " + JSON.stringify(qrolls), JSON.stringify(qrolls) === JSON.stringify([2, 2, 2, 0]), qrolls);
    if (OUT && reelLen) {
      execFileSync(FF, ["-v", "error", "-y", "-ss", "40", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_frame.png")]);
      // the cards in the video: the first's middle (30-33 s), the race won's (96-101 s)
      execFileSync(FF, ["-v", "error", "-y", "-ss", "31.8", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_card.png")]);
      // (rolling: 30 + 0.7 s in; just before, the old score; the Q-Score: 31.45-32.05 s)
      execFileSync(FF, ["-v", "error", "-y", "-ss", "30.55", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_card_old.png")]);
      execFileSync(FF, ["-v", "error", "-y", "-ss", "31.0", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_card_rolling.png")]);
      execFileSync(FF, ["-v", "error", "-y", "-ss", "31.4", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_card_landed.png")]);
      execFileSync(FF, ["-v", "error", "-y", "-ss", "31.75", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_card_q_rolling.png")]);
      execFileSync(FF, ["-v", "error", "-y", "-ss", "32.4", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_card_q_landed.png")]);
      execFileSync(FF, ["-v", "error", "-y", "-ss", "99", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_race_won.png")]);
      execFileSync(FF, ["-v", "error", "-y", "-ss", "33.1", "-i", reelFile, "-frames:v", "1", path.join(OUT, "one_video_after_card.png")]);
      reelBody.clips.forEach((c, i) => { if (c.card) fs.writeFileSync(path.join(OUT, "card_" + i + ".png"), Buffer.from(c.card.split(",")[1], "base64")); });
    }

    // its choices
    const opts = () => page.evaluate(() => {
      const r = document.querySelector(".cv-one-opts"), v = (c) => r.querySelector(c);
      return { cards: v(".cv-one-cards").checked, captions: v(".cv-one-captions").checked, q: v(".cv-one-q").checked, fade: v(".cv-one-fade").value, secs: v(".cv-one-secs").value, greyed: v(".cv-one-fade").disabled && v(".cv-one-secs").disabled && v(".cv-one-q").disabled, text: r.textContent.replace(/\s+/g, " ").trim(), kept: localStorage.getItem("pmc-one-video") };
    });
    const setOpts = (o) => page.evaluate((o) => {
      const r = document.querySelector(".cv-one-opts");
      if ("cards" in o) r.querySelector(".cv-one-cards").checked = o.cards;
      if ("captions" in o) r.querySelector(".cv-one-captions").checked = o.captions;
      if ("q" in o) r.querySelector(".cv-one-q").checked = o.q;
      if ("fade" in o) r.querySelector(".cv-one-fade").value = o.fade;
      if ("secs" in o) r.querySelector(".cv-one-secs").value = o.secs;
      r.querySelector(".cv-one-cards").dispatchEvent(new Event("change", { bubbles: true }));
    }, o);
    const oneAgain = async () => {
      reelBody = null;
      await page.evaluate(() => document.querySelector('.cv-group [data-g="one"]').click());
      for (let i = 0; i < 480; i++) { const t = await page.evaluate(() => document.querySelector(".cv-status").textContent); if (!/Making/.test(t) && reelBody) return t; await sleep(250); }
      return "";
    };
    let o = await opts();
    check("its choices, at first: \"" + o.text + "\" - score cards ☑, captions ☑, Q-Scores ☑, fade 0.4 s, on screen 3 s; the video made with fade " + (reelBodyFirst && reelBodyFirst.fade), o.cards && o.captions && o.q && o.fade === "0.4" && o.secs === "3" && !o.greyed && o.text.replace(/\s/g, "") === "🎞Onevideo:ScorecardsCaptionsRatingsFadesOnscreens" && reelBodyFirst && reelBodyFirst.fade === 0.4, { o, fade: reelBodyFirst && reelBodyFirst.fade });
    await setOpts({ captions: false, q: false, fade: "1", secs: "2" });
    let made2 = await oneAgain();
    o = await opts();
    const got2 = reelBody && { bugs: reelBody.clips.filter((c) => c.bug).length, q: reelBody.clips.filter((c) => c.qroll).length, cards: reelBody.clips.map((c) => (c.card ? c.cardSecs : 0)), fade: reelBody.fade };
    check("captions off, Q-Scores off, fade 1, on screen 2: no caption pictures, no Q-Score, cards of 2, 2 and 4 s (the race won: 2 s more), fade 1 - " + JSON.stringify(got2) + "; kept " + o.kept + "; \"" + made2 + "\"", got2 && got2.bugs === 0 && got2.q === 0 && JSON.stringify(got2.cards) === JSON.stringify([2, 2, 4, 0]) && got2.fade === 1 && JSON.stringify(JSON.parse(o.kept || "{}")) === JSON.stringify({ cards: true, captions: false, qscores: false, fade: 1, cardSecs: 2 }) && /^🎞 One video: 4 clips, 1:43 - /.test(made2), { got2, o, made2 });
    await setOpts({ cards: false });
    o = await opts();
    const made3 = await oneAgain();
    const got3 = reelBody && { bugs: reelBody.clips.filter((c) => c.bug).length, cards: reelBody.clips.filter((c) => c.card).length };
    check("score cards off: their fade and time greyed (" + o.greyed + "), no card, no caption - " + JSON.stringify(got3) + "; \"" + made3 + "\"", o.greyed && !o.cards && got3 && got3.bugs === 0 && got3.cards === 0 && /^🎞 One video: 4 clips, 1:35 - /.test(made3), { o, got3, made3 });
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(800);
    o = await opts();
    check("...still so after a reload: " + JSON.stringify({ cards: o.cards, captions: o.captions, q: o.q, fade: o.fade, secs: o.secs }), !o.cards && !o.captions && !o.q && o.fade === "1" && o.secs === "2" && o.greyed, o);

    // 🏆 the start and stop (2026-11-26, the user: "i want to be able to control how long before I
    // click on the winner score the winning cue will stop ... from the start that is [x] seconds
    // before till [x] seconds before the click")
    const winOpts = () => page.evaluate(() => {
      const r = document.querySelector(".cv-win-opts"), v = (c) => r.querySelector(c);
      return { from: v(".cv-win-from").value, to: v(".cv-win-to").value, when: v(".cv-win-when").value, ball: v(".cv-win-shot").checked, hand: v(".cv-win-hand").checked, text: r.textContent.replace(/\s+/g, " ").trim(), kept: localStorage.getItem("pmc-win-clip") };
    });
    const setWin = (o) => page.evaluate((o) => {
      const r = document.querySelector(".cv-win-opts");
      if ("from" in o) r.querySelector(".cv-win-from").value = o.from;
      if ("to" in o) r.querySelector(".cv-win-to").value = o.to;
      if ("when" in o) r.querySelector(".cv-win-when").value = o.when;
      if ("ball" in o) r.querySelector(o.ball ? ".cv-win-shot" : ".cv-win-hand").checked = true;
      r.querySelector(".cv-win-from").dispatchEvent(new Event("change", { bubbles: true }));
    }, o);
    const winCues = async () => (await (await fetch(BASE + "api/rec/cues")).json()).cues.filter((c) => c.kind === "win").sort((a, b) => a.winAt - b.winAt);
    const clipLen = (c) => { const f = c.clip && path.join(ROOT, "Clips", c.clip); return f && fs.existsSync(f) ? +execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString().trim() : null; };
    let w = await winOpts();
    check("🏆 its start and stop, above the recordings: \"" + w.text + "\" - 25 s before; stop: the last shot ◉ (by hand: 5 s after)", w.from === "25" && w.to === "5" && w.when === "after" && w.ball && !w.hand && w.text.replace(/\s/g, "") === "🏆Winningshots:StartsbeforeStop:📷2safterthelastshot(thecamera's)✋byhand:sbeforeafterthewinisentered", w);
    // the first moved by hand (its start 5 s later) - kept; start 30 s before, stop 5 s before
    await patch(cues[0], { startedAt: wins[0] - 20000, duration: 25000 });
    await setWin({ from: "30", to: "5", when: "before" });
    w = await winOpts();
    const recut = await press(id);
    let spanned = await winCues();
    const at = (c) => [c.startedAt - s0, c.endedAt - s0];
    check("start 30 s before, stop 5 s before (kept " + w.kept + "), 🏆 again: \"" + recut + "\" - " + JSON.stringify(spanned.map(at)) + ": the one moved by hand kept, Bob's 25 s ending 2 s after its ball (82 s in)",
      JSON.stringify(JSON.parse(w.kept || "{}")) === JSON.stringify({ from: 30, to: 5, after: false, ball: true }) && /^🏆 2 winning shots cut again, with the new start and stop\. 🏆 3 winning shots - green in the list, and in .+Clips\.$/.test(recut) &&
      JSON.stringify(spanned.map(at)) === JSON.stringify([[wins[0] - 20000 - s0, wins[0] + 5000 - s0], [59000, 84000], [wins[2] - 30000 - s0, wins[2] - 5000 - s0]]) && spanned[2].autoStart === spanned[2].startedAt && spanned[2].autoEnd === spanned[2].endedAt, { recut, spanned });
    let lens = spanned.map(clipLen);
    check("...their clips cut again: " + lens.map((x) => x && x.toFixed(1)).join(", ") + " s", lens[1] !== null && Math.abs(lens[1] - 25) <= 1.5 && lens[2] !== null && Math.abs(lens[2] - 25) <= 1.5 && spanned.every((c) => c.clip === c.name + ".mp4"), { lens, spanned });
    await setWin({ ball: false });
    const recut2 = await press(id);
    spanned = await winCues();
    lens = spanned.map(clipLen);
    check("✋ by hand, not the last shot: \"" + recut2 + "\" - Bob's from 30 s before its win to 5 s before (" + JSON.stringify(at(spanned[1])) + ", " + (lens[1] && lens[1].toFixed(1)) + " s)",
      /^🏆 1 winning shots cut again, with the new start and stop\. /.test(recut2) && JSON.stringify(at(spanned[1])) === JSON.stringify([wins[1] - 30000 - s0, wins[1] - 5000 - s0]) && !spanned[1].ballInAt && lens[1] !== null && Math.abs(lens[1] - 25) <= 1.5, { recut2, spanned, lens });
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(800);
    w = await winOpts();
    check("...still so after a reload: " + JSON.stringify({ from: w.from, to: w.to, when: w.when, ball: w.ball }), w.from === "30" && w.to === "5" && w.when === "before" && !w.ball && w.hand, w);
    const recut3 = await press(id);
    check("🏆 again, nothing changed: \"" + recut3 + "\"", /^🏆 This recording's 3 winning shots are already in the list/.test(recut3), recut3);

    const none = await press(emptyId);
    check("the recording with no game: \"" + none + "\"", none === "🏆 No game was won on this computer's scoreboard while this recording ran.", none);

    // the recording page's short list (compact): its own viewer, beside
    await page.evaluate(() => { const box = document.createElement("div"); box.id = "compact-box"; document.body.appendChild(box); window.PMCCueViewer.mount(box, { compact: true, sessions: true }); });
    await sleep(1500);
    const compactLook = () => page.evaluate(() => {
      const box = document.getElementById("compact-box");
      return {
        rows: [...box.querySelectorAll(".cv-rows tr[data-id]")].map((r) => (r.classList.contains("win") ? "🏆 " : "") + r.querySelector("td.n").textContent),
        more: box.querySelector(".cv-rows tr.more") && box.querySelector(".cv-rows tr.more").textContent,
        filter: box.querySelector(".cv-filter").hidden ? null : box.querySelector(".cv-filter span").textContent,
        status: box.querySelector(".cv-status").textContent, picked: box.querySelector(".cv-picked").textContent
      };
    });
    let small = await compactLook();
    check("the recording page's short list: the newest 12 of 17, \"" + small.more + "\" - no winning shot among them", small.rows.length === 12 && small.rows.every((r) => !/^🏆/.test(r)) && small.more === "The newest 12 of 17 cues. Show all 17", small);
    await page.evaluate((sid) => [...document.querySelectorAll("#compact-box .cv-session")].find((x) => x.textContent.indexOf(sid) !== -1).querySelector(".cv-wins").click(), id);
    for (let i = 0; i < 40; i++) { small = await compactLook(); if (/already/.test(small.status)) break; await sleep(250); }
    check("🏆 there: the day's 3 winning shots, all of them, the oldest first", /already in the list/.test(small.status) && JSON.stringify(small.rows) === JSON.stringify(want.map((n) => "🏆 " + n)) && !small.more && /the day's 3 winning shots/.test(small.filter || ""), small);
    await page.evaluate(() => document.querySelector("#compact-box .cv-pick-all").click());
    await sleep(200);
    small = await compactLook();
    check("☑ All checks those 3: \"" + small.picked + "\"", small.picked === "3 checked", small);

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
