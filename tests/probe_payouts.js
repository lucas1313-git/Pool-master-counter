// A tournament's money (P33) - bookkeeping only. Ann, Ben, Cat and Dan, single elimination, race to 1:
// - 💰 Payouts: $20 entry, $5 green fee, $20 added, 10% house cut - "Collect $25 from each of the
//   4 players", a $92 prize pool, 70/30 for 8 or fewer: 1st $65, 2nd $27 (64.4 + 27.6, the odd
//   dollar to the winner);
// - the table edited (60, 40): $56 / $36 - kept for the next tournament; back to 70, 30;
// - a side pot ("Break and run", $5 x 4 = $20, Ben); a Calcutta (bids $100, 10% cut: $90 - $63 / $27
//   before it's over);
// - played out: the champion banner says what the winner takes and who collects the Calcutta; the
//   placings show each place's share; the Day Report's text has the payouts, the side pot and the
//   Calcutta; still there after a reload;
// - money changed after the end ($30 added: $102): the banner and the Day Report follow;
// - no page errors.
// Its own file server on 4290.
// usage: node tests/probe_payouts.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4290, BASE = "http://localhost:" + PORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1180, height: 900 } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__copied = [];
      try { Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } }, configurable: true }); } catch (e) {}
    });
    const tap = async (sel) => { await page.waitForSelector(sel, { visible: true, timeout: 5000 }); await page.click(sel); await sleep(350); };
    const T = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.tournament.v1") || "null"));
    const players = ["Ann", "Ben", "Cat", "Dan"];
    await page.goto(BASE + "manifest.json");
    await page.evaluate((players) => {
      localStorage.clear();
      localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.boardTipsSeen.v1", "1");
      localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
      localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: players.map((n, i) => ({ id: "p" + i, name: n, playing: false, balls: 0 })), playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
    }, players);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(700);
    await page.evaluate(() => document.getElementById("btn-open-tournament").click());
    await sleep(500);
    await tap('input[name="tournament-format"][value="single"]');
    await tap("#btn-tournament-setup-next");
    await page.evaluate(() => { const i = document.getElementById("tournament-race-to"); i.value = 1; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
    await tap("#btn-tournament-setup-next");
    const checked = await page.evaluate(() => [...document.querySelectorAll("#tournament-player-checklist input[type=checkbox]")].filter((c) => c.checked).length);
    if (checked < players.length) await tap("#tournament-select-all-checkbox");
    await tap("#btn-tournament-setup-next");
    await page.evaluate(() => { const r = document.querySelector('input[name="tournament-seed-mode"][value="manual"]'); if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); } });
    await tap("#btn-tournament-start");
    await sleep(800);

    // ---- 💰 Payouts ----
    await tap("#btn-tournament-payouts");
    // (what's in the field selected, then typed over - key by key, as a person would)
    const type = async (sel, text) => { await page.focus(sel); await page.evaluate((sel) => document.querySelector(sel).select(), sel); await page.type(sel, text); await sleep(120); };
    await type("#payouts-entry", "20");
    await type("#payouts-green", "5");
    await type("#payouts-added", "20");
    await type("#payouts-cut", "10");
    const sheet = () => page.evaluate(() => ({
      summary: document.getElementById("payouts-summary").textContent,
      places: [...document.querySelectorAll("#payouts-places .payouts-place")].map((li) => li.textContent),
      calcutta: (document.getElementById("payouts-calcutta-summary") || {}).textContent || "",
      sidePots: [...document.querySelectorAll(".payouts-sidepot-amount")].map((x) => x.textContent)
    }));
    let s = await sheet();
    check("$20 entry, $5 green fee, $20 added, 10% cut, 4 players: \"Collect $25 from each of the 4 players\", a $92 prize pool", /Collect \$25 from each of the 4 players/.test(s.summary) && /Prize pool: \$92/.test(s.summary) && /Green fees \(\$20\) go to the house/.test(s.summary), s);
    check("...70/30 for 8 or fewer: 1st $65, 2nd $27 (the odd dollar to the winner)", s.places.length === 2 && /1st.*70%.*\$65/.test(s.places[0]) && /2nd.*30%.*\$27/.test(s.places[1]), s.places);
    if (OUT) await page.screenshot({ path: path.join(OUT, "payouts_pool.png") });
    await type("#payouts-pcts", "60, 40");
    s = await sheet();
    const presets = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.payoutPresets.v1") || "null"));
    check("the table edited to 60, 40: $56 / $36 - kept (up to 8 players: 60, 40)", /\$56/.test(s.places[0]) && /\$36/.test(s.places[1]) && presets && presets.find((r) => r.upTo === 8).pcts.join() === "60,40", { places: s.places, presets });
    await type("#payouts-pcts", "70, 30");
    // a side pot
    await tap("#btn-payouts-add-sidepot");
    await type("#payouts-sidepot-name-0", "Break and run");
    await type("#payouts-sidepot-buyin-0", "5");
    await page.select("#payouts-sidepot-winner-0", "Ben");
    await sleep(150);
    s = await sheet();
    check("a side pot \"Break and run\", $5 x 4 entries: " + s.sidePots.join(), s.sidePots.join() === "Pot $20", s);
    // a Calcutta
    await page.click("#payouts-calcutta-on");
    await sleep(300);
    await type("#payouts-calcutta-cut", "10");
    const buyers = [["Sam", "40"], ["Lee", "30"], ["Sam", "20"], ["Ali", "10"]];
    for (let i = 0; i < 4; i++) { await type("#payouts-calcutta-buyer-" + i, buyers[i][0]); await type("#payouts-calcutta-bid-" + i, buyers[i][1]); }
    s = await sheet();
    if (OUT) await page.screenshot({ path: path.join(OUT, "payouts_sheet.png") });
    check("a Calcutta: bids $100, less a 10% cut: a $90 pot - 1st $63, 2nd $27 before it's over", /Bids \$100, less the house cut \$10: pot \$90/.test(s.calcutta) && /1st · \$63/.test(s.calcutta) && /2nd · \$27/.test(s.calcutta), s.calcutta);
    await tap("#btn-payouts-done");

    // ---- played out: the "a" side wins every match ----
    for (let guard = 0; guard < 8; guard++) {
      let t = await T();
      if (t.champion) break;
      if (!(t.activeMatches || []).length) {
        await page.evaluate(() => { const b = [...document.querySelectorAll(".tournament-play-btn, #tournament-ready-list button.btn-primary")].find((x) => x.offsetParent); if (b) b.click(); });
        await sleep(500);
        t = await T();
      }
      const a = t.activeMatches[0];
      const m = [].concat(...t.wb).find((x) => x.id === a.matchId);
      await page.evaluate((name) => { const panel = [...document.querySelectorAll("#tournament-current-match-panel .player-panel")].find((p) => p.textContent.includes(name)); panel.querySelector(".btn-ball.plus").click(); }, m.a);
      await sleep(700);
      await page.evaluate(() => {
        for (let i = 0; i < 4; i++) {
          const o = [...document.querySelectorAll("[id$='-overlay']")].find((x) => !x.classList.contains("hidden") && getComputedStyle(x).display !== "none" && x.getClientRects().length);
          if (!o) return;
          const b = [...o.querySelectorAll("button.btn-primary")].find((x) => x.getClientRects().length);
          if (b) b.click(); else return;
        }
      });
      await sleep(400);
    }
    let t = await T();
    const placings = t.placings || [];
    const champ = t.champion, second = placings[1] && placings[1].names[0];
    const champBuyer = buyers[players.indexOf(champ)][0];
    const shown = () => page.evaluate(() => ({ banner: (document.getElementById("tournament-banner-payout") || {}).textContent || "", placings: [...document.querySelectorAll("#tournament-placings li")].map((li) => li.textContent) }));
    let b = await shown();
    if (OUT) await page.screenshot({ path: path.join(OUT, "payouts_champion.png") });
    check("it's over (" + champ + " wins): \"" + b.banner + "\"", !!champ && b.banner.includes(champ + " takes $65 of the $92 prize pool") && b.banner.includes("Calcutta: " + champBuyer + " collects $63"), b);
    check("...the placings: 1st $65, 2nd $27, 3rd-4th nothing", /\$65/.test(b.placings[0]) && /\$27/.test(b.placings[1]) && !/\$/.test(b.placings[2] || ""), b.placings);
    const report = async () => {
      await page.evaluate(() => { window.__copied = []; document.getElementById("btn-day-report-copy").click(); });
      await sleep(600);
      return page.evaluate(() => window.__copied[window.__copied.length - 1] || "");
    };
    let text = await report();
    const line = (text.split("\n").find((l) => /💰/.test(l)) || "");
    check("the Day Report: \"" + line.trim() + "\"", line.includes(champ + " $65") && line.includes(second + " $27") && line.includes("Break and run: Ben $20") && line.includes("Calcutta: ") && line.includes(champBuyer + " $63"), text.slice(0, 1500));
    const rec = await page.evaluate(() => (JSON.parse(localStorage.getItem("poolMasterCounter.tournamentResults.v1") || "[]")[0] || {}).payouts);
    check("...kept with the tournament's results (the backup has it): pool $" + (rec && rec.pool), rec && rec.pool === 92 && rec.places[0].each[0] === 65, rec);

    await page.reload({ waitUntil: "networkidle2" });
    await sleep(800);
    await page.evaluate(() => document.getElementById("btn-open-tournament").click());
    await sleep(500);
    b = await shown();
    check("after a reload: the banner still says it", b.banner.includes(champ + " takes $65"), b);

    // money changed after the end
    await tap("#btn-tournament-payouts");
    await type("#payouts-added", "30");
    await tap("#btn-payouts-done");
    b = await shown();
    text = await report();
    // ($80 - $8 + $30: 71.4 + 30.6, the odd dollar to the winner)
    check("$30 added after the end ($102): the banner (" + b.banner.split(" · ")[0] + ") and the Day Report follow", b.banner.includes("takes $72 of the $102 prize pool") && text.includes(champ + " $72") && text.includes(second + " $30"), { banner: b.banner, text: text.slice(0, 1200) });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    site.close();
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
