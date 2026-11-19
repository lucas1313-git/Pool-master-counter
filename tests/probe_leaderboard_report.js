// The Leaderboard's 📤 player report (2026-11-19, the user: "for every player in the leaderboard, I
// would like to be able to share their position as a report that would explain in details and easy
// language what put them in that position and what they could do to ascend up the rating, also in
// shorter what could be jeoparding their position ... a exportable document that I could share with
// a share button associated with the players"), at 1180x820:
// - Host won 25 races to 7 with Bob (5 lost), Star 3 with Bob (7–2), Few 6 of 10 games with Bob;
// - every row has 📤; on Host (#1): the preview - title, position, "In short" (46-ish points ahead,
//   the biggest part: races and tournaments won), the MVP parts biggest first, "Why Host is ahead of
//   Star (#2)", "👑 How Host stays on top" with what a game won / lost / a race is worth, the tip,
//   "⚠️ What could cost Host the #1 spot" (Star's quickest way past, losses in a row);
// - 📤 Share as PDF: the share sheet (stubbed) gets "Host - leaderboard report <today>.pdf",
//   application/pdf, a PDF whose objects are where its xref says and that macOS (sips) opens;
// - Star (#2): why Host is ahead, why Star is ahead of Bob, how to climb (Win N races to 7);
// - Few (last): "Nobody is ranked below Few"; Bob over Few: "a better win rate once the extra games
//   are counted (…% vs 30.0%)" - Few's plain 60% is higher - and no "+0.0 pts" line;
// - Last 30 Days, 📈 Performance: the method's idea, a game won/lost "against a player rated
//   around", and "This board only counts the games in its period";
// - 🌙 Best 3 nights: "A bad night can't cost";
// - no share sheet: the PDF saved, "📄 PDF saved to Downloads.";
// - in French: "📤 Partager en PDF", "En bref";
// - no page errors.
// Its own file server on 4318; the PDFs in [out dir] when given.
// usage: node tests/probe_leaderboard_report.js [out dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4318, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1600) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the game logs: races to 7 (each one's last rack marked wonRace, as the scoreboard does), from 20
// days ago, a rack every 10 minutes; Few's 10 plain games 3 days ago
function logs() {
  const out = {};
  const now = new Date();
  let t = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 20, 20, 0).getTime();
  const add = (name, ts, won, opp, extra) => {
    const d = new Date(ts);
    const day = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const log = (out[name] = out[name] || { name, sessions: [] });
    let s = log.sessions.find((x) => x.date === day);
    if (!s) log.sessions.push((s = { date: day, wins: 0, gamesWon: [], opponents: [], games: [] }));
    s.games.push(Object.assign({ ts: new Date(ts).toISOString(), gameType: "8ball", gameLabel: "8-Ball", target: 1, unit: "rack", result: won ? "won" : "lost", winnerNames: [won ? name : opp], opponentNames: [opp], teammateNames: [], isTeam: false }, extra));
    if (won) s.wins += 1;
  };
  const race = (a, b, aWins, bWins) => {
    const racks = [];
    for (let i = 0; i < bWins; i++) racks.push(false);
    for (let i = 0; i < aWins; i++) racks.push(true);
    if (aWins < bWins) racks.reverse();
    racks.forEach((aWon, i) => {
      t += 600000;
      const extra = i === racks.length - 1 ? { raceTarget: 7, wonRace: true } : { raceTarget: 7 };
      add(a, t, aWon, b, extra);
      add(b, t, !aWon, a, extra);
    });
    // (a race a night)
    t += 86400000 / 2;
  };
  for (let i = 0; i < 30; i++) i < 25 ? race("Host", "Bob", 7, 4) : race("Host", "Bob", 4, 7);
  for (let i = 0; i < 3; i++) race("Star", "Bob", 7, 2);
  let f = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3, 20, 0).getTime();
  for (let i = 0; i < 10; i++) {
    f += 600000;
    add("Few", f, i < 6, "Bob", {});
    add("Bob", f, i >= 6, "Few", {});
  }
  return out;
}

(async () => {
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, BASE).pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(PORT, ok));
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new" });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewport({ width: 1180, height: 820 });
  // (the share sheet stubbed - unless __noShare: then none, as on a desktop browser without one)
  await page.evaluateOnNewDocument(() => {
    if (localStorage.getItem("__noShare")) {
      navigator.canShare = undefined;
      navigator.share = undefined;
      return;
    }
    navigator.canShare = (d) => !!(d && d.files);
    navigator.share = (data) => { window.__shared = data; return Promise.resolve(); };
  });
  try {
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await page.evaluate((logs) => {
      localStorage.clear();
      ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
      localStorage.setItem("poolMasterCounter.playerStats.v1", JSON.stringify(logs));
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({
        players: ["Host", "Star", "Bob", "Few"].map((n) => ({ id: n.toLowerCase(), name: n, playing: n === "Host" || n === "Bob", balls: 0 })),
        playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0,
        currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 7, rotation: { enabled: false, order: [], every: 1 }
      }));
    }, logs());
    const openBoard = async () => {
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await sleep(900);
      await page.evaluate(() => document.getElementById("btn-open-leaderboard").click());
      await sleep(700);
    };
    const period = async (p) => { await page.evaluate((p) => [...document.querySelectorAll("#leaderboard-period-filter .period-btn")].find((b) => b.dataset.period === p).click(), p); await sleep(900); };
    const pick = async (m) => { await page.evaluate((m) => document.querySelector('.leaderboard-method-btn[data-method="' + m + '"]').click(), m); await sleep(800); };
    const names = () => page.evaluate(() => [...document.querySelectorAll("#leaderboard-list li")].map((li) => li.querySelector(".leaderboard-name-btn").firstChild.textContent.trim()));
    // 📤 on a row: the preview's text and button; share: what the share sheet got ({name, type,
    // title, bytes}) or, with none, the toast
    const report = async (name, share) => {
      await page.evaluate((name) => [...document.querySelectorAll("#leaderboard-list li")].find((li) => li.querySelector(".leaderboard-name-btn").firstChild.textContent.trim() === name).querySelector(".leaderboard-report-btn").click(), name);
      await sleep(400);
      const r = await page.evaluate(() => ({ text: document.getElementById("confirm-modal-message").innerText, button: document.getElementById("btn-confirm-modal-extra").textContent }));
      if (share) {
        await page.evaluate(() => { window.__shared = null; document.getElementById("btn-confirm-modal-extra").click(); });
        await sleep(1200);
        r.shared = await page.evaluate(() => new Promise((ok) => {
          const s = window.__shared;
          if (!s) return ok(null);
          const f = s.files[0];
          const fr = new FileReader();
          fr.onload = () => ok({ name: f.name, type: f.type, title: s.title, b64: fr.result.split(",")[1] });
          fr.readAsDataURL(f);
        }));
        r.toast = await page.evaluate(() => (document.getElementById("page-toast") || {}).textContent || "");
      } else {
        await page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click());
        await sleep(250);
      }
      return r;
    };
    const today = (() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })();

    await openBoard();
    await period("all");
    const order = await names();
    const buttons = await page.evaluate(() => [...document.querySelectorAll("#leaderboard-list li")].map((li) => !!li.querySelector(".leaderboard-report-btn")));
    check("every row has 📤 (" + order.join(", ") + ")", order.join() === "Host,Star,Bob,Few" && buttons.every(Boolean), { order, buttons });

    // ---- Host, #1 ----
    let r = await report("Host", true);
    const t = r.text;
    const sec = (re) => re.test(t);
    check("Host's report: title, position, In short (the gap, the biggest part) - " + JSON.stringify(t.slice(0, 330)),
      /^🥇 Host\n#1 of 4 · ⭐ MVP score: [\d.]+\nPlayers leaderboard · All Time · /.test(t) && sec(/\nIn short\nHost is #1 of 4, [\d.]+ points ahead of Star\.\nThe biggest part of Host's score is races and tournaments won: 75\.0 of the [\d.]+ points\.\n/), t);
    check("...what put Host there: the MVP parts biggest first, results by opponent, why ahead of Star",
      sec(/\n📋 What put Host at #1\nThe ⭐ MVP score is several parts added up\. Here is what each one gave, biggest first:\n• Races and tournaments won: 25, at 3 points each = 75\.0\. A race won on the scoreboard counts here too\.\n• Games won: \d+ of \d+ = [\d.]+\./) &&
      sec(/\nResults by opponent \(→ what those games add to the score\):\n• vs Bob: won \d+, lost \d+/) && sec(/\nWhy Host is ahead of Star \(#2\)\nHost wins overall: /), t);
    check("...👑 how Host stays on top: what a game won / lost / a race is worth, the tip",
      sec(/\n👑 How Host stays on top\nWhat one more result does to Host's score:\n• A game won: \+[\d.]+\n• A game lost: −[\d.]+\n• A race to 7 won \(7–\d\): \+[\d.]+\n💡 Tip: races and tournaments count the most\./), t);
    check("...⚠️ what could cost Host the spot: Star's quickest way past, losses in a row",
      sec(/\n⚠️ What could cost Host the #1 spot\n• Star \(#2\) is [\d.]+ points behind\. Their quickest way past: Win \d+ races to 7 \(7–2 each, as usual\) → Star [\d.]+\n• (Losing the next \d+ games in a row would drop Host below Star\.|Even 50 losses in a row wouldn't drop Host below Star\.)$/), t.slice(-400));
    check("...the button: \"" + r.button + "\"", r.button === "📤 Share as PDF");
    const s = r.shared || {};
    const pdf = s.b64 ? Buffer.from(s.b64, "base64") : Buffer.alloc(0);
    const latin = pdf.toString("latin1");
    const startxref = Number((/startxref\n(\d+)\n%%EOF\n$/.exec(latin) || [])[1]);
    const rows = startxref ? latin.slice(startxref).split("\n").slice(3).filter((x) => /^\d{10} 00000 n $/.test(x)) : [];
    const pages = (/\/Count (\d+)/.exec(latin) || [])[1];
    check("📤 Share as PDF: the share sheet got \"" + s.name + "\" (" + s.type + ", " + Math.round(pdf.length / 1024) + " KB, " + pages + " pages, title \"" + s.title + "\")",
      s.name === "Host - leaderboard report " + today + ".pdf" && s.type === "application/pdf" && s.title === "Host - #1 of 4 on the leaderboard" && latin.startsWith("%PDF-1.4") && Number(pages) >= 2 &&
      rows.length > 0 && rows.every((row, i) => latin.slice(Number(row.slice(0, 10))).startsWith(i + 1 + " 0 obj\n")), { name: s.name, type: s.type, title: s.title, head: latin.slice(0, 20) });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-report-"));
    const pdfPath = path.join(OUT || tmp, "Host_report.pdf");
    fs.writeFileSync(pdfPath, pdf);
    let opened = "";
    try { execFileSync("sips", ["-s", "format", "png", pdfPath, "--out", path.join(tmp, "page1.png")], { stdio: "ignore" }); opened = execFileSync("sips", ["-g", "pixelWidth", path.join(tmp, "page1.png")]).toString(); } catch (e) { opened = String(e.message); }
    check("...macOS opens it (sips, page 1 at 595 pt wide)", /pixelWidth: 595/.test(opened), opened);

    // ---- Star, #2 ----
    r = await report("Star");
    check("Star (#2): why Host is ahead, why Star is ahead of Bob, how to climb - " + JSON.stringify(r.text.slice(0, 200)),
      /\nWhy Host \(#1\) is ahead\n/.test(r.text) && /\nWhy Star is ahead of Bob \(#3\)\n/.test(r.text) && /\n🧗 How Star can climb\nTo pass Host \(#1, [\d.]+\):\n• Win \d+ races to 7 \(7–2 each, as usual\) → Star [\d.]+\n/.test(r.text) && /\nThe quickest way to pass Host: Win \d+ races to 7/.test(r.text) && /\n⚠️ What could cost Star the #2 spot\n• Bob \(#3\)/.test(r.text), r.text);

    // ---- Few, last ----
    r = await report("Few");
    check("Few (last): \"Nobody is ranked below Few\"; Bob over Few: the win rates as counted (Few's plain 60% is higher), no +0.0 line",
      /\n⚠️ What could cost Few the #4 spot\nNobody is ranked below Few: nothing to lose here, only places to win\.$/.test(r.text) && /Bob has a better win rate once the extra games are counted \([\d.]+% vs 30\.0%\)/.test(r.text) && !/\+0\.0 pts/.test(r.text), r.text);

    // ---- 📈 Performance, Last 30 Days ----
    await period("month");
    await pick("performance");
    const perfOrder = await names();
    r = await report(perfOrder[0]);
    check("📈 Performance, Last 30 Days, on " + perfOrder[0] + ": the method's idea, a game won/lost against a player rated around, the period line",
      /How well you play, not how often/.test(r.text) && /• A game won against a player rated around \d+: [+−±]/.test(r.text) && /• A game lost against a player rated around \d+: [+−±]/.test(r.text) && /This board only counts the games in its period \(Last 30 Days\)/.test(r.text) && /💡 Tip: who you beat is what counts/.test(r.text), r.text);

    // ---- 🌙 Best 3 nights ----
    await pick("bestNights");
    const nightOrder = await names();
    r = await report(nightOrder[0]);
    check("🌙 Best 3 nights, on " + nightOrder[0] + ": a night won / lost, \"A bad night can't cost\"",
      /What one more night \(3 games\) does to/.test(r.text) && /• A night won 3–0 against players rated around \d+: /.test(r.text) && (nightOrder.length < 2 || /A bad night can't cost/.test(r.text)), r.text);

    // ---- no share sheet: saved ----
    await page.evaluate(() => localStorage.setItem("__noShare", "1"));
    await openBoard();
    await period("all");
    await pick("mvp");
    r = await report("Star", true);
    check("no share sheet: saved, \"" + r.toast + "\"", !r.shared && /PDF saved to Downloads/.test(r.toast), r.toast);
    await page.evaluate(() => localStorage.removeItem("__noShare"));

    // ---- in French ----
    await page.evaluate(() => localStorage.setItem("poolMasterCounter.language.v1", "french"));
    await openBoard();
    r = await report("Host");
    check("in French: \"" + r.button + "\", " + JSON.stringify(r.text.slice(0, 120)), r.button === "📤 Partager en PDF" && /\nEn bref\nHost est n° 1 sur 4/.test(r.text) && /\n👑 Comment Host reste en tête\n/.test(r.text), r.text);
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
