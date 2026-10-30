// 💾 Back up now on a computer: where to (2026-10-30 request). The Mac's server (its own, 4301) with a
// fake Google Drive for desktop (one account, test@example.com, its My Drive) and a throwaway HOME;
// a computer (no touch):
// - after the name: "Where should the backup go?" - ☁️ Google Drive - test@example.com (My Drive ›
//   Pool Master Counter Backups), 📤 Share…, ⬇️ Downloads (no linked folder: no "linked folder");
// - ☁️ that account: the backup written in its My Drive › Pool Master Counter Backups (a whole backup
//   - JSON with its players), "Saved in Google Drive: ..."; the last backup says Drive;
// - 📤 Share…: the share menu with the .json; ⬇️ Downloads: downloaded;
// - a computer with no Google Drive here (a second server, 4302, none synced): ☁️ Google Drive (drop
//   it in on the web) - downloaded, and drive.google.com opened;
// - no page errors.
// usage: node tests/probe_backup_where.js [screenshot dir]
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const EXE = "/Users/lucmartin/.cache/puppeteer/chrome/mac_arm-154.0.8037.57/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const OUT = process.argv[2];
let fails = 0;
function check(label, ok, extra) { console.log((ok ? "PASS " : "FAIL ") + label + (extra !== undefined && !ok ? "  " + JSON.stringify(extra).slice(0, 1400) : "")); if (!ok) fails++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(port, home, cloud) {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server", "server.js")], { env: Object.assign({}, process.env, { HOME: home, PORT: String(port), PMC_CLOUD_STORAGE: cloud }), stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { if ((await fetch("http://localhost:" + port + "/manifest.json")).ok) break; } catch (e) {} await sleep(250); }
  return server;
}

(async () => {
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "pmc-backup-where-"));
  const HOME = path.join(TMP, "home"), CLOUD = path.join(TMP, "CloudStorage"), EMPTY = path.join(TMP, "NoCloud");
  const MY = path.join(CLOUD, "GoogleDrive-test@example.com", "My Drive");
  fs.mkdirSync(HOME, { recursive: true }); fs.mkdirSync(MY, { recursive: true }); fs.mkdirSync(EMPTY, { recursive: true });
  const s1 = await startServer(4301, HOME, CLOUD), s2 = await startServer(4302, HOME, EMPTY);
  const browser = await puppeteer.launch({ executablePath: EXE, headless: "new", defaultViewport: { width: 1280, height: 900 } });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      window.__shared = []; window.__downloads = []; window.__opened = [];
      navigator.canShare = () => true;
      navigator.share = (d) => { window.__shared.push((d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size }))); return Promise.resolve(); };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
      window.open = (u) => { window.__opened.push(u); return null; };
    });
    const open = async (base) => {
      await page.goto(base + "manifest.json");
      await page.evaluate(() => {
        localStorage.clear();
        ["onboardingSeen", "boardTipsSeen", "homeScreenTipSeen", "migratedFromRepo"].forEach((k) => localStorage.setItem("poolMasterCounter." + k + ".v1", "1"));
        localStorage.setItem("poolMasterCounter.state.v2", JSON.stringify({ players: [{ id: "a", name: "Kim", playing: true, balls: 0 }, { id: "b", name: "Jo", playing: true, balls: 0 }], playerWins: {}, teamWins: {}, teamMvpWins: {}, gameHistory: [], gamesPlayedCount: 0, currentGame: { gameType: "8ball", target: 1, unit: "rack", mode: "individual" }, raceToWinsTarget: 5, rotation: { enabled: false, order: [], every: 1 } }));
      });
      await page.goto(base, { waitUntil: "networkidle2" });
      await sleep(1200);
    };
    const backUp = async () => {
      await page.evaluate(() => document.getElementById("btn-backup-now").click());
      await page.waitForSelector("#confirm-modal-overlay:not(.hidden)", { timeout: 3000 });
      await page.click("#btn-confirm-modal-ok");
      await sleep(400);
      return page.evaluate(() => { const o = document.getElementById("tournament-chooser-overlay"); return o ? { title: o.querySelector(".confirm-modal-message").textContent, choices: [...o.querySelectorAll("button")].map((b) => (b.id || "") + "|" + b.textContent) } : null; });
    };
    const toast = () => page.evaluate(() => { const t = [...document.querySelectorAll("#page-toast, #win-toast, .toast")].find((x) => !x.classList.contains("hidden") && x.textContent.trim()); return t ? t.textContent : ""; });

    await open("http://localhost:4301/");
    let ch = await backUp();
    if (OUT) await page.screenshot({ path: path.join(OUT, "backup_where.png") });
    const labels = ch ? ch.choices.map((c) => c.split("|")[1]) : [];
    check("after the name: \"" + (ch && ch.title) + "\" - " + labels.join(" / "), ch && ch.title === "Where should the backup go?" && labels[0] === "☁️ Google Drive - test@example.com (My Drive › Pool Master Counter Backups)" && labels.includes("📤 Share…") && labels.includes("⬇️ Downloads") && !labels.some((l) => /linked folder/.test(l)), ch);
    await page.click("#btn-bk-to-drive-account-0");
    await sleep(1500);
    const dir = path.join(MY, "Pool Master Counter Backups");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8")); } catch (e) {}
    const t1 = await toast();
    const last = await page.evaluate(() => JSON.parse(localStorage.getItem("poolMasterCounter.lastBackup.v1") || "null"));
    check("☁️ that account: the backup in its My Drive › Pool Master Counter Backups (" + files.join(", ") + "), a whole backup; \"" + t1 + "\"; the last backup: Drive", files.length === 1 && /\.json$/.test(files[0]) && parsed && JSON.stringify(parsed).includes("Kim") && /Saved in Google Drive: test@example\.com › My Drive › Pool Master Counter Backups/.test(t1) && last && last.where === "drive", { files, t1, last });
    await backUp();
    await page.click("#btn-bk-to-share");
    await sleep(500);
    const shared = await page.evaluate(() => window.__shared);
    check("📤 Share…: the share menu with the .json", shared.length === 1 && shared[0].length === 1 && /\.json$/.test(shared[0][0].name) && shared[0][0].size > 100, shared);
    await backUp();
    await page.click("#btn-bk-to-downloads");
    await sleep(500);
    const dls = await page.evaluate(() => window.__downloads);
    check("⬇️ Downloads: downloaded (" + dls.join(", ") + ")", dls.length === 1 && /\.json$/.test(dls[0]), dls);

    // no Google Drive on this computer
    await open("http://localhost:4302/");
    ch = await backUp();
    const labels2 = ch ? ch.choices.map((c) => c.split("|")[1]) : [];
    await page.evaluate(() => { window.__downloads = []; window.__opened = []; });
    await page.click("#btn-bk-to-drive-web");
    await sleep(500);
    const web = await page.evaluate(() => ({ dls: window.__downloads, opened: window.__opened }));
    check("no Google Drive here: \"☁️ Google Drive (drop it in on the web)\" first - downloaded, drive.google.com opened", labels2[0] === "☁️ Google Drive (drop it in on the web)" && web.dls.length === 1 && web.opened.length === 1 && /drive\.google\.com/.test(web.opened[0]), { labels2, web });
  } finally {
    check("no page errors", errors.length === 0, errors);
    await browser.close();
    s1.kill(); s2.kill();
    fs.rmSync(TMP, { recursive: true, force: true });
  }
  console.log(fails ? fails + " FAILED" : "all passed");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log("FAIL crashed: " + (e && e.stack)); process.exit(1); });
