// How often the scoreboard writes its state while nobody touches it (after one game) - the Report
// Archive's automatic save waits for an hour with none.
// usage: node tests/probe_idle_saves.js http://localhost:4235/ [seconds]
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
(async () => {
  const BASE = process.argv[2], SECS = +(process.argv[3] || 60);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const orig = Storage.prototype.setItem;
    window.__saves = [];
    Storage.prototype.setItem = function (k, v) { if (k === "poolMasterCounter.state.v2") window.__saves.push({ t: Date.now(), stack: (new Error().stack || "").split("\n").slice(2, 6).map((l) => l.trim()).join(" < ") }); return orig.call(this, k, v); };
  });
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(async () => {
    for (const n of ["Alex", "Sam"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
  });
  await new Promise((r) => setTimeout(r, 500));
  // one game: Alex wins a rack (8-Ball)
  await page.evaluate(() => { const el = [...document.querySelectorAll(".player-panel")].find((c) => /Alex/.test(c.textContent)); [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "+").click(); });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { for (let i = 0; i < 4; i++) { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && /^(Next game|Continue|OK|Close|Got it|Start next game|Done)/i.test(x.textContent.trim()) && x.closest("[class*='overlay'],[class*='modal'],[role='dialog']")); if (b) b.click(); } });
  await new Promise((r) => setTimeout(r, 2000));
  const t0 = Date.now();
  await page.evaluate(() => { window.__saves = []; });
  await new Promise((r) => setTimeout(r, SECS * 1000));
  const saves = await page.evaluate(() => window.__saves);
  const games = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).gameHistory.length);
  console.log(JSON.stringify({ gamesInHistory: games, idleSeconds: SECS, savesWhileIdle: saves.length, first: saves.slice(0, 3).map((s) => ((s.t - t0) / 1000).toFixed(1) + "s " + s.stack) }, null, 1));
  await browser.close();
})();
