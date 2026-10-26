// The simpler Backup & Restore panel, as a person uses it: where backups go
// (this device / Google Drive), one "Back up now", one "Restore" that asks
// which backup and then how (add to what's here / replace it), Recover
// Data, Share results, and everything technical under ⚙️ More options.
// Its own server on 4241 with a throwaway HOME and a fake Google Drive for
// desktop (a synced folder marked with its Drive id), plus a little web
// server on 4242 handing out a backup file (for "restore from a web
// address").
// Checks: the panel reads in plain words (no API key, no "iCloud Sync" in
// sight, More options folded); Back up now to this device -> "Last backup:
// ... on this device"; Google Drive without sign-in set up -> says so and
// opens More options; no folder link -> asks for it; with the folder (Drive
// for desktop) -> saved in it, "Last backup: ... in Google Drive › Backups";
// Restore a file -> its summary -> Add (players added, nothing lost) /
// Replace (the "Are you sure?", then exactly the backup); a file that isn't
// a backup -> said; From Google Drive without a connection -> "Connect
// first"; a web address -> straight to "How should it come in?"; on a
// phone the dialog fits.
// usage: node tests/probe_backup_simple.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn, execFileSync } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const PORT = 4241, WPORT = 4242, BASE = "http://localhost:" + PORT + "/";
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

(async () => {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(BACKUPS, { recursive: true });
  execFileSync("/usr/bin/xattr", ["-w", "com.google.drivefs.item-id#S", FOLDER_ID, BACKUPS]);
  const backupFile = path.join(HOME, "mario-backup.json"), junkFile = path.join(HOME, "notes.json");
  fs.writeFileSync(backupFile, BACKUP);
  fs.writeFileSync(junkFile, JSON.stringify({ hello: "world" }));
  const web = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(BACKUP); });
  await new Promise((ok) => web.listen(WPORT, ok));
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], {
    env: Object.assign({}, process.env, { HOME, PORT: String(PORT), PMC_CLOUD_STORAGE: CLOUD, PMC_CLIPBOARD_FILE: path.join(HOME, "clip.txt") }), stdio: "ignore"
  });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + "manifest.json")).ok) break; } catch (e) {} await sleep(250); }

  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1100, height: 1000 } });
  const errors = [];
  const page = await browser.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.evaluateOnNewDocument(() => { window.__downloads = []; const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); }; });
  await page.goto(BASE + "manifest.json");
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem("poolMasterCounter.onboardingSeen.v1", "1"); localStorage.setItem("poolMasterCounter.migratedFromRepo.v1", "1"); });
  await page.goto(BASE, { waitUntil: "networkidle2" });
  await sleep(700);
  const addPlayers = (names) => page.evaluate(async (names) => {
    for (const n of names) {
      const input = document.getElementById("new-player-name"), btn = document.getElementById("btn-add-player");
      input.value = n; input.dispatchEvent(new Event("input", { bubbles: true })); btn.disabled = false; btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
  }, names);
  await addPlayers(["Luigi", "Luc"]);
  const openPanel = () => page.evaluate(() => { const b = document.getElementById("btn-toggle-backup-panel"); if (document.getElementById("backup-panel").classList.contains("collapsed")) b.click(); });
  const closeModals = async () => { for (let i = 0; i < 10; i++) { const open = await page.evaluate(() => { const o = document.getElementById("confirm-modal-overlay"); if (o && !o.classList.contains("hidden")) { document.getElementById("btn-confirm-modal-ok").click(); return true; } return false; }); if (!open) break; await sleep(400); } };
  const toast = () => page.evaluate(() => { const t = [...document.querySelectorAll("#page-toast, #win-toast")].find((x) => !x.classList.contains("hidden") && x.textContent.trim()); return t ? t.textContent : ""; });
  const players = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("poolMasterCounter.state.v2")).players.map((p) => p.name).sort(); } catch (e) { return []; } });
  await openPanel();
  await sleep(900);

  // the panel, in plain words
  const look = await page.evaluate(() => {
    const panel = document.getElementById("backup-panel"), more = document.getElementById("bk-more");
    const visibleText = [...panel.querySelectorAll("h2, h3, button, label, summary, p")].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).join(" | ");
    return { title: panel.querySelector("h2").textContent, summary: document.getElementById("backup-panel-summary").textContent, moreOpen: more.open, visibleText,
      sections: [...panel.querySelectorAll(".backup-subsection > h3")].map((h) => h.textContent), apiKey: !!document.getElementById("drive-api-key-input") };
  });
  check("the panel: \"💾 Backup & Restore\", \"No backup yet on this device.\"", look.title === "💾 Backup & Restore" && look.summary === "No backup yet on this device.", look);
  check("...four jobs: Back up, Restore, Recover Data, Share results", JSON.stringify(look.sections) === JSON.stringify(["💾 Back up", "⬇️ Restore", "🗄️ Recover Data", "📤 Share results"]), look.sections);
  check("...no API key, no client ID, no \"iCloud Sync\" in sight - More options folded", !look.apiKey && !/API key|client ID|iCloud Sync|secret/i.test(look.visibleText) && !look.moreOpen, look.visibleText);
  if (OUT) await (await page.$("#backup-panel")).screenshot({ path: OUT + "/backup_panel.png" });

  // 1. Back up now, to this device
  const dest = await page.evaluate(() => ({ device: document.getElementById("bk-dest-device").checked, driveBox: !document.getElementById("bk-drive-box").classList.contains("hidden") }));
  await page.click("#btn-backup-now");
  await sleep(500);
  const dls = await page.evaluate(() => window.__downloads);
  const last = await page.evaluate(() => ({ line: document.getElementById("bk-last").textContent, summary: document.getElementById("backup-panel-summary").textContent }));
  check("Back up now (this device, the start): no questions, a file downloaded", dest.device && !dest.driveBox && dls.length === 1 && /all-data/.test(dls[0]) && !(await page.evaluate(() => !document.getElementById("confirm-modal-overlay").classList.contains("hidden"))), { dest, dls });
  check("...\"Last backup: <when>, saved as a file on this device.\" - under the button and on the closed panel", /^Last backup: .+, saved as a file on this device\.$/.test(last.line) && last.summary === last.line, last);

  // 2. Google Drive: sign-in not set up -> says so, More options opens; no folder -> asks
  await page.click("#bk-dest-drive");
  await sleep(300);
  let st = await page.evaluate(() => ({ box: !document.getElementById("bk-drive-box").classList.contains("hidden"), status: document.getElementById("drive-connect-status").textContent }));
  check("Google Drive chosen: the Drive part shows - \"Google sign-in isn't set up for this app yet...\"", st.box && /isn't set up for this app yet/.test(st.status), st);
  await page.click("#btn-drive-connect");
  await sleep(500);
  const moreOpen = await page.evaluate(() => document.getElementById("bk-more").open);
  check("...Connect: says so and opens ⚙️ More options at the sign-in setup", moreOpen && /isn't set up/.test(await toast()), { moreOpen, t: await toast() });
  await page.evaluate(() => { document.getElementById("bk-more").open = false; });
  await page.click("#btn-backup-now");
  await sleep(300);
  check("Back up now with no folder yet: \"Paste your backup folder's link first\"", /Paste your backup folder's link first/.test(await toast()) && (await page.evaluate(() => window.__downloads.length)) === 1, await toast());

  // 3. the folder (synced on this computer by Drive for desktop): saved there
  await page.evaluate((l) => { const i = document.getElementById("drive-folder-link-input"); i.value = l; i.dispatchEvent(new Event("change", { bubbles: true })); }, LINK);
  for (let i = 0; i < 20; i++) { if (/Backups/.test(await page.evaluate(() => document.getElementById("drive-backup-status").textContent))) break; await sleep(250); }
  await page.click("#btn-backup-now");
  let saved = [];
  for (let i = 0; i < 30 && !saved.length; i++) { await sleep(250); saved = jsonFiles(BACKUPS); }
  await sleep(400);
  const lastDrive = await page.evaluate(() => document.getElementById("bk-last").textContent);
  check("with the folder: the backup lands in it - \"Last backup: <when>, in Google Drive › Backups.\"", saved.length === 1 && /^Last backup: .+, in Google Drive › Backups\.$/.test(lastDrive), { saved, lastDrive });
  const synced = await page.evaluate(() => document.getElementById("drive-connect-status").textContent);
  check("...and no \"sign-in isn't set up\" scare: \"Google Drive on this computer already syncs this folder\"", /already syncs this folder/.test(synced), synced);
  if (OUT) await (await page.$("#bk-backup")).screenshot({ path: OUT + "/backup_drive.png" });

  // 4. Restore: a file -> its summary -> Add
  const pickFile = async (file) => { const input = await page.$("#bk-restore-file-input"); await input.uploadFile(file); await sleep(600); };
  await page.click("#btn-restore");
  await sleep(300);
  const step1 = await page.evaluate(() => ({ open: !document.getElementById("bk-restore-overlay").classList.contains("hidden"), q: document.querySelector("#bk-step-pick .bk-step-q").textContent }));
  await pickFile(junkFile);
  const junkNote = await page.evaluate(() => ({ note: document.getElementById("bk-drive-pick-note").textContent, how: !document.getElementById("bk-step-how").classList.contains("hidden") }));
  check("Restore: \"Which backup?\" - a file that isn't a backup is said, and goes no further", step1.open && step1.q === "Which backup?" && !junkNote.how && /isn't|doesn't/.test(junkNote.note), { step1, junkNote });
  await pickFile(backupFile);
  const how = await page.evaluate(() => ({ how: !document.getElementById("bk-step-how").classList.contains("hidden"), summary: document.getElementById("bk-backup-summary").textContent, add: document.getElementById("btn-bk-add").textContent, replace: document.getElementById("btn-bk-replace").textContent }));
  check("...a backup: its summary (\"Backup from <date> · 2 players\"), then Add / Replace, each said plainly", how.how && /^Backup from .+ · 2 players$/.test(how.summary) && /Add to what's here[\s\S]*Nothing here is lost/.test(how.add) && /Replace what's here[\s\S]*backed up first/.test(how.replace), how);
  if (OUT) await (await page.$("#bk-restore-overlay .bk-dialog")).screenshot({ path: OUT + "/restore_how.png" });
  await page.click("#btn-bk-add");
  let ps = [];
  for (let i = 0; i < 20; i++) { await sleep(300); await closeModals(); ps = await players(); if (ps.includes("Mario")) break; }
  check("Add: Mario and Peach join Luigi and Luc - nothing lost", JSON.stringify(ps) === JSON.stringify(["Luc", "Luigi", "Mario", "Peach"]), ps);

  // 5. Restore a file -> Replace (the same "Are you sure?", what's here backed up first)
  await sleep(500); await closeModals(); await openPanel(); await sleep(300);
  const before = jsonFiles(BACKUPS).length;
  await page.click("#btn-restore"); await sleep(300);
  await pickFile(backupFile);
  await page.click("#btn-bk-replace"); await sleep(600);
  const sure = await page.evaluate(() => !document.getElementById("squash-warning-overlay").classList.contains("hidden"));
  await page.evaluate(() => document.getElementById("btn-squash-confirm").click());
  for (let i = 0; i < 20; i++) { await sleep(300); await closeModals(); ps = await players(); if (!ps.includes("Luigi")) break; }
  await sleep(800);
  check("Replace: \"Are you sure?\", then this device is exactly the backup (Mario, Peach)", sure && JSON.stringify(ps) === JSON.stringify(["Mario", "Peach"]), { sure, ps });
  check("...what was here backed up first - into the Google Drive folder", jsonFiles(BACKUPS).length === before + 1, jsonFiles(BACKUPS));

  // 6. From Google Drive without a connection: "Connect first"
  await closeModals(); await openPanel(); await sleep(300);
  await page.click("#btn-restore"); await sleep(300);
  await page.click("#btn-bk-pick-drive"); await sleep(300);
  const driveNote = await page.evaluate(() => document.getElementById("bk-drive-pick-note").textContent);
  check("From Google Drive, not connected: \"Connect Google Drive first\"", /Connect Google Drive first/.test(driveNote), driveNote);
  await page.click("#btn-bk-cancel"); await sleep(200);

  // 7. a web address (More options): straight to "How should it come in?"
  await page.evaluate(() => { document.getElementById("bk-more").open = true; });
  await page.evaluate((u) => { document.getElementById("bk-web-link-input").value = u; }, "http://localhost:" + WPORT + "/backup.json");
  await page.click("#btn-bk-web-restore");
  await sleep(800);
  const webHow = await page.evaluate(() => ({ open: !document.getElementById("bk-restore-overlay").classList.contains("hidden"), how: !document.getElementById("bk-step-how").classList.contains("hidden"), summary: document.getElementById("bk-backup-summary").textContent }));
  check("More options › Restore from a web address: read, then \"How should it come in?\"", webHow.open && webHow.how && /2 players/.test(webHow.summary), webHow);

  // 8. on a phone: the dialog fits
  await page.setViewport({ width: 390, height: 844 });
  await sleep(400);
  const fit = await page.evaluate(() => { const d = document.querySelector("#bk-restore-overlay .bk-dialog").getBoundingClientRect(); return { left: Math.round(d.left), right: Math.round(d.right), w: document.documentElement.scrollWidth }; });
  check("on a phone (390 px): the Restore dialog fits, no sideways scroll", fit.left >= 0 && fit.right <= 390 && fit.w <= 390, fit);
  if (OUT) await page.screenshot({ path: OUT + "/restore_phone.png" });

  check("no page errors", errors.length === 0, errors);
  await browser.close();
  server.kill(); web.close();
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
