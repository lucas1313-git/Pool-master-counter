// Export All Data carries everything - the Report Archive (incl. days rebuilt), its deleted days,
// daily best runs, Challonge push records, this device's settings and camera setup - but never
// passwords/keys. A device with no players adopts it all, settings included; a merge keeps its own
// settings; deleted days stay deleted everywhere.
// usage: node tests/probe_export_all.js http://localhost:4235/
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const BASE = process.argv[2];
const DL = path.join(__dirname, "tmphome", "dl");
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined ? "  " + JSON.stringify(extra).slice(0, 400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400000;
const localDate = (ms) => { const d = new Date(ms); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
(async () => {
  fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const session = await browser.target().createCDPSession();
  await session.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => {
    // (the exported file, as the app hands it to the browser to save)
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) { if (blob && blob.type === "application/json") blob.text().then((t) => { window.__lastExport = t; }); return orig.call(URL, blob); };
  });
  await page.evaluateOnNewDocument(() => {
    const off = Number(localStorage.getItem("__testDateOffsetMs") || 0);
    if (!off) return;
    const RealDate = Date;
    class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(RealDate.now() + off); else super(...a); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
  });
  const at = async (o) => { await page.evaluate((o) => { if (o) localStorage.setItem("__testDateOffsetMs", String(o)); else localStorage.removeItem("__testDateOffsetMs"); }, o); await page.goto(BASE, { waitUntil: "networkidle2" }); await sleep(900); };
  const fresh = async (extra) => {
    await page.goto(BASE + "manifest.json");
    await page.evaluate((extra) => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); Object.keys(extra || {}).forEach((k) => localStorage.setItem(k, extra[k])); }, extra);
  };
  const addPlayers = (names) => page.evaluate(async (names) => {
    for (const n of names) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    document.querySelectorAll("#roster-list li.roster-row .btn-playing:not(.is-on)").forEach((b) => b.click());
  }, names);
  const win = async (name) => {
    await page.evaluate((n) => { const el = [...document.querySelectorAll(".player-panel")].find((c) => c.querySelector(".player-name").textContent.trim().startsWith(n)); [...el.querySelectorAll("button")].find((b) => b.textContent.trim() === "+").click(); }, name);
    await sleep(900);
    await page.evaluate(() => { for (let i = 0; i < 4; i++) { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && /^(Next game|Continue|OK|Close|Got it|Start next game|Done)/i.test(x.textContent.trim()) && x.closest("[class*='overlay'],[class*='modal'],[role='dialog']")); if (b) b.click(); } });
    await sleep(500);
  };
  const ls = (k) => page.evaluate((k) => localStorage.getItem(k), k);
  const archiveDates = () => page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.reportArchive.v1") || "[]").map((e) => e.dateStr));
  const now = Date.now(), d5 = new Date(now - 5 * DAY), d2 = new Date(now - 2 * DAY);
  d5.setHours(20, 0, 0, 0); d2.setHours(20, 0, 0, 0);

  // ---- device A: two play days, one deleted from the archive, settings, camera setup, secrets ----
  await fresh({ "poolMasterCounter.theme.v1": "emerald-rail", "pmc-camera-calibration": "{\"test\":\"calib\"}", "pmc-camera-empty-room": "{\"test\":\"snapshot\"}",
    "poolMasterCounter.challongeClientSecret.v1": "SECRET-123", "poolMasterCounter.driveApiKey.v1": "DRIVEKEY-123", "poolMasterCounter.challongeDayPushes.v1": "{\"2026-10-01\":{\"test\":true}}" });
  await at(d5.getTime() - now);
  await addPlayers(["Alex", "Sam"]);
  await sleep(400);
  await win("Alex"); await win("Sam");
  await at(d2.getTime() - now);
  await win("Alex");
  await page.evaluate(() => localStorage.setItem("poolMasterCounter.playerDailyBestRuns.v1", JSON.stringify({ Alex: { name: "Alex", value: 7, ts: new Date().toISOString() } })));
  await at(0);
  check("device A: both play days archived", JSON.stringify(await archiveDates()) === JSON.stringify([localDate(d2), localDate(d5)]), await archiveDates());
  // delete the older day
  await page.evaluate(() => { if (document.getElementById("report-archive-panel").classList.contains("collapsed")) document.getElementById("btn-toggle-report-archive-panel").click(); });
  await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll("#report-archive-list li")][1].querySelectorAll("button")[1].click());
  await sleep(300);
  await page.click("#btn-confirm-modal-ok");
  await sleep(400);
  check("device A: the older day deleted", JSON.stringify(await archiveDates()) === JSON.stringify([localDate(d2)]), await archiveDates());
  // export
  await page.evaluate(() => { const p = document.getElementById("backup-panel"); if (p && p.classList.contains("collapsed")) document.getElementById("btn-toggle-backup-panel").click(); });
  await sleep(300);
  await page.evaluate(() => document.getElementById("btn-export-all-data").click());
  await sleep(400);
  await page.click("#btn-confirm-modal-ok");
  let rawExport = null;
  for (let i = 0; i < 40 && !rawExport; i++) { await sleep(250); rawExport = await page.evaluate(() => window.__lastExport || null); }
  check("the export was made", !!rawExport);
  const file = "export.json";
  fs.writeFileSync(path.join(DL, file), rawExport);
  const data = JSON.parse(rawExport);
  check("export: the Report Archive with the played day", (data.reportArchive || []).map((e) => e.dateStr).join() === localDate(d2), (data.reportArchive || []).map((e) => e.dateStr));
  check("export: the deleted day, daily best runs, Challonge pushes", (data.reportArchiveDeleted || []).includes(localDate(d5)) && data.playerDailyBestRuns && data.playerDailyBestRuns.Alex && data.playerDailyBestRuns.Alex.value === 7 && data.challongeDayPushes && data.challongeDayPushes["2026-10-01"], { deleted: data.reportArchiveDeleted, daily: data.playerDailyBestRuns, pushes: data.challongeDayPushes });
  check("export: settings and camera setup", data.settings && data.settings["poolMasterCounter.theme.v1"] === "emerald-rail" && data.settings["pmc-camera-calibration"] && data.settings["pmc-camera-empty-room"], data.settings && Object.keys(data.settings));
  const raw = fs.readFileSync(path.join(DL, file), "utf8");
  check("export: no passwords or keys", !/SECRET-123|DRIVEKEY-123/.test(raw));
  const exportPath = path.join(DL, file);

  // ---- device B: no players - adopts everything, settings included ----
  await fresh({});
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  const input = await page.$("#import-file-input");
  await input.uploadFile(exportPath);
  await sleep(600);
  await page.click("#btn-confirm-modal-ok");
  await sleep(2500);
  await page.waitForFunction(() => document.readyState === "complete");
  await sleep(1200);
  check("new device: the archive, without the deleted day (not rebuilt either)", JSON.stringify(await archiveDates()) === JSON.stringify([localDate(d2)]), await archiveDates());
  check("new device: settings and camera setup adopted", (await ls("poolMasterCounter.theme.v1")) === "emerald-rail" && (await ls("pmc-camera-calibration")) === "{\"test\":\"calib\"}" && (await ls("pmc-camera-empty-room")) === "{\"test\":\"snapshot\"}");
  check("new device: daily best runs and deleted days", JSON.parse((await ls("poolMasterCounter.playerDailyBestRuns.v1")) || "{}").Alex && JSON.parse((await ls("poolMasterCounter.reportArchiveDeleted.v1")) || "[]").includes(localDate(d5)));
  check("new device: no secrets came with it", !(await ls("poolMasterCounter.challongeClientSecret.v1")) && !(await ls("poolMasterCounter.driveApiKey.v1")));

  // ---- device C: its own player and theme - a merge keeps its settings ----
  await fresh({ "poolMasterCounter.theme.v1": "classic-wood" });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  await addPlayers(["Kim"]);
  await sleep(400);
  const input2 = await page.$("#import-file-input");
  await input2.uploadFile(exportPath);
  await sleep(600);
  await page.click("#btn-confirm-modal-ok");
  await sleep(1500);
  await page.evaluate(() => { const b = document.getElementById("btn-confirm-modal-ok"); if (b && b.offsetParent) b.click(); });
  await sleep(2500);
  check("merge: this device's own settings stay", (await ls("poolMasterCounter.theme.v1")) === "classic-wood" && !(await ls("pmc-camera-calibration")), { theme: await ls("poolMasterCounter.theme.v1"), calib: await ls("pmc-camera-calibration") });
  check("merge: the archive comes in, the deleted day stays deleted", JSON.stringify(await archiveDates()) === JSON.stringify([localDate(d2)]), await archiveDates());
  // ---- device D: Import & Replace - the backup becomes this device's setup, settings included ----
  await fresh({ "poolMasterCounter.theme.v1": "classic-wood", "poolMasterCounter.reportArchiveDeleted.v1": "[\"2020-01-01\"]" });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(800);
  await addPlayers(["Lee"]);
  await sleep(400);
  const sq = await page.$("#squash-import-file-input");
  await sq.uploadFile(exportPath);
  await sleep(700);
  await page.evaluate(() => document.getElementById("btn-squash-confirm").click());
  await sleep(1200);
  await page.evaluate(() => { const b = document.getElementById("btn-confirm-modal-ok"); if (b && b.offsetParent) b.click(); });
  await sleep(2500);
  check("Replace Everything: settings and camera setup adopted", (await ls("poolMasterCounter.theme.v1")) === "emerald-rail" && (await ls("pmc-camera-calibration")) === "{\"test\":\"calib\"}", { theme: await ls("poolMasterCounter.theme.v1") });
  check("Replace Everything: the archive and its deleted days are the file's", JSON.stringify(await archiveDates()) === JSON.stringify([localDate(d2)]) && JSON.stringify(JSON.parse((await ls("poolMasterCounter.reportArchiveDeleted.v1")) || "[]")) === JSON.stringify([localDate(d5)]), { dates: await archiveDates(), deleted: await ls("poolMasterCounter.reportArchiveDeleted.v1") });
  check("no page errors", errors.length === 0, errors);
  console.log(fails ? "EXPORT_ALL_FAIL (" + fails + ")" : "EXPORT_ALL_OK");
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
