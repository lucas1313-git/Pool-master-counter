// Publish Daily Report's sharing with attachments (the backup file and/or
// the colorful report picture) - and the colorful report page's own Share.
// Safari (iPhone, iPad) only opens the share sheet straight from the tap:
// asked a moment later (after a canvas.toBlob, a promise...) it refuses -
// which is how attaching files broke there. Headless Chrome is more
// forgiving, so this checks Safari's rule itself: a pretend share sheet
// notes whether it was asked during the tap (between the tap's first and
// last listeners), and what it got.
// On the GitHub-like site (a plain file server on 4244 - no server behind).
// Checks: the backup attachment is off until turned on; both on -> 📤 Share Report asks the share sheet
// during the tap, with the backup (JSON, no contacts) and the picture (a
// real PNG) and the report's text, the backup without anything from the camera (samples,
// empty-room photo, calibration, room plan) or reset snapshots; the colorful report's page: its Share
// asks during the tap too, with the picture; Share Standings sits in this
// section.
// usage: node tests/probe_day_report_share.js
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4244, BASE = "http://localhost:" + PORT + "/";
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
// the pretend share sheet: was it asked during the tap? what did it get?
const SHEET = () => {
  window.__tap = false; window.__shares = [];
  window.addEventListener("click", () => { window.__tap = true; }, true);
  window.addEventListener("click", () => { window.__tap = false; }, false);
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = (d) => {
    const duringTap = window.__tap; // (as asked - Safari decides right then)
    return (async () => {
      const files = await Promise.all((d.files || []).map(async (f) => { const b = new Uint8Array(await f.arrayBuffer()); return { name: f.name, type: f.type, size: f.size, png: b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, text: f.type === "application/json" ? new TextDecoder().decode(b).slice(0, 200000) : null }; }));
      window.__shares.push({ duringTap, text: d.text || "", files });
    })();
  };
};

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
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 1000 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(SHEET);
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => new Promise((done) => {
    localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1");
    // the camera's private things on this device: the empty-room photo, the calibration, the room plan, people's samples
    localStorage.setItem("pmc-camera-empty-room", JSON.stringify({ jpeg: "data:image/jpeg;base64,EMPTYROOMPHOTO" }));
    localStorage.setItem("pmc-camera-calibration", JSON.stringify({ corners: [[1, 2]] }));
    localStorage.setItem("pmc-room-plan", JSON.stringify({ w: 12 }));
    localStorage.setItem("poolMasterCounter.driveFolderLink.v1", "https://drive.google.com/drive/folders/1FAKEsharedFolder0001");
    const req = indexedDB.open("pmc-big", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => {
      const tx = req.result.transaction("kv", "readwrite");
      tx.objectStore("kv").put({ luigi: { displayName: "Luigi", descriptors: [[0.1, 0.2]], info: [{ kind: "identify", at: Date.now() }] } }, "cameraEnrollments@" + (localStorage.getItem("poolMasterCounter.bigStoreGen.v1") || "0"));
      tx.oncomplete = () => { req.result.close(); done(); };
    };
  }));
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(700);
  // a little day: Luigi beats Luc twice (a race to 5 - no "on the hill" banner over the buttons)
  await page.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  });
  for (const t of ["Luigi plays against Luc", "play 8-ball", "race to 5", "Luigi wins the game", "nice game", "Luigi wins the game", "nice game"]) { await page.evaluate((t) => window.PMCVoice.handleText(t), t); await sleep(400); }
  const attachDefault = await page.evaluate(() => document.getElementById("day-report-attach-backup-checkbox").checked);
  check("\"Attach a backup\" is off until turned on (the file goes to whoever gets the report)", attachDefault === false);
  await page.evaluate(() => {
    const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) document.getElementById("btn-confirm-modal-ok").click();
    const b = document.getElementById("btn-toggle-day-notes-panel") || document.querySelector("#day-notes-panel .panel-toggle");
    if (document.getElementById("day-notes-panel").classList.contains("collapsed")) b.click();
    const c = document.getElementById("day-report-attach-colorful-checkbox"); if (!c.checked) c.click();
    const k = document.getElementById("day-report-attach-backup-checkbox"); if (!k.checked) k.click();
  });
  await sleep(500);
  const where = await page.evaluate(() => ({ standings: document.getElementById("day-notes-panel").contains(document.getElementById("btn-share")), colorful: document.getElementById("day-report-attach-colorful-checkbox").checked, backup: document.getElementById("day-report-attach-backup-checkbox").checked }));
  check("Publish Daily Report: Share Standings is here; both attachments on", where.standings && where.colorful && where.backup, where);

  await page.click("#btn-day-report-share-backup");
  await sleep(1500);
  const shares = await page.evaluate(() => window.__shares);
  const s = shares[0] || { files: [] };
  const json = s.files.find((f) => f.type === "application/json"), png = s.files.find((f) => f.type === "image/png");
  check("📤 Share Report with attachments: the share sheet is asked during the tap (as Safari requires)", shares.length === 1 && s.duringTap === true, shares.map((x) => ({ duringTap: x.duringTap, files: x.files.map((f) => f.name) })));
  const cameraBits = json ? ["pmc-camera", "pmc-room-plan", "EMPTYROOMPHOTO", "cameraEnrollments", "resetSnapshots", "descriptors"].filter((k) => json.text.indexOf(k) !== -1) : ["no file"];
  check("...the backup has nothing from the camera (no samples, empty-room photo, calibration or room plan) and no reset snapshots - the Drive folder link stays",
    cameraBits.length === 0 && /1FAKEsharedFolder0001/.test(json.text) && /"shared": true/.test(json.text), cameraBits);
  check("...with the backup (JSON, the day's players, no contacts) and the colorful report as a real PNG", !!json && /all-data/.test(json.name) && /"Luigi"/.test(json.text) && /"contacts": \{\}/.test(json.text) && !!png && png.png && png.size > 5000, s.files.map((f) => ({ name: f.name, type: f.type, size: f.size, png: f.png })));
  check("...and the report's text", /Luigi/.test(s.text), s.text.slice(0, 120));

  // the colorful report's own page: its Share, during the tap too
  const tab = new Promise((ok) => browser.once("targetcreated", (t) => ok(t)));
  await page.click("#btn-day-report-colorful");
  const t = await tab;
  const rp = await t.page();
  for (let i = 0; i < 20; i++) { try { if (await rp.evaluate(() => !!document.getElementById("shareReportBtn"))) break; } catch (e) {} await sleep(250); }
  await rp.evaluate(SHEET);
  await rp.click("#shareReportBtn");
  await sleep(1500);
  const rs = await rp.evaluate(() => window.__shares);
  check("the colorful report's page: Share asks the share sheet during the tap, with the picture (a real PNG)", rs.length === 1 && rs[0].duringTap === true && rs[0].files.length === 1 && rs[0].files[0].png && rs[0].files[0].size > 5000, rs);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
