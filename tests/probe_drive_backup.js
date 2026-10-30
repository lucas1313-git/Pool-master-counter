// Backups into the linked Google Drive folder (server/backup-drive.js and
// Backup & Transfer's ☁️ Google Drive folder). A fake Google Drive for
// desktop under the test HOME: CloudStorage/GoogleDrive-<account>/My Drive
// with folders marked with their Drive id (the com.google.drivefs.item-id#S
// attribute, as Drive for desktop marks them). The server is started by
// this test with PMC_CLOUD_STORAGE pointing there and PMC_CLIPBOARD_FILE
// (the "clipboard" written to a file - the real one is never touched).
// Checks: the link's folder found ("saved straight into “Backups”"); All
// Data -> the file lands in that folder, a complete backup carrying the
// link, no download; a folder not synced here -> kept in Documents › Pool
// Master Counter Backups, copied, asked to open the folder (opens the
// link); no server (the GitHub page) -> downloaded, asked to open the
// folder; a file link -> a plain download; a fresh device importing the
// backup gets the link; Import & Replace takes the backup's link (the
// automatic backup it makes first kept quietly).
// usage: node tests/probe_drive_backup.js     (starts its own server on 4236)
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 4236, BASE = "http://localhost:" + PORT + "/";
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The app opens on the board (Focus Mode); this probe works in the panels, so 🔍 Show All once it's up.
const showAll = async (pg) => {
  await pg.waitForFunction(() => document.getElementById("app") && document.getElementById("app").classList.contains("focus-mode"), { timeout: 10000 });
  await pg.evaluate(() => document.getElementById("btn-toggle-focus").click());
};

const HOME = path.join(__dirname, "tmphome", "drive-backup-home");
const CLOUD = path.join(HOME, "Library", "CloudStorage");
const ACCOUNT = path.join(CLOUD, "GoogleDrive-test@example.com");
const BACKUPS = path.join(ACCOUNT, "My Drive", "Pool", "Backups");
const KEPT = path.join(HOME, "Documents", "Pool Master Counter Backups");
const CLIP = path.join(HOME, "clipboard.txt");
const DL = path.join(HOME, "Downloads");
const FOLDER_ID = "1FAKEbackupsFolderId0001";
const LINK = "https://drive.google.com/drive/folders/" + FOLDER_ID + "?usp=sharing";
const OTHER = "https://drive.google.com/drive/folders/1NOTSYNCEDhereAtAll0002";
const mark = (dir, id) => execFileSync("/usr/bin/xattr", ["-w", "com.google.drivefs.item-id#S", id, dir]);
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.json$/.test(n)) : []);

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true });
  for (const d of [BACKUPS, path.join(ACCOUNT, "My Drive", "Photos"), path.join(ACCOUNT, "Shared drives", "Club"), DL]) fs.mkdirSync(d, { recursive: true });
  mark(path.join(ACCOUNT, "My Drive"), "0ROOTmyDriveId000001");
  mark(path.join(ACCOUNT, "My Drive", "Pool"), "1POOLfolderId00000003");
  mark(BACKUPS, FOLDER_ID);
  mark(path.join(ACCOUNT, "My Drive", "Photos"), "1PHOTOSfolderId000004");
  mark(path.join(ACCOUNT, "Shared drives", "Club"), "0CLUBsharedDrive00005");

  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: Object.assign({}, process.env, { HOME, PORT: String(PORT), PMC_CLOUD_STORAGE: CLOUD, PMC_CLIPBOARD_FILE: CLIP }), stdio: "ignore"
  });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + "manifest.json")).ok) break; } catch (e) {} await sleep(250); }

  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const cdp = await page.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL }).catch(() => cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: DL }));
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" }); await showAll(page);
  await sleep(600);
  await page.evaluate(async () => {
    for (const n of ["Luigi", "Luc"]) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    window.__opened = [];
    window.open = (u) => { window.__opened.push(u); return null; };
    const b = document.getElementById("btn-toggle-backup-panel");
    if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click();
  });
  const setLink = (l) => page.evaluate((l) => { const i = document.getElementById("drive-folder-link-input"); i.value = l; i.dispatchEvent(new Event("change", { bubbles: true })); }, l);
  const status = () => page.evaluate(() => document.getElementById("drive-backup-status").textContent);
  const waitStatus = async (re) => { let s = ""; for (let i = 0; i < 40; i++) { s = await status(); if (re.test(s)) break; await sleep(250); } return s; };
  const modal = () => page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); return o.classList.contains("hidden") ? null : document.getElementById("confirm-modal-message").textContent; });
  // (💾 Back up now: the name box first, then through every fallback)
  const exportAll = async () => {
    await page.click("#btn-backup-now");
    await sleep(300);
    await page.click("#btn-confirm-modal-ok"); // (the file name: as offered)
    await sleep(300);
    await page.evaluate(() => { const b = document.getElementById("btn-bk-to-drive-folder") || document.getElementById("btn-bk-to-downloads"); if (b) b.click(); }); // (where to: a computer asks - the Drive folder where it can, else Downloads)
  };
  const toast = () => page.evaluate(() => { const t = [...document.querySelectorAll("#page-toast, #win-toast")].find((x) => !x.classList.contains("hidden") && x.textContent.trim()); return t ? t.textContent : ""; });

  // where it is: under More options
  check("the Drive folder link: under ⚙️ More options › Straight into a Google Drive folder (on the Mac)", await page.evaluate(() => document.getElementById("bk-more").contains(document.getElementById("drive-folder-link-input")) && !document.getElementById("bk-drive-box").classList.contains("hidden")));
  check("no link yet: backups download as usual", /No folder yet/.test(await status()), await status());

  // 1. the folder synced here: saved straight into it
  await setLink(LINK);
  let s = await waitStatus(/saved straight into/);
  check("the link's folder is found on this computer: \"saved straight into “Backups”\"", /saved straight into “Backups” \(Google Drive \(test@example\.com\) › My Drive › Pool › Backups\)/.test(s), s);
  await exportAll();
  let saved = [];
  for (let i = 0; i < 30 && !saved.length; i++) { await sleep(250); saved = jsonFiles(BACKUPS); }
  const data = saved.length ? JSON.parse(fs.readFileSync(path.join(BACKUPS, saved[0]), "utf8")) : null;
  check("All Data: the backup lands in the Drive folder (" + saved[0] + ")", saved.length === 1 && /^.*all-data.*\.json$/.test(saved[0]), saved);
  check("...a complete backup, carrying the folder link", data && data.state && data.state.players.length === 2 && data.driveFolderLink === LINK, data && { players: data.state && data.state.players.length, link: data.driveFolderLink });
  await sleep(300);
  check("...says so, no download, nothing to answer", /Saved in your Drive folder “Backups”/.test(await toast()) && jsonFiles(DL).length === 0 && !(await modal()), { t: await toast(), dl: jsonFiles(DL) });
  await exportAll();
  for (let i = 0; i < 30 && jsonFiles(BACKUPS).length < 2; i++) await sleep(250);
  check("a second backup with the same name: kept beside it, not over it", jsonFiles(BACKUPS).length === 2, jsonFiles(BACKUPS));

  // 2. a folder not synced here: kept, copied, asked to open the folder
  await setLink(OTHER);
  s = await waitStatus(/isn't synced/);
  check("a folder not synced on this computer: says how it'll go", /doesn't sync this folder on this computer/.test(s) && /paste the backup in/.test(s), s);
  await exportAll();
  let m = null;
  for (let i = 0; i < 30 && !m; i++) { await sleep(250); m = await modal(); }
  const kept = jsonFiles(KEPT), clip = fs.existsSync(CLIP) ? fs.readFileSync(CLIP, "utf8") : "";
  check("...kept in Documents › Pool Master Counter Backups and copied as a file", kept.length === 1 && clip === path.join(KEPT, kept[0]), { kept, clip });
  check("...asks to open the Drive folder to paste it", m && /The backup is copied: .*Open your Drive folder to paste it \(⌘V\)/.test(m), m);
  await page.click("#btn-confirm-modal-ok");
  await sleep(300);
  check("...yes: the folder's link opens", (await page.evaluate(() => window.__opened)).slice(-1)[0] === OTHER, await page.evaluate(() => window.__opened));

  // 3. no server (as on the GitHub page), not signed in: a plain download - no
  // question about a folder this device can't save into (no dead ends)
  await page.setRequestInterception(true);
  const block = (req) => (req.url().indexOf("/api/backup/drive") !== -1 ? req.respond({ status: 404, contentType: "text/html", body: "not here" }) : req.continue());
  page.on("request", block);
  await setLink(LINK);
  s = await waitStatus(/downloads, and the folder opens/);
  check("no server: \"a backup downloads, and the folder opens\"", /downloads, and the folder opens/.test(s), s);
  await exportAll();
  await sleep(1500);
  m = await modal();
  let dl = [];
  for (let i = 0; i < 20 && !dl.length; i++) { await sleep(250); dl = jsonFiles(DL); }
  check("...the backup downloads, said plainly, nothing to answer", dl.length === 1 && !m && /Backup saved in Downloads/.test(await toast()), { dl, m, t: await toast() });
  page.off("request", block);
  await page.setRequestInterception(false);

  // 4. a link to a file (for importing): a plain download
  // (Chrome holds back a page's second download - the download itself is what's recorded here)
  await page.evaluate(() => { window.__downloads = []; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) window.__downloads.push(this.download); return click.call(this); }; });
  await setLink("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQr/view");
  s = await waitStatus(/link to a file/);
  await exportAll();
  await sleep(800);
  const dls = await page.evaluate(() => window.__downloads);
  check("a link to a file, not a folder: said, and the backup simply downloads", /link to a file, not a folder/.test(s) && dls.length === 1 && /all-data/.test(dls[0]) && !(await modal()), { s, dls });

  // 5. a fresh device importing the backup: gets the link
  const fresh = await browser.createBrowserContext();
  const p2 = await fresh.newPage();
  p2.on("pageerror", (e) => errors.push("fresh: " + e.message));
  await p2.goto(BASE + "manifest.json");
  await p2.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await p2.goto(BASE, { waitUntil: "networkidle2" }); await showAll(p2);
  await sleep(500);
  const input = await p2.$("#import-file-input");
  await input.uploadFile(path.join(BACKUPS, saved[0]));
  for (let i = 0; i < 20; i++) { await sleep(300); const ok = await p2.$("#btn-confirm-modal-ok"); if (ok && await p2.evaluate(() => !document.getElementById("confirm-modal-overlay").classList.contains("hidden"))) await p2.click("#btn-confirm-modal-ok"); if (await p2.evaluate(() => (localStorage.getItem("poolMasterCounter.driveFolderLink.v1") || "") !== "")) break; }
  await sleep(800);
  const got = await p2.evaluate(() => ({ stored: localStorage.getItem("poolMasterCounter.driveFolderLink.v1"), shown: document.getElementById("drive-folder-link-input").value, status: document.getElementById("drive-backup-status").textContent }));
  check("a fresh device importing the All Data file: gets the Drive folder link (shown, and backups go there)", got.stored === LINK && got.shown === LINK && /saved straight into “Backups”|Looking for this folder/.test(got.status), got);
  await fresh.close();

  // 6. Import & Replace: the backup's link becomes this device's - and the
  // automatic backup made first goes quietly where backups go
  await setLink(OTHER);
  await waitStatus(/isn't synced/);
  const keptBefore = jsonFiles(KEPT).length;
  const sq = await page.$("#squash-import-file-input");
  await sq.uploadFile(path.join(BACKUPS, saved[0]));
  await sleep(700);
  await page.evaluate(() => document.getElementById("btn-squash-confirm").click());
  await sleep(1500);
  await page.evaluate(() => { const b = document.getElementById("btn-confirm-modal-ok"); if (b && b.offsetParent) b.click(); });
  await sleep(2500);
  const after = await page.evaluate(() => ({ stored: localStorage.getItem("poolMasterCounter.driveFolderLink.v1"), shown: document.getElementById("drive-folder-link-input").value }));
  check("Import & Replace: the backup's Drive folder link becomes this device's", after.stored === LINK && after.shown === LINK, after);
  check("...the automatic backup made first: kept quietly (no question asked)", jsonFiles(KEPT).length === keptBefore + 1, { before: keptBefore, now: jsonFiles(KEPT) });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  server.kill();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
