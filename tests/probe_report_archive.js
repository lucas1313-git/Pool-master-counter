// Report Archive: days played without ever opening/sharing the report (and without an idle hour) are
// rebuilt on the next start; a deleted day stays deleted; leaving the app keeps today's report;
// a night session isn't counted again the next day.
// The page's clock is shifted (window.Date) to play on past days.
// usage: node tests/probe_report_archive.js http://localhost:4235/
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// (game logs, report archive... live in IndexedDB - js/big-store.js - under the generation in use)
const readBig = (page, name) => page.evaluate((name) => new Promise((resolve) => {
  const gen = localStorage.getItem("poolMasterCounter.bigStoreGen.v1") || "0";
  const req = indexedDB.open("pmc-big", 1);
  req.onupgradeneeded = () => req.result.createObjectStore("kv");
  req.onerror = () => resolve(null);
  req.onsuccess = () => {
    try {
      const get = req.result.transaction("kv", "readonly").objectStore("kv").get(name + "@" + gen);
      get.onsuccess = () => { resolve(get.result === undefined ? null : get.result); req.result.close(); };
      get.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  };
}), name);
const DAY = 86400000;
const localDate = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
(async () => {
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (/Report Archive/.test(m.text())) console.log("  [page]", m.text()); });
  await page.evaluateOnNewDocument(() => {
    const off = Number(localStorage.getItem("__testDateOffsetMs") || 0);
    if (!off) return;
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(RealDate.now() + off); else super(...a); }
      static now() { return RealDate.now() + off; }
    }
    window.Date = FakeDate;
  });
  const at = async (offsetMs) => {
    await page.evaluate((o) => { if (o) localStorage.setItem("__testDateOffsetMs", String(o)); else localStorage.removeItem("__testDateOffsetMs"); }, offsetMs);
    await page.goto(BASE, { waitUntil: "networkidle2" });
    await sleep(900);
  };
  const win = async (name) => {
    await page.evaluate((n) => { const el = [...document.querySelectorAll(".player-panel")].find((c) => c.querySelector(".player-name").textContent.trim().startsWith(n)); [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "+").click(); }, name);
    await sleep(900);
    await page.evaluate(() => { for (let i = 0; i < 4; i++) { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && /^(Next game|Continue|OK|Close|Got it|Start next game|Done)/i.test(x.textContent.trim()) && x.closest("[class*='overlay'],[class*='modal'],[role='dialog']")); if (b) b.click(); } });
    await sleep(500);
  };
  const archive = async () => ((await readBig(page, "reportArchive")) || []).map((e) => ({ date: e.dateStr, games: (e.games || []).reduce((n, g) => n + (/×(\d+)/.test(g.label) ? +/×(\d+)/.exec(g.label)[1] : 1), 0), notes: e.notes || null }));
  const hide = () => page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }); });

  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  const now = Date.now();
  // 14 days ago, at 21:00: two games
  const d14 = new Date(now - 14 * DAY); d14.setHours(21, 0, 0, 0);
  await at(d14.getTime() - now);
  await page.evaluate(async () => {
    for (const n of ["Alex", "Sam"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
  });
  await sleep(500);
  await win("Alex"); await win("Sam");
  // 10 days ago: one game
  const d10 = new Date(now - 10 * DAY); d10.setHours(20, 0, 0, 0);
  await at(d10.getTime() - now);
  await win("Alex");
  // 3 days ago: three games and a note
  const d3 = new Date(now - 3 * DAY); d3.setHours(19, 30, 0, 0);
  await at(d3.getTime() - now);
  await page.evaluate(() => { const t = document.getElementById("day-notes-textarea"); t.value = "Sam on fire"; t.dispatchEvent(new Event("input", { bubbles: true })); });
  await win("Sam"); await win("Sam"); await win("Alex");
  // (the old way, nothing was opened, shared or left idle for an hour: none of these days archived -
  // except those rebuilt by this version on each start, which is the point; check the final state)
  // back to today
  await at(0);
  let a = await archive();
  console.log("archive:", JSON.stringify(a));
  const want = [localDate(d3), localDate(d10), localDate(d14)];
  check("the three missed days are in the archive, newest first", JSON.stringify(a.map((e) => e.date)) === JSON.stringify(want), { got: a.map((e) => e.date), want });
  check("...with their own games (3, 1, 2)", a.map((e) => e.games).join() === "3,1,2", a.map((e) => e.games));
  check("...and the 3-days-ago note on that day only", a[0].notes === "Sam on fire" && !a[1].notes && !a[2].notes, a.map((e) => e.notes));
  const rows = await page.evaluate(() => document.querySelectorAll("#report-archive-list li").length);
  check("the archive list shows them", rows === 3, rows);
  // delete one: it stays deleted
  await page.evaluate(() => { const b = document.getElementById("btn-toggle-report-archive-panel"); if (document.getElementById("report-archive-panel").classList.contains("collapsed")) b.click(); });
  await sleep(300);
  await page.evaluate((d) => {
    const li = [...document.querySelectorAll("#report-archive-list li")].find((x) => x.textContent.includes(new Date(d + "T00:00:00").toLocaleDateString(undefined, { day: "numeric" })) && x === document.querySelectorAll("#report-archive-list li")[1]);
    [...document.querySelectorAll("#report-archive-list li")][1].querySelectorAll("button")[1].click();
  }, localDate(d10));
  await sleep(300);
  await page.evaluate(() => document.getElementById("btn-confirm-modal-ok").click());
  await sleep(400);
  await at(0);
  a = await archive();
  check("a deleted day stays deleted after a restart", JSON.stringify(a.map((e) => e.date)) === JSON.stringify([localDate(d3), localDate(d14)]), a.map((e) => e.date));
  // yesterday 23:40: a game, then the app is left (hidden) - saved under yesterday
  const y = new Date(now - DAY); y.setHours(23, 40, 0, 0);
  await at(y.getTime() - now);
  await win("Alex");
  await hide();
  await sleep(300);
  a = await archive();
  check("leaving the app saves that day's report at once", a.some((e) => e.date === localDate(y) && e.games === 1), a);
  // today: a game, leave - today's report doesn't count last night's game again
  await at(0);
  await win("Sam");
  await hide();
  await sleep(300);
  a = await archive();
  const today = a.find((e) => e.date === localDate(now));
  check("today's report: only today's game (last night's isn't counted again)", today && today.games === 1, a);
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "ARCHIVE_FAIL (" + fails + ")" : "ARCHIVE_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
