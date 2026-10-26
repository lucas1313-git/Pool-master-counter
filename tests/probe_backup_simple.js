// The simpler Backup & Restore panel, and its rule: no dead ends - every
// button shown can finish its job on this device. "💾 Back up now" makes the
// file and lets the device decide where it goes (a phone or tablet: the
// share sheet - Save to Files: iCloud Drive, Google Drive...; a computer:
// Downloads; on the Mac with a Google Drive folder: straight into it);
// "⬇️ Restore a backup" opens the file picker, then asks how (add / replace).
// Google Drive extras only where they work.
// Two places: the Mac (its server on 4241 - throwaway HOME, a fake Google
// Drive for desktop folder) and the GitHub site (a plain file server on 4243,
// no server behind it); a little web server on 4242 hands out a backup.
// Checks: plain words (no API key / client ID / "iCloud Sync" in sight);
// GitHub-like: no Google Drive part, no sign-in setup, nothing to connect
// (the owner's setup only with ?owner); a computer: Back up now -> Downloads,
// "It goes to this computer's Downloads folder"; a tablet: the share sheet
// ("You choose where it goes"), "saved where you chose", cancel said; the
// Mac: the Drive folder part (no Connect without a sign-in, no "isn't set up"
// scare), with the synced folder -> straight into it; Restore -> the file
// picker at once -> summary -> Add (nothing lost) / Replace ("Are you
// sure?", what's here backed up first); not a backup -> said, try again;
// a web address -> "How should it come in?"; the dialog fits a phone.
// usage: node tests/probe_backup_simple.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const REPO = path.join(__dirname, "..");
const PORT = 4241, WPORT = 4242, SPORT = 4243, BASE = "http://localhost:" + PORT + "/", STATIC = "http://localhost:" + SPORT + "/";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOME = path.join(__dirname, "tmphome", "backup-simple-home");
const CLOUD = path.join(HOME, "Library", "CloudStorage");
const BACKUPS = path.join(CLOUD, "GoogleDrive-test@example.com", "My Drive", "Backups");
const FOLDER_ID = "1FAKEsimpleBackupsFold01", LINK = "https://drive.google.com/drive/folders/" + FOLDER_ID;
const jsonFiles = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /\.json$/.test(n)) : []);
const BACKUP = JSON.stringify({ exportedAt: "2026-10-20T19:30:00Z", state: { players: [{ id: "p-mario", name: "Mario", playing: false, balls: 0 }, { id: "p-peach", name: "Peach", playing: false, balls: 0 }], currentGame: { gameType: "8ball", unit: "rack", target: 1, mode: "individual" }, gameHistory: [] } });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(BACKUPS, { recursive: true });
  execFileSync("/usr/bin/xattr", ["-w", "com.google.drivefs.item-id#S", FOLDER_ID, BACKUPS]);
  const backupFile = path.join(HOME, "mario-backup.json"), junkFile = path.join(HOME, "notes.json");
  fs.writeFileSync(backupFile, BACKUP);
  fs.writeFileSync(junkFile, JSON.stringify({ hello: "world" }));
  const web = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(BACKUP); });
  await new Promise((ok) => web.listen(WPORT, ok));
  // the GitHub site: files only
  const site = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, STATIC).pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(REPO, p);
    if (!f.startsWith(REPO) || p.startsWith("/api/") || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(SPORT, ok));
  const server = spawn(process.execPath, [path.join(REPO, "server", "server.js")], {
    env: Object.assign({}, process.env, { HOME, PORT: String(PORT), PMC_CLOUD_STORAGE: CLOUD, PMC_CLIPBOARD_FILE: path.join(HOME, "clip.txt") }), stdio: "ignore"
  });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + "manifest.json")).ok) break; } catch (e) {} await sleep(250); }

  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 1000 } });
  const errors = [];
  async function open(base, opts) {
    opts = opts || {};
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(base + ": " + e.message));
    // (downloads and the share sheet recorded; a tablet is pretended: touch + a share sheet)
    await page.evaluateOnNewDocument((tablet) => {
      window.__downloads = []; window.__shared = []; window.__shareAnswer = "ok";
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
      if (tablet) {
        Object.defineProperty(navigator, "maxTouchPoints", { get: () => 5 });
        navigator.canShare = (d) => !!(d && d.files && d.files.length);
        navigator.share = (d) => { window.__shared.push(d.files[0].name); return window.__shareAnswer === "cancel" ? Promise.reject(new DOMException("cancelled", "AbortError")) : Promise.resolve(); };
      }
    }, !!opts.tablet);
    await page.goto(base + "manifest.json");
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
    await page.goto(base + (opts.hash || ""), { waitUntil: "networkidle2" });
    await sleep(700);
    await page.evaluate(async () => {
      for (const n of ["Luigi", "Luc"]) {
        const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
        input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
        await new Promise((r) => setTimeout(r, 200));
      }
      const b = document.getElementById("btn-toggle-backup-panel");
      if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click();
    });
    await sleep(900);
    return page;
  }
  const vis = (page, id) => page.evaluate((id) => { const e = document.getElementById(id); return !!e && !e.classList.contains("hidden") && !e.closest(".hidden") && e.offsetParent !== null; }, id);
  const text = (page, id) => page.evaluate((id) => document.getElementById(id).textContent, id);
  const toast = (page) => page.evaluate(() => { const t = [...document.querySelectorAll("#page-toast, #win-toast")].find((x) => !x.classList.contains("hidden") && x.textContent.trim()); return t ? t.textContent : ""; });
  const openMore = (page) => page.evaluate(() => { document.getElementById("bk-more").open = true; });

  // ---- the GitHub site (no server), a computer ----
  let page = await open(STATIC);
  const look = await page.evaluate(() => {
    const panel = document.getElementById("backup-panel");
    const visibleText = [...panel.querySelectorAll("h2, h3, h4, button, label, summary, p")].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).join(" | ");
    return { title: panel.querySelector("h2").textContent, summary: document.getElementById("backup-panel-summary").textContent, moreOpen: document.getElementById("bk-more").open, visibleText,
      sections: [...panel.querySelectorAll(".backup-subsection > h3")].map((h) => h.textContent) };
  });
  check("the panel: \"💾 Backup & Restore\", four jobs, More options folded", look.title === "💾 Backup & Restore" && JSON.stringify(look.sections) === JSON.stringify(["💾 Back up", "⬇️ Restore", "🗄️ Recover Data", "📤 Share results"]) && !look.moreOpen, look);
  check("...no API key, no client ID, no secret, no \"iCloud Sync\", nothing to connect in sight", !/API key|client ID|secret|iCloud Sync|Connect Google/i.test(look.visibleText), look.visibleText);
  await openMore(page);
  await sleep(200);
  const gh = { drive: await vis(page, "bk-drive-box"), setup: await vis(page, "drive-connect"), connect: await vis(page, "btn-drive-connect") };
  check("GitHub site, More options: no Google Drive part, no sign-in setup, no Connect - nothing that can't work here", !gh.drive && !gh.setup && !gh.connect, gh);
  if (OUT) await (await page.$("#backup-panel")).screenshot({ path: OUT + "/backup_panel.png" });
  await page.evaluate(() => { document.getElementById("bk-more").open = false; });
  const whereDl = await text(page, "bk-where");
  await page.click("#btn-backup-now");
  await sleep(500);
  const dls = await page.evaluate(() => window.__downloads);
  check("a computer: \"It goes to this computer's Downloads folder.\" - Back up now: downloaded, said, no questions", /Downloads folder/.test(whereDl) && dls.length === 1 && /all-data/.test(dls[0]) && /Backup saved in Downloads/.test(await toast(page)), { whereDl, dls, t: await toast(page) });
  check("...\"Last backup: <when>, saved as a file on this device.\" (and on the closed panel)", /^Last backup: .+, saved as a file on this device\.$/.test(await text(page, "bk-last")) && (await text(page, "backup-panel-summary")) === (await text(page, "bk-last")));
  await page.close();
  page = await open(STATIC, { hash: "?owner" });
  await openMore(page); await sleep(200);
  const owner = { setup: await vis(page, "drive-connect"), secret: await vis(page, "drive-client-secret-input"), status: await text(page, "drive-connect-status"), connect: await vis(page, "btn-drive-connect") };
  check("...the app's owner (?owner in the address): the sign-in setup shows - the client ID only, no secret - and no Connect until it's saved", owner.setup && !owner.secret && !owner.connect && /Save the app's Google client ID below/.test(owner.status), owner);
  await page.close();

  // ---- the GitHub site on a tablet: the share sheet ----
  page = await open(STATIC, { tablet: true });
  const whereShare = await text(page, "bk-where");
  await page.click("#btn-backup-now"); await sleep(400);
  const shared = await page.evaluate(() => ({ shared: window.__shared, downloads: window.__downloads }));
  check("a tablet: \"You choose where it goes: Save to Files (iCloud Drive, Google Drive…)...\" - Back up now opens the share sheet", /You choose where it goes: Save to Files/.test(whereShare) && shared.shared.length === 1 && /all-data/.test(shared.shared[0]) && shared.downloads.length === 0, { whereShare, shared });
  check("...done: \"Last backup: <when>, saved where you chose.\"", /saved where you chose/.test(await text(page, "bk-last")), await text(page, "bk-last"));
  await page.evaluate(() => { window.__shareAnswer = "cancel"; });
  await page.click("#btn-backup-now"); await sleep(400);
  check("...the share sheet closed without saving: said plainly (\"Not saved - press Back up now again...\")", /Not saved - press Back up now again/.test(await toast(page)), await toast(page));
  if (OUT) { await page.setViewport({ width: 390, height: 844 }); await sleep(300); await (await page.$("#bk-backup")).screenshot({ path: OUT + "/backup_tablet.png" }); }
  await page.close();

  // ---- the Mac (its server): the Drive folder, straight in ----
  page = await open(BASE);
  await openMore(page); await sleep(500);
  const mac = { drive: await vis(page, "bk-drive-box"), connect: await vis(page, "btn-drive-connect"), status: await text(page, "drive-connect-status"), setup: await vis(page, "drive-connect"), secret: await vis(page, "drive-client-secret-input") };
  check("the Mac, More options: \"Straight into a Google Drive folder\" (Google Drive for desktop - no sign-in needed), no Connect, no \"isn't set up\" scare", mac.drive && !mac.connect && /no sign-in needed/.test(mac.status) && !/isn't set up/.test(mac.status), mac);
  check("...the owner's sign-in setup shows on the Mac itself (ID and secret)", mac.setup && mac.secret, mac);
  await page.evaluate((l) => { const i = document.getElementById("drive-folder-link-input"); i.value = l; i.dispatchEvent(new Event("change", { bubbles: true })); }, LINK);
  for (let i = 0; i < 20; i++) { if (/already syncs this folder/.test(await text(page, "drive-connect-status"))) break; await sleep(250); }
  const whereDrive = await text(page, "bk-where");
  check("...the folder (synced here): \"already syncs this folder\" - and Back up now: \"It goes straight into your Google Drive folder\"", /already syncs this folder/.test(await text(page, "drive-connect-status")) && /straight into your Google Drive folder/.test(whereDrive), { whereDrive });
  await page.click("#btn-backup-now");
  let saved = [];
  for (let i = 0; i < 30 && !saved.length; i++) { await sleep(250); saved = jsonFiles(BACKUPS); }
  await sleep(400);
  check("...saved in it: \"Last backup: <when>, in Google Drive › Backups.\"", saved.length === 1 && /^Last backup: .+, in Google Drive › Backups\.$/.test(await text(page, "bk-last")), { saved, last: await text(page, "bk-last") });
  if (OUT) await (await page.$("#bk-more")).screenshot({ path: OUT + "/more_options_mac.png" });

  // ---- Restore: the file picker at once, then how ----
  const players = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.map((p) => p.name).sort(); } catch (e) { return []; } });
  const closeModals = async () => { for (let i = 0; i < 10; i++) { const o = await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) { document.getElementById("btn-confirm-modal-ok").click(); return true; } return false; }); if (!o) break; await sleep(400); } };
  const restoreWith = async (file) => {
    const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 5000 }), page.click("#btn-restore")]);
    await chooser.accept([file]);
    await sleep(700);
  };
  await page.evaluate(() => { document.getElementById("bk-more").open = false; });
  await restoreWith(junkFile);
  const junk = await page.evaluate(() => ({ open: !document.getElementById("bk-restore-overlay").classList.contains("hidden"), how: !document.getElementById("bk-step-how").classList.contains("hidden"), note: document.getElementById("bk-drive-pick-note").textContent, again: !document.getElementById("btn-bk-pick-file").classList.contains("hidden"), drive: !document.getElementById("btn-bk-pick-drive").classList.contains("hidden") }));
  check("Restore: the file picker straight away - a file that isn't a backup: said, \"A file on this device\" to try again, no Drive button (not signed in)", junk.open && !junk.how && /doesn't|isn't/.test(junk.note) && junk.again && !junk.drive, junk);
  await page.click("#btn-bk-cancel"); await sleep(200);
  await restoreWith(backupFile);
  const how = await page.evaluate(() => ({ how: !document.getElementById("bk-step-how").classList.contains("hidden"), summary: document.getElementById("bk-backup-summary").textContent, add: document.getElementById("btn-bk-add").textContent, replace: document.getElementById("btn-bk-replace").textContent }));
  check("...a backup: \"Backup from <date> · 2 players\", then Add / Replace, each said plainly", how.how && /^Backup from .+ · 2 players$/.test(how.summary) && /Add to what's here[\s\S]*Nothing here is lost/.test(how.add) && /Replace what's here[\s\S]*backed up first/.test(how.replace), how);
  if (OUT) await (await page.$("#bk-restore-overlay .bk-dialog")).screenshot({ path: OUT + "/restore_how.png" });
  await page.click("#btn-bk-add");
  let ps = [];
  for (let i = 0; i < 20; i++) { await sleep(300); await closeModals(); ps = await players(); if (ps.includes("Mario")) break; }
  check("Add: Mario and Peach join Luigi and Luc - nothing lost", JSON.stringify(ps) === JSON.stringify(["Luc", "Luigi", "Mario", "Peach"]), ps);
  await sleep(500); await closeModals();
  await page.evaluate(() => { const b = document.getElementById("btn-toggle-backup-panel"); if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click(); });
  await sleep(300);
  const before = jsonFiles(BACKUPS).length;
  await restoreWith(backupFile);
  await page.click("#btn-bk-replace"); await sleep(600);
  const sure = await page.evaluate(() => !document.getElementById("squash-warning-overlay").classList.contains("hidden"));
  await page.evaluate(() => document.getElementById("btn-squash-confirm").click());
  for (let i = 0; i < 20; i++) { await sleep(300); await closeModals(); ps = await players(); if (!ps.includes("Luigi")) break; }
  await sleep(800);
  check("Replace: \"Are you sure?\", then exactly the backup (Mario, Peach) - what was here backed up first, into the Drive folder", sure && JSON.stringify(ps) === JSON.stringify(["Mario", "Peach"]) && jsonFiles(BACKUPS).length === before + 1, { sure, ps, files: jsonFiles(BACKUPS) });

  // a web address (More options): straight to "How should it come in?"
  await closeModals();
  await page.evaluate(() => { const b = document.getElementById("btn-toggle-backup-panel"); if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click(); document.getElementById("bk-more").open = true; });
  await page.evaluate((u) => { document.getElementById("bk-web-link-input").value = u; }, "http://localhost:" + WPORT + "/backup.json");
  await page.click("#btn-bk-web-restore");
  await sleep(800);
  const webHow = await page.evaluate(() => ({ open: !document.getElementById("bk-restore-overlay").classList.contains("hidden"), how: !document.getElementById("bk-step-how").classList.contains("hidden"), summary: document.getElementById("bk-backup-summary").textContent }));
  check("More options › Restore from a web address: read, then \"How should it come in?\"", webHow.open && webHow.how && /2 players/.test(webHow.summary), webHow);
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  const fit = await page.evaluate(() => { const d = document.querySelector("#bk-restore-overlay .bk-dialog").getBoundingClientRect(); return { left: Math.round(d.left), right: Math.round(d.right), w: document.documentElement.scrollWidth }; });
  check("on a phone (390 px): the Restore dialog fits, no sideways scroll", fit.left >= 0 && fit.right <= 390 && fit.w <= 390, fit);

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  server.kill(); web.close(); site.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
